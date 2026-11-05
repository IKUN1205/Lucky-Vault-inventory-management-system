// Stock Check rules, kept apart from the page so they can be tested alone.

export const ZONE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
export const ZONES = ZONE_LETTERS.flatMap(l => [1, 2, 3, 4, 5].map(n => `${l}${n}`))
export const UNSORTED = 'Unsorted'        // Gary 11/05: Inventory has one big zone for cards not in a small zone yet
export const STORE_ZONE = 'Store'         // Gary 11/05: the store has no small zones, one big zone
export const ZONE_MAX = 120               // Gary: a small zone holds 100-120 singles; more means the zone needs checking again
export const BIG_ZONE_MAX = 500           // Gary 11/05: Unsorted and the store, for now
export const MAX_LOWERED_SHARE = 0.3      // more than this looks like a mistake, not a real loss
export const RECENT_SALE_DAYS = 3         // a copy sold this recently may still be on the shelf, waiting to be picked
export const isBigZone = (z) => z === UNSORTED || z === STORE_ZONE
export const zoneMax = (z) => (isBigZone(z) ? BIG_ZONE_MAX : ZONE_MAX)
export const isOverLimit = (z, count) => count > zoneMax(z)
export const dayOf = (at) => new Date(at).toLocaleDateString('en-CA')

// Gary 11/05: stock is kept by zone. A submit replaces only the zones submitted; every other zone keeps what
// it had, so a card spread over several zones does not read low in between.
//   submit:  Set of zones in this submit
//   scans:   Map "zone|id" -> qty      this round's scans
//   ledger:  Map "zone|id" -> { qty, at }   what each zone held when it was last submitted
//   rows:    Map id -> [{ id, quantity, status }]   read just now: this room's Pokemon rows
//   names:   Map id -> name
//   recentlySold: Set of ids sold in this room since the round began or in the last RECENT_SALE_DAYS, whichever is longer
//   movedIds: Set of ids moved between rooms since the round began: their scans may be older than the move
//   finishing: the round ends: also list cards holding more than all zones add up to
//
// Stock does not follow the zones' sum: sales and moves between rooms don't touch the ledger, so the sum of zones not scanned
// lately runs high by what left since, and a sum would put those copies back on sale.
//   rise: never by itself, because a scan cannot prove an extra copy exists (scanned twice, sold and not shipped). When the copies
//         counted in the submitted zones alone exceed stock, the card is listed and needs a box ticked. One more in A2 may be a
//         copy moved from a zone not submitted yet (Unsorted into A2 is the everyday case), so it is not even listed until then.
//         A submit holds every done zone of the round, so a real extra shows once that card's zones are all in.
//   drop: first takes up what the zones hold above stock (already left on the books). Only the rest is a drop.
// A drop reads the two numbers as they are now, so one sale can excuse one missing copy only: after it is taken up the zones no
// longer run high. Which zone a sold copy came from is not known, so a real loss here can be excused by a sale from another
// zone; it shows when that other zone is scanned.
export function planZoneSubmit({ submit, scans, ledger, rows, names = new Map(), recentlySold = new Set(), movedIds = new Set(), finishing = false }) {
  const plan = { fixes: [], zeroed: [], raised: [], people: [], extras: [], same: 0, soldOk: 0, filled: 0, totalNow: 0, changes: new Map(), hold: new Set(), holdUnlessTicked: new Set() }
  const split = (k) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)] }
  const scanOf = new Map()       // id -> { zone: qty } of the submitted zones
  const oldOf = new Map()        // id -> { zone: { qty, at } } of the submitted zones
  const othersOf = new Map()     // id -> copies in zones not in this submit
  for (const [k, q] of scans) {
    const [z, id] = split(k)
    if (!submit.has(z) || q <= 0) continue
    if (!scanOf.has(id)) scanOf.set(id, {})
    scanOf.get(id)[z] = q
  }
  for (const [k, v] of ledger) {
    const [z, id] = split(k)
    if (submit.has(z)) {
      if (!oldOf.has(id)) oldOf.set(id, {})
      oldOf.get(id)[z] = v
    } else {
      othersOf.set(id, (othersOf.get(id) || 0) + (Number(v.qty) || 0))
    }
  }
  const sum = (o, f) => Object.values(o || {}).reduce((s, v) => s + f(v), 0)
  const afterRow = new Map()     // id -> stock after this submit, for the finishing check
  for (const id of new Set([...scanOf.keys(), ...oldOf.keys()])) {
    const scan = scanOf.get(id) || {}
    const old = oldOf.get(id) || {}
    const zoneChanges = []
    for (const z of new Set([...Object.keys(scan), ...Object.keys(old)])) {
      if ((scan[z] || 0) !== (Number(old[z]?.qty) || 0)) zoneChanges.push({ zone: z, qty: scan[z] || 0 })
    }
    if (zoneChanges.length) plan.changes.set(id, zoneChanges)
    const newZ = sum(scan, v => v)
    const oldZ = sum(old, v => Number(v.qty) || 0)
    const others = othersOf.get(id) || 0
    const d = newZ - oldZ
    const rs = rows.get(id) || []
    const now = rs.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
    const name = names.get(id) || ''
    if (!rs.length) {
      if (newZ > 0) plan.extras.push({ id, scanned: newZ, name })
      continue
    }
    const line = { id, name, start: oldZ, now, scanned: newZ, others, to: now }
    let to = now
    if (newZ > now && d >= 0) to = newZ
    else if (d < 0) to = Math.max(0, now - Math.max(0, -d - Math.max(0, others + oldZ - now)))
    // These scans may be older than the sale or the move, so they prove nothing. Unchanged zones have nothing new to say.
    const doubt = recentlySold.has(id) ? `sold in the last ${RECENT_SALE_DAYS} days or this round: the extra copy may be waiting to ship`
      : movedIds.has(id) ? 'moved between rooms during this round: scan it again' : null
    if (to > now && doubt && d === 0) to = now
    if (to === now) {
      if (d > 0) plan.filled++
      else if (d < 0) plan.soldOk++
      else plan.same++
      afterRow.set(id, now)
      continue
    }
    const l = { ...line, to }
    const hold = (reason) => { plan.people.push({ ...l, reason }); plan.hold.add(id); afterRow.set(id, now) }
    if (rs.length !== 1) hold(`${rs.length} stock rows for this id`)
    else if (rs[0].status !== 'in_inventory') hold(`status is ${rs[0].status}`)
    else if (to > now && doubt) hold(doubt)
    else if (finishing && to < now && movedIds.has(id)) hold('moved between rooms during this round: scan it again')
    else if (to > now) {
      plan.raised.push({ ...l, rowId: rs[0].id, rowQty: now })
      plan.holdUnlessTicked.add(id)
      afterRow.set(id, now)
    } else if (to === 0) {
      plan.zeroed.push({ ...l, rowId: rs[0].id, rowQty: now })
      plan.holdUnlessTicked.add(id)
      afterRow.set(id, now)
    } else {
      plan.fixes.push({ ...l, rowId: rs[0].id, rowQty: now })
      afterRow.set(id, to)
    }
  }
  plan.totalNow = [...rows.values()].flat().reduce((s, r) => s + (Number(r.quantity) || 0), 0)
  if (finishing) {
    // The whole room has been through: copies no zone holds are listed, and need the box ticked like a card going to 0.
    const totalOf = (id) => others(id) + sum(scanOf.get(id), v => v)
    const others = (id) => othersOf.get(id) || 0
    for (const [id, rs] of rows) {
      if (plan.hold.has(id) || plan.holdUnlessTicked.has(id)) continue
      const now = rs.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
      const cur = afterRow.has(id) ? afterRow.get(id) : now
      const held = totalOf(id)
      if (cur <= held) continue
      const l = { id, name: names.get(id) || '', start: 0, now: cur, scanned: held, others: others(id), to: held }
      if (movedIds.has(id)) {
        const fix = plan.fixes.findIndex(f => f.id === id)
        if (fix >= 0) plan.fixes.splice(fix, 1)
        plan.people.push({ ...l, reason: 'moved between rooms during this round: scan it again' })
        plan.hold.add(id)
        continue
      }
      if (rs.length !== 1) { plan.people.push({ ...l, reason: `${rs.length} stock rows for this id` }); plan.hold.add(id); continue }
      if (rs[0].status !== 'in_inventory') { plan.people.push({ ...l, reason: `status is ${rs[0].status}` }); plan.hold.add(id); continue }
      const already = plan.fixes.findIndex(f => f.id === id)
      if (already >= 0) plan.fixes.splice(already, 1)
      plan.zeroed.push({ ...l, now, rowId: rs[0].id, rowQty: now })
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
  const header = ['group', 'id', 'card', 'zones_before', 'app_before', 'zones_scanned', 'other_zones', 'changed_to', 'outcome', 'zones']
  const rows = lines.map(l => [l.group, l.id, l.name, l.start ?? '', l.now ?? '', l.scanned ?? '', l.others ?? '', l.to ?? '', l.outcome ?? '', l.zones ?? ''])
  const text = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  return '﻿' + text
}
