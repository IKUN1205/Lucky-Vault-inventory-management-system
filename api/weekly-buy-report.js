// api/weekly-buy-report.js
// Weekly purchasing report (boss directive 2026-06-11): what we bought,
// what it cost, who bought it — cross-referenced against what each stream
// room actually consumed the same week, so over/under-buying is visible.
//
// Cron: Mondays 16:00 UTC (≈9 AM PT) covering the just-finished Mon–Sun
// week. Manual runs: ?week=YYYY-MM-DD (the week containing that date) or
// ?current=1 (the in-progress week).
//
// Money facts:
//   - spend counts ONLY real purchases (origin null / jp_vendor etc.).
//     origin='jp_to_us_shipment' rows are cross-border transfers of goods
//     ALREADY bought — counting their cost_usd would double-count, so
//     they're reported separately as transfers.
//   - usage = platform_sales (kind='sealed') per channel; slabs/singles
//     follow their own pipelines and aren't bought via Purchased Items.
//
// Routed to LARK_WEBHOOK_ACQUISITIONS (purchasing squad) with main-URL
// fallback.

import { createClient } from '@supabase/supabase-js'

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
  SlabbiePatty: 'Slabbie', Whatnot: 'Whatnot', Shows: 'Shows',
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
    const [{ data: buys, error: buyErr }, { data: usage, error: useErr }] = await Promise.all([
      supabase
        .from('acquisitions')
        .select('date_purchased, quantity_purchased, cost, currency, cost_usd, origin, acquirer:users!acquisitions_acquirer_id_fkey(name), vendor:vendors(name), product:products(name, brand, language, type)')
        .eq('deleted', false)
        .gte('date_purchased', window.from)
        .lte('date_purchased', window.to),
      supabase
        .from('platform_sales')
        .select('channel, quantity, product:products(name, brand, language, type)')
        .eq('deleted', false)
        .eq('kind', 'sealed')
        .gte('date', window.from)
        .lte('date', window.to),
    ])
    if (buyErr) throw buyErr
    if (useErr) throw useErr

    const purchases = (buys || []).filter(b => b.origin !== 'jp_to_us_shipment')
    const transfers = (buys || []).filter(b => b.origin === 'jp_to_us_shipment')

    // ---- aggregate buys ----
    let totalSpend = 0, totalUnits = 0
    const byAcquirer = new Map()   // name → { usd, orders, units }
    const byProduct = new Map()    // label → { usd, units, usedTotal, usedBy: Map }
    for (const b of purchases) {
      const usd = Number(b.cost_usd) || (b.currency === 'USD' ? Number(b.cost) || 0 : 0)
      const units = Number(b.quantity_purchased) || 0
      totalSpend += usd; totalUnits += units
      const who = b.acquirer?.name || '(unknown)'
      const a = byAcquirer.get(who) || { usd: 0, orders: 0, units: 0 }
      a.usd += usd; a.orders += 1; a.units += units
      byAcquirer.set(who, a)
      const label = productLabel(b.product)
      const p = byProduct.get(label) || { usd: 0, units: 0, usedTotal: 0, usedBy: new Map() }
      p.usd += usd; p.units += units
      byProduct.set(label, p)
    }

    // ---- aggregate stream-room usage ----
    const roomTotals = new Map()   // channel → units
    const usageByProduct = new Map()  // label → { total, by: Map(channel → units) }
    for (const u of usage || []) {
      const ch = CHANNEL_SHORT[u.channel] || u.channel || '?'
      const units = Number(u.quantity) || 0
      roomTotals.set(ch, (roomTotals.get(ch) || 0) + units)
      const label = productLabel(u.product)
      const e = usageByProduct.get(label) || { total: 0, by: new Map() }
      e.total += units
      e.by.set(ch, (e.by.get(ch) || 0) + units)
      usageByProduct.set(label, e)
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
    lines.push(`💰 Spent: ${fmtUsd(totalSpend)} · ${purchases.length} purchase${purchases.length === 1 ? '' : 's'} · ${totalUnits} units`)
    if (transfers.length > 0) {
      const tUsd = transfers.reduce((s, t) => s + (Number(t.cost_usd) || 0), 0)
      const tUnits = transfers.reduce((s, t) => s + (Number(t.quantity_purchased) || 0), 0)
      lines.push(`🚢 JP→US transfers (not new spend): ${tUnits} units · ${fmtUsd(tUsd)} value`)
    }

    if (byAcquirer.size > 0) {
      lines.push('')
      lines.push('By buyer:')
      for (const [who, a] of [...byAcquirer.entries()].sort((x, y) => y[1].usd - x[1].usd)) {
        lines.push(`  • ${who}: ${fmtUsd(a.usd)} (${a.orders} order${a.orders === 1 ? '' : 's'} / ${a.units} units)`)
      }
    }

    if (byProduct.size > 0) {
      lines.push('')
      lines.push('Bought vs used this week (sealed, stream rooms):')
      const sorted = [...byProduct.entries()].sort((x, y) => y[1].usd - x[1].usd)
      const MAX_LINES = 14
      for (const [label, p] of sorted.slice(0, MAX_LINES)) {
        const pct = p.units > 0 ? Math.round((p.usedTotal / p.units) * 100) : 0
        const rooms = [...p.usedBy.entries()].sort((a, b) => b[1] - a[1])
          .map(([ch, n]) => `${ch} ${n}`).join(', ')
        lines.push(`  • ${label}: bought ${p.units} (${fmtUsd(p.usd)}) · used ${p.usedTotal}${rooms ? ` (${rooms})` : ''} → ${pct}%`)
      }
      if (sorted.length > MAX_LINES) lines.push(`  …and ${sorted.length - MAX_LINES} more products`)
    }

    if (roomTotals.size > 0) {
      lines.push('')
      lines.push('Room usage this week (all sealed, incl. items bought earlier):')
      for (const [ch, n] of [...roomTotals.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  • ${ch}: ${n} units`)
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
