// api/detect-missing-counts.js
//
// Cron (every 2h) that proactively detects "LIVE session ended in a
// monitored room with NO subsequent stream_count" and pings the room's
// Lark group BEFORE the next streamer skips counting too.
//
// Pipeline (per monitored room):
//   1. Harvest last 48h of TikTok orders via the shared helper.
//   2. Cluster the LIVE-tagged orders into sessions by
//      (live_creator, 4h gap).
//   3. For each session whose end > MIN_AGE_HOURS ago, check if any
//      stream_count exists at that room with count_time > session_end.
//      No count → emit alert.
//   4. Dedup with missing_count_alerts (room + creator + session_end
//      is UNIQUE). Only INSERTs that actually create a row send Lark.
//
// Only Packheads is wired right now (it's the only TikTok room with a
// cookie + product mappings). Adding other rooms is a config change
// here + cookie env var + a row in this MONITORED_ROOMS list.
//
// Auth: same CRON_SECRET pattern as aftership-sync.js. Vercel cron sends
//   Authorization: Bearer ${CRON_SECRET}
// when CRON_SECRET is set. Manual invocations from the same Bearer also
// work for testing.

import { createClient } from '@supabase/supabase-js'
import { harvestTikTokOrders, clusterLiveSessions } from './_lib/tiktok.js'

export const config = {
  maxDuration: 60,
}

const CRON_SECRET = process.env.CRON_SECRET

// Cron emits an alert only for sessions that ended at least this many
// hours ago — gives the next streamer a reasonable window to arrive and
// count without us spamming "you didn't count!" the second their stream
// ends. 6h matches the typical overnight gap between back-to-back rooms.
const MIN_AGE_HOURS = 6

// Hard upper bound on how stale a session can be before we stop nagging.
// 72h: after 3 days the audit data is effectively lost anyway and the
// noise is no longer actionable.
const MAX_AGE_HOURS = 72

// Rooms we actively monitor. Each entry needs:
//   - locationNameLike: ILIKE pattern for the locations table
//   - cookieEnvVar: env var name carrying the seller-center cookie
// Adding a new room here without a working cookie just makes the cron
// throw for that room — handled gracefully and reported per-room.
const MONITORED_ROOMS = [
  {
    locationNameLike: '%TikTok%Packheads%',
    cookieEnvVar: 'TIKTOK_COOKIE',
  },
  // RocketsHQ etc. would need their own cookie envs before being added.
]

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

// Map room name → Lark webhook. Same logic as auto-reconcile.js and
// lark-notify.js — kept in sync intentionally to avoid the inter-function
// HTTP hop that was returning 401 from Vercel auth.
function getRoomWebhook(roomName) {
  if (!roomName) return null
  const n = String(roomName)
  if (n.includes('RocketsHQ'))    return process.env.LARK_WEBHOOK_STREAM_ROCKETSHQ    || null
  if (n.includes('Packheads'))    return process.env.LARK_WEBHOOK_STREAM_PACKHEADS    || null
  if (n.includes('LuckyVaultUS')) return process.env.LARK_WEBHOOK_STREAM_LUCKYVAULTUS || null
  if (n.includes('SlabbiePatty')) return process.env.LARK_WEBHOOK_STREAM_SLABBIEPATTY || null
  return null
}

// Format a unix timestamp as "Mon 19:00 PT".
function formatUnixShortPT(unix) {
  if (!unix) return '?'
  const d = new Date(unix * 1000)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('weekday')} ${get('hour')}:${get('minute')} PT`
}

// "(14h ago)" style helper for the Lark message.
function ageHoursAgo(unix) {
  if (!unix) return '?'
  const ageH = Math.round((Date.now() / 1000 - unix) / 3600)
  return `${ageH}h ago`
}

function buildMissingCountMessage({ roomShortName, missing }) {
  const lines = []
  lines.push(`⏰ Stream Count Missing — ${roomShortName}`)
  lines.push('')
  if (missing.length === 1) {
    const m = missing[0]
    lines.push(`${m.creator}'s session ended ${formatUnixShortPT(m.session_end_unix)} (${ageHoursAgo(m.session_end_unix)}) — no count submitted yet.`)
    lines.push('')
    lines.push(`Whoever streams next: please count before going live, or the audit for ${m.creator}'s session will be lost.`)
    lines.push('')
    lines.push('Session waiting for count:')
    lines.push(`  • ${m.creator}: ended ${formatUnixShortPT(m.session_end_unix)} (sold ${m.total_qty} units across ${m.line_count} order line${m.line_count === 1 ? '' : 's'})`)
  } else {
    lines.push(`${missing.length} LIVE sessions ended without a stream_count.`)
    lines.push('')
    lines.push('Whoever streams next: count before going live — every uncounted session below loses its audit:')
    lines.push('')
    for (const m of missing) {
      lines.push(`  • ${m.creator}: ended ${formatUnixShortPT(m.session_end_unix)} (${ageHoursAgo(m.session_end_unix)}) — ${m.total_qty} units / ${m.line_count} line${m.line_count === 1 ? '' : 's'}`)
    }
  }
  lines.push('')
  lines.push(`(Detected by Lucky Vault audit watchdog.)`)
  return lines.join('\n')
}

// Process one room: harvest, cluster, find sessions with no following
// count, dedupe via missing_count_alerts, and fire Lark for each NEW
// detection. Returns a per-room summary.
async function processRoom(supabase, room) {
  const summary = {
    locationNameLike: room.locationNameLike,
    sessions_detected: 0,
    sessions_missing_count: 0,
    alerts_sent: 0,
    alerts_skipped_duplicate: 0,
    error: null,
  }

  // Resolve the location_id (and full name) for this room.
  const { data: locRow, error: locErr } = await supabase
    .from('locations')
    .select('id, name')
    .ilike('name', room.locationNameLike)
    .limit(1)
    .maybeSingle()
  if (locErr || !locRow) {
    summary.error = `Location not found for pattern ${room.locationNameLike}`
    return summary
  }

  const cookie = process.env[room.cookieEnvVar]
  if (!cookie) {
    summary.error = `Cookie env var ${room.cookieEnvVar} not set`
    return summary
  }

  // Harvest the last 48h of orders, no upper bound (toTs = now).
  const nowSec = Math.floor(Date.now() / 1000)
  const fromTs = nowSec - 48 * 3600
  let harvest
  try {
    harvest = await harvestTikTokOrders({
      rawCookie: cookie,
      fromTs,
      toTs: nowSec,
      liveOnly: true,
    })
  } catch (err) {
    summary.error = `Harvest failed: ${err.message || String(err)}`
    return summary
  }

  // Cluster into sessions.
  const sessions = clusterLiveSessions(harvest.lines, { gapHours: 4 })
  summary.sessions_detected = sessions.length

  // Filter to sessions that have actually ended (more than MIN_AGE_HOURS
  // ago but no older than MAX_AGE_HOURS).
  const minEnd = nowSec - MIN_AGE_HOURS * 3600
  const maxEnd = nowSec - MAX_AGE_HOURS * 3600
  const candidates = sessions.filter(s =>
    s.session_end_unix <= minEnd && s.session_end_unix >= maxEnd
  )

  // For each candidate, check: any stream_count at this room with
  // count_time > session_end?
  const missing = []
  for (const s of candidates) {
    const sessionEndIso = new Date(s.session_end_unix * 1000).toISOString()
    const { count, error: cErr } = await supabase
      .from('stream_counts')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', locRow.id)
      .gt('count_time', sessionEndIso)
      .or('deleted.is.null,deleted.eq.false')
    if (cErr) {
      // Surface but don't block other sessions
      summary.error = `stream_counts probe failed: ${cErr.message}`
      continue
    }
    if ((count || 0) === 0) missing.push(s)
  }
  summary.sessions_missing_count = missing.length

  if (missing.length === 0) {
    return summary  // nothing to alert
  }

  // Dedup via missing_count_alerts. Insert with ON CONFLICT DO NOTHING;
  // collect the IDs that came back (new inserts only). If nothing was
  // newly inserted, every missing session was already alerted — skip
  // sending Lark this round.
  const insertRows = missing.map(m => ({
    room_location_id: locRow.id,
    creator: m.creator,
    session_end_unix: m.session_end_unix,
    session_start_unix: m.session_start_unix,
    total_qty: m.total_qty,
    line_count: m.line_count,
  }))
  const { data: inserted, error: insErr } = await supabase
    .from('missing_count_alerts')
    .upsert(insertRows, {
      onConflict: 'room_location_id,creator,session_end_unix',
      ignoreDuplicates: true,
    })
    .select('id, creator, session_end_unix')
  if (insErr) {
    summary.error = `Alert insert failed: ${insErr.message}`
    return summary
  }
  const newAlerts = (inserted || []).map(row => {
    const m = missing.find(x =>
      x.creator === row.creator && x.session_end_unix === row.session_end_unix
    )
    return { ...m, alert_id: row.id }
  })
  summary.alerts_skipped_duplicate = missing.length - newAlerts.length

  if (newAlerts.length === 0) {
    return summary  // all were already alerted earlier
  }

  // Build + send Lark to BOTH the main webhook (so the whole org can
  // see action items) AND the room's webhook (so streamers see it).
  const roomShortName = locRow.name.replace(/^Stream Room\s*[-—]\s*/i, '')
  const text = buildMissingCountMessage({ roomShortName, missing: newAlerts })

  const mainWebhook = process.env.LARK_WEBHOOK_URL
  const roomWebhook = getRoomWebhook(locRow.name)

  const sends = []
  if (mainWebhook) sends.push({ target: 'main', url: mainWebhook })
  if (roomWebhook) sends.push({ target: 'room', url: roomWebhook })

  const results = { main_ok: null, room_ok: null, error: null }
  for (const s of sends) {
    try {
      const r = await fetch(s.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      })
      if (s.target === 'main') results.main_ok = r.ok
      if (s.target === 'room') results.room_ok = r.ok
      if (!r.ok) {
        const detail = await r.text().catch(() => '')
        results.error = `${s.target} HTTP ${r.status}${detail ? `: ${detail.slice(0, 80)}` : ''}`
      }
    } catch (err) {
      if (s.target === 'main') results.main_ok = false
      if (s.target === 'room') results.room_ok = false
      results.error = (results.error || '') + ` ${s.target}: ${err.message}`
    }
  }

  // Write Lark delivery result back to the alert rows (debug aid).
  await supabase
    .from('missing_count_alerts')
    .update({
      lark_main_ok: results.main_ok,
      lark_room_ok: results.room_ok,
      lark_error: results.error,
    })
    .in('id', newAlerts.map(a => a.alert_id))

  summary.alerts_sent = newAlerts.length
  summary.lark = results
  return summary
}

export default async function handler(req, res) {
  // Verify cron auth (Vercel sends Bearer ${CRON_SECRET}).
  if (CRON_SECRET) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }
  }

  let supabase
  try {
    supabase = supabaseAdmin()
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }

  const started = Date.now()
  const results = []
  for (const room of MONITORED_ROOMS) {
    try {
      const r = await processRoom(supabase, room)
      results.push(r)
    } catch (err) {
      results.push({
        locationNameLike: room.locationNameLike,
        error: `Unhandled: ${err.message || String(err)}`,
      })
    }
  }

  return res.status(200).json({
    ok: true,
    duration_ms: Date.now() - started,
    results,
  })
}
