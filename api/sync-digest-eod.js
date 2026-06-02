// api/sync-digest-eod.js
// Daily 5 PM PT (00:00 UTC) digest rolling up everything the singles +
// slabs hourly syncs touched today. Replaces the per-run "💲 N prices
// changed" pings (now silent on success) with ONE consolidated message:
//
//   📊 Today's sheet sync digest
//   Singles (hourly): 💲 27 prices changed · ✅ 3 new
//   Slabs   (hourly): 💲 12 prices changed · ✅ 8 new
//   No errors. 2026-06-02 17:00 PT
//
// "How many runs?" we don't try to count — hourly schedule is implied.
// We count what matters: how many records actually moved today.
// Errors that fired immediately during the day still surface as their
// own per-run messages; the digest is just the rollup.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LARK_INVENTORY_IO = process.env.LARK_WEBHOOK_INVENTORY_IO
  || process.env.LARK_WEBHOOK_URL

export const config = { maxDuration: 30 }

function ptDayStartUtc() {
  // 00:00 PT today as a UTC ISO timestamp. During PDT (UTC-7), PT 00:00
  // = UTC 07:00. Compute by formatting "now" in en-CA in LA, taking the
  // date portion, then reconstructing the start of that day in PT.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t) => parts.find(p => p.type === t)?.value || ''
  const date = `${g('year')}-${g('month')}-${g('day')}`
  // Use an offset that's correct year-round for LA. Cheap approach:
  // ask Intl for the current LA offset.
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset',
  }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'GMT-7'
  const m = offset.match(/GMT([+-]?\d+)/)
  const hours = m ? -Number(m[1]) : 7   // PDT default 7; PST = 8
  // Build UTC timestamp = date 00:00 + offset hours
  const dt = new Date(`${date}T00:00:00Z`)
  dt.setUTCHours(dt.getUTCHours() + hours)
  return { dayStart: dt.toISOString(), ptDate: date }
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

async function countRows(supabase, table, filter) {
  // count via PostgREST count-exact header. Returns number or 0.
  const q = supabase.from(table).select('id', { count: 'exact', head: true })
  for (const [col, val] of Object.entries(filter)) {
    q[val.op].apply(q, val.args)
  }
  const { count, error } = await q
  if (error) {
    console.warn(`[sync-digest-eod] count ${table} failed:`, error.message)
    return 0
  }
  return Number(count) || 0
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!LARK_INVENTORY_IO) return res.status(500).json({ error: 'No inventory in/out webhook configured' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const { dayStart, ptDate } = ptDayStartUtc()

  try {
    // Singles activity for today (PT). Source = 'sheet_sync' isolates
    // the hourly sync from any manual edits / app-side updates.
    const [
      singlesPricesChanged,
      singlesNewToday,
      slabsPricesChanged,
      slabsNewToday,
    ] = await Promise.all([
      // Singles: prices that the sync touched today
      supabase.from('singles').select('id', { count: 'exact', head: true })
        .gte('market_price_updated_at', dayStart)
        .eq('market_price_source', 'sheet_sync'),
      // Singles: created today via auto-sync (notes carry the marker)
      supabase.from('singles').select('id', { count: 'exact', head: true })
        .gte('created_at', dayStart)
        .like('notes', '%(auto-sync)%'),
      // Slabs: prices touched today (no source field, but the only way
      // market_price_updated_at moves is the sync since the app doesn't edit it)
      supabase.from('slabs').select('id', { count: 'exact', head: true })
        .gte('updated_at', dayStart),
      // Slabs: created today via auto-sync
      supabase.from('slabs').select('id', { count: 'exact', head: true })
        .gte('created_at', dayStart)
        .like('notes', '%(auto-sync)%'),
    ])

    // Slabs price-change count is approximate (we count updates which
    // could include status/location too). For now, fine; we surface it
    // with a tiny ≈ for honesty.
    const sing_p = singlesPricesChanged.count || 0
    const sing_n = singlesNewToday.count || 0
    const slab_p = slabsPricesChanged.count || 0
    const slab_n = slabsNewToday.count || 0

    const noActivity = sing_p === 0 && sing_n === 0 && slab_p === 0 && slab_n === 0

    const lines = ['📊 Today\'s sheet sync digest']
    if (noActivity) {
      lines.push('Nothing changed across singles + slabs today.')
    } else {
      lines.push('')
      lines.push(`Singles: 💲 ${sing_p} price${sing_p === 1 ? '' : 's'} changed${sing_n > 0 ? ` · ✅ ${sing_n} new` : ''}`)
      lines.push(`Slabs:   💲 ≈${slab_p} updated${slab_n > 0 ? ` · ✅ ${slab_n} new` : ''}`)
    }
    lines.push('')
    lines.push(`${ptDate} · ${nowPtStamp()}`)

    const text = lines.join('\n')
    const r = await fetch(LARK_INVENTORY_IO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    if (!r.ok) {
      const t = await r.text()
      console.error('[sync-digest-eod] Lark non-OK:', r.status, t)
      return res.status(502).json({ error: 'Lark webhook failed', status: r.status, details: t })
    }
    return res.status(200).json({
      ok: true,
      pt_date: ptDate,
      singles_prices_changed: sing_p,
      singles_new: sing_n,
      slabs_prices_changed: slab_p,
      slabs_new: slab_n,
    })
  } catch (err) {
    console.error('[sync-digest-eod] threw:', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
