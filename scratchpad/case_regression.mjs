// Feed every real product name through BOTH the old and the new code and print
// every disagreement.
//
// The 09-01 parser change was validated this way and it is the only check that
// has ever caught a matcher regression here. Reasoning about a regex says
// nothing about the 800 names it actually meets — and a hand-reimplemented
// "before" says nothing either: the first draft of this file reimplemented the
// old set-name pipeline by hand, forgot that splitJpName strips the [JP] prefix
// upstream, and reported 100 differences that were all its own bug. So the old
// version is loaded from git, not retyped.
//
// Two questions:
//   1. isCaseProduct vs the old /\(case\)/i — who is newly called a case, and is
//      any of them wrong? A false positive tells a counter "count cartons, not
//      the boxes inside" about a plain box: the 12x error pointed the other way.
//   2. splitJpName — does any existing set name or form change? It feeds a Lark
//      message the team reads.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isCaseProduct, caseBoxCount, countUnitLabel } from '../src/lib/caseUnit.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.slice(1))
const KEYS = JSON.parse(fs.readFileSync(
  'c:/Users/Gary/Desktop/LV Agents/inventory-sync/data/_supabase_keys.json', 'utf8'))
const BASE = KEYS.urls[0].replace(/\/$/, ''), ANON = KEYS.anon_key_network
const EXPORTS = '\nexport { splitJpName, jpItemLines }\n'
const shims = []

async function loadVersion(tag, source) {
  // The shim must live in the repo: lark-notify.js imports '../src/lib/*'.
  const f = path.join(HERE, `_reg_${tag}.gen.mjs`)
  fs.writeFileSync(f, source + EXPORTS)
  shims.push(f)
  return await import(pathToFileURL(f).href)
}
process.on('exit', () => shims.forEach(f => { try { fs.unlinkSync(f) } catch { /**/ } }))

const NEW_SRC = fs.readFileSync(path.join(HERE, '..', 'api', 'lark-notify.js'), 'utf8')
const OLD_SRC = execFileSync('git', ['show', 'main:api/lark-notify.js'],
  { cwd: path.join(HERE, '..'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
if (OLD_SRC === NEW_SRC) throw new Error('old and new are identical - nothing to compare')
const NEW = await loadVersion('new', NEW_SRC)
const OLD = await loadVersion('old', OLD_SRC)

const prods = []
for (const off of [0, 1000]) {
  const r = await fetch(`${BASE}/rest/v1/products?select=id,name,category,packs_per_box,active`
    + `&order=id&limit=1000&offset=${off}`,
    { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } })
  prods.push(...await r.json())
}
const live = prods.filter(p => p.active !== false)
console.log(`${prods.length} products, ${live.length} active; comparing main vs HEAD\n`)

// ---- 1. case detection -----------------------------------------------------
const oldIsCase = (s) => /\(case\)/i.test(String(s || ''))
const newly = prods.filter(p => isCaseProduct(p.name) && !oldIsCase(p.name))
const lost = prods.filter(p => !isCaseProduct(p.name) && oldIsCase(p.name))
console.log('=== newly detected as CASE (old no -> new yes) ===')
for (const p of newly) {
  console.log(`   ${p.active === false ? '(retired) ' : ''}${p.name}`)
  console.log(`      category=${p.category} ppb=${p.packs_per_box} -> "${countUnitLabel(p)}"`)
}
if (!newly.length) console.log('   none')
console.log('\n=== NO LONGER detected as CASE (any line here is a regression) ===')
for (const p of lost) console.log(`   🔴 ${p.name}`)
if (!lost.length) console.log('   none')

console.log('\n=== every active CASE row and the unit a counter will be shown ===')
const cases = live.filter(p => isCaseProduct(p.name))
for (const p of cases.sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
  const boxes = caseBoxCount(p)
  console.log(`   ${String(boxes ?? '?').padStart(3)} boxes  ${(p.name || '').slice(0, 56)}`
    + (boxes == null ? '   <- size unknown, no number invented' : ''))
}
console.log(`   ${cases.length} case SKUs`)

// ---- 2. splitJpName, old module vs new module -----------------------------
let same = 0
const setDiff = [], formDiff = []
for (const p of live) {
  const label = (p.name || '').trim()
  if (!label) continue
  const raw = `Pokemon | ${label} | ${p.category || 'Booster Box'} | EN`
  const a = OLD.splitJpName(raw), b = NEW.splitJpName(raw)
  if (a.set === b.set && a.form === b.form) { same++; continue }
  if (a.form !== b.form) formDiff.push([label, a.form, b.form])
  if (a.set !== b.set) setDiff.push([label, a.set, b.set])
}
console.log(`\n=== splitJpName over ${live.length} live names ===`)
console.log(`identical: ${same}   form changed: ${formDiff.length}   set changed: ${setDiff.length}`)
console.log('\n-- form changed --')
for (const [l, a, b] of formDiff) console.log(`   ${a} -> ${b}   ${l}`)
if (!formDiff.length) console.log('   none')
console.log('\n-- set name changed --')
for (const [l, a, b] of setDiff) console.log(`   "${l}"\n      "${a}"  ->  "${b}"`)
if (!setDiff.length) console.log('   none')

// ---- 3. the rendered Lark line for every case, old vs new ------------------
console.log('\n=== rendered line for each case SKU (qty 2) ===')
for (const p of cases) {
  const raw = `Pokemon | ${p.name} | ${p.category || 'Booster Box'} | JP`
  const a = OLD.jpItemLines([{ name: raw, quantity: 2 }]).lines[0]
  const b = NEW.jpItemLines([{ name: raw, quantity: 2 }]).lines[0]
  console.log(`   ${a === b ? 'same ' : 'CHANGED'} ${b}`)
  if (a !== b) console.log(`            was: ${a}`)
}
