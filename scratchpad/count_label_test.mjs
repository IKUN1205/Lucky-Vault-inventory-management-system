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

// ---- a carton must never be labelled a box (09-03) -------------------------
// products.category on every case row reads "Booster Box", so the count message
// printed "CASE · X · Booster Box" — the person reconciling it reads one box,
// and a case is twelve. Both spellings of the marker have to land on "Case".
{
  const newSpelling = shortCountName(
    'One Piece | CASE · [JP] THE WORLD’S STRONGEST WARRIORS | Booster Box | JP', 'EN')
  const oldSpelling = shortCountName(
    "One Piece | [JP] THE AZURE SEA'S SEVEN (Case) | Booster Box | JP", 'EN')
  const plainBox = shortCountName(
    'One Piece | BOX · [JP] THE WORLD’S STRONGEST WARRIORS | Booster Box | JP', 'EN')

  hasnt(newSpelling, 'Booster Box', 'a renamed carton never says Booster Box')
  has(newSpelling, '· Case', 'a renamed carton says Case')
  hasnt(oldSpelling, 'Booster Box', 'an old-spelling carton never says Booster Box')
  hasnt(newSpelling, 'CASE ·', 'the leading marker is not repeated in the message')
  // …and the sibling BOX row must be untouched: mislabelling a box as a carton
  // is the same 12x error pointed the other way.
  has(plainBox, 'Booster Box', 'a plain box still says Booster Box')
  hasnt(plainBox, '· Case', 'a plain box is never called a Case')
  // the language tag appears once, not twice — stripping it before the marker
  // left it mid-name, where the dominant-language rule then appended a second
  eq((newSpelling.match(/\[JP\]/g) || []).length, 1, 'language tag appears exactly once')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
