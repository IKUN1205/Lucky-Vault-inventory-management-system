// Put a breakable box's LOOSE PACK sibling on the count sheet, even at zero.
//
// Gary 2026-09-06, on Marvel Allegiance: "marvel这个可能是pack sku 拆了盒子变成
// pack了" — and he was right, which is how this rule got its evidence.
//
// THE FAILURE THIS FIXES
// ----------------------
// The count sheet lists rows with stock (plus a 48h grace on freshly-zeroed
// ones). A pack row that has been at zero for weeks is therefore absent — so a
// counter holding a fistful of loose packs has exactly one place to write the
// number: the BOX row, which is on the sheet. The book then reads the packs as
// surplus boxes.
//
// Measured, not theorised: 8 of the 24 open surpluses on 2026-09-06 were this
// shape, and 7 of those 8 had their pack sibling sitting at zero everywhere.
// Marvel Allegiance alone was reported +22 on the box row twenty-four times by
// four counters since 08-11, and priced at the box basis it read as $2,618
// against a true $81.84 — wrong by 32x, in the direction that makes it look
// like the biggest problem on the page.
//
// The 48h grace (shipped 2026-08-21) does not reach these: Marvel's pack row
// had been zero for five days, and rows that have NEVER held stock are never
// in the window at all.
//
// COST
// ----
// Bounded on purpose. Measured against the live rooms it adds 22 rows to 86
// (+25%), concentrated where the problem is (Packheads 29 -> 40). The obvious
// bigger rule — "anything moved into this room recently" — adds 67 and roughly
// doubles every sheet, which is the wrong trade for a person counting a shelf.

const STOP = new Set([
  'the', 'of', 'and', 'a', 'en', 'jp', 'cn', 'box', 'boxes', 'pack', 'packs',
  'loose', 'single', 'singles', 'display', 'case', 'booster', 'sealed',
  'collection', 'set', 'card', 'game', 'trading', 'cards', 'hobby',
])

export function tokens(name) {
  return new Set(
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP.has(t))
  )
}

// [EN]/[JP]/[CN] read off the name. null when the name says nothing — unknown
// is never treated as "same", so an unlabelled row is neither blocked nor used
// as proof. Without this an [EN] box adopts the [JP] pack row, because tokens()
// strips the brackets: the EN/JP mismatch this codebase has caught five times.
export function language(name) {
  const m = /\[(EN|JP|CN)\]/i.exec(String(name || ''))
  return m ? m[1].toUpperCase() : null
}

const years = s => new Set([...s].filter(t => /^(19|20)\d\d$/.test(t)))

export function isPackForm(product) {
  const n = String(product?.name || '').toLowerCase()
  return product?.type === 'Pack' || n.includes('loose pack') || /booster pack$/.test(n)
}

export function isBreakableBox(product) {
  return Boolean(product?.breakable) && Number(product?.packs_per_box) > 1
}

// Returns the pack product that belongs to this box, or null. Deliberately
// strict: a wrong sibling would route a pack count onto somebody else's SKU,
// which is worse than leaving the row off the sheet entirely.
export function findPackSibling(boxProduct, packProducts) {
  const want = tokens(boxProduct?.name)
  if (!want.size) return null
  const yb = years(want)
  const lb = language(boxProduct?.name)
  let best = null
  let bestScore = 0
  for (const p of packProducts) {
    if (p?.active === false) continue
    const t = tokens(p?.name)
    if (!t.size) continue
    // A year is a set identifier, not noise: "2024 Masterpieces XL" otherwise
    // matches the 2023 Allegiance pack row on upper/deck/marvel alone.
    const yp = years(t)
    if (yb.size && yp.size && ![...yb].some(y => yp.has(y))) continue
    const lp = language(p?.name)
    if (lb && lp && lb !== lp) continue
    let overlap = 0
    for (const w of want) if (t.has(w)) overlap += 1
    if (overlap < 2) continue
    const union = new Set([...want, ...t]).size
    const score = overlap / union
    if (score > bestScore) { bestScore = score; best = p }
  }
  // A weak best match is still a wrong match.
  return bestScore >= 0.5 ? best : null
}

// rows: what fetchInventoryForRoom already found. packProducts: candidate pack
// SKUs. makeRow: builds a zero-quantity row for a product not on the sheet.
//
// Returns the rows to ADD. Never mutates, never removes, and never adds a
// product that is already present — a duplicated line on a count sheet is its
// own kind of miscount.
export function packSiblingRows(rows, packProducts, makeRow) {
  const present = new Set((rows || []).map(r => r.product_id))
  const out = []
  for (const r of rows || []) {
    if (!isBreakableBox(r.product)) continue
    const sib = findPackSibling(r.product, packProducts)
    if (!sib || present.has(sib.id)) continue
    present.add(sib.id)                       // two boxes can share one sibling
    out.push(makeRow(sib, r))
  }
  return out
}

// Loose-pack rows that are ALWAYS on a room's count sheet, even at zero.
//
// Gary 2026-10-02 (F124, 「备注就是因为没有 sku」): Rockets breaks One Piece boxes into packs every show (RTYH), but none of
// these pack SKUs ever reached its sheet — the boxes are not linked to them by name ("Japanese OP 17 Booster Box" shares no
// word with "THE WORLD'S STRONGEST WARRIORS"), and a pack row that has never held stock in the room is never in the 48h
// window. So the counter wrote "OP-17 JP Packs 298 / EB-03 JP Packs 278 / OP-13 53 packs" into the notes, where no report
// can read them, and RTYH consumption could not be measured from counts at all.
//
// Listed by product id, not by name matching: a wrong row would route a pack count onto somebody else's SKU. A pinned row
// with no stock behaves like a sibling row: the count is recorded (stream_count_items.actual_qty), and because a count never
// creates inventory, a positive count shows up as "needs transfer-in" until the packs are booked by a break or a move.
export const PINNED_PACKS_BY_ROOM = {
  'Stream Room - TikTok RocketsHQ': [
    '4dc01fec-b577-48b3-8cd3-7d13efc5dc06', // LOOSE PACK · [JP] THE WORLD'S STRONGEST WARRIORS (JP OP-17)
    '047ce18c-f0cd-45b4-b477-09b788667511', // [JP] EB-03 Heroines Edition Booster Pack
    '9547821f-f426-47a9-a2e0-3ad835699a93', // [EN] OP-13 Carrying On His Will Booster Pack (the room's OP-13 boxes are EN)
    '703616c7-66e0-4e2d-b943-ac6395a64b22', // The World's Strongest Warriors Booster Pack (OP17) — EN OP-17
  ],
}

// Ids pinned for this room that are not already on the sheet.
export function pinnedPackIds(roomName, rows) {
  const want = PINNED_PACKS_BY_ROOM[String(roomName || '').trim()] || []
  const present = new Set((rows || []).map(r => r.product_id))
  return want.filter(id => !present.has(id))
}
