// How often would this prompt actually fire? Run the REAL matcher over the REAL
// catalogue, once per product, asking "if someone typed this name today, what
// would we show them?" — with the product itself excluded, because every product
// obviously matches itself.
//
// This is the number that decides whether the guard works. A prompt that fires
// on a large share of creates gets clicked past, and then it is worse than
// nothing: it certifies duplicates instead of stopping them.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const KEYS = JSON.parse(fs.readFileSync(
  'C:/Users/Gary/Desktop/LV Agents/inventory-sync/data/_supabase_keys.json', 'utf8'))
const BASE = KEYS.urls[0].replace(/\/$/, '')
const KEY = KEYS.anon_key_network

async function pull(pathq) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${BASE}/rest/v1/${pathq}&limit=1000&offset=${off}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
    const b = await r.json()
    out.push(...b)
    if (b.length < 1000) return out
  }
}

// `active` matters: a merged-away SKU is deactivated and the guard skips those.
// Leaving it out of this query measured the OLD behaviour and reported that the
// merge had changed nothing.
const products = await pull('products?select=id,name,brand,language,type,variant,active')
const inv = await pull('inventory?select=product_id,quantity')
const stock = {}
for (const r of inv) stock[r.product_id] = (stock[r.product_id] || 0) + (r.quantity || 0)

let selfExclude = null
const stubClient = {
  from(table) {
    const api = {
      _f: {},
      select: () => api, eq(c, v) { api._f[c] = v; return api }, in(c, v) { api._f[c] = v; return api },
      // findSimilarProducts reads through fetchAllPages now. Without these the
      // range() call lands on undefined, the guard fails OPEN, and this script
      // cheerfully reports a 0.0% firing rate — a number that looks like a
      // beautifully tuned matcher and actually means the matcher never ran.
      order: () => api,
      range(a, b) { api._r = [a, b]; return api },
      then(res) {
        if (table === 'products') {
          let rows = products.filter(p => p.id !== selfExclude)
          if (api._f.brand) rows = rows.filter(r => r.brand === api._f.brand)
          if (api._f.language) rows = rows.filter(r => r.language === api._f.language)
          if (api._r) rows = rows.slice(api._r[0], api._r[1] + 1)
          return res({ data: rows, error: null })
        }
        const ids = api._f.product_id || []
        return res({ data: ids.map(id => ({ product_id: id, quantity: stock[id] || 0 })), error: null })
      },
    }
    return api
  },
}

const raw = fs.readFileSync(
  'c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/src/lib/supabase.js', 'utf8')
const tmp = path.join('c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/scratchpad',
  '_dupnoise.gen.mjs')
fs.writeFileSync(tmp, raw
  .replace(/^import\s+\{\s*createClient\s*\}\s+from\s+'@supabase\/supabase-js'\s*$/m, '')
  .replace(/import\.meta\.env/g, '({})')
  .replace(/createClient\(\s*supabaseUrl\s*,\s*supabaseAnonKey\s*\)/, 'globalThis.__STUB_SUPABASE__'))
globalThis.__STUB_SUPABASE__ = stubClient
const M = await import(pathToFileURL(tmp).href)

let fired = 0
const hits = []
for (const p of products) {
  selfExclude = p.id
  const c = await M.findSimilarProducts(p.name, p)
  if (c.length) {
    fired++
    hits.push([p, c])
  }
}

console.log(`catalogue: ${products.length} products`)
console.log(`the prompt would fire on ${fired} of them (${(100 * fired / products.length).toFixed(1)}%)`)
console.log(`\nevery pair it would surface — check each one is a real duplicate,`)
console.log(`because a wrong pair here is a prompt somebody learns to ignore:\n`)
for (const [p, c] of hits.slice(0, 40)) {
  console.log(`  ${p.name}  [${p.language}${p.variant ? '/' + p.variant : ''}]  qty=${stock[p.id] || 0}`)
  for (const x of c) {
    console.log(`      -> ${x.name}  [${x.language}${x.variant ? '/' + x.variant : ''}]  qty=${x.on_hand}`)
  }
}
if (hits.length > 40) console.log(`  ... and ${hits.length - 40} more`)
fs.unlinkSync(tmp)
