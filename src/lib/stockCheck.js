// Stock Check rules, kept apart from the page so they can be tested alone.

export const ZONE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
export const ZONES = ZONE_LETTERS.flatMap(l => [1, 2, 3, 4, 5].map(n => `${l}${n}`))
export const ZONE_CAPACITY = 100          // Gary: a small zone holds about 100 singles
export const MAX_LOWERED_SHARE = 0.3      // more than this looks like an unfinished round, not a real loss
export const RECENT_SALE_DAYS = 3         // a copy sold this recently may still be on the shelf, waiting to be picked

// Compare John's scans with the app.
//   expected: Map id -> { qty, name }     stock when the round started
//   totals:   Map id -> scanned, all zones added up
//   rows:     Map id -> [{ id, quantity, status }]   read just now: this room's Pokemon rows
//   recentlySold: Set of ids sold in this room in the last RECENT_SALE_DAYS
// Sales and intakes go on during a round, and we can't tell whether they came
// before or after John scanned the card. A scan between the start number and the
// current number is therefore no difference. A scan outside it on a card that
// moved has no safe number, so a person looks. Only a card that did not move
// takes John's number. That also makes a second pass harmless: after a change,
// the current number is the scan, which is inside the band.
// A copy sold but not picked yet still gets scanned. Raising on that scan would put
// a sold copy back on sale, so a raise on a recently sold card goes to a person.
export function planStockFix({ expected, totals, rows, recentlySold = new Set() }) {
  const plan = { fixes: [], zeroed: [], people: [], extras: [], same: 0, movedOk: 0, totalNow: 0 }
  const ids = new Set(expected.keys())
  for (const [id, scanned] of totals) {
    if (scanned <= 0) continue
    if (rows.has(id)) ids.add(id)
    else plan.extras.push({ id, scanned })
  }
  for (const id of ids) {
    const rs = rows.get(id) || []
    const start = expected.get(id)?.qty ?? 0
    const now = rs.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
    const scanned = totals.get(id) || 0
    plan.totalNow += now
    const lo = Math.min(start, now)
    const hi = Math.max(start, now)
    if (scanned >= lo && scanned <= hi) {
      if (start === now) plan.same++
      else plan.movedOk++
      continue
    }
    const line = { id, name: expected.get(id)?.name || '', start, now, scanned, to: scanned }
    if (start !== now) {
      plan.people.push({ ...line, reason: 'stock moved during the round: scan it again' })
    } else if (rs.length !== 1) {
      plan.people.push({ ...line, reason: rs.length === 0 ? 'no stock row in this room' : `${rs.length} stock rows for this id` })
    } else if (rs[0].status !== 'in_inventory') {
      plan.people.push({ ...line, reason: `status is ${rs[0].status}` })
    } else if (scanned > now && recentlySold.has(id)) {
      plan.people.push({ ...line, reason: `sold in the last ${RECENT_SALE_DAYS} days: the extra copy may be waiting to ship` })
    } else if (scanned === 0) {
      plan.zeroed.push({ ...line, rowId: rs[0].id, rowQty: Number(rs[0].quantity) || 0 })
    } else {
      plan.fixes.push({ ...line, rowId: rs[0].id, rowQty: Number(rs[0].quantity) || 0 })
    }
  }
  return plan
}

export function loweredShare(plan, includeZeroed) {
  const lines = includeZeroed ? [...plan.fixes, ...plan.zeroed] : plan.fixes
  const lowered = lines.reduce((s, l) => s + Math.max(0, l.now - l.to), 0)
  return plan.totalNow > 0 ? lowered / plan.totalNow : 0
}

export function resultCsv(lines) {
  const header = ['group', 'id', 'card', 'app_at_start', 'app_before', 'scanned', 'changed_to', 'outcome', 'zones']
  const rows = lines.map(l => [l.group, l.id, l.name, l.start ?? '', l.now ?? '', l.scanned ?? '', l.to ?? '', l.outcome ?? '', l.zones ?? ''])
  const text = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  return '﻿' + text
}
