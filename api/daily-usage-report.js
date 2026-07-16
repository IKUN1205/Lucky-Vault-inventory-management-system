// api/daily-usage-report.js
// Daily per-stream-room SEALED usage report (boss directive 2026-06-23).
// "How much sealed did each room burn today" — units + cost value + the
// top products each room went through. Mirrors the weekly buy report's
// usage half, scoped to a single PT day.
//
// Usage source (sealed only):
//   1. stream_counts × stream_count_items (expected − actual = sold that
//      session) — where stream-room sealed consumption actually lives.
//   2. platform_sales kind='sealed' (Shows etc. that sell sealed via the
//      Platform Sales page).
// Cost value per product: inventory.avg_cost_basis (mean of positive
// values), falling back to acquisitions lifetime avg (cost_usd / units).
//
// Cron: daily 07:00 UTC (~midnight PT) → reports the PT day that just
// ended, posts to LARK_WEBHOOK_INVENTORY_IO (main inventory group).
// Manual: ?date=YYYY-MM-DD | ?today=1 (current partial day) | &dry=1.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
// Routed to the LV MAG group (boss directive 2026-06-23). Falls back to
// the inventory-io group / main URL so the message is never dropped if
// LARK_WEBHOOK_LV_MAG isn't configured yet.
const LARK_URL = process.env.LARK_WEBHOOK_LV_MAG
  || process.env.LARK_WEBHOOK_INVENTORY_IO
  || process.env.LARK_WEBHOOK_URL

export const config = { maxDuration: 60 }

const fmtUsd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

// Sealed moves as whole boxes (product type 'Sealed') or loose packs (type
// 'Pack'). Quantity matters more than the cost ESTIMATE, so we surface the
// box/pack split everywhere instead of a flat "units" (boss 2026-06-24).
const isPackType = (p) => p?.type === 'Pack'
const fmtQty = (boxes, packs) => {
  const parts = []
  if (boxes) parts.push(`${boxes} box${boxes === 1 ? '' : 'es'}`)
  if (packs) parts.push(`${packs} pack${packs === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : '0 units'
}

const CHANNEL_SHORT = {
  PackHeadsTCG: 'Packheads', Packheads: 'Packheads',
  RocketsHQ: 'Rockets', LuckyVaultUS: 'Lucky',
  SlabbiePatty: 'Slabbie', Whatnot: 'Whatnot', Shows: 'Shows',
  PokeAuctionHouse: 'PokeAuction',
}
function roomShort(locationName) {
  const n = String(locationName || '').toLowerCase()
  if (n.includes('packheads')) return 'Packheads'
  if (n.includes('rockets') || n.includes('rocket')) return 'Rockets'
  if (n.includes('luckyvault') || n.includes('lucky')) return 'Lucky'
  if (n.includes('slabbie') || n.includes('patty')) return 'Slabbie'
  if (n.includes('whatnot')) return 'Whatnot'
  if (n.includes('pokeauction')) return 'PokeAuction'
  if (n.includes('show')) return 'Shows'
  return locationName || '?'
}
// Full display label: platform + channel (boss asked "what is Lucky?").
const ROOM_LABEL = {
  Lucky: 'eBay · LuckyVaultUS',
  Slabbie: 'eBay · SlabbiePatty',
  Packheads: 'TikTok · PackHeadsTCG',
  Rockets: 'TikTok · RocketsHQ',
  Whatnot: 'Whatnot',
  PokeAuction: 'PokeAuctionHouse',
  Shows: 'Card Show',
}
const roomLabel = (short) => ROOM_LABEL[short] || short
const productLabel = (p) => {
  if (!p) return '(unknown)'
  let s = p.name || '(unnamed)'
  if (p.language && p.language !== 'EN') s += ` [${p.language}]`
  return s
}

function ptToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
const shiftDate = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
// Mon–Sun week (date strings) containing the given YYYY-MM-DD.
function weekContaining(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7   // Mon=0 … Sun=6
  const mon = shiftDate(dateStr, -dow)
  return { from: mon, to: shiftDate(mon, 6) }
}
function nowPtStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} PT`
}

async function postLark(text) {
  if (!LARK_URL) return true
  try {
    const r = await fetch(LARK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    return r.ok
  } catch (e) { console.error('[daily-usage-report] Lark failed:', e); return false }
}

export async function computeDailyUsage(supabase, fromDate, toDate = fromDate) {
  // PT window for stream counts (count_time is a timestamp; evening
  // sessions sit inside [from 07:00Z, day-after-to 07:00Z) for PDT).
  const from = `${fromDate}T07:00:00Z`
  const to = `${shiftDate(toDate, 1)}T07:00:00Z`

  const [{ data: counts, error: cErr }, { data: usage, error: uErr }] = await Promise.all([
    // streamer_id = the SELLER (whose sells these are). Per the TikTok
    // handoff convention the NEXT streamer counts the PREVIOUS streamer's
    // sales, so the count's counted_by_id is the next person but
    // streamer_id is correctly the seller — we attribute usage to that.
    supabase.from('stream_counts')
      .select('id, location:locations(name), streamer:users!stream_counts_streamer_id_fkey(name)')
      .eq('deleted', false).gte('count_time', from).lt('count_time', to),
    supabase.from('platform_sales')
      .select('channel, quantity, product_id, product:products(name, brand, language, type), streamer:users!platform_sales_streamer_id_fkey(name)')
      .eq('deleted', false).eq('kind', 'sealed').gte('date', fromDate).lte('date', toDate),
  ])
  if (cErr) throw cErr
  if (uErr) throw uErr

  // count_id → { room, streamer name }
  const countMeta = new Map((counts || []).map(c => [c.id, { room: roomShort(c.location?.name), streamer: c.streamer?.name || '(unknown)' }]))
  const countItems = []
  const ids = [...countMeta.keys()]
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('stream_count_items')
      .select('stream_count_id, expected_qty, actual_qty, product_id, product:products(name, brand, language, type)')
      .in('stream_count_id', ids.slice(i, i + 100))
    if (error) throw error
    countItems.push(...(data || []))
  }

  // room → { label, byStreamer: Map(streamer → Map(pid → { product, units })) }
  const roomData = new Map()
  const usedPids = new Set()
  const add = (room, streamer, pid, product, units) => {
    if (!units || units <= 0) return
    const rd = roomData.get(room) || { byStreamer: new Map() }
    const sp = rd.byStreamer.get(streamer) || new Map()
    const e = sp.get(pid) || { product, units: 0 }
    e.units += units
    sp.set(pid, e)
    rd.byStreamer.set(streamer, sp)
    roomData.set(room, rd)
    if (pid) usedPids.add(pid)
  }
  for (const u of usage || []) add(CHANNEL_SHORT[u.channel] || u.channel || '?', u.streamer?.name || '(unknown)', u.product_id, u.product, Number(u.quantity) || 0)
  for (const it of countItems) {
    const m = countMeta.get(it.stream_count_id) || { room: '?', streamer: '(unknown)' }
    add(m.room, m.streamer, it.product_id, it.product, (Number(it.expected_qty) || 0) - (Number(it.actual_qty) || 0))
  }

  // unit cost per used product
  const unitCost = new Map()
  const pids = [...usedPids]
  for (let i = 0; i < pids.length; i += 100) {
    const { data } = await supabase.from('inventory').select('product_id, avg_cost_basis')
      .in('product_id', pids.slice(i, i + 100)).eq('deleted', false).gt('avg_cost_basis', 0)
    const agg = new Map()
    for (const r of data || []) { const a = agg.get(r.product_id) || { s: 0, n: 0 }; a.s += Number(r.avg_cost_basis); a.n++; agg.set(r.product_id, a) }
    for (const [pid, a] of agg) unitCost.set(pid, a.s / a.n)
  }
  const missing = pids.filter(p => !unitCost.has(p))
  for (let i = 0; i < missing.length; i += 100) {
    const { data } = await supabase.from('acquisitions').select('product_id, cost_usd, quantity_purchased')
      .in('product_id', missing.slice(i, i + 100)).eq('deleted', false).gt('cost_usd', 0)
    const agg = new Map()
    for (const r of data || []) { const a = agg.get(r.product_id) || { usd: 0, u: 0 }; a.usd += Number(r.cost_usd); a.u += Number(r.quantity_purchased) || 0; agg.set(r.product_id, a) }
    for (const [pid, a] of agg) if (a.u > 0) unitCost.set(pid, a.usd / a.u)
  }

  const priceItems = (pidMap) => [...pidMap.entries()]
    .map(([pid, e]) => ({ name: productLabel(e.product), units: e.units, usd: e.units * (unitCost.get(pid) || 0), type: e.product?.type }))
    .sort((a, b) => b.usd - a.usd)
  // boxes vs packs for a pid→{product,units} map
  const splitBoxPack = (pidMap) => {
    let boxes = 0, packs = 0
    for (const e of pidMap.values()) { if (isPackType(e.product)) packs += e.units; else boxes += e.units }
    return { boxes, packs }
  }

  const rooms = [...roomData.entries()].map(([room, rd]) => {
    // per-streamer breakdown (sorted by spend)
    const streamers = [...rd.byStreamer.entries()].map(([name, pidMap]) => {
      const products = priceItems(pidMap)
      const { boxes, packs } = splitBoxPack(pidMap)
      return { name, products, boxes, packs, units: products.reduce((s, x) => s + x.units, 0), usd: products.reduce((s, x) => s + x.usd, 0) }
    }).sort((a, b) => b.usd - a.usd)
    // aggregate products across all streamers for the room-level view
    const agg = new Map()
    for (const sp of rd.byStreamer.values()) for (const [pid, e] of sp) {
      const a = agg.get(pid) || { product: e.product, units: 0 }; a.units += e.units; agg.set(pid, a)
    }
    const products = priceItems(agg)
    return {
      room, label: roomLabel(room),
      units: streamers.reduce((s, x) => s + x.units, 0),
      boxes: streamers.reduce((s, x) => s + x.boxes, 0),
      packs: streamers.reduce((s, x) => s + x.packs, 0),
      usd: streamers.reduce((s, x) => s + x.usd, 0),
      products,    // ALL products (room total)
      streamers,   // per-streamer breakdown (boss directive 2026-06-23)
    }
  }).sort((a, b) => b.usd - a.usd)

  const single = fromDate === toDate
  return {
    period: single ? 'daily' : 'weekly',
    from: fromDate, to: toDate,
    range_label: single ? fromDate : `${fromDate} → ${toDate}`,
    rooms,
    total_units: rooms.reduce((s, r) => s + r.units, 0),
    total_boxes: rooms.reduce((s, r) => s + r.boxes, 0),
    total_packs: rooms.reduce((s, r) => s + r.packs, 0),
    total_usd: rooms.reduce((s, r) => s + r.usd, 0),
  }
}

function buildText(d) {
  const lines = []
  const head = d.period === 'weekly' ? 'Weekly' : 'Daily'
  lines.push(`📦 ${head} Sealed Usage — ${d.range_label}`)
  lines.push(`Total: ${fmtQty(d.total_boxes, d.total_packs)} · ${fmtUsd(d.total_usd)} at cost`)
  if (d.rooms.length === 0) { lines.push(''); lines.push('No sealed usage recorded.'); return lines.join('\n') }
  for (const r of d.rooms) {
    lines.push('')
    lines.push(`▼ ${r.label}: ${fmtQty(r.boxes, r.packs)} · ${fmtUsd(r.usd)}`)
    for (const s of (r.streamers || [])) {
      lines.push(`  ─ ${s.name}: ${fmtQty(s.boxes, s.packs)} · ${fmtUsd(s.usd)}`)
      for (const p of s.products) lines.push(`      ${p.name} ×${p.units} (${fmtUsd(p.usd)})`)
    }
  }
  lines.push('')
  lines.push(`Time: ${nowPtStamp()}`)
  return lines.join('\n')
}

export default async function handler(req, res) {
  const q = req.query || {}
  const isManual = q.date || q.today || q.week
  // Cron (no manual param) requires the secret; manual reads are open.
  if (CRON_SECRET && !isManual) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  // Window:
  //   ?week=YYYY-MM-DD → Mon–Sun week containing that date
  //   ?date=YYYY-MM-DD → that single day
  //   ?today=1         → today (single day)
  //   (cron, no param) → the PT day that just ended (yesterday)
  let fromDate, toDate
  if (q.week) {
    const w = weekContaining(String(q.week)); fromDate = w.from; toDate = w.to
  } else {
    const date = q.date ? String(q.date) : q.today ? ptToday() : shiftDate(ptToday(), -1)
    fromDate = date; toDate = date
  }

  try {
    const data = await computeDailyUsage(supabase, fromDate, toDate)
    const text = buildText(data)
    const larked = q.dry ? false : await postLark(text)
    return res.status(200).json({ ok: true, ...data, larked, text })
  } catch (err) {
    console.error('[daily-usage-report]', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
