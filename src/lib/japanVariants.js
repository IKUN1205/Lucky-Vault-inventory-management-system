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
