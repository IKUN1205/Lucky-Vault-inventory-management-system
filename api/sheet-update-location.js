// api/sheet-update-location.js
// POST { cert_number, location_name }  — single slab
// POST { items: [{ cert_number, location_name }, …] }  — bulk (one grid
//   read per tab + one batch write, used by Cards Audit bulk moves so a
//   50-slab move doesn't fire 100+ Sheets requests and trip quota)
//
// Writes the app room back into the slab sheet's Location cell after an
// in-app move. Slab locations are SHEET-OWNED (boss directive 2026-06-11)
// — the hourly sync moves app rows to wherever the sheet says, so without
// this write-back a deliberate in-app move would be undone within the
// hour.
//
// Trust bar (mirrors sheet-mark-sold.js — this endpoint is reachable
// without auth, so it must verify everything against the app DB and
// never write caller-controlled text):
//   - only rooms in KEYWORD_BY_ROOM can be written (fixed keyword, never
//     raw caller text) — unknown rooms → outcome 'unknown_room'
//   - the slab must exist (not deleted) in Supabase AND its CURRENT app
//     location must equal the requested room — else 'app_mismatch'.
//     Legit callers update the DB first, so this always holds for them.
//   - the target sheet row must be a LIVE row: not struck through, no
//     sold/traded markers (same row test the sync uses). Dead-row-only
//     certs → outcome 'row_is_sold' (left for the audit's critical to
//     surface; we never overwrite a sold marker).
//
// Always answers 200 with per-item `outcome` (callers fire-and-forget):
//   updated | unknown_room | app_mismatch | row_is_sold |
//   cert_not_in_sheet | not_in_db | not_configured | error

import { createClient } from '@supabase/supabase-js'
import { readGridWithFormat, batchUpdateValues } from './_lib/google-sheets.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

const SHEET_ID = '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI'
// Both Master tabs now share ONE layout (One Piece Master was restructured
// to match Pokemon Master; corrected 2026-06-24): Location is col M (12) and
// Status col L (11) on BOTH — same maps as sync-slabs-sheet.js TAB_CONFIG.
const TABS = [
  { tab: 'Pokemon Master',   locationColumn: 12, statusColumn: 11 },
  { tab: 'One Piece Master', locationColumn: 12, statusColumn: 11 },
]

// App room name → the keyword convention used in the sheet's Location
// column. Keep in sync with routeLocation (sync-slabs-sheet.js) and
// routeSlabSheetLocation (audit-cards.js), which map these back. Every
// keyword MUST round-trip to its own room through those routers.
const KEYWORD_BY_ROOM = {
  'Stream Room - eBay LuckyVaultUS': 'lucky',
  'Stream Room - eBay SlabbiePatty': 'slabbie',
  'Stream Room - TikTok RocketsHQ':  'rockets',
  'Stream Room - TikTok Packheads':  'packheads',
  'Stream Room - PokeCasino':        'pokecasino',
  'Stream Room - PokeAuctionHouse':  'pokeauction',
  'Shows':                           'show',
  'Master Inventory':                'master',
  'Front Store':                     'front store',
  'Japan Warehouse':                 'japan',
  'Slab Room':                       'slab room',
}

export const config = { maxDuration: 60 }

function colLetter(col) {
  let n = col + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = req.body || {}
  const bulkMode = Array.isArray(body.items)
  const items = bulkMode
    ? body.items
    : [{ cert_number: body.cert_number, location_name: body.location_name }]
  const respond = (results) => bulkMode
    ? res.status(200).json({ ok: results.every(r => r.outcome === 'updated'), results })
    : res.status(200).json({ ok: results[0]?.outcome === 'updated', ...results[0] })

  const cleaned = items
    .map(i => ({ cert: String(i?.cert_number || '').trim(), room: String(i?.location_name || '').trim() }))
    .filter(i => i.cert && i.room)
  if (cleaned.length === 0) {
    return res.status(400).json({ ok: false, outcome: 'bad_request', error: 'cert_number and location_name required' })
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !SUPABASE_KEY) {
    return respond(cleaned.map(i => ({ cert_number: i.cert, outcome: 'not_configured' })))
  }

  try {
    const results = new Map()  // cert → result object (first write wins)
    const lastBinByCert = new Map()  // cert → remembered shelf bin (Slab Room return)
    const setOnce = (cert, r) => { if (!results.has(cert)) results.set(cert, { cert_number: cert, ...r }) }

    // 1. Room must be in the keyword map — never write raw caller text.
    const pending = []
    for (const i of cleaned) {
      if (!KEYWORD_BY_ROOM[i.room]) setOnce(i.cert, { outcome: 'unknown_room', location_name: i.room })
      else pending.push(i)
    }

    // 2. Verify against the app DB: slab exists and is CURRENTLY at the
    //    requested room (legit callers moved it there before calling us).
    if (pending.length > 0) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
      // last_slab_bin (a slab's remembered shelf bin) is selected when the
      // column exists; on a return into the Slab Room we write THAT bin
      // back to the sheet instead of the generic "slab room", so a card
      // coming home from a show lands in its original bin (2026-06-16).
      let selectCols = 'cert_number, location:locations(name), last_slab_bin'
      let dbRows, dbErr
      ;({ data: dbRows, error: dbErr } = await supabase
        .from('slabs').select(selectCols)
        .in('cert_number', pending.map(i => i.cert)).eq('deleted', false))
      if (dbErr && /last_slab_bin/.test(dbErr.message || '')) {
        // column not migrated yet — fall back without bin memory
        ;({ data: dbRows, error: dbErr } = await supabase
          .from('slabs').select('cert_number, location:locations(name)')
          .in('cert_number', pending.map(i => i.cert)).eq('deleted', false))
      }
      if (dbErr) throw dbErr
      const dbRoomByCert = new Map()
      for (const r of dbRows || []) {
        const c = String(r.cert_number).trim()
        if (!dbRoomByCert.has(c)) {
          dbRoomByCert.set(c, r.location?.name || null)
          if (r.last_slab_bin) lastBinByCert.set(c, r.last_slab_bin)
        }
      }
      for (const i of [...pending]) {
        if (!dbRoomByCert.has(i.cert)) {
          setOnce(i.cert, { outcome: 'not_in_db' })
          pending.splice(pending.indexOf(i), 1)
        } else if (dbRoomByCert.get(i.cert) !== i.room) {
          setOnce(i.cert, { outcome: 'app_mismatch', app_room: dbRoomByCert.get(i.cert) })
          pending.splice(pending.indexOf(i), 1)
        }
      }
    }

    // 3. Locate each cert's LIVE row (skip struck-through / sold-marked
    //    rows — the same test the sync uses to pick rows). One grid read
    //    per tab regardless of item count.
    if (pending.length > 0) {
      const wanted = new Map(pending.map(i => [i.cert, i]))
      const updates = []
      const deadOnly = new Set()
      for (const t of TABS) {
        if (wanted.size === 0) break
        let gridRows
        try {
          gridRows = await readGridWithFormat(SHEET_ID, `${t.tab}!A1:R10000`)
        } catch (e) {
          if (String(e.message).includes('Unable to parse range')) continue
          throw e
        }
        for (let r = 0; r < gridRows.length; r++) {
          const gr = gridRows[r]
          const cert = String(gr.cells[0] || '').trim()
          const item = wanted.get(cert)
          if (!item) continue
          const locText = String(gr.cells[t.locationColumn] || '').trim()
          const statusText = String(gr.cells[t.statusColumn] || '').trim()
          const isDead = gr.struck[0] || gr.struck[2]
            || /sold|traded/i.test(locText) || /sold/i.test(statusText)
          if (isDead) { deadOnly.add(cert); continue }
          // Returning to the Slab Room → write the remembered shelf bin
          // (e.g. "2V-01") if we have one, else the generic "slab room".
          // Going anywhere else → the room keyword.
          const value = (item.room === 'Slab Room' && lastBinByCert.get(cert))
            ? lastBinByCert.get(cert)
            : KEYWORD_BY_ROOM[item.room]
          const cell = `${t.tab}!${colLetter(t.locationColumn)}${r + 1}`
          updates.push({ range: cell, values: [[value]] })
          setOnce(cert, { outcome: 'updated', cell, wrote: value, restored_bin: value !== KEYWORD_BY_ROOM[item.room] })
          wanted.delete(cert)
          deadOnly.delete(cert)
        }
      }
      for (const cert of wanted.keys()) {
        setOnce(cert, { outcome: deadOnly.has(cert) ? 'row_is_sold' : 'cert_not_in_sheet' })
      }
      if (updates.length > 0) await batchUpdateValues(SHEET_ID, updates)
    }

    return respond(cleaned.map(i => results.get(i.cert) || { cert_number: i.cert, outcome: 'error' }))
  } catch (err) {
    console.error('[sheet-update-location]', err)
    return respond(cleaned.map(i => ({ cert_number: i.cert, outcome: 'error', message: err.message || String(err) })))
  }
}
