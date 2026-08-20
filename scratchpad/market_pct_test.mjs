// Tests for the "% of market" readout on the buy-record form.
// Runs the REAL functions from src/lib/marketPct.js and src/lib/costSanity.js.
//
//   node scratchpad/market_pct_test.mjs
//
// Roughly half of these pin down when the readout must NOT show a percentage.
// A confident wrong percentage next to a purchase is worse than none, because
// the buyer will price against it while still holding the goods.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// On Windows a bare absolute path is not a valid ESM specifier — it has to be
// a file:// URL, or node reads "c:" as an unsupported protocol.
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const {
  marketFor, judgeLine, describe, daysOld, BAND_LO, BAND_HI, AT_MARKET, ABOVE_MARKET,
} = await load('src/lib/marketPct.js')
const { unitCostOf } = await load('src/lib/costSanity.js')

let pass = 0
const fails = []
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + label) }
  else { fails.push(label); console.log('  FAIL ' + label + ' ' + extra) }
}

// Real numbers from 2026-08-20.
const FEED = {
  b59651a1: { market: 644.78, pinned: false, matched: 'A Fist of Divine Speed Booster Box', asOf: '2026-08-20' },
  '89141919': { market: 18.84, pinned: true, matched: 'OP-13 Blister', asOf: '2026-08-20' },
  deadbeef: { market: null, pinned: false, matched: null, asOf: '2026-08-20' },
}
const OP11 = 'b59651a1-1111-2222-3333-444444444444'
const usd = (n) => n
const jpy = (n) => n * 0.0067      // the rate the app actually ships today

console.log('--- looking a product up ---')
ok('found by the first 8 chars of the uuid', marketFor(OP11, FEED)?.market === 644.78)
ok('a product not in the feed is null', marketFor('ffffffff-0000', FEED) === null)
ok('no product id is null', marketFor('', FEED) === null)
ok('no feed is null', marketFor(OP11, null) === null)

console.log('\n--- the number Gary asked for ---')
let j = judgeLine(550, FEED.b59651a1)
ok('OP-11 at $550 is under market', j.state === 'under')
ok('...and it is 85%', Math.round(j.pct) === 85, j.pct)
ok('...rendered', describe(j).text.startsWith('85% of the $644.78 market'), describe(j).text)
ok('...marked as an unverified match', describe(j).text.includes('match not verified'))

j = judgeLine(579.17, FEED.b59651a1)
ok('the 12-box line is 90%', Math.round(j.pct) === 90 && j.state === 'under')

j = judgeLine(18.25, FEED['89141919'])
ok('OP-13 blister at 97% says it is market price', j.state === 'at')
ok('...and a PINNED match carries no caveat',
   !describe(j).text.includes('match not verified'), describe(j).text)

console.log('\n--- a remark must never misdescribe its own number ---')
ok('100% is "market price"', describe(judgeLine(644.78, FEED.b59651a1)).text.includes('that is market price'))
ok('105% flips to above market', judgeLine(644.78 * 1.05, FEED.b59651a1).state === 'above')
ok('...and says so', describe(judgeLine(644.78 * 1.28, FEED.b59651a1)).text.includes('above market'))
ok('128% is never called market price',
   !describe(judgeLine(644.78 * 1.28, FEED.b59651a1)).text.includes('that is market price'))
for (const u of [600, 606, 609, 612, 612.54, 613, 620, 644.78, 700]) {
  const jj = judgeLine(u, FEED.b59651a1)
  const shown = Math.round(jj.pct)
  const txt = describe(jj).text
  ok(`printed ${shown}% and the wording agree`,
     (shown >= ABOVE_MARKET) === txt.includes('above market')
     && (shown >= AT_MARKET && shown < ABOVE_MARKET) === txt.includes('that is market price'),
     txt)
}

console.log('\n--- units: the thing that broke five times this week ---')
// A trash bag is 30 packs. Against a single-pack market that is 3,750%.
j = judgeLine(93.80, { market: 2.50, pinned: false })
ok('a 30-pack bag vs one pack is NOT given a percentage', j.state === 'unit_mismatch')
ok('...the text does not lead with a bare percent',
   !/^\d+% of/.test(describe(j).text), describe(j).text)
ok('...it says how many of theirs ours holds',
   describe(j).text.includes('about 38 of theirs'), describe(j).text)
ok('...and is toned as a warning', describe(j).tone === 'warn')

j = judgeLine(2479, { market: 200, pinned: false })   // a case against a box
ok('a case vs a box is refused', j.state === 'unit_mismatch')

j = judgeLine(1.41, { market: 90, pinned: false })    // ours is the smaller unit
ok('ours far cheaper is also refused', j.state === 'unit_mismatch')
ok('...and is not celebrated as a steal',
   describe(j).text.includes('theirs is the bigger unit'), describe(j).text)

// The exact edge is arbitrary to a rounding error either way, so the tests
// stand clear of it and assert the behaviour on each side instead.
ok('well inside the top of the band is comparable', judgeLine(644.78 * 2.9, FEED.b59651a1).state !== 'unit_mismatch')
ok('past the top of the band is refused', judgeLine(644.78 * 3.05, FEED.b59651a1).state === 'unit_mismatch')
ok('well inside the bottom is comparable', judgeLine(644.78 * 0.25, FEED.b59651a1).state !== 'unit_mismatch')
ok('below the bottom is refused', judgeLine(644.78 * 0.15, FEED.b59651a1).state === 'unit_mismatch')

console.log('\n--- currency: a yen line must not read as 150x ---')
// Storm Emeralda, exactly as the Japan side buys it: 10 boxes at ¥18,000,
// against Storm's own market of $153.06 (both measured 2026-08-20).
const STORM = { market: 153.06, pinned: false, matched: 'Storm Emeralda Booster Box' }
const yenLine = { product_id: OP11, quantity: 10, cost: '18000', price_mode: 'unit' }
const rawPct = 100 * (18000 / 153.06)
ok('raw yen against a dollar market would be absurd', rawPct > 11000, rawPct)
const conv = unitCostOf(yenLine, jpy)
ok('unitCostOf converts it', Math.abs(conv - 120.6) < 0.01, conv)
j = judgeLine(conv, STORM)
ok('...so a real yen purchase is judged normally', j.state === 'under')
ok('...at a sane 79%', Math.round(j.pct) === 79, j.pct)

// And the failure this guards: forgetting the conversion. It must not be
// reported as a catastrophic buy — it is not a buy problem at all.
const unconverted = judgeLine(unitCostOf(yenLine, usd), STORM)
ok('forgetting the conversion is caught by the band', unconverted.state === 'unit_mismatch')
ok('...and is not described as overpaying',
   !describe(unconverted).text.includes('above market'), describe(unconverted).text)

console.log('\n--- per-unit vs total ---')
const totalLine = { product_id: OP11, quantity: 6, cost: '3300', price_mode: 'total' }
ok('a total-mode line divides by qty', unitCostOf(totalLine, usd) === 550)
ok('...and lands on the same 85%',
   Math.round(judgeLine(unitCostOf(totalLine, usd), FEED.b59651a1).pct) === 85)
const unitLine = { product_id: OP11, quantity: 6, cost: '550', price_mode: 'unit' }
ok('a unit-mode line agrees', unitCostOf(unitLine, usd) === 550)
ok('the two entry modes give the SAME percent',
   judgeLine(unitCostOf(totalLine, usd), FEED.b59651a1).pct
   === judgeLine(unitCostOf(unitLine, usd), FEED.b59651a1).pct)

console.log('\n--- silence, and the difference between kinds of nothing ---')
ok('an empty cost says nothing at all', describe(judgeLine(0, FEED.b59651a1)) === null)
ok('a blank cost field says nothing',
   describe(judgeLine(unitCostOf({ cost: '', quantity: 1, price_mode: 'unit' }, usd), FEED.b59651a1)) === null)
ok('a negative cost says nothing', describe(judgeLine(-5, FEED.b59651a1)) === null)

j = judgeLine(550, null)                       // product not in the feed at all
ok('a product missing from the feed is "unknown"', j.state === 'unknown')
ok('...and shows no percentage', !/%/.test(describe(j).text), describe(j).text)
ok('...and is muted, not a warning', describe(j).tone === 'muted')

j = judgeLine(550, FEED.deadbeef)              // in the feed, but unpriceable
ok('a product we could not price says so', j.state === 'no_market')
ok('...and shows no percentage', !/%/.test(describe(j).text), describe(j).text)
ok('...it never renders as 0%', !describe(j).text.includes('0%'))

// The failure mode this is really guarding: an empty feed (fetch failed, CORS,
// bad JSON) must look like "we did not check", not like "checked, fine".
console.log('\n--- a feed that failed to load must not look like an answer ---')
ok('an empty feed yields unknown for every product', judgeLine(550, marketFor(OP11, {})).state === 'unknown')
ok('...with no percentage anywhere',
   !/%/.test(describe(judgeLine(550, marketFor(OP11, {}))).text))
ok('...and never the ok tone', describe(judgeLine(550, marketFor(OP11, {}))).tone !== 'ok')

console.log('\n--- a stale price must not pose as the market ---')
const NOW = new Date('2026-08-20T12:00:00Z')
const fresh = { market: 644.78, pinned: true, asOf: '2026-08-19' }
const old = { market: 644.78, pinned: true, asOf: '2026-07-20' }
ok('a fresh price is not dated', !describe(judgeLine(550, fresh), NOW).text.includes('days ago'),
   describe(judgeLine(550, fresh), NOW).text)
ok('a month-old price says how old it is',
   describe(judgeLine(550, old), NOW).text.includes('31 days ago'),
   describe(judgeLine(550, old), NOW).text)
ok('...and stops reading as a clean confirmation',
   describe(judgeLine(550, old), NOW).tone !== 'ok')
ok('a price with no date is not dated either way',
   !describe(judgeLine(550, { market: 644.78, pinned: true }), NOW).text.includes('days ago'))
ok('an unparseable date does not produce NaN',
   !/NaN/.test(describe(judgeLine(550, { market: 644.78, asOf: 'not-a-date' }), NOW).text))
ok('daysOld handles junk', daysOld('nope') === null && daysOld(null) === null)
ok('a stale UNPRICEABLE product is not dated (there is no price to age)',
   !describe(judgeLine(550, { market: null, asOf: '2026-01-01' }), NOW).text.includes('days ago'))
ok('the warning tone survives staleness',
   describe(judgeLine(644.78 * 1.3, old), NOW).tone === 'warn')

console.log('\n--- constants stay in step with buy_market_check.py ---')
const py = readFileSync(path.join(ROOT, '../../Desktop/LV Agents/inventory-sync/buy_market_check.py'), 'utf8')
const band = py.match(/BAND_LO,\s*BAND_HI\s*=\s*([\d.]+),\s*([\d.]+)/)
const atm = py.match(/AT_MARKET\s*=\s*([\d.]+)/)
ok('python file was found', !!band && !!atm)
if (band) {
  ok(`BAND_LO matches python (${band[1]})`, Number(band[1]) === BAND_LO, String(BAND_LO))
  ok(`BAND_HI matches python (${band[2]})`, Number(band[2]) === BAND_HI, String(BAND_HI))
}
if (atm) ok(`AT_MARKET matches python (${atm[1]})`, Number(atm[1]) === AT_MARKET, String(AT_MARKET))

console.log(`\n${fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'ALL PASS'}  (${pass} passed, ${fails.length} failed)`)
process.exit(fails.length ? 1 : 0)
