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

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'

export const config = {
  maxDuration: 60,
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

function buildReconciliationMessage({
  roomName,
  streamerName,
  sessionLabel,
  windowFrom,
  windowTo,
  totalPlatform,
  totalSystem,
  totalDiff,
  flaggedRows = [],
  unmappedCount = 0,
  threshold = 5,
  mergedSessionCount = 1,
  perCreator = [],
}) {
  const lines = []
  const isMerged = (mergedSessionCount || 1) > 1
  const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')

  if (isMerged) {
    // Loud header so a glance at Lark distinguishes a merged audit from a
    // clean one. The 90% case (single LIVE session) keeps the original
    // 🔍 header untouched.
    lines.push(`🔀 MERGED Reconciliation — ${mergedSessionCount} sessions`)
    lines.push(`Room: ${room}`)
    if (sessionLabel) lines.push(`Session: ${sessionLabel}`)
    if (windowFrom || windowTo) lines.push(`Window: ${windowFrom || '?'} → ${windowTo || '?'}`)
    lines.push('')
    lines.push(`⚠️ This count covered multiple LIVE streams. Per-stream attribution is not reliable — investigate any discrepancy across ALL streamers below.`)
    lines.push('')
    lines.push('Per-creator TikTok sales:')
    for (const c of perCreator) {
      const span = c.earliest_unix && c.latest_unix && c.earliest_unix !== c.latest_unix
        ? ` (${formatUnixShortPT(c.earliest_unix)} → ${formatUnixShortPT(c.latest_unix)})`
        : c.earliest_unix
          ? ` (${formatUnixShortPT(c.earliest_unix)})`
          : ''
      lines.push(`  • ${c.creator}: ${c.total_qty} units${span}`)
    }
    lines.push('')
  } else {
    lines.push(`🔍 Stream Reconciliation — ${room}`)
    if (streamerName) lines.push(`Streamer: ${streamerName}`)
    if (sessionLabel) lines.push(`Session: ${sessionLabel}`)
    if (windowFrom || windowTo) lines.push(`Window: ${windowFrom || '?'} → ${windowTo || '?'}`)
    lines.push('')
  }

  lines.push(`Totals — TikTok ${totalPlatform ?? 0} · Count ${totalSystem ?? 0} · Diff ${(totalDiff ?? 0) > 0 ? '+' : ''}${totalDiff ?? 0}`)
  lines.push('')
  if (flaggedRows.length === 0) {
    lines.push(`✅ All products match within ±${threshold}`)
  } else {
    lines.push(`⚠️ ${flaggedRows.length} product${flaggedRows.length === 1 ? '' : 's'} off by ${threshold}+:`)
    for (const r of flaggedRows.slice(0, 15)) {
      const sign = r.diff > 0 ? '+' : ''
      lines.push(`  • ${r.product || 'Unknown'}: TikTok ${r.platform || 0} · Count ${r.system || 0} · ${sign}${r.diff || 0}`)
    }
    if (flaggedRows.length > 15) {
      lines.push(`  …and ${flaggedRows.length - 15} more`)
    }
  }
  if (unmappedCount > 0) {
    lines.push('')
    lines.push(`ℹ️ ${unmappedCount} TikTok product${unmappedCount === 1 ? '' : 's'} unmapped — open Sales Audit to map them.`)
  }
  lines.push('')
  lines.push(`Time: ${nowLocalStamp()}`)
  return lines.join('\n')
}

function parseCookieHeader(raw) {
  return String(raw || '')
    .split(';')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const eq = p.indexOf('=')
      if (eq < 0) return null
      return {
        name: p.slice(0, eq).trim(),
        value: p.slice(eq + 1).trim(),
        domain: '.tiktok.com',
        path: '/',
      }
    })
    .filter(Boolean)
}

function explodeOrderToLines(o) {
  const createUnix = parseInt(o.trade_order_module?.create_time || '0', 10)

  let isLive = false
  let liveCreator = null
  for (const lblMod of o.order_label_module || []) {
    const tag = lblMod?.label_express_map?.sales_source_live_tag
    const items = tag?.value?.v_dynamic_express?.items || []
    for (const it of items) {
      const m = String(it?.message_content || '').match(/LIVE:\s*(.+?)\s*$/i)
      if (m) { isLive = true; liveCreator = m[1].trim(); break }
    }
    if (isLive) break
  }

  const lines = []
  for (const sku of o.sku_module || []) {
    lines.push({
      order_id: o.main_order_id,
      create_unix: createUnix,
      is_live: isLive,
      live_creator: liveCreator,
      product_name: sku.product_name || null,
      quantity: parseInt(sku.quantity || 0, 10) || 0,
      total_price: parseFloat(sku.sku_total_price?.price_val || '0') || 0,
    })
  }
  return lines
}

// Harvest TikTok orders via in-page response interception. Same approach
// proven in /api/tiktok-fetch-orders — let TikTok's own page JS fetch,
// we just listen for the responses.
//
// Pagination: TikTok's default page loads ~20 orders. For sessions counted
// 3-4 days after the actual stream (per Lucky Vault workflow), the last
// stream's orders can be on page 2-5. After the initial response we scroll
// the table to the bottom and click the "next page" arrow repeatedly until:
//   (a) we've captured an order older than fromTs (covered the window), or
//   (b) no new orders came in after a click (end of list), or
//   (c) we've done MAX_PAGES iterations (safety cap).
// `fromTs` can be null — meaning "no lower bound, just take everything
// we can reach". In that case we stop on (b) or (c) only.
const MAX_PAGES = 6  // ~120 orders max per run

async function harvestTikTokOrders({ rawCookie, fromTs, toTs }) {
  const cookies = parseCookieHeader(rawCookie)
  const harvested = []
  let pageInfo = { pagesLoaded: 1, hitOlderThanWindow: false, hitEndOfList: false }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setCookie(...cookies)
    page.on('response', async (response) => {
      const url = response.url()
      if (!/api\/fulfillment\/na\/order\/list/i.test(url)) return
      try {
        const text = await response.text()
        const json = JSON.parse(text)
        if (json.code === 0 && Array.isArray(json.data?.main_orders)) {
          harvested.push(...json.data.main_orders)
        }
      } catch {}
    })
    await page.goto('https://seller-us.tiktok.com/order?selected_sort=6&tab=all', {
      waitUntil: 'networkidle2',
      timeout: 40_000,
    })
    if (/login|signin|account\/verify/i.test(page.url())) {
      throw new Error('TikTok cookies stale — got redirected to login.')
    }
    // Initial response usually arrives within a few seconds.
    await new Promise(r => setTimeout(r, 5000))

    // Helper: does the harvested set already include an order older than the
    // lower bound? Once yes, we've covered the requested window.
    const haveCoveredWindow = () => {
      if (!fromTs) return false  // no lower bound → never "covered"
      return harvested.some(o => {
        const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
        return ct < fromTs
      })
    }

    // Pagination loop
    for (let i = 1; i < MAX_PAGES; i++) {
      if (haveCoveredWindow()) { pageInfo.hitOlderThanWindow = true; break }
      const beforeCount = harvested.length

      // Try scrolling the page first — some pagination is on-scroll
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      // Click the "next page" pagination arrow. TikTok uses Arco Design,
      // so we try several common selectors for the next-page button.
      const clicked = await page.evaluate(() => {
        const selectors = [
          '.arco-pagination-item-next:not(.arco-pagination-item-disabled)',
          '[class*="pagination-next"]:not([class*="disabled"])',
          'button[aria-label="Next"]:not([disabled])',
          'li[title="Next Page"]:not(.arco-pagination-item-disabled)',
        ]
        for (const sel of selectors) {
          const btn = document.querySelector(sel)
          if (btn) { btn.click(); return sel }
        }
        return null
      }).catch(() => null)

      // Wait for the next response to land
      await new Promise(r => setTimeout(r, 3500))

      if (harvested.length === beforeCount) {
        // No new orders → either end of list or pagination control not found
        pageInfo.hitEndOfList = !clicked
        break
      }
      pageInfo.pagesLoaded = i + 1
    }
  } finally {
    await browser.close()
  }

  // Dedupe + filter to [fromTs, toTs] (each bound optional)
  const seen = new Set()
  const inWindow = []
  for (const o of harvested) {
    const id = o.main_order_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
    if (fromTs != null && ct < fromTs) continue
    if (toTs != null && ct > toTs) continue
    inWindow.push(o)
  }
  const lines = inWindow.flatMap(explodeOrderToLines).filter(l => l.is_live)
  return {
    lines,
    observed: harvested.length,
    inWindowOrderCount: inWindow.length,
    pageInfo,
  }
}

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
    .select('id, location_id, streamer_id, counted_by_id, count_time, location:locations(name), streamer:users!stream_counts_streamer_id_fkey(name)')
    .eq('id', countId)
    .single()
  if (cErr || !count) {
    return res.status(404).json({ ok: false, error: `Stream count not found: ${cErr?.message || ''}` })
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
  //   upper bound = NOW, not the count's time. The count may be entered
  //     hours after the actual stream ended, and TikTok sometimes finalises
  //     order create_time slightly after the sale — pinning the upper bound
  //     to NOW means late-arriving orders within that gap still count.
  // The "(一定是最新的一场 stream) 但是点货的时间可能是三四天后" workflow
  // (per Will): no time-based lower bound when no prev count, and we
  // paginate back as needed.
  const windowTo = new Date()
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

  // Per-creator breakdown. Each TikTok order line carries live_creator
  // (extracted in explodeOrderToLines). When a stream count covers
  // multiple LIVE sessions (the streamer who was supposed to count
  // before going live skipped it), this map will have >1 entry — that's
  // the signal that the overall audit's per-streamer attribution is
  // unreliable, even if the combined totals match. lark + audit-history
  // surface this as a "MERGED" indicator so the human reviewer doesn't
  // mistake a coincidentally-matching combined total for a clean audit.
  const creatorMap = new Map()
  for (const l of lines) {
    const creator = l.live_creator || '(unknown)'
    const entry = creatorMap.get(creator) || {
      creator,
      total_qty: 0,
      line_count: 0,
      earliest_unix: Infinity,
      latest_unix: 0,
    }
    entry.total_qty += l.quantity
    entry.line_count += 1
    if (l.create_unix) {
      entry.earliest_unix = Math.min(entry.earliest_unix, l.create_unix)
      entry.latest_unix = Math.max(entry.latest_unix, l.create_unix)
    }
    creatorMap.set(creator, entry)
  }
  const perCreator = Array.from(creatorMap.values())
    .map(c => ({
      ...c,
      // Normalise the sentinel back to null for storage
      earliest_unix: c.earliest_unix === Infinity ? null : c.earliest_unix,
    }))
    .sort((a, b) => (a.earliest_unix || 0) - (b.earliest_unix || 0))
  const mergedSessionCount = perCreator.length

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
        sessionLabel: triggeredBy === 'auto_after_count'
          ? '(auto-fetched after stream count)'
          : '(manual reconcile)',
        windowFrom: windowFrom ? windowFrom.toLocaleString() : '(no previous count)',
        windowTo: windowTo.toLocaleString(),
        totalPlatform,
        totalSystem,
        totalDiff,
        flaggedRows: flaggedForLark,
        unmappedCount: unmapped.length,
        threshold: RECONCILE_THRESHOLD,
        mergedSessionCount,
        perCreator,
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
    },
    lark: larkResult,
    duration_ms: Date.now() - started,
  })
}
