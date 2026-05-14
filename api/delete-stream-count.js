// api/delete-stream-count.js
//
// Admin-only soft-delete for a stream_counts row. Two modes:
//
//   - 'retract' — operator made an input error and missed the in-app Undo.
//     The system should behave as if the count never happened: reverse
//     every inventory delta AND hide the row everywhere. Only allowed
//     when NO subsequent count exists at the same location, otherwise
//     reversing would double-correct (the subsequent count already
//     adjusted inventory based on the now-wrong starting state).
//
//   - 'hide'    — test data / cleanup. Inventory is already correct
//     (typically because a subsequent count fixed any drift). The row
//     gets stripped from reports + audit history but inventory is left
//     alone. Always allowed.
//
// Both modes go through soft-delete in the DB (deleted=true + deleted_at
// + deleted_by + deleted_reason + delete_mode) so the audit trail stays
// intact and misclicks can be unwound at the SQL level.
//
// POST body:
//   { count_id, caller_user_id, reason, mode }       // mode required
//
// Response:
//   200 { ok, mode, deleted_count_id, deltas_reversed?,
//         next_audit_id?, next_audit_needs_recompute, lark_results }
//   400 / 403 / 404 / 409 / 410 / 500 with error string

import { createClient } from '@supabase/supabase-js'

export const config = {
  // Inventory reversal in retract mode iterates over every item — still
  // bounded (a single count's items list, typically < 50 rows). 60s plenty.
  maxDuration: 60,
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

// Per-room webhook map. Mirrors api/lark-notify.js + api/auto-reconcile.js
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

function buildDeletedMessage({ mode, roomName, streamerName, countedByName, countTimeIso, deletedByName, reason, deltasReversed }) {
  const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')
  const lines = []
  if (mode === 'retract') {
    lines.push(`🔄 Stream Count RETRACTED — ${room}`)
  } else {
    lines.push(`🧹 Stream Count HIDDEN — ${room}`)
  }
  lines.push(`Original counter: ${countedByName || '?'} (was recording ${streamerName || '?'}'s session)`)
  lines.push(`Original count time: ${formatCountTimePT(countTimeIso)}`)
  lines.push(`Action by: ${deletedByName || '?'} at ${nowLocalStamp()}`)
  if (reason && reason.trim()) {
    lines.push(`Reason: ${reason.trim()}`)
  }
  lines.push('')
  if (mode === 'retract') {
    lines.push(`⚠️ Operator input error. Inventory has been restored to the pre-count state${typeof deltasReversed === 'number' ? ` (${deltasReversed} item line${deltasReversed === 1 ? '' : 's'} reversed)` : ''}. Treat the original Stream Count + Reconciliation message above as VOID.`)
  } else {
    lines.push('🧹 Cleanup-only delete. Inventory is unchanged (already corrected by subsequent count(s)). The original Stream Count message above is being removed from audit history; numbers it reported should no longer be acted on.')
  }
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

// Server-side inventory update — same logic as src/lib/supabase.js
// updateInventory but using the supabaseAdmin client and stripped down to
// the quantity-only case (we never need to touch avg_cost_basis when
// reversing a count's delta, since count submissions don't recalc cost
// basis to begin with). Negative deltas are allowed; the inventory table
// permits negative quantity in this codebase.
async function reverseInventoryDelta(supabase, { productId, locationId, deltaToReverse }) {
  // deltaToReverse is the *original* delta (positive or negative). We want
  // to apply -deltaToReverse to restore the pre-count state.
  const reversal = -deltaToReverse
  const { data: existing, error: lookupErr } = await supabase
    .from('inventory')
    .select('id, quantity')
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle()
  if (lookupErr) throw new Error(`Inventory lookup failed: ${lookupErr.message}`)
  if (existing) {
    const newQuantity = (existing.quantity || 0) + reversal
    const { error: updErr } = await supabase
      .from('inventory')
      .update({ quantity: newQuantity, last_updated: new Date().toISOString() })
      .eq('id', existing.id)
    if (updErr) throw new Error(`Inventory update failed: ${updErr.message}`)
  } else {
    // No row yet — insert with the reversal delta. (Edge case: a count
    // touched a product that has since been moved away from this location
    // and the inventory row was deleted. Reversing recreates the row.)
    const { error: insErr } = await supabase
      .from('inventory')
      .insert({ product_id: productId, location_id: locationId, quantity: reversal })
    if (insErr) throw new Error(`Inventory insert failed: ${insErr.message}`)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const { count_id, caller_user_id, reason, mode } = req.body || {}
  if (!count_id || typeof count_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'count_id is required' })
  }
  if (!caller_user_id || typeof caller_user_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'caller_user_id is required' })
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ ok: false, error: 'reason is required (admin must document why)' })
  }
  if (mode !== 'retract' && mode !== 'hide') {
    return res.status(400).json({ ok: false, error: `mode must be 'retract' or 'hide' (got ${JSON.stringify(mode)})` })
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

  // ---- Look up subsequent count at same location ----
  // Needed for: (a) retract safety gate, (b) marking the next audit as
  // needs_recompute (independent of mode). Run once here.
  const { data: nextCount } = await supabase
    .from('stream_counts')
    .select('id')
    .eq('location_id', count.location_id)
    .eq('deleted', false)
    .gt('count_time', count.count_time)
    .order('count_time', { ascending: true })
    .limit(1)
    .maybeSingle()

  // ---- Retract safety gate ----
  if (mode === 'retract' && nextCount?.id) {
    return res.status(409).json({
      ok: false,
      error: 'Retract not allowed: a subsequent count already exists at this room. Reversing inventory now would double-correct (the subsequent count already adjusted from the wrong starting state). Use mode=hide instead, or delete the subsequent count(s) first.',
    })
  }

  // ---- For retract: load items, reverse each inventory delta ----
  let deltasReversed = 0
  if (mode === 'retract') {
    const { data: items, error: itemsErr } = await supabase
      .from('stream_count_items')
      .select('product_id, expected_qty, actual_qty')
      .eq('stream_count_id', count_id)
    if (itemsErr) {
      return res.status(500).json({ ok: false, error: `Failed to load items: ${itemsErr.message}` })
    }
    // delta originally applied = actual_qty - expected_qty
    // (positive = inventory added; negative = inventory subtracted/sold)
    // Reversal applies -delta. We do this BEFORE marking the row deleted
    // so a mid-flow crash leaves the row recoverable + visible (better
    // than a deleted row with half-reversed inventory).
    for (const it of (items || [])) {
      const delta = (it.actual_qty || 0) - (it.expected_qty || 0)
      if (delta === 0) continue
      try {
        await reverseInventoryDelta(supabase, {
          productId: it.product_id,
          locationId: count.location_id,
          deltaToReverse: delta,
        })
        deltasReversed++
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: `Failed to reverse inventory for product ${it.product_id}: ${err.message}. NO changes have been committed.`,
        })
      }
    }
  }

  // ---- Soft-delete the count (both modes) ----
  const { error: delErr } = await supabase
    .from('stream_counts')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: caller.id,
      deleted_reason: reason.trim(),
      delete_mode: mode,
    })
    .eq('id', count_id)
  if (delErr) {
    return res.status(500).json({
      ok: false,
      error: `Failed to soft-delete count: ${delErr.message}. WARNING: inventory may have been partially reversed if mode=retract; reconcile manually.`,
    })
  }

  // ---- Flag the downstream audit ----
  //
  // auto-reconcile computes its window_from as the previous count's
  // count_time. So the immediately-next count at this location had its
  // window anchored to the now-deleted count's count_time → its audit
  // is now stale. Mark needs_recompute so the reviewer in AuditHistory
  // sees a warning and can hit Re-audit.
  //
  // This branch only runs for mode='hide' (mode='retract' was rejected
  // above if nextCount exists), but the check is identical — kept here
  // for clarity.
  let nextAuditId = null
  let nextAuditMarked = false
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
          recompute_reason: `Upstream count deleted (${mode}) by ${caller.name || 'admin'} at ${nowLocalStamp()} — window_from is now stale.`,
        })
        .eq('id', nextAudit.id)
      if (!recomputeErr) nextAuditMarked = true
    }
  }

  // ---- Send Lark notification ----
  const text = buildDeletedMessage({
    mode,
    roomName: count.location?.name,
    streamerName: count.streamer?.name,
    countedByName: count.counted_by?.name,
    countTimeIso: count.count_time,
    deletedByName: caller.name,
    reason: reason.trim(),
    deltasReversed: mode === 'retract' ? deltasReversed : undefined,
  })

  const mainWebhook = process.env.LARK_WEBHOOK_URL
  const roomWebhook = getRoomWebhook(count.location?.name)
  const larkResults = []
  if (mainWebhook) larkResults.push({ target: 'main', ...(await sendLark(mainWebhook, text)) })
  if (roomWebhook) larkResults.push({ target: 'room', ...(await sendLark(roomWebhook, text)) })

  return res.status(200).json({
    ok: true,
    mode,
    deleted_count_id: count.id,
    deltas_reversed: mode === 'retract' ? deltasReversed : null,
    next_audit_id: nextAuditId,
    next_audit_needs_recompute: nextAuditMarked,
    lark_results: larkResults,
  })
}
