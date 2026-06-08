// api/expected-at-location.js
// Used by the Cards Audit page's Physical Count mode. Returns the list of
// cards (singles or slabs) that the app database expects to be at a given
// physical location — so staff can scan what's actually there and compare.
//
// Singles get aggregated by tcg_id (a card with qty=5 in one row appears
// once with expected_qty=5; if there are multiple rows at the same
// location for the same tcg_id, qty is summed across them).
// Slabs are unique items — one row per cert.
//
// Also returns a sheet_snapshot map keyed by id. Each entry has the
// sheet's qty / status / location / row / tab for that id, regardless
// of which physical location the sheet thinks it's at. The frontend
// uses this for the 3-way (Physical / App / Sheet) comparison and
// to handle "extras" (cards scanned but app doesn't have here) —
// staff can see at a glance where the sheet thinks it belongs.

import { createClient } from '@supabase/supabase-js'
import { readRange } from './_lib/google-sheets.js'

// Sheet schemas — KEEP IN SYNC with api/audit-cards.js and api/sheet-mark-sold.js.
const SHEET_CONFIG = {
  single: {
    spreadsheetId: '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80',
    tabs: ['Master Singles'],   // boss directive: don't read New Singles for audits
    idColumn: 5,         // F = TCG ID
    qtyColumn: 4,        // E = Qty
    locationColumn: 6,   // G = Location
    statusColumn: 8,     // I = Status
  },
  slab: {
    spreadsheetId: '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI',
    tabs: ['Pokemon Master', 'One Piece Master'],
    idColumn: 0,         // A = Cert
    statusColumn: 11,    // L = Status
  },
}

function colToA1(col) {
  let n = col + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

async function loadSheetSnapshot(cfg) {
  const byId = new Map()
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return byId   // graceful when env not set
  const widest = Math.max(
    cfg.idColumn, cfg.statusColumn,
    cfg.qtyColumn ?? 0, cfg.locationColumn ?? 0,
  )
  for (const tab of cfg.tabs) {
    let rows
    try {
      rows = await readRange(cfg.spreadsheetId, `${tab}!A1:${colToA1(widest)}10000`)
    } catch (e) {
      if (String(e.message).includes('Unable to parse range')) continue
      throw e
    }
    for (let r = 0; r < rows.length; r++) {
      const idCell = rows[r][cfg.idColumn]
      if (idCell == null || idCell === '') continue
      const idStr = String(idCell).trim()
      if (!/^\d+$/.test(idStr)) continue
      if (byId.has(idStr)) continue       // first hit wins (same dedup as audit)
      byId.set(idStr, {
        tab,
        sheet_row: r + 1,
        qty: cfg.qtyColumn != null ? Number(rows[r][cfg.qtyColumn]) || 0 : null,
        status: String(rows[r][cfg.statusColumn] || '').trim().toLowerCase() || null,
        location: cfg.locationColumn != null
          ? String(rows[r][cfg.locationColumn] || '').trim() || null
          : null,
      })
    }
  }
  return byId
}

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  const { kind, location } = req.query || req.body || {}
  if (!kind || !['single', 'slab'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be "single" or "slab"' })
  }
  if (!location) {
    return res.status(400).json({ error: 'location is required' })
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  try {
    // 1. Resolve location name → id
    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .select('id, name')
      .eq('name', location)
      .maybeSingle()
    if (locErr) throw locErr
    if (!loc) return res.status(400).json({ error: `Unknown location: "${location}"` })

    // Pull DB-expected + sheet snapshot in parallel — sheet read is the
    // slower of the two, no point serializing.
    const cfg = SHEET_CONFIG[kind]
    const sheetSnapshotPromise = loadSheetSnapshot(cfg)

    if (kind === 'single') {
      // Pull all live (non-sold) singles at this location
      const { data, error } = await supabase
        .from('singles')
        .select('id, tcg_id, quantity, card_name, card_number, condition')
        .eq('location_id', loc.id)
        .neq('status', 'sold')
        .eq('deleted', false)
        .not('tcg_id', 'is', null)
      if (error) throw error
      const byId = new Map()
      for (const r of data || []) {
        const id = String(r.tcg_id).trim()
        if (!id) continue
        const cur = byId.get(id) || {
          id, expected_qty: 0, db_row_ids: [],
          card_name: r.card_name || null,
          card_number: r.card_number || null,
          condition: r.condition || null,
        }
        cur.expected_qty += Number(r.quantity) || 0
        cur.db_row_ids.push(r.id)
        byId.set(id, cur)
      }
      const sheetSnapshot = await sheetSnapshotPromise
      // Attach sheet info to each expected card (null if sheet has no row for it).
      const expected = [...byId.values()]
        .map(e => ({ ...e, sheet: sheetSnapshot.get(e.id) || null }))
        .sort((a, b) => (a.card_name || '').localeCompare(b.card_name || ''))
      const totalUnits = expected.reduce((s, e) => s + e.expected_qty, 0)
      // Convert sheet Map → object so it serializes over the wire.
      const sheet_by_id = Object.fromEntries(sheetSnapshot)
      return res.status(200).json({
        ok: true, kind, location: loc,
        expected,
        sheet_by_id,
        summary: {
          unique_ids: expected.length,
          total_units: totalUnits,
          sheet_rows: sheetSnapshot.size,
        },
      })
    }

    // slabs — each row is its own item
    const { data, error } = await supabase
      .from('slabs')
      .select('id, cert_number, item_name, grading_company')
      .eq('location_id', loc.id)
      .neq('status', 'sold')
      .eq('deleted', false)
      .not('cert_number', 'is', null)
    if (error) throw error
    const sheetSnapshot = await sheetSnapshotPromise
    const expected = (data || [])
      .map(r => ({
        id: String(r.cert_number).trim(),
        expected_qty: 1,
        db_row_ids: [r.id],
        item_name: r.item_name || null,
        grading_company: r.grading_company || null,
        sheet: sheetSnapshot.get(String(r.cert_number).trim()) || null,
      }))
      .filter(e => e.id)
      .sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''))
    const sheet_by_id = Object.fromEntries(sheetSnapshot)
    return res.status(200).json({
      ok: true, kind, location: loc,
      expected,
      sheet_by_id,
      summary: {
        unique_ids: expected.length,
        total_units: expected.length,
        sheet_rows: sheetSnapshot.size,
      },
    })
  } catch (err) {
    console.error('[expected-at-location]', kind, location, err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
