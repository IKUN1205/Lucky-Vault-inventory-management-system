// ============================================================================
// Japan product variant taxonomy — EN code ↔ 中文 display
// ============================================================================
// The Japan team's existing nomenclature (db.xlsx) splits each physical set
// into multiple SKUs by packaging variant. We store English codes in the DB
// (clean to query / type-safe across locales) and display 中文 in the UI so
// staff see what they already say out loud.
//
// 9 codes total. The user explicitly skipped 'single_card' + 'black_box'
// for the sealed Japan workflow — they belong in the Singles system — but
// we keep them in the enum + UI map so any data that does end up tagged
// that way still renders nicely.
// ============================================================================

/** Canonical English codes — must match the CHECK constraint on
 *  products.variant in scripts/add_product_taxonomy_columns.sql */
export const VARIANT = {
  SEALED:       'sealed',
  UNSEALED:     'unsealed',
  IN_BAG:       'in_bag',
  SINGLE_PACK:  'single_pack',
  CUT_SLICE:    'cut_slice',
  CASE:         'case',
  SINGLE_CARD:  'single_card',
  BLACK_BOX:    'black_box',
  OTHER:        'other',
}

/** Display metadata for each variant. Used by the SearchableSelect option
 *  renderer, the JapanInventory column, and any other place that needs to
 *  show a chip/badge for a variant. `zh` is the daily-use Chinese label,
 *  `en` is the human-readable English fallback, `color` is Tailwind class
 *  fragments for the chip background + border. */
export const VARIANT_META = {
  sealed:       { zh: '有膜',     en: 'Sealed',       color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  unsealed:     { zh: '无膜',     en: 'Unsealed',     color: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40' },
  in_bag:       { zh: '垃圾袋',   en: 'In Bag',       color: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
  single_pack:  { zh: '散包',     en: 'Single Pack',  color: 'bg-blue-500/15 text-blue-300 border-blue-500/40' },
  cut_slice:    { zh: '切一刀',   en: 'Cut Slice',    color: 'bg-pink-500/15 text-pink-300 border-pink-500/40' },
  case:         { zh: '原箱',     en: 'Case',         color: 'bg-purple-500/15 text-purple-300 border-purple-500/40' },
  single_card:  { zh: '单卡',     en: 'Single Card',  color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' },
  black_box:    { zh: '黑盒',     en: 'Black Box',    color: 'bg-gray-500/20 text-gray-300 border-gray-500/40' },
  other:        { zh: '其他',     en: 'Other',        color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
}

/** Reverse map: 中文 → English code. Used by the bulk-import script that
 *  reads the xlsx (where the data is in Chinese) into DB rows (which want
 *  the English codes). */
export const ZH_TO_EN = Object.fromEntries(
  Object.entries(VARIANT_META).map(([en, m]) => [m.zh, en])
)

/** Ordered list for dropdown rendering — `sealed` first (most common),
 *  the two skip-able ones last so they don't dominate the list. */
export const VARIANT_ORDER = [
  'sealed', 'unsealed', 'in_bag', 'single_pack',
  'cut_slice', 'case', 'other', 'single_card', 'black_box',
]

/** Get display zh label (with EN fallback) for a variant code. Tolerates
 *  unknown values so old data doesn't crash the UI. */
export function variantLabel(code) {
  if (!code) return null
  const m = VARIANT_META[code]
  return m ? m.zh : code
}

/** Get chip CSS classes for a variant. Returns a safe gray default for
 *  unknown values. */
export function variantChipClasses(code) {
  if (!code) return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
  return VARIANT_META[code]?.color
    || 'bg-gray-500/15 text-gray-400 border-gray-500/30'
}

/** Chinese series name → DB brand. Used by the xlsx importer + future
 *  Japan brand filters. */
export const SERIES_TO_BRAND = {
  '海贼王':   'One Piece',
  '宝可梦':   'Pokemon',
  '游戏王':   'Yu-Gi-Oh',
  '龙珠':     'Other',     // brand enum doesn't include Dragon Ball
  '其他':     'Other',
}

export const SERIES_LIST = ['宝可梦', '海贼王', '游戏王', '龙珠', '其他']

/** When the Japan Add Product page generates an English product.name from
 *  an english_name + variant, this map provides the suffix.
 *
 *  Examples (english_name = "MEGA Dream ex"):
 *    sealed       → "MEGA Dream ex Booster Box"
 *    unsealed     → "MEGA Dream ex Booster Box (Unsealed)"
 *    in_bag       → "MEGA Dream ex (In Bag)"
 *    single_pack  → "MEGA Dream ex Single Pack"
 *    cut_slice    → "MEGA Dream ex (Cut Slice)"
 *    case         → "MEGA Dream ex (Case)"
 *    other        → "MEGA Dream ex (Other)"
 *
 *  Single-card / black-box are intentionally absent — those don't live in
 *  the sealed products table per user directive.
 */
const VARIANT_NAME_SUFFIX = {
  sealed:       ' Booster Box',
  unsealed:     ' Booster Box (Unsealed)',
  in_bag:       ' (In Bag)',
  single_pack:  ' Single Pack',
  cut_slice:    ' (Cut Slice)',
  case:         ' (Case)',
  other:        ' (Other)',
}

/** Build the canonical English product.name for a Japan SKU. Same convention
 *  used by the xlsx importer so manually-added SKUs blend with imported ones. */
export function buildJapanProductName(english_name, variant) {
  const base = (english_name || '').trim()
  if (!base) return ''
  const suffix = VARIANT_NAME_SUFFIX[variant] ?? ''
  return base + suffix
}

/** xlsx "english_full" suffix style — used when generating aliases so that
 *  searching for the xlsx-style label like "MEGA Dream ex--in bag" also hits.
 *  Differs from VARIANT_NAME_SUFFIX (which is for the canonical product.name). */
const VARIANT_ALIAS_SUFFIX = {
  sealed:       '--Booster Box',
  unsealed:     '--no seal',
  in_bag:       '--in bag',
  single_pack:  '--Single Pack',
  cut_slice:    '--Slit',
  case:         '--Box Case',
  other:        '',
}

/** Build the aliases array for a Japan SKU. De-duplicated, empty values
 *  filtered, order: short_code → series_zh → english_name → xlsx-style
 *  english_full. The order matches the import script so search results
 *  feel consistent. */
export function buildJapanProductAliases({ short_code, series_zh, english_name, variant }) {
  const aliasSuffix = VARIANT_ALIAS_SUFFIX[variant] ?? ''
  const xlsxLabel = english_name && aliasSuffix ? english_name + aliasSuffix : null
  const set = new Set()
  if (short_code) set.add(short_code)
  if (series_zh) set.add(series_zh)
  if (english_name) set.add(english_name)
  if (xlsxLabel) set.add(xlsxLabel)
  return [...set].filter(Boolean)
}

/** Whether a variant lives in products.type='Sealed' or 'Pack'. Aligns with
 *  the xlsx importer's classification. A 垃圾袋 is genuinely not a sealed box,
 *  so it belongs on the Pack shelf — but see isSinglePackVariant below: which
 *  shelf it sits on and how many packs it holds are different questions. */
export function variantToType(variant) {
  const PACK_VARIANTS = new Set(['in_bag', 'single_pack'])
  return PACK_VARIANTS.has(variant) ? 'Pack' : 'Sealed'
}

/** Whether ONE unit of this variant is literally one pack.
 *
 *  Only 散包 is. A 垃圾袋 ('in_bag') is a box's worth of loose packs with the
 *  box thrown away — Gary 2026-08-18: "in bag 就是trash bag那个sku 就是30包
 *  只是没盒子" — so it keeps the box's packs_per_box and stays breakable.
 *
 *  This used to share a set with variantToType's PACK_VARIANTS, which wrote
 *  packs_per_box = null on all eleven 垃圾袋 SKUs. A null there reads as
 *  "1 unit = 1 pack", so ten bags of Storm Emeralda — 300 packs — counted as
 *  ten. Our own money says otherwise: bag cost / 30 lands between the loose
 *  pack and the unsealed box on every set we have bought (Storm ¥509 vs ¥399
 *  and ¥559; Abyss Eye ¥351 vs ¥336 and ¥461; three more the same). At one
 *  pack per bag it would be 30-40x the price of a pack. */
export function isSinglePackVariant(variant) {
  return variant === 'single_pack'
}

/** Default-pre-checked variants on the bulk Add Product form. Reflects the
 *  most-common shape of an incoming Japan set (sealed box + open box + in
 *  bag + single pack). The other variants are opt-in. */
export const DEFAULT_VARIANTS_FOR_NEW_SET = ['sealed', 'unsealed', 'in_bag', 'single_pack']
