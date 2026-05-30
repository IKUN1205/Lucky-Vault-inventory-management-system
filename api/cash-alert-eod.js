// api/cash-alert-eod.js
// Vercel cron — runs at 7 PM PT (02:00 UTC during PDT) and pings Mr. Vault
// in the Storefront group if today's signed cash net is over the threshold.
// Once per day, no per-transaction oscillation noise.
//
// Cash semantics (matches fetchStorefrontDailySummary on the client):
//   - Sales paid in cash add (net_cash_usd positive)
//   - Buys paid in cash subtract (net_cash_usd negative)
//   - Trades signed by net_cash direction
//   - For split-payment transactions, only the Cash portion of the split
//     counts (amount from storefront_payments where method = Cash, signed
//     by parent transaction's net_cash direction).
//   - Single-method legacy transactions (no storefront_payments row): the
//     full signed net_cash goes to the legacy payment_method_id.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LARK_STOREFRONT = process.env.LARK_WEBHOOK_STOREFRONT
  || process.env.LARK_WEBHOOK_URL
// Optional: Mr. Vault's Lark open_id (the 'ou_xxxxx...' string). If set,
// the cash alert pings him specifically. If not set, falls back to @all.
const MR_VAULT_OPEN_ID = process.env.LARK_USER_MR_VAULT

const THRESHOLD = 1000

export const config = { maxDuration: 30 }

// "today" in Pacific Time (YYYY-MM-DD). When the cron fires at 02:00 UTC,
// LA is at 19:00 the day before in PDT (or 18:00 in PST), still the same
// PT calendar day we want to summarize.
function ptDateToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
function nowPtStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} PT`
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!LARK_STOREFRONT) return res.status(500).json({ error: 'No Lark webhook configured (LARK_WEBHOOK_STOREFRONT / LARK_WEBHOOK_URL)' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const ptDate = ptDateToday()

  try {
    // 1. Resolve the Cash payment_method id once.
    const { data: cashRow, error: pmErr } = await supabase
      .from('payment_methods').select('id').eq('name', 'Cash').maybeSingle()
    if (pmErr) throw pmErr
    const cashMethodId = cashRow?.id
    if (!cashMethodId) {
      console.warn('[cash-alert-eod] no Cash payment method configured')
      return res.status(200).json({ ok: true, cash_today: 0, fired: false, note: 'no Cash method' })
    }

    // 2. Pull today's transaction headers from the 3 sale tables. Each
    //    transaction may have rows across multiple tables; we only need
    //    one header per transaction_id (for the signed net_cash + the
    //    legacy single-method id).
    const [salesRes, singlesRes, slabsRes] = await Promise.all([
      supabase.from('storefront_sales')
        .select('transaction_id, transaction_type, net_cash_usd, payment_method_id')
        .eq('date', ptDate).eq('deleted', false).not('transaction_id', 'is', null),
      supabase.from('singles')
        .select('transaction_id, transaction_type, net_cash_usd, payment_method_id')
        .eq('sale_date', ptDate).not('transaction_id', 'is', null).eq('status', 'sold'),
      supabase.from('slabs')
        .select('transaction_id, transaction_type, net_cash_usd, payment_method_id')
        .eq('sale_date', ptDate).not('transaction_id', 'is', null).eq('status', 'sold'),
    ])
    if (salesRes.error) throw salesRes.error
    if (singlesRes.error) throw singlesRes.error
    if (slabsRes.error) throw slabsRes.error

    const txMeta = new Map()
    const collect = (rows) => {
      for (const r of rows || []) {
        if (!txMeta.has(r.transaction_id)) {
          txMeta.set(r.transaction_id, {
            netCash: Number(r.net_cash_usd) || 0,
            pmId: r.payment_method_id,
          })
        }
      }
    }
    collect(salesRes.data); collect(singlesRes.data); collect(slabsRes.data)
    const txIds = [...txMeta.keys()]

    // 3. Pull storefront_payments for these transactions — but only the
    //    Cash-method rows. That gives us the cash slice of every split.
    let cashNet = 0
    const splitCovered = new Set()
    if (txIds.length > 0) {
      // Batch in case there are a lot of txn ids
      for (let i = 0; i < txIds.length; i += 200) {
        const batch = txIds.slice(i, i + 200)
        const { data, error } = await supabase
          .from('storefront_payments')
          .select('transaction_id, amount_usd')
          .in('transaction_id', batch)
          .eq('payment_method_id', cashMethodId)
        if (error) throw error
        for (const p of data || []) {
          const meta = txMeta.get(p.transaction_id)
          if (!meta) continue
          const sign = meta.netCash >= 0 ? 1 : -1
          cashNet += sign * (Number(p.amount_usd) || 0)
          splitCovered.add(p.transaction_id)
        }
      }
      // For transactions WITHOUT a storefront_payments ledger row, fall
      // back to the legacy single-method check (payment_method_id on
      // the parent row equals Cash → full signed net_cash counts).
      for (const [txid, meta] of txMeta) {
        if (splitCovered.has(txid)) continue
        if (meta.pmId === cashMethodId) cashNet += meta.netCash
      }
    }

    const fired = cashNet > THRESHOLD
    const summary = {
      ok: true,
      date: ptDate,
      cash_today: +cashNet.toFixed(2),
      threshold: THRESHOLD,
      transaction_count: txIds.length,
      fired,
    }
    console.log('[cash-alert-eod]', summary)

    if (fired) {
      // Mention strategy (Lark custom-bot text supports inline <at> tags):
      //   - LARK_USER_MR_VAULT env var set → ping Mr. Vault specifically
      //     ('ou_xxxxx...' format from Lark admin / decoded contact card)
      //   - Else fall back to @all so SOMEONE in the group gets a push
      const mention = MR_VAULT_OPEN_ID
        ? `<at user_id="${MR_VAULT_OPEN_ID}">Mr. Vault</at>`
        : `<at user_id="all">@all</at> — Mr. Vault`
      const text = [
        `💰 Cash drawer over $${THRESHOLD.toLocaleString()}`,
        `Today's cash: $${cashNet.toFixed(2)} (${ptDate})`,
        `${mention}, please come pick it up 🏃`,
        nowPtStamp(),
      ].join('\n')
      const r = await fetch(LARK_STOREFRONT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      })
      const respText = await r.text()
      if (!r.ok) {
        console.error('[cash-alert-eod] Lark non-OK:', r.status, respText)
        return res.status(502).json({ ...summary, lark_status: r.status, lark_response: respText })
      }
    }

    return res.status(200).json(summary)
  } catch (err) {
    console.error('[cash-alert-eod] threw:', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
