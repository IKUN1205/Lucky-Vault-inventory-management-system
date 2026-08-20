// The "% of market" clause on the sent buy request.
// Runs the REAL buildMessage out of api/lark-notify.js.
//
//   node scratchpad/purchased_message_test.mjs
//
// lark-notify.js has a default export (the handler) but buildMessage is
// module-private, so the file is read and the function is pulled out by
// evaluating it in isolation — the same trick the other builder tests use,
// and it means these assertions run the shipping code rather than a copy that
// drifts away from it.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(path.join(ROOT, 'api/lark-notify.js'), 'utf8')

// Strip the ESM export keywords so the file can be evaluated as a script, then
// hand back the two functions under test.
const script = src.replace(/^export\s+default\s+/m, 'const __handler = ')
                  .replace(/^export\s+/gm, '')
const ctx = vm.createContext({ console, fetch: () => {}, process, Intl, Date })
vm.runInContext(script + '\n;globalThis.__t = { buildMessage, marketClause };', ctx)
const { buildMessage, marketClause } = ctx.__t

let pass = 0
const fails = []
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + label) }
  else { fails.push(label); console.log('  FAIL ' + label + ' ' + extra) }
}

const base = {
  type: 'purchased',
  acquirer: 'Frank',
  vendor: 'Discord',
  sourceCountry: 'USA',
  currency: 'USD',
  totalCost: 3300,
  totalUnits: 6,
}
const OP11 = 'One Piece | [EN] OP-11 A Fist of Divine Speed | Booster Box | EN'

console.log('--- the line Gary asked for ---')
let msg = buildMessage({
  ...base,
  items: [{ name: OP11, quantity: 6, marketState: 'under', marketPct: 85, market: 644.78 }],
})
console.log(msg.split('\n').map(l => '      ' + l).join('\n'))
ok('the percent is on the product line',
   msg.includes(`• ${OP11} × 6 — 85% of the $644.78 market`), msg)
ok('the market price travels with it, so the percent is checkable',
   msg.includes('$644.78'))
ok('nothing else about the message moved',
   msg.startsWith('🛍️ New Purchase Logged\nBy: Frank\nVendor: Discord (USA)'))
ok('the total line is untouched', msg.includes('Total: 1 SKU / 6 units / $3,300.00 USD'))
ok('a priced line adds no "not checked" note', !msg.includes('no market price'))

console.log('\n--- the wording matches the number next to it ---')
const clause = (o) => marketClause({ marketState: 'under', market: 644.78, ...o })
ok('under market is stated plainly',
   clause({ marketPct: 85 }) === ' — 85% of the $644.78 market')
ok('at market says so',
   marketClause({ marketState: 'at', marketPct: 97, market: 18.84 })
     === ' — 97% of the $18.84 market, at market')
ok('above market says ABOVE',
   marketClause({ marketState: 'above', marketPct: 140, market: 644.78 })
     .includes('ABOVE market'))
ok('above market is never called "at market"',
   !marketClause({ marketState: 'above', marketPct: 140, market: 644.78 }).includes('at market'))

console.log('\n--- units: no ratio when the ratio would lie ---')
const bag = marketClause({ marketState: 'unit_mismatch', marketPct: 3752, market: 2.50 })
ok('a unit mismatch produces a clause', bag !== '')
ok('...but never the percentage', !bag.includes('3752') && !bag.includes('%'), bag)
ok('...and asks the one answerable question', bag.includes('what one unit is'), bag)
ok('...and does not accuse anyone of overpaying', !bag.includes('ABOVE'))

console.log('\n--- a payload that says nothing must produce nothing ---')
for (const bad of [
  {},
  { marketState: 'no_market' },
  { marketState: 'unknown' },
  { marketPct: null, market: null },
  { marketPct: 85 },                        // percent with no market to check it
  { market: 644.78 },                       // market with no percent
  { marketPct: 0, market: 644.78 },
  { marketPct: -5, market: 644.78 },
  { marketPct: 'abc', market: 644.78 },
  { marketPct: 85, market: 0 },
  { marketPct: NaN, market: NaN },
  { marketPct: Infinity, market: 644.78 },
]) {
  ok(`no clause for ${JSON.stringify(bad)}`, marketClause(bad) === '')
}
ok('a missing item does not throw', marketClause(undefined) === '')
ok('null does not throw', marketClause(null) === '')

console.log('\n--- "nothing checked" is said out loud ---')
msg = buildMessage({
  ...base,
  items: [{ name: 'Storm Emeralda (In Bag)', quantity: 5, marketState: 'no_market' }],
  totalUnits: 5,
})
ok('an all-unpriced message says so',
   msg.includes('No market price on file for any of these — nothing was checked.'), msg)
ok('...and shows no percentage anywhere', !/\d+% of/.test(msg))

msg = buildMessage({
  ...base,
  items: [
    { name: OP11, quantity: 6, marketState: 'under', marketPct: 85, market: 644.78 },
    { name: 'Storm Emeralda (In Bag)', quantity: 5, marketState: 'no_market' },
    { name: 'Abyss Eye (In Bag)', quantity: 4, marketState: 'no_market' },
  ],
  totalUnits: 15,
})
ok('a partly-priced message counts what it skipped',
   msg.includes('(2 of 3 lines had no market price to check against.)'), msg)
ok('...and still prices the line it could', msg.includes('85% of the $644.78 market'))
ok('...and does not claim nothing was checked', !msg.includes('nothing was checked'))

console.log('\n--- the old payload shape still works ---')
// Anything already queued or retried from before this change has no market
// fields at all. It must render exactly as it did yesterday, plus the honest
// "nothing was checked" line.
msg = buildMessage({ ...base, items: [{ name: OP11, quantity: 6 }] })
ok('a pre-change payload still renders', msg.includes(`• ${OP11} × 6`))
ok('...with no invented percentage', !/%/.test(msg))
ok('...and still carries the totals', msg.includes('Total: 1 SKU / 6 units'))

console.log('\n--- the rest of the card is unchanged ---')
msg = buildMessage({
  ...base,
  items: [{ name: OP11, quantity: 6, marketState: 'under', marketPct: 85, market: 644.78 }],
  carrier: 'UPS',
  trackingNumber: '1Z999AA10123456784',
})
ok('tracking still renders', msg.includes('Carrier: UPS') && msg.includes('Tracking: 1Z999AA10123456784'))
ok('the track link still renders', msg.includes('Track: '))
ok('the timestamp is still last', msg.trim().split('\n').pop().startsWith('Time: '))

const jpy = buildMessage({
  ...base, currency: 'JPY', totalCost: 495000, totalCostUSD: 3316.5,
  items: [{ name: OP11, quantity: 6, marketState: 'under', marketPct: 85, market: 644.78 }],
})
ok('a yen purchase still shows yen and the USD conversion',
   jpy.includes('¥495,000 JPY') && jpy.includes('≈ $3316.50 USD'), jpy)
ok('...and the market percent is still in USD terms',
   jpy.includes('85% of the $644.78 market'))

console.log(`\n${fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'ALL PASS'}  (${pass} passed, ${fails.length} failed)`)
process.exit(fails.length ? 1 : 0)
