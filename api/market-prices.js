// api/market-prices.js
// GET /api/market-prices
//
// Sealed-product market prices for the "% of market" readout on the buy-record
// form, keyed by the first 8 chars of products.id:
//
//   { generated_at, source, count, priced, prices: { "<uuid8>": {market, pinned, matched, asOf} } }
//
// The file itself is written by inventory-sync/buy_market_check.py --publish
// and served off Gary's machine, the same way product_images.json is. This
// route exists because the BROWSER cannot read it: lv-slabs.luckyvault.us
// returns no Access-Control-Allow-Origin header at all (verified 2026-08-20
// with headless Chromium — "TypeError: Failed to fetch" from a foreign origin,
// and no ACAO in the raw response either). Server-to-server has no such
// restriction, so we fetch it here and hand it to the app same-origin.
//
// NOTE for whoever finds this later: useProductImages.js fetches
// product_images.json directly from that host and is blocked by exactly the
// same thing. It degrades silently to {} by design, which is why nobody
// noticed. Pointing it at a route like this one would fix it — deliberately
// not done here, because that is a separate feature and bundling it would make
// this change impossible to judge on its own.
//
// Cached at the edge for 30 minutes: the upstream file is regenerated at most
// daily, and every buyer opening the form should not wake Gary's laptop.

const FEED_URL = 'https://lv-slabs.luckyvault.us/kaitori/market_prices.json'

export default async function handler(req, res) {
  try {
    const upstream = await fetch(FEED_URL, { headers: { 'User-Agent': 'lv-inventory/1.0' } })
    if (!upstream.ok) {
      // A reachability failure is NOT "there are no market prices". The app
      // renders an empty map as "no market price on file", which is the honest
      // reading of both — but say which one happened in the payload so this is
      // debuggable from the browser rather than from guesswork.
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      return res.status(200).json({
        generated_at: null,
        error: `upstream ${upstream.status}`,
        count: 0,
        priced: 0,
        prices: {},
      })
    }
    const feed = await upstream.json()
    const prices = feed && typeof feed === 'object' && feed.prices && typeof feed.prices === 'object'
      ? feed.prices
      : (feed && typeof feed === 'object' ? feed : {})

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200')
    return res.status(200).json({
      generated_at: feed?.generated_at ?? null,
      source: feed?.source ?? null,
      count: Object.keys(prices).length,
      priced: Object.values(prices).filter(v => v && v.market > 0).length,
      prices,
    })
  } catch (err) {
    console.error('[market-prices] upstream fetch failed:', err)
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    return res.status(200).json({
      generated_at: null,
      error: 'upstream unreachable',
      count: 0,
      priced: 0,
      prices: {},
    })
  }
}
