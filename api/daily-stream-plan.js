// api/daily-stream-plan.js
// Daily 5 AM PT (12:00 UTC) cron: creates a PER-DAY tab (named "M/D", e.g.
// "9/24") in William's scheduling Google Sheet and fills that day's stream
// plan — one row per live session:
//   date · room · streamer · time(PT) · title (fixed template) ·
//   Batch 货单 (BLANK — surprise sets are curated by William) ·
//   room-stock reference · Master-stock reference
//
// One-tab-per-day per William 2026-09-24 ("不要改变现有的,新建一个tab然后填")
// — existing tabs are NEVER modified; if the day's tab already exists the run
// skips (that's also the idempotency guard). Sessions come from SHIFT_CONFIG
// (2026-09-21 schedule; edit here when shifts change).
//
// Manual:
//   ?dry=1                    — compute + return rows, write nothing
//   ?date=YYYY-MM-DD          — plan that date instead of today (PT)
//   POST ?setbatch=1 {date?, streamer, batch}
//                             — fill the Batch cell (col F) in that day's tab
//
// Room mapping (assumption, flagged 2026-09-24):
//   eBay 3     → "Stream Room - PokeAuctionHouse" (Quinn / Lexi)
//   new TikTok → "Stream Room - PokeCasino"       (Jacob / Jace)

import { createClient } from '@supabase/supabase-js'
import { readRange, appendRows, getSheetIds, addSheetTab, batchUpdateValues } from './_lib/google-sheets.js'

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

export const config = { maxDuration: 60 }

// ---- shift schedule (PT). getDay(): Sun=0 … Sat=6 ----------------------
const EBAY_ROOM = 'Stream Room - PokeAuctionHouse'
const TIKTOK_ROOM = 'Stream Room - PokeCasino'

const SHIFT_CONFIG = [
  { streamer: 'Quinn', room: EBAY_ROOM,   days: [1, 2],             time: '9:00am–4:00pm' },
  { streamer: 'Quinn', room: EBAY_ROOM,   days: [4, 5],             time: '10:00am–6:00pm' },
  { streamer: 'Lexi',  room: EBAY_ROOM,   days: [1, 2],             time: '5:00pm–12:00am' },
  { streamer: 'Lexi',  room: EBAY_ROOM,   days: [4, 5],             time: '8:00pm–3:00am' },
  { streamer: 'Lexi',  room: EBAY_ROOM,   days: [6],                time: '6:00pm–12:00am' },
  { streamer: 'Jacob', room: TIKTOK_ROOM, days: [1, 2, 3, 4, 5, 6], time: '9:00am–3:00pm' },
  { streamer: 'Jace',  room: TIKTOK_ROOM, days: [2, 3, 4, 5],       time: '3:00pm–7:00pm' },
]

const TITLES = {
  [EBAY_ROOM]:   'Pokémon Card Auctions 🔥 $1 STARTS — {MM/DD}',
  [TIKTOK_ROOM]: '🎰 Pokémon Rips & Surprise Sets — LIVE {MM/DD}',
}

const HEADER = ['日期', '房间', '主播', '时间(PT)', '直播标题', 'Batch 货单(你填)', '房间现货参考', '总仓可调参考']

// ---- date helpers ------------------------------------------------------
function ptToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = t => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
const dowOf = ymd => new Date(`${ymd}T12:00:00Z`).getUTCDay()
// Per-day tab title, matching how William names things: "9/24"
const tabNameFor = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`
// Sheets serial (epoch 1899-12-30): USER_ENTERED parses YYYY-MM-DD into a
// date cell; UNFORMATTED_VALUE reads it back as this number.
const sheetSerial = ymd => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
}
const matchesDate = (cell, ymd) => cell === ymd || Number(cell) === sheetSerial(ymd)
// Tab names contain "/" — always quote them in A1 ranges.
const a1 = (tab, ref) => `'${tab}'!${ref}`

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
  const shown = sealed.slice(0, topN).map(r => `${r.product.name} ×${r.quantity}`).join(' · ')
  const more = sealed.length > topN ? ` (+${sealed.length - topN} 种)` : ''
  return shown + more
}

export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`
      && !req.query?.dry && !req.query?.date && !req.query?.setbatch) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })

  const date = (req.query?.date || (typeof req.body === 'object' && req.body?.date) || ptToday())
  const tab = tabNameFor(date)
  const dow = dowOf(date)
  const mmdd = `${date.slice(5, 7)}/${date.slice(8, 10)}`
  const sessions = SHIFT_CONFIG.filter(s => s.days.includes(dow))

  // ---- setbatch: fill col F for one streamer in the day's tab ----------
  if (req.query?.setbatch) {
    try {
      const body = typeof req.body === 'object' && req.body ? req.body : {}
      const bStreamer = body.streamer || req.query?.streamer
      const bBatch = body.batch
      if (!bStreamer || !bBatch) {
        return res.status(400).json({ error: 'POST JSON body needs { streamer, batch } (date optional, defaults today)' })
      }
      const tabs = await getSheetIds(SHEET_ID)
      if (!tabs.has(tab)) return res.status(404).json({ error: `tab "${tab}" not found — run the daily plan first` })
      const grid = await readRange(SHEET_ID, a1(tab, 'A:C'))
      const rowsArr = Array.isArray(grid) ? grid : []
      const hit = rowsArr.findIndex(r => matchesDate(r?.[0], date) && String(r?.[2] || '').trim() === bStreamer)
      if (hit < 0) return res.status(404).json({ error: `no row for ${bStreamer} in tab "${tab}"` })
      await batchUpdateValues(SHEET_ID, [{ range: a1(tab, `F${hit + 1}`), values: [[bBatch]] }])
      return res.status(200).json({ ok: true, tab, streamer: bStreamer, row: hit + 1, batch: bBatch })
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  // ---- daily plan: create the per-day tab and fill it ------------------
  if (!sessions.length) {
    return res.status(200).json({ ok: true, date, tab, message: '当天没有排班场次(按现行班表)', written: 0 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const rooms = [...new Set(sessions.map(s => s.room))]
  const roomStock = {}
  for (const r of rooms) roomStock[r] = await stockRef(supabase, r)
  const masterStock = await stockRef(supabase, 'Master Inventory')

  const rows = sessions.map(s => ([
    date,
    s.room.replace('Stream Room - ', ''),
    s.streamer,
    s.time,
    (TITLES[s.room] || '').replace('{MM/DD}', mmdd),
    '',
    roomStock[s.room],
    masterStock,
  ]))

  if (req.query?.dry) {
    return res.status(200).json({ ok: true, dry: true, date, tab, header: HEADER, rows })
  }

  try {
    // NEVER touch existing tabs: if the day's tab exists, skip entirely.
    const tabs = await getSheetIds(SHEET_ID)
    if (tabs.has(tab)) {
      return res.status(200).json({ ok: true, date, tab, skipped: `tab "${tab}" already exists — not touching it` })
    }
    await addSheetTab(SHEET_ID, tab)
    await appendRows(SHEET_ID, a1(tab, 'A1'), [HEADER, ...rows])
    return res.status(200).json({ ok: true, date, tab, written: rows.length })
  } catch (err) {
    console.error('[daily-stream-plan] failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
