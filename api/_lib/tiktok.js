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
