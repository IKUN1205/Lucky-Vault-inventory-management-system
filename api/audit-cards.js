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
    tabs: ['Master Singles', 'New Singles '],
    idColumn: 5,         // F = TCG ID
    qtyColumn: 4,        // E = Qty
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
    statusColumn: 11,    // L = Status
    // Slabs have no qty (always 1) — set to null below in the scan call
    // so the comparator skips it cleanly.
    table: 'slabs',
    idAttr: 'cert_number',
  },
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
// string → { tab, rowIndex (1-based for display), qty, status, price }.
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
      })
      count++
    }
    tabSummary.push({ tab, rows: count })
  }
  return { byId, tabSummary }
}

// Load every row of singles or slabs from Supabase, grouped by id string.
// For singles, multiple rows can share a tcg_id (sold clones + still in
// inventory), so we aggregate:
//   db_status     = best status the id has (in_inventory > listed > sold)
//   remaining_qty = sum(quantity) over non-sold rows
//   sold_qty      = sum(quantity) over sold rows
//   row_ids       = every row's id (so the UI can deep-link)
// For slabs, each cert maps to exactly one row.
async function loadDbRows(supabase, cfg) {
  const byId = new Map()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const cols = [
      'id', cfg.idAttr, 'status',
      cfg.qtyAttr ? cfg.qtyAttr : null,
      cfg.priceAttr ? cfg.priceAttr : null,
    ].filter(Boolean).join(',')
    const { data, error } = await supabase
      .from(cfg.table)
      .select(cols)
      .eq('deleted', false)
      .not(cfg.idAttr, 'is', null)
      .range(offset, offset + pageSize - 1)
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
      }
      entry.row_ids.push(row.id)
      entry.statuses.add(row.status)
      const qty = cfg.qtyAttr ? Number(row[cfg.qtyAttr]) || 0 : 1
      if (row.status === 'sold') entry.sold_qty += qty
      else entry.remaining_qty += qty
      if (cfg.priceAttr && row[cfg.priceAttr] != null) entry.prices.push(Number(row[cfg.priceAttr]))
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
    out.set(id, {
      row_ids: e.row_ids,
      status: best,
      remaining_qty: e.remaining_qty,
      sold_qty: e.sold_qty,
      price: e.prices.length ? e.prices.reduce((a, b) => a + b, 0) / e.prices.length : null,
    })
  }
  return out
}

// Compare a single id's sheet state + db state → list of human-readable
// issues. Returns [] when everything matches. Each issue has:
//   { code, severity, message, suggested_action }
// `code` is a stable key so the UI can group / filter; `severity` is one
// of 'critical' | 'warning' | 'info'.
function compareOne(id, sheet, db, kind) {
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
    if (db.remaining_qty === 0 && sheet.status !== 'sold') {
      issues.push({
        code: 'sold_but_sheet_shows_available',
        severity: 'critical',
        message: `All units sold in the app (qty 0) but sheet status is "${sheet.status || 'blank'}". Sheet should say "sold".`,
        suggested_action: 'push_sold_to_sheet',
      })
    } else if (db.remaining_qty > 0 && sheet.status === 'sold') {
      issues.push({
        code: 'sheet_says_sold_but_inventory_remains',
        severity: 'critical',
        message: `Sheet says "sold" but app still has ${db.remaining_qty} unit${db.remaining_qty === 1 ? '' : 's'} in inventory. The sheet may have been manually marked sold or the app row is stale.`,
      })
    } else if (db.remaining_qty > 0 && sheet.qty != null && sheet.qty !== db.remaining_qty) {
      issues.push({
        code: 'qty_mismatch',
        severity: 'warning',
        message: `Sheet shows qty=${sheet.qty}, app has ${db.remaining_qty} in inventory${db.sold_qty > 0 ? ` (${db.sold_qty} already sold)` : ''}. Sheet should show ${db.remaining_qty}.`,
        suggested_action: 'push_qty_to_sheet',
      })
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
  const { kind, mode, id } = req.query || req.body || {}
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

  try {
    if (mode === 'scan') {
      const idStr = String(id || '').trim()
      if (!idStr) return res.status(400).json({ error: 'id required' })

      // Look up DB rows for this id only
      const cols = [
        'id', cfg.idAttr, 'status',
        cfg.qtyAttr ? cfg.qtyAttr : null,
        cfg.priceAttr ? cfg.priceAttr : null,
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
        const prices = []
        for (const r of dbRows) {
          const qty = cfg.qtyAttr ? Number(r[cfg.qtyAttr]) || 0 : 1
          if (r.status === 'sold') sold += qty; else remaining += qty
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
        }
      }

      // Find this id in the sheet
      const sheetState = await loadSheetRows(cfg)
      const sheet = sheetState.byId.get(idStr) || null
      const issues = compareOne(idStr, sheet, db, kind)
      return res.status(200).json({
        ok: true, kind, mode: 'scan', id: idStr,
        sheet, db, issues,
      })
    }

    // mode === 'full'
    const [sheetState, dbMap] = await Promise.all([
      loadSheetRows(cfg),
      loadDbRows(supabase, cfg),
    ])
    const allIds = new Set([...sheetState.byId.keys(), ...dbMap.keys()])
    const issues = []
    for (const id of allIds) {
      const issuesForId = compareOne(id, sheetState.byId.get(id) || null, dbMap.get(id) || null, kind)
      for (const issue of issuesForId) {
        issues.push({
          id,
          ...issue,
          sheet: sheetState.byId.get(id) || null,
          db: dbMap.get(id) || null,
        })
      }
    }

    // Buckets so the UI doesn't have to recompute.
    const byCode = {}
    for (const i of issues) byCode[i.code] = (byCode[i.code] || 0) + 1

    return res.status(200).json({
      ok: true, kind, mode: 'full',
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
