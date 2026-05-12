// api/tiktok-fetch-orders.js
// Phase 2.2c: real order fetcher. The network-inspect probe revealed
// TikTok's internal endpoint and confirmed our cookies authenticate
// to it cleanly:
//
//   GET https://seller-us.tiktok.com/api/fulfillment/na/order/list
//   → { code: 0, data: { main_orders: [...], offset, count, total_count } }
//
// So we drop Chromium entirely and just call that API with fetch().
// Returns in ~200ms instead of ~30s, and the response is structured
// JSON instead of scraped HTML.
//
// Each order returned has all the fields the Reconcile flow needs:
//   - main_order_id
//   - trade_order_module.create_time (unix seconds)
//   - sku_module[].product_name, .quantity, .sku_total_price.price_val
//   - order_label_module — contains "LIVE: <creator>" tag for LIVE-source orders
//
// We paginate, filter by date range in-process, optionally drop non-LIVE
// orders, normalise to a flat shape, return JSON.
//
// Query params (or POST body):
//   from         YYYY-MM-DD (required)
//   to           YYYY-MM-DD (required)
//   live_only    true/false (default false; set true to keep only orders
//                with the LIVE: packheadstcg sales-source tag)
//   max_pages    safety cap (default 30 — 30 * 50 = 1500 orders max)

// Extract a cookie value out of the raw "Cookie:" header string.
function getCookieValue(rawHeader, name) {
  const re = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}=([^;]+)`)
  const m = String(rawHeader || '').match(re)
  return m ? m[1] : null
}

// Convert a TikTok main_order shape into the flat object the Reconcile
// page expects. Each SKU becomes its own line, mirroring how the CSV
// export already lays things out (one row per order × SKU combo).
function explodeOrderToLines(o) {
  const createUnix = parseInt(o.trade_order_module?.create_time || '0', 10)
  const createIso = createUnix ? new Date(createUnix * 1000).toISOString() : null

  // LIVE tag detection. The label_module contains "LIVE: <creator>" when
  // the order came from a live stream. Multiple label_modules may exist
  // per order_line; we scan all and take the first match.
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

  // Status code — main_order_status. We don't decode the integer here
  // (TikTok's status enum isn't documented); downstream can branch.
  const statusCode = o.order_status_module?.[0]?.main_order_status || null
  const subStatusCode = o.order_status_module?.[0]?.main_sub_order_status || null

  // Each SKU becomes its own line. Matches the CSV export's "one row per
  // SKU within order" layout so Reconcile's existing parser can consume.
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
  // If an order somehow had no SKU lines, emit a placeholder so it
  // still shows up in totals (this should be rare — Auction-style
  // entries don't have skus).
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

// Hit one page of the order list API and return the parsed JSON.
async function fetchOnePage({ sellerId, fp, cookie, offset, count }) {
  const params = new URLSearchParams({
    locale: 'en',
    language: 'en',
    oec_seller_id: sellerId,
    seller_id: sellerId,
    aid: '4068',
    app_name: 'i18n_ecom_shop',
    fp,
    device_platform: 'web',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'en-US',
    browser_platform: 'MacIntel',
    browser_name: 'Mozilla',
    browser_version: '5.0',
    browser_online: 'true',
    timezone_name: 'America/Los_Angeles',
    offset: String(offset),
    count: String(count),
    // Try the obvious filter keys. If TikTok ignores them server-side
    // we still filter in JS afterwards, so this is best-effort.
  })
  const url = `https://seller-us.tiktok.com/api/fulfillment/na/order/list?${params.toString()}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': cookie,
      // Use a realistic UA. TikTok may compare against the s_v_web_id
      // fingerprint, but in practice a generic Mac Chrome UA works fine.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://seller-us.tiktok.com/order',
      'Origin': 'https://seller-us.tiktok.com',
      // The seller's region matters for some endpoints
      'x-tt-oec-region': 'US',
    },
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`TikTok API HTTP ${response.status}: ${text.slice(0, 400)}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`TikTok API returned non-JSON: ${text.slice(0, 400)}`)
  }
  if (json.code !== 0) {
    throw new Error(`TikTok API returned code=${json.code}: ${json.message || ''}`)
  }
  return json.data || {}
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use GET or POST' })
  }

  // Accept params from query string or JSON body
  const body = req.method === 'POST' ? (req.body || {}) : {}
  const from = req.query.from || body.from
  const to = req.query.to || body.to
  const liveOnlyRaw = req.query.live_only ?? body.liveOnly ?? body.live_only
  const liveOnly = liveOnlyRaw === true || liveOnlyRaw === 'true' || liveOnlyRaw === '1'
  const maxPages = parseInt(req.query.max_pages || body.max_pages || 30, 10) || 30
  const pageSize = 50

  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'Required: from=YYYY-MM-DD&to=YYYY-MM-DD' })
  }

  // Convert YYYY-MM-DD to unix seconds. `to` is inclusive of end-of-day.
  const fromTs = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000)
  const toTs = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000)
  if (!isFinite(fromTs) || !isFinite(toTs)) {
    return res.status(400).json({ ok: false, error: 'Bad date format. Use YYYY-MM-DD.' })
  }

  // Pull cookie + seller info
  const rawCookie = process.env.TIKTOK_COOKIE
  if (!rawCookie) {
    return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE env var not set.' })
  }
  const sellerId =
    getCookieValue(rawCookie, 'oec_seller_id_unified_seller_env') ||
    getCookieValue(rawCookie, 'global_seller_id_unified_seller_env')
  const fp = getCookieValue(rawCookie, 's_v_web_id')
  if (!sellerId) {
    return res.status(500).json({ ok: false, error: 'Could not extract seller_id from TIKTOK_COOKIE' })
  }
  if (!fp) {
    return res.status(500).json({ ok: false, error: 'Could not extract fp (s_v_web_id) from TIKTOK_COOKIE' })
  }

  const started = Date.now()
  const stages = []
  const log = (stage, extra = {}) => stages.push({ stage, t: Date.now() - started, ...extra })
  log('args', { from, to, fromTs, toTs, liveOnly, sellerId, fpSample: fp.slice(0, 30) })

  try {
    // Paginate until we've gone past the `from` date or hit total_count.
    const collected = []   // raw main_orders (within date window)
    let scanned = 0        // total orders the API gave us across pages
    let totalAvailable = null
    let stoppedReason = 'completed'

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      const offset = pageIdx * pageSize
      const page = await fetchOnePage({ sellerId, fp, cookie: rawCookie, offset, count: pageSize })
      const orders = page.main_orders || []
      totalAvailable = page.total_count ?? totalAvailable
      scanned += orders.length
      log('page', { pageIdx, offset, gotOrders: orders.length, totalAvailable })

      if (orders.length === 0) { stoppedReason = 'empty_page'; break }

      // Check if this page extends back past `from`. Orders come in
      // create_time-DESC order, so once a page's most-recent order is
      // older than `from`, we're done.
      let pageHasAnythingInRange = false
      for (const o of orders) {
        const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
        if (ct >= fromTs && ct <= toTs) {
          pageHasAnythingInRange = true
          collected.push(o)
        }
      }
      const newestInPage = parseInt(orders[0]?.trade_order_module?.create_time || '0', 10) || 0
      const oldestInPage = parseInt(orders[orders.length - 1]?.trade_order_module?.create_time || '0', 10) || 0
      log('page_range', { newestInPage, oldestInPage })

      // Stop if every order in this page is OLDER than `from`. The next
      // page would only be older still.
      if (oldestInPage < fromTs && !pageHasAnythingInRange) {
        stoppedReason = 'past_from_date'
        break
      }

      // Stop if we've collected all orders
      if (totalAvailable && (offset + orders.length) >= totalAvailable) {
        stoppedReason = 'reached_total_count'
        break
      }

      // Tiny polite delay to not hammer TikTok
      await new Promise(r => setTimeout(r, 50))
    }
    log('pagination_done', { collected: collected.length, scanned, stoppedReason })

    // Explode each order into one line per SKU, mirroring the CSV format
    let lines = collected.flatMap(explodeOrderToLines)

    // Optional LIVE-only filter
    if (liveOnly) {
      lines = lines.filter(l => l.is_live)
    }
    log('lines_built', { count: lines.length })

    // Sort by create_time ASC for stable downstream consumption
    lines.sort((a, b) => (a.create_unix || 0) - (b.create_unix || 0))

    return res.status(200).json({
      ok: true,
      window: { from, to, fromTs, toTs },
      live_only: liveOnly,
      // Summary numbers
      total_orders_in_window: collected.length,
      total_lines: lines.length,
      scanned_pages: scanned > 0 ? Math.ceil(scanned / pageSize) : 0,
      scanned_orders: scanned,
      total_available_in_shop: totalAvailable,
      stopped_reason: stoppedReason,
      total_ms: Date.now() - started,
      stages,
      // The actual data
      lines,
    })
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      total_ms: Date.now() - started,
      stages,
    })
  }
}
