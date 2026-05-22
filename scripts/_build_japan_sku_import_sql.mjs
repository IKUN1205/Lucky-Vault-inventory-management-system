// Read db.xlsx (the Japan team's canonical SKU list) and generate SQL to
// either UPDATE existing products with aliases/short_code/variant or INSERT
// new ones. Per user directive:
//   - Don't rename existing 12 baseline SKUs — they keep their current
//     product.name and just gain aliases + variant + short_code.
//   - Build ALL valid SKUs from the xlsx (skip 单卡 + 黑盒 which belong
//     to the Singles system).
// Output: scripts/seed_japan_sku_taxonomy_2026_05_22.sql
//
// Run with: node scripts/_build_japan_sku_import_sql.mjs

import { createClient } from '@supabase/supabase-js'
import * as xlsxMod from 'xlsx'
import { writeFileSync } from 'fs'
import { ZH_TO_EN, SERIES_TO_BRAND } from '../src/lib/japanVariants.js'

const xlsx = xlsxMod.default || xlsxMod

const XLSX_PATH = '/Users/williamyu/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_lxd6gxo2wn3u12_70d6/temp/drag/db.xlsx'
const OUT_PATH  = 'scripts/seed_japan_sku_taxonomy_2026_05_22.sql'

// Variants that map to Sealed products. Everything in this set goes into
// the products.type='Sealed' bucket. The others (in_bag, single_pack) are
// pack-form and go to type='Pack'. We skip single_card / black_box per
// user (Singles system territory).
const SEALED_VARIANTS = new Set(['sealed', 'unsealed', 'cut_slice', 'case', 'other'])
const PACK_VARIANTS   = new Set(['in_bag', 'single_pack'])
const SKIP_VARIANTS   = new Set(['single_card', 'black_box'])

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_KEY env vars')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

// ---- 1. Read xlsx -----------------------------------------------------------
const wb = xlsx.readFile(XLSX_PATH)
const sheet = wb.Sheets[wb.SheetNames[0]]
const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' })
// Each row = [combined, short_code, series_zh, variant_zh, english_full]
const xlsxRows = rawRows.map((r, i) => ({
  rowNum: i + 1,
  short_code: String(r[1] || '').trim(),
  series_zh:  String(r[2] || '').trim(),
  variant_zh: String(r[3] || '').trim(),
  english_full: String(r[4] || '').trim(),
})).filter(r => r.short_code && r.variant_zh && r.english_full)

console.error(`xlsx rows after cleanup: ${xlsxRows.length}`)

// ---- 2. Pull existing products from DB --------------------------------------
const { data: existingProducts, error: prodErr } = await supabase
  .from('products')
  .select('id, name, brand, language, type, category, active')
if (prodErr) {
  console.error('Supabase error:', prodErr.message)
  process.exit(1)
}
console.error(`existing products in DB: ${existingProducts.length}`)

// ---- 3. Manual match table for the 12 baseline Japan SKUs we already loaded
//     Maps xlsx (short_code, variant_zh) → existing product.name we want
//     to keep + decorate with aliases/variant/short_code. Per user Q3,
//     don't rename existing rows — just attach taxonomy metadata.
// Exact match table — derived from a live SELECT of the 12 baseline
// products at Japan Warehouse. Without exact baseline names the fuzzy
// matcher below tends to grab the wrong variant (e.g. matches a
// "Booster Pack" SKU when we want the "Booster Box" sealed version).
const BASELINE_MATCHES = {
  'OP-14|有膜':  "OP-14 The Azure Seas Seven Booster Box",
  'OP-15|有膜':  "OP-15 Adventure on Kami's Island Booster Box",
  'M2a|有膜':    'Mega Dream Booster Box',
  'M2|有膜':     'Mega Evolution Inferno X Booster Box',
  'SV10|有膜':   'Glory of Team Rocket Booster Box',
  'M5|有膜':     'Abyss Eye Booster Box',
  'M2a|垃圾袋':  'Mega Dream Booster Box (Open)',
  'SV8a|垃圾袋': 'Terastal Festival ex Booster Box (Open)',
  'M4|垃圾袋':   'Ninja Spinner Booster Box (Open)',
  'M1L|散包':    'Mega Brave Booster Pack',
  'M1S|散包':    'Mega Symphonia Booster Pack',
  'M4|散包':     'Ninja Spinner Booster Pack',
}

// ---- 4. Build alias set + brand mapping per row -----------------------------
function extractEnglishCore(full) {
  // "MEGA Dream ex--Booster Box" → "MEGA Dream ex"
  // "MEGA Dream ex--in bag"      → "MEGA Dream ex"
  return full.split('--')[0].trim()
}

function buildAliases({ short_code, series_zh, english_core, english_full }) {
  // Aliases people might type to search: short code, Chinese series name,
  // English set name, English set name without diacritics. De-duped, no
  // empty strings.
  const set = new Set()
  if (short_code) set.add(short_code)
  if (series_zh) set.add(series_zh)
  if (english_core) set.add(english_core)
  if (english_full) set.add(english_full)
  return [...set].filter(Boolean)
}

// ---- 5. Walk xlsx rows, classify each as UPDATE / INSERT / SKIP -------------
const updates = []   // { product_id, aliases, short_code, variant, source_row }
const inserts = []   // { name, brand, language, type, category, aliases, short_code, variant }
const skipped = []   // { reason, ... }

for (const row of xlsxRows) {
  const variant_en = ZH_TO_EN[row.variant_zh]
  if (!variant_en) {
    skipped.push({ reason: 'unknown variant_zh', ...row })
    continue
  }
  if (SKIP_VARIANTS.has(variant_en)) {
    // 单卡 / 黑盒 — user said skip
    continue
  }

  const brand = SERIES_TO_BRAND[row.series_zh] || 'Other'
  const english_core = extractEnglishCore(row.english_full)
  const aliases = buildAliases({
    short_code: row.short_code,
    series_zh: row.series_zh,
    english_core,
    english_full: row.english_full,
  })

  // Try to match an existing product. Two strategies:
  //   (a) Manual baseline match for the 12 known SKUs
  //   (b) Fuzzy: existing product name contains the english_core (case-
  //       insensitive) AND the variant matches the suffix pattern
  const baselineKey = `${row.short_code}|${row.variant_zh}`
  const baselineName = BASELINE_MATCHES[baselineKey]
  let match = null
  // IMPORTANT: filter to language='JP' before matching. The DB has EN/JP
  // duplicates with identical names (e.g. "OP-14 The Azure Seas Seven
  // Booster Box" exists in both); without this filter we'd tag the EN
  // version and miss the JP-stocked one. Discovered the hard way when
  // OP-14 showed Code=— in the Japan Inventory table.
  const jpProducts = existingProducts.filter(p => (p.language || '').toUpperCase() === 'JP')
  if (baselineName) {
    match = jpProducts.find(p => p.name === baselineName)
  }
  if (!match) {
    // Fuzzy fallback. Tightened so it ONLY matches when both the core
    // english name appears AND the product is the right physical form
    // (box vs pack). Without the box/pack gate the matcher was catching
    // pre-existing "X Booster Pack" SKUs when we wanted the sealed
    // "X Booster Box" variant.
    const coreLower = english_core.toLowerCase()
    match = jpProducts.find(p => {
      const nLower = (p.name || '').toLowerCase()
      if (!nLower.includes(coreLower)) return false
      if (variant_en === 'sealed') {
        // Strict: must contain "booster box" — rejects ETB ("Elite Trainer Box"),
        // Build & Battle Box, Premium Collection, etc., which are
        // different physical SKUs even though they share a set name.
        return nLower.includes('booster box') &&
               !nLower.includes('(open)') && !nLower.includes('(unsealed)') &&
               !nLower.includes('single pack')
      }
      if (variant_en === 'unsealed') {
        return nLower.includes('booster box') &&
               (nLower.includes('(unsealed)') || nLower.includes('unsealed'))
      }
      if (variant_en === 'in_bag') {
        return nLower.includes('booster box') && nLower.includes('(open)')
      }
      if (variant_en === 'single_pack') {
        return nLower.includes('booster pack') && !nLower.includes('booster box')
      }
      return false
    })
  }

  if (match) {
    updates.push({
      product_id: match.id,
      product_name: match.name,
      aliases, short_code: row.short_code, variant: variant_en,
      source_row: row,
    })
  } else {
    // Determine type/category based on variant
    const isPack = PACK_VARIANTS.has(variant_en)
    const baseName = variant_en === 'sealed'
      ? `${english_core} Booster Box`
      : variant_en === 'unsealed'
      ? `${english_core} Booster Box (Unsealed)`
      : variant_en === 'in_bag'
      ? `${english_core} (In Bag)`
      : variant_en === 'single_pack'
      ? `${english_core} Single Pack`
      : variant_en === 'cut_slice'
      ? `${english_core} (Cut Slice)`
      : variant_en === 'case'
      ? `${english_core} (Case)`
      : variant_en === 'other'
      ? `${english_core} (Other)`
      : english_core
    inserts.push({
      name: baseName,
      brand, language: 'JP',
      type: isPack ? 'Pack' : 'Sealed',
      category: isPack ? 'Booster Pack' : 'Booster Box',
      breakable: !isPack,
      packs_per_box: !isPack ? 30 : null,  // common JP-set default; admins can fix later
      aliases, short_code: row.short_code, variant: variant_en,
      source_row: row,
    })
  }
}

console.error(`\nResults:`)
console.error(`  updates (existing products gain taxonomy): ${updates.length}`)
console.error(`  inserts (new SKUs to create):              ${inserts.length}`)
console.error(`  skipped (单卡/黑盒/blank):                  ${skipped.length}`)

// ---- 6. Emit SQL ------------------------------------------------------------
function sqlStr(s) {
  if (s === null || s === undefined) return 'NULL'
  return "'" + String(s).replace(/'/g, "''") + "'"
}
function sqlArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'NULL'
  return 'ARRAY[' + arr.map(sqlStr).join(', ') + ']::text[]'
}

const lines = []
lines.push('-- ============================================================================')
lines.push('-- Japan SKU taxonomy seed — generated from db.xlsx')
lines.push('-- ============================================================================')
lines.push(`-- Generated: ${new Date().toISOString()}`)
lines.push(`-- Source xlsx: db.xlsx (97 rows; ${xlsxRows.length} valid after cleanup)`)
lines.push(`-- ${updates.length} UPDATEs (existing products) + ${inserts.length} INSERTs (new SKUs)`)
lines.push('--')
lines.push('-- Run AFTER scripts/add_product_taxonomy_columns.sql.')
lines.push('-- Wrapped in BEGIN/COMMIT — ROLLBACK on any failure leaves the DB unchanged.')
lines.push('-- ============================================================================')
lines.push('')
lines.push('BEGIN;')
lines.push('')

lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- A. UPDATE existing products (no rename — per user directive)')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
for (const u of updates) {
  lines.push(`-- ${u.source_row.short_code} ${u.source_row.variant_zh} → "${u.product_name}"`)
  lines.push(`UPDATE products SET aliases = ${sqlArray(u.aliases)}, short_code = ${sqlStr(u.short_code)}, variant = ${sqlStr(u.variant)} WHERE id = '${u.product_id}';`)
}
lines.push('')

lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- B. INSERT new SKUs (one row per xlsx entry without a DB match)')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
for (const i of inserts) {
  lines.push(`-- ${i.source_row.short_code} ${i.source_row.variant_zh} (${i.source_row.series_zh}) → new`)
  // Unique constraint is products_brand_type_category_name_language_key —
  // composite, not just name. On re-run, UPDATE the taxonomy columns rather
  // than fail.
  lines.push(
    `INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) ` +
    `VALUES (${sqlStr(i.name)}, ${sqlStr(i.brand)}, ${sqlStr(i.language)}, ${sqlStr(i.type)}, ${sqlStr(i.category)}, ${i.breakable}, ${i.packs_per_box ?? 'NULL'}, ${sqlArray(i.aliases)}, ${sqlStr(i.short_code)}, ${sqlStr(i.variant)}, true) ` +
    `ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;`
  )
}
lines.push('')

lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push('-- Verify before COMMIT:')
lines.push('-- ───────────────────────────────────────────────────────────────────────────')
lines.push("--   SELECT variant, COUNT(*) FROM products WHERE variant IS NOT NULL GROUP BY variant ORDER BY 2 DESC;")
lines.push("--   SELECT name, short_code, variant, aliases FROM products WHERE short_code IS NOT NULL ORDER BY short_code, variant LIMIT 30;")
lines.push('')
lines.push('COMMIT;')
lines.push('')

writeFileSync(OUT_PATH, lines.join('\n'))
console.error(`\nWrote ${OUT_PATH}`)

// Also dump the skipped rows so the user can see what we ignored
if (skipped.length > 0) {
  console.error('\nSkipped rows:')
  for (const s of skipped) console.error('  -', s.short_code, s.variant_zh, '|', s.reason, '|', s.english_full)
}
