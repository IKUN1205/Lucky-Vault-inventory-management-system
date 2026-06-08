// api/sheet-mark-sold.js
// Called fire-and-forget from markSingleAsSold / markSlabAsSold (the
// frontend) every time a single or slab flips status to 'sold'. We push
// the new status back to the Google Sheet so the next time staff or boss
// looks at the sheet they see reality, not a graveyard of "available" rows
// that are actually sold.
//
// Trust model: the endpoint is reachable from the browser (the frontend
// fires it without an auth header). To prevent a malicious caller from
// marking unrelated rows as sold, we re-verify in Supabase that the
// referenced single/slab really IS sold before writing anything to the
// sheet. Worst case for an unauthenticated call: a single API round-trip
// per item that's already legitimately sold.
//
// The endpoint is idempotent — if the sheet row already shows "sold",
// we no-op. So repeated calls (e.g. retries, racing with the hourly
// safety-net sync) are safe.

import { createClient } from '@supabase/supabase-js'
import { readRange, batchUpdateValues, cellA1 } from './_lib/google-sheets.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

// Sheet schemas. Keep in sync with api/sync-*-sheet.js. Status column
// index = where we WRITE "sold". ID column = which column to scan for
// the cert / tcg id when locating the row.
//
// Singles sheet (id 14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80):
//   col 5 = TCG ID; col 11 = Status (matches the slabs layout).
// Slabs sheet (id 1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI):
//   col 0 = Cert; col 11 = Status.
//
// If a tab's actual Status column moves, change it here — the rest of
// the file uses cellA1() so the A1 letters auto-adjust.
const SHEET_CONFIG = {
  single: {
    spreadsheetId: '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80',
    tabs: ['Master Singles', 'New Singles '],
    idColumn: 5,
    idAttr: 'tcg_id',
    statusColumn: 11,
  },
  slab: {
    spreadsheetId: '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI',
    tabs: ['Pokemon Master', 'One Piece Master', 'New Slabs'],
    idColumn: 0,
    idAttr: 'cert_number',
    statusColumn: 11,
  },
}

export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const { kind, id } = (req.body && typeof req.body === 'object') ? req.body : {}
  const cfg = SHEET_CONFIG[kind]
  if (!cfg) return res.status(400).json({ error: `unknown kind: ${kind}` })
  if (!id) return res.status(400).json({ error: 'id required' })

  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  try {
    // 1. Re-verify in Supabase that this item is REALLY sold. If a random
    //    caller hits us with a fake id we don't want to write the sheet.
    const table = kind === 'single' ? 'singles' : 'slabs'
    const { data, error } = await supabase
      .from(table)
      .select(`id, status, ${cfg.idAttr}`)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: `${kind} ${id} not found` })
    if (data.status !== 'sold') {
      return res.status(409).json({
        error: `${kind} is not sold (status=${data.status}) — refusing to write`,
      })
    }
    const idValue = String(data[cfg.idAttr] || '').trim()
    if (!idValue) {
      return res.status(422).json({ error: `${kind} has no ${cfg.idAttr}, can't locate in sheet` })
    }

    // 2. For each tab in the sheet, read the id column and find the row
    //    that matches. Most-recently-edited tab wins (we just take the
    //    first hit). Singles can appear in either Master Singles OR
    //    New Singles, slabs in any of the three tabs — search all.
    let found = null   // { tab, rowIndex (0-based), currentStatus }
    for (const tab of cfg.tabs) {
      // Pull the id column + status column together so we can decide
      // whether to write OR no-op (idempotent).
      const idCol = colLetter(cfg.idColumn)
      const statusCol = colLetter(cfg.statusColumn)
      // Read both columns as separate ranges in one round-trip via the
      // values:batchGet endpoint would be nicer, but a single read of
      // A:Z is simpler and still cheap on these sheets (< 1000 rows).
      const range = `${tab}!A1:${maxCol(cfg.statusColumn)}5000`
      let rows
      try {
        rows = await readRange(cfg.spreadsheetId, range)
      } catch (e) {
        // A missing tab returns 400 — skip it.
        if (String(e.message).includes('Unable to parse range')) continue
        throw e
      }
      // Skip header row(s) — match by exact string compare on the id.
      // Row index from the API is 0-based for our `rows` array, so
      // rowIndex 0 = sheet row 1.
      for (let r = 0; r < rows.length; r++) {
        const cell = rows[r][cfg.idColumn]
        if (cell == null) continue
        if (String(cell).trim() !== idValue) continue
        const currentStatus = rows[r][cfg.statusColumn]
        found = { tab, rowIndex: r, currentStatus }
        break
      }
      if (found) break
    }

    if (!found) {
      return res.status(404).json({
        error: `${cfg.idAttr}=${idValue} not found in any ${kind} sheet tab`,
      })
    }

    // 3. Idempotent: if the sheet already says "sold", nothing to do.
    if (String(found.currentStatus || '').trim().toLowerCase() === 'sold') {
      return res.status(200).json({ ok: true, noop: true, tab: found.tab, row: found.rowIndex + 1 })
    }

    // 4. Write "sold" to the Status cell on that row.
    const targetCell = cellA1(found.tab, found.rowIndex, cfg.statusColumn)
    const result = await batchUpdateValues(cfg.spreadsheetId, [
      { range: targetCell, values: [['sold']] },
    ])

    return res.status(200).json({
      ok: true,
      kind,
      idAttr: cfg.idAttr,
      idValue,
      tab: found.tab,
      sheet_row: found.rowIndex + 1,
      updatedCells: result.totalUpdatedCells ?? result.updatedCells ?? 1,
    })
  } catch (err) {
    console.error('[sheet-mark-sold]', kind, id, err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}

// Helpers — kept local because they're trivial. cellA1() handles the
// proper "Tab Name!B5" format; these two just give us the A1 letter
// shorthands for building the range string.
function colLetter(col) {
  let n = col + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
function maxCol(col) {
  // Read at least up to the status column so the response includes it.
  return colLetter(Math.max(col, 11))
}
