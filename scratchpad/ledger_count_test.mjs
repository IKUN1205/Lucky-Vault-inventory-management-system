// Front Store / Master on the blind-count page (Gary 2026-08-24 "做一个点货和直播间一样").
// Runs the REAL builders. The one thing that must never regress: a ledger room's
// negative diff must NEVER be printed as "Sold" — the POS already records sales,
// so that number is unexplained shortfall.
import { buildStreamCountBrief, buildStreamCountDetailed, buildStreamCountUndone, isLedgerRoom, getRoomWebhook } from '../api/lark-notify.js'

let pass = 0, fail = 0
const has = (hay, needle, what) => {
  if (String(hay).includes(needle)) { pass++; return }
  fail++; console.log(`FAIL ${what}\n  ${JSON.stringify(needle)} not in:\n${hay}`)
}
const hasnt = (hay, needle, what) => {
  if (!String(hay).includes(needle)) { pass++; return }
  fail++; console.log(`FAIL ${what}: ${JSON.stringify(needle)} SHOULD be absent:\n${hay}`)
}
const eq = (got, want, what) => {
  if (got === want) { pass++; return }
  fail++; console.log(`FAIL ${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const storeBody = {
  roomName: 'Front Store', countedByName: 'Hazel', streamerName: 'Hazel',
  totalSold: 5, totalDiscrepancies: 2,
  soldItems: [{ name: 'Pokemon | Paldean Fates Booster Pack | Booster Pack | EN', quantity: 5 }],
  discrepancyItems: [],
}
const masterBody = { ...storeBody, roomName: 'Master Inventory', countedByName: 'Aldo' }
const pkBody = { ...storeBody, roomName: 'Stream Room - TikTok Packheads', streamerName: 'Trey', countedByName: 'Yaz' }

// --- classification -----------------------------------------------------------
eq(isLedgerRoom('Front Store'), true, 'Front Store is a ledger room')
eq(isLedgerRoom('Master Inventory'), true, 'Master is a ledger room')
eq(isLedgerRoom('Stream Room - TikTok Packheads'), false, 'PK is NOT a ledger room')
eq(isLedgerRoom(null), false, 'null room does not crash')

// --- brief: ledger rooms ------------------------------------------------------
const sb = buildStreamCountBrief(storeBody)
has(sb, 'Inventory Count — Front Store', 'store brief is an Inventory Count')
has(sb, 'Short vs book: 5', 'store shortfall named as shortfall')
has(sb, 'NOT sales', 'store brief says outright it is not sales')
hasnt(sb, 'Sold last session', 'store brief never says Sold')
hasnt(sb, 'now streaming', 'nobody is streaming in the store')
has(sb, '+2 discrepancies', 'surplus count still shown')

const mb = buildStreamCountBrief(masterBody)
has(mb, 'Inventory Count — Master Inventory', 'master brief is an Inventory Count')
hasnt(mb, 'Sold', 'master brief never says Sold')
has(mb, 'Counted by Aldo', 'master brief names the counter')

// --- brief: stream rooms untouched -------------------------------------------
const pb = buildStreamCountBrief(pkBody)
has(pb, 'Stream Count — TikTok Packheads', 'stream brief unchanged: title')
has(pb, 'Sold last session: 5', 'stream brief unchanged: Sold wording')
has(pb, 'Sold by Trey · Counted by Yaz (now streaming)', 'stream brief unchanged: byline')
hasnt(pb, 'Short vs book', 'stream brief has no ledger wording')

// --- detailed -----------------------------------------------------------------
const sd = buildStreamCountDetailed(storeBody)
has(sd, 'Short vs book: 5 units', 'store detailed: shortfall header')
has(sd, 'NOT sales', 'store detailed: says not sales')
has(sd, 'unexplained shortfall', 'store detailed: names what it is')
hasnt(sd, 'Sold last session', 'store detailed never says Sold')
hasnt(sd, 'now streaming', 'store detailed: no streaming byline')

const pd = buildStreamCountDetailed(pkBody)
has(pd, 'Sold last session: 5 units', 'stream detailed unchanged')
hasnt(pd, 'Short vs book', 'stream detailed has no ledger wording')

// --- webhook routing ----------------------------------------------------------
process.env.LARK_WEBHOOK_STOREFRONT = 'https://hook.example/storefront'
process.env.LARK_WEBHOOK_STREAM_PACKHEADS = 'https://hook.example/pk'
eq(getRoomWebhook('Front Store'), 'https://hook.example/storefront', 'store count routes to storefront group')
eq(getRoomWebhook('Master Inventory'), null, 'master falls through to main webhook')
eq(getRoomWebhook('Stream Room - TikTok Packheads'), 'https://hook.example/pk', 'stream routing unchanged')

// --- detailed surplus line (ledger vs stream wording) --------------------------
const storeSurplus = { ...storeBody, totalDiscrepancies: 3,
  discrepancyItems: [{ name: 'Pokemon | X | Booster Pack | EN', difference: 3, fixable: false }] }
const ssd = buildStreamCountDetailed(storeSurplus)
has(ssd, 'book quantity for these SKUs is wrong', 'store surplus: book-wrong wording')
hasnt(ssd, 'sales for these SKUs UNKNOWN', 'store surplus: no sales-unknown claim')
const pkSurplus = { ...pkBody, totalDiscrepancies: 3,
  discrepancyItems: [{ name: 'Pokemon | X | Booster Pack | EN', difference: 3, fixable: false }] }
const psd = buildStreamCountDetailed(pkSurplus)
has(psd, 'sales for these SKUs UNKNOWN, not zero', 'stream surplus wording unchanged')

// --- undone message ------------------------------------------------------------
const su = buildStreamCountUndone(storeBody)
has(su, 'Inventory Count UNDONE', 'store undo is an Inventory Count')
hasnt(su, 'session', 'store undo mentions no session')
const pu = buildStreamCountUndone(pkBody)
has(pu, 'Stream Count UNDONE', 'stream undo unchanged')
has(pu, "was recording Trey's session", 'stream undo keeps the session byline')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
