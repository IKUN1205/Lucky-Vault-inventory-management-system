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
// Cash-net semantics mirror cash-alert-eod.js (sales add, buys subtract,
// splits count only their Cash slice), but the WINDOW is taken from the
// payment ledger itself:
//   - storefront_payments: created_at in (since, until], Cash method only —
//     created_at is the moment cash physically entered/left the drawer.
//   - each payment is signed by its parent transaction's net_cash direction
//     (sale / trade cash-in → +, buy cash-out → −), parents looked up across
//     storefront_sales / singles / slabs; fully-deleted (voided) parents drop
//     their payments.
// 2026-07-24: this REPLACED windowing storefront_sales by created_at +
// singles/slabs by updated_at. updated_at is not a sale time — the nightly
// market-price refresh touches SOLD singles/slabs too, dragging months-old
// cash sales into the window and inflating `expected` (recurring phantom
// morning SHORTs; 7/24's −$1,880.40 was $1,235.40 re-counted history).

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

// Signed cash flow of cash PAYMENTS created in (sinceISO, untilISO].
// sinceISO may be null → from the beginning of time.
async function cashNetInWindow(supabase, sinceISO, untilISO) {
  const { data: cashRow } = await supabase
    .from('payment_methods').select('id').eq('name', 'Cash').maybeSingle()
  const cashMethodId = cashRow?.id
  if (!cashMethodId) return 0

  let q = supabase.from('storefront_payments')
    .select('transaction_id, amount_usd, created_at')
    .eq('payment_method_id', cashMethodId)
  if (sinceISO) q = q.gt('created_at', sinceISO)
  if (untilISO) q = q.lte('created_at', untilISO)
  const payRes = await q
  if (payRes.error) throw payRes.error
  const pays = payRes.data || []

  // Look up each payment's parent transaction across the 3 sale tables to get
  // the cash direction (net_cash sign) and the void state. A transaction whose
  // found parent rows are ALL deleted is a void — its payments don't count.
  const txIds = [...new Set(pays.map(p => p.transaction_id).filter(Boolean))]
  const meta = new Map()   // txid → { sign, live }
  for (let i = 0; i < txIds.length; i += 200) {
    const batch = txIds.slice(i, i + 200)
    const [salesRes, singlesRes, slabsRes] = await Promise.all([
      supabase.from('storefront_sales')
        .select('transaction_id, net_cash_usd, deleted').in('transaction_id', batch),
      supabase.from('singles')
        .select('transaction_id, net_cash_usd, deleted').in('transaction_id', batch),
      supabase.from('slabs')
        .select('transaction_id, net_cash_usd, deleted').in('transaction_id', batch),
    ])
    for (const r of [salesRes, singlesRes, slabsRes]) {
      if (r.error) throw r.error
      for (const row of r.data || []) {
        const m = meta.get(row.transaction_id)
          || { sign: (Number(row.net_cash_usd) || 0) >= 0 ? 1 : -1, live: false }
        if (row.deleted !== true) m.live = true   // null-deleted legacy rows are live
        meta.set(row.transaction_id, m)
      }
    }
  }
  let cashNet = 0
  for (const p of pays) {
    const m = p.transaction_id ? meta.get(p.transaction_id) : null
    if (m && !m.live) continue                    // voided transaction
    // orphan / null-txid payments count as inflow (none in prod as of 7/24)
    cashNet += (m ? m.sign : 1) * (Number(p.amount_usd) || 0)
  }

  // Belt-and-suspenders for ledger-less legacy cash rows (1 of 72 cash tx since
  // 7/1 had no storefront_payments row): window storefront_sales by its own
  // created_at like the old code, but ONLY for transactions the payments ledger
  // doesn't know at all — any cash payment row anywhere means the ledger owns
  // the tx in whichever window that payment falls, so counting it here too
  // would double it.
  let s = supabase.from('storefront_sales')
    .select('transaction_id, net_cash_usd')
    .eq('deleted', false).eq('payment_method_id', cashMethodId)
    .not('transaction_id', 'is', null)
  if (sinceISO) s = s.gt('created_at', sinceISO)
  if (untilISO) s = s.lte('created_at', untilISO)
  const legacyRes = await s
  if (legacyRes.error) throw legacyRes.error
  const legacy = new Map()
  for (const r of legacyRes.data || []) {
    if (!legacy.has(r.transaction_id)) legacy.set(r.transaction_id, Number(r.net_cash_usd) || 0)
  }
  const legacyIds = [...legacy.keys()]
  for (let i = 0; i < legacyIds.length; i += 200) {
    const { data, error } = await supabase
      .from('storefront_payments')
      .select('transaction_id')
      .in('transaction_id', legacyIds.slice(i, i + 200))
      .eq('payment_method_id', cashMethodId)
    if (error) throw error
    for (const p of data || []) legacy.delete(p.transaction_id)
  }
  for (const net of legacy.values()) cashNet += net

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
