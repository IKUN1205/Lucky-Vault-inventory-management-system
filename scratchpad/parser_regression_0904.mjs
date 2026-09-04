// Old vs new parseBuyList over the WHOLE live catalogue.
//
// The manual's standing rule for this file: a parser change ships only after
// both versions have been run side by side on real data. Reviews have missed
// things here twice; the double run has not.
//
// Imports the committed version from git alongside the working copy, so this
// compares what is live against what is proposed -- not two copies of the same
// thing, which is the way this test can quietly pass without testing.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('scratchpad/_reg', { recursive: true })
const head = execSync('git show HEAD:src/lib/buyListParse.js', { encoding: 'utf8' })
writeFileSync('scratchpad/_reg/old.mjs', head)

const OLD = await import('./_reg/old.mjs')
const NEW = await import('../src/lib/buyListParse.js')

const keys = JSON.parse(readFileSync(
  'C:/Users/Gary/Desktop/LV Agents/inventory-sync/data/_supabase_keys.json', 'utf8'))
const U = keys.urls[0], K = keys.anon_key_network
const H = { apikey: K, Authorization: 'Bearer ' + K }
async function page(p) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${U}/rest/v1/${p}&order=id&limit=1000&offset=${off}`, { headers: H })
    const j = await r.json(); out.push(...j)
    if (j.length < 1000) break
  }
  return out
}
const products = (await page('products?select=id,name,active')).filter(p => p.active !== false)
console.log(`catalogue: ${products.length} active products`)

// 1. every real product name fed back in — the change must be inert here
let qtyDiff = 0, nameDiff = 0, topDiff = 0, selfOld = 0, selfNew = 0
for (const p of products) {
  const o = OLD.parseBuyList(p.name)[0]
  const n = NEW.parseBuyList(p.name)[0]
  if (!o || !n) continue
  if (o.qty !== n.qty) { qtyDiff++; if (qtyDiff <= 6) console.log(`  qty  ${o.qty} -> ${n.qty}   "${p.name}"`) }
  if (o.name !== n.name) { nameDiff++; if (nameDiff <= 6) console.log(`  name "${o.name}" -> "${n.name}"`) }
  const to = OLD.rankCandidates(o.name, products, { limit: 1 })[0]
  const tn = NEW.rankCandidates(n.name, products, { limit: 1 })[0]
  if ((to?.id || null) !== (tn?.id || null)) { topDiff++; if (topDiff <= 6) console.log(`  top  "${p.name}" : ${to?.name} -> ${tn?.name}`) }
  if (to?.id === p.id) selfOld++
  if (tn?.id === p.id) selfNew++
}
console.log('')
console.log(`fed all ${products.length} product names back in:`)
console.log(`  qty changed        : ${qtyDiff}`)
console.log(`  parsed name changed: ${nameDiff}`)
console.log(`  top-1 match moved  : ${topDiff}`)
console.log(`  finds itself       : ${selfOld} -> ${selfNew}`)

// 2. adversarial: the shapes the new rules could plausibly break
const ADV = [
  '151 booster bundle', '100 booster packs', '2x2 Ultra Pro Sleeves',
  '3 Prismatic Evolutions ETB', 'Prismatic spc x2 $510', 'OP-17 Booster Box',
  'x2 Chaos Rising', 'Storm Emeralda x 4', '30 X Mega Charizard',
  '✅8x AH MEGA EX BOX - $48', '- 5 Journey Together', '$20 promo pack',
  'ST-36 Starter Deck', '12x', 'Gem Vol 6 - 3',
]
console.log('\nadversarial shapes  (old qty -> new qty | name):')
let advChanged = 0
for (const s of ADV) {
  const o = OLD.parseBuyList(s)[0], n = NEW.parseBuyList(s)[0]
  const ch = o?.qty !== n?.qty || o?.name !== n?.name
  if (ch) advChanged++
  console.log(`  ${ch ? '*' : ' '} ${JSON.stringify(s).padEnd(34)} ${String(o?.qty)} -> ${String(n?.qty)}   "${n?.name}"`)
}
console.log(`\nadversarial lines changed: ${advChanged}/${ADV.length}`)
