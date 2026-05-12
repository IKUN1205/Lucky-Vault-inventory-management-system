// api/tiktok-fetch-orders.js
// Phase 2.2e: order fetcher via response interception (the approach
// that finally works).
//
// Earlier attempts:
//   2.2c: direct cross-origin fetch() → 404 (TikTok edge rejection)
//   2.2d: in-page fetch() via page.evaluate → 404 (TikTok still
//         detected something — likely the manual offset/count params
//         and/or webdriver flag)
//
// What works (proven by inspect-network probe): when the page loads
// /order itself, TikTok's own JS fires the API call and it succeeds.
// So instead of constructing our own call, we just attach page.on
// ('response', ...) before navigation, let TikTok do its own thing,
// and harvest whatever order/list responses we see.
//
// To get more than the default 20 orders, we drive the page UI
// (scroll, page-size changes, clicks) — but for a single stream
// session, 20-50 orders is usually plenty. MVP returns page 1; if we
// hit a use case that needs more, we add UI-driven pagination.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 60,
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
  const createIso = createUnix ? new Date(createUnix * 1000).toISOString() : null

  let isLive = false
  let liveCreator = null
  for (const lblMod of o.order_label_module || []) {
    const tag = lblMod?.label_express_map?.sales_source_live_tag
    const items = tag?.value?.v_dynamic_express?.items || []
    for (const it of items) {
      const m = String(it?.message_content || '').match(/LIVE:\s*(.+?)\s*$/i)
      if (m) {
        isLive = true
        liveCreator = m[1].trim()
        break
      }
    }
    if (isLive) break
  }

  const statusCode = o.order_status_module?.[0]?.main_order_status || null
  const subStatusCode = o.order_status_module?.[0]?.main_sub_order_status || null

  const lines = []
  for (const sku of o.sku_module || []) {
    lines.push({
      order_id: o.main_order_id,
      create_time: createIso,
      create_unix: createUnix,
      status_code: statusCode,
      sub_status_code: subStatusCode,
      is_live: isLive,
      live_creator: liveCreator,
      sku_id: sku.sku_id || null,
      product_name: sku.product_name || null,
      sku_name: sku.sku_name || null,
      quantity: parseInt(sku.quantity || 0, 10) || 0,
      unit_price: parseFloat(sku.sku_unit_price?.price_val || '0') || 0,
      total_price: parseFloat(sku.sku_total_price?.price_val || '0') || 0,
      currency: sku.sku_unit_price?.currency || 'USD',
    })
  }
  if (lines.length === 0) {
    lines.push({
      order_id: o.main_order_id,
      create_time: createIso,
      create_unix: createUnix,
      status_code: statusCode,
      sub_status_code: subStatusCode,
      is_live: isLive,
      live_creator: liveCreator,
      sku_id: null,
      product_name: '(no sku)',
      sku_name: null,
      quantity: 0,
      unit_price: 0,
      total_price: 0,
      currency: 'USD',
    })
  }
  return lines
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use GET or POST' })
  }

  const body = req.method === 'POST' ? (req.body || {}) : {}
  const from = req.query.from || body.from
  const to = req.query.to || body.to
  const liveOnlyRaw = req.query.live_only ?? body.liveOnly ?? body.live_only
  const liveOnly = liveOnlyRaw === true || liveOnlyRaw === 'true' || liveOnlyRaw === '1'
  // How long to wait after page load for TikTok to fire its own fetches.
  // Default 5s — most order/list calls fire within the first 3s.
  const dwellMs = parseInt(req.query.dwell_ms || body.dwell_ms || 5000, 10) || 5000
  // Optional ?tab=all|to_ship|shipped|completed|pending|canceled
  const tab = req.query.tab || body.tab || 'all'

  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'Required: from=YYYY-MM-DD&to=YYYY-MM-DD' })
  }
  const fromTs = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000)
  const toTs = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000)
  if (!isFinite(fromTs) || !isFinite(toTs)) {
    return res.status(400).json({ ok: false, error: 'Bad date format. Use YYYY-MM-DD.' })
  }

  const rawCookie = process.env.TIKTOK_COOKIE
  if (!rawCookie) {
    return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE env var not set.' })
  }
  const cookies = parseCookieHeader(rawCookie)

  const started = Date.now()
  const stages = []
  const log = (stage, extra = {}) => stages.push({ stage, t: Date.now() - started, ...extra })
  log('args', { from, to, fromTs, toTs, liveOnly, tab, dwellMs })

  let browser = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
    log('browser_launched')

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setCookie(...cookies)
    log('cookies_set')

    // Set up response interception BEFORE navigating. TikTok's page JS
    // fires its own /api/fulfillment/na/order/list calls during load —
    // we just observe and parse them.
    const harvestedPages = [] // each item: { offset, count, total, orders }
    const interceptErrors = []
    page.on('response', async (response) => {
      const url = response.url()
      if (!/api\/fulfillment\/na\/order\/list/i.test(url)) return
      try {
        const text = await response.text()
        const json = JSON.parse(text)
        if (json.code === 0 && Array.isArray(json.data?.main_orders)) {
          harvestedPages.push({
            url,
            offset: json.data.offset,
            count: json.data.count,
            total: json.data.total_count,
            orders: json.data.main_orders,
            status: response.status(),
          })
        }
      } catch (e) {
        interceptErrors.push(e?.message || String(e))
      }
    })

    // Build the target URL. We can't filter dates via URL params (TikTok
    // strips them), but tab=... works.
    const targetUrl = `https://seller-us.tiktok.com/order?selected_sort=6&tab=${encodeURIComponent(tab)}`
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 40_000,
    })
    log('navigated', { url: page.url() })

    // Bail early if we got bounced to login
    if (/login|signin|account\/verify/i.test(page.url())) {
      await browser.close()
      return res.status(401).json({
        ok: false,
        error: 'TikTok cookies appear stale — got redirected to login. Refresh TIKTOK_COOKIE.',
        finalUrl: page.url(),
      })
    }

    // Let TikTok finish firing its own XHRs (some are debounced after
    // networkidle2 fires).
    await new Promise(r => setTimeout(r, dwellMs))
    log('dwelled', { dwellMs, harvestedPagesCount: harvestedPages.length })

    await browser.close()

    // Aggregate orders, dedupe by main_order_id (multiple intercepts of
    // the same order are possible — e.g. when filters refresh).
    const seenIds = new Set()
    const allOrders = []
    for (const page of harvestedPages) {
      for (const o of page.orders) {
        const id = o.main_order_id
        if (!id || seenIds.has(id)) continue
        seenIds.add(id)
        allOrders.push(o)
      }
    }
    log('orders_aggregated', { unique: allOrders.length, fromPages: harvestedPages.length })

    // Filter by date window
    const inWindow = allOrders.filter(o => {
      const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
      return ct >= fromTs && ct <= toTs
    })

    // Explode into per-SKU lines + optional LIVE-only filter
    let lines = inWindow.flatMap(explodeOrderToLines)
    if (liveOnly) lines = lines.filter(l => l.is_live)
    lines.sort((a, b) => (a.create_unix || 0) - (b.create_unix || 0))

    // The page only auto-loads its initial 20-50 orders. If the date
    // window stretches further back than that, the user should narrow
    // the window or we'll add scroll-driven pagination later.
    const oldestSeenUnix = allOrders.length > 0
      ? Math.min(...allOrders.map(o => parseInt(o.trade_order_module?.create_time || '0', 10) || 0))
      : null
    const oldestSeenIso = oldestSeenUnix
      ? new Date(oldestSeenUnix * 1000).toISOString()
      : null
    const dataCoversFromDate = oldestSeenUnix !== null && oldestSeenUnix <= fromTs

    return res.status(200).json({
      ok: true,
      window: { from, to, fromTs, toTs },
      live_only: liveOnly,
      total_orders_in_window: inWindow.length,
      total_lines: lines.length,
      // How many orders the page itself returned — useful to know if we
      // saw enough recent activity to cover the window.
      orders_observed: allOrders.length,
      oldest_seen_at: oldestSeenIso,
      data_covers_from_date: dataCoversFromDate,
      pages_intercepted: harvestedPages.length,
      // Total available across the whole shop (useful sanity check)
      total_available_in_shop: harvestedPages[0]?.total ?? null,
      intercept_errors: interceptErrors.slice(0, 3),
      total_ms: Date.now() - started,
      stages,
      lines,
    })
  } catch (err) {
    if (browser) { try { await browser.close() } catch {} }
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      total_ms: Date.now() - started,
      stages,
    })
  }
}
