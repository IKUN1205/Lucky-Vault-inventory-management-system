// api/inventory-audit.js
// Records a Master Inventory SEALED audit count (Gary 2026-07-14: Mon/Wed/Fri).
//
// This is JUST an audit log — it ONLY records the counted numbers. It NEVER
// changes inventory (a Master Inventory variance = shrinkage / misplacement /
// mis-entry, resolved by a human, not auto-applied like a stream-room sale).
//
// Why a Google Sheet and not stream_counts: the usage reports (daily-usage,
// weekly-usage, Reports, Turnover) read ALL stream_counts grouped by location,
// so a Master Inventory row would pollute them. And new tables are blocked
// (no Supabase DDL). So audit rows land on a dedicated 'SEALED AUDIT' tab of
// the slab ops sheet — zero pollution, no DDL, team-visible.
//
// Blind count: the client never receives the system quantity. The endpoint
// snapshots `expected` from the inventory table at record time, so the
// variance is meaningful even if inventory changes later.
//
// Body: { location_id, counted_by, counted_by_name, items: [{product_id, counted}] }
// Appends one row per counted item to the SEALED AUDIT tab.

import { createClient } from '@supabase/supabase-js'
import { appendRows } from './_lib/google-sheets.js'

// A valid count is a whole non-negative number. A blank / whitespace / non-digit
// value is "not counted" and must NEVER be silently coerced to 0 (Codex
// 2026-07-14); a real empty shelf is entered as the digit 0.
function isCount(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0
  if (typeof v === 'string') return /^\d+$/.test(v.trim())
  return false
}

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

// The slab ops sheet — the app already reads+writes it (sync-slabs-sheet), so
// its service account has edit access. Audit rows live on its SEALED AUDIT tab.
const AUDIT_SHEET_ID = '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI'
const AUDIT_TAB = 'SEALED AUDIT'

export const config = { maxDuration: 30 }

function ptLocalStamp() {
  // America/Los_Angeles so timestamps match the store clock (same rule as the
  // Lark stamp helper in lark-notify.js).
  const d = new Date()
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return { date, stamp: `${date} ${time}` }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Only POST is supported' })
  }
  if (!SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase key not configured' })
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' })
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  const { location_id, counted_by_name } = body
  const items = Array.isArray(body.items) ? body.items : []
  if (!location_id) return res.status(400).json({ error: 'location_id required' })
  // Only whole-number counts; blanks/whitespace/junk are dropped (never → 0).
  const counted = items.filter(it => it && it.product_id && isCount(it.counted))
  if (counted.length === 0) return res.status(400).json({ error: 'no counted items' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  try {
    const ids = [...new Set(counted.map(it => String(it.product_id)))]
    // Expected = system qty at THIS location, snapshotted now.
    const { data: invRows, error: invErr } = await supabase
      .from('inventory')
      .select('product_id, quantity')
      .eq('location_id', location_id)
      .in('product_id', ids)
    if (invErr) throw invErr
    const expectedBy = new Map((invRows || []).map(r => [String(r.product_id), Number(r.quantity) || 0]))

    const { data: prodRows, error: prodErr } = await supabase
      .from('products')
      .select('id, name')
      .in('id', ids)
    if (prodErr) throw prodErr
    const nameBy = new Map((prodRows || []).map(r => [String(r.id), r.name || '']))

    const { date, stamp } = ptLocalStamp()
    const who = String(counted_by_name || 'Unknown').slice(0, 60)
    const rows = counted.map(it => {
      const pid = String(it.product_id)
      const exp = expectedBy.has(pid) ? expectedBy.get(pid) : ''
      const cnt = Number(it.counted)
      const diff = (exp === '') ? '' : (cnt - exp)
      return [stamp, date, who, (nameBy.get(pid) || '').slice(0, 80), pid.slice(0, 8), exp, cnt, diff]
    })

    // Atomic append (INSERT_ROWS) — no read-then-write race, no A1 range cap.
    await appendRows(AUDIT_SHEET_ID, `${AUDIT_TAB}!A1`, rows)

    const flagged = rows.filter(r => r[7] !== '' && Number(r[7]) !== 0).length
    return res.status(200).json({
      ok: true, recorded: rows.length, flagged,
      message: `Recorded ${rows.length} counts (${flagged} with a variance) to ${AUDIT_TAB}.`,
    })
  } catch (err) {
    console.error('[inventory-audit] failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
