// Runs the real builder against the real 08-18 Packheads payload.
import { appendSurplus, shortCountName, splitProductLabel, dominantLanguage } from '../api/lark-notify.js'

let pass = 0, fail = 0
const eq = (got, want, what) => {
  if (got === want) { pass++; return }
  fail++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
}
const has = (hay, needle, what) => {
  if (String(hay).includes(needle)) { pass++; return }
  fail++; console.log(`FAIL ${what}\n  ${JSON.stringify(needle)} not in:\n${hay}`)
}
const hasnt = (hay, needle, what) => {
  if (!String(hay).includes(needle)) { pass++; return }
  fail++; console.log(`FAIL ${what}: ${JSON.stringify(needle)} SHOULD be gone`)
}

// --- the real rows from the 2026-08-18 21:49 PT Packheads count -------------
const L = (b, n, c, l) => `${b} | ${n} | ${c} | ${l}`
eq(shortCountName(L('One Piece', '[EN] OP-13 Carrying On His Will', 'Blister Pack', 'EN')),
   'OP-13 Carrying On His Will · Blister Pack', 'blister keeps its form, loses brand and [EN]')
eq(shortCountName(L('One Piece', 'The Time of Battle Booster Pack - The Time of Battle (OP16)', 'Booster Pack', 'EN')),
   'The Time of Battle (OP16) · Booster Pack', 'set written twice collapses, code survives')
eq(shortCountName(L('One Piece', "Adventure on Kami's Island Booster Pack - Adventure on Kami's Island (OP15-EB04)", 'Booster Pack', 'EN')),
   "Adventure on Kami's Island (OP15-EB04) · Booster Pack", 'same, with a punctuated set name')
eq(shortCountName(L('Pokemon', 'OP-15 Kami’s Adventure', 'Booster Pack', 'EN')),
   'OP-15 Kami’s Adventure · Booster Pack', 'a WRONG brand cannot mislead once it is not printed')

// The distinction the Marvel case turned on must never be collapsed.
const box  = shortCountName(L('One Piece', '[EN] OP-02 Paramount War', 'Booster Box', 'EN'))
const pack = shortCountName(L('One Piece', '[EN] OP-02 Paramount War', 'Booster Pack', 'EN'))
if (box !== pack) pass++; else { fail++; console.log('FAIL box and pack of one set must not render identically') }
has(box, 'Booster Box', 'box says box')

// --- language: mark only the odd one out ----------------------------------
const mixed = [{ name: L('One Piece', 'A', 'Booster Box', 'EN') }, { name: L('Other', 'B', 'Booster Box', 'JP') }]
const allEn = [{ name: L('One Piece', 'A', 'Booster Box', 'EN') }, { name: L('One Piece', 'B', 'Booster Box', 'EN') }]
eq(dominantLanguage(mixed), 'EN', 'EN wins when EN and JP tie on count order')
eq(dominantLanguage(allEn), null, 'all-EN has no exception to mark')
eq(shortCountName(L('Other', 'Limit Over Collection The Rivals', 'Booster Box', 'JP'), 'EN'),
   'Limit Over Collection The Rivals · Booster Box [JP]', 'the odd language is marked when mixed')
hasnt(shortCountName(L('One Piece', 'X', 'Booster Box', 'EN'), 'EN'), '[EN]', 'no tag when nothing is mixed')

// --- degenerate input may not produce "undefined" in a group message -------
eq(shortCountName(''), 'Unknown', 'empty label')
eq(shortCountName(undefined), 'Unknown', 'missing label')
eq(shortCountName('Just A Plain Name'), 'Just A Plain Name', 'a name with no pipes passes through')
eq(splitProductLabel('a | b | c | d | EN').name, 'b | c', 'a pipe inside the set name survives')

// --- appendSurplus renders through the same shortener ----------------------
const out = []
appendSurplus(out, [
  { name: L('Other', 'Hololive: Ayakashi Vermillion', 'Booster Box', 'EN'), extra: 6, fixable: true,
    sources: [{ name: 'Master Inventory', qty: 36 }] },
  { name: L('One Piece', '[JP] OP-13 Carrying On His Will', 'Booster Box', 'JP'), extra: 12, fixable: false,
    elsewhere: 0, streak: 2, since: '2026-08-17T00:00:00Z' },
], 21)
const txt = out.join('\n')
has(txt, 'Hololive: Ayakashi Vermillion · Booster Box +6', 'fixable line is short; this block really does mix EN and JP, so both are tagged')
has(txt, 'Master Inventory has 36', 'the actionable half survives shortening')
hasnt(txt, 'One Piece |', 'no pipe columns left anywhere')
hasnt(txt, '[JP] OP-13', 'the language prefix is stripped from the name')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
