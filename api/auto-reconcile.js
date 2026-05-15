// api/auto-reconcile.js
// Server-side equivalent of the Reconcile page's full pipeline. Takes a
// stream_count_id, runs the whole pipeline (load count → fetch TikTok →
// compute diff → save to DB → push Lark), and returns the result.
//
// Triggered in two ways:
//   1. Fire-and-forget from StreamCounts.jsx after a count is saved at
//      a TikTok room — fully automatic.
//   2. Manually from the Reconcile page's "Send to Lark" path — replays
//      the same logic so the history table has a record.
//
// Reuses the same TikTok-harvester logic (response interception in a
// headless Chromium) as /api/tiktok-fetch-orders, but inlined here to
// avoid an extra HTTP hop. Total runtime ~30-40s.

import { createClient } from '@supabase/supabase-js'
import {
  harvestTikTokOrders,
  clusterLiveSessions,
  harvestLiveSessionsFromAnalytics,
} from './_lib/tiktok.js'

export const config = {
  // 300s on Vercel Pro (was 60 on Hobby). Auto-reconcile is dominated by
  // Chromium startup + TikTok pagination — the extra headroom lets us
  // paginate deep enough to cover 24h+ windows even with high-volume
  // shops (15k+ orders in inventory).
  maxDuration: 300,
}

const RECONCILE_THRESHOLD = 5

// Service role is ideal (bypasses RLS), but the frontend uses
// VITE_SUPABASE_ANON_KEY and stream_reconciliations has no RLS yet — so
// anon works too. Fall back through the common env-var names rather than
// requiring the user to add a new variable.
function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  if (!url) throw new Error('Supabase URL missing (set VITE_SUPABASE_URL or SUPABASE_URL on Vercel)')
  if (!key) throw new Error('Supabase key missing (set VITE_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY on Vercel)')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Map a room name (e.g. "Stream Room - TikTok Packheads") to the per-room
// Lark webhook env var. Kept in sync with the version in api/lark-notify.js
// — duplicated here so we don't have to do an inter-function HTTP call
// (which Vercel Authentication was blocking with 401).
function getRoomWebhookForReconcile(roomName) {
  if (!roomName) return null
  const n = String(roomName)
  if (n.includes('RocketsHQ'))    return process.env.LARK_WEBHOOK_STREAM_ROCKETSHQ    || null
  if (n.includes('Packheads'))    return process.env.LARK_WEBHOOK_STREAM_PACKHEADS    || null
  if (n.includes('LuckyVaultUS')) return process.env.LARK_WEBHOOK_STREAM_LUCKYVAULTUS || null
  if (n.includes('SlabbiePatty')) return process.env.LARK_WEBHOOK_STREAM_SLABBIEPATTY || null
  return null
}

// Server-side LA-local timestamp ("2026-05-13 08:56 PT"). Matches the format
// used by api/lark-notify.js so all Lark messages look consistent.
function nowLocalStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} PT`
}

// Reconciliation Lark message. Mirrors the builder in api/lark-notify.js
// (kept in sync intentionally — small duplication beats the alternative of
// auto-reconcile depending on the HTTP loopback that 401's out).
// Format a unix timestamp as "Mon 19:00 PT" — used in the per-creator
// merged-session breakdown so reviewers can see when each LIVE block
// ran. Falls back to '?' when the unix is null/0/missing.
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

// "5/12 3:39 PM PT" — used for window bounds + count submission time
function formatDateTimePT(unix) {
  if (!unix) return '?'
  const d = new Date(unix * 1000)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true,
  }).format(d) + ' PT'
}

// "5/13 04:39" — used in per-session compact rows. 24h clock; no PT
// suffix because the row context already says PT.
function formatDateHHMMPT(unix) {
  if (!unix) return '?'
  const d = new Date(unix * 1000)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

// Convert a JS Date or null → unix seconds for the builder
function toUnix(dOrNull) {
  if (!dOrNull) return null
  return Math.floor(new Date(dOrNull).getTime() / 1000)
}

function buildReconciliationMessage({
  roomName,
  streamerName,
  countedByName,
  sessionLabel,
  windowFromUnix,
  windowToUnix,
  countTimeUnix,
  totalPlatform,
  totalSystem,
  totalDiff,
  flaggedRows = [],
  unmappedCount = 0,
  threshold = 5,
  mergedSessionCount = 1,
  perCreator = [],
  analyticsLiveSessions = [],
}) {
  const lines = []
  const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')

  // Analytics LIVE is the authoritative source (TikTok's own per-session
  // count). Order-list per-creator is only used as legacy fallback when
  // Analytics LIVE harvest failed. The 🔀 MERGED indicator triggers on
  // Analytics LIVE count when available, falling back to per_creator.
  const liveSessions = Array.isArray(analyticsLiveSessions) ? analyticsLiveSessions : []
  const sessionCount = liveSessions.length || (perCreator?.length || 0) || mergedSessionCount
  const isMerged = sessionCount > 1
  const liveAnalyticsTotal = liveSessions.reduce((s, x) => s + (x.items_sold || 0), 0)
  const liveAnalyticsGmv = liveSessions.reduce((s, x) => s + (x.gmv_usd || 0), 0)

  // ---- Header ----
  if (isMerged) {
    lines.push(`🔀 MERGED Reconciliation — ${sessionCount} LIVE stream${sessionCount === 1 ? '' : 's'} covered`)
    lines.push(`Room: ${room}`)
  } else {
    lines.push(`🔍 Stream Reconciliation — ${room}`)
    if (streamerName) lines.push(`Streamer: ${streamerName}`)
  }
  if (countedByName) {
    const ts = countTimeUnix ? formatDateTimePT(countTimeUnix) : ''
    lines.push(`Counted by: ${countedByName}${ts ? `  ·  ${ts}` : ''}`)
  }
  if (sessionLabel && sessionLabel !== '(auto-fetched after stream count)') {
    lines.push(`Session: ${sessionLabel}`)
  }
  if (windowFromUnix || windowToUnix) {
    const wFrom = windowFromUnix ? formatDateTimePT(windowFromUnix) : '(no previous count)'
    const wTo = windowToUnix ? formatDateTimePT(windowToUnix) : '?'
    const durH = windowFromUnix && windowToUnix
      ? Math.round((windowToUnix - windowFromUnix) / 3600)
      : null
    lines.push(`Window: ${wFrom}  →  ${wTo}${durH != null ? ` (${durH}h)` : ''}`)
  }
  lines.push('')

  if (isMerged) {
    lines.push(`⚠️ This count was submitted AFTER ${sessionCount} separate LIVE streams. Investigate each stream's audit individually rather than trusting the combined total.`)
    lines.push('')
  }

  // ---- Analytics LIVE sessions (primary block) ----
  if (liveSessions.length > 0) {
    lines.push(`🎯 TikTok Official LIVE sessions in window:`)
    for (const s of liveSessions) {
      const startStr = s.start_unix ? formatDateHHMMPT(s.start_unix) : '?'
      const endStr = s.end_unix ? formatDateHHMMPT(s.end_unix) : '?'
      const items = (s.items_sold || 0).toLocaleString()
      const gmv = (s.gmv_usd || 0).toFixed(2)
      lines.push(`  • ${s.title || '(untitled)'}: ${startStr} → ${endStr} PT   ${items} items   $${gmv}`)
    }
    lines.push('  ─────────────────')
    lines.push(`  Total per TikTok analytics: ${liveAnalyticsTotal.toLocaleString()} items, $${liveAnalyticsGmv.toFixed(2)}`)
    lines.push('')
  } else if (perCreator.length > 0) {
    // Legacy fallback when Analytics LIVE harvest failed
    lines.push('Per-creator LIVE sales (from order list):')
    for (const c of perCreator) {
      const span = c.earliest_unix && c.latest_unix && c.earliest_unix !== c.latest_unix
        ? ` (${formatUnixShortPT(c.earliest_unix)} → ${formatUnixShortPT(c.latest_unix)})`
        : c.earliest_unix
          ? ` (${formatUnixShortPT(c.earliest_unix)})`
          : ''
      lines.push(`  • ${c.creator}: ${c.total_qty || 0} units${span}`)
    }
    lines.push('')
  }

  // ---- Three-way totals comparison ----
  lines.push('📊 Totals comparison')
  lines.push(`  Count (what streamer reported): ${(totalSystem ?? 0).toLocaleString()} items`)
  if (liveSessions.length > 0) {
    const gap = (totalSystem || 0) - liveAnalyticsTotal
    const gapStr = gap > 0 ? `gap: +${gap.toLocaleString()}` : gap < 0 ? `gap: ${gap.toLocaleString()}` : 'matches'
    lines.push(`  TikTok Analytics LIVE: ${liveAnalyticsTotal.toLocaleString()} items   ← ${gapStr}`)
  }
  const mappedSuffix = unmappedCount > 0 ? '   ← needs Sales Audit mapping' : ''
  lines.push(`  Order-list LIVE-tagged + mapped: ${(totalPlatform ?? 0).toLocaleString()} items${mappedSuffix}`)
  if (liveSessions.length > 0) {
    const gap = (totalSystem || 0) - liveAnalyticsTotal
    if (Math.abs(gap) >= threshold) {
      lines.push('')
      lines.push(`  → ${Math.abs(gap).toLocaleString()} items not officially LIVE-attributed (could be non-LIVE shop sales / inventory shrinkage / miscount)`)
    }
  }
  lines.push('')

  // ---- Flagged products ----
  if (flaggedRows.length === 0) {
    lines.push(`✅ All products match within ±${threshold}`)
  } else {
    lines.push(`⚠️ ${flaggedRows.length} product${flaggedRows.length === 1 ? '' : 's'} with diff ≥ ${threshold}`)
    // Identify the most extreme one for emphasis
    const maxAbs = Math.max(...flaggedRows.map(r => Math.abs(r.diff || 0)))
    for (const r of flaggedRows.slice(0, 15)) {
      const sign = r.diff > 0 ? '+' : ''
      const isMax = flaggedRows.length > 1 && Math.abs(r.diff || 0) === maxAbs
      const extraFound = r.diff > 0 && r.system < 0 ? ' (extra found)' : ''
      const tag = isMax && Math.abs(r.diff) >= 50 ? '   ← biggest gap' : ''
      lines.push(`  • ${r.product || 'Unknown'}: TikTok ${r.platform || 0} · Count ${r.system || 0} · ${sign}${r.diff || 0}${extraFound}${tag}`)
    }
    if (flaggedRows.length > 15) {
      lines.push(`  …and ${flaggedRows.length - 15} more`)
    }
  }

  if (unmappedCount > 0) {
    lines.push('')
    lines.push(`ℹ️ ${unmappedCount} TikTok product${unmappedCount === 1 ? '' : 's'} unmapped — open Sales Audit to map them.`)
  }

  if (isMerged) {
    lines.push('')
    lines.push(`Next step: ask each streamer separately whether their session matches the items listed above.`)
  }

  lines.push('')
  lines.push(`Time: ${nowLocalStamp()}`)
  return lines.join('\n')
}

// parseCookieHeader, explodeOrderToLines, and harvestTikTokOrders all live
// in api/_lib/tiktok.js so any future endpoint can reuse the same proven
// logic without drift. Imported at the top of this file.

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Use GET or POST' })
  }
  const body = req.method === 'POST' ? (req.body || {}) : {}
  const countId = req.query.count_id || body.count_id
  const triggeredBy = req.query.trigger || body.trigger || 'manual_reconcile'  // or 'auto_after_count'
  const triggeredByUserId = body.triggered_by_user_id || null

  if (!countId) {
    return res.status(400).json({ ok: false, error: 'Required: count_id' })
  }

  const started = Date.now()
  let supabase
  try {
    supabase = supabaseAdmin()
  } catch (err) {
    // We can't write anywhere if supabase itself is misconfigured — just
    // return so the caller (or Vercel logs) can see the error.
    return res.status(500).json({ ok: false, error: err.message })
  }

  // ---- Step 1: load the stream count + items + previous count ----
  const { data: count, error: cErr } = await supabase
    .from('stream_counts')
    .select('id, location_id, streamer_id, counted_by_id, count_time, deleted, location:locations(name), streamer:users!stream_counts_streamer_id_fkey(name), counted_by:users!stream_counts_counted_by_id_fkey(name)')
    .eq('id', countId)
    .single()
  if (cErr || !count) {
    return res.status(404).json({ ok: false, error: `Stream count not found: ${cErr?.message || ''}` })
  }
  // Safety net: don't audit a count that's been soft-deleted. The /api/delete-
  // stream-count endpoint marks the next audit needs_recompute, but if some
  // race fires this endpoint against an already-deleted count we should
  // refuse rather than write a fresh audit row that the AuditHistory page
  // will then hide.
  if (count.deleted === true) {
    return res.status(410).json({ ok: false, error: 'Stream count has been deleted; skipping audit.' })
  }
  // Only TikTok Packheads is wired to the TikTok seller-center cookie /
  // product mappings right now. Other TikTok rooms (RocketsHQ, etc.) would
  // need their own cookie + mapping table before we can reconcile them.
  // Gate strictly here so a stray count at another room can't kick off
  // a wasted Chromium run.
  const isPackheads = /TikTok\s*Packheads/i.test(count.location?.name || '')
  if (!isPackheads) {
    return res.status(400).json({
      ok: false,
      error: `Auto-reconcile is only enabled for TikTok Packheads. This count is at: ${count.location?.name}`,
    })
  }

  // Write a "running" row immediately so the function is visible in
  // Audit History even if a later step fails. window_from/window_to are
  // NOT NULL in the schema — seed them with the count's timestamp, then
  // overwrite once we've computed the real window.
  //
  // Clear needs_recompute on the way in: this run *is* the recompute, so
  // by the time we land a fresh window/totals the "stale" badge should
  // be gone. If the run fails downstream the audit becomes failed, which
  // is a louder signal than a lingering stale flag anyway.
  await supabase
    .from('stream_reconciliations')
    .upsert({
      stream_count_id: countId,
      triggered_by: triggeredBy,
      triggered_by_user_id: triggeredByUserId,
      source: 'tiktok_api',
      window_from: count.count_time,
      window_to: count.count_time,
      status: 'running',
      needs_recompute: false,
      recompute_reason: null,
    }, { onConflict: 'stream_count_id' })

  const [itemsRes, prevCountRes] = await Promise.all([
    supabase.from('stream_count_items')
      .select('product_id, expected_qty, actual_qty, product:products(name, language)')
      .eq('stream_count_id', countId),
    supabase.from('stream_counts')
      .select('id, count_time')
      .eq('location_id', count.location_id)
      .eq('deleted', false)
      .lt('count_time', count.count_time)
      .order('count_time', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const items = itemsRes.data || []
  const prevCount = prevCountRes.data || null

  // Window:
  //   lower bound = previous count's time (or NONE if no previous count —
  //     in that case we paginate back as far as we can and let the harvest
  //     decide what to keep).
  //   upper bound = THE COUNT'S TIME. The count records what the streamer
  //     physically observed in the room at submission moment; anything sold
  //     AFTER that hasn't been measured by this count, so attributing it
  //     here is wrong — it leaks the NEXT streamer's session into this
  //     audit. This was a real bug: with windowTo = new Date(), a manual
  //     re-audit run hours later would sweep in everything between the
  //     count and now (e.g. Trey 5/14 15:22 re-audited at 16:54 wrongly
  //     included Trey's own 15:20-15:55 stream).
  //
  //   The "(一定是最新的一场 stream) 但是点货的时间可能是三四天后"
  //   workflow (per Will) still works: no time-based lower bound when no
  //   prev count, and the harvester paginates back as needed.
  //
  //   Tradeoff vs the previous "windowTo = NOW" behaviour: orders that
  //   TikTok finalises with create_time *slightly after* count submission
  //   (rare, typically a few seconds) will no longer be attributed here.
  //   They'll show up in the next count's window instead, which is fine —
  //   the diff balances out across two consecutive audits and we never
  //   double-count.
  const windowTo = new Date(count.count_time)
  const windowFrom = prevCount ? new Date(prevCount.count_time) : null
  const fromTs = windowFrom ? Math.floor(windowFrom.getTime() / 1000) : null
  const toTs = Math.floor(windowTo.getTime() / 1000)

  // For the DB column (NOT NULL): when there's no prev count, fall back to
  // count_time itself so the row stays valid. We'll overwrite to the
  // earliest-seen-order timestamp after harvest if we want a real display.
  const baseRecord = {
    stream_count_id: countId,
    triggered_by: triggeredBy,
    triggered_by_user_id: triggeredByUserId,
    source: 'tiktok_api',
    window_from: (windowFrom || new Date(count.count_time)).toISOString(),
    window_to: windowTo.toISOString(),
    threshold: RECONCILE_THRESHOLD,
  }

  // ---- Step 2: load product mappings (TikTok name → product_id) ----
  const { data: mapsRows } = await supabase
    .from('platform_product_mappings')
    .select('external_name, product_id, ignore')
    .eq('platform', 'packheads')
  const mappings = {}
  for (const m of mapsRows || []) {
    if (!m.ignore && m.product_id) mappings[m.external_name] = m.product_id
  }

  // ---- Step 3: fetch TikTok orders ----
  let lines = []
  let observed = 0
  let pageInfo = null
  let inWindowOrderCount = 0
  try {
    const rawCookie = process.env.TIKTOK_COOKIE
    if (!rawCookie) throw new Error('TIKTOK_COOKIE env var not set')
    const result = await harvestTikTokOrders({ rawCookie, fromTs, toTs })
    lines = result.lines
    observed = result.observed
    pageInfo = result.pageInfo
    inWindowOrderCount = result.inWindowOrderCount

    // When there's no prev count, our windowFrom is null and we just
    // record the count_time as a placeholder. Now that we've harvested,
    // overwrite window_from with the oldest LIVE order's time so the
    // Audit History row reflects what we actually searched.
    if (!windowFrom && lines.length > 0) {
      const oldestUnix = Math.min(...lines.map(l => l.create_unix || 0).filter(Boolean))
      if (oldestUnix) {
        baseRecord.window_from = new Date(oldestUnix * 1000).toISOString()
      }
    }
  } catch (err) {
    // Persist failure so the audit-history page can show it. We already
    // wrote a "running" row up-top, so just update it.
    await supabase
      .from('stream_reconciliations')
      .update({
        ...baseRecord,
        status: 'failed',
        error_message: err.message || String(err),
        duration_ms: Date.now() - started,
      })
      .eq('stream_count_id', countId)
    return res.status(500).json({ ok: false, error: err.message })
  }

  // ---- Step 4: aggregate + compare ----
  // TikTok side, by mapped product_id
  const platformByProduct = new Map()
  const unmappedMap = new Map()
  for (const l of lines) {
    const pid = mappings[l.product_name]
    if (pid) {
      platformByProduct.set(pid, (platformByProduct.get(pid) || 0) + l.quantity)
    } else if (l.product_name) {
      unmappedMap.set(l.product_name, (unmappedMap.get(l.product_name) || 0) + l.quantity)
    }
  }

  // Per-session breakdown (was per-creator until 2026-05-13 P1.2).
  // Use clusterLiveSessions instead of distinct-creator counting: a single
  // creator can do MULTIPLE sessions in the same window (e.g. Trey plays
  // Mon evening AND Wed evening, with nobody counting in between). The
  // old "distinct creators" approach saw that as 1 session and missed the
  // skipped count between them. clusterLiveSessions splits on (creator,
  // time gap > 4h) so same-creator-multiple-sessions correctly counts as
  // 2+ sessions and triggers the MERGED audit indicator.
  //
  // The output schema stays { creator, total_qty, line_count,
  // earliest_unix, latest_unix } for backwards compatibility with the
  // per_creator_breakdown column + the Audit History UI rendering. Just
  // map session_start/end → earliest/latest.
  const sessions = clusterLiveSessions(lines, { gapHours: 4 })
  const perCreator = sessions.map(s => ({
    creator: s.creator,
    total_qty: s.total_qty,
    line_count: s.line_count,
    earliest_unix: s.session_start_unix,
    latest_unix: s.session_end_unix,
  }))
  const mergedSessionCount = sessions.length

  // Count side, by product_id, signed (positive = sold/missing,
  // negative = found/appeared)
  const countByProduct = new Map()
  for (const it of items) {
    const delta = (it.expected_qty || 0) - (it.actual_qty || 0)
    countByProduct.set(it.product_id, {
      name: it.product?.name || 'Unknown',
      language: it.product?.language || '',
      count_net: delta,
    })
  }

  const allPids = new Set([...countByProduct.keys(), ...platformByProduct.keys()])
  const rows = []
  let totalPlatform = 0, totalSystem = 0
  for (const pid of allPids) {
    const c = countByProduct.get(pid) || { name: '(not in count)', language: '', count_net: 0 }
    const platform = platformByProduct.get(pid) || 0
    const system = c.count_net
    const diff = platform - system
    totalPlatform += platform
    totalSystem += system
    rows.push({
      product_id: pid,
      product_name: c.name,
      language: c.language,
      platform_qty: platform,
      system_qty: system,
      diff,
      flagged: Math.abs(diff) >= RECONCILE_THRESHOLD,
    })
  }
  rows.sort((a, b) => {
    const bucket = (r) => !r.flagged ? 2 : (r.diff < 0 ? 0 : 1)
    const ba = bucket(a), bb = bucket(b)
    if (ba !== bb) return ba - bb
    return Math.abs(b.diff) - Math.abs(a.diff)
  })
  const totalDiff = totalPlatform - totalSystem
  const flaggedRows = rows.filter(r => r.flagged)
  const unmapped = Array.from(unmappedMap.entries()).map(([name, qty]) => ({ name, qty }))

  // ---- Step 4.5: harvest TikTok's official per-session breakdown ----
  // Scrape Content Analytics → LIVE for each session that overlaps the
  // recon window. This is TikTok's own ground truth — counts both LIVE-
  // tagged orders AND shop-tab attribution during the stream, so it
  // closes the gap between "what the order list says" (LIVE-tag only)
  // and "what actually sold during this session".
  //
  // Non-fatal: if the scrape fails, we still save the order-list based
  // recon. Pro tier 300s timeout gives us room — current measured
  // runtime ~50s for analytics + ~30-80s for order list = well under.
  let analyticsLiveSessions = []
  let analyticsHarvestError = null
  try {
    const rawCookie = process.env.TIKTOK_COOKIE
    const { sessions } = await harvestLiveSessionsFromAnalytics({ rawCookie })
    // Filter to sessions that overlap the recon window. A session overlaps
    // if EITHER its start OR end is within [fromTs, toTs], OR if it
    // entirely contains the window (long session covering shorter recon).
    // fromTs can be null when there's no previous count — then we accept
    // any session whose start is <= now (i.e. all visible sessions).
    analyticsLiveSessions = sessions.filter(s => {
      if (!s.start_unix) return false
      if (s.start_unix > toTs) return false  // future / after window
      if (fromTs == null) return true
      const end = s.end_unix || s.start_unix
      return end >= fromTs
    })
  } catch (err) {
    analyticsHarvestError = err.message || String(err)
    console.error('[auto-reconcile] analytics-live harvest failed:', err)
  }

  // ---- Step 5: save reconciliation ----
  const savedRecord = {
    ...baseRecord,
    total_platform_units: totalPlatform,
    total_system_units: totalSystem,
    total_diff: totalDiff,
    flagged_count: flaggedRows.length,
    unmapped_count: unmapped.length,
    rows,
    unmapped,
    merged_session_count: mergedSessionCount,
    per_creator_breakdown: perCreator,
    analytics_live_sessions: analyticsLiveSessions,
    status: 'success',
    duration_ms: Date.now() - started,
  }
  const { error: upErr } = await supabase
    .from('stream_reconciliations')
    .upsert(savedRecord, { onConflict: 'stream_count_id' })
  if (upErr) {
    return res.status(500).json({ ok: false, error: `Save failed: ${upErr.message}` })
  }

  // ---- Step 6: send Lark ----
  // Direct webhook POST — earlier we routed through /api/lark-notify, but
  // that meant auto-reconcile (a server-side function) had to fetch ITSELF
  // via a public URL constructed from process.env.VERCEL_URL. On projects
  // with Vercel Authentication enabled (or when VERCEL_URL points to the
  // preview-style deployment URL), that loopback hits the platform auth
  // layer and returns HTTP 401 before the request reaches our code — so
  // EVERY reconciliation Lark silently failed. Going direct to the room
  // webhook cuts out the broken hop entirely.
  let larkResult = null
  try {
    const roomWebhook = getRoomWebhookForReconcile(count.location?.name)
    const webhookUrl = roomWebhook || process.env.LARK_WEBHOOK_URL
    if (!webhookUrl) {
      larkResult = { ok: false, error: 'No webhook configured for this room' }
    } else {
      const flaggedForLark = flaggedRows.slice(0, 15).map(r => ({
        product: r.product_name,
        platform: r.platform_qty,
        system: r.system_qty,
        diff: r.diff,
      }))
      const messageText = buildReconciliationMessage({
        roomName: count.location?.name,
        streamerName: count.streamer?.name,
        countedByName: count.counted_by?.name,
        sessionLabel: triggeredBy === 'auto_after_count'
          ? '(auto-fetched after stream count)'
          : '(manual reconcile)',
        windowFromUnix: toUnix(windowFrom),
        windowToUnix: toUnix(windowTo),
        countTimeUnix: toUnix(count.count_time),
        totalPlatform,
        totalSystem,
        totalDiff,
        flaggedRows: flaggedForLark,
        unmappedCount: unmapped.length,
        threshold: RECONCILE_THRESHOLD,
        mergedSessionCount,
        perCreator,
        analyticsLiveSessions,
      })
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: messageText } }),
      })
      if (r.ok) {
        const target = roomWebhook ? 'room' : 'main'
        larkResult = { ok: true, target }
        await supabase
          .from('stream_reconciliations')
          .update({ lark_sent_at: new Date().toISOString(), lark_target: target })
          .eq('stream_count_id', countId)
      } else {
        const detail = await r.text().catch(() => '')
        larkResult = { ok: false, error: `Lark webhook HTTP ${r.status}${detail ? `: ${detail.slice(0, 100)}` : ''}` }
      }
    }
  } catch (err) {
    larkResult = { ok: false, error: err.message }
  }

  return res.status(200).json({
    ok: true,
    triggered_by: triggeredBy,
    window: {
      from: windowFrom ? windowFrom.toISOString() : null,
      to: windowTo.toISOString(),
    },
    summary: {
      total_platform_units: totalPlatform,
      total_system_units: totalSystem,
      total_diff: totalDiff,
      flagged_count: flaggedRows.length,
      unmapped_count: unmapped.length,
      tiktok_lines: lines.length,
      orders_observed: observed,
      orders_in_window: inWindowOrderCount,
      pages_loaded: pageInfo?.pagesLoaded || 1,
      hit_older_than_window: pageInfo?.hitOlderThanWindow || false,
      hit_end_of_list: pageInfo?.hitEndOfList || false,
      analytics_live_session_count: analyticsLiveSessions.length,
      analytics_live_total_items_sold: analyticsLiveSessions.reduce((s, x) => s + (x.items_sold || 0), 0),
      analytics_harvest_error: analyticsHarvestError,
    },
    lark: larkResult,
    duration_ms: Date.now() - started,
  })
}
