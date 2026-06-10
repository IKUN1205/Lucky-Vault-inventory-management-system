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
import { backsyncSoldStatus, readGridWithFormat } from './_lib/google-sheets.js'

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
  { tab: 'Pokemon Master',   mp: 6, ls: 5, list: 7, lv: 9, cost: 17, intake: 14, location: 12, status: 11 },
  { tab: 'One Piece Master', mp: 5, ls: 6, list: 7, lv: 8, cost: 14, intake: 16, location: 15, status: 11 },
]

// Location-column routing for NEW inserts. Mirrors the rule used for the
// 2026-06-08 bulk relocation: lucky → LuckyVaultUS stream room,
// slabbie/patty → SlabbiePatty stream room, everything else (shelf codes,
// blank) → Slab Room.
const ROOM_NAMES = {
  slabroom: 'Slab Room',
  lucky:    'Stream Room - eBay LuckyVaultUS',
  slabbie:  'Stream Room - eBay SlabbiePatty',
}
const routeLocation = (locText) => {
  const t = String(locText || '').toLowerCase()
  if (/lucky/.test(t)) return 'lucky'
  if (/slabbie|slabby|patty/.test(t)) return 'slabbie'
  return 'slabroom'
}

export const config = { maxDuration: 60 }

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
        // Sold signals (boss convention, confirmed 2026-06-08) — ANY of:
        //   1. strikethrough on the cert cell or item-name cell
        //   2. Location column says "sold" (any casing) or "traded out"
        //   3. Status column (L) says "sold"
        // Such rows are already sold: never import, never price-refresh.
        if (gr.struck[0] || gr.struck[2]) { crossed++; continue }
        const locText = String(gr.cells[cfg.location] || '').trim()
        const statusText = String(gr.cells[cfg.status] || '').trim()
        if (/^sold$/i.test(locText) || /traded/i.test(locText) || /sold/i.test(statusText)) { soldText++; continue }
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
          acquisition_cost_usd: money(gr.cells[cfg.cost]),
          date_acquired: dateOrNull(gr.cells[cfg.intake]),
          location_route: routeLocation(locText),
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

    // 3. Which certs exist? Pull current MP too so we only PATCH deltas.
    const existing = new Map()
    const certs = items.map(i => i.cert_number)
    for (let i = 0; i < certs.length; i += 150) {
      const { data, error } = await supabase
        .from('slabs')
        .select('id, cert_number, market_price_usd')
        .in('cert_number', certs.slice(i, i + 150))
        .eq('deleted', false)
      if (error) throw error
      for (const r of data || []) existing.set(String(r.cert_number), r)
    }

    // 4. Update existing prices (changed only).
    let upd = 0, updErr = 0, updSkip = 0
    for (const it of items) {
      const ex = existing.get(it.cert_number)
      if (!ex) continue
      if (it.market_price_usd == null) { updSkip++; continue }
      if (ex.market_price_usd != null && Math.abs(Number(ex.market_price_usd) - it.market_price_usd) < 0.005) { updSkip++; continue }
      const { error } = await supabase.from('slabs')
        .update({ market_price_usd: it.market_price_usd })
        .eq('id', ex.id)
      if (error) { console.error('[sync-slabs-sheet] PATCH fail', it.cert_number, error.message); updErr++ }
      else upd++
    }

    // 5. Insert new certs at the sheet-routed location (Slab Room default).
    const inserts = items.filter(it => !existing.has(it.cert_number)).map(it => ({
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
    }))
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
    try {
      const { data: soldRows } = await supabase
        .from('slabs')
        .select('cert_number')
        .eq('status', 'sold')
        .eq('deleted', false)
        .not('cert_number', 'is', null)
      const soldIds = new Set((soldRows || []).map(r => String(r.cert_number).trim()).filter(Boolean))
      backsync = await backsyncSoldStatus({
        spreadsheetId: SHEET_ID,
        // Back-sync ONLY into the two canonical Master tabs per boss
        // directive 2026-06-04. The new-arrival tabs (OP NEW / New Input)
        // are for fresh slabs that haven't sold yet — no point scanning.
        tabs: ['Pokemon Master', 'One Piece Master'],
        idColumn: 0,         // Cert is col A
        statusColumn: 11,    // Status is col L
        soldIdsInDb: soldIds,
      })
    } catch (e) {
      console.warn('[sync-slabs-sheet] back-sync threw (non-fatal):', e.message)
      backsync = { error: e.message }
    }

    const durationMs = Date.now() - startedAt
    const summary = {
      ok: true, tabs: tabSummary, unique_live_certs: items.length,
      skipped_junk_rows: skippedJunk,
      existing_in_db: existing.size, prices_changed: upd, prices_unchanged: updSkip,
      price_errors: updErr, new_inserted: ins, insert_errors: insErr,
      backsync_sold_to_sheet: backsync.written ?? 0,
      backsync_detail: backsync,
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
