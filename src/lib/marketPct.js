// What percent of market is this purchase line?
//
// Gary 2026-08-20: "可以给他们 buy record 的时候可以给个%" — the buyer should see
// the ratio while typing, not read about it afterwards. Recording a buy is one
// of the two moments somebody is physically holding the goods; afterwards the
// only thing left is a number nobody can check.
//
// This is informational, NOT a gate. The gate already exists next door
// (costSanity: 1/3–3x hard block) and answers a different question — "is this
// a typo". A purchase at 99% of market is not a typo, it is a bad buy, and one
// threshold cannot answer both. Ceilings that actually hold goods back live in
// inventory-sync/data/buy_price_rules.json and are Gary's to set per product.
//
// Mirror of inventory-sync/buy_market_check.py — the bands and the wording are
// deliberately identical so the number on screen and the number in the nightly
// check can never disagree. Change one, change the other.

// The band a like-for-like purchase actually lives in. Outside it, the likelier
// explanation is that the two prices count different things.
//
// This is the guard that matters. "85% of market" silently asserts that our
// unit and TCGplayer's unit are the same thing, and that assertion broke five
// times in the week of 2026-08-18 — In Bag = 30 packs, Case = 12 boxes, a
// TikTok "10 Pack Bundle" — every single time with the money coming out right,
// so no amount of reconciliation would have caught it.
//
// A trash bag of 30 packs against a single-pack market computes to 3,750%.
// Printing that as a percentage would be arithmetically true and completely
// misleading, so outside the band we say the two numbers are not measuring the
// same thing and ask the one question the person holding the box can answer.
export const BAND_LO = 0.20
export const BAND_HI = 3.00

// At or above this you are paying what the shelf pays. Above ABOVE_MARKET,
// calling it "market price" would misdescribe the very number next to it, and
// a remark that misdescribes its own number teaches people to stop reading it.
export const AT_MARKET = 95
export const ABOVE_MARKET = 105

// A price older than this stops being presented as the market and starts being
// presented as a dated reading. The publisher refreshes every 3 days, so a week
// means the job stopped running, not that the market went quiet.
//
// This is the exchange-rate bug's lesson, written down: convertToUSD has been
// quoting a fixed JPY rate since it was written, and the only reason it went
// four months unnoticed is that nothing ever said how old the number was.
export const STALE_DAYS = 7

export function daysOld(asOf, now = new Date()) {
  if (!asOf) return null
  const t = Date.parse(asOf)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86400000)
}

// Look a product up in the feed. Keyed by the first 8 chars of products.id,
// same convention as product_images.json.
export function marketFor(productId, marketMap) {
  if (!productId || !marketMap) return null
  return marketMap[String(productId).slice(0, 8)] || null
}

// Judge one line. `unitUsd` must already be per-unit AND in USD — pass
// costSanity's unitCostOf(item, toUsd), which handles both the per-unit/total
// toggle and the currency. Comparing a ¥18,000 box to a $153 market reads as
// 11,765%, which the band would catch, but catching it is not the same as
// getting it right.
export function judgeLine(unitUsd, entry) {
  const unit = Number(unitUsd) || 0
  // Non-finite in = garbage out: Infinity survives every > comparison and
  // would render "Infinity% of the market" (Codex 8/21).
  if (!Number.isFinite(unit) || !(unit > 0)) return { state: 'no_cost' }
  if (!entry) return { state: 'unknown' }

  const market = Number(entry.market) || 0
  if (!Number.isFinite(market) || !(market > 0)) {
    return { state: 'no_market', matched: entry.matched || null, asOf: entry.asOf || null }
  }

  const ratio = unit / market
  const pct = 100 * ratio
  const base = {
    market,
    pct,
    pinned: !!entry.pinned,
    matched: entry.matched || null,
    asOf: entry.asOf || null,
  }
  if (ratio < BAND_LO || ratio > BAND_HI) {
    return { ...base, state: 'unit_mismatch', impliedMultiple: ratio }
  }
  // Compare at the precision the reader sees. The label renders a whole
  // number, so judging the raw float would let one line show "95%" with a
  // remark and another show "95%" without one.
  const shown = Math.round(pct)
  if (shown >= ABOVE_MARKET) return { ...base, state: 'above' }
  if (shown >= AT_MARKET) return { ...base, state: 'at' }
  return { ...base, state: 'under' }
}

// One short line for under the cost field. Returns null when there is nothing
// honest to say — an empty cost field gets no commentary.
export function describe(judged, now = new Date()) {
  const out = describeState(judged)
  if (!out) return out
  // Only date the line when the reading is old. Stamping every line with a
  // date trains people to ignore the stamp, which is the same failure as an
  // alarm that always fires.
  const age = daysOld(judged.asOf, now)
  if (age != null && age >= STALE_DAYS && judged.market) {
    out.text += ` · market read ${age} days ago`
    if (out.tone === 'ok') out.tone = 'muted'
  }
  return out
}

function describeState(judged) {
  if (!judged || judged.state === 'no_cost') return null
  switch (judged.state) {
    case 'unknown':
      return { tone: 'muted', text: 'no market price on file for this product' }
    case 'no_market':
      return { tone: 'muted', text: 'no market price for this product — not checked' }
    case 'unit_mismatch':
      return {
        tone: 'warn',
        text: judged.impliedMultiple > BAND_HI
          ? `$${fmt(judged.market)} is one unit on TCGplayer — either this is `
            + `${Math.round(judged.pct)}% of market, or one of ours holds about `
            + `${Math.round(judged.impliedMultiple)} of theirs`
          : `$${fmt(judged.market)} is one unit on TCGplayer — either a very good `
            + `buy at ${Math.round(judged.pct)}%, or theirs is the bigger unit`,
      }
    case 'above':
      return {
        tone: 'warn',
        text: `${Math.round(judged.pct)}% of the $${fmt(judged.market)} market`
          + ` — above market${judged.pinned ? '' : ' (match not verified)'}`,
      }
    case 'at':
      return {
        tone: 'warn',
        text: `${Math.round(judged.pct)}% of the $${fmt(judged.market)} market`
          + ` — that is market price${judged.pinned ? '' : ' (match not verified)'}`,
      }
    default:
      return {
        tone: 'ok',
        text: `${Math.round(judged.pct)}% of the $${fmt(judged.market)} market`
          + `${judged.pinned ? '' : ' (match not verified)'}`,
      }
  }
}

function fmt(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
