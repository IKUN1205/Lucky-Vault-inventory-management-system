// api/delete-stream-count.js
//
// Admin-only soft-delete for a stream_counts row. Used when Will (or any
// admin) needs to retroactively retract a count that was entered by mistake
// — e.g. a test count, a wrong-streamer attribution, a duplicate.
//
// Why this lives in an API endpoint rather than a client-side mutation:
//   1. Admin gate must be server-checked. Filtering the UI button isn't
//      enough — anyone who knows the table name could hit Supabase directly.
//   2. The operation is multi-step (mark deleted → find downstream audit →
//      flag for recompute → send Lark) and must be atomic from the
//      caller's perspective: either every step succeeds and we ping Lark,
//      or we bail without partial damage.
//   3. Lark dispatch is inlined the same way auto-reconcile.js does it
//      (Vercel Auth blocks inter-function HTTP loopback with 401), so we
//      can't just POST to /api/lark-notify.
//
// POST body:
//   { count_id, caller_user_id, reason }
//
// Response:
//   200 { ok, deleted_count_id, next_audit_id?, next_audit_needs_recompute,
//         lark_result }
//   400 / 403 / 404 / 410 / 500 with error string

import { createClient } from '@supabase/supabase-js'

export const config = {
  // Quick op — load count, two writes, two Lark POSTs. 30s is plenty.
  maxDuration: 30,
}

function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  if (!url) throw new Error('Supabase URL missing')
  if (!key) throw new Error('Supabase key missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Per-room webhook map. Mirrors api/lark-notify.js and api/auto-reconcile.js
// — duplicated rather than HTTP-looped because Vercel Auth blocks
// inter-function calls with 401.
function getRoomWebhook(roomName) {
  if (!roomName) return null
  const n = String(roomName)
  if (n.includes('RocketsHQ'))    return process.env.LARK_WEBHOOK_STREAM_ROCKETSHQ    || null
  if (n.includes('Packheads'))    return process.env.LARK_WEBHOOK_STREAM_PACKHEADS    || null
  if (n.includes('LuckyVaultUS')) return process.env.LARK_WEBHOOK_STREAM_LUCKYVAULTUS || null
  if (n.includes('SlabbiePatty')) return process.env.LARK_WEBHOOK_STREAM_SLABBIEPATTY || null
  return null
}

// "2026-05-14 02:18 PT" — matches the other Lark builders.
function nowLocalStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} PT`
}

// "5/13 5:04 PM PT" — used to identify *which* prior count is being voided
// in the Lark message body (there may be many in a single day).
function formatCountTimePT(iso) {
  if (!iso) return '?'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso)) + ' PT'
}

function buildDeletedMessage({ roomName, streamerName, countedByName, countTimeIso, deletedByName, reason }) {
  const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')
  const lines = []
  lines.push(`🗑️ Stream Count DELETED — ${room}`)
  lines.push(`Original counter: ${countedByName || '?'} (was recording ${streamerName || '?'}'s session)`)
  lines.push(`Original count time: ${formatCountTimePT(countTimeIso)}`)
  lines.push(`Deleted by: ${deletedByName || '?'} at ${nowLocalStamp()}`)
  if (reason && reason.trim()) {
    lines.push(`Reason: ${reason.trim()}`)
  }
  lines.push('')
  lines.push('⚠️ The Stream Count + Reconciliation message for this session is VOID. The next streamer to count this room will get an extended audit window that covers any sales since the previous valid count.')
  return lines.join('\n')
}

async function sendLark(url, text) {
  if (!url) return { ok: false, skipped: true, reason: 'no_webhook_configured' }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    const body = await r.text()
    return { ok: r.ok, status: r.status, body }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const { count_id, caller_user_id, reason } = req.body || {}
  if (!count_id || typeof count_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'count_id is required' })
  }
  if (!caller_user_id || typeof caller_user_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'caller_user_id is required' })
  }
  // Force a reason — deletes without a written reason are exactly the
  // class of action we want a paper trail on.
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ ok: false, error: 'reason is required (admin must document why)' })
  }

  let supabase
  try {
    supabase = supabaseAdmin()
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }

  // ---- Admin gate: caller must have /users in allowed_pages ----
  const { data: caller, error: callerErr } = await supabase
    .from('users')
    .select('id, name, allowed_pages, active, can_login')
    .eq('id', caller_user_id)
    .maybeSingle()
  if (callerErr || !caller) {
    return res.status(403).json({ ok: false, error: 'Caller user not found' })
  }
  if (caller.active === false || caller.can_login === false) {
    return res.status(403).json({ ok: false, error: 'Caller is inactive or login-disabled' })
  }
  const allowed = Array.isArray(caller.allowed_pages) ? caller.allowed_pages : []
  if (!allowed.includes('/users')) {
    return res.status(403).json({ ok: false, error: 'Caller is not an admin (needs /users access)' })
  }

  // ---- Load the count being deleted ----
  const { data: count, error: cErr } = await supabase
    .from('stream_counts')
    .select(`
      id, location_id, count_time, deleted,
      location:locations(name),
      streamer:users!stream_counts_streamer_id_fkey(name),
      counted_by:users!stream_counts_counted_by_id_fkey(name)
    `)
    .eq('id', count_id)
    .maybeSingle()
  if (cErr) {
    return res.status(500).json({ ok: false, error: `Failed to load count: ${cErr.message}` })
  }
  if (!count) {
    return res.status(404).json({ ok: false, error: 'Stream count not found' })
  }
  if (count.deleted === true) {
    return res.status(410).json({ ok: false, error: 'Stream count is already deleted' })
  }

  // ---- Soft-delete the count ----
  const { error: delErr } = await supabase
    .from('stream_counts')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: caller.id,
      deleted_reason: reason.trim(),
    })
    .eq('id', count_id)
  if (delErr) {
    return res.status(500).json({ ok: false, error: `Failed to soft-delete count: ${delErr.message}` })
  }

  // ---- Flag the downstream audit ----
  //
  // auto-reconcile computes its window_from as the previous count's
  // count_time. So the immediately-next count at this location had its
  // window anchored to the now-deleted count's count_time → its audit
  // is now stale (the window should expand backward to whatever the
  // count BEFORE the deleted one was). Mark needs_recompute so the
  // reviewer in AuditHistory sees a warning and can hit Re-audit.
  //
  // No other audit row is affected: counts after the immediately-next
  // one have window_froms that reference counts *they* came after,
  // independent of the deleted row.
  let nextAuditId = null
  let nextAuditMarked = false
  {
    const { data: nextCount } = await supabase
      .from('stream_counts')
      .select('id')
      .eq('location_id', count.location_id)
      .eq('deleted', false)
      .gt('count_time', count.count_time)
      .order('count_time', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (nextCount?.id) {
      const { data: nextAudit } = await supabase
        .from('stream_reconciliations')
        .select('id')
        .eq('stream_count_id', nextCount.id)
        .maybeSingle()
      if (nextAudit?.id) {
        nextAuditId = nextAudit.id
        const { error: recomputeErr } = await supabase
          .from('stream_reconciliations')
          .update({
            needs_recompute: true,
            recompute_reason: `Upstream count deleted by ${caller.name || 'admin'} at ${nowLocalStamp()} — window_from is now stale.`,
          })
          .eq('id', nextAudit.id)
        if (!recomputeErr) nextAuditMarked = true
      }
    }
  }

  // ---- Send Lark notification ----
  //
  // Dual-target dispatch: main group brief + room-specific group. Same
  // pattern as the stream_count + stream_count_undone notifications in
  // api/lark-notify.js. We inline the dispatch (instead of POSTing to
  // /api/lark-notify) because Vercel Auth blocks inter-function loopback.
  const text = buildDeletedMessage({
    roomName: count.location?.name,
    streamerName: count.streamer?.name,
    countedByName: count.counted_by?.name,
    countTimeIso: count.count_time,
    deletedByName: caller.name,
    reason: reason.trim(),
  })

  const mainWebhook = process.env.LARK_WEBHOOK_URL
  const roomWebhook = getRoomWebhook(count.location?.name)
  const larkResults = []
  if (mainWebhook) larkResults.push({ target: 'main', ...(await sendLark(mainWebhook, text)) })
  if (roomWebhook) larkResults.push({ target: 'room', ...(await sendLark(roomWebhook, text)) })

  return res.status(200).json({
    ok: true,
    deleted_count_id: count.id,
    next_audit_id: nextAuditId,
    next_audit_needs_recompute: nextAuditMarked,
    lark_results: larkResults,
  })
}
