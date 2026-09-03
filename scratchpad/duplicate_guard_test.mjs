// Tests for the duplicate-SKU guard, run against the REAL findSimilarProducts
// and the REAL createProduct, with only the supabase client stubbed.
//
// Two ways this guard can be worse than nothing, and most of the cases below
// are about the second one:
//
//   * it misses a duplicate      -> we are where we already are
//   * it fires on everything     -> people learn to click OK without reading,
//                                   and then it is a guard that certifies
//                                   duplicates instead of stopping them
//
// So the catalogue fixture is real product names pulled from our own data,
// including the pairs that genuinely are two products ([EN] vs [JP], box vs
// pack) and the pairs that genuinely are one (a repeated type word).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SRC = 'c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/src/lib/supabase.js'

// Real rows, names copied out of the catalogue.
let CATALOGUE = [
  { id: 'p1', name: 'Storm Emeralda Booster Box', brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'sealed' },
  { id: 'p2', name: 'Storm Emeralda Booster Box (Unsealed)', brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'unsealed' },
  { id: 'p3', name: 'Storm Emeralda (In Bag)', brand: 'Pokemon', language: 'JP', type: 'Pack', variant: 'in_bag' },
  { id: 'p4', name: 'Storm Emeralda Single Pack', brand: 'Pokemon', language: 'JP', type: 'Pack', variant: 'single_pack' },
  { id: 'p5', name: 'Abyss Eye Booster Box', brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'sealed' },
  { id: 'p6', name: '[JP] One Piece: OP14 Booster Box', brand: 'One Piece', language: 'JP', type: 'Sealed', variant: 'sealed' },
  { id: 'p7', name: '[EN] OP-14 The Azure Seas Seven Booster Box', brand: 'One Piece', language: 'EN', type: 'Sealed', variant: 'sealed' },
  { id: 'p8', name: 'Ninja Spinner Booster Box (Open)', brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'in_bag' },
  { id: 'p9', name: 'Inteleon VMAX League Battle Deck', brand: 'Pokemon', language: 'EN', type: 'Sealed', variant: null },
]
const STOCK = { p1: 13, p2: 6, p3: 38, p4: 500, p5: 1, p6: 0, p7: 0, p8: 2, p9: 1 }

let inserted = null
const stubClient = {
  from(table) {
    const api = {
      _table: table, _filters: {},
      select() { return api },
      eq(col, val) { api._filters[col] = val; return api },
      // findSimilarProducts now reads through fetchAllPages, so the stub has to
      // page like PostgREST does — including returning a SHORT last page, which
      // is the only thing that ends the loop.
      order() { return api },
      range(a, b) { api._range = [a, b]; return api },
      in(col, vals) { api._filters[col] = vals; return api },
      insert(row) { inserted = row; return api },
      upsert(rows) { api._upserted = rows; return api },
      single: async () => ({ data: { id: 'new', ...inserted }, error: null }),
      then(res) {
        if (api._upserted) return res({ data: api._upserted, error: null })
        if (table === 'products') {
          let rows = CATALOGUE
          if (api._filters.brand) rows = rows.filter(r => r.brand === api._filters.brand)
          if (api._filters.language) rows = rows.filter(r => r.language === api._filters.language)
          // upsertProducts asks .in('name', names) to find what already exists.
          // A stub that ignores it hands back the whole catalogue and the
          // composite-key set never matches, so every row looks new.
          if (Array.isArray(api._filters.name)) rows = rows.filter(r => api._filters.name.includes(r.name))
          if (api._range) rows = rows.slice(api._range[0], api._range[1] + 1)
          return res({ data: rows, error: null })
        }
        if (table === 'inventory') {
          if (globalThis.__BREAK_INVENTORY__) {
            return res({ data: null, error: { message: 'simulated inventory outage' } })
          }
          const ids = api._filters.product_id || []
          return res({ data: ids.map(id => ({ product_id: id, quantity: STOCK[id] || 0 })), error: null })
        }
        return res({ data: [], error: null })
      },
    }
    return api
  },
}

const raw = fs.readFileSync(SRC, 'utf8')
// The rewritten copy lives INSIDE the repo: node resolves node_modules from the
// importing file's directory, and a copy in the system temp dir cannot find
// @supabase/supabase-js. Its import is stripped anyway since the client is
// replaced, but other imports in this module still have to resolve.
// The shim goes NEXT TO the original, in src/lib. It used to be written into
// scratchpad/, and the moment supabase.js grew "import { isLedgerRoomName } from
// './countRooms.js'" (08-24) every run died resolving that against scratchpad/.
// These assertions had not executed since. Keeping the copy beside the source
// keeps its relative imports resolvable.
const tmp = path.join('c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/src/lib',
  '_dupguard.gen.mjs')
const rewritten = raw
  .replace(/^import\s+\{\s*createClient\s*\}\s+from\s+'@supabase\/supabase-js'\s*$/m, '')
  // `import.meta.env` is a Vite construct and does not exist under node. The
  // module reads it at load time for the URL and key, so it has to be defined
  // before anything else runs — the literals in the source are the fallbacks.
  .replace(/import\.meta\.env/g, '({})')
  // Not anchored on a line ending: this repo is checked out with CRLF, so a
  // pattern ending in \n silently fails to match and the real client survives.
  .replace(/createClient\(\s*supabaseUrl\s*,\s*supabaseAnonKey\s*\)/,
    'globalThis.__STUB_SUPABASE__')
fs.writeFileSync(tmp, rewritten)
// both are already `export const` in the source — re-exporting them would be a
// duplicate export and the module would not parse
globalThis.__STUB_SUPABASE__ = stubClient
const M = await import(pathToFileURL(tmp).href)

let pass = 0
const fail = []
const ok = (name, cond, extra = '') => cond ? pass++ : fail.push(name + (extra ? ` :: ${extra}` : ''))
const names = rows => rows.map(r => r.name).join(' | ')

// ---- must CATCH ------------------------------------------------------------
{
  // the exact shape of the duplicates already in the catalogue: a type word twice
  const hits = await M.findSimilarProducts('[JP] One Piece: OP14 Booster Box Booster Box',
    { brand: 'One Piece', language: 'JP', type: 'Sealed' })
  ok('catches the repeated-type-word duplicate', hits.some(h => h.id === 'p6'), names(hits))
}
{
  const hits = await M.findSimilarProducts('Storm Emeralda Booster Box',
    { brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'sealed' })
  ok('catches an exact re-create', hits.some(h => h.id === 'p1'), names(hits))
  ok('most-stocked candidate is shown first', hits[0].on_hand >= hits[hits.length - 1].on_hand,
    hits.map(h => `${h.name}:${h.on_hand}`).join(' | '))
  ok('candidates carry their stock', hits.find(h => h.id === 'p1').on_hand === 13)
}
{
  // same physical thing under a second name — the variant is the only signal
  const hits = await M.findSimilarProducts('Ninja Spinner (In Bag)',
    { brand: 'Pokemon', language: 'JP', type: 'Pack', variant: 'in_bag' })
  ok('catches (In Bag) against the existing (Open) via the variant',
    hits.some(h => h.id === 'p8'), names(hits))
}

// ---- must STAY QUIET -------------------------------------------------------
{
  // [EN] and [JP] of one set are two products. Four EN/JP mismatches have
  // already been caught in this system; blurring them here would cause a fifth.
  const hits = await M.findSimilarProducts('[EN] OP-14 The Azure Seas Seven Booster Box',
    { brand: 'One Piece', language: 'EN', type: 'Sealed' })
  ok('does NOT offer the JP SKU for an EN product', !hits.some(h => h.id === 'p6'), names(hits))
}
{
  const hits = await M.findSimilarProducts('Storm Emeralda Booster Bundle',
    { brand: 'Pokemon', language: 'JP', type: 'Sealed' })
  ok('a bundle is not a box', !hits.some(h => h.id === 'p1'), names(hits))
}
{
  const hits = await M.findSimilarProducts('Mega Brave Booster Box',
    { brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'sealed' })
  ok('a genuinely new set is not flagged', hits.length === 0, names(hits))
}
{
  const hits = await M.findSimilarProducts('Dialga ex Tin',
    { brand: 'Pokemon', language: 'EN', type: 'Sealed' })
  ok('an unrelated new product is not flagged', hits.length === 0, names(hits))
}
{
  const hits = await M.findSimilarProducts('', { brand: 'Pokemon', language: 'JP' })
  ok('an empty name flags nothing rather than everything', hits.length === 0)
}

// ---- createProduct behaviour ----------------------------------------------
{
  inserted = null
  let threw = null
  try {
    await M.createProduct({ name: 'Storm Emeralda Booster Box', brand: 'Pokemon', language: 'JP', type: 'Sealed' })
  } catch (e) { threw = e }
  ok('refuses a likely duplicate', threw?.code === 'POSSIBLE_DUPLICATE', String(threw?.message))
  ok('nothing was inserted when it refused', inserted === null)
  ok('the error carries the candidates so the caller can show them',
    Array.isArray(threw?.candidates) && threw.candidates.length > 0)
}
{
  inserted = null
  const made = await M.createProduct(
    { name: 'Storm Emeralda Booster Box', brand: 'Pokemon', language: 'JP', type: 'Sealed' },
    { confirmedNotDuplicate: true })
  ok('creates anyway once a human confirmed', made?.id === 'new' && inserted !== null)
}
{
  inserted = null
  const made = await M.createProduct({ name: 'Mega Brave Booster Box', brand: 'Pokemon', language: 'JP', type: 'Sealed' })
  ok('a genuinely new product still creates with no prompt', made?.id === 'new' && inserted !== null)
}

// ---- fail OPEN: a lookup outage must not stop stock being received ---------
{
  // Same chainable shape as the real client — a stub that is not chainable
  // would throw for the wrong reason and this case would pass by accident.
  const broken = {
    from() {
      const api = {
        select: () => api, eq: () => api, in: () => api, insert: () => api,
        single: async () => ({ data: null, error: { message: 'down' } }),
        then: r => r({ data: null, error: { message: 'down' } }),
      }
      return api
    },
  }
  const saved = globalThis.__STUB_SUPABASE__
  const tmp2 = path.join('c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/src/lib', '_dupguard2.gen.mjs')
  fs.writeFileSync(tmp2, fs.readFileSync(tmp, 'utf8'))
  globalThis.__STUB_SUPABASE__ = broken
  const M2 = await import(pathToFileURL(tmp2).href + '?v=2')
  const hits = await M2.findSimilarProducts('Storm Emeralda Booster Box', { brand: 'Pokemon', language: 'JP' })
  ok('a lookup outage returns no candidates rather than throwing', Array.isArray(hits) && hits.length === 0)
  globalThis.__STUB_SUPABASE__ = saved
}

// The rewritten copies are build artefacts, not source. Named literally rather
// than by variable: tmp2 is declared inside a block and is not in scope here.
for (const f of ['_dupguard.gen.mjs', '_dupguard2.gen.mjs']) {
  try {
    fs.unlinkSync(path.join(
      'c:/Users/Gary/luckyvault/Lucky-Vault-inventory-management-system/src/lib', f))
  } catch { /* already gone */ }
}


// ---- CJK: the guard used to be blind here ---------------------------------
// [^a-z0-9 ] deleted every Japanese character, so a name typed in Japanese
// produced zero tokens and the guard reported "nothing similar" — on the two
// pages (China / Japan quick-add) most likely to be given such a name.
CATALOGUE.push({ id: 'p10', name: '決戦の刻 ブースターボックス', brand: 'One Piece',
                 language: 'JP', type: 'Sealed', variant: 'sealed' })
STOCK.p10 = 7
{
  const hits = await M.findSimilarProducts('「決戦の刻」ブースターボックス',
    { brand: 'One Piece', language: 'JP', type: 'Sealed', variant: 'sealed' })
  ok('catches the same Japanese name typed again with different punctuation',
    hits.some(h => h.id === 'p10'), names(hits))
}
{
  // and it must not simply match all Japanese: these two share only the
  // packaging word, which is exactly what _JP_FORM_WORDS removes.
  const hits = await M.findSimilarProducts('新時代の主役 ブースターボックス',
    { brand: 'One Piece', language: 'JP', type: 'Sealed', variant: 'sealed' })
  ok('does NOT match a different Japanese set that shares only ブースターボックス',
    !hits.some(h => h.id === 'p10'), names(hits))
}

// ---- pagination: a duplicate on page 2 is still a duplicate ---------------
// PostgREST caps a read at 1000 rows and does NOT error when it truncates, so
// before this the guard silently stopped seeing anything past the first page.
{
  for (let i = 0; i < 1200; i++) {
    CATALOGUE.push({ id: `f${i}`, name: `Filler Set ${i} Booster Box`, brand: 'Pokemon',
                     language: 'EN', type: 'Sealed', variant: 'sealed' })
  }
  CATALOGUE.push({ id: 'deep', name: 'Crown Zenith Elite Trainer Box', brand: 'Pokemon',
                   language: 'EN', type: 'Sealed', variant: 'sealed' })
  STOCK.deep = 4
  const hits = await M.findSimilarProducts('Crown Zenith Elite Trainer Box',
    { brand: 'Pokemon', language: 'EN', type: 'Sealed', variant: 'sealed' })
  ok('finds a duplicate sitting past the 1000-row cap', hits.some(h => h.id === 'deep'),
    `${CATALOGUE.length} rows in the fixture, ${hits.length} candidates`)
}

// ---- aliases: the name a merge absorbed must still find the survivor ------
// 162 live products carry an absorbed name and many are the Chinese ones —
// 宝石4弹 原盒 now exists ONLY as an alias of "Gem Vol.4 Booster Box", and that
// is precisely what a China quick-add gets typed into it. Scoring p.name alone
// re-opens the duplicate the merge closed.
CATALOGUE.push({ id: 'p11', name: 'Gem Vol.4 Booster Box', aliases: ['宝石4弹 原盒'],
                 brand: 'Pokemon', language: 'CN', type: 'Sealed', category: 'Sealed',
                 variant: 'sealed' })
CATALOGUE.push({ id: 'p12', name: 'Gem Vol.4 Booster Box Booster Box',
                 aliases: ['MERGED_INTO:p11'], brand: 'Pokemon', language: 'CN',
                 type: 'Sealed', variant: 'sealed', active: false })
STOCK.p11 = 9
{
  const hits = await M.findSimilarProducts('宝石4弹 原盒',
    { brand: 'Pokemon', language: 'CN', type: 'Sealed', variant: 'sealed' })
  ok('typing the absorbed Chinese name finds the survivor',
    hits.some(h => h.id === 'p11'), names(hits))
}
{
  const hits = await M.findSimilarProducts('Gem Vol.4 Booster Box',
    { brand: 'Pokemon', language: 'CN', type: 'Sealed', variant: 'sealed' })
  ok('the merged-away row is never offered back', !hits.some(h => h.id === 'p12'), names(hits))
}

// ---- upsertProducts was the fifth door, and it was unlocked ---------------
// Japan quick-add posts a whole variant family through it, so a near-miss on
// the set name creates the entire family a second time in one click.
{
  let threw = null
  try {
    await M.upsertProducts([{ name: 'Gem Vol.4 Booster Box Booster Box', brand: 'Pokemon',
                              language: 'CN', type: 'Sealed', category: 'Sealed', variant: 'sealed' }])
  } catch (e) { threw = e }
  ok('upsertProducts now stops a near-duplicate family', threw?.code === 'POSSIBLE_DUPLICATE',
    threw ? (threw.code || threw.message) : 'no error thrown')
  ok('and it names which row is the problem', !!threw?.duplicates?.[0]?.name,
    JSON.stringify(threw?.duplicates || null))
}
{
  // ...but only for rows that would CREATE. An exact re-post is an update, and
  // an update to a row that already exists is the fix, not a duplicate.
  let threw = null
  try {
    await M.upsertProducts([{ name: 'Gem Vol.4 Booster Box', brand: 'Pokemon', language: 'CN',
                              type: 'Sealed', category: 'Sealed', variant: 'sealed' }])
  } catch (e) { threw = e }
  ok('an exact re-post of an existing SKU is not treated as a duplicate', threw === null,
    threw ? (threw.code || threw.message) : '')
}

// ---- plural packaging words -----------------------------------------------
// _FORM_WORDS is singular, so "Booster Packs" used to yield the token `packs`,
// a form signature of `booster` instead of `booster+pack`, and the guard
// decided the packaging differed and said nothing. We own such a name.
CATALOGUE.push({ id: 'p13', name: '[EN] One Piece: Premium Booster PRB2 Booster Packs',
                 brand: 'One Piece', language: 'EN', type: 'Sealed', category: 'Sealed',
                 variant: 'sealed' })
STOCK.p13 = 3
{
  const hits = await M.findSimilarProducts('One Piece: Premium Booster PRB2 Booster Pack',
    { brand: 'One Piece', language: 'EN', type: 'Sealed', variant: 'sealed' })
  ok('singular name matches the plural one already on file',
    hits.some(h => h.id === 'p13'), names(hits))
}
{
  // and the singularising must not fuse two genuinely different sets
  const hits = await M.findSimilarProducts('Abyss Eye Booster Box',
    { brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'sealed' })
  ok('still does not confuse two different sets', !hits.some(h => h.id === 'p1'), names(hits))
}

// ---- a failed stock read is not zero stock --------------------------------
// "0 on hand" against every candidate is the most persuasive possible argument
// for pressing OK — "that one is empty, so mine must be different" — and if the
// query merely failed, it is an invention.
{
  globalThis.__BREAK_INVENTORY__ = true
  const hits = await M.findSimilarProducts('Storm Emeralda Booster Box',
    { brand: 'Pokemon', language: 'JP', type: 'Sealed', variant: 'sealed' })
  globalThis.__BREAK_INVENTORY__ = false
  ok('candidates still surface when the stock lookup fails', hits.length > 0)
  ok('and their stock reads unknown, never zero', hits.every(h => h.on_hand === null),
    hits.map(h => `${h.name}:${h.on_hand}`).join(' | '))
}

console.log(`\n${pass} checks, ${fail.length} failed`)
for (const f of fail) console.log('  FAIL ' + f)
process.exit(fail.length ? 1 : 0)
