// api/weekly-buy-report.js
// Weekly purchasing report (boss directive 2026-06-11): what we bought,
// what it cost, who bought it — cross-referenced against what each stream
// room actually consumed the same week, so over/under-buying is visible.
//
// Cron: Mondays 16:00 UTC (≈9 AM PT) covering the just-finished Mon–Sun
// week. Manual runs: ?week=YYYY-MM-DD (the week containing that date) or
// ?current=1 (the in-progress week).
//
// Money facts (boss directive 2026-06-11, revised same day "我想要日本和
// 美国两个分别买了多少钱"):
//   - Spend = real purchases on BOTH sides, split 🇺🇸 US vs 🇯🇵 Japan
//     (origin='jp_vendor'). Each side gets its own what-we-bought list.
//   - origin='jp_to_us_shipment' is logistics, NOT spend — the goods were
//     already counted when bought in Japan. Shown as one 🚢 FYI line.
//   - usage = SEALED only, from two sources merged:
//       1. stream_counts × stream_count_items (expected − actual = sold
//          that session) — this is where stream-room sealed consumption
//          actually lives (verified 2026-06-11: platform_sales has zero
//          sealed rows; rooms count sealed at streamer handoff instead)
//       2. platform_sales kind='sealed' — covers channels that sell
//          sealed through the Platform Sales page (e.g. Shows).
//     Slabs/singles follow their own pipelines and aren't bought via
//     Purchased Items, so they're out of scope here.
//
// Routed to LARK_WEBHOOK_ACQUISITIONS (purchasing squad) with main-URL
// fallback.

import { createClient } from '@supabase/supabase-js'
import { isLedgerRoomName } from '../src/lib/countRooms.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LARK_URL = process.env.LARK_WEBHOOK_ACQUISITIONS
  || process.env.LARK_WEBHOOK_URL

export const config = { maxDuration: 60 }

const fmtUsd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

function ptToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// Mon–Sun week (date strings) containing the given YYYY-MM-DD.
function weekContaining(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7   // Mon=0 … Sun=6
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  const f = (x) => x.toISOString().slice(0, 10)
  return { from: f(mon), to: f(sun) }
}

const productLabel = (p) => {
  if (!p) return '(unknown product)'
  const parts = [p.brand, p.name].filter(Boolean)
  let s = parts.join(' | ') || '(unnamed)'
  if (p.language && p.language !== 'EN') s += ` [${p.language}]`
  if (p.type) s += ` ${p.type}`
  return s
}

// Short room labels for the per-channel usage breakdown.
const CHANNEL_SHORT = {
  PackHeadsTCG: 'Packheads', Packheads: 'Packheads',
  RocketsHQ: 'Rockets', LuckyVaultUS: 'Lucky',
  SlabbiePatty: 'Slabbie', Whatnot: 'PokeCasino', Shows: 'Shows',
  PokeAuctionHouse: 'PokeAuction',
}
// Stream-count rooms are identified by location NAME ("Stream Room -
// TikTok Packheads") — collapse to the same short labels.
function roomShort(locationName) {
  const n = String(locationName || '').toLowerCase()
  if (n.includes('packheads')) return 'Packheads'
  if (n.includes('rockets') || n.includes('rocket')) return 'Rockets'
  if (n.includes('luckyvault') || n.includes('lucky')) return 'Lucky'
  if (n.includes('slabbie') || n.includes('patty')) return 'Slabbie'
  if (n.includes('whatnot') || n.includes('pokecasino')) return 'PokeCasino'
  if (n.includes('pokeauction')) return 'PokeAuction'
  if (n.includes('show')) return 'Shows'
  return locationName || '?'
}
const nextDay = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function postLark(text) {
  if (!LARK_URL) return false
  try {
    const r = await fetch(LARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    return r.ok
  } catch (e) { console.error('[weekly-buy-report] Lark failed:', e); return false }
}

export default async function handler(req, res) {
  if (CRON_SECRET && !req.query?.week && !req.query?.current) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  const q = req.query || {}
  let window
  if (q.week) window = weekContaining(String(q.week))
  else if (q.current) window = weekContaining(ptToday())
  else {
    // default (cron): the just-finished week — anchor 7 days back
    const t = new Date(`${ptToday()}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 7)
    window = weekContaining(t.toISOString().slice(0, 10))
  }

  try {
    // Stream-count sessions happen evenings PT, so the timestamp filter
    // shifts the window by UTC-7 to keep "this week" in boss time.
    const countFrom = `${window.from}T07:00:00Z`
    const countTo = `${nextDay(window.to)}T07:00:00Z`
    const [
      { data: buys, error: buyErr },
      { data: usage, error: useErr },
      { data: counts, error: cntErr },
    ] = await Promise.all([
      supabase
        .from('acquisitions')
        .select('date_purchased, quantity_purchased, cost, currency, cost_usd, origin, acquirer:users!acquisitions_acquirer_id_fkey(name), vendor:vendors(name), product:products(name, brand, language, type)')
        .eq('deleted', false)
        .gte('date_purchased', window.from)
        .lte('date_purchased', window.to),
      supabase
        .from('platform_sales')
        .select('channel, quantity, product_id, product:products(name, brand, language, type)')
        .eq('deleted', false)
        .eq('kind', 'sealed')
        .gte('date', window.from)
        .lte('date', window.to),
      supabase
        .from('stream_counts')
        .select('id, location:locations(name)')
        .eq('deleted', false)
        .gte('count_time', countFrom)
        .lt('count_time', countTo),
    ])
    if (buyErr) throw buyErr
    if (useErr) throw useErr
    if (cntErr) throw cntErr

    // Per-product sold quantities for those count sessions (expected −
    // actual = sold). Batched .in() — a week is a handful of sessions.
    // Ledger rooms (Front Store / Master) count on the same page but their
    // shortfall is NOT sales — countRooms.js, 2026-08-24.
    const roomByCountId = new Map((counts || [])
      .filter(c => !isLedgerRoomName(c.location?.name))
      .map(c => [c.id, roomShort(c.location?.name)]))
    const countItems = []
    const countIds = [...roomByCountId.keys()]
    for (let i = 0; i < countIds.length; i += 100) {
      const { data, error } = await supabase
        .from('stream_count_items')
        .select('stream_count_id, expected_qty, actual_qty, product_id, product:products(name, brand, language, type)')
        .in('stream_count_id', countIds.slice(i, i + 100))
      if (error) throw error
      countItems.push(...(data || []))
    }

    // Real purchases (both sides); shipments are logistics, not spend.
    const purchases = (buys || []).filter(b => b.origin !== 'jp_to_us_shipment')
    const jpShipped = (buys || []).filter(b => b.origin === 'jp_to_us_shipment')
    const sideOf = (b) => (b.origin === 'jp_vendor' ? 'jp' : 'us')

    // ---- aggregate buys ----
    let totalSpend = 0, totalUnits = 0
    const sideTotals = { us: { usd: 0, units: 0 }, jp: { usd: 0, units: 0 } }
    const byAcquirer = new Map()   // name → { usd, orders, units }
    const byProduct = new Map()    // label → { usd, units, usedTotal, usedBy: Map }
    const byProductSide = { us: new Map(), jp: new Map() }  // label → { usd, units }
    for (const b of purchases) {
      const usd = Number(b.cost_usd) || (b.currency === 'USD' ? Number(b.cost) || 0 : 0)
      const units = Number(b.quantity_purchased) || 0
      const side = sideOf(b)
      totalSpend += usd; totalUnits += units
      sideTotals[side].usd += usd; sideTotals[side].units += units
      const who = b.acquirer?.name || '(unknown)'
      const a = byAcquirer.get(who) || { usd: 0, orders: 0, units: 0 }
      a.usd += usd; a.orders += 1; a.units += units
      byAcquirer.set(who, a)
      const label = productLabel(b.product)
      const p = byProduct.get(label) || { usd: 0, units: 0, usedTotal: 0, usedBy: new Map() }
      p.usd += usd; p.units += units
      byProduct.set(label, p)
      const ps = byProductSide[side].get(label) || { usd: 0, units: 0 }
      ps.usd += usd; ps.units += units
      byProductSide[side].set(label, ps)
    }

    // ---- aggregate stream-room usage (both sources, same shape) ----
    const roomTotals = new Map()   // room → units
    const usageByProduct = new Map()  // label → { total, by: Map(room → units) }
    const roomProducts = new Map()    // room → Map(pid → { product, units })
    const usedPids = new Set()
    const addUsage = (room, pid, product, units) => {
      if (!units || units <= 0) return
      roomTotals.set(room, (roomTotals.get(room) || 0) + units)
      const label = productLabel(product)
      const e = usageByProduct.get(label) || { total: 0, by: new Map() }
      e.total += units
      e.by.set(room, (e.by.get(room) || 0) + units)
      usageByProduct.set(label, e)
      if (pid) {
        usedPids.add(pid)
        const rp = roomProducts.get(room) || new Map()
        const p = rp.get(pid) || { product, units: 0 }
        p.units += units
        rp.set(pid, p)
        roomProducts.set(room, rp)
      }
    }
    for (const u of usage || []) {
      addUsage(CHANNEL_SHORT[u.channel] || u.channel || '?', u.product_id, u.product, Number(u.quantity) || 0)
    }
    for (const it of countItems) {
      const sold = (Number(it.expected_qty) || 0) - (Number(it.actual_qty) || 0)
      addUsage(roomByCountId.get(it.stream_count_id) || '?', it.product_id, it.product, sold)
    }

    // ---- unit cost per used product, for $-valuing room usage ----
    // Prefer the maintained inventory avg_cost_basis (mean of positive
    // values across locations); fall back to acquisitions-derived
    // average (lifetime cost_usd / units) for products with no inventory
    // cost yet. Products with neither stay $0-valued.
    const unitCost = new Map()   // pid → usd per unit
    {
      const pids = [...usedPids]
      for (let i = 0; i < pids.length; i += 100) {
        const { data, error } = await supabase
          .from('inventory')
          .select('product_id, avg_cost_basis')
          .in('product_id', pids.slice(i, i + 100))
          .eq('deleted', false)
          .gt('avg_cost_basis', 0)
        if (error) throw error
        const agg = new Map()
        for (const r of data || []) {
          const a = agg.get(r.product_id) || { sum: 0, n: 0 }
          a.sum += Number(r.avg_cost_basis); a.n += 1
          agg.set(r.product_id, a)
        }
        for (const [pid, a] of agg) unitCost.set(pid, a.sum / a.n)
      }
      const missing = pids.filter(p => !unitCost.has(p))
      for (let i = 0; i < missing.length; i += 100) {
        const { data, error } = await supabase
          .from('acquisitions')
          .select('product_id, cost_usd, quantity_purchased')
          .in('product_id', missing.slice(i, i + 100))
          .eq('deleted', false)
          .gt('cost_usd', 0)
        if (error) throw error
        const agg = new Map()
        for (const r of data || []) {
          const a = agg.get(r.product_id) || { usd: 0, units: 0 }
          a.usd += Number(r.cost_usd); a.units += Number(r.quantity_purchased) || 0
          agg.set(r.product_id, a)
        }
        for (const [pid, a] of agg) if (a.units > 0) unitCost.set(pid, a.usd / a.units)
      }
    }
    // attach usage to bought products
    let usedUnitsOfBought = 0
    for (const [label, p] of byProduct) {
      const u = usageByProduct.get(label)
      if (u) { p.usedTotal = u.total; p.usedBy = u.by; usedUnitsOfBought += u.total }
    }

    // ---- build the Lark message ----
    const lines = []
    lines.push(`📦 Weekly Buy Report — ${window.from} → ${window.to}`)
    lines.push('')
    lines.push('1️⃣ Spend this week')
    lines.push(`💰 Total: ${fmtUsd(totalSpend)} · ${purchases.length} purchase${purchases.length === 1 ? '' : 's'} · ${totalUnits} units`)
    lines.push(`   🇺🇸 US: ${fmtUsd(sideTotals.us.usd)} (${sideTotals.us.units} units) · 🇯🇵 Japan: ${fmtUsd(sideTotals.jp.usd)} (${sideTotals.jp.units} units)`)
    if (jpShipped.length > 0) {
      const tUsd = jpShipped.reduce((s, t) => s + (Number(t.cost_usd) || 0), 0)
      const tUnits = jpShipped.reduce((s, t) => s + (Number(t.quantity_purchased) || 0), 0)
      lines.push(`   🚢 Shipped JP→US this week: ${tUnits} units · ${fmtUsd(tUsd)} (logistics — already counted when bought)`)
    }

    const pushSideBuys = (flag, side) => {
      const m = byProductSide[side]
      if (m.size === 0) return
      lines.push(`${flag} ${side === 'us' ? 'US' : 'Japan'} — ${fmtUsd(sideTotals[side].usd)}:`)
      const sorted = [...m.entries()].sort((x, y) => y[1].usd - x[1].usd)
      const MAX = 7
      for (const [label, p] of sorted.slice(0, MAX)) {
        lines.push(`  • ${label}: ${p.units} units · ${fmtUsd(p.usd)}`)
      }
      if (sorted.length > MAX) {
        const restUsd = sorted.slice(MAX).reduce((s, [, p]) => s + p.usd, 0)
        lines.push(`  …and ${sorted.length - MAX} more (${fmtUsd(restUsd)})`)
      }
    }
    if (byProduct.size > 0) {
      lines.push('')
      lines.push('2️⃣ What we bought')
      pushSideBuys('🇺🇸', 'us')
      pushSideBuys('🇯🇵', 'jp')
    }

    if (byAcquirer.size > 0) {
      lines.push('')
      lines.push('3️⃣ Who bought')
      for (const [who, a] of [...byAcquirer.entries()].sort((x, y) => y[1].usd - x[1].usd)) {
        lines.push(`  • ${who}: ${fmtUsd(a.usd)} (${a.orders} order${a.orders === 1 ? '' : 's'} / ${a.units} units)`)
      }
    }

    if (roomProducts.size > 0) {
      lines.push('')
      lines.push('4️⃣ Each room — burned vs bought this week (sealed, at cost)')
      // short product label for the room lines (full brand|name|type is too long)
      const shortLabel = (p) => {
        let s = p?.name || '(unknown)'
        if (p?.language && p.language !== 'EN') s += ` [${p.language}]`
        return s
      }
      const roomRows = [...roomProducts.entries()].map(([room, rp]) => {
        const items = [...rp.entries()].map(([pid, p]) => ({
          product: p.product, units: p.units, usd: p.units * (unitCost.get(pid) || 0),
        }))
        const usd = items.reduce((s, p) => s + p.usd, 0)
        return { room, usd, items }
      }).sort((a, b) => b.usd - a.usd)
      for (const r of roomRows) {
        lines.push(`  • ${r.room} burned ${fmtUsd(r.usd)}:`)
        const top = r.items.sort((a, b) => b.usd - a.usd).slice(0, 3)
        for (const p of top) {
          const b = byProduct.get(productLabel(p.product))
          const boughtStr = b ? `bought ${b.units} (${fmtUsd(b.usd)})` : 'bought 0 this week'
          lines.push(`      ${shortLabel(p.product)} ×${p.units} (${fmtUsd(p.usd)}) — ${boughtStr}`)
        }
        if (r.items.length > 3) lines.push(`      +${r.items.length - 3} more products`)
      }
    }

    const overallPct = totalUnits > 0 ? Math.round((usedUnitsOfBought / totalUnits) * 100) : null
    lines.push('')
    if (overallPct != null) {
      lines.push(`⚖️ This week's buys already consumed: ${overallPct}% of units (same-week sales of the same products)`)
    }
    // call out the extremes so 合理性 jumps out without reading every line
    const overBought = [...byProduct.entries()]
      .filter(([, p]) => p.units >= 10 && p.units > 0 && (p.usedTotal / p.units) < 0.2)
      .sort((x, y) => y[1].usd - x[1].usd).slice(0, 5)
    if (overBought.length > 0) {
      lines.push(`⚠️ Big buys barely moving (<20% used): ${overBought.map(([l, p]) => `${l} (${p.usedTotal}/${p.units})`).join('; ')}`)
    }

    const text = lines.join('\n')
    const larked = q.dry ? false : await postLark(text)

    return res.status(200).json({
      ok: true, window, larked,
      totals: { spend_usd: Math.round(totalSpend * 100) / 100, purchases: purchases.length, units: totalUnits },
      text,
    })
  } catch (err) {
    console.error('[weekly-buy-report]', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
