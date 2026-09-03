// Buy-list matcher: run the SHIPPED version and the working-tree version side by
// side over every real product name, and print every disagreement.
//
// Rebuilt 09-03 (the 09-01 original was not kept). The handbook's note on that
// run — "这种双版本对跑比任何评审都硬,以后改匹配器就用它" — is the reason it
// exists: reasoning about a ranker says nothing about the 855 names it meets,
// and a review cannot tell you that a fix for one spelling silently broke the
// other. That is exactly what happened on 09-01: capping the set-code merge at
// two digits fixed "151 booster bundle" and broke "sv151" until LONG_CODE_RX
// went in.
//
// Three questions:
//   1. parseBuyList — does any line's qty or name change, and is each change
//      the intended one? A wrong qty writes wrong stock.
//   2. rankCandidates — can every product still find ITSELF when its own name is
//      typed in? That is the floor: if a name cannot match itself, no human
//      spelling of it will.
//   3. Does the top-1 result move for any name? A moved top-1 is what a person
//      actually reads and clicks.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(HERE, '..')
const KEYS = JSON.parse(fs.readFileSync(
  'c:/Users/Gary/Desktop/LV Agents/inventory-sync/data/_supabase_keys.json', 'utf8'))
const BASE = KEYS.urls[0].replace(/\/$/, ''), ANON = KEYS.anon_key_network

// The shim lives next to the original so its relative imports resolve — writing
// it to %TEMP% is what silently killed three other suites on 08-24.
const shims = []
async function load(tag, source) {
  const f = path.join(REPO, 'src', 'lib', `_parsereg_${tag}.gen.js`)
  fs.writeFileSync(f, source)
  shims.push(f)
  return import(pathToFileURL(f).href)
}
process.on('exit', () => shims.forEach(f => { try { fs.unlinkSync(f) } catch { /**/ } }))

const NEW_SRC = fs.readFileSync(path.join(REPO, 'src/lib/buyListParse.js'), 'utf8')
const OLD_SRC = execFileSync('git', ['show', 'origin/main:src/lib/buyListParse.js'],
  { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
if (OLD_SRC === NEW_SRC) throw new Error('shipped and working copy are identical')
const NEW = await load('new', NEW_SRC)
const OLD = await load('old', OLD_SRC)

const products = []
for (const off of [0, 1000]) {
  const r = await fetch(`${BASE}/rest/v1/products?select=id,name,active&order=id&limit=1000&offset=${off}`,
    { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } })
  products.push(...await r.json())
}
const live = products.filter(p => p.active !== false && (p.name || '').trim())
console.log(`${products.length} products, ${live.length} active — shipped vs working copy\n`)

// ---- 1. parseBuyList over every product name -------------------------------
let same = 0
const qtyDiff = [], nameDiff = []
for (const p of live) {
  const a = OLD.parseBuyList(p.name)[0], b = NEW.parseBuyList(p.name)[0]
  if (!a || !b) continue
  if (a.qty === b.qty && a.name === b.name) { same++; continue }
  if (a.qty !== b.qty) qtyDiff.push([p.name, a.qty, b.qty])
  if (a.name !== b.name) nameDiff.push([p.name, a.name, b.name])
}
console.log('=== parseBuyList over every product name ===')
console.log(`identical: ${same}   qty changed: ${qtyDiff.length}   name changed: ${nameDiff.length}`)
for (const [l, a, b] of qtyDiff) console.log(`   qty  "${l}"\n        ${a} -> ${b}`)
for (const [l, a, b] of nameDiff) console.log(`   name "${l}"\n        "${a}" -> "${b}"`)

// ---- 2. can each product still find itself ---------------------------------
const selfOld = [], selfNew = []
for (const p of live) {
  const parsed = NEW.parseBuyList(p.name)[0]
  const q = (parsed && parsed.name) || p.name
  const ra = OLD.rankCandidates(q, live, { limit: 5 })
  const rb = NEW.rankCandidates(q, live, { limit: 5 })
  selfOld.push(ra.some(c => c.id === p.id))
  selfNew.push(rb.some(c => c.id === p.id))
}
const cntOld = selfOld.filter(Boolean).length, cntNew = selfNew.filter(Boolean).length
console.log('\n=== can a product find itself (top 5) ===')
console.log(`shipped: ${cntOld}/${live.length}   working copy: ${cntNew}/${live.length}`)
const lostSelf = live.filter((p, i) => selfOld[i] && !selfNew[i])
const wonSelf = live.filter((p, i) => !selfOld[i] && selfNew[i])
console.log(`newly findable: ${wonSelf.length}   NEWLY UNFINDABLE: ${lostSelf.length}`)
for (const p of lostSelf) console.log(`   🔴 ${p.name}`)
for (const p of wonSelf.slice(0, 10)) console.log(`   + ${p.name}`)

// ---- 3. did top-1 move -----------------------------------------------------
let moved = 0
const movedRows = []
for (const p of live) {
  const parsed = NEW.parseBuyList(p.name)[0]
  const q = (parsed && parsed.name) || p.name
  const a = OLD.rankCandidates(q, live, { limit: 1 })[0]
  const b = NEW.rankCandidates(q, live, { limit: 1 })[0]
  if ((a && a.id) !== (b && b.id)) {
    moved++
    movedRows.push([p.name, a && a.name, b && b.name])
  }
}
console.log('\n=== top-1 result ===')
console.log(`moved for ${moved} of ${live.length} names`)
for (const [q, a, b] of movedRows.slice(0, 15)) {
  console.log(`   "${q}"\n      was: ${a}\n      now: ${b}`)
}

// ---- 4. the store's real lines, the ones that provoked the change ----------
console.log('\n=== the 09-01 storefront lines, shipped vs working copy ===')
const REAL = [
  'Prismatic spc x2 $510',
  '151 booster bundle x10',
  'SV 151 Booster Bundle',
  'Crown zenith x3 $660',
  'White flare etb pc $240',
  'Mega Charizard upc $230',
  'X1 journey etb $138',
]
for (const line of REAL) {
  const a = OLD.parseBuyList(line)[0], b = NEW.parseBuyList(line)[0]
  const ta = OLD.rankCandidates(a.name, live, { limit: 1 })[0]
  const tb = NEW.rankCandidates(b.name, live, { limit: 1 })[0]
  console.log(`\n   "${line}"`)
  console.log(`      shipped: qty=${a.qty} name="${a.name}" note=${JSON.stringify(a.note)}`)
  console.log(`               top1=${ta ? ta.name.slice(0, 52) : '(none)'}`)
  console.log(`      working: qty=${b.qty} name="${b.name}" note=${JSON.stringify(b.note)}`)
  console.log(`               top1=${tb ? tb.name.slice(0, 52) : '(none)'}`)
}
