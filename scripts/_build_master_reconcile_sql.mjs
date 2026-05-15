// Build a reconciliation SQL script that brings Master Vault inventory in
// line with the 5/14 physical count (CSV at /tmp/master_count.csv).
// Outputs to scripts/reconcile_master_vault_2026_05_14.sql.
//
// Hand-verified sheet→product mapping below. For sheet rows with no
// existing product, we emit INSERTs that the user can review.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_KEY
const supabase = createClient(url, key, { auth: { persistSession: false } })

// Hand-verified mapping (after eyeballing the comparison output earlier).
// Each entry: { sheetName, sheetQty, matcher: substring | exactName, expectedBrand?, expectedLang? }
// `matcher` is a substring (case-insensitive) we use to find the product
// row. expected* fields are extra disambiguation when multiple products
// share the same name (e.g. Rarity Collection has both EN and JP).
const MAP = [
  { sheetName: 'Mega Evo ETB PC',                                  qty: 2,   matcher: 'Mega Evolutions 1 (PC) ETB',                    brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Primsatic Evo ETB',                                qty: 11,  matcher: 'Prismatic Evolutions Elite Trainer Box',        brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Ascended Heroes (packs)',                          qty: 152, matcher: 'Ascended Heroes Booster Pack',                  brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Perfect Order (packs)',                            qty: 120, matcher: 'Perfect Order Booster Pack',                    brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Charzard EX (UPC)',                                qty: 16,  matcher: 'Charizard Ultra-Premium Collection',            brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Prismatic Evo SPC',                                qty: 16,  matcher: 'Prismatic Evolutions Super Premium Collection', brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Prismatic Tech Sticker',                           qty: 21,  matcher: 'Prismatic tech sticker Collection',             brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Asecnded Heroes Booster Bundles',                  qty: 4,   matcher: 'Ascended Heroes Booster Bundle',                brand: 'Pokemon', language: 'EN' },
  { sheetName: 'First Partner Vol 1',                              qty: 10,  matcher: 'First Partner Illustration Collection',         brand: 'Pokemon', language: 'EN' },
  { sheetName: 'S/V Build and Battle Stadium',                     qty: 6,   matcher: 'Scarlet & Violet Build & Battle Stadium',       brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Perfect order build and battle box sealed',        qty: 1,   matcher: 'Perfect Order Build & Battle Box',              brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Forces of Nature GX Box',                          qty: 1,   matcher: 'Forces of Nature GX Premium Box',               brand: 'Pokemon', language: 'EN' },
  { sheetName: 'Venusaur Vmax Box',                                qty: 1,   matcher: 'Venusaur VMAX Premium Collection',              brand: 'Pokemon', language: 'EN' },
  { sheetName: 'PC Tohoku Special Box JP',                         qty: 1,   matcher: 'Pokemon Center Tohoku Special Box',             brand: 'Pokemon', language: 'JP' },
  { sheetName: 'PC Hiroshima Special Box JP',                      qty: 1,   matcher: 'Pokemon Center Hiroshima Special Box',          brand: 'Pokemon', language: 'JP' },
  { sheetName: 'Vivid Portrayals Indigo',                          qty: 12,  matcher: 'Vivid Portrayals Indigo Booster Box',           brand: 'Pokemon', language: 'CN' },
  { sheetName: 'True Mystic',                                      qty: 20,  matcher: 'True Mystic Booster Box',                       brand: 'Pokemon', language: 'CN' },
  { sheetName: 'Chinese blastoise venusaur jumbo pack',            qty: 396, matcher: 'Venusaur & Blastoise Jumbo Booster Pack',       brand: 'Pokemon', language: 'CN' },
  { sheetName: 'Some red Chinese promo pack',                      qty: 240, matcher: 'Red Promo Pack',                                brand: 'Pokemon', language: 'CN' },
  { sheetName: 'OP 13 JP',                                         qty: 21,  matcher: 'OP-13 Carrying On His Will Booster Box',        brand: 'One Piece', language: 'JP' },
  { sheetName: 'Promo Pack Vol 7',                                 qty: 100, matcher: 'vol 7 OP promo pack Booster Pack',              brand: 'One Piece', language: 'JP' },
  { sheetName: 'Promo Pack Vol 6',                                 qty: 100, matcher: 'vol 6 op promo pack Booster Pack',              brand: 'One Piece', language: 'JP' },
  { sheetName: 'Promo Pack Vol 4',                                 qty: 100, matcher: 'vol 4 promo pack Booster Pack',                 brand: 'One Piece', language: 'JP' },
  { sheetName: 'Limit Over Collection The Rivals',                 qty: 37,  matcher: 'Limit Over Collection The Rivals Booster Box' },
  { sheetName: 'Yu-Gi-Oh Rarity Collection Quarter Centers Edition', qty: 160, matcher: 'Rarity Collection Quarter Century Edition Booster Box', language: 'JP' },
  { sheetName: 'Nikke',                                            qty: 99,  matcher: 'NIKKE Goddess of Victory Booster Box (Weiss Schwarz)' },
  { sheetName: 'Hololive',                                         qty: 48,  matcher: 'hololive Enchant Regalia Booster Box' },
  { sheetName: 'Eminence In shadow',                               qty: 48,  matcher: 'The Eminence in Shadow Booster Box (Weiss Schwarz)' },
  { sheetName: 'EB-04 (sheet says 0)',                             qty: 0,   matcher: 'EB-04 Memorial Collection Booster Box' },

  // Riftbound: sheet says 22 total but system has Spirit Forge=12 + Origins=10 (sums to 22).
  // Without per-SKU breakdown from the streamer we leave as-is. Flagged below.
  { sheetName: 'Riftbound (split unknown — left untouched)',        qty: null, skip: true },

  // Two sheet rows that LOOK missing but are just slightly mis-named in the
  // sheet vs the system — wired to the existing products instead of creating
  // duplicates.
  { sheetName: 'EX Battle Decks (sheet plural; system singular)',  qty: 2,   matcher: 'EX Battle Deck',                                brand: 'Pokemon', language: 'EN' },
  { sheetName: 'EB 03 JP',                                         qty: 4,   matcher: 'EB-03 Heroines Edition Booster Box',           brand: 'One Piece', language: 'JP' },

  // Truly missing from products table — needs creation
  { sheetName: 'Promo Pack Vol 8 (One Piece)',                     qty: 90,  missing: true, brand: 'One Piece', language: 'JP', type: 'Pack' },
]

// 1) Resolve Master Vault location
const { data: locs } = await supabase.from('locations').select('id, name').ilike('name', '%master%')
const masterLoc = locs?.find(l => /master/i.test(l.name) && !/non-master/i.test(l.name))
console.error('Master Vault:', masterLoc.name, masterLoc.id)

// 2) Pull all products + master inventory rows
const { data: prods } = await supabase.from('products').select('id, name, brand, language, type, category')
const { data: invRows } = await supabase
  .from('inventory')
  .select('id, product_id, quantity, product:products(name, brand, language, type)')
  .eq('location_id', masterLoc.id)

console.error(`Products in DB: ${prods.length}; inventory rows at master: ${invRows.length}`)

// 3) Resolve each MAP entry's product_id
function resolveProduct(matcher, brand, language) {
  const m = matcher.toLowerCase()
  let candidates = prods.filter(p => (p.name || '').toLowerCase().includes(m))
  if (brand)    candidates = candidates.filter(p => (p.brand || '').toLowerCase() === brand.toLowerCase()) || candidates
  if (language) candidates = candidates.filter(p => (p.language || '').toLowerCase() === language.toLowerCase()) || candidates
  return candidates
}

const sheetMappedProductIds = new Set()
const lines = []
const flagged = []
const newProducts = []

lines.push('-- ============================================================================')
lines.push('-- Master Vault inventory reconcile against 5/14 physical count')
lines.push('-- ============================================================================')
lines.push('-- Generated by scripts/_build_master_reconcile_sql.mjs')
lines.push(`-- Source: Google Sheet 5/14 master count (33 SKUs)`)
lines.push(`-- Master Vault location id: ${masterLoc.id}`)
lines.push('--')
lines.push('-- This script is destructive. ALWAYS take a Supabase snapshot first.')
lines.push('-- Run inside a transaction so you can ROLLBACK if anything looks off.')
lines.push('-- ============================================================================')
lines.push('')
lines.push('BEGIN;')
lines.push('')

// Section A: matched updates
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- A. UPDATE inventory rows to match sheet quantities')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
for (const m of MAP) {
  if (m.skip || m.missing) continue
  const cands = resolveProduct(m.matcher, m.brand, m.language)
  if (cands.length === 0) {
    flagged.push(`NO product match: "${m.sheetName}" (matcher=${m.matcher})`)
    continue
  }
  if (cands.length > 1) {
    flagged.push(`AMBIGUOUS: "${m.sheetName}" matched ${cands.length} products: ${cands.map(c => c.id + '=' + c.name).join(' | ')}`)
    continue
  }
  const p = cands[0]
  sheetMappedProductIds.add(p.id)

  // Find the inventory row (may not exist if product never had stock at master)
  const invRow = invRows.find(r => r.product_id === p.id)
  const currentQty = invRow ? invRow.quantity : null
  if (invRow) {
    if (invRow.quantity === m.qty) {
      lines.push(`-- ✓ ${m.sheetName} → ${p.name}: already ${m.qty} (no change)`)
    } else {
      lines.push(`-- ${m.sheetName} → ${p.name}: ${currentQty} → ${m.qty} (Δ ${m.qty - currentQty})`)
      lines.push(`UPDATE inventory SET quantity = ${m.qty}, last_updated = NOW() WHERE id = '${invRow.id}';`)
    }
  } else {
    lines.push(`-- ${m.sheetName} → ${p.name}: no inventory row, INSERT ${m.qty}`)
    lines.push(`INSERT INTO inventory (product_id, location_id, quantity) VALUES ('${p.id}', '${masterLoc.id}', ${m.qty});`)
  }
}
lines.push('')

// Section B: zero out unmatched master inventory
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- B. ZERO out inventory rows at Master Vault NOT in the sheet')
lines.push('--    ("没列就是没有" — sheet is the source of truth for 5/14)')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
const orphanRows = invRows
  .filter(r => r.quantity !== 0 && !sheetMappedProductIds.has(r.product_id))
  // exclude the Riftbound rows since we explicitly left them untouched
  .filter(r => !/riftbound/i.test(r.product?.name || ''))
for (const r of orphanRows) {
  const label = `${r.product?.brand || '?'}/${r.product?.language || '?'}/${r.product?.type || '?'} ${r.product?.name || '?'}`
  lines.push(`-- ${label}: ${r.quantity} → 0`)
  lines.push(`UPDATE inventory SET quantity = 0, last_updated = NOW() WHERE id = '${r.id}';`)
}
lines.push('')

// Section C: new products (manual review required)
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- C. NEW PRODUCTS — sheet listed these, system has no matching product.')
lines.push('--    The INSERTs below create the product + give it master inventory.')
lines.push('--    Review each one — change brand/category/type if these defaults are wrong.')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
for (const m of MAP) {
  if (!m.missing) continue
  newProducts.push(m)
  // Insert with safe defaults, returning id so we can chain inventory insert
  lines.push(`-- "${m.sheetName}" — qty ${m.qty}`)
  lines.push(`WITH new_p AS (`)
  lines.push(`  INSERT INTO products (name, brand, language, type, category, active)`)
  lines.push(`  VALUES (${sqlStr(m.sheetName)}, ${sqlStr(m.brand)}, ${sqlStr(m.language)}, ${sqlStr(m.type)}, ${sqlStr(m.brand)}, true)`)
  lines.push(`  RETURNING id`)
  lines.push(`)`)
  lines.push(`INSERT INTO inventory (product_id, location_id, quantity)`)
  lines.push(`SELECT id, '${masterLoc.id}', ${m.qty} FROM new_p;`)
  lines.push('')
}

lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- VERIFY before COMMIT:')
lines.push('--   SELECT p.brand, p.language, p.name, i.quantity')
lines.push('--   FROM inventory i JOIN products p ON p.id = i.product_id')
lines.push(`--   WHERE i.location_id = '${masterLoc.id}' AND i.quantity > 0`)
lines.push('--   ORDER BY p.brand, p.name;')
lines.push('--')
lines.push('-- If totals look right (should be 33 non-zero rows ≈ matching sheet), COMMIT.')
lines.push('-- Otherwise: ROLLBACK;')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('')
lines.push('-- COMMIT;        -- ← uncomment after verifying')
lines.push('-- ROLLBACK;      -- ← if anything looks off')

const out = lines.join('\n')
fs.writeFileSync('scripts/reconcile_master_vault_2026_05_14.sql', out)
console.error('\nWrote scripts/reconcile_master_vault_2026_05_14.sql')

if (flagged.length > 0) {
  console.error('\n⚠️ FLAGGED — needs human review:')
  for (const f of flagged) console.error('  -', f)
}
if (newProducts.length > 0) {
  console.error('\nℹ️ Will CREATE new products:')
  for (const p of newProducts) console.error(`  - ${p.sheetName} (qty ${p.qty}, defaults: ${p.brand}/${p.language}/${p.type})`)
}

function sqlStr(s) {
  if (s === null || s === undefined) return 'NULL'
  return "'" + String(s).replace(/'/g, "''") + "'"
}
