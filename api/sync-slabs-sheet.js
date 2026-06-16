// api/sync-slabs-sheet.js
// Vercel cron — pulls the slabs Google Sheet (Pokemon Master + One Piece
// Master tabs) and keeps the slabs table in sync. Hourly at :30.
//
// Policy (directive 2026-05-28, REVISED 2026-06-08):
//   - price = MP column → market_price_usd (refreshed only when changed)
//   - CROSSED-OUT rows (strikethrough) = already sold per boss convention.
//     They are NEVER imported and never price-refreshed. Same for rows
//     whose Location column says "sold". (Revision 2026-06-08 — before
//     this the sync read the gviz CSV, which can't see strikethrough, so
//     sold slabs kept getting re-inserted as live inventory at Master.)
//   - NEW certs are inserted at the location the sheet's Location column
//     names: "lucky" → Stream Room - eBay LuckyVaultUS, "slabbie"/"patty"
//     → Stream Room - eBay SlabbiePatty, anything else (shelf codes like
//     H-01 / 2V-03, or blank) → Slab Room. (Was: always Master Inventory;
//     revised 2026-06-08 because physically slabs live in the Slab Room
//     and the Master default caused permanent location drift.)
//   - existing certs: refresh market_price_usd only; location + status
//     are managed in-app and never overwritten.
//   - a cert with no Item Name imports with a placeholder name so it's
//     still scannable; staff fills the real name later.
//
// The two Master tabs have DIFFERENT column layouts (verified live
// 2026-06-08 — this also fixes a price-swap bug where the old shared
// layout read LS into market_price_usd for Pokemon Master):
//   Pokemon Master:   A Cert  B Grade  C Item  D Pop  E CL  F LS  G MP
//                     H List  I Trend  J LV  K Note  L Status  M Location
//                     N Days  O Intake  P Listed  Q LastAlert  R Cost
//   One Piece Master: A Cert  B Grade  C Item  D Pop  E CL  F MP  G LS
//                     H List  I LV  J Note  K Days  L Status  M Listed
//                     N LastAlert  O Cost  P Location  Q Intake
//
// Reading goes through the Sheets API grid endpoint (service account via
// GOOGLE_SERVICE_ACCOUNT_JSON) because formatting (strikethrough) is
// invisible in CSV exports. No env var → loud 500 + Lark ping, since
// silently falling back to CSV would resurrect the sold-slabs bug.
//
// Vercel attaches Authorization: Bearer ${CRON_SECRET} when invoking.

import { createClient } from '@supabase/supabase-js'
import { backsyncSoldStatus, readGridWithFormat, readRange, batchUpdateValues, getSheetIds, insertRows } from './_lib/google-sheets.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LARK_INVENTORY_IO = process.env.LARK_WEBHOOK_INVENTORY_IO
  || process.env.LARK_WEBHOOK_URL

const SHEET_ID = '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI'

// Per-tab column maps (0-based). See header comment for the layouts.
// New-arrival staging tabs ("New Input" / "OP NEW") are intentionally NOT
// synced — boss moves slabs into a Master tab when they're ready.
const TAB_CONFIG = [
  { tab: 'Pokemon Master',   mp: 6, ls: 5, list: 7, lv: 9, note: 10, cost: 17, intake: 14, location: 12, status: 11 },
  { tab: 'One Piece Master', mp: 5, ls: 6, list: 7, lv: 8, note: 9,  cost: 14, intake: 16, location: 15, status: 11 },
]

// Location-column routing for NEW inserts. Mirrors the rule used for the
// 2026-06-08 bulk relocation: lucky → LuckyVaultUS stream room,
// slabbie/patty → SlabbiePatty stream room, everything else (shelf codes,
// blank) → Slab Room.
const ROOM_NAMES = {
  slabroom:  'Slab Room',
  lucky:     'Stream Room - eBay LuckyVaultUS',
  slabbie:   'Stream Room - eBay SlabbiePatty',
  shows:     'Shows',
  rockets:   'Stream Room - TikTok RocketsHQ',
  packheads: 'Stream Room - TikTok Packheads',
  whatnot:   'Stream Room - Whatnot',
  master:    'Master Inventory',
  front:     'Front Store',
  japan:     'Japan Warehouse',
}
// Keep this keyword table in sync with BOTH routeSlabSheetLocation in
// api/audit-cards.js (the audit's mirror of this rule) and
// KEYWORD_BY_ROOM in api/sheet-update-location.js (the reverse map the
// in-app move write-back uses).
const routeLocation = (locText) => {
  const t = String(locText || '').toLowerCase()
  // Sold markers are not places — rows carrying them are skipped before
  // routing matters, but null here is defense-in-depth so sold-ish text
  // can never drive a relocation (relocation no-ops on a null route; the
  // insert path falls back to slabroom).
  if (/sold|traded/.test(t)) return null
  if (/lucky/.test(t)) return 'lucky'
  if (/slabbie|slabby|patty/.test(t)) return 'slabbie'
  if (/show/.test(t)) return 'shows'
  if (/rocket/.test(t)) return 'rockets'
  if (/packhead/.test(t)) return 'packheads'
  if (/whatnot/.test(t)) return 'whatnot'
  if (/master/.test(t)) return 'master'
  if (/front/.test(t)) return 'front'
  if (/japan/.test(t)) return 'japan'
  return 'slabroom'   // bin codes (H-01, 2V-03, …) and anything unknown
}

// 300, not 60: a full pass is two grid reads + up to ~860 row PATCHes
// (first run after the sheet_bin migration backfills every row) + the
// sold back-sync. A platform timeout kill mid-loop would leave partial
// state with no summary. auto-reconcile.js / audit-cron.js precedent.
export const config = { maxDuration: 300 }

const money = (s) => { if (!s) return null; const m = String(s).replace(/,/g, '').match(/-?[\d.]+/); return m ? Number(m[0]) : null }
const dateOrNull = (s) => { const t = String(s || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null }

async function postLark(text) {
  if (!LARK_INVENTORY_IO) return
  try {
    await fetch(LARK_INVENTORY_IO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
  } catch (err) { console.error('[sync-slabs-sheet] Lark notify failed:', err) }
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    await postLark('⚠️ Slabs sheet sync FAILED — GOOGLE_SERVICE_ACCOUNT_JSON not configured (grid read needs it; CSV fallback would resurrect sold slabs)')
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const today = new Date().toISOString().slice(0, 10)
  const startedAt = Date.now()

  try {
    // 1. Pull both Master tabs via the grid API (strikethrough-aware) and
    //    parse + dedupe by cert in one pass. Crossed-out rows and rows
    //    whose Location column says "sold" are skipped entirely — they're
    //    sold; the app must not import or price-refresh them.
    const tabSummary = []
    const byCert = new Map()
    const soldSource = new Map()   // cert → sold-sheet-shaped row (A..L)
    let skippedJunk = 0
    for (const cfg of TAB_CONFIG) {
      let gridRows
      try {
        gridRows = await readGridWithFormat(SHEET_ID, `${cfg.tab}!A1:R5000`)
      } catch (e) {
        if (String(e.message).includes('Unable to parse range')) {
          tabSummary.push({ tab: cfg.tab, skipped: 'tab missing' })
          continue
        }
        throw e
      }
      let kept = 0, crossed = 0, soldText = 0
      for (const gr of gridRows) {
        const cert = String(gr.cells[0] || '').trim()
        if (!/^\d+$/.test(cert)) { skippedJunk++; continue }
        // Real PSA/CGC certs are 6+ digits; a 1-5 digit value is a
        // mid-edit fat-finger, never a slab — don't import it as new.
        if (cert.length < 6) { skippedJunk++; continue }
        // Ledger source: keep a sold-sheet-shaped copy (cols A..L) of every
        // cert row BEFORE any skip, so the sold-ledger appender below can
        // copy Pop/CL/Trend etc. faithfully when a cert sells. The two tabs
        // have different layouts; "sold sheet" mirrors Pokemon Master's.
        if (!soldSource.has(cert)) {
          const c = gr.cells
          soldSource.set(cert, cfg.tab === 'Pokemon Master'
            ? [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], 'sold'].map(v => v ?? '')
            : [c[0], c[1], c[2], c[3], c[4], c[6], c[5], c[7], '', c[8], c[9], 'sold'].map(v => v ?? ''))
        }
        // Sold signals (boss convention, confirmed 2026-06-08) — ANY of:
        //   1. strikethrough on the cert cell or item-name cell
        //   2. Location column says "sold" (any casing) or "traded out"
        //   3. Status column (L) says "sold"
        // Such rows are already sold: never import, never price-refresh.
        if (gr.struck[0] || gr.struck[2]) { crossed++; continue }
        const locText = String(gr.cells[cfg.location] || '').trim()
        const statusText = String(gr.cells[cfg.status] || '').trim()
        if (/sold|traded/i.test(locText) || /sold/i.test(statusText)) { soldText++; continue }
        let itemName = String(gr.cells[2] || '').trim()
        if (!itemName) itemName = `(unnamed slab — cert ${cert})`
        // First tab wins on duplicate certs (Pokemon Master processed
        // before One Piece Master — they shouldn't overlap anyway).
        if (byCert.has(cert)) continue
        byCert.set(cert, {
          cert_number: cert,
          grading_company: String(gr.cells[1] || '').trim() || 'Other',
          item_name: itemName,
          market_price_usd: money(gr.cells[cfg.mp]),
          last_sold_usd: money(gr.cells[cfg.ls]),
          list_price_usd: money(gr.cells[cfg.list]),
          lv_price_usd: money(gr.cells[cfg.lv]),
          sheet_note: String(gr.cells[cfg.note] || '').trim() || null,
          acquisition_cost_usd: money(gr.cells[cfg.cost]),
          date_acquired: dateOrNull(gr.cells[cfg.intake]),
          location_route: routeLocation(locText),
          // Raw Location cell ("H-01", "lucky", …) — stored as sheet_bin
          // so staff can see the exact shelf bin in the app.
          sheet_location_raw: locText || null,
        })
        kept++
      }
      tabSummary.push({ tab: cfg.tab, rows: kept, skipped_crossed_out: crossed, skipped_sold_text: soldText })
    }
    const items = [...byCert.values()]
    console.log('[sync-slabs-sheet] tabs:', tabSummary, '→ unique live certs:', items.length)

    // 2. Resolve destination room ids. Slab Room missing = hard fail —
    //    we never want a silent-NULL location on insert (that exact bug
    //    produced the 2026-06-08 "orphan slabs" incident).
    const { data: rooms, error: roomsErr } = await supabase
      .from('locations').select('id, name')
      .in('name', Object.values(ROOM_NAMES))
    if (roomsErr) throw roomsErr
    const roomIdByKey = {}
    for (const [key, name] of Object.entries(ROOM_NAMES)) {
      roomIdByKey[key] = (rooms || []).find(r => r.name === name)?.id || null
    }
    if (!roomIdByKey.slabroom) {
      throw new Error(`Location "${ROOM_NAMES.slabroom}" not found — refusing to insert slabs with no location`)
    }

    // 3. Does the slabs table have the sheet_note column yet? It's added
    //    by scripts/add_slabs_sheet_note.sql — probe once so the sync
    //    degrades gracefully (skips note writes) instead of erroring on
    //    every row if the migration hasn't run.
    let hasNoteColumn = true
    {
      const { error: probeErr } = await supabase
        .from('slabs').select('sheet_note').limit(1)
      if (probeErr) {
        hasNoteColumn = false
        console.warn('[sync-slabs-sheet] sheet_note column missing — note sync skipped (run scripts/add_slabs_sheet_note.sql)')
      }
    }
    // Same probe for sheet_bin (raw Location cell — bin codes). Added by
    // scripts/add_slabs_sheet_bin.sql; degrades to skip until it's run.
    let hasBinColumn = true
    {
      const { error: probeErr } = await supabase
        .from('slabs').select('sheet_bin').limit(1)
      if (probeErr) {
        hasBinColumn = false
        console.warn('[sync-slabs-sheet] sheet_bin column missing — bin sync skipped (run scripts/add_slabs_sheet_bin.sql)')
      }
    }
    // last_slab_bin remembers the most recent REAL shelf bin so a slab
    // returning from a show lands back in its bin (added by
    // scripts/add_slabs_last_bin.sql). Probe so we degrade gracefully.
    let hasLastBinColumn = true
    {
      const { error: probeErr } = await supabase
        .from('slabs').select('last_slab_bin').limit(1)
      if (probeErr) {
        hasLastBinColumn = false
        console.warn('[sync-slabs-sheet] last_slab_bin column missing — bin memory skipped (run scripts/add_slabs_last_bin.sql)')
      }
    }
    // A real shelf bin starts with a digit ("2V-01", "03-05", "3-11");
    // room keywords (lucky/show/slab room/…) start with a letter.
    const isBinCode = (s) => /^\d/.test(String(s || '').trim())

    // 4. Which certs exist? Pull current MP/LV/note + name too so we only
    //    PATCH deltas (item_name is needed for placeholder-name healing).
    const existing = new Map()
    const certs = items.map(i => i.cert_number)
    const existCols = 'id, cert_number, item_name, grading_company, market_price_usd, lv_price_usd, location_id'
      + (hasNoteColumn ? ', sheet_note' : '')
      + (hasBinColumn ? ', sheet_bin' : '')
      + (hasLastBinColumn ? ', last_slab_bin' : '')
    for (let i = 0; i < certs.length; i += 150) {
      const { data, error } = await supabase
        .from('slabs')
        .select(existCols)
        .in('cert_number', certs.slice(i, i + 150))
        .eq('deleted', false)
      if (error) throw error
      for (const r of data || []) existing.set(String(r.cert_number), r)
    }

    // 5. Refresh existing rows — MP + LV + sheet note, changed fields only,
    //    bundled into ONE PATCH per row. (Was MP-only; LV + note added
    //    2026-06-08 per boss — zero extra reads since the grid fetch
    //    already carries every column.)
    const priceDiff = (a, b) => {
      if (b == null) return false                 // sheet blank → keep app value
      if (a == null) return true
      return Math.abs(Number(a) - Number(b)) >= 0.005
    }
    // Relocation guard: pre-count how many rows the sheet wants to move
    // this run. A burst above the cap is almost certainly NOT physical
    // reality (mass sheet edit, column shift, routing bug) — in that case
    // skip ALL relocations this run and page the team instead of silently
    // re-shelving the store. Prices/names/bins still sync normally.
    const RELOCATION_CAP = 30
    const plannedRelocations = []
    for (const it of items) {
      const ex = existing.get(it.cert_number)
      if (!ex || !it.sheet_location_raw || !it.location_route) continue
      const targetRoomId = roomIdByKey[it.location_route] || null
      if (targetRoomId && ex.location_id !== targetRoomId) {
        plannedRelocations.push({ cert: it.cert_number, room: ROOM_NAMES[it.location_route], cell: it.sheet_location_raw })
      }
    }
    const allowRelocations = plannedRelocations.length <= RELOCATION_CAP
    if (!allowRelocations) {
      const sample = plannedRelocations.slice(0, 5).map(p => `${p.cert}→${p.room} ("${p.cell}")`).join(', ')
      console.error(`[sync-slabs-sheet] relocation cap: ${plannedRelocations.length} > ${RELOCATION_CAP} — skipping ALL relocations this run`)
      await postLark(`⚠️ Slabs sync safety stop: the sheet wants to relocate ${plannedRelocations.length} slabs in one run (cap ${RELOCATION_CAP}) — skipped ALL relocations. Sample: ${sample}. If this is a real mass re-shelving, check the sheet's Location column, then rerun.`)
    }

    let upd = 0, updErr = 0, updSkip = 0, renamed = 0, relocated = 0
    const relocationAudits = []   // slabs_audit_log rows, written after the loop
    for (const it of items) {
      const ex = existing.get(it.cert_number)
      if (!ex) continue
      const patch = {}
      let pendingRelocationAudit = null
      if (priceDiff(ex.market_price_usd, it.market_price_usd)) patch.market_price_usd = it.market_price_usd
      if (priceDiff(ex.lv_price_usd, it.lv_price_usd))         patch.lv_price_usd = it.lv_price_usd
      if (hasNoteColumn && (it.sheet_note || null) !== (ex.sheet_note || null)) {
        patch.sheet_note = it.sheet_note   // null clears a note removed on the sheet
      }
      // Location is SHEET-OWNED too (boss directive 2026-06-11): route the
      // sheet's Location cell to the app room it implies and move the row
      // when they disagree. Blank cells = nothing recorded → never move.
      // Deliberate in-app moves are safe because every move writes its
      // room keyword back into the sheet cell (api/sheet-update-location)
      // — only genuine drift converges here, toward the sheet.
      if (allowRelocations && it.sheet_location_raw && it.location_route) {
        const targetRoomId = roomIdByKey[it.location_route] || null
        if (targetRoomId && ex.location_id !== targetRoomId) {
          console.log('[sync-slabs-sheet] relocate', it.cert_number,
            'from', ex.location_id, '→', ROOM_NAMES[it.location_route],
            `(sheet: "${it.sheet_location_raw}")`)
          patch.location_id = targetRoomId
          relocated++
          // Audit trail so the previous location stays recoverable —
          // mirrors what moveSlabToLocation logs for in-app moves.
          pendingRelocationAudit = {
            slab_id: ex.id,
            event_type: 'moved',
            summary: `Sheet sync relocated cert #${it.cert_number} to ${ROOM_NAMES[it.location_route]} (sheet Location: "${it.sheet_location_raw}")`,
            payload: { from_location_id: ex.location_id, to_location_id: targetRoomId, source: 'sheet-sync' },
          }
        }
      }
      // Raw Location cell mirrored into sheet_bin so staff can see the
      // exact shelf bin in the app. null clears a cell emptied on the sheet.
      if (hasBinColumn && (it.sheet_location_raw || null) !== (ex.sheet_bin || null)) {
        patch.sheet_bin = it.sheet_location_raw
      }
      // Remember the most recent REAL shelf bin (digit-prefixed). When the
      // slab later leaves to a show its Location cell becomes "show" (not a
      // bin) — we deliberately DON'T overwrite last_slab_bin then, so the
      // shelf is preserved for the return trip.
      if (hasLastBinColumn && isBinCode(it.sheet_location_raw)
          && it.sheet_location_raw !== ex.last_slab_bin) {
        patch.last_slab_bin = it.sheet_location_raw
      }
      // Names are SHEET-OWNED (boss directive 2026-06-11 "我们以sheet作为
      // 基础"): whenever the sheet has a real Item Name and the app
      // disagrees, the sheet wins — hourly, same as prices. The old rule
      // (placeholder-healing only) froze a name at first import forever;
      // that's how the 6/2 mid-edit snapshot left 33 certs wearing other
      // cards' names for 8 days. A sheet caught mid-edit can still write a
      // transiently wrong name, but the next hourly pass converges it back
      // once the row is finished. Consequence: rename slabs ON THE SHEET —
      // an in-app rename gets reverted within the hour.
      // it.item_name falls back to "(unnamed slab — cert N)" when the
      // sheet cell is blank — that never overwrites a real app name.
      if (!/^\(unnamed slab/.test(it.item_name)
          && String(ex.item_name || '').trim() !== it.item_name) {
        console.log('[sync-slabs-sheet] rename', it.cert_number,
          JSON.stringify(ex.item_name), '→', JSON.stringify(it.item_name))
        patch.item_name = it.item_name
        renamed++
        if ((!ex.grading_company || ex.grading_company === 'Other') && it.grading_company !== 'Other') {
          patch.grading_company = it.grading_company
        }
      }
      if (Object.keys(patch).length === 0) { updSkip++; continue }
      const { error } = await supabase.from('slabs')
        .update(patch)
        .eq('id', ex.id)
      if (error) { console.error('[sync-slabs-sheet] PATCH fail', it.cert_number, error.message); updErr++ }
      else {
        upd++
        if (pendingRelocationAudit) relocationAudits.push(pendingRelocationAudit)
      }
    }
    if (relocationAudits.length > 0) {
      const { error: auditErr } = await supabase.from('slabs_audit_log').insert(relocationAudits)
      if (auditErr) console.warn('[sync-slabs-sheet] relocation audit-log insert failed (non-fatal):', auditErr.message)
    }

    // 6. Insert new certs at the sheet-routed location (Slab Room default).
    const inserts = items.filter(it => !existing.has(it.cert_number)).map(it => {
      const row = {
        cert_number: it.cert_number,
        grading_company: it.grading_company,
        item_name: it.item_name,
        status: 'in_inventory',
        location_id: roomIdByKey[it.location_route] || roomIdByKey.slabroom,
        market_price_usd: it.market_price_usd,
        last_sold_usd: it.last_sold_usd,
        list_price_usd: it.list_price_usd,
        lv_price_usd: it.lv_price_usd,
        acquisition_cost_usd: it.acquisition_cost_usd,
        date_acquired: it.date_acquired || today,
        notes: `Imported from slabs sheet on ${today} (auto-sync)`,
        deleted: false,
      }
      if (hasNoteColumn) row.sheet_note = it.sheet_note
      if (hasBinColumn) row.sheet_bin = it.sheet_location_raw
      if (hasLastBinColumn && isBinCode(it.sheet_location_raw)) row.last_slab_bin = it.sheet_location_raw
      return row
    })
    let ins = 0, insErr = 0
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100)
      const { error } = await supabase.from('slabs').insert(batch)
      if (error) { console.error('[sync-slabs-sheet] INSERT batch fail:', error.message); insErr += batch.length }
      else ins += batch.length
    }

    // Hourly safety-net back-sync — see twin block in sync-singles-sheet.js
    // for rationale. Pulls every Supabase slab with status='sold' and
    // pushes Status='sold' to the matching cert in the sheet if it's
    // not already there.
    let backsync = { skipped: 'env not set' }
    let soldRows = []
    try {
      const soldQuery = await supabase
        .from('slabs')
        .select('cert_number, item_name, grading_company, market_price_usd, lv_price_usd, list_price_usd, last_sold_usd, sale_channel, sale_date, sale_price_usd')
        .eq('status', 'sold')
        .eq('deleted', false)
        .not('cert_number', 'is', null)
        .limit(5000)
      soldRows = soldQuery.data || []
      const soldIds = new Set(soldRows.map(r => String(r.cert_number).trim()).filter(Boolean))
      backsync = await backsyncSoldStatus({
        spreadsheetId: SHEET_ID,
        // Back-sync ONLY into the two canonical Master tabs per boss
        // directive 2026-06-04. The new-arrival tabs (OP NEW / New Input)
        // are for fresh slabs that haven't sold yet — no point scanning.
        tabs: ['Pokemon Master', 'One Piece Master'],
        idColumn: 0,         // Cert is col A
        statusColumn: 11,    // Status is col L
        soldIdsInDb: soldIds,
        // Boss convention 2026-06-08: sold rows get CROSSED OUT on the
        // sheet (strikethrough), not just the Status text.
        strikeRows: true,
      })
    } catch (e) {
      console.warn('[sync-slabs-sheet] back-sync threw (non-fatal):', e.message)
      backsync = { error: e.message }
    }

    // Sold ledger — keep the "sold sheet" tab current (boss directive
    // 2026-06-11): every app-sold cert missing from that tab is appended
    // at the bottom of the data, ABOVE the TOTAL row. Dedupe by cert, so
    // re-runs are no-ops. Row values copy the cert's Master-tab row when
    // it exists (Pop/CL/Trend preserved); app-only solds build from app
    // fields. Sale channel/date/price ride along in the Note column.
    const SOLD_LEDGER_TAB = 'sold sheet'
    const LEDGER_APPEND_CAP = 80   // backfill was one-time; a burst above this = something's wrong
    let soldLedger = { appended: 0 }
    try {
      const ledgerCol = await readRange(SHEET_ID, `${SOLD_LEDGER_TAB}!A1:A10000`)
      const inLedger = new Set()
      let totalRowIdx = -1   // 0-based row index of the TOTAL row
      for (let r = 0; r < (ledgerCol || []).length; r++) {
        const v = String(ledgerCol[r]?.[0] || '').trim()
        if (/^total$/i.test(v)) { totalRowIdx = r; break }
        if (/^\d+$/.test(v)) inLedger.add(v)
      }
      const missing = soldRows
        .map(r => ({ ...r, cert: String(r.cert_number).trim() }))
        .filter(r => r.cert && !inLedger.has(r.cert))
        // stable order: oldest sale first so the ledger reads chronologically
        .sort((a, b) => String(a.sale_date || '').localeCompare(String(b.sale_date || '')))
      // de-dupe within this batch (duplicate cert rows in the app)
      const seenBatch = new Set()
      const newRows = []
      for (const s of missing) {
        if (seenBatch.has(s.cert)) continue
        seenBatch.add(s.cert)
        let row = soldSource.get(s.cert)
        row = row ? [...row] : [
          s.cert, s.grading_company || '', s.item_name || '', '', '',
          s.last_sold_usd ?? '', s.market_price_usd ?? '', s.list_price_usd ?? '',
          '', s.lv_price_usd ?? '', '', 'sold',
        ]
        const sale = [s.sale_channel, s.sale_date, s.sale_price_usd != null ? `$${s.sale_price_usd}` : null]
          .filter(Boolean).join(' ')
        if (sale) row[10] = row[10] ? `${row[10]} | sold: ${sale}` : `sold: ${sale}`
        newRows.push(row)
      }
      if (newRows.length > LEDGER_APPEND_CAP) {
        soldLedger = { appended: 0, skipped_cap: newRows.length }
        await postLark(`⚠️ Slabs sync: ${newRows.length} sold slabs would be appended to "${SOLD_LEDGER_TAB}" in one run (cap ${LEDGER_APPEND_CAP}) — skipped as a safety stop, check the tab.`)
      } else if (newRows.length > 0) {
        if (totalRowIdx >= 0) {
          // open space above TOTAL, then write into it
          const sheetIds = await getSheetIds(SHEET_ID)
          const ledgerSheetId = sheetIds.get(SOLD_LEDGER_TAB)
          if (ledgerSheetId == null) throw new Error(`tab "${SOLD_LEDGER_TAB}" not found`)
          await insertRows(SHEET_ID, ledgerSheetId, totalRowIdx, newRows.length)
          const start = totalRowIdx + 1   // 1-based first inserted row
          const newTotalRow = totalRowIdx + newRows.length + 1   // 1-based
          const dataEnd = newTotalRow - 1
          await batchUpdateValues(SHEET_ID, [
            { range: `${SOLD_LEDGER_TAB}!A${start}:L${start + newRows.length - 1}`, values: newRows },
            // TOTAL formulas don't auto-expand when rows are inserted at the
            // range edge — rewrite them to span the new data block.
            { range: `${SOLD_LEDGER_TAB}!C${newTotalRow}`, values: [[`=COUNTA(C2:C${dataEnd})`]] },
            { range: `${SOLD_LEDGER_TAB}!G${newTotalRow}`, values: [[`=SUM(G2:G${dataEnd})`]] },
          ])
        } else {
          // no TOTAL row (deleted?) — plain append after the last content row
          const start = (ledgerCol || []).length + 1
          await batchUpdateValues(SHEET_ID, [
            { range: `${SOLD_LEDGER_TAB}!A${start}:L${start + newRows.length - 1}`, values: newRows },
          ])
        }
        soldLedger = { appended: newRows.length }
        console.log(`[sync-slabs-sheet] sold ledger: appended ${newRows.length} row(s)`)
      }
    } catch (e) {
      console.warn('[sync-slabs-sheet] sold ledger threw (non-fatal):', e.message)
      soldLedger = { error: e.message }
    }

    const durationMs = Date.now() - startedAt
    const summary = {
      ok: true, tabs: tabSummary, unique_live_certs: items.length,
      bin_memory: hasLastBinColumn,   // deploy probe + migration status
      skipped_junk_rows: skippedJunk,
      existing_in_db: existing.size, prices_changed: upd, prices_unchanged: updSkip,
      names_refreshed: renamed, locations_refreshed: relocated,
      relocations_planned: plannedRelocations.length,
      relocations_capped: !allowRelocations,
      price_errors: updErr, new_inserted: ins, insert_errors: insErr,
      backsync_sold_to_sheet: backsync.written ?? 0,
      backsync_detail: backsync,
      sold_ledger: soldLedger,
      duration_ms: durationMs,
    }
    console.log('[sync-slabs-sheet] OK', summary)

    // Per-run Lark silent on success — same as singles. Daily roll-up
    // via /api/sync-digest-eod at 5 PM PT. Errors still ping immediately.
    if (insErr + updErr > 0) {
      await postLark(`⚠️ Slabs sheet sync — ${insErr + updErr} error${insErr + updErr === 1 ? '' : 's'} this run, check logs`)
    }
    return res.status(200).json(summary)
  } catch (err) {
    console.error('[sync-slabs-sheet] threw:', err)
    await postLark(`⚠️ Slabs sheet sync threw: ${err.message || err}`)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
