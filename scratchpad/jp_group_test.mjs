// Tests for the grouped Japan item list, run against the REAL builders.
// Gary's own 18-line message is the main fixture, so the pass/fail is about his
// message and not about one I invented.
//
// Most cases guard the two ways a shortener can do damage: losing money when it
// merges two rows of one SKU, and losing a variant when it groups a set.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SRC = 'c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/api/lark-notify.js'
const raw = fs.readFileSync(SRC, 'utf8')
const tmp = path.join(process.env.TEMP || '/tmp', '_jpgrp.mjs')
fs.writeFileSync(tmp, raw + '\nexport { buildJpStreamSale, buildJpLocalSale, jpItemLines, splitJpName }\n')
const M = await import(pathToFileURL(tmp).href)

// A literal U+0008 lands here whenever a backslash-b is written through a shell here-doc
// into this file. In a regex it stops being a word boundary and becomes the
// backspace character, which quietly turns a negative assertion into one that
// can never fail. Three assertions were written that way today. Refuse to run.
{
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8')
  if (src.includes(String.fromCharCode(8))) {
    console.error('ABORT: this file contains a literal backspace where a word boundary was meant.')
    process.exit(1)
  }
}

let pass = 0, fail = []
const ok = (name, cond, extra = '') => cond ? pass++ : fail.push(name + (extra ? ` :: ${extra}` : ''))

// ---- Gary's exact 18 lines -------------------------------------------------
const GARY = [
  ['Pokemon | Mega Brave | Booster Pack | JP', 383],
  ['Pokemon | Mega Brave | Booster Pack | JP', 121],
  ['Pokemon | Mega Brave Booster Box (Unsealed) | Booster Box | JP', 1],
  ['Pokemon | Mega Symphonia | Booster Pack | JP', 390],
  ['Pokemon | Mega Symphonia | Booster Pack | JP', 102],
  ['Pokemon | Mega Symphonia Booster Box (Unsealed) | Booster Box | JP', 1],
  ['Pokemon | Mega Dream Booster Box (Open) | Booster Box | JP', 1],
  ['Pokemon | MEGA Dream ex Single Pack | Booster Pack | JP', 5],
  ['Pokemon | MEGA Dream ex Booster Box (Unsealed) | Booster Box | JP', 3],
  ['Pokemon | Ninja Spinner Booster Box (Open) | Booster Box | JP', 2],
  ['Pokemon | Ninja Spinner | Booster Pack | JP', 300],
  ['Pokemon | Ninja Spinner | Booster Pack | JP', 633],
  ['Pokemon | Abyss Eye (In Bag) | Booster Pack | JP', 12],
  ['Pokemon | Storm Emeralda (In Bag) | Booster Pack | JP', 3],
  ['Pokemon | Storm Emeralda (In Bag) | Booster Pack | JP', 7],
  ['Pokemon | Storm Emeralda Booster Box (Unsealed) | Booster Box | JP', 1],
  ['Pokemon | Storm Emeralda Booster Box (Unsealed) | Booster Box | JP', 1],
  ['Pokemon | Storm Emeralda | Booster Box | JP', 10],
].map(([name, quantity]) => ({ name, quantity }))

const g = M.jpItemLines(GARY)
const text = g.lines.join('\n')
console.log('--- Gary\'s 18 lines, grouped ---')
console.log(`(${g.tags})`)
console.log(text)

ok('18 rows collapse to 6 set lines', g.lines.length === 6, String(g.lines.length))
ok('brand + language pulled out once', g.tags === 'Pokemon JP', g.tags)
ok('no line still carries the pipe format', !text.includes('|'))
ok('no line still says Pokemon', !text.includes('Pokemon'))

// merged quantities
ok('Mega Brave packs 383+121', /Mega Brave — 504 packs/.test(text))
ok('Mega Symphonia packs 390+102', /Mega Symphonia — 492 packs/.test(text))
ok('Ninja Spinner packs 300+633', /933 packs/.test(text))
ok('Storm in-bag 3+7 -> bags, not packs', /10 bags/.test(text))
ok('Storm unsealed boxes 1+1', /2 boxes \(unsealed\)/.test(text))

// the distinction that must NOT be collapsed
ok('Ninja Spinner keeps its bags separate from loose packs', /Ninja Spinner —.*2 bags/.test(text))
ok('Mega Dream keeps bag AND unsealed apart',
  /Mega Dream —.*1 bag /.test(text) && /Mega Dream —.*\(unsealed\)/.test(text),
  g.lines.find(l => l.startsWith('Mega Dream')))
ok('Storm keeps plain boxes apart from unsealed',
  /Storm Emeralda —.*10 boxes(?!\s*\()/.test(text), g.lines.find(l => l.startsWith('Storm')))

// nothing lost
const totalIn = GARY.reduce((a, i) => a + i.quantity, 0)
const totalOut = [...text.matchAll(/([\d,]+) (?:packs?|boxe?s?|bags?)/g)]
  .reduce((a, m) => a + Number(m[1].replace(/,/g, '')), 0)
ok('every unit survives the merge', totalIn === totalOut, `${totalIn} in, ${totalOut} out`)

// ---- a bag is 30 packs, so it must never be counted in packs ---------------
// Gary 2026-08-18: "in bag 就是trash bag那个sku 就是30包 只是没盒子". The old
// message said "10 packs (in bag)" about 300 packs. These are the assertions
// that fail if that ever comes back - the previous ones DEMANDED the bug.
for (const [nm, q] of [
  ['Pokemon | Storm Emeralda (In Bag) | Booster Pack | JP', 10],
  ['Pokemon | Abyss Eye (In Bag) | Booster Pack | JP', 12],
  ['Pokemon | Ninja Spinner Booster Box (Open) | Booster Box | JP', 2],
  ['Pokemon | Mega Dream Booster Box (Open) | Booster Box | JP', 1],
]) {
  const one = M.jpItemLines([{ name: nm, quantity: q }]).lines[0]
  ok(`bag never prints packs :: ${nm.split('|')[1].trim()}`, !/\d+ packs?\b/.test(one), one)
  ok(`bag never prints boxes :: ${nm.split('|')[1].trim()}`, !/\d+ boxe?s?\b/.test(one), one)
  ok(`bag counted in bags :: ${nm.split('|')[1].trim()}`,
    one.includes(q === 1 ? '1 bag' : `${q} bags`), one)
}
// singular, and no doubled label
ok('one bag is "1 bag" not "1 bags"',
  /(^| )1 bag($| )/.test(M.jpItemLines([{ name: 'X | Storm Emeralda (In Bag) | Booster Pack | JP', quantity: 1 }]).lines[0]))
ok('bag line does not repeat "(in bag)" after the word bags',
  !/bags? \(in bag\)/i.test(text), g.lines.find(l => /bag/.test(l)))
// a real single pack is still a pack - the fix must not swallow 散包
ok('Single Pack SKU still reads packs',
  /Storm Emeralda — 40 packs/.test(M.jpItemLines([
    { name: 'Pokemon | Storm Emeralda Single Pack | Booster Pack | JP', quantity: 40 }]).lines[0]))
// and a sealed box is still a box
ok('sealed box still reads boxes',
  /Storm Emeralda — 3 boxes$/.test(M.jpItemLines([
    { name: 'Pokemon | Storm Emeralda Booster Box | Booster Box | JP', quantity: 3 }]).lines[0]))

// ---- money must merge with the quantity ------------------------------------
const money = M.jpItemLines([
  { name: 'Pokemon | Mega Brave | Booster Pack | JP', quantity: 383, lineJpy: 383000 },
  { name: 'Pokemon | Mega Brave | Booster Pack | JP', quantity: 121, lineJpy: 121000 },
])
// ---- an EN and a JP SKU of one set must NOT merge (Codex round 2) ----------
// The catalogue holds both "[EN] OP-14 The Azure Seas Seven" and the [JP] one,
// and splitJpName strips the [JP] prefix - keyed on the set name alone they
// became one line that overstated both.
const mixed = M.jpItemLines([
  { name: "One Piece | [JP] THE AZURE SEA'S SEVEN | Booster Pack | JP", quantity: 30 },
  { name: "One Piece | THE AZURE SEA'S SEVEN | Booster Pack | EN", quantity: 4 },
])
ok('EN and JP of one set stay on separate lines', mixed.lines.length === 2, mixed.lines.join(' // '))
ok('neither line shows the merged 34', !mixed.lines.join(' ').includes('34 packs'), mixed.lines.join(' // '))
ok('both quantities survive',
  mixed.lines.join(' ').includes('30 packs') && mixed.lines.join(' ').includes('4 packs'))
// two brands, same set word
const brands2 = M.jpItemLines([
  { name: 'Pokemon | Mega Brave | Booster Pack | JP', quantity: 5 },
  { name: 'One Piece | Mega Brave | Booster Pack | JP', quantity: 7 },
])
ok('same set name under two brands stays apart', brands2.lines.length === 2, brands2.lines.join(' // '))

// ---- per-line USD must survive alongside JPY (Codex round 2) ---------------
// The senders pass lineJpy AND lineUsd; an else-if dropped the USD whenever yen
// was present. The reader has no FX rate, so that is money detail, not repetition.
const both = M.jpItemLines([
  { name: 'Pokemon | Mega Brave | Booster Pack | JP', quantity: 10, lineJpy: 50000, lineUsd: 335 },
])
ok('line keeps the yen', both.lines[0].includes('¥50,000'), both.lines[0])
ok('line keeps the USD too', both.lines[0].includes('$335'), both.lines[0])
const usdOnly = M.jpItemLines([
  { name: 'Pokemon | Mega Brave | Booster Pack | JP', quantity: 10, lineUsd: 335 },
])
ok('USD alone still prints', usdOnly.lines[0].includes('$335'), usdOnly.lines[0])

ok('merged line sums the yen too', /504 packs ¥504,000/.test(money.lines[0]), money.lines[0])
ok('money flag set', money.anyMoney === true)
ok('no money -> no yen printed', g.anyMoney === false && !text.includes('¥'))

// ---- two bag SKUs of one set must stay tellable apart (Codex round 7) ------
// "(Open)" and "(In Bag)" are the same physical thing under two catalogue
// names - that duplicate is the thing this line exists to expose. Rendered by
// unit alone they collapsed to "1 bag · 2 bags".
const twoBags = M.jpItemLines([
  { name: 'Pokemon | Ninja Spinner Booster Box (Open) | Booster Box | JP', quantity: 2 },
  { name: 'Pokemon | Ninja Spinner (In Bag) | Booster Pack | JP', quantity: 1 },
])
ok('two bag SKUs of one set are labelled', /\(open\)/.test(twoBags.lines[0]) && /\(in bag\)/.test(twoBags.lines[0]),
  twoBags.lines[0])
ok('both bag counts survive',
  twoBags.lines[0].includes('2 bags (open)') && twoBags.lines[0].includes('1 bag (in bag)'),
  twoBags.lines[0])
ok('one bag SKU alone still has no redundant suffix',
  !/bags? \(in bag\)/i.test(M.jpItemLines([
    { name: 'Pokemon | Storm Emeralda (In Bag) | Booster Pack | JP', quantity: 9 }]).lines[0]))

// ---- a case is not a box, and the dimension that differs must show ---------
// Codex round 3. "(Case)" has category "Booster Box", so it printed as
// "1 box (case)" - which anyone auditing a count reads as one box, when a case
// holds several. And keeping EN/JP on separate lines is worth nothing if the
// two lines read identically.
const cased = M.jpItemLines([
  { name: "One Piece | [JP] THE AZURE SEA'S SEVEN (Case) | Booster Box | JP", quantity: 1 },
  { name: "One Piece | [JP] THE AZURE SEA'S SEVEN (Case) | Booster Box | JP", quantity: 2 },
])
ok('a case reads as cases, never boxes', /3 cases/.test(cased.lines[0]), cased.lines[0])
ok('case line does not also say boxes', !/boxe?s?\b/.test(cased.lines[0]), cased.lines[0])
ok('case does not repeat "(case)" after the unit', !/cases? \(case\)/i.test(cased.lines[0]), cased.lines[0])

const tagged = M.jpItemLines([
  { name: "One Piece | [JP] THE AZURE SEA'S SEVEN | Booster Pack | JP", quantity: 30 },
  { name: "One Piece | THE AZURE SEA'S SEVEN | Booster Pack | EN", quantity: 4 },
])
ok('mixed languages tag the LINE, not just the header',
  tagged.lines.every(l => /\[(JP|EN)\]/.test(l)), tagged.lines.join(' // '))
ok('the two lines are now distinguishable',
  tagged.lines[0] !== tagged.lines[1], tagged.lines.join(' // '))
ok('single-language message carries no per-line tag',
  !g.lines.some(l => /\[(JP|EN)\]/.test(l)), g.lines.join(' // '))
ok('single-brand message carries no brand tag',
  !g.lines.some(l => /\[Pokemon\]/.test(l)))

// ---- the real builder still produces a whole message -----------------------
const msg = M.buildJpStreamSale({
  streamer: 'Hwa', saleDate: '2026-08-18', items: GARY, totalUnits: 1976,
})
ok('builder keeps its header', msg.startsWith('🎌 Japan Live Sale Recorded'))
ok('builder keeps the total', msg.includes('1976 units'))
ok('builder message is far shorter', msg.split('\n').length <= 12, String(msg.split('\n').length))
ok('empty items still throws', (() => {
  try { M.buildJpStreamSale({ items: [] }); return false } catch { return true }
})())

// ---- a name with no pipes must not vanish ----------------------------------
const plain = M.jpItemLines([{ name: 'Storm Emeralda Booster Box', quantity: 4 }])
ok('un-piped name still renders', /Storm Emeralda — 4 boxes/.test(plain.lines[0]), plain.lines[0])

console.log(`\n${pass + fail.length} checks, ${fail.length} failed`)
for (const f of fail) console.log('  FAIL ' + f)
process.exit(fail.length ? 1 : 0)
