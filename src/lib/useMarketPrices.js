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
// headless Chromium, 2026-08-20). /api/market-prices fetches it server-side,
// where CORS does not apply, and caches it at the edge.
//
// Fetched once per session. ANY failure — network, bad JSON, upstream down —
// degrades to an EMPTY map, and an empty map renders as "no market price on
// file" rather than as a percentage. It must never render as 0%, and it must
// never make a line look checked when nothing checked it.
const MARKET_URL = '/api/market-prices'

let pricesPromise = null

function loadMarketPrices() {
  if (!pricesPromise) {
    pricesPromise = fetch(MARKET_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(feed => {
        // Accept both the wrapped shape ({generated_at, prices:{...}}) and a
        // bare map, so an older or hand-edited file still works.
        const map = feed && typeof feed === 'object'
          ? (feed.prices && typeof feed.prices === 'object' ? feed.prices : feed)
          : null
        return map && typeof map === 'object' ? map : {}
      })
      .catch(() => ({}))
  }
  return pricesPromise
}

export default function useMarketPrices() {
  const [prices, setPrices] = useState({})
  useEffect(() => {
    let cancelled = false
    loadMarketPrices().then(map => {
      if (!cancelled) setPrices(map)
    })
    return () => { cancelled = true }
  }, [])
  return prices
}
