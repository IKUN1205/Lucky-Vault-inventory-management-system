// "sold at N% of market" — checked against the two real sales from 2026-09-04.
//
// The number this guards is the one I got wrong by hand first: dividing the
// whole $280 by the market value of only the seven priced cards gives 317%,
// which reads like a great sale and is arithmetic nonsense. 222% is the
// like-for-like figure. If this test ever prints 317 again, the comparison has
// drifted back to mixing a full numerator with a partial denominator.
import { readFileSync } from 'node:fs'

const src = readFileSync('api/lark-notify.js', 'utf8')
// The builder is a big switch inside the handler; lift just the block under
// test rather than standing up a Vercel request.
const start = src.indexOf('// "sold at 222% of market"')
const end = src.indexOf('lines.push(nowUtcStamp())', start)
const block = src.slice(start, end)

function pctLine(items, transaction_type = 'sale') {
  const lines = []
  eval(block)          // eslint-disable-line no-eval — runs the shipped source
  return lines[0] || null
}

let pass = 0, fail = 0
const t = (desc, got, want) => {
  if (got === want) pass++
  else { fail++; console.error(`FAIL ${desc}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`) }
}

// ---- the real $280 sale: 10 units, 7 of them priced, market $88.44 ----
const sale280 = [
  { quantity: 2, price: 28, market: 20.04 },   // Eevee
  { quantity: 1, price: 28, market: 19.90 },   // Jolteon
  { quantity: 1, price: 28, market: 14.46 },   // Espeon GX
  { quantity: 1, price: 28, market: 6.00 },    // Fighting Energy
  { quantity: 1, price: 28, market: 4.00 },    // Grass Energy
  { quantity: 1, price: 28, market: 4.00 },    // Lightning Energy
  { quantity: 1, price: 28, market: null },    // Eevee ex
  { quantity: 1, price: 28, market: null },    // Fighting Energy
  { quantity: 1, price: 28, market: null },    // Fairy Energy
]
t('the $280 sale reports like-for-like, not 317%',
  pctLine(sale280), 'sold at 222% of market (7 of 10 priced)')

// ---- the real $95 sale: nothing on file ----
const sale95 = [
  { quantity: 1, price: 12.44, market: null }, { quantity: 1, price: 40.15, market: null },
  { quantity: 1, price: 23.75, market: null }, { quantity: 1, price: 3.39, market: null },
  { quantity: 1, price: 11.31, market: null }, { quantity: 1, price: 3.96, market: null },
]
t('all-blank says so instead of implying 0',
  pctLine(sale95), 'no market price on file for any of these — % not checked')

// ---- full coverage drops the parenthetical ----
t('no coverage note when every unit is priced',
  pctLine([{ quantity: 2, price: 50, market: 25 }]), 'sold at 200% of market')

// ---- a zero or negative market must not be treated as priced ----
t('a $0 market is not coverage',
  pctLine([{ quantity: 1, price: 10, market: 0 }, { quantity: 1, price: 10, market: 5 }]),
  'sold at 200% of market (1 of 2 priced)')

// ---- buys are excluded: we are paying, not selling ----
t('buys get no % line', pctLine([{ quantity: 1, price: 10, market: 40 }], 'buy'), null)

// ---- selling under market is the case that must not be silently rounded away
t('below market reads below 100', pctLine([{ quantity: 1, price: 30, market: 60 }]),
  'sold at 50% of market')

// ---- fuzzy sealed prices count, but the message says so ----
t('an unverified match is used and flagged',
  pctLine([{ quantity: 2, price: 35.50, market: 25.47, market_verified: false }]),
  'sold at 139% of market · price match not verified')
t('a verified match carries no caveat',
  pctLine([{ quantity: 2, price: 35.50, market: 25.47, market_verified: true }]),
  'sold at 139% of market')
t('one unverified line taints the whole figure',
  pctLine([{ quantity: 1, price: 50, market: 25, market_verified: true },
           { quantity: 1, price: 50, market: 25, market_verified: false }]),
  'sold at 200% of market · price match not verified')
// This is the real sale Gary saw report "no market price on file" — it was
// pinned all along, the sealed wiring simply had not finished deploying.
t('the live 09-04 Chaos Rising sale',
  pctLine([{ quantity: 2, price: 35.50, market: 25.47, market_verified: true }]),
  'sold at 139% of market')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
