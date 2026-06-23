// api/weekly-usage-digest.js
// Weekly (Monday ~9 AM PT) rollup of last week's goods usage by channel,
// posted to Lark. "Usage" = units sold to customers (real outflows):
//   门店 storefront_sales · 直播 stream_counts.total_sold · 线上 online order items
// 日本 japan_stream_sales reported separately (different warehouse).
// Internal flows (moves / break box / JP→US transfer / legacy platform_sales)
// are excluded so the number reflects demand, not stock shuffling.
//
// Mirrors fetchWeeklyUsage in src/lib/supabase.js — keep the two in sync.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
// Management summary → main "all activity" group by default.
const LARK_URL = process.env.LARK_WEBHOOK_WEEKLY_USAGE
  || process.env.LARK_WEBHOOK_URL

export const config = { maxDuration: 30 }

// 'YYYY-MM-DD' for today in PT.
function ptToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
const ymd = (d) => {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}
// Monday of the week containing the PT date string (computed in UTC-noon to
// dodge DST edges), then step back a week for "last week".
function lastWeekRange() {
  const today = new Date(`${ptToday()}T12:00:00Z`)
  const dow = (today.getUTCDay() + 6) % 7   // 0 = Monday
  const thisMon = new Date(today); thisMon.setUTCDate(today.getUTCDate() - dow)
  const lastMon = new Date(thisMon); lastMon.setUTCDate(thisMon.getUTCDate() - 7)
  const lastSun = new Date(lastMon); lastSun.setUTCDate(lastMon.getUTCDate() + 6)
  const nextMon = new Date(lastSun); nextMon.setUTCDate(lastSun.getUTCDate() + 1)
  return { start: ymd(lastMon), end: ymd(lastSun), endNext: ymd(nextMon) }
}

const sumKey = (rows, key) => (rows || []).reduce((s, x) => s + (Number(x[key]) || 0), 0)

export default async function handler(req, res) {
  if (CRON_SECRET) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!LARK_URL) return res.status(500).json({ error: 'No Lark webhook configured' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const { start, end, endNext } = lastWeekRange()

  try {
    const [sfRes, scRes, ooRes, jpRes] = await Promise.all([
      supabase.from('storefront_sales').select('quantity, product:products(name, short_code, category)').eq('deleted', false).gte('date', start).lte('date', end),
      supabase.from('stream_counts').select('id, total_sold').eq('deleted', false).gte('count_time', start).lt('count_time', endNext),
      supabase.from('online_orders').select('id').eq('deleted', false).gte('date', start).lte('date', end),
      supabase.from('japan_stream_sales').select('quantity, channel').eq('deleted', false).gte('sale_date', start).lte('sale_date', end),
    ])
    for (const r of [sfRes, scRes, ooRes, jpRes]) if (r.error) throw r.error

    // Stream line items (sold rows) for top-seller detail.
    const scIds = (scRes.data || []).map(s => s.id)
    let sciData = []
    if (scIds.length) {
      const { data, error } = await supabase
        .from('stream_count_items')
        .select('expected_qty, actual_qty, product:products(name, short_code, category)')
        .in('stream_count_id', scIds).lt('difference', 0).limit(5000)
      if (error) throw error
      sciData = data || []
    }

    let onlineUnits = 0
    const orderIds = (ooRes.data || []).map(o => o.id)
    let ooiData = []
    if (orderIds.length) {
      const { data: items, error } = await supabase
        .from('online_order_items')
        .select('quantity, product:products(name, short_code, category)')
        .in('order_id', orderIds).limit(5000)
      if (error) throw error
      ooiData = items || []
      onlineUnits = sumKey(ooiData, 'quantity')
    }

    const storefront = sumKey(sfRes.data, 'quantity')
    const stream = sumKey(scRes.data, 'total_sold')
    const usTotal = storefront + stream + onlineUnits
    const japan = sumKey(jpRes.data, 'quantity')

    // Top sellers (US, 货物 only) — combine all three channels per product.
    const cleanName = (p) => {
      const name = p?.name || '(unknown)'
      const cat = p?.category
      const trimmed = cat ? name.replace(new RegExp(`\\s*${cat}\\s*$`, 'i'), '').trim() || name : name
      return `${p?.short_code ? p.short_code + ' ' : ''}${trimmed}`
    }
    const top = new Map()
    const bump = (p, q) => { const k = cleanName(p); top.set(k, (top.get(k) || 0) + (Number(q) || 0)) }
    for (const r of sfRes.data || []) bump(r.product, r.quantity)
    for (const r of sciData || []) bump(r.product, (Number(r.expected_qty) || 0) - (Number(r.actual_qty) || 0))
    for (const r of ooiData) bump(r.product, r.quantity)
    const topSellers = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    const lines = [
      '📦 上周货物用量 / Weekly Usage (只统计货物,不含散卡/评级卡)',
      `${start} → ${end} (Mon–Sun)`,
      '',
      `🏪 门店 Storefront:  ${storefront.toLocaleString()} 件`,
      `📺 直播 Livestream:  ${stream.toLocaleString()} 件`,
      `🛒 线上 Online:      ${onlineUnits.toLocaleString()} 件`,
      `🇺🇸 美国合计:        ${usTotal.toLocaleString()} 件`,
      '',
      `🇯🇵 日本仓 (单独):   ${japan.toLocaleString()} 件`,
    ]
    if (topSellers.length) {
      lines.push('')
      lines.push('🔥 美国卖得最多的货物:')
      topSellers.forEach(([name, qty], i) => lines.push(`  ${i + 1}. ${name} × ${qty}`))
    }
    const text = lines.join('\n')

    const r = await fetch(LARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    const body = await r.text()
    if (!r.ok) return res.status(502).json({ error: 'Lark webhook failed', status: r.status, details: body })
    return res.status(200).json({ ok: true, range: { start, end }, usTotal, japan })
  } catch (err) {
    console.error('[weekly-usage-digest] failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
