// The adversarial inputs, run through the SHIPPED parser and the working copy
// side by side. A flagged input only matters if this change caused it; the rest
// are pre-existing and not this push's business.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(HERE, '..')
const shims = []
async function load(tag, src) {
  const f = path.join(REPO, 'src', 'lib', `_advcmp_${tag}.gen.js`)
  fs.writeFileSync(f, src); shims.push(f)
  return import(pathToFileURL(f).href)
}
process.on('exit', () => shims.forEach(f => { try { fs.unlinkSync(f) } catch { /**/ } }))

const NEW = await load('new', fs.readFileSync(path.join(REPO, 'src/lib/buyListParse.js'), 'utf8'))
const OLD = await load('old', execFileSync('git', ['show', 'origin/main:src/lib/buyListParse.js'],
  { cwd: REPO, encoding: 'utf8' }))

const LINES = [
  'Prismatic spc x2 $510', '151 booster bundle x10', 'Crown zenith x3 $660',
  'X1 journey etb $138', 'White flare etb pc $240', '2 Mega Charizard upc',
  'Journey together etb - 4',
  'Prismatic spc x2 $1,800.00', 'Prismatic spc $510 x2', 'Prismatic spc x2 $510 $600',
  'Prismatic spc x2 $', '$510', 'Prismatic spc x2 510', 'Prismatic spc x2 $0',
  'Prismatic spc x 2 $510', 'PRISMATIC SPC X2 $510',
  'Prismatic spc x0', 'Prismatic spc x000', 'Prismatic spc x999999999',
  'Prismatic spc -2', 'Prismatic spc - 2', 'op-17 booster box',
  'OP-17 booster box x3', '2026 Topps something', '151',
]
const f = (r) => `qty=${r ? r.qty : '-'} name=${JSON.stringify(r ? r.name : '')} note=${JSON.stringify(r ? r.note : null)}`

let changed = 0, worse = 0
console.log('input'.padEnd(30) + ' | verdict')
console.log('-'.repeat(100))
for (const line of LINES) {
  const a = OLD.parseBuyList(line)[0], b = NEW.parseBuyList(line)[0]
  const sa = f(a), sb = f(b)
  const dollarOld = /\$/.test((a && a.name) || ''), dollarNew = /\$/.test((b && b.name) || '')
  const oddOld = a && a.qty != null && (a.qty <= 0 || a.qty > 100000)
  const oddNew = b && b.qty != null && (b.qty <= 0 || b.qty > 100000)
  if (sa === sb) {
    const pre = dollarNew || oddNew ? '  (odd, but identical before and after — pre-existing)' : ''
    console.log(`${JSON.stringify(line).padEnd(30)} | unchanged${pre}`)
    continue
  }
  changed++
  // "worse" = a NEW dollar sign stuck in the name, or a NEW absurd quantity
  const isWorse = (dollarNew && !dollarOld) || (oddNew && !oddOld)
  if (isWorse) worse++
  console.log(`${JSON.stringify(line).padEnd(30)} | CHANGED${isWorse ? '  🔴 WORSE' : ''}`)
  console.log(`${' '.repeat(30)} |   was: ${sa}`)
  console.log(`${' '.repeat(30)} |   now: ${sb}`)
}
console.log(`\n${LINES.length} inputs — ${changed} changed, ${worse} changed for the worse`)
process.exit(worse ? 1 : 0)
