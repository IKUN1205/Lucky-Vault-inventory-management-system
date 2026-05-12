// api/tiktok-fetch-orders.js
// Phase 2.2d: order fetcher via in-browser fetch.
//
// Direct cross-origin fetch() from a Vercel function to TikTok's order
// API returned 404 — TikTok almost certainly checks something the
// browser supplies (CSRF token, ms_token, request signature, or just
// same-origin enforcement at the edge). Rather than reverse-engineer
// their signing, we just launch Chromium, navigate to /order (which
// authenticates us), and then call fetch() FROM INSIDE THE PAGE.
//
// At that point the request is indistinguishable from a real user
// scrolling the orders table — same cookies, same headers, same
// origin, same fingerprint. Auth just works.
//
// Trade-off: slower than direct fetch (need ~25s cold-start for the
// Chromium boot + page load). Once warm, subsequent pages are fast
// (~1-2s each).
//
// Same response shape as the (broken) direct version, so the Reconcile
// page integration in Phase 2.3 doesn't need to know which approach
// runs underneath.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 60,
}

function getCookieValue(rawHeader, name) {
  const re = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}=([^;]+)`)
  const m = String(rawHeader || '').match(re)
  return m ? m[1] : null
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

// Turn TikTok's main_order shape into our flat per-SKU line format,
// matching the CSV-export shape Reconcile already understands.
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
  const maxPages = parseInt(req.query.max_pages || body.max_pages || 15, 10) || 15
  const pageSize = 50

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
  const sellerId =
    getCookieValue(rawCookie, 'oec_seller_id_unified_seller_env') ||
    getCookieValue(rawCookie, 'global_seller_id_unified_seller_env')
  const fp = getCookieValue(rawCookie, 's_v_web_id')
  if (!sellerId || !fp) {
    return res.status(500).json({
      ok: false,
      error: 'Could not extract seller_id or fp from TIKTOK_COOKIE',
    })
  }

  const started = Date.now()
  const stages = []
  const log = (stage, extra = {}) => stages.push({ stage, t: Date.now() - started, ...extra })
  log('args', { from, to, fromTs, toTs, liveOnly, sellerId, fpSample: fp.slice(0, 30) })

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

    // Land on /order — this triggers TikTok's own login flow + sets up any
    // session state (msToken refresh, fingerprint binding, etc.) that
    // subsequent in-page fetch() calls will reuse implicitly.
    await page.goto('https://seller-us.tiktok.com/order?selected_sort=6&tab=all', {
      waitUntil: 'networkidle2',
      timeout: 40_000,
    })
    log('navigated', { url: page.url() })

    // Sanity-check we're actually logged in (URL didn't redirect to /login)
    const finalUrl = page.url()
    if (/login|signin|account\/verify/i.test(finalUrl)) {
      await browser.close()
      return res.status(401).json({
        ok: false,
        error: 'TikTok cookies appear stale — got redirected to login page. Refresh TIKTOK_COOKIE env var.',
        finalUrl,
      })
    }

    // Paginate from inside the browser. page.evaluate runs in the page's
    // JS context, so fetch() inherits everything: cookies, msToken,
    // x-secsdk-csrf-token, region binding, etc.
    const collected = []
    let scanned = 0
    let totalAvailable = null
    let stoppedReason = 'completed'

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      const offset = pageIdx * pageSize
      const pageResult = await page.evaluate(async ({ sellerId, fp, offset, count }) => {
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
        })
        const url = `https://seller-us.tiktok.com/api/fulfillment/na/order/list?${params.toString()}`
        try {
          const r = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
          })
          const text = await r.text()
          return { ok: true, status: r.status, body: text }
        } catch (e) {
          return { ok: false, error: String(e?.message || e) }
        }
      }, { sellerId, fp, offset, count: pageSize })

      if (!pageResult.ok) {
        log('page_fetch_failed', { pageIdx, error: pageResult.error })
        stoppedReason = 'fetch_error: ' + pageResult.error
        break
      }
      if (pageResult.status !== 200) {
        log('page_non_200', { pageIdx, status: pageResult.status, sample: pageResult.body.slice(0, 200) })
        stoppedReason = `http_${pageResult.status}`
        break
      }

      let pageJson
      try {
        pageJson = JSON.parse(pageResult.body)
      } catch (e) {
        log('page_parse_error', { pageIdx, sample: pageResult.body.slice(0, 200) })
        stoppedReason = 'parse_error'
        break
      }
      if (pageJson.code !== 0) {
        log('page_api_error', { pageIdx, code: pageJson.code, msg: pageJson.message })
        stoppedReason = `api_code_${pageJson.code}`
        break
      }

      const orders = pageJson.data?.main_orders || []
      totalAvailable = pageJson.data?.total_count ?? totalAvailable
      scanned += orders.length
      log('page_done', { pageIdx, offset, gotOrders: orders.length, totalAvailable })

      if (orders.length === 0) { stoppedReason = 'empty_page'; break }

      // Orders come create_time-DESC. Collect ones in our window.
      let pageHasInRange = false
      for (const o of orders) {
        const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
        if (ct >= fromTs && ct <= toTs) {
          pageHasInRange = true
          collected.push(o)
        }
      }
      const oldestInPage = parseInt(orders[orders.length - 1]?.trade_order_module?.create_time || '0', 10) || 0

      // Stop once the whole page is older than `from`.
      if (oldestInPage < fromTs && !pageHasInRange) {
        stoppedReason = 'past_from_date'
        break
      }
      if (totalAvailable && (offset + orders.length) >= totalAvailable) {
        stoppedReason = 'reached_total_count'
        break
      }

      // Brief polite delay
      await new Promise(r => setTimeout(r, 80))
    }
    log('pagination_done', { collected: collected.length, scanned, stoppedReason })

    await browser.close()

    let lines = collected.flatMap(explodeOrderToLines)
    if (liveOnly) {
      lines = lines.filter(l => l.is_live)
    }
    lines.sort((a, b) => (a.create_unix || 0) - (b.create_unix || 0))

    return res.status(200).json({
      ok: true,
      window: { from, to, fromTs, toTs },
      live_only: liveOnly,
      total_orders_in_window: collected.length,
      total_lines: lines.length,
      scanned_orders: scanned,
      total_available_in_shop: totalAvailable,
      stopped_reason: stoppedReason,
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
