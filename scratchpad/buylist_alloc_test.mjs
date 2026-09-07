// Cost allocation on a buy list -- run against Sully's real 2026-09-04 buy,
// the one that booked $718.18 onto ten First Partner boxes the store had
// written at $300 and $71.80 onto a Mega Charizard UPC written at $240.
//
// The bug was not in the arithmetic. The allocator was correct given what it
// was handed; the parser captured every written amount into a note string and
// dropped the number, so the allocator saw 14 unpriced lines and could only
// weight the 6 that TCG happened to price. This test pins the number reaching
// the allocator, which is the part that was actually broken.
import { readFileSync } from 'node:fs'
import { parseBuyList } from '../src/lib/buyListParse.js'

const src = readFileSync('src/pages/BuyListIntake.jsx', 'utf8')
const start = src.indexOf('    if (!activeLines.length || !(paidNum > 0)')
const end = src.indexOf('blocked: null }', src.indexOf('remainder: 0, blocked: null }')) + 'blocked: null }'.length
const block = src.slice(start, end)
if (start < 0 || block.length < 400) throw new Error('allocation block not found -- the test is not running the shipped source')

const priceOf = l => (l.price === '' || l.price == null ? null : Number(l.price))

function allocate(lines, paid, market = {}, feedDown = false) {
  const activeLines = lines, paidNum = paid, unresolved = []
  const marketPrices = market
  const marketFor = (pid, mp) => (mp[pid] ? { market: mp[pid], pinned: true } : null)
  return eval(`(() => {${block}})()`)   // eslint-disable-line no-eval
}

let pass = 0, fail = 0
const t = (d, got, want) => {
  const ok = Math.abs(got - want) < 0.005
  if (ok) pass++; else { fail++; console.error(`FAIL ${d}\n   got ${got}  want ${want}`) }
}

// ---- Sully's real list, pasted verbatim ----
const TEXT = [
  '1 Phantasmal Flames Etb - $155', '1 lost origins Etb - $195', '1 darkness ablaze etb - $110',
  '2 prismatic Etb - $300 ($150 each)', '1 destined rivals bundle - $68', '1 journey together bundle - $45',
  '1 chaos rising bundle - $42', '1 destined rivals etb - $125', '2 ascended deluxe pin collections - $132',
  '1 151 poster collection - $85', '1 hops Zacian box - $33', '10 first partners series 3 - $300',
  '9 first partners series 2 - $252', '1 mega Charizard upc - $240',
].join('\n')

const rows = parseBuyList(TEXT)
t('every line yields a number, not just a note', rows.filter(r => r.listed > 0).length, 14)
t('a line total stays a line total, not per unit', rows.find(r => r.name === 'prismatic Etb').listed, 300)
t('the written amounts sum to the store list', rows.reduce((n, r) => n + r.listed, 0), 2082)

// Only six of the fourteen had a TCG price. That asymmetry is the whole point:
// the six absorbed the entire $2,370 in proportion to themselves.
const MKT = { darkness: 112.31, drbundle: 65.99, jtbundle: 45.50, crbundle: 36.39, dretb: 119.00, fps2: 28.28 }
const pid = n => ({ 'darkness ablaze etb': 'darkness', 'destined rivals bundle': 'drbundle',
  'journey together bundle': 'jtbundle', 'chaos rising bundle': 'crbundle',
  'destined rivals etb': 'dretb', 'first partners series 2': 'fps2' }[n] || 'x' + n)
const lines = rows.map((r, i) => ({ ...r, uid: i, product_id: pid(r.name), price: '', skipped: false }))

const a = allocate(lines, 2370, MKT)
const by = n => a.rows.find(r => r.line.name === n).lineTotal

// The four numbers Gary can check against the invoice.
t('Mega Charizard UPC tracks the $240 the store wrote', by('mega Charizard upc'), 273.20)
t('ten First Partner 3 track the $300 the store wrote', by('first partners series 3'), 341.50)
t('Darkness Ablaze tracks the $110 the store wrote', by('darkness ablaze etb'), 125.22)
t('Hops Zacian tracks the $33 the store wrote', by('hops Zacian box'), 37.56)
t('the booked total still equals the money paid',
  a.rows.reduce((n, r) => n + r.lineTotal, 0), 2370)
t('every line is weighted by the store, not by TCG',
  a.rows.filter(r => r.method === 'store-listed-weight').length, 14)

// ---- the failure this replaces ----
// Same list with the numbers stripped, i.e. what the allocator used to see.
const blind = lines.map(l => ({ ...l, listed: null }))
const b = allocate(blind, 2370, MKT)
const bby = n => b.rows.find(r => r.line.name === n).lineTotal
t('WITHOUT the written amounts, FPS3 is overstated (the shipped bug)', bby('first partners series 3'), 718.18)
t('WITHOUT them, the Charizard is understated (the shipped bug)', bby('mega Charizard upc'), 71.80)

// ---- guards ----
// A typed price still wins; the store's note must never override a human.
const typed = lines.map(l => (l.name === 'mega Charizard upc' ? { ...l, price: '200' } : l))
const c = allocate(typed, 2370, MKT)
t('a typed price beats the written note', c.rows.find(r => r.line.name === 'mega Charizard upc').lineTotal, 200)

// No written amounts and no market at all: even split, never $0 lines.
const bare = [{ uid: 1, name: 'a', qty: 1, listed: null, product_id: 'x', price: '' },
              { uid: 2, name: 'b', qty: 1, listed: null, product_id: 'y', price: '' }]
const d = allocate(bare, 100, {})
t('with nothing to weight by, the split is even', d.rows[0].lineTotal, 50)

// A zero or junk amount is not a weight.
const junk = [{ uid: 1, name: 'a', qty: 1, listed: 0, product_id: 'x', price: '' },
              { uid: 2, name: 'b', qty: 1, listed: 100, product_id: 'y', price: '' }]
const e = allocate(junk, 100, {})
t('a $0 written amount does not count as a weight', e.rows.find(r => r.line.name === 'b').lineTotal, 50)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
