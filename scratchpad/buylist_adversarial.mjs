// Adversarial probe of the buy-list parser, aimed at the two ways it can cost
// money: a wrong quantity (writes wrong stock) and a $ figure leaking anywhere
// other than `note` (the store writes market value, not what we paid — 09-01,
// where reading it as the price would have booked $7,506).
//
// Also times a pathological line: the trailing-amount pattern is a lazy .*?
// followed by optional whitespace, the classic shape for catastrophic
// backtracking, and this runs on whatever a person pastes.
import { parseBuyList, expandTokens } from '../src/lib/buyListParse.js'

let bad = 0
const show = (label, line) => {
  const r = parseBuyList(line)[0] || {}
  const flag = []
  // a quantity must be a sane positive integer or absent
  if (r.qty != null && (!Number.isInteger(r.qty) || r.qty <= 0 || r.qty > 100000)) {
    flag.push('🔴 QTY')
  }
  // no dollar figure may survive in the name, and none may become the qty
  if (/\$/.test(r.name || '')) flag.push('🔴 $ LEFT IN NAME')
  if (flag.length) bad++
  console.log('   %-34s qty=%-6s name=%-30s note=%s %s',
    JSON.stringify(line).slice(0, 34), String(r.qty), JSON.stringify(r.name || '').slice(0, 30),
    JSON.stringify(r.note || null), flag.join(' '))
}

console.log('=== the store\'s real shapes ===')
for (const l of [
  'Prismatic spc x2 $510',
  '151 booster bundle x10',
  'Crown zenith x3 $660',
  'X1 journey etb $138',
  'White flare etb pc $240',
  '2 Mega Charizard upc',
  'Journey together etb - 4',
]) show('', l)

console.log('\n=== money in awkward places ===')
for (const l of [
  'Prismatic spc x2 $1,800.00',      // thousands + cents
  'Prismatic spc $510 x2',           // amount BEFORE the marker
  'Prismatic spc x2 $510 $600',      // two amounts
  'Prismatic spc x2 $',              // dollar sign, no number
  '$510',                            // amount only
  'Prismatic spc x2 510',            // bare number, no dollar sign
  'Prismatic spc x2 $0',
  'Prismatic spc x 2 $510',          // space inside the marker
  'PRISMATIC SPC X2 $510',           // shouting
]) show('', l)

console.log('\n=== quantities that must not be invented or absurd ===')
for (const l of [
  'Prismatic spc x0',
  'Prismatic spc x000',
  'Prismatic spc x999999999',
  'Prismatic spc -2',                // no space before the dash
  'Prismatic spc - 2',
  'op-17 booster box',               // a set code must never read as a qty
  'OP-17 booster box x3',
  '2026 Topps something',            // a leading year is not a quantity we want
  '151',                             // just a set name
]) show('', l)

console.log('\n=== compact vs spaced must normalize the same ===')
const pairs = [['sv151 booster bundle', 'SV 151 Booster Bundle'],
               ['op17 booster box', 'OP 17 Booster Box'],
               ['op-117 box', 'OP117 box'],
               ['m6 box', 'M 6 box']]
for (const [a, b] of pairs) {
  const ea = expandTokens(a).join(' '), eb = expandTokens(b).join(' ')
  const same = ea === eb
  if (!same) bad++
  console.log('   %-28s vs %-24s  %s', a, b, same ? 'same ✓' : `🔴 "${ea}" vs "${eb}"`)
}

console.log('\n=== backtracking: a pathological line ===')
for (const n of [200, 2000, 20000]) {
  const line = 'a '.repeat(n) + '$'          // lazy .*? then a $ that never completes
  const t0 = process.hrtime.bigint()
  parseBuyList(line)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log('   %6d tokens -> %.1f ms %s', n, ms, ms > 1000 ? '🔴 SLOW' : 'ok')
  if (ms > 1000) bad++
}
for (const n of [2000, 20000]) {
  const line = 'x '.repeat(n) + '$1,234.56'
  const t0 = process.hrtime.bigint()
  parseBuyList(line)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log('   %6d tokens + real amount -> %.1f ms %s', n, ms, ms > 1000 ? '🔴 SLOW' : 'ok')
  if (ms > 1000) bad++
}

console.log('\n=== multi-line paste, blank lines, junk ===')
const paste = `Prismatic spc x2 $510

151 booster bundle x10

Crown zenith x3 $660`
const rows = parseBuyList(paste)
console.log('   %d rows from a 5-line paste with blanks (want 3)%s',
  rows.length, rows.length === 3 ? ' ✓' : ' 🔴')
if (rows.length !== 3) bad++

console.log(`\n${bad} problem(s)`)
process.exit(bad ? 1 : 0)
