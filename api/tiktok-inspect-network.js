// api/tiktok-inspect-network.js
// Phase 2.2b: network sniffer. The DOM-scrape angle is fragile — TikTok
// uses two stacked tables with sticky headers, the data rows live in
// table #2 not #1, and the URL date filters get stripped by TikTok on
// navigation. Way better path: intercept the JSON API the page itself
// uses to load orders, then call that API directly from a future
// endpoint. If TikTok exposes a clean order/list endpoint, we can
// likely drop Chromium entirely for the actual fetching.
//
// What this probe does:
//   1. Auth + navigate to /order (same as inspect-orders)
//   2. While the page loads, log every JSON response coming back from
//      TikTok APIs
//   3. Return the URL, status, response-size, and a 1.5 KB sample of
//      the body for each one
//   4. Filter heuristically to responses that look like order lists
//      (URL contains order|list|search, response is JSON, has lots of
//      items)
//
// Once we see the actual API in the output, we can:
//   - Replay it directly with fetch() and cookies — no Chromium needed
//   - Pass date/LIVE-session params correctly
//   - Get all fields we need (Created Time, Subtotal, status, etc.)

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

export default async function handler(req, res) {
  const started = Date.now()
  const stages = []
  const log = (stage, extra = {}) => stages.push({ stage, t: Date.now() - started, ...extra })

  const raw = process.env.TIKTOK_COOKIE
  if (!raw) return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE env var is not set.' })
  const cookies = parseCookieHeader(raw)
  if (!cookies.length) return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE parsed to zero cookies.' })
  log('cookies_parsed', { count: cookies.length })

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

    // ---- Network capture ----
    // Buffer all TikTok API responses so we can return them after the
    // page settles. We cap each body sample at 1.5 KB so the function
    // response stays under Vercel's payload limit.
    const captures = []
    page.on('response', async (response) => {
      const url = response.url()
      // Only care about TikTok seller / shop / order APIs
      if (!/tiktok\.com\/api/i.test(url)) return
      // Skip static assets and tracking pings
      if (/\.(js|css|png|jpg|gif|svg|woff|ico)(\?|$)/i.test(url)) return
      try {
        const headers = response.headers()
        const ct = headers['content-type'] || ''
        // Only JSON-ish responses
        if (!/json|text/i.test(ct)) return
        const status = response.status()
        const bodyText = await response.text().catch(() => '')
        const len = bodyText.length
        // Heuristic: is this an order-list-ish payload?
        const looksOrdery =
          /order|list|search|export/i.test(url) ||
          /\"order_id\"|\"orderId\"|\"order_no\"|\"items\"|\"total_amount\"/i.test(bodyText.slice(0, 4000))
        captures.push({
          url,
          status,
          contentType: ct,
          bodyChars: len,
          looksOrdery,
          // Truncate body to keep response payload small. Make the sample
          // bigger when it looks like the right endpoint.
          bodySample: bodyText.slice(0, looksOrdery ? 4000 : 800),
        })
      } catch (e) {
        // ignore individual capture failures
      }
    })

    // Navigate. networkidle2 gives us a moment for the initial XHRs to fire.
    await page.goto('https://seller-us.tiktok.com/order?selected_sort=6&tab=all', {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    })
    log('navigated', { url: page.url() })

    // Give it another 3s for any delayed XHRs (sometimes order data loads
    // *after* networkidle2 because of debounce / lazy hydration).
    await new Promise(r => setTimeout(r, 3000))
    log('settled', { capturesSoFar: captures.length })

    // Also peek at the second table for a sanity check that data is there
    const secondTablePeek = await page.evaluate(() => {
      const tables = document.querySelectorAll('table')
      const peek = []
      tables.forEach((t, idx) => {
        const rows = t.querySelectorAll('tbody tr')
        peek.push({
          tableIndex: idx,
          rowCount: rows.length,
          firstRowText: rows[0]?.innerText?.slice(0, 200) || null,
        })
      })
      return peek
    }).catch(() => null)
    log('peeked_tables', { peek: secondTablePeek })

    await browser.close()

    // Sort captures: order-y endpoints first, then by body size descending
    // (bigger response = more likely the real data endpoint).
    captures.sort((a, b) => {
      if (a.looksOrdery !== b.looksOrdery) return a.looksOrdery ? -1 : 1
      return b.bodyChars - a.bodyChars
    })

    return res.status(200).json({
      ok: true,
      totalCaptures: captures.length,
      orderyCaptures: captures.filter(c => c.looksOrdery).length,
      // Return the top 8 captures — the order-list API should be in the top 3
      captures: captures.slice(0, 8),
      tablePeek: secondTablePeek,
      total_ms: Date.now() - started,
      stages,
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
