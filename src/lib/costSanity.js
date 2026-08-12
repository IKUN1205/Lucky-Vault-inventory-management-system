// Does this intake line's per-unit cost agree with what we already paid?
//
// The 2026-06-13 FB03 purchase went in as "60 units, cost 140" — a $140 per-box
// price typed into a whole-line total. Inventory has carried those boxes at
// $2.33 ever since, against a $161 market, which made the Shopify listing read
// as a 7,300% margin. A sweep of intakes recorded before the per-unit/total
// toggle shipped (2026-06-24) found 38 rows with the same signature and about
// $104k of understated purchase totals.
//
// Kept as a pure function, separate from the page, so the tests exercise the
// code that actually runs rather than a copy of it that drifts.

// How far a unit cost may drift from precedent before we ask. Prices really do
// move and a good buy is not an error, so the band is loose on purpose: this is
// here for order-of-magnitude mistakes. FB03 was off by 60x.
export const COST_LOW = 1 / 3
export const COST_HIGH = 3

// Per-unit cost of a line, regardless of how it was entered. `price_mode`
// 'unit' means the number IS the per-unit price; 'total' means divide by qty.
//
// `toUsd` converts the entered amount into the currency the references are
// held in. Purchases are entered in USD, YEN or RMB while avg_cost_basis and
// cost_usd are always USD, so comparing the raw number would read a ¥18,000
// box against a $120 basis as a 150x error and hard-block every single yen
// line. Optional so the pure-arithmetic tests can call it without a rate.
export function unitCostOf(item, toUsd = null) {
  const raw = parseFloat(item?.cost) || 0
  if (!(raw > 0)) return 0
  const entered = toUsd ? (Number(toUsd(raw)) || 0) : raw
  if (!(entered > 0)) return 0
  const qty = parseInt(item?.quantity) || 0
  if (item?.price_mode === 'unit') return entered
  return qty > 0 ? entered / qty : entered
}

// Markers written into acquisitions.notes. There is no column for review state
// and no way to add one right now, so the note carries it — the same trick
// RECOVERED_AT_COUNTER uses on the storefront side. Both are greppable.
export const NOTE_FLAGGED = 'COST_FLAGGED'        // out of band, staff sent it to us
export const NOTE_UNVERIFIED = 'COST_UNVERIFIED'  // nothing existed to judge against

// Does this line have anything to be judged against at all?
export function referenceFor(item, ref = {}) {
  const r = ref?.[item?.product_id]
  if (!r) return null
  const basis = (r.basis != null && r.basis > 0) ? r.basis : null
  const known = basis ?? ((r.lastUnit > 0) ? r.lastUnit : null)
  if (!(known > 0)) return null
  return { known, source: basis ? 'inventory' : 'last purchase', units: r.units, lastDate: r.lastDate }
}

// Lines we could not judge — a cost was entered but nothing exists to compare
// it to.
//
// These must not pass silently. FB03 is the proof: on 2026-06-13 it was a
// first-ever purchase, so there was no prior stock and no prior intake, and a
// gate that stays quiet without a reference would have waved through the exact
// row it was built to catch. Blocking them instead is not an option either —
// every genuinely new product would stall — so they are recorded and raised
// with us to price.
export function unreferencedLines(items = [], ref = {}, opts = {}) {
  const out = []
  items.forEach((item, idx) => {
    if (!item?.product_id) return
    const unit = unitCostOf(item, opts.toUsd)
    if (!(unit > 0)) return
    if (referenceFor(item, ref)) return
    out.push({ index: idx, num: idx + 1, product_id: item.product_id, unit })
  })
  return out
}

// Lines that disagree with precedent by more than the band.
export function costOutlierLines(items = [], ref = {}, opts = {}) {
  const low = opts.low ?? COST_LOW
  const high = opts.high ?? COST_HIGH
  const out = []
  items.forEach((item, idx) => {
    if (!item?.product_id) return
    const unit = unitCostOf(item, opts.toUsd)
    // A zero/blank cost is the other guard's business; flagging it here would
    // stack two dialogs on the same line.
    if (!(unit > 0)) return
    const r = referenceFor(item, ref)
    if (!r) return
    const ratio = unit / r.known
    if (ratio >= low && ratio <= high) return
    out.push({
      index: idx,
      num: idx + 1,
      product_id: item.product_id,
      unit,
      known: r.known,
      ratio,
      units: r.units,
      lastDate: r.lastDate,
      source: r.source,
    })
  })
  return out
}
