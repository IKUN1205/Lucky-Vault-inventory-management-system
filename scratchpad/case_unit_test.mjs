// Tests for src/lib/caseUnit.js — runs the real module, no copies.
//
// Half of these assert what it must NOT call a case. A false positive tells a
// counter "count cartons, not the boxes inside" about a plain booster box,
// which is the same 12x error pointed the other way.
import {
  isCaseProduct, caseBoxCount, countUnitLabel, countUnitHint,
} from '../src/lib/caseUnit.js'

let pass = 0, fail = 0
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('FAIL  ' + label)) }
const eq = (got, want, label) =>
  ok(got === want, `${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)

// --- is it a case -----------------------------------------------------------
for (const n of [
  'CASE · [JP] THE WORLD’S STRONGEST WARRIORS',      // 09-02 rename, marker in front
  "[JP] THE AZURE SEA'S SEVEN (Case)",                          // the old convention
  'DUAL EVOLUTION (Case)',
  '[JP] One Piece (OP-16) - The Time of battle (Case) Other',
  'Black Bolt--Case (Case)',
  'CASE - Some Set',
  'case · lowercase, typed by hand',
  '[JP] CARRYING ON HIS WILL ( Case )',                         // spaces in the parens
]) ok(isCaseProduct(n), `case: ${n}`)

for (const n of [
  'BOX · [JP] THE WORLD’S STRONGEST WARRIORS',       // the sibling it must not catch
  'LOOSE PACK · [JP] THE WORLD’S STRONGEST WARRIORS',
  'Charizard GX Special Case File',                             // collection box, not a carton
  'Chariard GX Special Case File Collection Box',
  "[EN] OP-15 Adventure On Kami's Island Booster Box",
  'Weiss Schwarz Blue Archive The Animation',
  'Staircase Booster Box',                                      // "case" inside another word
  '', null, undefined,
]) ok(!isCaseProduct(n), `not a case: ${n}`)

// accepts a product object, not only a string
ok(isCaseProduct({ name: 'DUAL EVOLUTION (Case)' }), 'accepts a product object')
ok(!isCaseProduct({}), 'empty product is not a case')

// --- how many boxes ---------------------------------------------------------
eq(caseBoxCount({ name: 'CASE · X', packs_per_box: 12 }), 12, 'boxes per case')
eq(caseBoxCount({ name: 'CASE · X', packs_per_box: null }), null, 'unknown stays unknown')
eq(caseBoxCount({ name: 'CASE · X', packs_per_box: 0 }), null, 'zero is not a size')
eq(caseBoxCount({ name: 'BOX · X', packs_per_box: 24 }), null, 'a box has no case size')

// --- the type column --------------------------------------------------------
eq(countUnitLabel({ name: 'CASE · X', category: 'Booster Box', packs_per_box: 12 }),
   'Case · 12 boxes', 'case row overrides the misleading category')
eq(countUnitLabel({ name: 'CASE · X', category: 'Booster Box' }),
   'Case · size unknown', 'never invents a case size')
eq(countUnitLabel({ name: 'BOX · X', category: 'Booster Box' }),
   'Booster Box', 'non-case rows are untouched')
eq(countUnitLabel({ name: 'Some Pack', category: 'Booster Pack' }),
   'Booster Pack', 'inert on the rest of the sheet')
eq(countUnitLabel({ name: 'X', category: null }), '', 'missing category renders empty, not null')

// --- the hint ---------------------------------------------------------------
ok(countUnitHint({ name: 'CASE · X', packs_per_box: 12 }).includes('12 boxes inside'),
   'hint names the box count')
eq(countUnitHint({ name: 'BOX · X' }), null, 'no hint on a normal row')

// --- the regression this module was built around ----------------------------
// The old server-side test was the literal substring "(case)". Prove it misses
// the renamed SKU and that this module does not, or the test proves nothing.
const oldTest = (s) => String(s || '').toLowerCase().includes('(case)')
const renamed = 'CASE · [JP] THE WORLD’S STRONGEST WARRIORS'
ok(!oldTest(renamed), 'the old substring test really did miss the renamed case')
ok(isCaseProduct(renamed), 'the new predicate catches it')

console.log(`\n${pass + fail} assertions, ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
