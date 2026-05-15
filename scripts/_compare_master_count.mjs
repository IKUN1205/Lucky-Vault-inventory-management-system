// One-off: pull Master Vault inventory + diff against /tmp/master_count.csv
// Run from repo root:
//   SUPABASE_URL=... SUPABASE_KEY=... node scripts/_compare_master_count.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_KEY'); process.exit(1) }
const supabase = createClient(url, key, { auth: { persistSession: false } })

// 1) Master Vault location id
const { data: locs } = await supabase.from('locations').select('id, name').ilike('name', '%master%')
const masterLoc = locs?.find(l => /master/i.test(l.name) && !/non-master/i.test(l.name))
if (!masterLoc) { console.error('No master vault location'); process.exit(1) }
console.log('Master Vault location:', masterLoc.name, masterLoc.id)

// 2) Fetch inventory at Master Vault (all quantities, including 0 to spot deleted items)
const { data: inv, error } = await supabase
  .from('inventory')
  .select(`quantity, product:products(id, name, brand, category, language, type)`)
  .eq('location_id', masterLoc.id)
if (error) { console.error(error); process.exit(1) }

const systemRows = inv
  .filter(r => r.product)
  .map(r => ({
    name: r.product.name,
    brand: r.product.brand,
    category: r.product.category,
    language: r.product.language,
    type: r.product.type,
    qty: r.quantity,
  }))

console.log(`System rows: ${systemRows.length} (${systemRows.filter(r => r.qty !== 0).length} non-zero)`)

// 3) Load real count from CSV
const csv = fs.readFileSync('/tmp/master_count.csv', 'utf8').trim().split('\n')
const header = csv.shift()
const sheetRows = csv.map(line => {
  // Naive split — these rows don't contain quotes/commas mid-value based on the data we saw
  const [name, category, type, qty] = line.split(',').map(s => s.trim())
  return { name, category, type, qty: parseInt(qty, 10) || 0 }
})
console.log(`Sheet rows: ${sheetRows.length}`)

// 4) Fuzzy match — normalize names and compare
const normalize = (s) => (s || '').toLowerCase()
  .replace(/[‐–—-]/g, ' ')              // normalise dashes
  .replace(/[^a-z0-9 ]+/g, ' ')          // strip punctuation
  .replace(/\s+/g, ' ')
  .trim()

// Build a system lookup keyed by name token bag — for each sheet row we try
// to find a system row whose name contains the sheet's key tokens.
function findSystemMatches(sheetName) {
  const sn = normalize(sheetName)
  const tokens = sn.split(' ').filter(t => t.length >= 3)  // ignore "of", "vol", etc.
  if (tokens.length === 0) return []
  // Score each system row by how many of the sheet's tokens appear in it
  return systemRows
    .map(r => {
      const norm = normalize(r.name + ' ' + (r.brand || '') + ' ' + (r.type || '') + ' ' + (r.language || ''))
      const hits = tokens.filter(t => norm.includes(t)).length
      return { row: r, hits, normalized: norm }
    })
    .filter(m => m.hits >= Math.min(2, tokens.length))   // at least 2 tokens (or all if <2)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
}

console.log('\n=== SHEET → SYSTEM MATCH REPORT ===')
console.log('(matches sorted by token-hit score; review fuzzy matches carefully)\n')

const usedSystemNames = new Set()
const report = []
for (const sr of sheetRows) {
  const matches = findSystemMatches(sr.name)
  const top = matches[0]
  report.push({ sheet: sr, top, matches })
}

// Print each sheet row with its best system match + diff
const fmt = (s, w) => (s || '').toString().padEnd(w).slice(0, w)
for (const r of report) {
  const sheetQty = r.sheet.qty
  const sysQty = r.top?.row.qty ?? null
  const diff = sysQty !== null ? sheetQty - sysQty : null
  const diffStr = diff === null
    ? 'NO MATCH'
    : diff === 0
      ? '✓'
      : diff > 0
        ? `+${diff} sheet has more`
        : `${diff} system has more`
  const matchName = r.top ? r.top.row.name : '—'
  const matchMeta = r.top ? ` [${r.top.row.brand || '?'}/${r.top.row.language || '?'}/${r.top.row.type || '?'}]` : ''
  console.log(
    `${fmt(r.sheet.name, 45)} ${fmt(r.sheet.category, 15)} sheet=${sheetQty.toString().padStart(4)}  →  ${fmt(matchName + matchMeta, 60)} sys=${sysQty === null ? 'N/A' : sysQty.toString().padStart(4)}   ${diffStr}`
  )
  // Show runner-up matches if the top is ambiguous
  if (r.matches.length > 1 && r.matches[1].hits === r.top.hits) {
    for (const alt of r.matches.slice(1, 3)) {
      console.log(`${' '.repeat(85)}alt: ${alt.row.name} [${alt.row.brand || '?'}/${alt.row.language || '?'}/${alt.row.type || '?'}] sys=${alt.row.qty}`)
    }
  }
}

// 5) System items NOT in sheet at all — high-qty leftovers worth investigating
console.log('\n=== SYSTEM ITEMS NOT MENTIONED IN SHEET (qty>=10) ===')
const sheetNamesNormalized = new Set(sheetRows.map(r => normalize(r.name)))
const orphans = systemRows
  .filter(r => r.qty >= 10)
  .filter(r => {
    const sysNorm = normalize(r.name)
    // If any sheet name's tokens appear in system name, count as "mentioned"
    for (const sn of sheetRows) {
      const snTokens = normalize(sn.name).split(' ').filter(t => t.length >= 3)
      if (snTokens.length === 0) continue
      const hits = snTokens.filter(t => sysNorm.includes(t)).length
      if (hits >= Math.min(2, snTokens.length)) return false
    }
    return true
  })
  .sort((a, b) => b.qty - a.qty)

for (const o of orphans.slice(0, 50)) {
  console.log(`  ${o.qty.toString().padStart(5)}  ${o.brand || '?'}/${o.language || '?'}/${o.type || '?'}  ${o.name}`)
}
console.log(`(showing top 50 of ${orphans.length})`)
