// api/tiktok-auth-probe.js
// Phase 2.1: verify we can authenticate into TikTok Seller Center with the
// stored cookies. Before sinking time into scraping logic, prove the
// auth path works end-to-end:
//
//   1. Read raw "Cookie:" header value from process.env.TIKTOK_COOKIE
//   2. Parse it into Playwright/Puppeteer cookie objects
//   3. Launch headless Chromium
//   4. Set the cookies on .tiktok.com
//   5. Navigate to seller-us.tiktok.com/order
//   6. Detect login state: if we landed on /login or /signin, cookies are
//      stale; otherwise we should see the orders page chrome.
//   7. Return diagnostic JSON
//
// Read-only probe. No side effects. Safe to call repeatedly while
// debugging cookie issues.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 60,
}

// Parse a raw browser "Cookie:" header value (the format you get from the
// Network tab in DevTools) into the array of cookie objects that
// page.setCookie expects.
//
// Input:  "tt_csrf_token=abc; sessionid=xyz; passport_csrf_token=def"
// Output: [
//   { name: 'tt_csrf_token', value: 'abc', domain: '.tiktok.com', path: '/' },
//   ...
// ]
//
// We set domain to '.tiktok.com' so the cookies are sent to any subdomain
// (seller-us, etc.). HttpOnly cookies are fine — they only matter for
// document.cookie access; setCookie injects them directly via CDP.
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
  if (!raw) {
    return res.status(500).json({
      ok: false,
      error: 'TIKTOK_COOKIE env var is not set on Vercel. See README for how to extract and add it.',
    })
  }

  const cookies = parseCookieHeader(raw)
  if (cookies.length === 0) {
    return res.status(500).json({
      ok: false,
      error: 'TIKTOK_COOKIE parsed to zero cookies — value looks malformed.',
    })
  }
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
    // Use a fresh, "normal" user agent so we don't broadcast HeadlessChrome
    // in the UA string — small but real anti-detection nicety.
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    )
    log('page_created')

    await page.setCookie(...cookies)
    log('cookies_set')

    // Navigate. networkidle2 is forgiving — Seller Center loads lots of
    // dashboard widgets in the background, we just need the main shell.
    const targetUrl = 'https://seller-us.tiktok.com/order?selected_sort=6&tab=all'
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    })
    log('navigated', { url: page.url() })

    const finalUrl = page.url()
    // Heuristic login detection:
    //   - If TikTok redirects to a login/signin page, cookies are stale.
    //   - If we stayed on /order, we're authed.
    const loginRedirect = /login|signin|seller-us\.tiktok\.com\/account|verify/i.test(finalUrl)
    log('login_check', { loginRedirect })

    // Try to read recognisable strings from the page so we know how deep we got.
    const probes = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      return {
        bodyChars: text.length,
        // Strings that should ONLY appear when logged in to Manage Orders:
        hasManageOrders: /Manage orders/i.test(text),
        hasOrdersTable: !!document.querySelector('table, [role="grid"]'),
        // Indicators of login wall:
        hasLogIn: /Log\s*in|Sign\s*in/i.test(text),
        title: document.title,
      }
    }).catch(() => ({}))
    log('probed_dom', probes)

    // Optional screenshot for debugging — encode as base64 so it travels
    // back in the JSON. ~50-200 KB depending on the page.
    let screenshotB64 = null
    try {
      const buf = await page.screenshot({ type: 'png', fullPage: false })
      screenshotB64 = `data:image/png;base64,${buf.toString('base64').slice(0, 200000)}`
      log('screenshot_taken', { bytes: buf.length })
    } catch (e) {
      log('screenshot_failed', { err: e.message })
    }

    await browser.close()

    const looksLoggedIn = !loginRedirect && (probes.hasManageOrders || probes.hasOrdersTable)
    return res.status(200).json({
      ok: looksLoggedIn,
      message: looksLoggedIn
        ? '🟢 Logged in successfully. Cookies are valid.'
        : '🔴 Looks like we hit a login wall. Cookies may be stale or scoped to a different region.',
      finalUrl,
      probes,
      cookieCount: cookies.length,
      total_ms: Date.now() - started,
      stages,
      // screenshot is large — only return when explicitly requested with ?screenshot=1
      ...(req.query?.screenshot ? { screenshotB64 } : {}),
    })
  } catch (err) {
    if (browser) { try { await browser.close() } catch {} }
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      name: err?.name,
      total_ms: Date.now() - started,
      stages,
    })
  }
}
