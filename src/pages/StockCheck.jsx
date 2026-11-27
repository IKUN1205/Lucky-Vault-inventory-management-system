import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, MapPin, Play, ScanLine, Search } from 'lucide-react'
import { changeZoneQtyAt, fetchLocations, listStockPendingSales, moveStockBetweenRooms, resolveStockPending, supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import { MAX_LOWERED_SHARE, RECENT_SALE_DAYS, STOCK_BRANDS, STORE_ZONE, UNSORTED, ZONES, ZONE_GROUPS, dayOf, isBigZone, isOverLimit, labelId, loweredShare, planZoneSubmit, resultCsv, zoneLabel, zoneMax, zoneState } from '../lib/stockCheck'

// Stock Check: John scans the singles zone by zone (Pokemon, One Piece, Dragon Ball). Inventory: A1..J5, the game zones and Unsorted. Store: one big zone.
// Where he scans a card is where the system says it is. He can submit the zones he has finished at any time:
// only those zones are replaced, the others keep what they had (stock_zone_qty). Sales and intake go on as usual.
// Tables: scripts/create_stock_check_tables.sql. Rules: src/lib/stockCheck.js.

const PAGE = 1000

// Gary 2026-11-04: singles stock is only these two.
const INVENTORY_ROOM = '6d89a23e-c250-4dcd-81cf-2b4dd26c7592'
const STORE_ROOM = 'c4cf3dab-94d7-4c2c-a4b4-214977feec06'
const STOCK_ROOMS = [
  { id: INVENTORY_ROOM, label: 'Inventory (TCGplayer Singles)' },
  { id: STORE_ROOM, label: 'Storefront (Front Store)' },
]
// Gary 11/05: copies can move between these two, from Find a card.
const MOVE_TO = {
  [INVENTORY_ROOM]: { id: STORE_ROOM, label: 'Storefront / 门店' },
  [STORE_ROOM]: { id: INVENTORY_ROOM, label: 'Inventory / 后面' },
}

// Gary 11/05: a search says where a card is in the words people use.
const ROOM_LABEL = { [INVENTORY_ROOM]: 'Inventory / 后面', [STORE_ROOM]: 'Storefront / 门店' }

// A count of this room started or finished since a time. A minute's margin for the two clocks.
async function countSince(at, locationId) {
  const since = new Date(at - 60000).toISOString()
  const { data, error } = await supabase.from('stock_check_rounds').select('id').eq('location_id', locationId)
    .or(`started_at.gte.${since},finished_at.gte.${since}`).limit(1)
  if (error) throw error
  return data?.length > 0
}

async function readAllPages(build) {
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) return all
  }
}

// This room's rows of the games checked, including rows at 0 from an earlier round.
async function readRoomRows(locationId) {
  const data = await readAllPages(() => supabase
    .from('singles')
    .select('id, tcg_id, quantity, status, card_name, card_number, language')
    .eq('location_id', locationId)
    .in('brand', STOCK_BRANDS)
    .neq('status', 'sold')
    .eq('deleted', false)
    .not('tcg_id', 'is', null)
    .order('id'))
  const rows = new Map()
  for (const r of data) {
    const id = String(r.tcg_id).trim()
    if (!id) continue
    if (!rows.has(id)) rows.set(id, [])
    rows.get(id).push(r)
  }
  return rows
}

// What each zone of this room held when it was last submitted. Map "zone|id" -> { qty, at }
async function readLedger(locationId) {
  const data = await readAllPages(() => supabase.from('stock_zone_qty').select('zone, tcg_id, qty, scanned_at').eq('location_id', locationId).order('zone').order('tcg_id'))
  return new Map(data.map(r => [`${r.zone}|${r.tcg_id}`, { qty: r.qty, at: r.scanned_at }]))
}

// Copies each zone of this room holds by its records: zone -> qty. For the colours of the zone grid.
async function readHeld(locationId) {
  const data = await readAllPages(() => supabase.from('stock_zone_qty').select('zone, tcg_id, qty').eq('location_id', locationId).order('zone').order('tcg_id'))
  const held = new Map()
  for (const r of data) held.set(r.zone, (held.get(r.zone) || 0) + (Number(r.qty) || 0))
  return held
}

// Ids of this room with a move between rooms since a time. The audit log is keyed by row, so rows says which id it was.
async function readMovedIds(rows, since) {
  const data = await readAllPages(() => supabase.from('singles_audit_log').select('id, single_id, payload').eq('event_type', 'moved').gte('acted_at', since).order('id'))
  const idOfRow = new Map()
  for (const [id, rs] of rows) for (const r of rs) idOfRow.set(r.id, id)
  // Some moves log only the source row and name the other end in the payload.
  return new Set(data.flatMap(d => [idOfRow.get(d.single_id), idOfRow.get(d.payload?.dest_single_id)]).filter(Boolean))
}

// Id -> its last move between rooms, as far back as the oldest zone record of this room.
async function readLastMoves(rows, ledger) {
  const times = [...ledger.values()].map(v => v.at).filter(Boolean).sort()
  if (!times.length) return new Map()
  const data = await readAllPages(() => supabase.from('singles_audit_log').select('id, single_id, payload, acted_at').eq('event_type', 'moved').gte('acted_at', times[0]).order('id'))
  const idOfRow = new Map()
  for (const [id, rs] of rows) for (const r of rs) idOfRow.set(r.id, id)
  const last = new Map()
  for (const d of data) {
    for (const id of [idOfRow.get(d.single_id), idOfRow.get(d.payload?.dest_single_id)]) {
      if (id && (!last.has(id) || new Date(d.acted_at) > new Date(last.get(id)))) last.set(id, d.acted_at)
    }
  }
  return last
}

// Will 2026-11-20「2次没扫到的直接删 假如扫到了再加回去」: ids listed as not found in this room's last finished round and left unchanged.
// Not found again now: they go to the number found without the box. Rows are never deleted: stock goes to 0.
async function readLastMissed(locationId) {
  const { data, error } = await supabase.from('stock_check_rounds').select('result').eq('location_id', locationId).eq('status', 'applied')
    .order('finished_at', { ascending: false }).limit(1)
  if (error) throw error
  const lines = data?.[0]?.result?.lines || []
  return new Set(lines.filter(l => l.group === 'needs the box ticked' && !String(l.outcome || '').startsWith('changed')).map(l => String(l.id)))
}

// Rows whose last logged change is a stock check taking them to 0: found again, they go back up without the box.
async function readZeroedByCheck(rowIds) {
  const out = new Set()
  for (let i = 0; i < rowIds.length; i += 100) {
    const data = await readAllPages(() => supabase.from('singles_audit_log').select('id, single_id, payload, acted_at').in('single_id', rowIds.slice(i, i + 100)).order('acted_at').order('id'))
    const last = new Map()
    for (const d of data) last.set(d.single_id, d)     // ordered by time: the last one wins
    for (const [rowId, d] of last) if (d.payload?.stock_check && Number(d.payload.after) === 0) out.add(rowId)
  }
  return out
}

// Ids sold from this room in the last few days, or since the round began: their copy may still be here, or a scan may be older than the sale.
async function readRecentlySold(locationId, roundStart) {
  const days = new Date(Date.now() - RECENT_SALE_DAYS * 86400000).toLocaleDateString('en-CA')
  const began = dayOf(roundStart)
  const since = began < days ? began : days
  const data = await readAllPages(() => supabase
    .from('singles')
    .select('id, tcg_id')
    .eq('location_id', locationId)
    .in('brand', STOCK_BRANDS)
    .eq('status', 'sold')
    .gte('sale_date', since)
    .not('tcg_id', 'is', null)
    .order('id'))
  return new Set(data.map(r => String(r.tcg_id).trim()))
}

// Will 2026-11-20 (D-20261120-32): singles with a market under $2 are not listed online. Stock Check shows them in red;
// after the zone is submitted the office takes them out and checks them out in Mystery Game. Display only: nothing here writes.
// That checkout is a sale from this room, so a later submit or the finish sees a recent sale and does not add the copies back.
const TAKE_OUT_UNDER = 2

const cardName = (r) => [r.card_name, r.card_number, r.language === 'EN' ? '' : r.language].filter(Boolean).join(' ')

// The take-out list as a file: zone, id, card, market, copies.
function downloadTakeOut(list, nameOf, locationName) {
  const rows = [['zone', 'id', 'card', 'market', 'copies'], ...list.map(l => [zoneLabel(l.zone), l.id, nameOf(l.id), l.m.toFixed(2), l.qty])]
  const text = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `take-out-under-${TAKE_OUT_UNDER}_${(locationName || 'room').replace(/[^\w-]+/g, '-')}_${new Date().toLocaleDateString('en-CA')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(lines, locationName) {
  const url = URL.createObjectURL(new Blob([resultCsv(lines)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `stock-check_${(locationName || 'room').replace(/[^\w-]+/g, '-')}_${new Date().toLocaleDateString('en-CA')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function StockCheck() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const [locations, setLocations] = useState([])
  const [locationId, setLocationId] = useState('')
  const [loading, setLoading] = useState(false)
  const [round, setRound] = useState(null)
  const [lastRound, setLastRound] = useState(null)
  const [scans, setScans] = useState(new Map())       // "zone|id" -> qty
  const [zoneHeld, setZoneHeld] = useState(new Map())  // zone -> copies its records hold (stock_zone_qty), for the colour of the grid
  const [zone, setZone] = useState(null)
  const [scanInput, setScanInput] = useState('')
  const [lastScanId, setLastScanId] = useState(null)
  const [extraNames, setExtraNames] = useState({})    // id -> name of a scanned id outside the snapshot
  const [market, setMarket] = useState({})            // id -> market price of its live rows (highest), null = none; for the take-out list
  const marketAsked = useRef(new Set())
  const [marketTry, setMarketTry] = useState(0)   // "read again" for prices that failed
  const marketGen = useRef(0)       // a new room or round starts a new generation: older reads are dropped
  const [saveFailed, setSaveFailed] = useState(false)
  const [plan, setPlan] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [includeZeroed, setIncludeZeroed] = useState(false)
  const [includeRaised, setIncludeRaised] = useState(false)
  const [applying, setApplying] = useState(null)
  const [applyResult, setApplyResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const dirty = useRef(new Set())
  const scansRef = useRef(scans)
  const flushTimer = useRef(null)
  const flushing = useRef(null)
  const roundRef = useRef(null)
  const loadSeq = useRef(0)
  const heldSeq = useRef(0)       // reads of zoneHeld: the newest begun is the one shown
  const scanVersion = useRef(0)    // goes up with every scan, so a comparison made before it is thrown away
  const busyRef = useRef(false)    // one of compare, change stock, close, cancel at a time; no scanning during them
  scansRef.current = scans
  roundRef.current = round

  const beginOp = () => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    return true
  }
  const endOp = () => {
    busyRef.current = false
    setBusy(false)
  }

  const locationName = locations.find(l => l.id === locationId)?.name || ''
  const roomZones = locationId === INVENTORY_ROOM ? [...ZONES, UNSORTED] : [STORE_ZONE]
  // What the zone grid draws: the zones, with a heading per game and a label over a One Piece colour row.
  const gridItems = locationId === INVENTORY_ROOM
    ? [...ZONE_GROUPS.flatMap(g => [{ heading: g.name }, ...g.rows.flatMap(r => [...(r.label ? [{ label: r.label }] : []), ...r.zones])]), UNSORTED]
    : roomZones
  const expected = useMemo(() => new Map((round?.expected || []).map(e => [String(e.id), e])), [round])

  useEffect(() => {
    fetchLocations('Physical').then(all => setLocations(STOCK_ROOMS.flatMap(r => all.filter(l => l.id === r.id).map(l => ({ ...l, label: r.label }))))).catch(err => addToast(`Could not load rooms: ${err.message}`, 'error'))
  }, [])

  // Scans are written to the database a moment after they happen, as absolute
  // numbers, so a repeat is harmless. A failed write stays queued and on screen.
  const flush = useCallback(async () => {
    while (flushing.current) await flushing.current
    const roundId = roundRef.current?.id
    if (!roundId) return true
    if (dirty.current.size === 0) return true
    const keys = [...dirty.current]
    dirty.current.clear()
    const payload = keys.map(k => {
      const [z, id] = k.split('|')
      return { round_id: roundId, zone: z, tcg_id: id, qty: scansRef.current.get(k) || 0, updated_by_id: user?.id || null, updated_at: new Date().toISOString() }
    })
    const run = (async () => {
      const { error } = await supabase.from('stock_check_scans').upsert(payload, { onConflict: 'round_id,zone,tcg_id' })
      if (error) {
        if (roundRef.current?.id !== roundId) return false
        keys.forEach(k => dirty.current.add(k))
        setSaveFailed(true)
        clearTimeout(flushTimer.current)
        flushTimer.current = setTimeout(() => flush(), 5000)
        return false
      }
      setSaveFailed(false)
      return true
    })()
    flushing.current = run
    const ok = await run
    flushing.current = null
    return ok
  }, [user])

  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    const warn = (e) => {
      if (dirty.current.size > 0 || flushing.current) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      clearTimeout(flushTimer.current)
      flushRef.current()    // leaving for another page in the app: send what is waiting
    }
  }, [])

  const loadRoom = useCallback(async (id) => {
    const seq = ++loadSeq.current
    clearTimeout(flushTimer.current)
    dirty.current.clear()
    roundRef.current = null
    scanVersion.current++
    setSaveFailed(false)
    setRound(null); setScans(new Map()); setZoneHeld(new Map()); setZone(null); setPlan(null); setApplyResult(null); setLastRound(null); setLastScanId(null)
    marketGen.current++; marketAsked.current = new Set(); setMarket({})
    if (!id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data: open, error } = await supabase.from('stock_check_rounds').select('*').eq('location_id', id).eq('status', 'open').maybeSingle()
      if (error) throw error
      if (seq !== loadSeq.current) return
      // What each zone's records hold, for the colours; read before a round is started too, so a new round has them.
      const ht = ++heldSeq.current
      const held = await readHeld(id)
      if (seq !== loadSeq.current) return
      if (ht === heldSeq.current) setZoneHeld(held)
      if (open) {
        const saved = await readAllPages(() => supabase.from('stock_check_scans').select('zone, tcg_id, qty').eq('round_id', open.id).order('zone').order('tcg_id'))
        if (seq !== loadSeq.current) return
        setScans(new Map(saved.filter(s => s.qty > 0).map(s => [`${s.zone}|${s.tcg_id}`, s.qty])))
        setRound(open)
      } else {
        const { data: last, error: lastErr } = await supabase.from('stock_check_rounds').select('id, finished_at, result').eq('location_id', id).eq('status', 'applied').order('finished_at', { ascending: false }).limit(1)
        if (lastErr) throw lastErr
        if (seq !== loadSeq.current) return
        setLastRound(last?.[0] || null)
      }
    } catch (err) {
      if (seq === loadSeq.current) addToast(`Could not load this room: ${err.message}`, 'error')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [])

  const startRound = async () => {
    setLoading(true)
    try {
      const rows = await readRoomRows(locationId)
      const snapshot = []
      for (const [id, rs] of rows) {
        const qty = rs.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
        if (qty > 0) snapshot.push({ id, qty, name: cardName(rs[0]) })
      }
      snapshot.sort((a, b) => a.name.localeCompare(b.name))
      const { data, error } = await supabase.from('stock_check_rounds')
        .insert({ location_id: locationId, expected: snapshot, started_by_id: user?.id || null })
        .select('*').single()
      if (error) throw error
      setRound(data); setScans(new Map()); setLastRound(null)
      marketGen.current++; marketAsked.current = new Set(); setMarket({})
      addToast(`Round started: ${snapshot.length} cards in the app here`, 'success')
    } catch (err) {
      addToast(`Could not start the round: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const cancelRound = async () => {
    if (!confirm('Cancel this round? Stock does not change, and the scans of this round stop counting.')) return
    if (!beginOp()) return
    try {
      if (!(await flush())) { addToast('Scans could not be saved yet. Try again in a moment.', 'error'); return }
      const { error } = await supabase.from('stock_check_rounds').update({ status: 'cancelled', finished_at: new Date().toISOString(), finished_by_id: user?.id || null }).eq('id', round.id)
      if (error) { addToast(`Could not cancel: ${error.message}`, 'error'); return }
      await loadRoom(locationId)
    } finally {
      endOp()
    }
  }

  // ─── Totals ─────────────────────────────────────────────────────────
  const { totals, zoneCounts, zonesById } = useMemo(() => {
    const t = new Map(); const zc = new Map(); const by = new Map()
    for (const [k, qty] of scans) {
      if (qty <= 0) continue
      const [z, id] = k.split('|')
      t.set(id, (t.get(id) || 0) + qty)
      zc.set(z, (zc.get(z) || 0) + qty)
      if (!by.has(id)) by.set(id, [])
      by.get(id).push(`${z}×${qty}`)
    }
    return { totals: t, zoneCounts: zc, zonesById: by }
  }, [scans])
  const scannedUnits = useMemo(() => [...totals.values()].reduce((s, n) => s + n, 0), [totals])
  const expectedUnits = useMemo(() => [...expected.values()].reduce((s, e) => s + e.qty, 0), [expected])
  const zonesDone = useMemo(() => new Set(round?.zones_done || []), [round])

  const nameOf = (id) => expected.get(id)?.name || extraNames[id] || ''

  // Market price of every scanned id, read once per id. A read that fails is asked again on the next scan.
  useEffect(() => {
    const ids = [...totals.keys()].filter(id => !marketAsked.current.has(id))
    if (!ids.length) return
    ids.forEach(id => marketAsked.current.add(id))
    const gen = marketGen.current
    ;(async () => {
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100)
        let data
        try {
          data = await readAllPages(() => supabase.from('singles').select('id, tcg_id, current_market_price_usd')
            .in('tcg_id', part).eq('deleted', false).neq('status', 'sold').order('id'))
        } catch {
          if (gen === marketGen.current) part.forEach(id => marketAsked.current.delete(id))
          continue
        }
        if (gen !== marketGen.current) return
        const got = Object.fromEntries(part.map(id => [id, null]))
        for (const r of data || []) {
          const m = Number(r.current_market_price_usd)
          const id = String(r.tcg_id).trim()
          if (m > 0 && (got[id] === null || m > got[id])) got[id] = m
        }
        setMarket(prev => ({ ...prev, ...got }))
      }
    })()
  }, [totals, marketTry])
  // Scanned ids whose price is not read yet (still reading, or the read failed): the list is not complete until this is 0.
  const unpriced = [...totals.keys()].filter(id => market[id] === undefined).length
  const cheap = (id) => market[id] != null && market[id] < TAKE_OUT_UNDER
  // Every scanned copy under $2 in this round, zone by zone in grid order.
  const takeOut = useMemo(() => {
    const out = []
    for (const [k, q] of scans) {
      const [z, id] = k.split('|')
      if (q > 0 && market[id] != null && market[id] < TAKE_OUT_UNDER) out.push({ zone: z, id, qty: q, m: market[id] })
    }
    const at = (z) => { const i = ZONES.indexOf(z); return i < 0 ? 9999 : i }
    return out.sort((a, b) => at(a.zone) - at(b.zone) || a.id.localeCompare(b.id))
  }, [scans, market])

  // ─── Scanning ───────────────────────────────────────────────────────
  const changeScan = (z, id, delta) => {
    const key = `${z}|${id}`
    setScans(prev => {
      const n = new Map(prev)
      const next = (n.get(key) || 0) + delta
      if (next <= 0) n.delete(key)
      else n.set(key, next)
      return n
    })
    dirty.current.add(key)
    scanVersion.current++
    // A scan reopens a finished zone: it is not submitted until it is finished again.
    if ((roundRef.current?.zones_done || []).includes(z)) {
      const done = roundRef.current.zones_done.filter(x => x !== z)
      setRound(r => ({ ...r, zones_done: done }))
      supabase.from('stock_check_rounds').update({ zones_done: done }).eq('id', roundRef.current.id)
        .then(({ error }) => { if (error) addToast(`Could not reopen ${zoneLabel(z)}: ${error.message}`, 'error') })
    }
    clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(() => flush(), 1500)
    setPlan(null); setApplyResult(null)
  }

  const onScan = () => {
    const id = labelId(scanInput)
    setScanInput('')
    if (!id || !zone) return
    changeScan(zone, id, 1)
    setLastScanId(id)
    if (!expected.has(id) && extraNames[id] === undefined) {
      setExtraNames(prev => ({ ...prev, [id]: '' }))
      supabase.from('singles').select('card_name, card_number, language').eq('tcg_id', id).eq('deleted', false).limit(1)
        .then(({ data }) => { if (data?.[0]) setExtraNames(prev => ({ ...prev, [id]: cardName(data[0]) })) })
    }
    setTimeout(() => inputRef.current?.focus(), 20)
  }

  const undoScan = (z, id) => {
    changeScan(z, id, -1)
    setTimeout(() => inputRef.current?.focus(), 20)
  }

  const openZone = async (z) => {
    await flush()
    setZone(z)
    setLastScanId(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const overfull = () => roomZones.filter(z => isOverLimit(z, zoneCounts.get(z) || 0))

  // Read from the scans themselves: a scan can land while the save below is waiting.
  const zoneOver = (z) => {
    let n = 0
    for (const [k, q] of scansRef.current) if (k.startsWith(`${z}|`)) n += q
    if (!isOverLimit(z, n)) return false
    addToast(`${zoneLabel(z)} has more than ${zoneMax(z)} cards. Check this zone again. / 超过 ${zoneMax(z)} 张，请重新检查`, 'error')
    return true
  }

  const finishZone = async () => {
    if (zoneOver(zone)) return
    const ok = await flush()
    if (!ok) { addToast('Scans could not be saved yet. Try again in a moment.', 'error'); return }
    if (zoneOver(zone)) return
    // Nothing scanned, but the records say this zone holds cards: done means it really is empty, and the next submit empties it.
    const scannedHere = [...scansRef.current].some(([k, q]) => q > 0 && k.startsWith(`${zone}|`))
    if (!scannedHere) {
      const { data: held, error: heldErr } = await supabase.from('stock_zone_qty').select('qty').eq('location_id', round.location_id).eq('zone', zone)
      if (heldErr) { addToast(`Could not read this zone's records: ${heldErr.message}`, 'error'); return }
      const n = (held || []).reduce((s, h) => s + (Number(h.qty) || 0), 0)
      if (n > 0 && !confirm(`Nothing scanned in ${zoneLabel(zone)}, but the records show ${n} cards here. Is it really empty? OK = mark it empty. Cancel = keep its records.\n${zoneLabel(zone)} 没扫到东西，但记录有 ${n} 张。确实空了吗？确定 = 记为空；取消 = 保留记录。`)) return
    }
    const done = [...new Set([...(round.zones_done || []), zone])]
    const { error } = await supabase.from('stock_check_rounds').update({ zones_done: done }).eq('id', round.id)
    if (error) { addToast(`Could not mark the zone done: ${error.message}`, 'error'); return }
    setRound(r => ({ ...r, zones_done: done }))
    const next = isBigZone(zone) ? null : ZONES[ZONES.indexOf(zone) + 1]     // the big zones are a pass of their own
    if (next) await openZone(next)
    else setZone(null)
  }

  // ─── Submit: compare, confirm, change stock ────────────────────────
  // finishing = false: the finished zones go in, the round stays open. true: same, and the round ends.
  const checkDifferences = async (finishing) => {
    if (overfull().length) {
      addToast(`Too many cards in ${overfull().join(', ')}. Check again first. / 超过上限，请先重新检查`, 'error')
      return
    }
    if (!beginOp()) return
    setPlanning(true)
    const version = scanVersion.current
    try {
      const ok = await flush()
      if (!ok) throw new Error('Some scans are not saved yet')
      setZone(null)
      const ledger = await readLedger(locationId)
      const withRecords = new Set([...ledger.keys()].map(k => k.split('|')[0]))
      const withScans = new Set(roomZones.filter(z => (zoneCounts.get(z) || 0) > 0))
      // A done zone with records and no scans was confirmed empty in finishZone: a scan would have reopened it.
      const submit = new Set(roomZones.filter(z => zonesDone.has(z) && (withScans.has(z) || withRecords.has(z))))
      const unfinished = [...withScans].filter(z => !zonesDone.has(z))
      if (finishing && unfinished.length) {
        addToast(`Finish ${unfinished.map(zoneLabel).join(', ')} first. / 先点这些小区的完成：${unfinished.map(zoneLabel).join(', ')}`, 'error')
        return
      }
      if (!finishing && submit.size === 0) {
        addToast('No finished zone with scans yet. Press done on a zone first. / 还没有扫完的小区，先点小区完成', 'error')
        return
      }
      const [rows, recentlySold] = await Promise.all([readRoomRows(locationId), readRecentlySold(locationId, round.started_at)])
      const movedIds = await readMovedIds(rows, round.started_at)
      const movedAt = await readLastMoves(rows, ledger)
      const names = new Map([...rows].map(([id, rs]) => [id, cardName(rs[0])]))
      for (const [id, e] of expected) if (!names.has(id)) names.set(id, e.name)
      const p = planZoneSubmit({ submit, scans, ledger, rows, names, recentlySold, movedIds, movedAt, finishing })
      // Not found two rounds running: changed without the box. Taken to 0 by a stock check and scanned again: put back without the box.
      const missedBefore = await readLastMissed(locationId)
      const zeroedRows = await readZeroedByCheck(p.raised.filter(l => l.now === 0).map(l => l.rowId))
      // Will 11/26「这些如果在下一次check的时候没有发现 就清空」: at the end of a whole round, copies no zone record holds and
      // the round did not find go to the number found without the box, like cards not found two rounds running.
      const autoZero = p.zeroed.filter(l => missedBefore.has(l.id) || l.unheld)
      const autoBack = p.raised.filter(l => l.now === 0 && zeroedRows.has(l.rowId))
      p.zeroed = p.zeroed.filter(l => !autoZero.includes(l))
      p.raised = p.raised.filter(l => !autoBack.includes(l))
      p.auto = [...autoZero.map(l => ({ ...l, reason: l.unheld ? 'no zone record, not found this round / 没有分区记录，这轮也没扫到' : 'not found last round either / 上一轮也没扫到' })), ...autoBack.map(l => ({ ...l, reason: 'set to 0 by a stock check, found again / 之前核对改成 0，又扫到了' }))]
      p.auto.forEach(l => p.holdUnlessTicked.delete(l.id))
      if (p.extras.length) {
        const ids = p.extras.map(e => e.id)
        const found = {}
        for (let i = 0; i < ids.length; i += 100) {
          const data = await readAllPages(() => supabase.from('singles')
            .select('tcg_id, card_name, card_number, language, quantity, location:locations(name)')
            .in('tcg_id', ids.slice(i, i + 100)).neq('status', 'sold').eq('deleted', false).gt('quantity', 0).order('id'))
          for (const r of data) {
            const f = found[r.tcg_id] || (found[r.tcg_id] = { name: cardName(r), places: [] })
            f.places.push(`${r.location?.name || 'no location'} ×${r.quantity}`)
          }
        }
        p.extras = p.extras.map(e => ({ ...e, name: found[e.id]?.name || '', where: found[e.id] ? `app has it at: ${found[e.id].places.join(', ')}` : 'no live stock in the app' }))
      }
      if (version !== scanVersion.current) {
        addToast('You scanned while it was comparing. Press submit again.', 'error')
        return
      }
      setPlan({ ...p, version, finishing, submit: [...submit], unfinished, ledger })
      setIncludeZeroed(false)
      setIncludeRaised(false)
      setApplyResult(null)
    } catch (err) {
      addToast(`Could not compare: ${err.message}`, 'error')
    } finally {
      setPlanning(false)
      endOp()
    }
  }

  const share = plan ? loweredShare({ ...plan, fixes: [...plan.fixes, ...plan.auto] }, includeZeroed) : 0
  const blocked = share > MAX_LOWERED_SHARE
  const planLines = plan ? [...plan.fixes, ...plan.auto, ...(includeZeroed ? plan.zeroed : []), ...(includeRaised ? plan.raised : [])] : []

  const resultLines = (outcomes) => {
    if (!plan) return []
    const zones = (id) => (zonesById.get(id) || []).join(' ')
    const line = (group, l, outcome) => ({ group, ...l, zones: zones(l.id), outcome, rowId: undefined, rowQty: undefined })
    return [
      ...plan.fixes.map(l => line('difference', l, outcomes?.[l.id] || 'not changed')),
      ...plan.auto.map(l => line(l.to < l.now ? (l.unheld ? 'no zone record, not found' : 'not found twice') : 'found again after 0', l, outcomes?.[l.id] || 'not changed')),
      ...plan.zeroed.map(l => line('needs the box ticked', l, outcomes?.[l.id] || 'not changed')),
      ...plan.raised.map(l => line('counted more, needs the box ticked', l, outcomes?.[l.id] || 'not changed')),
      ...plan.people.map(l => line('needs a person', { ...l, name: l.name }, l.reason)),
      ...plan.extras.map(l => line('not in this room', { ...l, to: '' }, l.where)),
    ]
  }

  // Card by card, its zones first, then its stock. If the page dies between the two, one card's stock change is lost and
  // the next finish lists it; the other order could apply the change twice on the next submit.
  const writeZones = async (entries) => {
    const at = new Date().toISOString()
    const keep = entries.filter(e => e.qty > 0).map(e => ({ location_id: round.location_id, zone: e.zone, tcg_id: e.id, qty: e.qty, scanned_at: e.at || at, scanned_by_id: user?.id || null }))
    for (let i = 0; i < keep.length; i += 500) {
      const { error } = await supabase.from('stock_zone_qty').upsert(keep.slice(i, i + 500), { onConflict: 'location_id,zone,tcg_id' })
      if (error) return error
    }
    for (const e of entries.filter(x => x.qty <= 0)) {
      const { error } = await supabase.from('stock_zone_qty').delete().eq('location_id', round.location_id).eq('zone', e.zone).eq('tcg_id', e.id)
      if (error) return error
    }
    return null
  }

  const applyPlan = async () => {
    if (blocked || busyRef.current) return
    if (plan.version !== scanVersion.current) { setPlan(null); return }
    const ask = planLines.length
      ? `Change stock for ${planLines.length} card${planLines.length === 1 ? '' : 's'} in ${locationName}?`
      : (plan.finishing ? 'Close this round? No stock needs changing.' : 'Save these zones? No stock needs changing.')
    if (!confirm(ask)) return
    if (!beginOp()) return
    try {
      // Another browser may have submitted since this plan was made: applying it too would change stock twice.
      let fresh
      try {
        fresh = await readLedger(round.location_id)
      } catch (err) {
        addToast(`Nothing changed: could not read the zones (${err.message}). Try again. / 分区读取失败，库存没改，再试一次`, 'error')
        return
      }
      if (fresh.size !== plan.ledger.size || [...fresh].some(([k, v]) => plan.ledger.get(k)?.qty !== v.qty)) {
        setPlan(null)
        addToast('Zones were saved from somewhere else just now. Nothing changed: submit again. / 分区刚被别处保存过，这次没改，请重新提交', 'error')
        return
      }
      const ticked = new Set([...(includeZeroed ? plan.zeroed : []), ...(includeRaised ? plan.raised : [])].map(l => l.id))
      const writable = [...plan.changes.keys()].filter(id => !plan.hold.has(id) && !(plan.holdUnlessTicked.has(id) && !ticked.has(id)))
      const entriesOf = (id) => (plan.changes.get(id) || []).map(c => ({ ...c, id }))
      const beforeOf = (id) => entriesOf(id).map(e => {
        const old = plan.ledger.get(`${e.zone}|${id}`)
        return { zone: e.zone, id, qty: old?.qty || 0, at: old?.at }
      })
      // Cards whose stock does not change: only their zones. Saving these twice changes nothing.
      const lineIds = new Set(planLines.map(l => l.id))
      const zoneErr = await writeZones(writable.filter(id => !lineIds.has(id)).flatMap(entriesOf))
      if (zoneErr) {
        addToast(`Stock not changed, but some zones may be saved (${zoneErr.message}). Submit again. / 库存没改，部分分区可能已存，请重新提交`, 'error')
        setPlan(null)
        return
      }
      const outcomes = {}
      let changed = 0, skipped = 0, failed = 0, logFailed = 0, backFailed = 0
      const putBack = async (id) => { if (await writeZones(beforeOf(id))) backFailed++ }
      for (let i = 0; i < planLines.length; i++) {
        const l = planLines[i]
        setApplying({ done: i, total: planLines.length })
        const lineZoneErr = await writeZones(entriesOf(l.id))
        if (lineZoneErr) { failed++; outcomes[l.id] = `failed: ${lineZoneErr.message}`; await putBack(l.id); continue }
        // Only if the row still holds the number we just read. A sale in between loses here, and the next submit sees it.
        const { data, error } = await supabase.from('singles')
          .update({ quantity: l.to })
          .eq('id', l.rowId).eq('location_id', round.location_id).eq('quantity', l.rowQty).eq('status', 'in_inventory').eq('deleted', false)
          .select('id')
        if (error) { failed++; outcomes[l.id] = `failed: ${error.message}`; await putBack(l.id); continue }
        if (!data || data.length !== 1) { skipped++; outcomes[l.id] = 'stock moved just now: not changed'; await putBack(l.id); continue }
        changed++
        outcomes[l.id] = `changed ${l.rowQty} → ${l.to}`
        const { error: logErr } = await supabase.from('singles_audit_log').insert({
          single_id: l.rowId,
          event_type: 'updated',
          summary: `Stock check: qty ${l.rowQty} → ${l.to} (zones ${l.start} → ${l.scanned}, other zones ${l.others})`,
          payload: { stock_check: true, round_id: round.id, location: locationName, zones_before: l.start, zones_scanned: l.scanned, other_zones: l.others, before: l.rowQty, after: l.to, zones: zonesById.get(l.id) || [] },
          acted_by_id: user?.id || null,
        })
        if (logErr) logFailed++
      }
      setApplying(null)
      if (backFailed) addToast(`Zones of ${backFailed} cards could not be put back. Tell Gary. / 有分区没恢复，告诉 Gary`, 'error')
      const lines = resultLines(outcomes)
      const summary = { changed, skipped, failed, logFailed }
      setApplyResult({ ...summary, lines, submitted: plan.submit })
      if (plan.finishing && skipped === 0 && failed === 0) {
        const { error } = await supabase.from('stock_check_rounds')
          .update({ status: 'applied', finished_at: new Date().toISOString(), finished_by_id: user?.id || null, result: { ...summary, lines, takeOut } })
          .eq('id', round.id)
        if (error) addToast(`Stock changed, but the round could not be closed: ${error.message}`, 'error')
        else setRound(r => ({ ...r, status: 'applied' }))
      }
      setPlan(null)
      // The submitted zones' records changed: read them again for the colours.
      const seq = loadSeq.current
      const ht = ++heldSeq.current     // only the newest read is shown: two submits' reads can come back in either order
      readHeld(round.location_id).then(h => { if (seq === loadSeq.current && ht === heldSeq.current) setZoneHeld(h) }).catch(() => {})
    } finally {
      setApplying(null)
      endOp()
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  const closed = round?.status === 'applied'
  const takeOutPanel = (takeOut.length > 0 || unpriced > 0 || closed) && totals.size > 0 && (
            <div data-testid="take-out" className="mb-4 p-3 rounded border border-red-500/40 bg-red-500/5 text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-red-300">Take out: market under ${TAKE_OUT_UNDER} ({takeOut.reduce((s, l) => s + l.qty, 0)} cards) / 拿出来：市价不到 ${TAKE_OUT_UNDER}</span>
                <button type="button" onClick={() => downloadTakeOut(takeOut, nameOf, locationName)} disabled={unpriced > 0 || !takeOut.length} className="disabled:opacity-40 text-xs px-2 py-1 text-gray-300 border border-vault-border rounded whitespace-nowrap">Download list / 下载清单</button>
              </div>
              <p className="text-xs text-gray-400 mb-2">
                Submit the zone first, then take these out and check them out in Mystery Game.
                <br />先提交小区，再把这些拿出来走 Mystery Game 出库。
              </p>
              {unpriced > 0 && (
                <p className="text-xs text-amber-300 mb-2">
                  Prices not read yet for {unpriced} cards: this list may be missing some. / 还有 {unpriced} 张没读到市价，清单可能不全
                  <button type="button" onClick={() => setMarketTry(t => t + 1)} className="ml-2 px-2 py-0.5 border border-vault-border rounded text-gray-300">Read again / 再读</button>
                </p>
              )}
              {takeOut.length === 0 && unpriced === 0 && <p className="text-xs text-gray-300">None under ${TAKE_OUT_UNDER}. / 没有低于 ${TAKE_OUT_UNDER} 的</p>}
              <div className="max-h-64 overflow-y-auto text-xs">
                {takeOut.map(l => (
                  <div key={`${l.zone}|${l.id}`} className="flex items-center gap-2 py-0.5">
                    <span className="w-16 font-semibold text-vault-gold">{zoneLabel(l.zone)}</span>
                    <span className="font-mono text-gray-400">{l.id}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-300">{nameOf(l.id)}</span>
                    <span className="text-gray-400 whitespace-nowrap">${l.m.toFixed(2)}</span>
                    <span className="text-white whitespace-nowrap">×{l.qty}</span>
                  </div>
                ))}
              </div>
            </div>
  )
  const zoneLines = zone ? [...scans].filter(([k, q]) => q > 0 && k.startsWith(`${zone}|`)).map(([k, q]) => ({ id: k.split('|')[1], qty: q })) : []

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ScanLine className="text-vault-gold" /> Stock Check / 库存核对
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          Pokemon, One Piece and Dragon Ball singles. Scan zone by zone: where you scan a card is where the system says it is. You can submit finished zones at any time: only those zones change, the others stay as they were.
          <br />核对宝可梦、海贼王、龙珠单卡。按小区依次扫，在哪个小区扫到，系统就记在哪。随时可以提交已完成的小区：只更新这几个小区，其他小区不动。
        </p>
      </div>

      <StockPendingSales addToast={addToast} user={user} />
      <FindCard addToast={addToast} user={user} />
      <PutAway addToast={addToast} user={user} source="unknown" />
      <MoveToStore user={user} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <MapPin size={14} className="text-gray-500" />
        <select
          value={locationId}
          disabled={loading || (!!round && !closed)}
          onChange={(e) => { setLocationId(e.target.value); loadRoom(e.target.value) }}
          className="text-sm py-1.5 px-2 bg-vault-darker/40 border border-vault-border rounded-md text-white disabled:opacity-60"
        >
          <option value="">Pick a room…</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>

      {saveFailed && (
        <div className="mb-3 p-3 rounded border border-red-500/50 bg-red-500/10 text-sm text-red-300 font-semibold">
          Scans are not saving (network?). Retrying. Do not close this page.
        </div>
      )}

      {locationId && !round && !loading && (
        <div className="card mb-4">
          {lastRound && (
            <p className="text-xs text-gray-400 mb-3">
              Last round finished {new Date(lastRound.finished_at).toLocaleString()}: {lastRound.result?.changed ?? 0} cards changed.{' '}
              <button type="button" className="text-vault-gold underline" onClick={() => downloadCsv(lastRound.result?.lines || [], locationName)}>Download CSV</button>
            </p>
          )}
          <button type="button" onClick={startRound} className="btn btn-primary px-4 flex items-center gap-2">
            <Play size={14} /> Start a new round / 开始新一轮
          </button>
        </div>
      )}

      {round && !closed && !busy && (
        <>
          <div className="mb-3 text-sm text-gray-300 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Scanned <b className="text-white">{scannedUnits}</b> of <b className="text-white">{expectedUnits}</b> in the app at the start</span>
            <span>Zones done <b className="text-white">{roomZones.filter(z => zonesDone.has(z)).length}</b> of {roomZones.length}</span>
            <span className="text-xs text-gray-500">Started {new Date(round.started_at).toLocaleDateString()}</span>
          </div>

          <div className="card mb-4 overflow-x-auto">
            <div className="grid gap-1 min-w-[560px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              {gridItems.map(z => {
                if (z.heading) return <div key={z.heading} data-testid="zone-heading" style={{ gridColumn: '1 / -1' }} className="pt-2 text-sm font-semibold text-vault-gold">{z.heading}</div>
                if (z.label) return <div key={z.label} style={{ gridColumn: '1 / -1' }} className="text-xs text-gray-400">{z.label}</div>
                const c = zoneCounts.get(z) || 0
                const over = isOverLimit(z, c)
                const state = zoneState({ done: zonesDone.has(z), scanned: c, held: zoneHeld.get(z) || 0 })
                const tone = state === 'done' ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-100'
                  : state === 'todo' ? 'border-red-500/60 bg-red-500/20 text-red-100'
                  : 'border-vault-border bg-gray-700/20 text-gray-500'
                return (
                  <button
                    key={z}
                    type="button"
                    data-zone={z}
                    data-state={state}
                    title={`${zoneLabel(z)}: scanned ${c} · recorded ${zoneHeld.get(z) || 0}`}
                    onClick={() => openZone(z)}
                    style={isBigZone(z) ? { gridColumn: '1 / -1' } : undefined}
                    className={`px-2 py-2.5 rounded border text-left flex items-center justify-between gap-1 ${tone} ${zone === z ? 'ring-2 ring-vault-gold' : 'hover:brightness-125'}`}
                  >
                    <span className="font-semibold text-base leading-tight">{zoneLabel(z)}{state === 'done' && <CheckCircle size={14} className="inline ml-1 text-emerald-300" />}</span>
                    <span className={over ? 'text-base text-red-200 font-bold flex items-center gap-0.5' : 'text-sm opacity-80'}>{over && <AlertTriangle size={14} />}{c}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400" data-testid="zone-legend">
              <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1 bg-emerald-500/40 border border-emerald-500/60" />Checked / 已核对</span>
              <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1 bg-red-500/40 border border-red-500/60" />To check / 要核对</span>
              <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1 bg-gray-700/40 border border-vault-border" />No cards / 没卡</span>
            </div>
          </div>

          {zone && (
            <div className="card mb-4">
              <div className="flex items-stretch gap-2 mb-3">
                <span className="px-3 flex items-center font-display text-xl text-vault-gold">{zoneLabel(zone)}</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan() } }}
                  placeholder="Scan a card / 扫码"
                  className="flex-1 px-3 py-2 text-sm font-mono"
                  autoFocus
                />
              </div>

              {lastScanId && (zoneCounts.get(zone) > 0) && (() => {
                const total = totals.get(lastScanId) || 0
                const inZone = scans.get(`${zone}|${lastScanId}`) || 0
                if (inZone === 0) return null
                const e = expected.get(lastScanId)
                const tone = !e ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  : total > e.qty ? 'border-red-500/50 bg-red-500/10 text-red-300'
                  : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
                return (
                  <div data-testid="last-scan" className={`mb-3 px-3 py-2 rounded border flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${tone}`}>
                    <span className="font-mono text-xs">{lastScanId}</span>
                    <span className="flex-1 min-w-0 truncate font-semibold">{nameOf(lastScanId) || 'Unknown card'}</span>
                    <span className="whitespace-nowrap">
                      {e ? `${total} of ${e.qty}${total > e.qty ? ' · more than app has' : ''}` : `not in this room's stock when the round started · ×${total}`}
                    </span>
                    {cheap(lastScanId) && (
                      <span data-testid="last-scan-cheap" className="w-full text-red-300 font-semibold">
                        Market ${market[lastScanId].toFixed(2)}, under ${TAKE_OUT_UNDER}: keep scanning it here, take it out after the zone is submitted (Mystery Game). / 市价不到 ${TAKE_OUT_UNDER}，照常扫，提交小区后拿出来走 Mystery Game 出库
                      </span>
                    )}
                  </div>
                )
              })()}

              {isOverLimit(zone, zoneCounts.get(zone) || 0) && (
                <div data-testid="zone-over" className="mb-3 p-3 rounded border border-red-500/50 bg-red-500/10 text-sm text-red-300 font-semibold">
                  {zoneLabel(zone)} has {zoneCounts.get(zone)} cards. It holds {zoneMax(zone)} at most: check this zone again. Press −1 on anything scanned by mistake.
                  <br />{zoneLabel(zone)} 有 {zoneCounts.get(zone)} 张，最多 {zoneMax(zone)} 张，请重新检查。扫错的按 −1 减掉。
                </div>
              )}

              <div className="bg-vault-darker rounded p-2 max-h-64 overflow-y-auto text-xs mb-3">
                {zoneLines.length === 0 && <span className="text-gray-600 italic">Nothing scanned in {zoneLabel(zone)} yet.</span>}
                {[...zoneLines].reverse().map(({ id, qty }) => (
                  <div key={id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="font-mono text-gray-400">{id}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-300">{nameOf(id)}</span>
                    {cheap(id) && <span className="text-red-300 font-semibold whitespace-nowrap">${market[id].toFixed(2)} · take out / 拿出</span>}
                    <span className="text-white whitespace-nowrap">×{qty}</span>
                    <button
                      type="button"
                      title="Undo one scan"
                      onClick={() => undoScan(zone, id)}
                      className="text-[10px] px-1.5 py-0.5 text-gray-400 hover:text-red-300 border border-vault-border rounded"
                    >
                      −1
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button type="button" onClick={finishZone} className="text-sm px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 font-semibold">
                  {isBigZone(zone) ? `${zoneLabel(zone)} done / 完成` : `${zoneLabel(zone)} done, next zone / 下一个小区`}
                </button>
              </div>
            </div>
          )}

          {takeOutPanel}

          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <button type="button" onClick={cancelRound} className="text-xs px-3 py-1.5 text-gray-400 hover:text-red-400 border border-vault-border rounded">
              Cancel round
            </button>
            <button type="button" onClick={() => checkDifferences(false)} disabled={planning} className="text-sm px-3 py-1.5 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/10 disabled:opacity-50 font-semibold">
              Submit finished zones / 提交已完成的小区
            </button>
            <button type="button" onClick={() => checkDifferences(true)} disabled={planning} className="text-sm px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold flex items-center gap-1">
              {planning && <Loader2 size={12} className="animate-spin" />} Finish round: check differences / 结束本轮，看差异
            </button>
          </div>
        </>
      )}

      {plan && !closed && (
        <div className="card mb-4" data-testid="plan">
          <h2 className="font-display text-lg text-white mb-2">{plan.finishing ? 'Differences / 差异' : 'Submit finished zones / 提交已完成的小区'}</h2>
          <p className="text-sm text-gray-300 mb-2">
            Zones in this submit: {plan.submit.map(zoneLabel).join(', ') || 'none'}. All other zones stay as they were.
            <br />这次提交：{plan.submit.join('、') || '没有'}。其他小区不动。
            {plan.unfinished.length > 0 && <><br /><span className="text-amber-300">Not finished, not in this submit: {plan.unfinished.map(zoneLabel).join(', ')} / 还没点完成，这次不提交</span></>}
          </p>
          <p className="text-xs text-gray-400 mb-3">
            {plan.same} cards no change. {plan.soldOk} fewer than last time, explained by sales or moves. {plan.filled} found where the app already counted them.
          </p>
          <PlanTable title={`Will change to your number: ${plan.fixes.length}`} tone="text-vault-gold" lines={plan.fixes} nameOf={nameOf} />
          {plan.auto.length > 0 && (
            <PlanTable title={`Will change without a tick: ${plan.auto.length} (not found two rounds running, or no zone record and not found this round → found number; set to 0 before and found again → put back) / 不用打勾直接改`} tone="text-vault-gold" lines={plan.auto} nameOf={nameOf} showReason />
          )}
          {plan.zeroed.length > 0 && (
            <>
              <PlanTable title={`Not found: ${plan.zeroed.length} cards, ${plan.zeroed.reduce((s, l) => s + (l.now - l.to), 0)} copies`} tone="text-red-300" lines={plan.zeroed} nameOf={nameOf} />
              <label className="flex items-center gap-2 text-sm text-red-300 mb-3 cursor-pointer">
                <input type="checkbox" checked={includeZeroed} onChange={(e) => setIncludeZeroed(e.target.checked)} />
                I looked for these and they are not in this room: change them to the number shown / 找过了确实没有，改成上面的数
              </label>
            </>
          )}
          {plan.raised.length > 0 && (
            <div data-testid="raised">
              <PlanTable title={`Counted more than stock: ${plan.raised.length} cards, ${plan.raised.reduce((s, l) => s + (l.to - l.now), 0)} copies. Not added unless you tick / 比库存多，不打勾不加`} tone="text-amber-300" lines={plan.raised} nameOf={nameOf} />
              <label className="flex items-center gap-2 text-sm text-amber-300 mb-3 cursor-pointer">
                <input type="checkbox" checked={includeRaised} onChange={(e) => setIncludeRaised(e.target.checked)} />
                I checked these: the extra copies are really here and not sold. Add them / 核对过了，确实多出来、没卖掉，加上
              </label>
            </div>
          )}
          {plan.people.length > 0 && (
            <PlanTable title={`Needs a person, not changed: ${plan.people.length}`} tone="text-amber-300" lines={plan.people} nameOf={nameOf} showReason />
          )}
          {plan.extras.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-amber-300 mb-1">Scanned, but not this room's stock, not changed: {plan.extras.length}</div>
              <div className="bg-vault-darker rounded p-2 max-h-48 overflow-y-auto text-xs">
                {plan.extras.map(e => (
                  <div key={e.id} className="flex gap-2 py-0.5">
                    <span className="font-mono text-gray-400">{e.id}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-300">{[e.name, e.where].filter(Boolean).join(' · ')}</span>
                    <span className="text-white">×{e.scanned}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {blocked && (
            <div className="mb-3 p-3 rounded border border-red-500/50 bg-red-500/10 text-sm text-red-300 flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>This would lower {Math.round(share * 100)}% of the room's stock, which looks like a mistake. Check the zones, or ask Gary. / 这样会减掉 {Math.round(share * 100)}% 的库存，看起来不对。检查小区，或者问 Gary。</span>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => downloadCsv(resultLines({}), locationName)} className="text-xs px-3 py-1.5 text-gray-300 border border-vault-border rounded">Download CSV</button>
            {planLines.length > 0 ? (
              <button type="button" onClick={applyPlan} disabled={blocked || busy} className="text-sm px-3 py-1.5 bg-red-500/25 border border-red-500/50 text-red-200 rounded hover:bg-red-500/35 disabled:opacity-50 font-semibold flex items-center gap-1">
                {applying ? <><Loader2 size={12} className="animate-spin" /> {applying.done} / {applying.total}</> : `Confirm: change stock for ${planLines.length} / 确认改库存`}
              </button>
            ) : (
              <button type="button" onClick={applyPlan} disabled={busy} className="text-sm px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded font-semibold">{plan.finishing ? 'Close this round / 结束' : 'Save these zones / 保存这些小区'}</button>
            )}
          </div>
        </div>
      )}

      {applyResult && (
        <div className="card mb-4" data-testid="result">
          <h2 className="font-display text-lg text-white mb-2">Result / 结果</h2>
          <p className="text-sm text-gray-300 mb-2">
            Changed {applyResult.changed}.
            {applyResult.skipped > 0 && ` ${applyResult.skipped} moved just now and were not changed.`}
            {applyResult.failed > 0 && ` ${applyResult.failed} failed.`}
            {applyResult.logFailed > 0 && ` ${applyResult.logFailed} changed but not written to the activity log.`}
          </p>
          {(applyResult.skipped > 0 || applyResult.failed > 0) && (
            <p className="text-sm text-amber-300 mb-2">Those cards were not changed and the round stays open. Submit again to check them.</p>
          )}
          {applyResult.submitted?.length > 0 && <p className="text-sm text-gray-300 mb-2">Zones saved: {applyResult.submitted.map(zoneLabel).join(', ')}. Other zones were not touched. / 已保存这些小区，其他小区没动。</p>}
          <button type="button" onClick={() => downloadCsv(applyResult.lines, locationName)} className="text-xs px-3 py-1.5 text-gray-300 border border-vault-border rounded">Download CSV</button>
          {closed && takeOutPanel && <div className="mt-3">{takeOutPanel}</div>}
          {closed && (
            <button type="button" onClick={() => loadRoom(locationId)} className="ml-2 text-xs px-3 py-1.5 text-gray-300 border border-vault-border rounded">Back to the room</button>
          )}
        </div>
      )}
    </div>
  )
}

function PlanTable({ title, tone, lines, nameOf, showReason }) {
  return (
    <div className="mb-3">
      <div className={`text-xs font-semibold mb-1 ${tone}`}>{title}</div>
      {lines.length > 0 && (
        <div className="bg-vault-darker rounded p-2 max-h-64 overflow-y-auto text-xs">
          <div className="flex gap-2 pb-1 text-[10px] uppercase tracking-wider text-gray-500">
            <span className="w-16">ID</span><span className="flex-1">Card</span><span className="w-40 text-right">Zones before · app now · zones scanned</span><span className="w-14 text-right">{showReason ? '' : 'New'}</span>
          </div>
          {lines.map(l => (
            <div key={l.id} className="flex gap-2 py-0.5">
              <span className="w-16 font-mono text-gray-400">{l.id}</span>
              <span className="flex-1 min-w-0 truncate text-gray-300">{nameOf(l.id) || l.name}{showReason && <span className="text-amber-300"> · {l.reason}</span>}</span>
              <span className="w-40 text-right text-gray-400">{l.start} · {l.now} · {l.scanned}</span>
              <span className="w-14 text-right text-white font-semibold">{showReason ? '' : l.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Register sales neither Front Store nor Inventory could cover: no room was deducted. John or Gary decides here.
function StockPendingSales({ addToast, user }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    try {
      setRows(await listStockPendingSales(INVENTORY_ROOM))
    } catch (err) {
      addToast(`Could not load register sales to confirm: ${err.message}`, 'error')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (row, action) => {
    if (busy) return
    setBusy(row.id)
    try {
      const res = await resolveStockPending(row, action, INVENTORY_ROOM, user)
      if (res.costError) addToast(`Stock deducted, but the cost could not be copied: ${res.costError}`, 'error')
      else addToast(action === 'deduct' ? `Deducted ${res.deducted} from Inventory` : 'Done, no room deducted', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setBusy(null)
      load()
    }
  }

  if (rows.length === 0) return null
  return (
    <div className="card mb-4 border-amber-500/40" data-testid="stock-pending">
      <h2 className="font-display text-lg text-amber-300 mb-1">Register sales to confirm: {rows.length} / 门店卖出待确认</h2>
      <p className="text-sm text-gray-300 mb-2">
        Front Store and Inventory could not cover these, so nothing was deducted.
        <br />门店和 Inventory 都不够，没有扣任何库。
      </p>
      <div className="text-sm">
        {rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-t border-vault-border/40">
            <span className="font-mono text-xs text-gray-400">{r.tcg_id}</span>
            <span className="flex-1 min-w-0 text-gray-200">{cardName(r)} ×{r.quantity}</span>
            <span className="text-xs text-gray-400">sold {r.sale_date} · Inventory has {r.inventory_qty}</span>
            <button type="button" disabled={!!busy || r.inventory_qty < (Number(r.quantity) || 1)} onClick={() => act(r, 'deduct')} className="text-xs px-2.5 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded disabled:opacity-40 font-semibold">
              Yes, deduct / 从 Inventory 扣
            </button>
            <button type="button" disabled={!!busy} onClick={() => act(r, 'none')} className="text-xs px-2.5 py-1.5 border border-vault-border text-gray-300 rounded disabled:opacity-40">
              No, don't deduct / 不扣
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

const changeZoneQty = (zone, id, delta, userId) => changeZoneQtyAt(INVENTORY_ROOM, zone, id, delta, userId)

// Put away: Gary 11/05. A card goes into one zone A1..J5 without rescanning the zone. Only the zone record changes, stock does not.
// A copy recorded in Unsorted comes out of Unsorted. A copy with no room in the books waits for a person on the page: a pop-up would
// take the Enter of the next scan as its answer.

// Will 11/26 (D-20261126-04): two places. Stock Check: source 'unknown' = a copy not recorded in Unsorted. Grading page: source
// 'unsorted' = a copy recorded in Unsorted goes into a zone. Each refuses the other's copies, so one card is never in two places.
export function PutAway({ addToast, user, source = 'unknown' }) {
  const [zone, setZone] = useState('')
  const [code, setCode] = useState('')
  const [held, setHeld] = useState(null)      // copies recorded in the chosen zone
  // Codex 11/26: cards waiting for "from Unsorted or unknown?" are kept in this browser, so going to another page does not lose them.
  const KEEP = `lv_put_away_waiting_${source}`
  const [lines, setLines] = useState(() => {
    try { return (JSON.parse(localStorage.getItem(KEEP) || '[]') || []).map((l, i) => ({ ...l, key: -1 - i, state: 'pending' })) } catch { return [] }
  })      // this session, newest first
  const [working, setWorking] = useState(0)
  const queue = useRef(Promise.resolve())     // a scanner is faster than the checks: one card at a time
  const seq = useRef(0)
  const inputRef = useRef(null)
  const zoneRef = useRef('')
  const [heldAll, setHeldAll] = useState(null)   // zone -> copies recorded, for the grey of an empty zone in the picker
  const [picking, setPicking] = useState(true)
  // Reads of the counts can come back in any order. Each read takes a ticket when it begins; a count is shown only if no read
  // begun later has already given that zone's count (the full read gives every zone's).
  const ticket = useRef(0)
  const allApplied = useRef(0)            // ticket of the full read shown
  const latest = useRef(new Map())        // zone -> { n, t } from a one-zone read
  const heldT = useRef(0)                 // ticket of the count shown beside the chosen zone

  // All zones at once, on opening the page and the picker: other parts of this page (a submit, Move to Storefront) change the records too.
  const loadAll = useCallback(() => {
    const t = ++ticket.current
    readHeld(INVENTORY_ROOM)
      .then(m => {
        if (t < allApplied.current) return
        allApplied.current = t
        for (const [z, c] of latest.current) if (c.t > t) m.set(z, c.n)
        setHeldAll(m)
      })
      .catch(() => {})
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const refreshHeld = useCallback(async (z) => {
    const t = ++ticket.current
    const data = await readAllPages(() => supabase.from('stock_zone_qty').select('qty').eq('location_id', INVENTORY_ROOM).eq('zone', z).order('tcg_id'))
    const n = data.reduce((s, r) => s + (Number(r.qty) || 0), 0)
    if (zoneRef.current === z && t > heldT.current) { heldT.current = t; setHeld({ zone: z, n }) }
    if (t > allApplied.current && t > (latest.current.get(z)?.t || 0)) {
      latest.current.set(z, { n, t })
      setHeldAll(m => (m ? new Map(m).set(z, n) : m))
    }
    return n
  }, [])

  const chooseZone = (z) => {
    zoneRef.current = z
    setZone(z)
    setHeld(null)
    setPicking(!z)
    if (z) refreshHeld(z).catch(err => addToast(`Could not read ${zoneLabel(z)}: ${err.message}`, 'error'))
    setTimeout(() => inputRef.current?.focus(), 20)
  }

  const audit = (rowId, summary, payload) => supabase.from('singles_audit_log')
    .insert({ single_id: rowId, event_type: 'updated', summary, payload: { put_away: true, ...payload }, acted_by_id: user?.id || null })
    .then(({ error }) => { if (error) console.warn('[put away] audit failed', error) })

  // The copy goes in, and comes out of Unsorted if it was recorded there.
  const addToZone = async (z, id, rowId, fromUnsorted) => {
    await changeZoneQty(z, id, 1, user?.id)
    if (fromUnsorted) {
      try {
        await changeZoneQty(UNSORTED, id, -1, user?.id)
      } catch (err) {
        try {
          await changeZoneQty(z, id, -1, user?.id)
        } catch {
          err.inBoth = true
        }
        throw err
      }
    }
    await audit(rowId, `Put away: +1 in ${z}${fromUnsorted ? ' from Unsorted' : ''}. Stock unchanged.`, { zone: z, from: fromUnsorted ? UNSORTED : null })
  }

  // A submit replaces its zones, so nothing is written here while a count of the room is open.
  const countOpen = async () => {
    const { data, error } = await supabase.from('stock_check_rounds').select('id').eq('location_id', INVENTORY_ROOM).eq('status', 'open').limit(1)
    if (error) throw error
    return data?.length > 0
  }
  const COUNT_OPEN = 'A count of Inventory is open: scan it there instead, a submit would replace this. / 后面正在核对，请在核对里扫'

  // yes: the person has said there is one more copy. Every check still runs again, on the numbers as they are now.
  // from: 'scan' = Stock Check, just scanned; 'unsorted' / 'unknown' = what the person said at Submit (or the Grading page).
  const checkAndAdd = async (key, z, id, yes = false, from = source === 'unsorted' ? 'unsorted' : 'scan') => {
    const set = (patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
    let info = {}
    try {
      if (await countOpen()) { set({ state: 'refused', note: COUNT_OPEN }); return }
      const n = await refreshHeld(z)
      if (isOverLimit(z, n + 1)) { set({ state: 'refused', note: `${zoneLabel(z)} is full (${n}/${zoneMax(z)}). / ${zoneLabel(z)} 满了` }); return }
      const live = await readAllPages(() => supabase.from('singles')
        .select('id, card_name, card_number, language, quantity, location_id, location:locations(name)')
        .eq('tcg_id', id).in('brand', STOCK_BRANDS).eq('deleted', false).in('status', ['in_inventory', 'listed']).gt('quantity', 0).order('id'))
      const here = live.filter(r => r.location_id === INVENTORY_ROOM)
      if (!here.length) {
        const where = live.map(r => `${r.location?.name || 'no location'} ×${r.quantity}`).join(', ')
        set({ state: 'refused', name: live[0] ? cardName(live[0]) : '', note: live.length ? `Not in Inventory. The app has it at ${where}. / 后面没有这张` : 'No stock with this id. / 系统里没有这张' })
        return
      }
      const stock = here.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
      const records = await readAllPages(() => supabase.from('stock_zone_qty').select('zone, qty').eq('location_id', INVENTORY_ROOM).eq('tcg_id', id).order('zone'))
      const inZones = records.reduce((s, r) => s + (Number(r.qty) || 0), 0)
      const unsorted = records.some(r => r.zone === UNSORTED && r.qty > 0)
      // Will 11/26: the Grading page takes only a copy recorded in Unsorted. On Stock Check a card that Unsorted also holds waits,
      // and at Submit the person says whether it came from Unsorted or from somewhere unknown; other cards go in as unknown.
      const fromU = from === 'unsorted'
      info = { name: cardName(here[0]), rowId: here[0].id, fromUnsorted: fromU, from }
      if (fromU && !unsorted) {
        if (source === 'unsorted') set({ ...info, state: 'refused', note: 'Not in Unsorted: put it away on Stock Check. / 不在 Unsorted，请到 Stock Check 的 Put Away 放' })
        else set({ ...info, from: 'scan', fromUnsorted: false, state: 'pending', note: 'Unsorted has no copy of it now: choose unknown. / Unsorted 里已经没有了，请选来源未知' })
        return
      }
      if (from === 'scan' && unsorted) { set({ ...info, fromUnsorted: false, state: 'pending', note: 'Unsorted has it too: asked at Submit. / Unsorted 里也有，提交时问' }); return }
      const noRoom = !fromU && inZones >= stock
      if (noRoom && !yes) {
        const list = records.map(r => `${zoneLabel(r.zone)}×${r.qty}`).join(' ')
        set({ ...info, state: 'ask', note: `Stock ${stock}, and the zones already hold ${inZones}: ${list}. Another copy? / 账上 ${stock} 张，分区里已经有 ${inZones} 张，还有一张吗？` })
        return
      }
      if (await countOpen()) { set({ state: 'refused', note: COUNT_OPEN }); return }
      await addToZone(z, id, here[0].id, fromU)
      set({ ...info, state: 'added', at: Date.now(), note: noRoom ? 'zones now hold more than stock / 分区张数比账上多' : '' })
      refreshHeld(z).catch(() => {})    // the writes are done: only the count on the page is late
    } catch (err) {
      if (err.inBoth) set({ ...info, fromUnsorted: false, state: 'added', at: Date.now(), note: `This copy is now in both ${zoneLabel(z)} and Unsorted (${err.message}). Undo takes it out of ${zoneLabel(z)}. / 这张同时记在 ${zoneLabel(z)} 和 Unsorted，撤销会从 ${zoneLabel(z)} 去掉` })
      else set({ state: 'refused', note: `${err.message || err}. / 没加上` })
    }
  }

  const run = (job) => {
    setWorking(w => w + 1)
    queue.current = queue.current.then(job).catch(() => {}).finally(() => setWorking(w => w - 1))
  }

  const onScan = () => {
    const id = labelId(code)
    setCode('')
    if (!id || !zone) return
    const key = ++seq.current
    setLines(ls => [{ key, zone, id, name: '', state: 'working', note: '' }, ...ls].filter((l, i) => i < 100 || ['pending', 'working', 'ask'].includes(l.state)))
    run(() => checkAndAdd(key, zone, id))
    inputRef.current?.focus()
  }

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const addAnyway = (l) => {
    setLine(l.key, { state: 'working', note: '' })
    run(() => checkAndAdd(l.key, l.zone, l.id, true, l.from))
  }

  // Submit: each waiting card goes in as the person says.
  const [asking, setAsking] = useState(false)
  const waiting = lines.filter(l => l.state === 'pending')
  // Only cards not yet decided: one being written may already be in its zone, and must not come back as waiting.
  const keepKey = waiting.map(l => l.key).join(',')
  useEffect(() => {
    try {
      if (waiting.length) localStorage.setItem(KEEP, JSON.stringify(waiting.map(l => ({ zone: l.zone, id: l.id, name: l.name }))))
      else localStorage.removeItem(KEEP)
    } catch { /* storage full or off: the warning on leaving still applies */ }
  }, [keepKey])
  const decide = (ls, from) => {
    for (const l of ls) {
      setLine(l.key, { state: 'working', note: '' })
      run(() => checkAndAdd(l.key, l.zone, l.id, false, from))
    }
  }
  useEffect(() => {
    if (!waiting.length) { setAsking(false); return }
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [waiting.length])

  // A count since the add may already have corrected it, so its undo no longer applies. A minute's margin for the two clocks.
  // Two writes. If the second fails the line remembers the first is done, so pressing Undo again does not take a second copy.
  const undo = (l) => {
    setLine(l.key, { state: 'working', note: '' })
    run(async () => {
      let zoneDone = !!l.zoneDone
      try {
        if (await countOpen()) { setLine(l.key, { state: 'added', note: COUNT_OPEN }); return }
        if (await countSince(l.at, INVENTORY_ROOM)) { setLine(l.key, { state: 'added', noUndo: true, note: 'A count ran since: its numbers stand, undo no longer applies. / 之后核对过，以核对为准，不能撤销' }); return }
        if (!zoneDone) { await changeZoneQty(l.zone, l.id, -1, user?.id); zoneDone = true }
        if (l.fromUnsorted) await changeZoneQty(UNSORTED, l.id, 1, user?.id)
        await audit(l.rowId, `Put away undone: -1 in ${l.zone}${l.fromUnsorted ? ' back to Unsorted' : ''}. Stock unchanged.`, { zone: l.zone, undo: true })
        setLine(l.key, { state: 'undone', note: '' })
        refreshHeld(l.zone).catch(() => {})
      } catch (err) {
        setLine(l.key, { state: 'added', zoneDone, note: zoneDone ? `Out of ${zoneLabel(l.zone)}, not yet back in Unsorted (${err.message || err}). Press Undo again. / 已从 ${zoneLabel(l.zone)} 去掉，还没回到 Unsorted，再按一次撤销` : `Undo failed: ${err.message || err}. / 撤销失败` })
      }
    })
  }

  const label = { working: 'checking', added: 'added', refused: 'not added', ask: 'needs you', undone: 'undone', pending: 'waiting' }
  const color = { working: 'text-gray-400', added: 'text-green-400', refused: 'text-red-400', ask: 'text-vault-gold', undone: 'text-gray-500', pending: 'text-vault-gold' }
  return (
    <div className="card mb-4" data-testid="put-away">
      <div className="text-sm font-semibold text-white">{source === 'unsorted' ? 'Unsorted → zone / 从 Unsorted 放进分区' : 'Put cards in a zone (not from Unsorted) / 往分区放卡（来源未知）'}</div>
      <div className="text-xs text-gray-400 mt-0.5">Adds to one zone, no need to scan the whole zone. Stock does not change. / 只加这一个分区，不用整区重扫，库存数不变。</div>
      <div className="mt-2 flex flex-wrap items-stretch gap-2">
        {zone && !picking && (
          <button type="button" onClick={() => { setPicking(true); loadAll() }} data-testid="put-away-zone" className="text-sm py-1.5 px-3 rounded-md border border-vault-gold bg-vault-gold/20 text-white font-semibold">
            {zoneLabel(zone)} <span className="text-xs text-gray-400 font-normal">· change / 换分区</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          value={code}
          disabled={!zone}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan() } }}
          placeholder={zone ? `Scan into ${zoneLabel(zone)} / 扫进 ${zoneLabel(zone)}` : 'Choose a zone first / 先选分区'}
          className="flex-1 min-w-[180px] px-3 py-2 text-sm disabled:opacity-60"
        />
        {zone && <span className="self-center text-xs text-gray-400" data-testid="put-away-held">{held?.zone === zone ? `${held.n}/${zoneMax(zone)}` : ''} {working > 0 && <Loader2 size={12} className="inline animate-spin" />}</span>}
      </div>
      {(picking || !zone) && (
        <div className="mt-2" data-testid="put-away-picker">
          <div className="text-xs text-gray-400">Choose a zone / 选分区{heldAll ? ' · grey = no cards / 灰色 = 没卡' : ''}</div>
          {ZONE_GROUPS.map(g => (
            <div key={g.name}>
              <div className="pt-1.5 text-xs font-semibold text-vault-gold">{g.name}</div>
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                {g.rows.flatMap(r => r.zones).map(z => {
                  const empty = heldAll && !(heldAll.get(z) > 0)
                  return (
                    <button
                      key={z}
                      type="button"
                      data-zone={z}
                      onClick={() => chooseZone(z)}
                      className={`px-1.5 py-1 rounded border text-xs text-left leading-tight flex items-center justify-between gap-1 ${zone === z ? 'border-vault-gold bg-vault-gold/20 text-white' : empty ? 'border-vault-border bg-gray-700/20 text-gray-500 hover:border-vault-gold/50' : 'border-vault-border bg-vault-darker/40 text-gray-200 hover:border-vault-gold/50'}`}
                    >
                      <span>{zoneLabel(z)}</span>
                      {heldAll && <span className="opacity-70">{heldAll.get(z) || 0}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="mt-2 p-2 rounded border border-vault-gold/50 bg-vault-gold/10 text-xs" data-testid="put-away-submit">
          {!asking ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-200">{waiting.length} card(s) not added yet: Unsorted has them too. / {waiting.length} 张还没加：Unsorted 里也有这张</span>
              <button type="button" onClick={() => setAsking(true)} className="px-3 py-1 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded font-semibold">Submit / 提交</button>
            </div>
          ) : (
            <div>
              <div className="text-gray-200 font-semibold">Did these come from Unsorted? / 这些卡是从 Unsorted 拿来的吗？</div>
              <div className="text-gray-400">From Unsorted: Unsorted −1, zone +1. Unknown: zone +1 only. / 从 Unsorted：Unsorted 减 1、分区加 1；来源未知：只加分区</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={() => decide(waiting, 'unsorted')} className="px-2 py-0.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded font-semibold">All from Unsorted / 全部从 Unsorted</button>
                <button type="button" onClick={() => decide(waiting, 'unknown')} className="px-2 py-0.5 border border-vault-border text-gray-300 rounded">All unknown / 全部来源未知</button>
              </div>
              {waiting.map(l => (
                <div key={l.key} className="flex flex-wrap items-center gap-x-3 py-1 border-t border-vault-border/40">
                  <span className="font-semibold text-vault-gold">{zoneLabel(l.zone)}</span>
                  <span className="font-mono text-gray-400">{l.id}</span>
                  <span className="flex-1 min-w-0 text-gray-200">{l.name}</span>
                  <button type="button" onClick={() => decide([l], 'unsorted')} className="px-2 py-0.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded">From Unsorted / 从 Unsorted</button>
                  <button type="button" onClick={() => decide([l], 'unknown')} className="px-2 py-0.5 border border-vault-border text-gray-300 rounded">Unknown / 来源未知</button>
                  <button type="button" onClick={() => setLine(l.key, { state: 'refused', note: 'skipped / 没加' })} className="px-2 py-0.5 border border-vault-border text-gray-400 rounded">Skip</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {lines.length > 0 && (
        <div className="mt-2 max-h-64 overflow-y-auto text-xs" data-testid="put-away-lines">
          {lines.map(l => (
            <div key={l.key} className="flex flex-wrap items-center gap-x-3 py-1 border-t border-vault-border/40">
              <span className="font-semibold text-vault-gold">{zoneLabel(l.zone)}</span>
              <span className="font-mono text-gray-400">{l.id}</span>
              <span className="flex-1 min-w-0 text-gray-200">{l.name}</span>
              <span className={color[l.state]}>{label[l.state]}{l.note ? `: ${l.note}` : ''}</span>
              {l.state === 'ask' && (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => addAnyway(l)} className="px-2 py-0.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded font-semibold">Yes, add / 还有一张，加</button>
                  <button type="button" onClick={() => setLine(l.key, { state: 'refused', note: 'skipped / 没加' })} className="px-2 py-0.5 border border-vault-border text-gray-400 rounded">Skip</button>
                </span>
              )}
              {l.state === 'added' && !l.noUndo && <button type="button" onClick={() => undo(l)} className="px-2 py-0.5 border border-vault-border text-gray-300 rounded">Undo / 撤销</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Move to the Storefront: Gary 11/05. Each scan moves one copy from Inventory to the Storefront, through the same move as Find a card.
// The zone record follows, from the front zone: see _moveZones in supabase.js. A second scan moves a second copy.
function MoveToStore({ user }) {
  const [code, setCode] = useState('')
  const [lines, setLines] = useState([])
  const [working, setWorking] = useState(0)
  const queue = useRef(Promise.resolve())     // a scanner is faster than the writes: one card at a time, so each reads what the last one left
  const seq = useRef(0)
  const inputRef = useRef(null)
  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const run = (job) => {
    setWorking(w => w + 1)
    queue.current = queue.current.then(job).catch(() => {}).finally(() => setWorking(w => w - 1))
  }

  const onScan = () => {
    const id = labelId(code)
    setCode('')
    if (!id) return
    const key = ++seq.current
    setLines(ls => [{ key, id, name: '', state: 'working', note: '' }, ...ls].slice(0, 100))
    run(async () => {
      try {
        const res = await moveStockBetweenRooms({ tcgId: id, fromLocationId: INVENTORY_ROOM, toLocationId: STORE_ROOM, qty: 1, currentUserId: user?.id })
        const zone = res.zones?.length ? `, out of ${res.zones.join(' ')}` : ''
        setLine(key, { state: 'moved', at: Date.now(), zones: res.zones || [], name: cardName(res.card), note: `${res.left} left in Inventory${zone}${res.zoneNote ? `. ${res.zoneNote}` : ''} / 后面还剩 ${res.left} 张` })
      } catch (err) {
        setLine(key, { state: 'failed', note: err.message || String(err) })
      }
    })
    inputRef.current?.focus()
  }

  const undo = (l) => {
    setLine(l.key, { state: 'working', note: '' })
    run(async () => {
      try {
        // A count since the move has set the zones: the copy goes back with no zone, and Put cards in a zone can place it.
        const backToZones = await countSince(l.at, INVENTORY_ROOM) ? [] : l.zones
        const res = await moveStockBetweenRooms({ tcgId: l.id, fromLocationId: STORE_ROOM, toLocationId: INVENTORY_ROOM, qty: 1, currentUserId: user?.id, backToZones })
        setLine(l.key, { state: 'undone', note: `back in Inventory${res.zoneNote ? `. ${res.zoneNote}` : ''} / 已回后面，门店还剩 ${res.left} 张` })
      } catch (err) {
        setLine(l.key, { state: 'moved', noUndo: true, note: `Undo failed, it may have gone through: find this card and check both rooms. ${err.message || err} / 撤销失败，可能已经移了，请搜这张卡核对两边` })
      }
    })
  }

  const label = { working: 'moving', moved: 'moved', failed: 'not moved', undone: 'undone' }
  const color = { working: 'text-gray-400', moved: 'text-green-400', failed: 'text-red-400', undone: 'text-gray-500' }
  const moved = lines.filter(l => l.state === 'moved').length
  return (
    <div className="card mb-4" data-testid="move-store">
      <div className="text-sm font-semibold text-white">Move to Storefront / 移到门店</div>
      <div className="text-xs text-gray-400 mt-0.5">Each scan moves one copy from Inventory to the Storefront. Online stock and the zone record go down with it. / 扫一张就从后面移一张到门店，线上数量和分区记录跟着减。</div>
      <div className="mt-2 flex flex-wrap items-stretch gap-2">
        <input
          ref={inputRef}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan() } }}
          placeholder="Scan a card to move it / 扫卡移到门店"
          className="flex-1 min-w-[180px] px-3 py-2 text-sm"
        />
        <span className="self-center text-xs text-gray-400" data-testid="move-store-count">{moved} moved / 已移 {moved} 张 {working > 0 && <Loader2 size={12} className="inline animate-spin" />}</span>
      </div>
      {lines.length > 0 && (
        <div className="mt-2 max-h-64 overflow-y-auto text-xs" data-testid="move-store-lines">
          {lines.map(l => (
            <div key={l.key} className="flex flex-wrap items-center gap-x-3 py-1 border-t border-vault-border/40">
              <span className="font-mono text-gray-400">{l.id}</span>
              <span className="flex-1 min-w-0 text-gray-200">{l.name}</span>
              <span className={color[l.state]}>{label[l.state]}{l.note ? `: ${l.note}` : ''}</span>
              {l.state === 'moved' && !l.noUndo && <button type="button" onClick={() => undo(l)} className="px-2 py-0.5 border border-vault-border text-gray-300 rounded">Undo / 撤销</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A zone in the words people use: the store has one zone, the rest are in the back.
const zonePlace = (z) => (z === STORE_ZONE ? 'Storefront / 门店' : `Inventory / 后面 ${zoneLabel(z)}`)

// Where a sold row went: the online marker names the shop and order, otherwise the room and what the register wrote.
function soldWhere(r) {
  const notes = String(r.sale_notes || '').trim()
  const online = notes.match(/^\[online-single[^\]]*\]\s*(.+)$/)
  if (online) return online[1]
  const channel = { in_person: 'in store', ebay: 'eBay', tcgplayer: 'TCGplayer', shopify: 'Shopify' }[r.sale_channel] || r.sale_channel || 'sale'
  return [ROOM_LABEL[r.location_id] || r.location?.name, channel, notes && notes.length <= 30 ? notes : ''].filter(Boolean).join(' · ')
}

// Gary 11/05: a card with no stock anywhere: was it sold in the last 3 days and where, and which zone was it in.
// ids: cards a name or id search found with no live row of that name. A second look by id, because the same card can carry another name on another row.
async function readGoneCards(candidates) {
  const ids = [...candidates.keys()]
  const since = new Date(Date.now() - RECENT_SALE_DAYS * 86400000).toLocaleDateString('en-CA')
  const live = new Set(), sold = new Map(), zones = new Map(), past = new Map()
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100)
    const [rows, sales, held, scans] = await Promise.all([
      readAllPages(() => supabase.from('singles').select('tcg_id').in('tcg_id', part).neq('status', 'sold').eq('deleted', false).gt('quantity', 0).order('id')),
      readAllPages(() => supabase.from('singles').select('tcg_id, sale_date, sale_channel, sale_notes, location_id, location:locations(name)')
        .in('tcg_id', part).eq('status', 'sold').eq('deleted', false).gte('sale_date', since).order('sale_date', { ascending: false }).order('id')),
      readAllPages(() => supabase.from('stock_zone_qty').select('zone, tcg_id, qty, scanned_at').in('tcg_id', part).order('location_id').order('zone').order('tcg_id')),
      readAllPages(() => supabase.from('stock_check_scans').select('zone, tcg_id, qty, round_id, round:stock_check_rounds(status, started_at)')
        .in('tcg_id', part).gt('qty', 0).order('round_id').order('zone').order('tcg_id')),
    ])
    for (const r of rows) live.add(String(r.tcg_id))
    for (const r of sales) add(sold, String(r.tcg_id), r)
    for (const h of held) add(zones, String(h.tcg_id), `${zonePlace(h.zone)}×${h.qty} (${dayOf(h.scanned_at).slice(5)})`)
    for (const r of scans.filter(x => x.round && x.round.status !== 'cancelled')) add(past, String(r.tcg_id), r)
  }
  return ids.filter(id => !live.has(id)).map(id => {
    const lines = new Map()
    for (const r of sold.get(id) || []) {
      const k = `${String(r.sale_date).slice(5)} ${soldWhere(r)}`
      lines.set(k, (lines.get(k) || 0) + 1)
    }
    // No zone record left (a later count took it out): the newest count that saw it.
    const seen = past.get(id) || []
    const newest = seen.reduce((a, r) => (r.round.started_at > a ? r.round.started_at : a), '')
    const fromCount = seen.filter(r => r.round.started_at === newest).map(r => `${zonePlace(r.zone)}×${r.qty} (${dayOf(newest).slice(5)})`)
    return { k: `gone|${id}`, id, name: candidates.get(id), gone: true, qty: 0, sold: [...lines].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)), zones: zones.get(id) || fromCount }
  })
}

// Find a card: by name or scanned id. Answers from live stock plus the zones of
// the latest round that scanned it in each room.
function FindCard({ addToast, user }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const [more, setMore] = useState(false)      // the search found more than the 200 lines shown
  const searchSeq = useRef(0)
  const lastTerm = useRef('')
  const [moving, setMoving] = useState(null)   // { k, qty } of the line being moved
  const [moveBusy, setMoveBusy] = useState(false)

  const search = async (again) => {
    const term = (typeof again === 'string' ? again : q).trim()     // the Find button passes its click event
    if (!term) return
    lastTerm.current = term
    const seq = ++searchSeq.current     // a newer search wins, whichever answer arrives first
    setBusy(true)
    try {
      const match = (base) => (/^\d+$/.test(term) ? base.eq('tcg_id', term) : base.ilike('card_name', `%${term}%`)).order('id')
      const rowsQuery = () => match(supabase.from('singles')
        .select('tcg_id, card_name, card_number, language, quantity, location_id, location:locations(name)')
        .in('brand', STOCK_BRANDS).neq('status', 'sold').eq('deleted', false).gt('quantity', 0).not('tcg_id', 'is', null))
      const data = await readAllPages(rowsQuery)
      const ids = [...new Set(data.map(r => String(r.tcg_id)))]
      const held = []
      for (let i = 0; i < ids.length; i += 100) {
        held.push(...await readAllPages(() => supabase.from('stock_zone_qty')
          .select('location_id, zone, tcg_id, qty, scanned_at')
          .in('tcg_id', ids.slice(i, i + 100)).order('location_id').order('zone').order('tcg_id')))
      }
      // What the zone held when it was last scanned: a sale does not change it until the next scan.
      const zones = new Map()
      for (const h of held) {
        const k = `${h.tcg_id}|${h.location_id}`
        if (!zones.has(k)) zones.set(k, [])
        zones.get(k).push(`${zoneLabel(h.zone)}×${h.qty} (${dayOf(h.scanned_at).slice(5)})`)
      }
      const grouped = new Map()
      for (const r of data) {
        const k = `${r.tcg_id}|${r.location_id}`
        const g = grouped.get(k) || { k, id: r.tcg_id, loc: r.location_id, name: cardName(r), room: ROOM_LABEL[r.location_id] || r.location?.name || 'no location', qty: 0, zones: zones.get(k) || [] }
        g.qty += Number(r.quantity) || 0
        grouped.set(k, g)
      }
      // Sold rows and rows at 0 of cards with no stock left. Cards with stock come first, a broad search stops at 200 lines anyway.
      const old = await readAllPages(() => match(supabase.from('singles')
        .select('tcg_id, card_name, card_number, language')
        .in('brand', STOCK_BRANDS).eq('deleted', false).not('tcg_id', 'is', null).or('status.eq.sold,quantity.eq.0')))
      const liveIds = new Set(ids)
      const candidates = new Map()
      for (const r of old) if (!liveIds.has(String(r.tcg_id)) && !candidates.has(String(r.tcg_id))) candidates.set(String(r.tcg_id), cardName(r))
      const room = Math.max(0, 200 - grouped.size)
      const sorted = [...candidates].sort((a, b) => a[1].localeCompare(b[1]))
      const gone = []
      let looked = 0
      while (looked < sorted.length && gone.length < room) {     // some turn out to have stock under another name, so look until the page is full
        gone.push(...await readGoneCards(new Map(sorted.slice(looked, looked + 100))))
        looked += 100
      }
      if (seq !== searchSeq.current) return
      setMore(grouped.size + gone.length > 200 || looked < sorted.length)
      setResults([...[...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)), ...gone])
      setMoving(null)
    } catch (err) {
      if (seq === searchSeq.current) addToast(`Search failed: ${err.message}`, 'error')
    } finally {
      if (seq === searchSeq.current) setBusy(false)
    }
  }

  const move = async (r) => {
    if (moveBusy) return
    setMoveBusy(true)
    try {
      const res = await moveStockBetweenRooms({ tcgId: r.id, fromLocationId: r.loc, toLocationId: MOVE_TO[r.loc].id, qty: Number(moving.qty), currentUserId: user?.id })
      addToast(`Moved ${res.moved} to ${res.toName}. ${res.left} left here.${res.zoneNote ? ` ${res.zoneNote}.` : ''} / 已移 ${res.moved} 张，这边还剩 ${res.left} 张`, 'success')
      setMoving(null)                   // done: the form cannot send the same move twice, whatever the refresh does
      await search(lastTerm.current)
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setMoveBusy(false)
    }
  }

  return (
    <div className="card mb-4">
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!moveBusy) search() } }}
          placeholder="Find a card: name or id / 找卡：卡名或编号"
          className="flex-1 px-3 py-2 text-sm"
        />
        <button type="button" onClick={search} disabled={busy || moveBusy} className="btn btn-secondary px-4 flex items-center gap-1">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find
        </button>
      </div>
      {results && (
        <div className="mt-2 max-h-64 overflow-y-auto text-xs" data-testid="find-results">
          {results.length === 0 && <span className="text-gray-500">No card found. / 没有这张</span>}
          {more && <div className="text-gray-500 py-1">Showing the first 200. Type more of the name.</div>}
          {results.slice(0, 200).map(r => (r.gone ? (
            <div key={r.k} className="flex flex-wrap gap-x-3 py-1 border-t border-vault-border/40" data-testid="find-gone">
              <span className="font-mono text-gray-400">{r.id}</span>
              <span className="flex-1 min-w-0 text-gray-200">{r.name}</span>
              <span className="text-red-400 font-semibold">Stock 0 / 库存 0</span>
              <span className={r.sold.length ? 'text-gray-200' : 'text-gray-500'}>{r.sold.length ? `Sold last ${RECENT_SALE_DAYS} days / 近 ${RECENT_SALE_DAYS} 天卖了: ${r.sold.join(', ')}` : `No sale in the last ${RECENT_SALE_DAYS} days / 近 ${RECENT_SALE_DAYS} 天没卖`}</span>
              <span className={r.zones.length ? 'text-vault-gold font-semibold' : 'text-gray-500'}>{r.zones.length ? `Was in / 之前在 ${r.zones.join(' ')}` : 'no zone on record / 没有分区记录'}</span>
            </div>
          ) : (
            <div key={r.k} className="flex flex-wrap gap-x-3 py-1 border-t border-vault-border/40">
              <span className="font-mono text-gray-400">{r.id}</span>
              <span className="flex-1 min-w-0 text-gray-200">{r.name}</span>
              <span className={r.loc === STORE_ROOM ? 'text-green-400 font-semibold' : r.loc === INVENTORY_ROOM ? 'text-sky-300 font-semibold' : 'text-gray-400'} data-testid="find-room">{r.room} ×{r.qty}</span>
              <span className={r.zones.length ? 'text-vault-gold font-semibold' : 'text-gray-500'}>{r.zones.length ? r.zones.join(' ') : 'no zone yet'}</span>
              {MOVE_TO[r.loc] && (moving?.k === r.k ? (
                <span className="flex items-center gap-1" data-testid="move-form">
                  <input type="number" min="1" max={r.qty} step="1" value={moving.qty} onChange={(e) => setMoving({ k: r.k, qty: e.target.value })} className="w-14 px-1 py-0.5 text-xs" />
                  <button type="button" disabled={moveBusy} onClick={() => move(r)} className="px-2 py-0.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded disabled:opacity-40 font-semibold">Move to {MOVE_TO[r.loc].label}</button>
                  <button type="button" disabled={moveBusy} onClick={() => setMoving(null)} className="px-2 py-0.5 border border-vault-border text-gray-400 rounded">Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setMoving({ k: r.k, qty: 1 })} className="px-2 py-0.5 border border-vault-border text-gray-300 rounded hover:border-vault-gold/50">Move / 移库</button>
              ))}
            </div>
          )))}
        </div>
      )}
    </div>
  )
}
