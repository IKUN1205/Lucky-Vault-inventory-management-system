import { planScan, batchSummary } from '../src/lib/grading.js'
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const C = (seq, t, extra = {}) => ({ batch_id: 'b', seq, tcg_id: t, card_name: 'n' + t, printing: 'Normal', condition: 'NM', language: 'EN', market_usd: 10, decision: null, ...extra })
let cards = [C(1, '100'), C(2, '200'), C(3, '200'), C(4, '300'), C(5, '300', { printing: 'Reverse Holofoil', market_usd: 4 })]
ok(planScan(cards, '999').kind === 'extra' && planScan(cards, '999').reason === 'not_in_batch', 'unknown id -> not_in_batch')
let p = planScan(cards, '200'); ok(p.kind === 'card' && p.card.seq === 2, 'two same copies -> lowest seq')
cards[1].decision = 'stock'; p = planScan(cards, '200'); ok(p.kind === 'card' && p.card.seq === 3, 'next copy')
cards[2].decision = 'grading'; p = planScan(cards, '200'); ok(p.kind === 'extra' && p.reason === 'more_than_batch', 'all copies scanned -> more_than_batch')
p = planScan(cards, '300'); ok(p.kind === 'choose' && p.options.length === 2 && p.options.every(o => o.left === 1), 'two printings -> choose')
cards[3].decision = 'stock'; p = planScan(cards, '300'); ok(p.kind === 'choose' && p.options.length === 1 && p.options[0].card.seq === 5, 'one printing left of two -> still choose (Codex #3)')
const s = batchSummary(cards, [{ tcg_id: '999', decision: 'stock', reason: 'not_in_batch', scanned_at: 'x' }])
ok(s.cards === 5 && s.grading === 1 && s.stock === 2 && s.left === 2, 'counts')
ok(s.gradingMarket === 10 && s.stockMarket === 20 && s.gradingCost === 8, 'money')
ok(s.missing.map(m => m.seq).join() === '1,5' && s.extras.length === 1, 'missing + extras')
process.exit(fail ? 1 : 0)
