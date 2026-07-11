// api/cash-count.js
// Twice-daily cash-drawer audit (boss directive 2026-06-16).
//
//   GET  /api/cash-count                 → { expected, prior, cash_net_since, recent[] }
//        (what the drawer SHOULD hold right now — for the live UI display)
//   POST /api/cash-count                 → record a physical count
//        body { period, counted_amount, cash_removed_usd?, counted_by_id?,
//               counted_by_name?, notes?, send_lark? }
//        computes expected, stores the row, and (unless send_lark===false)
//        Larks the Storefront group ✅ match / ⚠️ off-by-$X.
//
// Expected = (prior count's counted_amount − prior count's cash_removed)
//            + cash net of cash transactions SINCE the prior count.
// First-ever count is a baseline (expected = counted, difference 0).
//
// Cash-net logic mirrors cash-alert-eod.js exactly (sales add, buys
// subtract, split payments count only their Cash slice) but windowed by
// timestamp instead of a whole PT day:
//   - storefront_sales: created_at (= sale time) in (since, until]
//   - singles / slabs:   updated_at (≈ sale time) in (since, until]
//   - storefront_payments: created_at in (since, until], Cash method only

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const LARK_STOREFRONT = process.env.LARK_WEBHOOK_STOREFRONT
  || process.env.LARK_WEBHOOK_URL

export const config = { maxDuration: 30 }

// $1 tolerance — counts within a dollar read as "matches" (rounding /
// coin slop shouldn't cry wolf). Anything more is flagged.
const TOLERANCE = 1.0

function ptDateToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
function nowPtStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} PT`
}
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Signed cash flow of cash transactions created/updated in (sinceISO, untilISO].
// sinceISO may be null → from the beginning of time.
async function cashNetInWindow(supabase, sinceISO, untilISO) {
  const { data: cashRow } = await supabase
    .from('payment_methods').select('id').eq('name', 'Cash').maybeSingle()
  const cashMethodId = cashRow?.id
  if (!cashMethodId) return 0

  const win = (q, col) => {
    let r = q
    if (sinceISO) r = r.gt(col, sinceISO)
    if (untilISO) r = r.lte(col, untilISO)
    return r
  }
  const [salesRes, singlesRes, slabsRes] = await Promise.all([
    win(supabase.from('storefront_sales')
      .select('transaction_id, net_cash_usd, payment_method_id, created_at')
      .eq('deleted', false).not('transaction_id', 'is', null), 'created_at'),
    win(supabase.from('singles')
      .select('transaction_id, net_cash_usd, payment_method_id, updated_at')
      .not('transaction_id', 'is', null).eq('status', 'sold'), 'updated_at'),
    win(supabase.from('slabs')
      .select('transaction_id, net_cash_usd, payment_method_id, updated_at')
      .not('transaction_id', 'is', null).eq('status', 'sold'), 'updated_at'),
  ])
  if (salesRes.error) throw salesRes.error
  if (singlesRes.error) throw singlesRes.error
  if (slabsRes.error) throw slabsRes.error

  const txMeta = new Map()
  for (const rows of [salesRes.data, singlesRes.data, slabsRes.data]) {
    for (const r of rows || []) {
      if (!txMeta.has(r.transaction_id)) {
        txMeta.set(r.transaction_id, { netCash: Number(r.net_cash_usd) || 0, pmId: r.payment_method_id })
      }
    }
  }
  const txIds = [...txMeta.keys()]
  if (txIds.length === 0) return 0

  let cashNet = 0
  const splitCovered = new Set()
  for (let i = 0; i < txIds.length; i += 200) {
    const { data, error } = await supabase
      .from('storefront_payments')
      .select('transaction_id, amount_usd')
      .in('transaction_id', txIds.slice(i, i + 200))
      .eq('payment_method_id', cashMethodId)
    if (error) throw error
    for (const p of data || []) {
      const meta = txMeta.get(p.transaction_id)
      if (!meta) continue
      cashNet += (meta.netCash >= 0 ? 1 : -1) * (Number(p.amount_usd) || 0)
      splitCovered.add(p.transaction_id)
    }
  }
  for (const [txid, meta] of txMeta) {
    if (splitCovered.has(txid)) continue
    if (meta.pmId === cashMethodId) cashNet += meta.netCash
  }
  return +cashNet.toFixed(2)
}

// Compute expected drawer balance right now (or at a given moment).
async function computeExpected(supabase) {
  const { data: priorRows, error } = await supabase
    .from('cash_counts')
    .select('id, created_at, counted_amount, cash_removed_usd, period, pt_date')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const prior = priorRows?.[0] || null
  if (!prior) {
    // No history — the first count is a baseline, nothing to expect against.
    return { expected: null, prior: null, cash_net_since: null, baseline: true }
  }
  const base = (Number(prior.counted_amount) || 0) - (Number(prior.cash_removed_usd) || 0)
  const net = await cashNetInWindow(supabase, prior.created_at, null)
  return {
    expected: +(base + net).toFixed(2),
    prior: { counted_amount: Number(prior.counted_amount) || 0, cash_removed_usd: Number(prior.cash_removed_usd) || 0, at: prior.created_at, period: prior.period, pt_date: prior.pt_date },
    cash_net_since: net,
    baseline: false,
  }
}

async function postLark(text) {
  if (!LARK_STOREFRONT) return false
  try {
    const r = await fetch(LARK_STOREFRONT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    return r.ok
  } catch (e) { console.error('[cash-count] Lark failed:', e); return false }
}

export default async function handler(req, res) {
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  try {
    // table-missing guard so the UI degrades to a clear message
    const probe = await supabase.from('cash_counts').select('id').limit(1)
    if (probe.error && /cash_counts/.test(probe.error.message || '')) {
      return res.status(200).json({ ok: false, outcome: 'not_migrated', error: 'Run scripts/add_cash_counts.sql' })
    }

    if (req.method === 'GET') {
      const exp = await computeExpected(supabase)
      // BLIND mode (Gary 2026-07-11): the count modal must not see the expected
      // balance before submitting — a visible target makes "matches" self-
      // fulfilling (same blind-count principle as stream counts). blind=1
      // returns only what the modal needs to render; amounts stay server-side
      // until the POST reveals the result.
      if (req.query && req.query.blind === '1') {
        return res.status(200).json({ ok: true, baseline: !!exp.baseline })
      }
      const { data: recent } = await supabase
        .from('cash_counts')
        .select('pt_date, period, counted_amount, expected_amount, difference, cash_removed_usd, counted_by_name, created_at, notes')
        .order('created_at', { ascending: false }).limit(8)
      return res.status(200).json({ ok: true, ...exp, recent: recent || [] })
    }

    if (req.method === 'POST') {
      const b = req.body || {}
      const counted = Number(b.counted_amount)
      if (!Number.isFinite(counted)) {
        return res.status(400).json({ ok: false, error: 'counted_amount required (number)' })
      }
      const removed = Number(b.cash_removed_usd) || 0
      const period = ['morning', 'evening', 'custom'].includes(b.period) ? b.period : 'custom'

      const exp = await computeExpected(supabase)
      const expected = exp.baseline ? counted : exp.expected
      const difference = +(counted - expected).toFixed(2)
      const matches = exp.baseline || Math.abs(difference) <= TOLERANCE

      const row = {
        pt_date: ptDateToday(),
        period,
        counted_amount: +counted.toFixed(2),
        expected_amount: exp.baseline ? null : expected,
        difference: exp.baseline ? null : difference,
        cash_net_since: exp.cash_net_since,
        cash_removed_usd: +removed.toFixed(2),
        counted_by_id: b.counted_by_id || null,
        counted_by_name: b.counted_by_name || null,
        notes: b.notes || null,
      }
      const { data: inserted, error: insErr } = await supabase
        .from('cash_counts').insert(row).select().single()
      if (insErr) throw insErr

      // Lark
      let larked = false
      if (b.send_lark !== false) {
        const who = b.counted_by_name ? ` · counted by ${b.counted_by_name}` : ''
        const periodLabel = period === 'morning' ? 'Morning' : period === 'evening' ? 'Evening' : 'Cash'
        const lines = []
        if (exp.baseline) {
          lines.push(`💵 ${periodLabel} cash count — baseline set`)
          lines.push(`Counted: ${money(counted)}${who}`)
          lines.push(`(First count — no prior balance to check against. Future counts compare to this.)`)
        } else if (matches) {
          lines.push(`✅ ${periodLabel} cash count — matches`)
          lines.push(`Counted ${money(counted)} · expected ${money(expected)}`)
          if (Math.abs(difference) > 0.005) lines.push(`(off by ${money(difference)}, within tolerance)`)
          lines.push(who.trim() || '')
        } else {
          const sign = difference > 0 ? 'OVER' : 'SHORT'
          lines.push(`⚠️ ${periodLabel} cash count — ${sign} by ${money(Math.abs(difference))}`)
          lines.push(`Counted ${money(counted)} · system expected ${money(expected)}`)
          lines.push(`(expected = last count ${money(exp.prior.counted_amount)}${exp.prior.cash_removed_usd ? ` − ${money(exp.prior.cash_removed_usd)} removed` : ''} + ${money(exp.cash_net_since)} cash since)`)
          lines.push(who.trim() || '')
        }
        if (removed > 0) lines.push(`💸 ${money(removed)} removed from drawer this count`)
        if (b.notes) lines.push(`📝 ${b.notes}`)
        lines.push(nowPtStamp())
        larked = await postLark(lines.filter(Boolean).join('\n'))
      }

      return res.status(200).json({
        ok: true, recorded: inserted, expected: exp.baseline ? null : expected,
        difference: exp.baseline ? null : difference, matches, baseline: exp.baseline,
        cash_net_since: exp.cash_net_since, larked,
      })
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[cash-count]', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
