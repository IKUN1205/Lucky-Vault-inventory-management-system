// api/_lib/tiktok.js
//
// Shared TikTok-seller-center harvester. Originally lived inline in
// api/auto-reconcile.js; pulled out so api/detect-missing-counts.js can
// reuse the same proven pagination + LIVE-tag extraction logic without
// drift.
//
// Vercel convention: directories under api/ whose name starts with `_`
// are NOT deployed as serverless routes — they're shared modules only.
// That keeps this file as a plain ESM import target.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

// Pagination cap. Each "page" of TikTok's order list is ~20 orders, so
// 20 pages = ~400 orders. Now that we're on Vercel Pro (300s function
// timeout instead of 60s on Hobby), we have headroom to paginate deeply
// enough to cover 24-72h windows even on high-volume shops (15k+ orders
// in inventory) — pagination stops early via haveCoveredWindow() once
// we've crossed the requested fromTs, so deep windows only "spend" the
// pages they need.
export const MAX_PAGES = 20

// Convert "name1=v1; name2=v2" into Puppeteer's cookie object shape.
// Domains are pinned to .tiktok.com so the cookies actually apply when
// we navigate to seller-us.tiktok.com.
export function parseCookieHeader(raw) {
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

// One TikTok order → flat line items, one per SKU. Adds the LIVE flag
// and the per-session creator name as derived from the order's
// sales_source_live_tag message ("LIVE: <creator>"). Non-LIVE orders
// still produce lines but with is_live=false; callers filter as needed.
export function explodeOrderToLines(o) {
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
//
// Pagination: TikTok's default page loads ~20 orders. For sessions counted
// 3-4 days after the actual stream (per Lucky Vault workflow), the last
// stream's orders can be on page 2-5. After the initial response we scroll
// the table to the bottom and click the "next page" arrow repeatedly until:
//   (a) we've captured an order older than fromTs (covered the window), or
//   (b) no new orders came in after a click (end of list), or
//   (c) we've done MAX_PAGES iterations (safety cap).
// `fromTs` can be null — meaning "no lower bound, just take everything
// we can reach". In that case we stop on (b) or (c) only.
export async function harvestTikTokOrders({ rawCookie, fromTs, toTs, liveOnly = true }) {
  const cookies = parseCookieHeader(rawCookie)
  const harvested = []
  let pageInfo = {
    pagesLoaded: 1,
    hitOlderThanWindow: false,
    hitEndOfList: false,
    paginationStrategies: [], // which click strategy worked per iteration
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
    // Initial response usually arrives within a few seconds.
    await new Promise(r => setTimeout(r, 5000))

    const haveCoveredWindow = () => {
      if (!fromTs) return false
      return harvested.some(o => {
        const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
        return ct < fromTs
      })
    }

    for (let i = 1; i < MAX_PAGES; i++) {
      if (haveCoveredWindow()) { pageInfo.hitOlderThanWindow = true; break }
      const beforeCount = harvested.length

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      // Click the page LI immediately after the currently-active one.
      // TikTok seller-center uses `core-pagination-*` (NOT arco-* as
      // initially assumed) — verified via /api/tiktok-pagination-probe
      // on 2026-05-13. The active page is marked with .core-pagination-
      // item-active; walking to the next valid sibling and clicking it
      // matches the user's manual "click 2, then 3, then 4..." pattern
      // exactly, which is what TikTok's lazy-load page fetcher responds
      // to. We skip jumpers (the "..." gap items) and disabled items.
      //
      // Falls back to a few legacy selectors in case TikTok ever ships
      // a redesign that swaps "core-" for something else.
      const clicked = await page.evaluate(() => {
        // Primary strategy: next sibling of active page
        const active = document.querySelector('li.core-pagination-item-active')
        if (active) {
          let sib = active.nextElementSibling
          while (sib) {
            if (
              sib.tagName === 'LI' &&
              sib.classList.contains('core-pagination-item') &&
              !sib.classList.contains('core-pagination-item-disabled') &&
              !sib.classList.contains('core-pagination-item-jumper')
            ) {
              sib.click()
              return `core-next-sibling[${sib.getAttribute('aria-label') || '?'}]`
            }
            sib = sib.nextElementSibling
          }
        }
        // Fallback: any explicit "next" button (different design systems)
        const fallbacks = [
          '.core-pagination-item-next:not(.core-pagination-item-disabled)',
          '.arco-pagination-item-next:not(.arco-pagination-item-disabled)',
          '[class*="pagination-next"]:not([class*="disabled"])',
          'button[aria-label="Next"]:not([disabled])',
          'li[aria-label="Next page"]:not([class*="disabled"])',
        ]
        for (const sel of fallbacks) {
          const btn = document.querySelector(sel)
          if (btn) { btn.click(); return `fallback[${sel}]` }
        }
        return null
      }).catch(() => null)

      await new Promise(r => setTimeout(r, 3500))

      if (harvested.length === beforeCount) {
        pageInfo.hitEndOfList = !clicked
        if (clicked) pageInfo.paginationStrategies.push(`${clicked}_no_new_orders`)
        break
      }
      if (clicked) pageInfo.paginationStrategies.push(clicked)
      pageInfo.pagesLoaded = i + 1
    }
  } finally {
    await browser.close()
  }

  // Dedupe + filter to [fromTs, toTs] (each bound optional)
  const seen = new Set()
  const inWindow = []
  for (const o of harvested) {
    const id = o.main_order_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const ct = parseInt(o.trade_order_module?.create_time || '0', 10) || 0
    if (fromTs != null && ct < fromTs) continue
    if (toTs != null && ct > toTs) continue
    inWindow.push(o)
  }
  let lines = inWindow.flatMap(explodeOrderToLines)
  if (liveOnly) lines = lines.filter(l => l.is_live)
  return {
    lines,
    observed: harvested.length,
    inWindowOrderCount: inWindow.length,
    pageInfo,
  }
}

// Harvest the per-LIVE-session table from TikTok seller-center's
// Content Analytics → LIVE page. The DOM scraping path is intentional:
// the data is rendered server-side (or hydrated very early) so the JSON
// XHR isn't reliably catchable via response interception. Reading the
// table cells is brittle to UI changes but works today and matches the
// numbers Will sees in his browser.
//
// Returns an array of sessions, each with:
//   { live_id, title, start_unix, end_unix, duration_minutes,
//     gmv_usd, items_sold, sku_orders, customers, ctor_pct,
//     live_ctr_pct, views, avg_price_usd, raw_row }
//
// `start_unix` / `end_unix` are best-effort: TikTok displays times in
// LA (PT) without an offset suffix, so we parse the displayed time and
// add the PT→UTC offset for the date in question. DST-aware via the
// Intl API.
export async function harvestLiveSessionsFromAnalytics({ rawCookie }) {
  const cookies = parseCookieHeader(rawCookie)
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })
  let rawRows = []
  let pageInfo = { rowCount: 0, capturedAt: Date.now() }
  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setCookie(...cookies)
    await page.goto('https://seller-us.tiktok.com/compass/analytics-live?shop_region=US', {
      waitUntil: 'networkidle2',
      timeout: 50_000,
    })
    if (/login|signin|account\/verify/i.test(page.url())) {
      throw new Error('TikTok cookies stale — got redirected to login.')
    }
    // Initial hydration. The analytics-live page lazy-loads everything,
    // including the LIVE performance table — and the table only shows
    // when the "LIVE performance" sub-tab is active. Flow:
    //  1. Wait for page chrome to render (12s)
    //  2. Try clicking the "LIVE performance" sub-tab if not active
    //  3. Long dwell for the table XHR(s) to land + render
    //  4. Try scrolling so any infinite-load triggers
    await new Promise(r => setTimeout(r, 12_000))

    // Click "LIVE performance" / "LIVE" sub-tab so the table populates.
    // The probe earlier confirmed the table is gated on this nav.
    const clickedSubTab = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, li, div'))
      for (const el of els) {
        const txt = (el.textContent || '').trim()
        if ((txt === 'LIVE performance' || txt === 'LIVE') && el.offsetParent !== null) {
          el.click()
          return txt
        }
      }
      return null
    }).catch(() => null)

    // Wait for table rows to appear after the click. waitForFunction
    // with a generous timeout — the data XHR is slow on first render.
    try {
      await page.waitForFunction(
        () => {
          const trs = document.querySelectorAll('table tr')
          // Require at least one data row (header has < 12 cells, data row has 12)
          for (const tr of trs) {
            if (tr.querySelectorAll('td').length >= 10) return true
          }
          return false
        },
        { timeout: 25_000 }
      )
    } catch {
      pageInfo.waitTimedOut = true
    }
    await new Promise(r => setTimeout(r, 3000))

    rawRows = await page.evaluate(() => {
      const out = []
      const trs = document.querySelectorAll('table tr')
      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll('th,td'))
          .map(c => (c.textContent || '').trim())
        if (cells.length >= 10) out.push(cells)
      }
      return out
    })
    pageInfo.rowCount = rawRows.length
    pageInfo.clickedSubTab = clickedSubTab
    pageInfo.finalUrl = page.url()
  } finally {
    await browser.close()
  }

  // Strip header row if present (first cell is "Rank" or empty header)
  const dataRows = rawRows.filter(r => {
    if (!r[0]) return true  // top-3 rows have rank icon → empty cell
    if (/^\d+$/.test(r[0])) return true  // ranked numerically
    return false  // header row "Rank, LIVE info, ..."
  })

  const sessions = dataRows.map(parseLiveAnalyticsRow).filter(Boolean)
  return { sessions, pageInfo, rawRowCount: rawRows.length }
}

// Parse one row of the Analytics LIVE table. Cells are concatenated when
// TikTok's UI uses sub-elements (no separator in textContent), so we have
// to split with regex.
function parseLiveAnalyticsRow(cells) {
  if (cells.length < 11) return null
  // [rank, liveInfo, timeAndDur, gmv, ctor, views, liveCtr, skuOrders,
  //  customers, itemsSold, avgPrice, action]
  const [, liveInfo, timeAndDur, gmv, ctor, views, liveCtr, skuOrders,
         customers, itemsSold, avgPrice] = cells

  // "OP, Nikke, Hololive W/YaziID:7637127856388147982"
  const m = liveInfo.match(/^(.*?)ID:(\d+)\s*$/)
  const title = (m ? m[1] : liveInfo).trim()
  const live_id = m ? m[2] : null

  // "May 7, 2026, 4:40 AM7h 19m"  (note narrow no-break space U+202F)
  // We split on the pattern: "<date>, <h:mm> <AM|PM>" then duration follows.
  const tdNormalised = timeAndDur.replace(/ /g, ' ').replace(/ /g, ' ')
  const tdMatch = tdNormalised.match(/^(.+?\d{1,2}:\d{2}\s*[AP]M)\s*(.*)$/)
  const startTimeStr = tdMatch ? tdMatch[1] : tdNormalised
  const durationStr = tdMatch ? tdMatch[2].trim() : ''

  // Parse PT-displayed time to unix. JS Date.parse doesn't reliably
  // accept "PT" or "PDT", so we parse as if UTC then add the correct
  // PT→UTC offset for that wall-clock date (DST-aware via Intl).
  const startUnix = parsePtWallClockToUnix(startTimeStr)
  const durationMinutes = parseDurationToMinutes(durationStr)
  const endUnix = startUnix && durationMinutes
    ? startUnix + durationMinutes * 60
    : null

  return {
    live_id,
    title,
    start_unix: startUnix,
    end_unix: endUnix,
    duration_minutes: durationMinutes,
    gmv_usd: parseDollar(gmv),
    items_sold: parseInt(itemsSold.replace(/,/g, ''), 10) || 0,
    sku_orders: parseInt(skuOrders.replace(/,/g, ''), 10) || 0,
    customers: parseInt(customers.replace(/,/g, ''), 10) || 0,
    ctor_pct: parsePercent(ctor),
    live_ctr_pct: parsePercent(liveCtr),
    views: parseInt(views.replace(/,/g, ''), 10) || 0,
    avg_price_usd: parseDollar(avgPrice),
    raw_row: cells,
  }
}

// "$2,948.39" → 2948.39  ;  "" → 0
function parseDollar(s) {
  if (!s) return 0
  return parseFloat(String(s).replace(/[$,]/g, '')) || 0
}

// "13.37 %" → 13.37  ;  "" → 0
function parsePercent(s) {
  if (!s) return 0
  return parseFloat(String(s).replace(/[%\s]/g, '')) || 0
}

// "7h 19m" / "7h" / "19m" → minutes
function parseDurationToMinutes(s) {
  if (!s) return 0
  let total = 0
  const h = s.match(/(\d+)\s*h/)
  const m = s.match(/(\d+)\s*m/)
  if (h) total += parseInt(h[1], 10) * 60
  if (m) total += parseInt(m[1], 10)
  return total
}

// Parse a PT wall-clock display ("May 7, 2026, 4:40 AM") to a unix
// timestamp (seconds). DST-aware: we figure out whether the date falls
// in PDT (UTC-7) or PST (UTC-8) by formatting a candidate moment with
// Intl in the LA timezone and seeing what offset matches.
function parsePtWallClockToUnix(s) {
  if (!s) return null
  // Strategy: build an ISO string with -07:00 (PDT) first, check whether
  // the resulting moment formats back to the SAME wall clock when
  // expressed in LA. If yes, that's correct. If not, try -08:00 (PST).
  const monthMap = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
  const m = s.match(/^(\w+)\s+(\d+),\s*(\d+),\s*(\d+):(\d+)\s*([AP])M$/i)
  if (!m) return null
  const [, mon, day, year, hourS, minS, ampm] = m
  const month = monthMap[mon.slice(0, 3)]
  if (!month) return null
  let hour = parseInt(hourS, 10) % 12
  if (ampm.toUpperCase() === 'P') hour += 12
  const minute = parseInt(minS, 10)

  for (const offset of [7, 8]) {  // try PDT, then PST
    // PT moment → corresponding UTC moment by adding offset hours
    const utcMs = Date.UTC(parseInt(year), month - 1, parseInt(day), hour + offset, minute, 0)
    const candidate = new Date(utcMs)
    // Check whether LA local time of this moment matches the input
    const laParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(candidate)
    const get = (t) => laParts.find(p => p.type === t)?.value
    const laMonth = get('month')
    const laDay = parseInt(get('day'), 10)
    const laYear = parseInt(get('year'), 10)
    const laHour = parseInt(get('hour'), 10)
    const laMinute = parseInt(get('minute'), 10)
    const laAmPm = (get('dayPeriod') || '').toUpperCase()
    let laHour12 = laHour % 12
    if (laAmPm === 'PM') laHour12 += 12
    if (laYear === parseInt(year) &&
        laMonth === mon.slice(0, 3) &&
        laDay === parseInt(day) &&
        laHour12 === hour &&
        laMinute === minute) {
      return Math.floor(utcMs / 1000)
    }
  }
  // Couldn't reconcile — fall back to PDT (LA default for most of year)
  return Math.floor(Date.UTC(parseInt(year), month - 1, parseInt(day), hour + 7, minute, 0) / 1000)
}

// Cluster a list of harvested order lines into "LIVE sessions". A session
// is a contiguous run of orders from the same creator with no gap larger
// than `gapHours` between adjacent orders. Returns one entry per session,
// each with creator + start/end unix + total qty / line count.
//
// Used by /api/detect-missing-counts to identify "a session ended at T"
// then check whether anyone has counted since T. The 4h gap default
// matches Lucky Vault's actual stream cadence — sessions are 2-4h long
// with at least overnight in between, so 4h cleanly separates them.
export function clusterLiveSessions(lines, { gapHours = 4 } = {}) {
  const gapSec = gapHours * 3600
  // Group by creator first, then walk each creator's lines chronologically
  // splitting whenever the gap exceeds gapSec.
  const byCreator = new Map()
  for (const l of lines) {
    if (!l.is_live || !l.create_unix) continue
    const c = l.live_creator || '(unknown)'
    if (!byCreator.has(c)) byCreator.set(c, [])
    byCreator.get(c).push(l)
  }
  const sessions = []
  for (const [creator, creatorLines] of byCreator) {
    creatorLines.sort((a, b) => a.create_unix - b.create_unix)
    let current = null
    for (const l of creatorLines) {
      if (!current || (l.create_unix - current.last_unix) > gapSec) {
        if (current) sessions.push(current)
        current = {
          creator,
          session_start_unix: l.create_unix,
          session_end_unix: l.create_unix,
          last_unix: l.create_unix,
          total_qty: l.quantity || 0,
          line_count: 1,
        }
      } else {
        current.session_end_unix = l.create_unix
        current.last_unix = l.create_unix
        current.total_qty += l.quantity || 0
        current.line_count += 1
      }
    }
    if (current) sessions.push(current)
  }
  // Drop the internal book-keeping field
  for (const s of sessions) delete s.last_unix
  // Most recent first
  sessions.sort((a, b) => b.session_end_unix - a.session_end_unix)
  return sessions
}
