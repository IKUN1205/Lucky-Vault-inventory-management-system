// api/audit-cards.js
// Reconciliation endpoint for the Cards Audit page (src/pages/CardsAudit.jsx).
// Compares DB state vs Google Sheet state and reports discrepancies so staff
// can fix them — either by pushing the DB truth to the sheet (using
// /api/sheet-mark-sold) or by adjusting the sheet manually.
//
// Two modes:
//   ?mode=scan&kind=single|slab&id=<tcg_or_cert>
//     Returns a side-by-side comparison of a single record. Used when
//     staff scan a barcode at the audit page.
//
//   ?mode=full&kind=single|slab
//     Returns every discrepancy. Used by the "Run full audit" button.
//
// Both modes are READ-ONLY — they never write to the sheet or the DB.
// All mutations go through /api/sheet-mark-sold or the regular sync.

import { createClient } from '@supabase/supabase-js'
import { readRange } from './_lib/google-sheets.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

const SHEET_CONFIG = {
  single: {
    spreadsheetId: '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80',
    // Master Singles ONLY (boss directive 2026-06-04 — New Singles is a
    // staging area for fresh data and shouldn't drive the audit).
    tabs: ['Master Singles'],
    idColumn: 5,         // F = TCG ID
    qtyColumn: 4,        // E = Qty
    locationColumn: 6,   // G = Location (free-text; fuzzy-matched below)
    statusColumn: 8,     // I = Status
    priceColumn: 2,      // C = Market $
    table: 'singles',
    idAttr: 'tcg_id',
    qtyAttr: 'quantity',
    priceAttr: 'current_market_price_usd',
  },
  slab: {
    spreadsheetId: '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI',
    tabs: ['Pokemon Master', 'One Piece Master'],
    idColumn: 0,         // A = Cert
    nameColumn: 2,       // C = Item Name (for name-integrity check)
    statusColumn: 11,    // L = Status
    // Slabs have no qty (always 1) — set to null below in the scan call
    // so the comparator skips it cleanly.
    table: 'slabs',
    idAttr: 'cert_number',
    nameAttr: 'item_name',
  },
}

// Name-integrity comparison (slabs). The 2026-06-09 incident: the legacy
// Mystery Game create path attached the WRONG card name to a cert (copied
// from another scan), and nothing caught it until the boss eyeballed a
// sold listing. Token-overlap below 50% between the app's item_name and
// the sheet's Item Name now raises a name_mismatch issue so this class
// of data corruption surfaces in every Full audit instead of by luck.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s#]/g, ' ').split(/\s+/).filter(Boolean)
function nameOverlap(a, b) {
  const A = new Set(normName(a)), B = new Set(normName(b))
  if (A.size === 0 || B.size === 0) return 1   // nothing to compare — don't flag
  let hit = 0
  for (const t of A) if (B.has(t)) hit++
  return hit / Math.max(1, Math.min(A.size, B.size))
}

// Normalize a location string for fuzzy comparison. Boss might write
// "Master" / "Front" / "Stream Room - eBay LV" while the locations table
// has the canonical "Master Inventory" / "Front Store" / "Stream Room -
// eBay LuckyVaultUS". We collapse to a set of tokens and rely on
// substring containment so both sides can match.
const LOCATION_NOISE = /^(stream\s*room|inventory|store|the|a)$/i
function normalizeLocation(raw) {
  if (raw == null) return ''
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !LOCATION_NOISE.test(t))
    .join(' ')
    .trim()
}
function locationsMatch(a, b) {
  const na = normalizeLocation(a)
  const nb = normalizeLocation(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // Substring match either way — "front" matches "front store", "ebay
  // luckyvaultus" matches "stream room ebay luckyvaultus".
  return na.includes(nb) || nb.includes(na)
}

export const config = { maxDuration: 60 }

// Parse dollar strings like "$0.09" or " $1,205.00 " → number or null.
function parseDollar(v) {
  if (v == null) return null
  const s = String(v).replace(/[\$,\s]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Read ALL data rows from every configured tab. Returns a map keyed by id
// string → { tab, rowIndex (1-based for display), qty, status, price, location }.
// First row of each tab is the header — skipped via the digit check (all
// real ids are digit-only strings, headers have words).
async function loadSheetRows(cfg) {
  const byId = new Map()
  const tabSummary = []
  for (const tab of cfg.tabs) {
    const widest = Math.max(
      cfg.idColumn,
      cfg.statusColumn,
      cfg.qtyColumn ?? 0,
      cfg.priceColumn ?? 0,
      cfg.locationColumn ?? 0,
      cfg.nameColumn ?? 0,
    )
    const range = `${tab}!A1:${colLetter(widest)}10000`
    let rows
    try {
      rows = await readRange(cfg.spreadsheetId, range)
    } catch (e) {
      if (String(e.message).includes('Unable to parse range')) {
        tabSummary.push({ tab, skipped: 'missing tab' })
        continue
      }
      throw e
    }
    let count = 0
    for (let r = 0; r < rows.length; r++) {
      const idCell = rows[r][cfg.idColumn]
      if (idCell == null || idCell === '') continue
      const idStr = String(idCell).trim()
      if (!/^\d+$/.test(idStr)) continue   // skip headers + junk
      // If an id appears in BOTH tabs, the first hit wins (loops in
      // SHEET_TABS order). That mirrors how the forward sync resolves
      // dupes and keeps the audit deterministic.
      if (byId.has(idStr)) continue
      byId.set(idStr, {
        tab,
        sheet_row: r + 1,
        qty: cfg.qtyColumn != null ? Number(rows[r][cfg.qtyColumn]) || 0 : null,
        status: String(rows[r][cfg.statusColumn] || '').trim().toLowerCase() || null,
        price: cfg.priceColumn != null ? parseDollar(rows[r][cfg.priceColumn]) : null,
        location: cfg.locationColumn != null
          ? String(rows[r][cfg.locationColumn] || '').trim() || null
          : null,
        name: cfg.nameColumn != null
          ? String(rows[r][cfg.nameColumn] || '').trim() || null
          : null,
      })
      count++
    }
    tabSummary.push({ tab, rows: count })
  }
  return { byId, tabSummary }
}

// Load every row of singles or slabs from Supabase, grouped by id string.
// For singles, multiple rows can share a tcg_id (sold clones + still in
// inventory + different locations), so we aggregate:
//   db_status        = best status the id has (in_inventory > listed > sold)
//   remaining_qty    = sum(quantity) over non-sold rows ANYWHERE
//   sold_qty         = sum(quantity) over sold rows
//   locations        = Map<location_name, remaining_qty> over non-sold rows
//   row_ids          = every row's id (so the UI can deep-link)
// For slabs, each cert maps to exactly one row + its location.
//
// When locationFilter is supplied, remaining_qty and sold_qty are computed
// against rows whose location_id matches that filter only — the rest of
// the comparator then naturally sees "qty at this location" as the truth.
async function loadDbRows(supabase, cfg, { locationFilterId = null } = {}) {
  const byId = new Map()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const cols = [
      'id', cfg.idAttr, 'status', 'location_id',
      'location:locations(id,name)',
      cfg.qtyAttr ? cfg.qtyAttr : null,
      cfg.priceAttr ? cfg.priceAttr : null,
      cfg.nameAttr ? cfg.nameAttr : null,
    ].filter(Boolean).join(',')
    let q = supabase
      .from(cfg.table)
      .select(cols)
      .eq('deleted', false)
      .not(cfg.idAttr, 'is', null)
      .range(offset, offset + pageSize - 1)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const idStr = String(row[cfg.idAttr] || '').trim()
      if (!idStr) continue
      const entry = byId.get(idStr) || {
        row_ids: [],
        statuses: new Set(),
        remaining_qty: 0,
        sold_qty: 0,
        prices: [],
        locations: new Map(),     // location_name → remaining qty
        locations_filtered: new Map(),  // same but only at locationFilterId
      }
      entry.row_ids.push(row.id)
      entry.statuses.add(row.status)
      const qty = cfg.qtyAttr ? Number(row[cfg.qtyAttr]) || 0 : 1
      const locName = row.location?.name || null
      const isFiltered = locationFilterId && row.location_id === locationFilterId
      if (row.status === 'sold') {
        entry.sold_qty += qty
      } else {
        entry.remaining_qty += qty
        if (locName) entry.locations.set(locName, (entry.locations.get(locName) || 0) + qty)
        if (isFiltered) entry.locations_filtered.set(locName, (entry.locations_filtered.get(locName) || 0) + qty)
      }
      if (cfg.priceAttr && row[cfg.priceAttr] != null) entry.prices.push(Number(row[cfg.priceAttr]))
      if (cfg.nameAttr && row[cfg.nameAttr] && !entry.app_name) entry.app_name = row[cfg.nameAttr]
      byId.set(idStr, entry)
    }
    if (data.length < pageSize) break
    offset += pageSize
  }
  // Derive single best-status + price for the comparator. "Best" = the
  // most in-stock signal we have for this id.
  const out = new Map()
  for (const [id, e] of byId) {
    const best = e.statuses.has('in_inventory') ? 'in_inventory'
               : e.statuses.has('listed') ? 'listed'
               : e.statuses.has('sold') ? 'sold' : Array.from(e.statuses)[0] || null
    // Convert locations Map → ordered array (largest qty first) for
    // the JSON response.
    const locationsArr = [...e.locations.entries()]
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
    out.set(id, {
      row_ids: e.row_ids,
      status: best,
      remaining_qty: e.remaining_qty,
      sold_qty: e.sold_qty,
      price: e.prices.length ? e.prices.reduce((a, b) => a + b, 0) / e.prices.length : null,
      locations: locationsArr,
      app_name: e.app_name || null,
      // When a location filter was applied, qty_at_filter = sum at that
      // specific location only (0 if the card isn't there).
      qty_at_filter: locationFilterId
        ? [...e.locations_filtered.values()].reduce((a, b) => a + b, 0)
        : null,
    })
  }
  return out
}

// Compare a single id's sheet state + db state → list of human-readable
// issues. Returns [] when everything matches. Each issue has:
//   { code, severity, message, suggested_action }
// `code` is a stable key so the UI can group / filter; `severity` is one
// of 'critical' | 'warning' | 'info'.
//
// locationFilter (optional, singles only) = { name } of the location the
// audit is scoped to. When set:
//   - qty checks use db.qty_at_filter (qty at THAT location only) instead
//     of db.remaining_qty (total across all locations)
//   - location_mismatch only fires when the sheet says a different
//     location than the filter
function compareOne(id, sheet, db, kind, locationFilter = null) {
  const issues = []
  const PRICE_TOL = 0.10   // 10¢ slack on price mismatches before flagging

  if (!sheet && !db) return issues   // shouldn't happen
  if (!sheet && db) {
    issues.push({
      code: 'missing_in_sheet',
      severity: 'warning',
      message: `${id} is in the app but not in the sheet. (Added in-app and never synced from the sheet — that's normal for in-app intakes.)`,
    })
    return issues
  }
  if (sheet && !db) {
    issues.push({
      code: 'missing_in_db',
      severity: 'critical',
      message: `${id} is in the sheet but not in the app. Was the row deleted, or has the hourly sync not run yet?`,
    })
    return issues
  }

  // Both sides have the id — compare details.
  if (kind === 'single') {
    // When a location filter is in play, audit against that location's qty.
    // Otherwise fall back to the global remaining qty (legacy behavior).
    const dbQty = locationFilter ? db.qty_at_filter : db.remaining_qty

    if (dbQty === 0 && db.remaining_qty === 0 && sheet.status !== 'sold') {
      issues.push({
        code: 'sold_but_sheet_shows_available',
        severity: 'critical',
        message: `All units sold in the app (qty 0) but sheet status is "${sheet.status || 'blank'}". Sheet should say "sold".`,
        suggested_action: 'push_sold_to_sheet',
      })
    } else if (locationFilter && dbQty === 0 && db.remaining_qty > 0) {
      // Card is in app inventory but NOT at the filtered location — its
      // location is wrong (or it's at a different room).
      const elsewhere = db.locations.map(l => `${l.qty} at ${l.name}`).join(', ')
      issues.push({
        code: 'not_at_this_location',
        severity: 'warning',
        message: `${id} isn't at "${locationFilter.name}" in the app — currently held ${elsewhere || 'nowhere live'}. (Sheet may be out of date or the card was moved.)`,
      })
    } else if (db.remaining_qty > 0 && sheet.status === 'sold') {
      issues.push({
        code: 'sheet_says_sold_but_inventory_remains',
        severity: 'critical',
        message: `Sheet says "sold" but app still has ${db.remaining_qty} unit${db.remaining_qty === 1 ? '' : 's'} in inventory. The sheet may have been manually marked sold or the app row is stale.`,
      })
    } else if (dbQty > 0 && sheet.qty != null && sheet.qty !== dbQty) {
      const scope = locationFilter ? ` at ${locationFilter.name}` : ''
      issues.push({
        code: locationFilter ? 'qty_mismatch_at_location' : 'qty_mismatch',
        severity: 'warning',
        message: `Sheet shows qty=${sheet.qty}, app has ${dbQty}${scope}${db.sold_qty > 0 ? ` (${db.sold_qty} already sold)` : ''}. Sheet should show ${dbQty}.`,
        suggested_action: 'push_qty_to_sheet',
      })
    }

    // Location-column comparison (only when the sheet has filled in col G).
    if (sheet.location) {
      if (locationFilter) {
        if (!locationsMatch(sheet.location, locationFilter.name)) {
          issues.push({
            code: 'location_mismatch',
            severity: 'warning',
            message: `Sheet's Location says "${sheet.location}" but you're auditing "${locationFilter.name}". (Pick the right location or update the sheet.)`,
          })
        }
      } else {
        // No filter — compare sheet's location against where DB actually
        // holds the card.
        const dbLocs = db.locations.map(l => l.name)
        if (dbLocs.length > 0 && !dbLocs.some(n => locationsMatch(sheet.location, n))) {
          issues.push({
            code: 'location_mismatch',
            severity: 'warning',
            message: `Sheet's Location says "${sheet.location}" but app holds ${db.remaining_qty} at ${dbLocs.join(', ')}.`,
          })
        }
      }
    } else if (db.remaining_qty > 0 && db.locations.length > 0) {
      // Sheet location is blank but DB knows where the card is — surface
      // as info so staff can fill it in.
      // (Skip when location filter is active and qty at filter > 0 — UX
      // gets noisy and the card IS where you expected.)
      if (!locationFilter || db.qty_at_filter === 0) {
        const where = db.locations.map(l => `${l.qty} at ${l.name}`).join(', ')
        issues.push({
          code: 'location_missing_in_sheet',
          severity: 'info',
          message: `Sheet's Location column is blank for ${id}; app holds ${where}.`,
        })
      }
    }
  } else {
    // Slabs — unique items, no qty.
    if (db.status === 'sold' && sheet.status !== 'sold') {
      issues.push({
        code: 'sold_but_sheet_shows_available',
        severity: 'critical',
        message: `Slab sold in the app but sheet status is "${sheet.status || 'blank'}". Sheet should say "sold".`,
        suggested_action: 'push_sold_to_sheet',
      })
    } else if (db.status !== 'sold' && sheet.status === 'sold') {
      issues.push({
        code: 'sheet_says_sold_but_app_says_available',
        severity: 'critical',
        message: `Sheet says "sold" but app still has the slab as "${db.status}". The sheet may have been manually marked sold while the app row didn't keep up.`,
      })
    }
    // Name-integrity check (2026-06-09 incident: legacy Mystery Game
    // attached wrong card names to certs and nothing caught it until a
    // sold listing was eyeballed). Skip placeholders — those are tracked
    // by the sync's name-healing, not a corruption signal.
    if (db.app_name && sheet.name
        && !/^\(unnamed slab/.test(db.app_name)
        && nameOverlap(db.app_name, sheet.name) < 0.5) {
      issues.push({
        code: 'name_mismatch',
        severity: 'warning',
        message: `App calls cert ${id} "${db.app_name}" but the sheet says "${sheet.name}". One of them is wrong (bad intake?) — verify the physical slab, then correct whichever side is off.`,
      })
    }
  }

  // Optional price-mismatch hint — low severity since prices change all day.
  if (sheet?.price != null && db?.price != null) {
    const delta = Math.abs(sheet.price - db.price)
    if (delta > PRICE_TOL) {
      issues.push({
        code: 'price_mismatch',
        severity: 'info',
        message: `Price differs by $${delta.toFixed(2)} (sheet $${sheet.price.toFixed(2)} vs app $${db.price.toFixed(2)}). Hourly sync should catch this.`,
      })
    }
  }
  return issues
}

export default async function handler(req, res) {
  const q = req.query || req.body || {}
  const { kind, mode, id, location } = q
  const cfg = SHEET_CONFIG[kind]
  if (!cfg) return res.status(400).json({ error: `unknown kind: ${kind}` })
  if (!['scan', 'full'].includes(mode)) {
    return res.status(400).json({ error: `mode must be "scan" or "full"` })
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON env not set' })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  // Resolve location name → location_id (only meaningful for singles —
  // slabs don't currently audit by location). null when no filter.
  let locationFilter = null
  if (location && kind === 'single') {
    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .select('id, name')
      .eq('name', location)
      .maybeSingle()
    if (locErr) throw locErr
    if (!loc) return res.status(400).json({ error: `Unknown location: "${location}"` })
    locationFilter = loc
  }

  try {
    if (mode === 'scan') {
      const idStr = String(id || '').trim()
      if (!idStr) return res.status(400).json({ error: 'id required' })

      // Look up DB rows for this id only, joining location for context.
      const cols = [
        'id', cfg.idAttr, 'status', 'location_id',
        'location:locations(id,name)',
        cfg.qtyAttr ? cfg.qtyAttr : null,
        cfg.priceAttr ? cfg.priceAttr : null,
        cfg.nameAttr ? cfg.nameAttr : null,
      ].filter(Boolean).join(',')
      const { data: dbRows, error: dbErr } = await supabase
        .from(cfg.table)
        .select(cols)
        .eq(cfg.idAttr, idStr)
        .eq('deleted', false)
      if (dbErr) throw dbErr

      let db = null
      if (dbRows && dbRows.length > 0) {
        const statuses = new Set(dbRows.map(r => r.status))
        let remaining = 0, sold = 0
        let qtyAtFilter = locationFilter ? 0 : null
        const prices = []
        const locations = new Map()
        for (const r of dbRows) {
          const qty = cfg.qtyAttr ? Number(r[cfg.qtyAttr]) || 0 : 1
          if (r.status === 'sold') {
            sold += qty
          } else {
            remaining += qty
            const locName = r.location?.name
            if (locName) locations.set(locName, (locations.get(locName) || 0) + qty)
            if (locationFilter && r.location_id === locationFilter.id) qtyAtFilter += qty
          }
          if (cfg.priceAttr && r[cfg.priceAttr] != null) prices.push(Number(r[cfg.priceAttr]))
        }
        const best = statuses.has('in_inventory') ? 'in_inventory'
                   : statuses.has('listed') ? 'listed'
                   : statuses.has('sold') ? 'sold' : Array.from(statuses)[0] || null
        db = {
          row_ids: dbRows.map(r => r.id),
          status: best,
          remaining_qty: remaining,
          sold_qty: sold,
          price: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
          locations: [...locations.entries()]
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty),
          app_name: cfg.nameAttr ? (dbRows.find(r => r[cfg.nameAttr])?.[cfg.nameAttr] || null) : null,
          qty_at_filter: qtyAtFilter,
        }
      }

      // Find this id in the sheet
      const sheetState = await loadSheetRows(cfg)
      const sheet = sheetState.byId.get(idStr) || null
      const issues = compareOne(idStr, sheet, db, kind, locationFilter)
      return res.status(200).json({
        ok: true, kind, mode: 'scan', id: idStr,
        location_filter: locationFilter,
        sheet, db, issues,
      })
    }

    // mode === 'full'
    const [sheetState, dbMap] = await Promise.all([
      loadSheetRows(cfg),
      loadDbRows(supabase, cfg, { locationFilterId: locationFilter?.id || null }),
    ])
    const allIds = new Set([...sheetState.byId.keys(), ...dbMap.keys()])
    const issues = []
    for (const id of allIds) {
      const sheetForId = sheetState.byId.get(id) || null
      const dbForId = dbMap.get(id) || null
      // When a location filter is set, prune the working set: skip ids
      // whose sheet location AND db location both clearly don't involve
      // this location. (We still surface "not_at_this_location" for ids
      // whose sheet location matches the filter but db doesn't.)
      if (locationFilter) {
        const sheetMatches = sheetForId?.location && locationsMatch(sheetForId.location, locationFilter.name)
        const dbMatches = dbForId && (dbForId.qty_at_filter > 0)
        if (!sheetMatches && !dbMatches) continue
      }
      const issuesForId = compareOne(id, sheetForId, dbForId, kind, locationFilter)
      for (const issue of issuesForId) {
        issues.push({
          id,
          ...issue,
          sheet: sheetForId,
          db: dbForId,
        })
      }
    }

    // Buckets so the UI doesn't have to recompute.
    const byCode = {}
    for (const i of issues) byCode[i.code] = (byCode[i.code] || 0) + 1

    return res.status(200).json({
      ok: true, kind, mode: 'full',
      location_filter: locationFilter,
      summary: {
        total_db_ids: dbMap.size,
        total_sheet_ids: sheetState.byId.size,
        total_issues: issues.length,
        by_code: byCode,
        tabs: sheetState.tabSummary,
      },
      issues,
    })
  } catch (err) {
    console.error('[audit-cards]', kind, mode, err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}

function colLetter(col) {
  let n = col + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
