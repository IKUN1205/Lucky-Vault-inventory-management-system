// Does /buy-list understand the format the store ACTUALLY writes?
//
// Gary 2026-09-04: "直接让他们输入item list就行 barcode估计没啥用"
//
// Every earlier test used "8 AH MEGA EX BOX". What the store really sends is
//     ✅8x AH MEGA EX BOX - $48
// leading quantity with an x, a tick emoji, and a trailing per-unit price after
// a dash. If the parser mangles that, a guide telling them to paste it is worse
// than no guide -- they will paste, get nonsense, and stop using the page.
import { readFileSync } from 'node:fs'
import { parseBuyList, rankCandidates } from '../src/lib/buyListParse.js'

const REAL = `✅8x AH MEGA EX BOX - $48
✅2x DR ETB - $90
✅26X SPC - $215
✅7x DR BBOX (ripped seal) - $320
✅50x FPS3 - $25
✅18x PRIS BBUNDLE - $73
✅6x AH TIN - $40`

const EXPECT = [
  [8, 'AH MEGA EX BOX', 48], [2, 'DR ETB', 90], [26, 'SPC', 215],
  [7, 'DR BBOX', 320], [50, 'FPS3', 25], [18, 'PRIS BBUNDLE', 73],
  [6, 'AH TIN', 40],
]

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

const parsed = parseBuyList(REAL)
console.log(`lines in: 7   lines parsed: ${parsed.length}\n`)
let qtyOk = 0, priceSeen = 0
parsed.forEach((p, i) => {
  const [eq, en, ep] = EXPECT[i] || []
  const q = p.qty
  const okQty = q === eq
  if (okQty) qtyOk++
  const note = p.note || ''
  const hasPrice = note.includes(String(ep))
  if (hasPrice) priceSeen++
  const cands = rankCandidates(p.name, products, { limit: 3 })
  console.log(`${okQty ? 'OK ' : '!! '} qty=${String(q).padStart(3)} (want ${eq})   name="${p.name}"`)
  console.log(`      price kept: ${hasPrice ? 'yes -> ' + note : 'NO — $' + ep + ' was dropped'}`)
  console.log(`      top match : ${cands[0] ? cands[0].name : '(nothing offered)'}`)
  if (cands[1]) console.log(`                  ${cands[1].name}`)
  console.log('')
})
console.log('='.repeat(64))
console.log(`quantities correct : ${qtyOk}/7`)
console.log(`per-unit price kept: ${priceSeen}/7`)
