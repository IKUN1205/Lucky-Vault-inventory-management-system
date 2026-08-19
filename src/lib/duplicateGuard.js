import { createProduct, upsertProducts, findSimilarProducts } from './supabase'

// ============================================================================
// "Is it one of these?" — the one question that stops a duplicate SKU
// ============================================================================
// Gary 2026-08-19: the buy-in and the transfer are where a missing SKU gets
// noticed, because that is where somebody is holding the item. So that is where
// it should be settled — either matched to what we have, or created on purpose.
//
// The catch is that the same moment is how duplicates are made: "I cannot find
// it, I will make one." A second row for one product splits the shelf, and then
// every count, cost and price figure for it is quietly computed on half the
// stock. The catalogue is in decent shape right now — 813 products, 7 name
// collisions, none of them splitting a shelf — which is exactly why the guard
// goes in before more people are handed the create button.
//
// Cancel is the SAFE answer and the message says so: pressing Cancel costs one
// search, pressing OK on a real duplicate costs a split shelf nobody notices for
// weeks.
// ============================================================================

/** Create a product, but ask first if we might already have it.
 *
 *  @param product   the row to insert
 *  @param confirm   injectable so tests do not need a browser
 *  @throws {code:'DUPLICATE_CANCELLED'} when the user says it is one of the
 *          existing SKUs — callers should treat that as "use that one instead",
 *          not as a failure to report.
 */
export async function createProductChecked(product, { confirm } = {}) {
  const ask = confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => false)
  try {
    return await createProduct(product)
  } catch (err) {
    if (err?.code !== 'POSSIBLE_DUPLICATE') throw err

    const lines = err.candidates.map(c => {
      const bits = [c.name]
      if (c.variant) bits.push(`[${c.variant}]`)
      bits.push(c.on_hand === null ? '— stock unknown (lookup failed)' : `— ${c.on_hand} on hand`)
      return '  • ' + bits.join(' ')
    })
    const ok = ask(
      `We may already have this.\n\n` +
      `You are about to add:\n  ${product?.name}\n\n` +
      `Existing product${err.candidates.length === 1 ? '' : 's'} that look${err.candidates.length === 1 ? 's' : ''} like it:\n` +
      `${lines.join('\n')}\n\n` +
      `If one of these IS it, press CANCEL and use that SKU. Adding a second row ` +
      `splits the stock across two products, and every count and cost for it is ` +
      `then computed on half the goods.\n\n` +
      `Press OK only if this is genuinely a different product.`
    )
    if (!ok) {
      const e = new Error('Use the existing SKU instead of adding a second one')
      e.code = 'DUPLICATE_CANCELLED'
      e.candidates = err.candidates
      throw e
    }
    return await createProduct(product, { confirmedNotDuplicate: true })
  }
}

/** The same question for the Japan quick-add, which posts a whole variant
 *  family in one submit. One prompt for the batch, not one per row: a prompt
 *  per row is how people learn to hold Enter down.
 *
 *  @throws {code:'DUPLICATE_CANCELLED'} when the user says we already have them
 */
export async function upsertProductsChecked(rows, { confirm } = {}) {
  const ask = confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => false)
  try {
    return await upsertProducts(rows)
  } catch (err) {
    if (err?.code !== 'POSSIBLE_DUPLICATE') throw err

    const blocks = err.duplicates.map(d => {
      const lines = d.candidates.map(c => {
        const v = c.variant ? ' [' + c.variant + ']' : ''
        const q = c.on_hand === null ? 'stock unknown (lookup failed)' : c.on_hand + ' on hand'
        return '      -> ' + c.name + v + ' — ' + q
      })
      return '  ' + d.name + '\n' + lines.join('\n')
    })
    const ok = ask(
      'We may already have ' + (err.duplicates.length === 1 ? 'one of these' : 'some of these') + '.\n\n' +
      'About to add, and what already looks like it:\n' + blocks.join('\n') + '\n\n' +
      'If those ARE the same products, press CANCEL and use the existing SKUs. ' +
      'A second row splits the stock, and every count and cost for it is then ' +
      'computed on half the goods.\n\n' +
      'Press OK only if these are genuinely different products.'
    )
    if (!ok) {
      const e = new Error('Use the existing SKUs instead of adding a second set')
      e.code = 'DUPLICATE_CANCELLED'
      e.candidates = err.candidates
      throw e
    }
    return await upsertProducts(rows, { confirmedNotDuplicate: true })
  }
}

/** Ask before a bulk insert that does NOT go through createProduct.
 *
 *  Storefront Import writes its new products straight to the table because it
 *  needs the ids back in insertion order. Rather than reshape that, the same
 *  question is asked first — every door into `products` gets the same guard, or
 *  the guard is only as good as the door somebody happens to use.
 *
 *  Resolves silently when nothing looks like a duplicate.
 *  @throws {code:'DUPLICATE_CANCELLED'} when the user says we already have them
 */
export async function confirmNoDuplicates(rows, { confirm } = {}) {
  const ask = confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => false)
  const dupes = []
  for (const r of rows || []) {
    const candidates = await findSimilarProducts(r?.name, r || {})
    if (candidates.length > 0) dupes.push({ name: r.name, candidates })
  }
  if (dupes.length === 0) return

  const blocks = dupes.map(d => {
    const lines = d.candidates.map(c => {
      const v = c.variant ? ' [' + c.variant + ']' : ''
      const q = c.on_hand === null ? 'stock unknown (lookup failed)' : c.on_hand + ' on hand'
      return '      -> ' + c.name + v + ' — ' + q
    })
    return '  ' + d.name + '\n' + lines.join('\n')
  })
  const ok = ask(
    'We may already have ' + (dupes.length === 1 ? 'one of these' : 'some of these') + '.\n\n' +
    'About to add, and what already looks like it:\n' + blocks.join('\n') + '\n\n' +
    'If those ARE the same products, press CANCEL and map the import to the ' +
    'existing SKUs instead. A second row splits the stock, and every count and ' +
    'cost for it is then computed on half the goods.\n\n' +
    'Press OK only if these are genuinely different products.'
  )
  if (!ok) {
    const e = new Error('Map the import to the existing SKUs instead of adding new ones')
    e.code = 'DUPLICATE_CANCELLED'
    e.candidates = dupes.flatMap(d => d.candidates)
    throw e
  }
}
