// api/daily-stream-plan.js
// Daily 5 AM PT (12:00 UTC) cron: writes today's stream plan into William's
// scheduling Google Sheet ("每日计划" tab) — one row per live session:
//   date · room · streamer · time(PT) · title (from fixed template) ·
//   Batch 货单 (LEFT BLANK — surprise sets are curated by William) ·
//   room-stock reference · Master-stock reference (top sealed items by qty)
//
// Sessions come from SHIFT_CONFIG below (2026-09-21 schedule; update here
// when shifts change). Idempotent per date: if the tab already has rows for
// the date, the run skips unless ?force=1.
//
// Manual runs:
//   ?dry=1            — compute + return rows, write nothing
//   ?date=YYYY-MM-DD  — plan that date instead of today (PT)
//
// Room mapping (assumption flagged to William 2026-09-24):
//   eBay 3 account    → "Stream Room - PokeAuctionHouse" (Quinn / Lexi)
//   new TikTok account→ "Stream Room - PokeCasino"       (Jacob / Jace)

import { createClient } from '@supabase/supabase-js'
import { readRange, appendRows, getSheetIds, addSheetTab } from './_lib/google-sheets.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
// The scheduling spreadsheet. The ID is not a secret (access is controlled
// by sharing); env override wins so it can be repointed without a deploy.
const SHEET_ID = process.env.STREAM_PLAN_SHEET_ID
  || '14VritEQcTHAxg2VYybPsK9aC9tLKKwe_yqJxrf4rSl0'
const TAB = '每日计划'

export const config = { maxDuration: 60 }

// ---- shift schedule (PT). getDay(): Sun=0 … Sat=6 ----------------------
const EBAY_ROOM = 'Stream Room - PokeAuctionHouse'
const TIKTOK_ROOM = 'Stream Room - PokeCasino'

const SHIFT_CONFIG = [
  { streamer: 'Quinn', room: EBAY_ROOM,   days: [1, 2],          time: '9:00am–4:00pm' },
  { streamer: 'Quinn', room: EBAY_ROOM,   days: [4, 5],          time: '10:00am–6:00pm' },
  { streamer: 'Lexi',  room: EBAY_ROOM,   days: [1, 2],          time: '5:00pm–12:00am' },
  { streamer: 'Lexi',  room: EBAY_ROOM,   days: [4, 5],          time: '8:00pm–3:00am' },
  { streamer: 'Lexi',  room: EBAY_ROOM,   days: [6],             time: '6:00pm–12:00am' },
  { streamer: 'Jacob', room: TIKTOK_ROOM, days: [1, 2, 3, 4, 5, 6], time: '9:00am–3:00pm' },
  { streamer: 'Jace',  room: TIKTOK_ROOM, days: [2, 3, 4, 5],    time: '3:00pm–7:00pm' },
]

// Fixed title templates per room ({MM/DD} substituted).
const TITLES = {
  [EBAY_ROOM]:   'Pokémon Card Auctions 🔥 $1 STARTS — {MM/DD}',
  [TIKTOK_ROOM]: '🎰 Pokémon Rips & Surprise Sets — LIVE {MM/DD}',
}

// ---- PT date helpers ---------------------------------------------------
function ptToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = t => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
// Day-of-week for a YYYY-MM-DD, DST-safe (noon UTC trick).
const dowOf = ymd => new Date(`${ymd}T12:00:00Z`).getUTCDay()

// Top sealed stock at a location, as a compact "Name ×N" list.
async function stockRef(supabase, locationName, topN = 8) {
  const { data: locs, error: locErr } = await supabase
    .from('locations').select('id').eq('name', locationName).limit(1)
  if (locErr || !locs?.length) return '(房间未找到)'
  const { data, error } = await supabase
    .from('inventory')
    .select('quantity, product:products(name, type)')
    .eq('location_id', locs[0].id)
    .gt('quantity', 0)
    .order('quantity', { ascending: false })
    .limit(40)
  if (error) return '(库存读取失败)'
  const sealed = (data || []).filter(r => ['Sealed', 'Pack'].includes(r.product?.type))
  if (!sealed.length) return '(无封装库存)'
  const shown = sealed.slice(0, topN)
    .map(r => `${r.product.name} ×${r.quantity}`).join(' · ')
  const more = sealed.length > topN ? ` (+${sealed.length - topN} 种)` : ''
  return shown + more
}

export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`
      && !req.query?.dry && !req.query?.date && !req.query?.force) {
    // cron calls carry the secret; manual browser runs use the query params
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })

  const date = (req.query?.date || ptToday())
  const dow = dowOf(date)
  const mmdd = `${date.slice(5, 7)}/${date.slice(8, 10)}`
  const sessions = SHIFT_CONFIG.filter(s => s.days.includes(dow))

  if (!sessions.length) {
    return res.status(200).json({ ok: true, date, message: '当天没有排班场次(按现行班表)', written: 0 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  // Stock references once per distinct room (not per session).
  const rooms = [...new Set(sessions.map(s => s.room))]
  const roomStock = {}
  for (const r of rooms) roomStock[r] = await stockRef(supabase, r)
  const masterStock = await stockRef(supabase, 'Master Inventory')

  const HEADER = ['日期', '房间', '主播', '时间(PT)', '直播标题', 'Batch 货单(你填)', '房间现货参考', '总仓可调参考']
  const rows = sessions.map(s => ([
    date,
    s.room.replace('Stream Room - ', ''),
    s.streamer,
    s.time,
    (TITLES[s.room] || '').replace('{MM/DD}', mmdd),
    '',                       // surprise set — William fills this
    roomStock[s.room],
    masterStock,
  ]))

  if (req.query?.dry) {
    return res.status(200).json({ ok: true, dry: true, date, header: HEADER, rows })
  }

  try {
    // Ensure the tab exists (create + header on first run).
    const tabs = await getSheetIds(SHEET_ID)
    if (!tabs.has(TAB)) {
      await addSheetTab(SHEET_ID, TAB)
      await appendRows(SHEET_ID, `${TAB}!A1`, [HEADER])
    }
    // Idempotency: skip if this date already written (unless force).
    if (!req.query?.force) {
      const existing = await readRange(SHEET_ID, `${TAB}!A:A`)
      const dates = (existing?.values || []).flat()
      if (dates.includes(date)) {
        return res.status(200).json({ ok: true, date, skipped: 'already written (use ?force=1 to append again)' })
      }
    }
    await appendRows(SHEET_ID, `${TAB}!A1`, rows)
    return res.status(200).json({ ok: true, date, written: rows.length })
  } catch (err) {
    console.error('[daily-stream-plan] failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
