// Grading page rules (Will 2026-11-26, D-20261126-02), kept apart from the page so they can be tested alone.
// A Roca batch with labels comes back from Kevin; each label is scanned as 'grading' (Kevin keeps it) or 'stock'
// (goes into TCGplayer Singles, zone Unsorted, by the intake script afterwards). The label barcode is the TCGplayer id only.

export const DECISIONS = ['grading', 'stock']
export const DECISION_LABEL = { grading: 'Grading (Kevin)', stock: 'Stock / 入库' }

export const variantKey = (c) => `${c.printing || ''}|${c.condition || ''}|${c.language || ''}`
export const variantLabel = (c) => [c.printing, c.condition, c.language].filter(Boolean).join(' · ')

// What a scan of `id` does in this batch.
//   { kind: 'card', card }            one card to mark (the lowest seq not scanned yet)
//   { kind: 'choose', options }       the id is in the batch in two or more printings / conditions: the person picks one of those not
//                                     scanned yet, or 'none of these' (one more than the batch has); options = [{ key, label, card, left }]
//   { kind: 'extra', reason }         nothing left to mark: 'not_in_batch' (id not in the batch) or 'more_than_batch' (all its copies already scanned)
export function planScan(cards, id) {
  const all = cards.filter(c => c.tcg_id === id)
  if (all.length === 0) return { kind: 'extra', reason: 'not_in_batch' }
  const left = all.filter(c => !c.decision).sort((a, b) => a.seq - b.seq)
  if (left.length === 0) return { kind: 'extra', reason: 'more_than_batch' }
  const byVariant = new Map()
  for (const c of left) {
    const k = variantKey(c)
    if (!byVariant.has(k)) byVariant.set(k, { key: k, label: variantLabel(c) || '—', card: c, left: 0 })
    byVariant.get(k).left++
  }
  // Codex 11/26: decide on all versions of the id in the batch, not only the ones left. Two Holofoil scanned and a third Holofoil
  // scanned must not silently take the Reverse Holofoil copy: the person picks, or says it is one more than the batch has.
  if (new Set(all.map(variantKey)).size === 1) return { kind: 'card', card: left[0] }
  return { kind: 'choose', options: [...byVariant.values()] }
}

const money = (v) => Math.round((Number(v) || 0) * 100) / 100

// The batch's numbers, and what is written to grading_batches.result at finish.
export function batchSummary(cards, extras = []) {
  const s = { cards: cards.length, grading: 0, stock: 0, left: 0, gradingMarket: 0, stockMarket: 0, missing: [], extras: [] }
  for (const c of cards) {
    if (c.decision === 'grading') { s.grading++; s.gradingMarket += Number(c.market_usd) || 0 }
    else if (c.decision === 'stock') { s.stock++; s.stockMarket += Number(c.market_usd) || 0 }
    else { s.left++; s.missing.push({ seq: c.seq, tcg_id: c.tcg_id, name: c.card_name, number: c.card_number, printing: c.printing, market: c.market_usd }) }
  }
  s.gradingMarket = money(s.gradingMarket)
  s.stockMarket = money(s.stockMarket)
  s.gradingCost = money(s.gradingMarket * 0.8)   // D-20261120-30: cost of a card taken for grading = market x 80%
  s.missing.sort((a, b) => a.seq - b.seq)
  s.extras = extras.map(e => ({ tcg_id: e.tcg_id, decision: e.decision, reason: e.reason, at: e.scanned_at }))
  return s
}

export const REASON_LABEL = { not_in_batch: 'not in this batch / 批次里没有', more_than_batch: 'more copies than the batch has / 比批次多' }
