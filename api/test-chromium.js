// api/test-chromium.js
// Vercel serverless function used to verify that headless Chromium can
// actually launch inside a Vercel function. This is the smallest possible
// "can we even host this here?" test before we sink time into the TikTok
// scraping logic.
//
// What it does:
//   1. Imports @sparticuz/chromium + puppeteer-core
//   2. Launches a headless browser
//   3. Opens about:blank
//   4. Returns { ok: true, ...metadata }
//
// What to look at in the response:
//   - HTTP 200 with ok=true → 🟢 Chromium runs on Vercel. We can build the
//     real scraper on this same stack.
//   - HTTP 500 with "function size limit exceeded" (or similar) → 🔴 We're
//     over Vercel's 50 MB hobby/250 MB pro limit. Need to switch to Railway.
//   - HTTP 500 with "timeout" → 🟡 Cold start was too slow. May still be
//     fixable with longer timeouts or pre-warming.
//   - HTTP 500 with anything else → diagnose case-by-case.
//
// This endpoint is read-only and produces no side effects — safe to call
// repeatedly. Delete or password-protect once we've validated the build.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

// Vercel function config: bump memory + timeout because cold-starting
// headless Chromium can need ~1-2 GB RAM and 10-20s on first invocation.
export const config = {
  maxDuration: 60,
}

export default async function handler(req, res) {
  const started = Date.now()
  const stages = []
  const log = (stage, extra = {}) => stages.push({ stage, t: Date.now() - started, ...extra })

  let browser = null
  try {
    log('start')

    // chromium.executablePath() returns the local Chromium binary path that
    // Sparticuz packages for serverless. The first call downloads/extracts
    // it — subsequent calls within the same warm Lambda are instant.
    const execPath = await chromium.executablePath()
    log('got_executable_path', { execPath: execPath?.slice(0, 80) })

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless,
    })
    log('browser_launched')

    const page = await browser.newPage()
    log('page_created')

    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10_000 })
    log('navigated_blank')

    const title = await page.title()
    const userAgent = await browser.userAgent()
    log('inspected_page', { title, userAgent: userAgent?.slice(0, 80) })

    await browser.close()
    log('closed')

    return res.status(200).json({
      ok: true,
      message: '🟢 Chromium launched successfully on Vercel.',
      total_ms: Date.now() - started,
      stages,
      env: {
        node: process.version,
        platform: process.platform,
        region: process.env.VERCEL_REGION || null,
      },
    })
  } catch (err) {
    if (browser) {
      try { await browser.close() } catch {}
    }
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      name: err?.name,
      total_ms: Date.now() - started,
      stages,
    })
  }
}
