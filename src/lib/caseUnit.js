// Is this row a sealed CASE, and what unit is the counter supposed to type?
//
// Gary 2026-09-03: "是不是我们也要把case 信息放在最前面让他们看最好".
//
// A case is the most expensive row on the sheet to get wrong, because the error
// is multiplicative — one carton is 12 boxes, so a counter who opens it and
// counts boxes reports 12x. It has happened twice, both on Packheads:
//
//   08-21  Yaz counted the loose boxes on the shelf and not the sealed cartons,
//          75 boxes written off; the stream transcript ("cases are in here right
//          now") is what recovered them.
//   08-24  Trey counted 206 boxes across the 12 cases that had landed at noon.
//
// Two things make the sheet complicit rather than merely silent:
//
//   1. The type column renders products.category, and a case's category is
//      "Booster Box". So the one column a counter would check to confirm the
//      unit actively says BOX on a case row.
//   2. The only signal that it is a case lives inside the product NAME, which
//      the reader has to notice and interpret.
//
// A note on the predicate: five server-side call sites used to ask this with the
// substring "(case)". The 09-02 rename moved the marker to the front of the
// name ("CASE · <set>") and every one of them silently stopped recognising it —
// including the transfer notice whose entire job is to say "count cartons, not
// the boxes inside". That is why this is one shared function and why it accepts
// both spellings. It mirrors inventory-sync/pack_math.py:is_case; the two are
// pinned to the same cases by their respective tests.

// "Special Case File" is a Pokemon collection box, not a carton — the negative
// lookahead is the reason this cannot simply be /case/i.
const CASE_RX = /(\(\s*case\s*\)|^\s*case\s*[·|\-–—]|\bcases?\b(?!\s*file))/i

const nameOf = (x) => (typeof x === 'string' ? x : x?.name) || ''

/** True when the row is a sealed case (a carton of boxes), either spelling. */
export function isCaseProduct(product) {
  return CASE_RX.test(nameOf(product))
}

/**
 * How many BOXES are in one case.
 *
 * On a case row `packs_per_box` does not hold packs — it holds boxes-per-case
 * (the 09-01 decision "OP17 箱规 = 12 盒/箱" was written into a column named for
 * packs). That overload is a real defect and the fix needs a DDL migration
 * (`unit` + `base_units`); until then this function is the single place that
 * knows the column means something different on this kind of row, so nobody
 * else has to remember it.
 *
 * Returns null when unknown — never a default. A guessed case size is exactly
 * the 12x error this module exists to prevent.
 */
export function caseBoxCount(product) {
  if (!isCaseProduct(product)) return null
  const n = Number(product?.packs_per_box)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * What the type column should say for this row.
 *
 * For a case that is "Case · 12 boxes", never the raw category — the category
 * on those rows is "Booster Box" and contradicts the name. For everything else
 * the category is returned untouched, so this is inert on the other 99% of the
 * sheet.
 */
export function countUnitLabel(product) {
  const category = product?.category || ''
  if (!isCaseProduct(product)) return category
  const boxes = caseBoxCount(product)
  return boxes ? `Case · ${boxes} boxes` : 'Case · size unknown'
}

/** Short instruction for the count input on a case row; null when not a case. */
export function countUnitHint(product) {
  if (!isCaseProduct(product)) return null
  const boxes = caseBoxCount(product)
  return boxes
    ? `Count SEALED CARTONS, not the ${boxes} boxes inside`
    : 'Count SEALED CARTONS, not the boxes inside'
}
