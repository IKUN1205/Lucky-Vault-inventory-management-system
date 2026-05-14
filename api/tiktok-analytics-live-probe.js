// api/tiktok-analytics-live-probe.js
//
// Diagnostic: navigate to TikTok seller-center's "Content Analytics → LIVE"
// page and capture every XHR response. We want to know which API endpoint
// the page calls and what the response JSON looks like, so we can switch
// auto-reconcile from "scrape order list + cluster by time" (lossy) to
// "scrape this page directly for session boundaries + LIVE-attributed GMV"
// (TikTok's own ground truth).
//
// Returns:
//   - list of every XHR that fired on the page (URL + sample of response body)
//   - filter list to /api/* or /aweme/v1/* or similar paths only
//   - sample of the LIVE session rows visible in the DOM
//
// Hit manually:
//   curl https://lucky-vault-inventory-management-sy.vercel.app/api/tiktok-analytics-live-probe

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { parseCookieHeader } from './_lib/tiktok.js'

export const config = {
  maxDuration: 90,
}

export default async function handler(req, res) {
  const rawCookie = process.env.TIKTOK_COOKIE
  if (!rawCookie) {
    return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE env var not set' })
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  const xhrCalls = []        // every observed XHR/fetch (url + status + sample)
  const apiResponses = []    // only the JSON ones that look like data endpoints

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setCookie(...parseCookieHeader(rawCookie))

    page.on('response', async (response) => {
      const url = response.url()
      // Ignore static assets and tracking pings
      if (/\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?|ico)(\?|$)/i.test(url)) return
      if (/log(?:s|ger)?|track|beacon|sentry|sentry-cdn/i.test(url)) return
      const status = response.status()
      let bodyPreview = null
      let isJson = false
      let parsedShape = null
      try {
        const ct = response.headers()['content-type'] || ''
        if (/json/i.test(ct)) {
          isJson = true
          const text = await response.text()
          bodyPreview = text.slice(0, 800)
          try {
            const json = JSON.parse(text)
            // Capture top-level shape (keys + sample sizes) — full body might be huge
            parsedShape = describeShape(json, 0)
          } catch {}
        }
      } catch {}
      const entry = {
        url: url.length > 250 ? url.slice(0, 250) + '…(truncated)' : url,
        status,
        isJson,
        bodyPreview,
        parsedShape,
      }
      xhrCalls.push(entry)
      // Only keep JSON responses that come from a path that looks data-y
      if (isJson && /\/api\/|\/v\d\/|compass|analytics|live/i.test(url)) {
        apiResponses.push(entry)
      }
    })

    await page.goto('https://seller-us.tiktok.com/compass/analytics-live?shop_region=US', {
      waitUntil: 'networkidle2',
      timeout: 50_000,
    })
    if (/login|signin|account\/verify/i.test(page.url())) {
      await browser.close()
      return res.status(401).json({ ok: false, error: 'Cookie stale — redirected to login' })
    }
    // Long initial dwell — the LIVE session list is lazy-loaded after the
    // page chrome finishes hydrating
    await new Promise(r => setTimeout(r, 15000))

    // Try to scroll the page so any "load on scroll" data fires
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
    await new Promise(r => setTimeout(r, 5000))

    // Try to click "LIVE performance" sub-tab if not already on it
    await page.evaluate(() => {
      // Look for an anchor / button containing "LIVE performance"
      const els = Array.from(document.querySelectorAll('a, button, li, div'))
      for (const el of els) {
        const txt = (el.textContent || '').trim()
        if (txt === 'LIVE performance' || txt === 'LIVE') {
          el.click()
          return true
        }
      }
      return false
    }).catch(() => {})
    await new Promise(r => setTimeout(r, 5000))

    // Best-effort: dump a snapshot of table rows visible in the DOM, so we
    // can correlate XHR JSON with what the user actually sees.
    const domSnapshot = await page.evaluate(() => {
      const rows = []
      const trs = document.querySelectorAll('table tr')
      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll('th,td'))
          .map(c => (c.textContent || '').trim().slice(0, 80))
        if (cells.some(c => c)) rows.push(cells)
      }

      // Also dump the Start time <th> HTML so we can see what clickable
      // element triggers the sort. Useful for diagnosing why automated
      // clicks aren't toggling the sort order.
      let startTimeHeaderHtml = null
      let allTHs = []
      const ths = Array.from(document.querySelectorAll('th'))
      for (const th of ths) {
        const txt = (th.textContent || '').trim()
        allTHs.push({
          text: txt.slice(0, 40),
          ariaSort: th.getAttribute('aria-sort'),
          cls: th.getAttribute('class'),
          childTags: Array.from(th.children).map(c => `${c.tagName}.${(c.getAttribute('class') || '').slice(0, 50)}`),
        })
        if (txt.startsWith('Start time')) {
          startTimeHeaderHtml = th.outerHTML.slice(0, 2000)
        }
      }

      return {
        url: location.href,
        rowCount: rows.length,
        rows: rows.slice(0, 10),
        allTHs,
        startTimeHeaderHtml,
      }
    })

    await browser.close()

    // Filter the URL list aggressively to only show ones that LOOK like data
    // endpoints. Drop monitoring/tracking/CDN noise. We want to be able to
    // visually spot the LIVE session list endpoint in this list.
    const allDataXhrs = xhrCalls
      .filter(x => {
        const u = x.url
        // Drop monitoring + tracking
        if (/mcs(?:-sg)?\.tiktokv?\.com|mon\d+|libraweb|monitor_web|sentry|track|abtest_config|tiktokcdn/.test(u)) return false
        // Drop user-webid / heartbeat
        if (/\/v1\/user\/webid|\/v1\/list/.test(u)) return false
        // Drop data: URIs
        if (u.startsWith('data:')) return false
        // Drop static assets / image
        if (/\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?|ico)/i.test(u)) return false
        // Drop i18n / locale strings
        if (/starling|i18n_ecom|i18n-resources|locales\/en\.json/.test(u)) return false
        return true
      })
      .map(x => ({ url: x.url, status: x.status, shape: x.parsedShape }))

    return res.status(200).json({
      ok: true,
      url: 'https://seller-us.tiktok.com/compass/analytics-live?shop_region=US',
      xhr_count: xhrCalls.length,
      api_response_count: apiResponses.length,
      data_xhrs_count: allDataXhrs.length,
      // Most interesting list — should contain the LIVE session data endpoint
      data_xhrs: allDataXhrs,
      dom: domSnapshot,
    })
  } catch (err) {
    try { await browser.close() } catch {}
    return res.status(500).json({ ok: false, error: err.message || String(err) })
  }
}

// Recursive structural description of a JSON value, capped depth and array size
// so we don't blow up the response on huge payloads.
function describeShape(v, depth) {
  if (depth > 4) return '...(deep)'
  if (v === null) return 'null'
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array(0)'
    return `array(${v.length}) of ${describeShape(v[0], depth + 1)}`
  }
  if (typeof v === 'object') {
    const out = {}
    let keysShown = 0
    for (const k of Object.keys(v)) {
      if (keysShown >= 30) { out['…'] = `(${Object.keys(v).length - keysShown} more keys)`; break }
      out[k] = describeShape(v[k], depth + 1)
      keysShown++
    }
    return out
  }
  if (typeof v === 'string') {
    return v.length > 60 ? `"${v.slice(0, 60)}…"` : `"${v}"`
  }
  return typeof v
}
