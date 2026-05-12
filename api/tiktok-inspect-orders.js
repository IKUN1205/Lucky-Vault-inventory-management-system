// api/tiktok-inspect-orders.js
// Phase 2.2a: DOM inspection probe. Before we write the real scraper, we
// need to see exactly what TikTok renders — column structure, button
// selectors, whether the table uses semantic <table>/<tr> or some custom
// virtual-list. Auth was proven in Phase 2.1; this builds on that.
//
// What it returns:
//   - tableShape: is there a <table>? how many headers? row count?
//                 sample of the first 3 rows as raw text per cell
//   - buttons:   text + selector of all visible buttons (so we can find
//                "Filter", "Export", "Apply", "LIVE session" etc.)
//   - urlAfterLoad: where the page actually landed (useful for confirming
//                   our URL params work)
//
// Optional query params:
//   ?date_from=YYYY-MM-DD - try TikTok's URL filter (best-effort guess)
//   ?date_to=YYYY-MM-DD
//   ?tab=all|to_ship|shipped|completed|pending|canceled
//
// Read-only — no clicks, no exports, just observe and report back.

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
  if (!raw) {
    return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE env var is not set.' })
  }
  const cookies = parseCookieHeader(raw)
  if (!cookies.length) {
    return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE parsed to zero cookies.' })
  }
  log('cookies_parsed', { count: cookies.length })

  // Build the URL with optional filter params
  const tab = req.query.tab || 'all'
  const dateFrom = req.query.date_from
  const dateTo = req.query.date_to
  const qs = new URLSearchParams({ selected_sort: '6', tab })
  // These param names are guesses — TikTok might use different keys.
  // If the page ignores them, we'll see it in the result (tabAfterLoad).
  if (dateFrom) qs.set('time_created_from', dateFrom)
  if (dateTo) qs.set('time_created_to', dateTo)
  const targetUrl = `https://seller-us.tiktok.com/order?${qs.toString()}`
  log('target_url_built', { url: targetUrl })

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

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 40_000 })
    log('navigated', { url: page.url() })

    // Give the table a beat to hydrate after networkidle2
    await new Promise(r => setTimeout(r, 2500))
    log('hydrated')

    // Dump everything interesting from the DOM in one round-trip
    const inspection = await page.evaluate(() => {
      const trunc = (s, n = 140) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n))

      // ---- Table shape ----
      // Try multiple selectors since TikTok might use a virtual list.
      const candidates = [
        { selector: 'table', kind: 'native_table' },
        { selector: '[role="table"]', kind: 'aria_table' },
        { selector: '[role="grid"]', kind: 'aria_grid' },
        { selector: '[class*="OrderTable"]', kind: 'class_OrderTable' },
        { selector: '[class*="order-list"]', kind: 'class_order_list' },
        { selector: '[data-tid="order_list"]', kind: 'data_tid_order_list' },
      ]
      const tablesFound = []
      for (const c of candidates) {
        const nodes = document.querySelectorAll(c.selector)
        if (nodes.length > 0) {
          tablesFound.push({
            kind: c.kind,
            selector: c.selector,
            count: nodes.length,
            firstRect: (() => {
              const r = nodes[0].getBoundingClientRect()
              return { w: Math.round(r.width), h: Math.round(r.height) }
            })(),
          })
        }
      }

      // ---- Headers + sample rows from the most-likely table ----
      let headers = null
      let sampleRows = null
      const primaryTable =
        document.querySelector('table') ||
        document.querySelector('[role="table"]') ||
        document.querySelector('[role="grid"]')
      if (primaryTable) {
        const headerCells = primaryTable.querySelectorAll('thead th, [role="columnheader"]')
        headers = Array.from(headerCells).map(c => trunc(c.innerText, 60))

        const bodyRows = primaryTable.querySelectorAll('tbody tr, [role="row"]')
        // Skip role="row" matches inside thead — those repeat headers
        const dataRows = Array.from(bodyRows).filter(r => {
          // role="row" rows include headers; filter out by checking if any child is a columnheader
          return !r.querySelector('[role="columnheader"]')
        })
        sampleRows = dataRows.slice(0, 3).map(row => {
          const cells = row.querySelectorAll('td, [role="gridcell"], [role="cell"]')
          return Array.from(cells).map(c => trunc(c.innerText, 120))
        })
      }

      // ---- All visible buttons + their text/aria-label ----
      // Useful to find "Filter", "Export", "Apply", etc.
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'))
      const interestingButtons = allButtons
        .map(b => ({
          tag: b.tagName.toLowerCase(),
          text: trunc(b.innerText || b.getAttribute('aria-label') || '', 60),
          ariaLabel: trunc(b.getAttribute('aria-label') || '', 60),
          dataTid: b.getAttribute('data-tid') || null,
          className: trunc(b.className || '', 80),
          rect: (() => {
            const r = b.getBoundingClientRect()
            return { w: Math.round(r.width), h: Math.round(r.height), v: r.width > 0 && r.height > 0 }
          })(),
        }))
        // Only keep visible buttons whose text matches things we care about
        .filter(b =>
          b.rect.v &&
          /filter|export|download|apply|confirm|live|search|sort|reset|clear/i.test(b.text + ' ' + b.ariaLabel)
        )
        .slice(0, 40)

      // ---- Pagination info (best-effort) ----
      const paginationText = (() => {
        // Look for things like "1-50 of 1,395" or "Found 91 orders"
        const text = document.body.innerText
        const match = text.match(/Found\s+[\d,]+\s+orders|of\s+[\d,]+|1-\d+\s+of\s+[\d,]+/i)
        return match ? match[0] : null
      })()

      // ---- "Found N orders" + tab name (sanity check filters work) ----
      const activeTab = (() => {
        // Active tab usually has an underline / pill
        const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab"]'))
          .map(t => trunc(t.innerText, 30))
          .filter(s => /^(All|To ship|Shipped|Completed|Pending|Canceled)/i.test(s))
          .slice(0, 10)
        return tabs
      })()

      return {
        url: location.href,
        title: document.title,
        tablesFound,
        headers,
        sampleRows,
        sampleRowCount: sampleRows?.length || 0,
        interestingButtons,
        paginationText,
        activeTab,
        bodyChars: document.body.innerText.length,
      }
    }).catch(err => ({ error: err.message }))
    log('inspected')

    await browser.close()

    return res.status(200).json({
      ok: true,
      cookieCount: cookies.length,
      targetUrl,
      tabAfterLoad: inspection.activeTab,
      title: inspection.title,
      finalUrl: inspection.url,
      paginationText: inspection.paginationText,
      tablesFound: inspection.tablesFound,
      headers: inspection.headers,
      sampleRowCount: inspection.sampleRowCount,
      sampleRows: inspection.sampleRows,
      interestingButtons: inspection.interestingButtons,
      bodyChars: inspection.bodyChars,
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
