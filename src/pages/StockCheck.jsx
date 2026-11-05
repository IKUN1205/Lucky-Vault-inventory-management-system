import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, MapPin, Play, ScanLine, Search } from 'lucide-react'
import { fetchLocations, listStockPendingSales, resolveStockPending, supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import { MAX_LOWERED_SHARE, RECENT_SALE_DAYS, ZONES, ZONE_LETTERS, ZONE_MAX, loweredShare, planStockFix, resultCsv } from '../lib/stockCheck'

// Stock Check: John scans the Pokemon singles zone by zone (A1..J5). Where he
// scans a card is where the system says it is. When the round is finished, he
// confirms and any difference becomes his number. Sales and intake go on as usual.
// Tables: scripts/create_stock_check_tables.sql. Rules: src/lib/stockCheck.js.

const PAGE = 1000

// Gary 2026-11-04: singles stock is only these two.
const INVENTORY_ROOM = '6d89a23e-c250-4dcd-81cf-2b4dd26c7592'
const STOCK_ROOMS = [
  { id: INVENTORY_ROOM, label: 'Inventory (TCGplayer Singles)' },
  { id: 'c4cf3dab-94d7-4c2c-a4b4-214977feec06', label: 'Storefront (Front Store)' },
]

async function readAllPages(build) {
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) return all
  }
}

// This room's Pokemon rows, including rows at 0 from an earlier round.
async function readRoomRows(locationId) {
  const data = await readAllPages(() => supabase
    .from('singles')
    .select('id, tcg_id, quantity, status, card_name, card_number, language')
    .eq('location_id', locationId)
    .eq('brand', 'Pokemon')
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

// Ids sold from this room in the last few days: their copy may still be here, waiting to ship.
async function readRecentlySold(locationId) {
  const since = new Date(Date.now() - RECENT_SALE_DAYS * 86400000).toLocaleDateString('en-CA')
  const data = await readAllPages(() => supabase
    .from('singles')
    .select('id, tcg_id')
    .eq('location_id', locationId)
    .eq('brand', 'Pokemon')
    .eq('status', 'sold')
    .gte('sale_date', since)
    .not('tcg_id', 'is', null)
    .order('id'))
  return new Set(data.map(r => String(r.tcg_id).trim()))
}

const cardName = (r) => [r.card_name, r.card_number, r.language === 'EN' ? '' : r.language].filter(Boolean).join(' ')

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
  const [zone, setZone] = useState(null)
  const [scanInput, setScanInput] = useState('')
  const [lastScanId, setLastScanId] = useState(null)
  const [extraNames, setExtraNames] = useState({})    // id -> name of a scanned id outside the snapshot
  const [saveFailed, setSaveFailed] = useState(false)
  const [plan, setPlan] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [includeZeroed, setIncludeZeroed] = useState(false)
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
    setRound(null); setScans(new Map()); setZone(null); setPlan(null); setApplyResult(null); setLastRound(null); setLastScanId(null)
    if (!id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data: open, error } = await supabase.from('stock_check_rounds').select('*').eq('location_id', id).eq('status', 'open').maybeSingle()
      if (error) throw error
      if (seq !== loadSeq.current) return
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
      addToast(`Round started: ${snapshot.length} Pokemon cards in the app here`, 'success')
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
    clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(() => flush(), 1500)
    setPlan(null); setApplyResult(null)
  }

  const onScan = () => {
    const id = scanInput.trim()
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

  const overfull = () => ZONES.filter(z => (zoneCounts.get(z) || 0) > ZONE_MAX)

  // Read from the scans themselves: a scan can land while the save below is waiting.
  const zoneOver = (z) => {
    let n = 0
    for (const [k, q] of scansRef.current) if (k.startsWith(`${z}|`)) n += q
    if (n <= ZONE_MAX) return false
    addToast(`${z} has more than ${ZONE_MAX} cards. Check this zone again. / 超过 ${ZONE_MAX} 张，请重新检查`, 'error')
    return true
  }

  const finishZone = async () => {
    if (zoneOver(zone)) return
    const ok = await flush()
    if (!ok) { addToast('Scans could not be saved yet. Try again in a moment.', 'error'); return }
    if (zoneOver(zone)) return
    const done = [...new Set([...(round.zones_done || []), zone])]
    const { error } = await supabase.from('stock_check_rounds').update({ zones_done: done }).eq('id', round.id)
    if (error) { addToast(`Could not mark the zone done: ${error.message}`, 'error'); return }
    setRound(r => ({ ...r, zones_done: done }))
    const next = ZONES[ZONES.indexOf(zone) + 1]
    if (next) await openZone(next)
    else setZone(null)
  }

  // ─── Finish: compare, confirm, change stock ─────────────────────────
  const checkDifferences = async () => {
    if (overfull().length) {
      addToast(`More than ${ZONE_MAX} cards in ${overfull().join(', ')}. Check again before finishing. / 超过 ${ZONE_MAX} 张，请先重新检查`, 'error')
      return
    }
    if (!beginOp()) return
    setPlanning(true)
    const version = scanVersion.current
    try {
      const ok = await flush()
      if (!ok) throw new Error('Some scans are not saved yet')
      setZone(null)
      const [rows, recentlySold] = await Promise.all([readRoomRows(locationId), readRecentlySold(locationId)])
      const p = planStockFix({ expected, totals, rows, recentlySold })
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
        addToast('You scanned while it was comparing. Press Finish round again.', 'error')
        return
      }
      setPlan({ ...p, version })
      setIncludeZeroed(false)
      setApplyResult(null)
    } catch (err) {
      addToast(`Could not compare: ${err.message}`, 'error')
    } finally {
      setPlanning(false)
      endOp()
    }
  }

  const share = plan ? loweredShare(plan, includeZeroed) : 0
  const blocked = share > MAX_LOWERED_SHARE
  const planLines = plan ? [...plan.fixes, ...(includeZeroed ? plan.zeroed : [])] : []

  const resultLines = (outcomes) => {
    if (!plan) return []
    const zones = (id) => (zonesById.get(id) || []).join(' ')
    const line = (group, l, outcome) => ({ group, ...l, zones: zones(l.id), outcome, rowId: undefined, rowQty: undefined })
    return [
      ...plan.fixes.map(l => line('difference', l, outcomes?.[l.id] || 'not changed')),
      ...plan.zeroed.map(l => line('scanned none', l, outcomes?.[l.id] || 'not changed')),
      ...plan.people.map(l => line('needs a person', { ...l, name: l.name }, l.reason)),
      ...plan.extras.map(l => line('not in this room', { ...l, to: '' }, l.where)),
    ]
  }

  const applyPlan = async () => {
    if (blocked || planLines.length === 0 || busyRef.current) return
    if (plan.version !== scanVersion.current) { setPlan(null); return }
    if (!confirm(`Change stock for ${planLines.length} card${planLines.length === 1 ? '' : 's'} in ${locationName} to your scanned numbers?`)) return
    if (!beginOp()) return
    try {
    const outcomes = {}
    let changed = 0, skipped = 0, failed = 0, logFailed = 0
    for (let i = 0; i < planLines.length; i++) {
      const l = planLines[i]
      setApplying({ done: i, total: planLines.length })
      // Only if the row still holds the number we just read. A sale in between loses here, and the next check sees it.
      const { data, error } = await supabase.from('singles')
        .update({ quantity: l.to })
        .eq('id', l.rowId).eq('location_id', round.location_id).eq('quantity', l.rowQty).eq('status', 'in_inventory').eq('deleted', false)
        .select('id')
      if (error) { failed++; outcomes[l.id] = `failed: ${error.message}`; continue }
      if (!data || data.length !== 1) { skipped++; outcomes[l.id] = 'stock moved just now: not changed'; continue }
      changed++
      outcomes[l.id] = `changed ${l.rowQty} → ${l.to}`
      const { error: logErr } = await supabase.from('singles_audit_log').insert({
        single_id: l.rowId,
        event_type: 'updated',
        summary: `Stock check: qty ${l.rowQty} → ${l.to} (scanned ${l.scanned})`,
        payload: { stock_check: true, round_id: round.id, location: locationName, scanned: l.scanned, before: l.rowQty, after: l.to, app_at_start: l.start, zones: zonesById.get(l.id) || [] },
        acted_by_id: user?.id || null,
      })
      if (logErr) logFailed++
    }
    setApplying(null)
    const lines = resultLines(outcomes)
    const summary = { changed, skipped, failed, logFailed }
    setApplyResult({ ...summary, lines })
    if (skipped === 0 && failed === 0) {
      const { error } = await supabase.from('stock_check_rounds')
        .update({ status: 'applied', finished_at: new Date().toISOString(), finished_by_id: user?.id || null, result: { ...summary, lines } })
        .eq('id', round.id)
      if (error) addToast(`Stock changed, but the round could not be closed: ${error.message}`, 'error')
      else setRound(r => ({ ...r, status: 'applied' }))
    }
    setPlan(null)
    } finally {
      setApplying(null)
      endOp()
    }
  }

  const finishNoChanges = async () => {
    if (plan.version !== scanVersion.current) { setPlan(null); return }
    if (!confirm('Close this round? No stock needs changing.')) return
    if (!beginOp()) return
    try {
      const lines = resultLines({})
      const { error } = await supabase.from('stock_check_rounds')
        .update({ status: 'applied', finished_at: new Date().toISOString(), finished_by_id: user?.id || null, result: { changed: 0, skipped: 0, failed: 0, logFailed: 0, lines } })
        .eq('id', round.id)
      if (error) { addToast(`Could not close the round: ${error.message}`, 'error'); return }
      setApplyResult({ changed: 0, skipped: 0, failed: 0, logFailed: 0, lines })
      setRound(r => ({ ...r, status: 'applied' }))
      setPlan(null)
    } finally {
      endOp()
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  const closed = round?.status === 'applied'
  const zoneLines = zone ? [...scans].filter(([k, q]) => q > 0 && k.startsWith(`${zone}|`)).map(([k, q]) => ({ id: k.split('|')[1], qty: q })) : []

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ScanLine className="text-vault-gold" /> Stock Check / 库存核对
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          Pokemon singles only. Scan zone by zone: where you scan a card is where the system says it is. Stock changes only when you confirm at the end.
          <br />只核对宝可梦单卡。按小区依次扫，在哪个小区扫到，系统就记在哪。最后确认才改库存。
        </p>
      </div>

      <StockPendingSales addToast={addToast} user={user} />
      <FindCard addToast={addToast} />

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
            <span>Zones done <b className="text-white">{zonesDone.size}</b> of {ZONES.length}</span>
            <span className="text-xs text-gray-500">Started {new Date(round.started_at).toLocaleDateString()}</span>
          </div>

          <div className="card mb-4 overflow-x-auto">
            <div className="grid gap-1 min-w-[560px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              {ZONE_LETTERS.flatMap(l => [1, 2, 3, 4, 5].map(n => {
                const z = `${l}${n}`
                const c = zoneCounts.get(z) || 0
                const over = c > ZONE_MAX
                return (
                  <button
                    key={z}
                    type="button"
                    data-zone={z}
                    onClick={() => openZone(z)}
                    className={`px-3 py-3 rounded border text-lg flex items-center justify-between gap-2 ${over ? 'border-red-500 bg-red-500/20 text-red-200' : zone === z ? 'border-vault-gold bg-vault-gold/20 text-white' : 'border-vault-border bg-vault-darker/40 text-gray-300 hover:border-vault-gold/50'}`}
                  >
                    <span className="font-semibold">{z}{zonesDone.has(z) && <CheckCircle size={16} className="inline ml-1 text-emerald-400" />}</span>
                    <span className={over ? 'text-base text-red-300 font-bold' : 'text-base text-gray-400'}>{c}</span>
                  </button>
                )
              }))}
            </div>
          </div>

          {zone && (
            <div className="card mb-4">
              <div className="flex items-stretch gap-2 mb-3">
                <span className="px-3 flex items-center font-display text-xl text-vault-gold">{zone}</span>
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
                      {e ? `${total} of ${e.qty}${total > e.qty ? ' · more than app has' : ''}` : `not in this room's Pokemon stock · ×${total}`}
                    </span>
                  </div>
                )
              })()}

              {zoneCounts.get(zone) > ZONE_MAX && (
                <div data-testid="zone-over" className="mb-3 p-3 rounded border border-red-500/50 bg-red-500/10 text-sm text-red-300 font-semibold">
                  {zone} has {zoneCounts.get(zone)} cards. A zone holds {ZONE_MAX} at most: check this zone again. Press −1 on anything scanned by mistake.
                  <br />{zone} 有 {zoneCounts.get(zone)} 张，一个小区最多 {ZONE_MAX} 张，请重新检查。扫错的按 −1 减掉。
                </div>
              )}

              <div className="bg-vault-darker rounded p-2 max-h-64 overflow-y-auto text-xs mb-3">
                {zoneLines.length === 0 && <span className="text-gray-600 italic">Nothing scanned in {zone} yet.</span>}
                {[...zoneLines].reverse().map(({ id, qty }) => (
                  <div key={id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="font-mono text-gray-400">{id}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-300">{nameOf(id)}</span>
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
                  {zone} done, next zone / 下一个小区
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <button type="button" onClick={cancelRound} className="text-xs px-3 py-1.5 text-gray-400 hover:text-red-400 border border-vault-border rounded">
              Cancel round
            </button>
            <button type="button" onClick={checkDifferences} disabled={planning} className="text-sm px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold flex items-center gap-1">
              {planning && <Loader2 size={12} className="animate-spin" />} Finish round: check differences / 结束本轮，看差异
            </button>
          </div>
        </>
      )}

      {plan && !closed && (
        <div className="card mb-4" data-testid="plan">
          <h2 className="font-display text-lg text-white mb-2">Differences / 差异</h2>
          <p className="text-xs text-gray-400 mb-3">
            {plan.same} cards match. {plan.movedOk} sold or came in during the round and still fit, so they are left alone.
            {' '}Cards that moved and still don't fit are listed for a person: scan them again.
          </p>
          <PlanTable title={`Will change to your number: ${plan.fixes.length}`} tone="text-vault-gold" lines={plan.fixes} nameOf={nameOf} />
          {plan.zeroed.length > 0 && (
            <>
              <PlanTable title={`Not scanned at all: ${plan.zeroed.length} cards, ${plan.zeroed.reduce((s, l) => s + l.now, 0)} copies`} tone="text-red-300" lines={plan.zeroed} nameOf={nameOf} />
              <label className="flex items-center gap-2 text-sm text-red-300 mb-3 cursor-pointer">
                <input type="checkbox" checked={includeZeroed} onChange={(e) => setIncludeZeroed(e.target.checked)} />
                I looked for these and they are not in this room: set them to 0 / 找过了确实没有，改成 0
              </label>
            </>
          )}
          {plan.people.length > 0 && (
            <PlanTable title={`Needs a person, not changed: ${plan.people.length}`} tone="text-amber-300" lines={plan.people} nameOf={nameOf} showReason />
          )}
          {plan.extras.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-amber-300 mb-1">Scanned, but not this room's Pokemon stock, not changed: {plan.extras.length}</div>
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
              <span>This would lower {Math.round(share * 100)}% of the room's stock, so the round looks unfinished. Keep scanning, or ask Gary. / 这样会减掉 {Math.round(share * 100)}% 的库存，看起来还没扫完。继续扫，或者问 Gary。</span>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => downloadCsv(resultLines({}), locationName)} className="text-xs px-3 py-1.5 text-gray-300 border border-vault-border rounded">Download CSV</button>
            {planLines.length > 0 ? (
              <button type="button" onClick={applyPlan} disabled={blocked || busy} className="text-sm px-3 py-1.5 bg-red-500/25 border border-red-500/50 text-red-200 rounded hover:bg-red-500/35 disabled:opacity-50 font-semibold flex items-center gap-1">
                {applying ? <><Loader2 size={12} className="animate-spin" /> {applying.done} / {applying.total}</> : `Confirm: change stock for ${planLines.length} / 确认改库存`}
              </button>
            ) : (
              <button type="button" onClick={finishNoChanges} disabled={busy} className="text-sm px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded font-semibold">Close this round / 结束</button>
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
            <p className="text-sm text-amber-300 mb-2">The round stays open. Press Finish round again to check what is left.</p>
          )}
          <button type="button" onClick={() => downloadCsv(applyResult.lines, locationName)} className="text-xs px-3 py-1.5 text-gray-300 border border-vault-border rounded">Download CSV</button>
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
            <span className="w-16">ID</span><span className="flex-1">Card</span><span className="w-32 text-right">Start · app now · scanned</span><span className="w-14 text-right">{showReason ? '' : 'New'}</span>
          </div>
          {lines.map(l => (
            <div key={l.id} className="flex gap-2 py-0.5">
              <span className="w-16 font-mono text-gray-400">{l.id}</span>
              <span className="flex-1 min-w-0 truncate text-gray-300">{nameOf(l.id) || l.name}{showReason && <span className="text-amber-300"> · {l.reason}</span>}</span>
              <span className="w-32 text-right text-gray-400">{l.start} · {l.now} · {l.scanned}</span>
              <span className="w-14 text-right text-white font-semibold">{showReason ? '' : l.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Register sales Front Store could not cover: no room was deducted. John or Gary decides here.
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
        Front Store did not have enough, so nothing was deducted. Was it a copy from Inventory?
        <br />门店库存不够，没有扣任何库。这张是从 Inventory 拿的吗？
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

// Find a card: by name or scanned id. Answers from live stock plus the zones of
// the latest round that scanned it in each room.
function FindCard({ addToast }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)

  const search = async () => {
    const term = q.trim()
    if (!term) return
    setBusy(true)
    try {
      const rowsQuery = () => {
        const base = supabase.from('singles')
          .select('tcg_id, card_name, card_number, language, quantity, location_id, location:locations(name)')
          .eq('brand', 'Pokemon').neq('status', 'sold').eq('deleted', false).gt('quantity', 0).not('tcg_id', 'is', null)
        return (/^\d+$/.test(term) ? base.eq('tcg_id', term) : base.ilike('card_name', `%${term}%`)).order('id')
      }
      const data = await readAllPages(rowsQuery)
      const ids = [...new Set(data.map(r => String(r.tcg_id)))]
      const scans = []
      for (let i = 0; i < ids.length; i += 100) {
        scans.push(...await readAllPages(() => supabase.from('stock_check_scans')
          .select('zone, tcg_id, qty, round_id, round:stock_check_rounds!inner(location_id, status, started_at)')
          .in('tcg_id', ids.slice(i, i + 100)).gt('qty', 0).neq('round.status', 'cancelled').order('round_id').order('zone').order('tcg_id')))
      }
      // Newest round per id + room.
      const newest = new Map()
      for (const s of scans) {
        const k = `${s.tcg_id}|${s.round.location_id}`
        const cur = newest.get(k)
        if (!cur || new Date(s.round.started_at) > new Date(cur.at)) newest.set(k, { at: s.round.started_at, round: s.round_id })
      }
      const zones = new Map()
      for (const s of scans) {
        const k = `${s.tcg_id}|${s.round.location_id}`
        if (newest.get(k)?.round !== s.round_id) continue
        if (!zones.has(k)) zones.set(k, [])
        zones.get(k).push(`${s.zone}×${s.qty}`)
      }
      const grouped = new Map()
      for (const r of data) {
        const k = `${r.tcg_id}|${r.location_id}`
        const g = grouped.get(k) || { k, id: r.tcg_id, name: cardName(r), room: r.location?.name || 'no location', qty: 0, zones: zones.get(k) || [] }
        g.qty += Number(r.quantity) || 0
        grouped.set(k, g)
      }
      setResults([...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (err) {
      addToast(`Search failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mb-4">
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
          placeholder="Find a card: name or id / 找卡：卡名或编号"
          className="flex-1 px-3 py-2 text-sm"
        />
        <button type="button" onClick={search} disabled={busy} className="btn btn-secondary px-4 flex items-center gap-1">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find
        </button>
      </div>
      {results && (
        <div className="mt-2 max-h-64 overflow-y-auto text-xs" data-testid="find-results">
          {results.length === 0 && <span className="text-gray-500">No Pokemon stock found.</span>}
          {results.length > 200 && <div className="text-gray-500 py-1">{results.length} found, showing the first 200. Type more of the name.</div>}
          {results.slice(0, 200).map(r => (
            <div key={r.k} className="flex flex-wrap gap-x-3 py-1 border-t border-vault-border/40">
              <span className="font-mono text-gray-400">{r.id}</span>
              <span className="flex-1 min-w-0 text-gray-200">{r.name}</span>
              <span className="text-gray-400">{r.room} ×{r.qty}</span>
              <span className={r.zones.length ? 'text-vault-gold font-semibold' : 'text-gray-500'}>{r.zones.length ? r.zones.join(' ') : 'no zone yet'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
