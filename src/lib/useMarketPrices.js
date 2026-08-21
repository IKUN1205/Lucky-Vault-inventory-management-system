import { useState, useEffect } from 'react'

// Market prices for sealed products, keyed by the FIRST 8 chars of products.id
// → { market, pinned, matched, asOf }.
//
// The data is written by inventory-sync/buy_market_check.py --publish and
// served off Gary's machine. The app has no route to TCGplayer, and the only
// prices it CAN reach (avg_cost_basis, our last intake) are our own — comparing
// to those grades us against ourselves.
//
// SAME-ORIGIN ON PURPOSE. The obvious version of this fetches
// lv-slabs.luckyvault.us directly, the way useProductImages.js does. That host
// sends no Access-Control-Allow-Origin header, so the browser blocks it — which
// is why useProductImages has been quietly resolving to {} (verified with
// headless Chromium, 2026-08-20).  /api/market-prices fetches it server-side,
// where CORS does not apply, and caches it at the edge.
//
// Fetched once per session. A failure — network, bad JSON, upstream down — is
// reported as feedDown:true, NOT as an empty price map. "The source is
// unreachable" and "this product has no price" are different answers, and
// collapsing them is exactly how 130point's dead scraper once read as "these
// products have no sales" (manual, LOCKED). Nothing here may render as 0% or
// make a line look checked when nothing checked it.
const MARKET_URL = '/api/market-prices'

let pricesPromise = null

function loadMarketPrices() {
  if (!pricesPromise) {
    pricesPromise = fetch(MARKET_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(feed => {
        // Accept both the wrapped shape ({generated_at, prices:{...}}) and a
        // bare map, so an older or hand-edited file still works. The proxy
        // reports its own upstream failure as {error: ...} — that is a down
        // feed, not an empty one.
        if (!feed || typeof feed !== 'object' || feed.error) {
          return { map: {}, failed: true }
        }
        const map = feed.prices && typeof feed.prices === 'object' ? feed.prices : feed
        if (!map || typeof map !== 'object') return { map: {}, failed: true }
        return { map, failed: false }
      })
      .catch(() => ({ map: {}, failed: true }))
  }
  return pricesPromise
}

export default function useMarketPrices() {
  const [state, setState] = useState({ prices: {}, feedDown: false })
  useEffect(() => {
    let cancelled = false
    loadMarketPrices().then(({ map, failed }) => {
      if (!cancelled) setState({ prices: map, feedDown: failed })
    })
    return () => { cancelled = true }
  }, [])
  return state
}
