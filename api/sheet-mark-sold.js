// api/sheet-mark-sold.js
// Pushes the app's current truth for one single / slab back to its row
// in the Google Sheet. Two callers:
//   1. markSingleAsSold / markSlabAsSold (fire-and-forget right after a
//      sale) — used when status flipped to 'sold'. We push 'sold'.
//   2. Cards Audit "Push to sheet" buttons — used when the staff member
//      wants to sync any kind of stale sheet value: qty mismatch, sold
//      not-yet-pushed, etc. The status can be 'sold' OR 'in_inventory'
//      OR 'listed' depending on the situation.
//
// What we actually write is decided by the app's state, not the caller:
//   - If app's TOTAL non-sold qty for this tcg/cert is 0 → write 'sold'
//     to the Status column (singles also write 0 to Qty).
//   - If app's total non-sold qty > 0 → write that number to the Qty
//     column. Status column is NOT touched.
//   - Slabs (no qty) → write 'sold' whenever the row's status='sold'.
//
// Trust model: the endpoint is reachable from the browser (no auth
// header). To stop a malicious caller from corrupting random sheet
// rows, we look the row up in Supabase first and confirm its status
// is one of the known LIVE states (sold / in_inventory / listed). Any
// other status → 409 unknown_status. Worst case for an unauthenticated
// call: a single sheet-row update reflecting the app's actual data.
//
// The endpoint is idempotent — if the sheet already shows the value
// we'd write, we no-op. So repeated calls (retries, the hourly
// safety-net racing the on-sale call, the audit racing both) are safe.

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
// Verified against live sheet headers via service account read on
// 2026-06-04 (re-confirmed when title row added to Master Singles):
// - Singles (id 14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80):
//     Row 1 = header on both tabs:
//       A=Name B=Set C=Market$ D=Prices E=Qty F=TCG ID G=Location H=Date I=Status
//     idColumn=5 (F=TCG ID), qtyColumn=4 (E=Qty), statusColumn=8 (I=Status).
//     Singles can have quantity > 1 (e.g. "5 copies of card X"). When we
//     sell ONE of those 5, the sheet shouldn't go straight to 'sold' —
//     it should reflect the remaining count. Only when remaining hits 0
//     do we flip Status to 'sold'.
// - Slabs (id 1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI):
//     Pokemon Master + One Piece Master both have Status in col L (idx 11).
//     Slabs are unique items (qty always 1), so no qtyColumn — selling a
//     slab always flips Status. Other tabs (OP NEW, New Input, Highend)
//     skipped per boss directive.
const SHEET_CONFIG = {
  single: {
    spreadsheetId: '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80',
    tabs: ['Master Singles', 'New Singles '],
    idColumn: 5,
    idAttr: 'tcg_id',
    qtyColumn: 4,        // E — for qty>1 cards we decrement this instead of writing 'sold'
    statusColumn: 8,
  },
  slab: {
    spreadsheetId: '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI',
    tabs: ['Pokemon Master', 'One Piece Master'],
    idColumn: 0,
    idAttr: 'cert_number',
    statusColumn: 11,
  },
}

export const config = { maxDuration: 15 }

// Every response body uses this shape so the caller (and the Vercel
// function logs) always sees plain English plus a structured trace for
// debugging. `outcome` is one of:
//   marked_sold       — wrote 'sold' to the sheet (the happy path)
//   already_sold      — sheet already said sold; nothing to write
//   not_in_sheet      — id exists in DB-as-sold but isn't in any sheet tab
//   not_yet_sold      — caller asked us but DB still says in_inventory
//   not_in_db         — no row with that id in singles/slabs
//   missing_identity  — DB row has no tcg/cert (can't locate in sheet)
//   bad_request       — caller sent invalid body
//   not_configured    — server missing GOOGLE_SERVICE_ACCOUNT_JSON or supabase key
//   server_error      — unexpected throw
//
// HTTP status:
//   200  for marked_sold / already_sold (work succeeded or was a no-op)
//   200  for not_in_sheet too (common when card was added in-app and
//        never had a sheet row — caller shouldn't treat this as an error)
//   400  bad_request
//   404  not_in_db
//   409  not_yet_sold
//   422  missing_identity
//   500  server_error / not_configured
//
// The fire-and-forget caller in src/lib/supabase.js reads `outcome` and
// `message` and logs a one-line console summary — no more mystery 404s.
function respond(res, status, outcome, message, trace) {
  const body = {
    ok: status < 400,
    outcome,
    message,
    trace: { at: new Date().toISOString(), ...trace },
  }
  // Console line gets picked up by Vercel function logs (the right place
  // to look when something silently fails in prod). Tagged so it's
  // greppable across functions.
  const lvl = status < 400
    ? (outcome === 'marked_sold' ? 'log' : 'log')
    : (status >= 500 ? 'error' : 'warn')
  console[lvl](`[sheet-mark-sold] ${outcome}: ${message}`, trace)
  return res.status(status).json(body)
}

const kindNoun = (k) => k === 'single' ? 'Single' : 'Slab'
const idLabel  = (k) => k === 'single' ? 'TCG ID' : 'Cert #'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return respond(res, 405, 'bad_request',
      `Only POST is supported here (got ${req.method}).`, { method: req.method })
  }
  const { kind, id } = (req.body && typeof req.body === 'object') ? req.body : {}
  const cfg = SHEET_CONFIG[kind]
  if (!cfg) {
    return respond(res, 400, 'bad_request',
      `Don't know how to handle kind="${kind}" — expected "single" or "slab".`,
      { kind, id })
  }
  if (!id) {
    return respond(res, 400, 'bad_request',
      `Missing "id" in request body — the supabase row id is required.`,
      { kind })
  }

  if (!SUPABASE_KEY) {
    return respond(res, 500, 'not_configured',
      `Server is missing the Supabase service-role key, so I can't verify the sale before writing to the sheet.`,
      { kind, id })
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return respond(res, 500, 'not_configured',
      `Server is missing GOOGLE_SERVICE_ACCOUNT_JSON env var — Google Sheets API isn't reachable yet. Add the service account JSON in Vercel env vars.`,
      { kind, id })
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
    if (!data) {
      return respond(res, 404, 'not_in_db',
        `No ${kindNoun(kind).toLowerCase()} with database id ${id} exists in Supabase. (Was the row deleted? Or was the id mistyped?)`,
        { kind, db_id: id })
    }
    // Accept any LIVE status — the endpoint syncs the app's current
    // truth to the sheet, whether that truth is "sold" or "still in
    // inventory at qty N". The post-sale flow uses status='sold' and
    // results in 'sold' being written; the audit's "Push to sheet"
    // button uses status='in_inventory'/'listed' and results in the
    // correct qty being written (computed below). Refuse only on
    // statuses we don't understand so a typo can't corrupt the sheet.
    const LIVE_STATUSES = new Set(['sold', 'in_inventory', 'listed'])
    if (!LIVE_STATUSES.has(data.status)) {
      return respond(res, 409, 'unknown_status',
        `Refusing to write: the ${kindNoun(kind).toLowerCase()} in Supabase has status="${data.status}", which isn't one of the known live states (sold / in_inventory / listed). Please investigate the row manually before pushing anything to the sheet.`,
        { kind, db_id: id, db_status: data.status })
    }
    const idValue = String(data[cfg.idAttr] || '').trim()
    if (!idValue) {
      return respond(res, 422, 'missing_identity',
        `${kindNoun(kind)} ${id} (status="${data.status}") has no ${idLabel(kind)} on it, so I can't find its row in the sheet. (Edit the row in the app and add its ${idLabel(kind)}, then we'll catch it on the next hourly sync.)`,
        { kind, db_id: id, db_status: data.status })
    }

    // For singles: sum remaining (non-sold) quantity for this TCG ID.
    // Even though the specific db row we're called for is sold, OTHER rows
    // with the same tcg_id might still be in_inventory (e.g. user had
    // qty=5, sold 1 → original row qty=4 in_inventory + sold clone qty=1).
    // The sheet should reflect the remaining count, not flip to 'sold',
    // until every unit is gone. Slabs don't have this case — they're
    // unique items (qty always 1) so a sold slab is just sold.
    let remainingQty = 0
    if (cfg.qtyColumn != null) {
      const { data: liveRows, error: liveErr } = await supabase
        .from('singles')
        .select('quantity')
        .eq('tcg_id', idValue)
        .neq('status', 'sold')
        .eq('deleted', false)
      if (liveErr) throw liveErr
      remainingQty = (liveRows || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0)
    }

    // 2. For each tab in the sheet, read the id column and find the row
    //    that matches. Most-recently-edited tab wins (we just take the
    //    first hit). Singles can appear in either Master Singles OR
    //    New Singles, slabs in any of the three tabs — search all.
    let found = null   // { tab, rowIndex (0-based), currentStatus }
    const tabsScanned = []
    for (const tab of cfg.tabs) {
      // Pull the id column + status column together so we can decide
      // whether to write OR no-op (idempotent).
      const range = `${tab}!A1:${maxCol(cfg.statusColumn)}5000`
      let rows
      try {
        rows = await readRange(cfg.spreadsheetId, range)
      } catch (e) {
        // A missing tab returns 400 — note + skip.
        if (String(e.message).includes('Unable to parse range')) {
          tabsScanned.push({ tab, skipped: 'tab missing' })
          continue
        }
        throw e
      }
      tabsScanned.push({ tab, rows: rows.length })
      // Match by exact string compare on the id column.
      for (let r = 0; r < rows.length; r++) {
        const cell = rows[r][cfg.idColumn]
        if (cell == null) continue
        if (String(cell).trim() !== idValue) continue
        const currentStatus = rows[r][cfg.statusColumn]
        const currentQty = cfg.qtyColumn != null ? rows[r][cfg.qtyColumn] : null
        found = { tab, rowIndex: r, currentStatus, currentQty }
        break
      }
      if (found) break
    }

    if (!found) {
      // Treated as a 200 (not 4xx) because this is a normal, expected
      // case — a card added directly in-app without ever going through
      // the sheet. We don't want the caller treating it as a failure.
      return respond(res, 200, 'not_in_sheet',
        `${kindNoun(kind)} with ${idLabel(kind)} ${idValue} is sold in the app but no matching row exists in the ${kindNoun(kind).toLowerCase()}s sheet. (That's normal if the ${kindNoun(kind).toLowerCase()} was added in-app and never synced from the sheet — no sheet update needed.)`,
        { kind, db_id: id, id_value: idValue, tabs_scanned: tabsScanned })
    }

    const statusCell = cellA1(found.tab, found.rowIndex, cfg.statusColumn)
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/edit#range=${encodeURIComponent(statusCell)}`
    const sheetStatusLower = String(found.currentStatus || '').trim().toLowerCase()
    const sheetQty = Number(found.currentQty) || 0

    // ─── Singles with qty support ────────────────────────────────────
    // If at least one unit still remains in inventory after this sale,
    // we DON'T flip the row to 'sold' — we update the qty column.
    // Only when remaining hits 0 does Status get 'sold'.
    if (cfg.qtyColumn != null) {
      const qtyCell = cellA1(found.tab, found.rowIndex, cfg.qtyColumn)

      if (remainingQty > 0) {
        // Some units still in inventory — sync qty (not status).
        if (sheetQty === remainingQty) {
          return respond(res, 200, 'qty_already_correct',
            `${kindNoun(kind)} ${idLabel(kind)} ${idValue}: sheet already shows qty=${remainingQty} in ${found.tab} row ${found.rowIndex + 1}. Nothing to write.`,
            {
              kind, db_id: id, id_value: idValue,
              sheet_tab: found.tab, sheet_row: found.rowIndex + 1,
              sheet_cell: qtyCell, sheet_url: sheetUrl,
              remaining_qty: remainingQty, sheet_qty: sheetQty,
            })
        }
        const result = await batchUpdateValues(cfg.spreadsheetId, [
          { range: qtyCell, values: [[remainingQty]] },
        ])
        return respond(res, 200, 'qty_decremented',
          `Updated qty ${sheetQty} → ${remainingQty} for ${kindNoun(kind).toLowerCase()} ${idLabel(kind)} ${idValue} in ${found.tab} cell ${qtyCell.split('!')[1]}. (Status left alone — there are still units in inventory.)`,
          {
            kind, db_id: id, id_value: idValue,
            sheet_tab: found.tab, sheet_row: found.rowIndex + 1,
            sheet_cell: qtyCell, sheet_url: sheetUrl,
            qty_before: sheetQty, qty_after: remainingQty,
            cells_updated: result.totalUpdatedCells ?? result.updatedCells ?? 1,
          })
      }

      // remainingQty === 0 — write 'sold' to Status (and zero qty too if it isn't already).
      if (sheetStatusLower === 'sold') {
        return respond(res, 200, 'already_sold',
          `Sheet row for ${kindNoun(kind).toLowerCase()} ${idLabel(kind)} ${idValue} already says "sold" in ${found.tab} row ${found.rowIndex + 1} (all units gone). Nothing to write.`,
          {
            kind, db_id: id, id_value: idValue,
            sheet_tab: found.tab, sheet_row: found.rowIndex + 1,
            sheet_cell: statusCell, sheet_url: sheetUrl,
            remaining_qty: 0,
          })
      }
      const updates = [{ range: statusCell, values: [['sold']] }]
      if (sheetQty !== 0) updates.push({ range: qtyCell, values: [[0]] })
      const result = await batchUpdateValues(cfg.spreadsheetId, updates)
      return respond(res, 200, 'marked_sold',
        `All units sold — wrote "sold" to Status (and qty → 0) for ${kindNoun(kind).toLowerCase()} ${idLabel(kind)} ${idValue} in ${found.tab} row ${found.rowIndex + 1}.`,
        {
          kind, db_id: id, id_value: idValue,
          sheet_tab: found.tab, sheet_row: found.rowIndex + 1,
          sheet_cell: statusCell, sheet_url: sheetUrl,
          remaining_qty: 0,
          cells_updated: result.totalUpdatedCells ?? result.updatedCells ?? updates.length,
        })
    }

    // ─── Slabs (no qty — always mark sold) ───────────────────────────
    if (sheetStatusLower === 'sold') {
      return respond(res, 200, 'already_sold',
        `Sheet row for slab ${idLabel(kind)} ${idValue} already says "sold" in ${found.tab} row ${found.rowIndex + 1}. Nothing to write.`,
        {
          kind, db_id: id, id_value: idValue,
          sheet_tab: found.tab, sheet_row: found.rowIndex + 1,
          sheet_cell: statusCell, sheet_url: sheetUrl,
        })
    }
    const result = await batchUpdateValues(cfg.spreadsheetId, [
      { range: statusCell, values: [['sold']] },
    ])
    return respond(res, 200, 'marked_sold',
      `Wrote "sold" to slab ${idLabel(kind)} ${idValue} → ${found.tab} cell ${statusCell.split('!')[1]}.`,
      {
        kind, db_id: id, id_value: idValue,
        sheet_tab: found.tab, sheet_row: found.rowIndex + 1,
        sheet_cell: statusCell, sheet_url: sheetUrl,
        cells_updated: result.totalUpdatedCells ?? result.updatedCells ?? 1,
      })
  } catch (err) {
    return respond(res, 500, 'server_error',
      `Something threw on the server: ${err.message || String(err)}. Check Vercel function logs for the stack.`,
      { kind, db_id: id, error: err.message || String(err) })
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
