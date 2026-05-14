// api/tiktok-pagination-probe.js
//
// One-off diagnostic: navigate to TikTok seller-center order page, dwell,
// then enumerate every element that LOOKS like a pagination control. The
// goal is to figure out the actual selectors TikTok is using right now,
// because our existing pagination click logic in api/_lib/tiktok.js was
// returning hit_end_of_list=true after 1 page — meaning none of our
// guess selectors matched.
//
// Returns:
//   - Lists of buttons / list-items / anchors that contain "next" or "page"
//     in their class / aria / title / text content
//   - The first 50 chars of the visible table area for context
//   - For each candidate, whether it appears enabled/disabled
//
// Not part of the regular pipeline. Hit it manually:
//   curl https://lucky-vault-inventory-management-sy.vercel.app/api/tiktok-pagination-probe

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { parseCookieHeader } from './_lib/tiktok.js'

export const config = {
  maxDuration: 60,
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
  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setCookie(...parseCookieHeader(rawCookie))
    await page.goto('https://seller-us.tiktok.com/order?selected_sort=6&tab=all', {
      waitUntil: 'networkidle2',
      timeout: 40_000,
    })
    if (/login|signin|account\/verify/i.test(page.url())) {
      await browser.close()
      return res.status(401).json({ ok: false, error: 'Cookie stale — redirected to login' })
    }

    // Dwell so TikTok finishes lazy-loading anything async.
    await new Promise(r => setTimeout(r, 6000))

    const probe = await page.evaluate(() => {
      // Helper: serialize an element compactly
      const serialize = (el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute('class') || '',
        id: el.getAttribute('id') || '',
        aria: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        role: el.getAttribute('role') || '',
        text: (el.textContent || '').trim().slice(0, 30),
        disabled: el.hasAttribute('disabled') || el.classList.contains('disabled') ||
                  Array.from(el.classList).some(c => /disabled/i.test(c)),
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      })

      // 1. All elements with "pagination" in class
      const paginationClass = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const cls = el.getAttribute('class') || ''
          return /pagination/i.test(cls)
        })
        .slice(0, 30)
        .map(serialize)

      // 2. All buttons with "next" or "page" in aria/title/text
      const nextLike = Array.from(document.querySelectorAll('button, a, li, span, div'))
        .filter(el => {
          const aria = el.getAttribute('aria-label') || ''
          const title = el.getAttribute('title') || ''
          const txt = (el.textContent || '').trim()
          return (
            /next|page/i.test(aria) ||
            /next|page/i.test(title) ||
            /^(next|page \d|>|»)$/i.test(txt)
          )
        })
        .slice(0, 30)
        .map(serialize)

      // 3. Anything that looks like a single-digit / number-only clickable
      // (page number buttons usually have just "1", "2", etc.)
      const numericLike = Array.from(document.querySelectorAll('li, button, a, span'))
        .filter(el => {
          const txt = (el.textContent || '').trim()
          return /^\d{1,3}$/.test(txt) && el.offsetWidth > 0
        })
        .slice(0, 20)
        .map(serialize)

      // 4. The scrollable container of the order table (if any)
      const tables = Array.from(document.querySelectorAll('table'))
      const tableInfo = tables.map(t => {
        let scrollParent = t.parentElement
        while (scrollParent && scrollParent !== document.body) {
          const cs = getComputedStyle(scrollParent)
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break
          scrollParent = scrollParent.parentElement
        }
        return {
          rows: t.rows.length,
          scrollParent: scrollParent && scrollParent !== document.body
            ? serialize(scrollParent)
            : null,
        }
      })

      // 5. Body text size (sanity)
      const bodyChars = (document.body.textContent || '').length

      return {
        url: location.href,
        paginationClass,
        nextLike,
        numericLike,
        tableInfo,
        bodyChars,
      }
    })

    await browser.close()
    return res.status(200).json({ ok: true, probe })
  } catch (err) {
    try { await browser.close() } catch {}
    return res.status(500).json({ ok: false, error: err.message || String(err) })
  }
}
