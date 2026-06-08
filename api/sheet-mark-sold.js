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
// Verified against live sheet headers via service account read on
// 2026-06-04:
// - Singles (id 14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80):
//     A=Name B=Set C=Market$ D=Prices E=Qty F=TCG ID G=Location H=Date
//     I=Status (added 2026-06-04 by this commit's setup script).
//     idColumn=5 (F=TCG ID), statusColumn=8 (I=Status).
// - Slabs (id 1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI):
//     Pokemon Master + One Piece Master both have Status in col L (idx 11).
//     Other tabs (OP NEW, New Input, Highend) skipped per boss directive —
//     back-sync only touches the two canonical Master tabs.
const SHEET_CONFIG = {
  single: {
    spreadsheetId: '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80',
    tabs: ['Master Singles', 'New Singles '],
    idColumn: 5,
    idAttr: 'tcg_id',
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
    if (data.status !== 'sold') {
      return respond(res, 409, 'not_yet_sold',
        `Refusing to write: the ${kindNoun(kind).toLowerCase()} in Supabase has status="${data.status}", not "sold". The sale didn't actually go through, or it was undone — the sheet stays as-is.`,
        { kind, db_id: id, db_status: data.status })
    }
    const idValue = String(data[cfg.idAttr] || '').trim()
    if (!idValue) {
      return respond(res, 422, 'missing_identity',
        `${kindNoun(kind)} ${id} is sold in Supabase but has no ${idLabel(kind)} on it, so I can't find its row in the sheet. (Edit the row in the app and add its ${idLabel(kind)}, then we'll catch it on the next hourly sync.)`,
        { kind, db_id: id })
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
        found = { tab, rowIndex: r, currentStatus }
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

    const targetCell = cellA1(found.tab, found.rowIndex, cfg.statusColumn)
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/edit#gid=0&range=${encodeURIComponent(targetCell)}`

    // 3. Idempotent: if the sheet already says "sold", nothing to do.
    if (String(found.currentStatus || '').trim().toLowerCase() === 'sold') {
      return respond(res, 200, 'already_sold',
        `Sheet row for ${kindNoun(kind).toLowerCase()} ${idLabel(kind)} ${idValue} already says "sold" in ${found.tab} row ${found.rowIndex + 1}. Nothing to write.`,
        {
          kind, db_id: id, id_value: idValue,
          sheet_tab: found.tab,
          sheet_row: found.rowIndex + 1,
          sheet_cell: targetCell,
          sheet_url: sheetUrl,
        })
    }

    // 4. Write "sold" to the Status cell on that row.
    const result = await batchUpdateValues(cfg.spreadsheetId, [
      { range: targetCell, values: [['sold']] },
    ])

    return respond(res, 200, 'marked_sold',
      `Wrote "sold" to ${kindNoun(kind).toLowerCase()} ${idLabel(kind)} ${idValue} → ${found.tab} cell ${targetCell.split('!')[1]}.`,
      {
        kind, db_id: id, id_value: idValue,
        sheet_tab: found.tab,
        sheet_row: found.rowIndex + 1,
        sheet_cell: targetCell,
        sheet_url: sheetUrl,
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
