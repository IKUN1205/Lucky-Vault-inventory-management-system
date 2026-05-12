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

// Use service role so we can write to stream_reconciliations regardless
// of RLS. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already set in
// Vercel for other endpoints.
function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing (need URL + SERVICE_ROLE_KEY)')
  return createClient(url, key, { auth: { persistSession: false } })
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
async function harvestTikTokOrders({ rawCookie, fromTs, toTs }) {
  const cookies = parseCookieHeader(rawCookie)
  const harvested = []

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
    await new Promise(r => setTimeout(r, 5000))
  } finally {
    await browser.close()
  }

  // Dedupe + filter
  const seen = new Set()
  const inWindow = []
  for (const o of harvested) {
    const id = o.main_order_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
    if (ct >= fromTs && ct <= toTs) inWindow.push(o)
  }
  const lines = inWindow.flatMap(explodeOrderToLines).filter(l => l.is_live)
  return { lines, observed: harvested.length, inWindowOrderCount: inWindow.length }
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
  const supabase = supabaseAdmin()

  // ---- Step 1: load the stream count + items + previous count ----
  const { data: count, error: cErr } = await supabase
    .from('stream_counts')
    .select('id, location_id, streamer_id, counted_by_id, count_time, location:locations(name), streamer:users!stream_counts_streamer_id_fkey(name)')
    .eq('id', countId)
    .single()
  if (cErr || !count) {
    return res.status(404).json({ ok: false, error: `Stream count not found: ${cErr?.message || ''}` })
  }
  const isTikTokRoom = /TikTok/i.test(count.location?.name || '')
  if (!isTikTokRoom) {
    return res.status(400).json({ ok: false, error: `Auto-reconcile only supports TikTok rooms. This count is at: ${count.location?.name}` })
  }

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

  // Window: from previous count to this count. If no previous, 36h back.
  const windowTo = new Date(count.count_time)
  const windowFrom = prevCount
    ? new Date(prevCount.count_time)
    : new Date(windowTo.getTime() - 36 * 60 * 60 * 1000)
  const fromTs = Math.floor(windowFrom.getTime() / 1000)
  const toTs = Math.floor(windowTo.getTime() / 1000)

  const baseRecord = {
    stream_count_id: countId,
    triggered_by: triggeredBy,
    triggered_by_user_id: triggeredByUserId,
    source: 'tiktok_api',
    window_from: windowFrom.toISOString(),
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
  try {
    const rawCookie = process.env.TIKTOK_COOKIE
    if (!rawCookie) throw new Error('TIKTOK_COOKIE env var not set')
    const result = await harvestTikTokOrders({ rawCookie, fromTs, toTs })
    lines = result.lines
    observed = result.observed
  } catch (err) {
    // Persist failure so the audit-history page can show it
    const failureRecord = {
      ...baseRecord,
      status: 'failed',
      error_message: err.message || String(err),
      duration_ms: Date.now() - started,
    }
    await supabase
      .from('stream_reconciliations')
      .upsert(failureRecord, { onConflict: 'stream_count_id' })
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
  let larkResult = null
  try {
    const flaggedForLark = flaggedRows.slice(0, 15).map(r => ({
      product: r.product_name,
      platform: r.platform_qty,
      system: r.system_qty,
      diff: r.diff,
    }))
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
    const larkRes = await fetch(`${baseUrl}/api/lark-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'reconciliation',
        roomName: count.location?.name,
        streamerName: count.streamer?.name,
        sessionLabel: triggeredBy === 'auto_after_count'
          ? '(auto-fetched after stream count)'
          : '(manual reconcile)',
        windowFrom: windowFrom.toLocaleString(),
        windowTo: windowTo.toLocaleString(),
        totalPlatform,
        totalSystem,
        totalDiff,
        flaggedRows: flaggedForLark,
        unmappedCount: unmapped.length,
        threshold: RECONCILE_THRESHOLD,
      }),
    })
    const larkData = await larkRes.json().catch(() => ({}))
    if (larkRes.ok && larkData.ok) {
      larkResult = { ok: true, target: larkData.target || 'unknown' }
      // Stamp lark_sent_at
      await supabase
        .from('stream_reconciliations')
        .update({ lark_sent_at: new Date().toISOString(), lark_target: larkData.target || null })
        .eq('stream_count_id', countId)
    } else {
      larkResult = { ok: false, error: larkData?.error || `HTTP ${larkRes.status}` }
    }
  } catch (err) {
    larkResult = { ok: false, error: err.message }
  }

  return res.status(200).json({
    ok: true,
    triggered_by: triggeredBy,
    window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
    summary: {
      total_platform_units: totalPlatform,
      total_system_units: totalSystem,
      total_diff: totalDiff,
      flagged_count: flaggedRows.length,
      unmapped_count: unmapped.length,
      tiktok_lines: lines.length,
      orders_observed: observed,
    },
    lark: larkResult,
    duration_ms: Date.now() - started,
  })
}
