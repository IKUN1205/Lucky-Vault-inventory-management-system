import React, { useState, useRef, useEffect } from 'react'
import { fetchLocations, supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import {
  Scale, Search, RefreshCw, AlertTriangle, AlertCircle, Info,
  CheckCircle, ExternalLink, Loader2, FileSearch, MapPin,
  ScanLine, Trash2, ChevronDown, ChevronRight, Package,
  Boxes, Play, Square, RotateCcw, ArrowRightCircle,
} from 'lucide-react'

// Cards Audit — reconcile DB vs Google Sheet for singles + slabs.
// Two flows: scan a single TCG/Cert to compare it side-by-side, or run
// a full audit that flags every discrepancy (sold-but-not-in-sheet, qty
// mismatch, missing from one side, etc).
//
// Read-only by default — the only mutation is the "Push to sheet" button
// which calls /api/sheet-mark-sold (already battle-tested). Staff can't
// accidentally clobber data by clicking around.

const SEVERITY = {
  critical: { color: 'text-red-300',    bg: 'bg-red-500/10',    border: 'border-red-500/40',    icon: AlertCircle },
  warning:  { color: 'text-amber-300',  bg: 'bg-amber-500/10',  border: 'border-amber-500/40',  icon: AlertTriangle },
  info:     { color: 'text-cyan-300',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/40',   icon: Info },
}

const CODE_LABELS = {
  sold_but_sheet_shows_available:        'Sold in app, not in sheet',
  sheet_says_sold_but_inventory_remains: 'Sheet says sold but inventory remains',
  sheet_says_sold_but_app_says_available:'Sheet says sold but app says available',
  qty_mismatch:                          'Qty mismatch',
  qty_mismatch_at_location:              'Qty mismatch at this location',
  not_at_this_location:                  'Not at this location',
  location_mismatch:                     'Location mismatch',
  location_missing_in_sheet:             'Sheet missing location info',
  missing_in_sheet:                      'Missing in sheet',
  missing_in_db:                         'Missing in app',
  price_mismatch:                        'Price mismatch',
}

export default function CardsAudit() {
  const { toasts, addToast, removeToast } = useToast()
  const [kind, setKind] = useState('single')   // 'single' | 'slab'
  // Three modes: 'quick' (one card), 'batch' (scan many in sequence),
  // 'full' (run against the whole catalog). User picks which one they
  // need; the other two stay out of view to keep the page focused.
  const [auditMode, setAuditMode] = useState('quick')
  const [scanInput, setScanInput] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [fullRunning, setFullRunning] = useState(false)
  const [fullResult, setFullResult] = useState(null)
  const [filterCode, setFilterCode] = useState('')   // '' = show all
  const [pushingId, setPushingId] = useState(null)
  const [pushAllFullRunning, setPushAllFullRunning] = useState(false)
  // Batch scan state — keyed by id so re-scanning the same card just
  // replaces the prior result instead of stacking duplicates. Order
  // tracked separately so the most-recently-scanned floats to the top.
  const [batchById, setBatchById] = useState({})       // { [id]: result }
  const [batchOrder, setBatchOrder] = useState([])     // [id, id, …] newest first
  const [batchExpanded, setBatchExpanded] = useState({}) // { [id]: true } for inline-expanded rows
  const [batchPushAllRunning, setBatchPushAllRunning] = useState(false)

  // Physical count state. Three sub-states:
  //   'setup'    — user picks location, hasn't started yet
  //   'scanning' — expected list loaded; user scans cards present
  //   'review'   — user stopped scanning; show matched / missing / extra
  // physicalExpected: Map<id, { expected_qty, name, db_row_ids, … }>
  // physicalScanned:  Map<id, scanned_count> for ids that ARE in expected
  // physicalExtras:   Array<{ id, scanned_count }> for ids NOT in expected
  const [physicalState, setPhysicalState] = useState('setup')
  const [physicalExpected, setPhysicalExpected] = useState(null)
  const [physicalScanned, setPhysicalScanned] = useState(new Map())
  const [physicalExtras, setPhysicalExtras] = useState([])
  const [physicalLoading, setPhysicalLoading] = useState(false)
  const [physicalLocationId, setPhysicalLocationId] = useState(null)
  const [physicalResolving, setPhysicalResolving] = useState(null) // id currently being moved
  // Sheet snapshot for this physical count — lets the review compare
  // Physical / App / Sheet three-way without an extra round-trip.
  const [physicalSheetById, setPhysicalSheetById] = useState({})
  // Location scope (singles only). '' = audit across all locations.
  const [locationName, setLocationName] = useState('')
  const [locations, setLocations] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [kind, auditMode])

  useEffect(() => {
    fetchLocations('Physical')
      .then(setLocations)
      .catch(err => console.error('[audit] fetch locations failed:', err))
  }, [])

  // Location filter only applies to singles right now (slabs don't audit
  // by location because the slab sheet doesn't carry that column).
  const effectiveLocation = kind === 'single' && locationName ? locationName : ''
  const qs = () => {
    const p = new URLSearchParams({ kind })
    if (effectiveLocation) p.set('location', effectiveLocation)
    return p
  }

  const runScan = async (idOverride) => {
    const id = String(idOverride ?? scanInput).trim()
    if (!id) {
      addToast('Type or scan a TCG ID / Cert first', 'error')
      return
    }
    setScanning(true)
    setScanResult(null)
    try {
      const p = qs(); p.set('mode', 'scan'); p.set('id', id)
      const r = await fetch(`/api/audit-cards?${p}`)
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setScanResult(body)
      if (body.issues?.length === 0) {
        addToast(`${id} matches — DB and sheet agree`, 'success')
      } else {
        addToast(`${id}: ${body.issues.length} issue${body.issues.length === 1 ? '' : 's'} found`, 'info')
      }
    } catch (err) {
      console.error('[audit] scan failed:', err)
      addToast(`Scan failed: ${err.message}`, 'error')
    } finally {
      setScanning(false)
      setScanInput('')
      // Re-focus so the next scan/Enter just works.
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // Batch scan — same /api/audit-cards?mode=scan call as Quick scan, but
  // we accumulate into batchById instead of replacing scanResult. Same id
  // scanned twice = the later result overwrites the earlier one (cleaner
  // than duplicate rows for the typical "did I already scan this?" case).
  const runBatchScan = async (idOverride) => {
    const id = String(idOverride ?? scanInput).trim()
    if (!id) {
      addToast('Type or scan a TCG ID / Cert first', 'error')
      return
    }
    setScanning(true)
    try {
      const p = qs(); p.set('mode', 'scan'); p.set('id', id)
      const r = await fetch(`/api/audit-cards?${p}`)
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setBatchById(prev => ({ ...prev, [id]: body }))
      setBatchOrder(prev => [id, ...prev.filter(x => x !== id)])
      // Toast is small/silent here — staff scans fast, don't want a
      // toast tornado. Use sound/visual on the row itself.
      if (body.issues?.length === 0) {
        addToast(`${id} ✓`, 'success', { duration: 1200 })
      } else {
        addToast(`${id} — ${body.issues.length} issue${body.issues.length === 1 ? '' : 's'}`, 'info', { duration: 1500 })
      }
    } catch (err) {
      console.error('[audit] batch scan failed:', err)
      addToast(`${id}: ${err.message}`, 'error')
    } finally {
      setScanning(false)
      setScanInput('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const clearBatch = () => {
    if (batchOrder.length === 0) return
    if (!confirm(`Clear ${batchOrder.length} scanned card${batchOrder.length === 1 ? '' : 's'}?`)) return
    setBatchById({})
    setBatchOrder([])
    setBatchExpanded({})
  }

  const removeBatchEntry = (id) => {
    setBatchById(prev => { const n = { ...prev }; delete n[id]; return n })
    setBatchOrder(prev => prev.filter(x => x !== id))
    setBatchExpanded(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  // Bulk-push every fixable issue from the FULL audit results to the
  // sheet. Mirrors the batch-scan version, but operates on fullResult.
  // Dedupes by id so a card with multiple fixable issues only triggers
  // one /api/sheet-mark-sold call — the endpoint pushes the full DB
  // truth (status + qty) in one shot.
  const pushAllFullFixable = async () => {
    if (!fullResult) return
    const seen = new Set()
    const fixable = []
    for (const iss of fullResult.issues || []) {
      if (!iss.suggested_action) continue
      if (!iss.db?.row_ids?.length) continue
      if (seen.has(iss.id)) continue
      seen.add(iss.id)
      fixable.push({ id: iss.id, dbRowId: iss.db.row_ids[0] })
    }
    if (fixable.length === 0) {
      addToast('No fixable issues in the audit', 'info')
      return
    }
    if (!confirm(`Push ${fixable.length} fix${fixable.length === 1 ? '' : 'es'} to the sheet?\n\n` +
                 `Each one writes the app's truth into the sheet (qty or sold status).\n` +
                 `Issues that need human review aren't touched.`)) return
    setPushAllFullRunning(true)
    let ok = 0, failed = 0
    for (const f of fixable) {
      try {
        const r = await fetch('/api/sheet-mark-sold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id: f.dbRowId }),
        })
        const body = await r.json()
        if (body.ok) {
          ok++
          // Drop every fixable issue with this id from the full result.
          setFullResult(prev => prev ? ({
            ...prev,
            issues: prev.issues.filter(i => !(i.id === f.id && i.suggested_action)),
            summary: {
              ...prev.summary,
              total_issues: Math.max(0, prev.summary.total_issues - 1),
            },
          }) : prev)
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }
    setPushAllFullRunning(false)
    addToast(
      `Pushed ${ok} fix${ok === 1 ? '' : 'es'}${failed ? ` · ${failed} failed` : ''}`,
      failed ? 'info' : 'success'
    )
  }

  // "Push all fixable" — iterate the batch, find issues with
  // suggested_action set, call /api/sheet-mark-sold for each. Sequential
  // so the user can see progress and we don't slam the sheet API. After
  // each success we drop the issue from that card's result; if the card
  // now has zero issues, the row turns green.
  const pushAllBatchFixable = async () => {
    const fixable = []
    for (const id of batchOrder) {
      const result = batchById[id]
      if (!result?.db?.row_ids?.length) continue
      for (const iss of result.issues || []) {
        if (iss.suggested_action) fixable.push({ id, dbRowId: result.db.row_ids[0], issueCode: iss.code })
      }
    }
    if (fixable.length === 0) {
      addToast('No fixable issues in the batch', 'info')
      return
    }
    if (!confirm(`Push ${fixable.length} fix${fixable.length === 1 ? '' : 'es'} to the sheet?`)) return
    setBatchPushAllRunning(true)
    let ok = 0, failed = 0
    for (const f of fixable) {
      try {
        const r = await fetch('/api/sheet-mark-sold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id: f.dbRowId }),
        })
        const body = await r.json()
        if (body.ok) {
          ok++
          // Prune the fixed issue from this card's stored result.
          setBatchById(prev => {
            const cur = prev[f.id]
            if (!cur) return prev
            return {
              ...prev,
              [f.id]: { ...cur, issues: (cur.issues || []).filter(i => i.code !== f.issueCode) },
            }
          })
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }
    setBatchPushAllRunning(false)
    addToast(`Pushed ${ok} fix${ok === 1 ? '' : 'es'}${failed ? ` · ${failed} failed` : ''}`,
             failed ? 'info' : 'success')
  }

  const runFull = async () => {
    if (fullRunning) return
    setFullRunning(true)
    setFullResult(null)
    try {
      const p = qs(); p.set('mode', 'full')
      const r = await fetch(`/api/audit-cards?${p}`)
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setFullResult(body)
      const scope = body.location_filter
        ? ` at ${body.location_filter.name}`
        : ''
      addToast(
        `Audit done${scope}: ${body.summary.total_issues} issue${body.summary.total_issues === 1 ? '' : 's'} across ${body.summary.total_db_ids} app ids + ${body.summary.total_sheet_ids} sheet ids`,
        body.summary.total_issues === 0 ? 'success' : 'info'
      )
    } catch (err) {
      console.error('[audit] full audit failed:', err)
      addToast(`Audit failed: ${err.message}`, 'error')
    } finally {
      setFullRunning(false)
    }
  }

  // For "Push to sheet" — find the DB row id for this card and call the
  // existing /api/sheet-mark-sold endpoint. It already handles qty>1
  // (decrement instead of mark sold). For missing_in_db items there's
  // nothing to push — those are surfaced for visibility only.
  const pushToSheet = async (issue) => {
    const dbId = issue.db?.row_ids?.[0]
    if (!dbId) {
      addToast(`Can't push: no app row for ${issue.id}`, 'error')
      return
    }
    setPushingId(issue.id)
    try {
      const r = await fetch('/api/sheet-mark-sold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: dbId }),
      })
      const body = await r.json()
      if (body.ok) {
        addToast(body.message || 'Pushed to sheet', 'success')
        // Optimistically remove this issue from the full-audit list.
        if (fullResult) {
          setFullResult({
            ...fullResult,
            issues: fullResult.issues.filter(i => i.id !== issue.id || i.code !== issue.code),
            summary: {
              ...fullResult.summary,
              total_issues: Math.max(0, fullResult.summary.total_issues - 1),
            },
          })
        }
      } else {
        addToast(`Push failed: ${body.message || body.outcome}`, 'error')
      }
    } catch (err) {
      addToast(`Push failed: ${err.message}`, 'error')
    } finally {
      setPushingId(null)
    }
  }

  const onScanKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runScan()
    }
  }

  // ─── Physical count handlers ─────────────────────────────────────────
  // Load every card the app expects to be at this location, then flip
  // into scanning mode. We snapshot the expected list now (rather than
  // re-querying mid-count) so a sale that happens DURING counting
  // doesn't change the staff's view.
  const startPhysicalCount = async () => {
    if (!locationName) {
      addToast('Pick a location at the top of the page first', 'error')
      return
    }
    setPhysicalLoading(true)
    try {
      const r = await fetch(`/api/expected-at-location?kind=${kind}&location=${encodeURIComponent(locationName)}`)
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      const map = new Map()
      for (const item of body.expected || []) map.set(String(item.id), item)
      setPhysicalExpected(map)
      setPhysicalScanned(new Map())
      setPhysicalExtras([])
      setPhysicalLocationId(body.location?.id || null)
      setPhysicalSheetById(body.sheet_by_id || {})
      setPhysicalState('scanning')
      addToast(
        `Counting at ${body.location.name}: ${body.summary.unique_ids} unique ${kind === 'single' ? 'TCG IDs' : 'slabs'} expected (${body.summary.total_units} total units · ${body.summary.sheet_rows ?? 0} sheet rows loaded)`,
        'info'
      )
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (err) {
      addToast(`Couldn't load expected list: ${err.message}`, 'error')
    } finally {
      setPhysicalLoading(false)
    }
  }

  // Each scan: bump scanned count if id is in expected; otherwise add
  // to extras (might be a card that wandered in from another room, or
  // an unknown id we don't know about).
  const onPhysicalScan = (idOverride) => {
    const id = String(idOverride ?? scanInput).trim()
    if (!id) return
    if (!physicalExpected) return
    if (physicalExpected.has(id)) {
      setPhysicalScanned(prev => {
        const n = new Map(prev)
        n.set(id, (n.get(id) || 0) + 1)
        return n
      })
      addToast(`${id} ✓`, 'success', { duration: 900 })
    } else {
      setPhysicalExtras(prev => {
        const existing = prev.find(e => e.id === id)
        if (existing) {
          return prev.map(e => e.id === id ? { ...e, scanned_count: e.scanned_count + 1 } : e)
        }
        return [{ id, scanned_count: 1, scannedAt: Date.now() }, ...prev]
      })
      addToast(`${id} — not in expected list!`, 'info', { duration: 1500 })
    }
    setScanInput('')
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  const onPhysicalScanKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onPhysicalScan() }
  }

  // Undo a single scan on an expected card. Count drops by 1; if it
  // hits 0 the entry is removed entirely (matches the "never scanned"
  // → Missing bucket logic in review). Used when a barcode scanner
  // double-triggers or staff scans the wrong card and wants to back
  // out without restarting the count.
  const undoOnePhysicalScan = (id) => {
    setPhysicalScanned(prev => {
      const n = new Map(prev)
      const cur = n.get(id) || 0
      if (cur <= 1) n.delete(id)
      else n.set(id, cur - 1)
      return n
    })
  }
  // Same for extras (cards that aren't in expected at all). When count
  // reaches 0 we drop the row from extras entirely.
  const undoOneExtraScan = (id) => {
    setPhysicalExtras(prev => prev
      .map(e => e.id === id ? { ...e, scanned_count: e.scanned_count - 1 } : e)
      .filter(e => e.scanned_count > 0)
    )
  }

  const stopPhysicalCount = () => {
    setPhysicalState('review')
  }

  const resetPhysicalCount = () => {
    if (!confirm('Throw away the current count and start over?')) return
    setPhysicalState('setup')
    setPhysicalExpected(null)
    setPhysicalScanned(new Map())
    setPhysicalExtras([])
    setPhysicalLocationId(null)
  }

  // Resolve an "extra" — a physically-present card the app didn't expect
  // at this room. Two cases, handled automatically:
  //   1. App has LIVE rows for this id elsewhere → move them here (same
  //      as Move Inventory would).
  //   2. App has NO live rows (every row sold, or never imported) — the
  //      physical card in hand proves reality disagrees, so RE-ADD it:
  //      insert a fresh in_inventory row at this room with qty = times
  //      scanned, copying the card's identity (name/set/condition) from
  //      a prior (sold) row when one exists. Price seeds from the sheet
  //      snapshot when available; the hourly sync keeps it fresh after.
  //      (Slabs only get case 2 via flipping isn't safe — a duplicate
  //      cert row would break maybeSingle() lookups — so for slabs with
  //      no live row we surface a clear message instead.)
  // Returns 'moved' | 'readded' | 'failed' so the bulk loop can tally.
  const resolveOneExtraCore = async (extra) => {
    const table = kind === 'single' ? 'singles' : 'slabs'
    const idCol = kind === 'single' ? 'tcg_id' : 'cert_number'
    // Case 1: live rows exist anywhere → move them here.
    const { data: liveRows, error: findErr } = await supabase
      .from(table)
      .select('id, location_id, status')
      .eq(idCol, extra.id)
      .neq('status', 'sold')
      .eq('deleted', false)
      .limit(50)
    if (findErr) throw findErr
    if (liveRows && liveRows.length > 0) {
      const ids = liveRows.map(r => r.id)
      const { error: updErr } = await supabase
        .from(table)
        .update({ location_id: physicalLocationId })
        .in('id', ids)
      if (updErr) throw updErr
      return 'moved'
    }

    // Case 2: nothing live. Singles → re-add; slabs → explain.
    if (kind !== 'single') {
      throw new Error(`Slab ${extra.id} exists only as SOLD in the app. If it's physically here, the sale record may be wrong — check its history in Cards Inventory before re-adding.`)
    }
    // Copy identity from any prior row (sold ones count — same card).
    const { data: prior } = await supabase
      .from('singles')
      .select('card_name, card_number, set_id, brand, language, variant, form, condition')
      .eq('tcg_id', extra.id)
      .eq('deleted', false)
      .limit(1)
    const tpl = prior?.[0] || null
    const sheetInfo = physicalSheetById[extra.id] || null
    const insert = {
      card_name: tpl?.card_name || `(unknown — TCG ${extra.id})`,
      card_number: tpl?.card_number ?? null,
      set_id: tpl?.set_id ?? null,
      brand: tpl?.brand || 'Pokemon',
      language: tpl?.language || 'EN',
      variant: tpl?.variant ?? null,
      form: tpl?.form || 'raw',
      condition: tpl?.condition || 'NM',
      quantity: extra.scanned_count || 1,
      tcg_id: extra.id,
      current_market_price_usd: sheetInfo?.price ?? null,
      source_type: 'other',
      status: 'in_inventory',
      location_id: physicalLocationId,
      date_acquired: new Date().toLocaleDateString('en-CA'),
      notes: `Re-added via physical count at ${locationName} (app had no live row — found in store)`,
      deleted: false,
    }
    const { error: insErr } = await supabase.from('singles').insert(insert)
    if (insErr) throw insErr
    return 'readded'
  }

  const resolveExtraMoveHere = async (extra) => {
    if (!physicalLocationId) {
      addToast('No physical location id — internal error', 'error')
      return
    }
    setPhysicalResolving(extra.id)
    try {
      const outcome = await resolveOneExtraCore(extra)
      if (outcome === 'moved') {
        addToast(`Moved ${extra.id} → ${locationName}`, 'success')
      } else {
        addToast(`Re-added ${extra.scanned_count || 1} × ${extra.id} to ${locationName} (app had it as all-sold — physical copy wins)`, 'success')
      }
      setPhysicalExtras(prev => prev.filter(e => e.id !== extra.id))
    } catch (err) {
      addToast(`Resolve failed: ${err.message}`, 'error')
    } finally {
      setPhysicalResolving(null)
    }
  }

  // Bulk-move all "Missing" cards to another location. Used when staff
  // realizes the missing cards aren't actually in the room they're
  // counting — they got moved (sold without record, moved to another
  // room without a Move entry, etc). One DB UPDATE per item so each
  // can fail independently and we can track per-item results.
  const [bulkMoveMissingRunning, setBulkMoveMissingRunning] = useState(false)
  const bulkMoveMissingTo = async (missingItems, targetLocationId, targetLocationName) => {
    if (!missingItems || missingItems.length === 0) return
    if (!targetLocationId) {
      addToast('Pick a destination location first', 'error')
      return
    }
    if (!confirm(
      `Move ${missingItems.length} missing card${missingItems.length === 1 ? '' : 's'} → ${targetLocationName}?\n\n` +
      `These are cards the app thought were at ${locationName} but you didn't scan. Moving them sets their location_id in the app to ${targetLocationName}.`
    )) return
    setBulkMoveMissingRunning(true)
    let ok = 0, failed = 0
    const table = kind === 'single' ? 'singles' : 'slabs'
    const removedIds = new Set()
    for (const m of missingItems) {
      const rowIds = m.info?.db_row_ids || []
      if (rowIds.length === 0) { failed++; continue }
      try {
        const { error } = await supabase
          .from(table)
          .update({ location_id: targetLocationId })
          .in('id', rowIds)
        if (error) throw error
        ok += rowIds.length
        removedIds.add(m.id)
      } catch (e) {
        console.warn('[bulk-move-missing] failed', m.id, e.message)
        failed++
      }
    }
    // Drop them from the expected map so the review re-renders without
    // them (they're no longer "missing at this location" — they live
    // elsewhere now).
    if (removedIds.size > 0) {
      setPhysicalExpected(prev => {
        const next = new Map(prev)
        for (const id of removedIds) next.delete(id)
        return next
      })
    }
    setBulkMoveMissingRunning(false)
    addToast(
      `Moved ${ok} row${ok === 1 ? '' : 's'} → ${targetLocationName}${failed ? ` · ${failed} failed` : ''}`,
      failed ? 'info' : 'success'
    )
  }

  // Bulk-resolve all "Extras" — same two-case logic as the per-row button
  // (move live rows here, or re-add when nothing live exists). Sequential;
  // survivors (true failures) stay in the list.
  const [bulkMoveExtrasRunning, setBulkMoveExtrasRunning] = useState(false)
  const bulkMoveExtrasHere = async () => {
    if (!physicalLocationId) {
      addToast('No physical location id — internal error', 'error')
      return
    }
    if (physicalExtras.length === 0) return
    if (!confirm(
      `Resolve all ${physicalExtras.length} extra card${physicalExtras.length === 1 ? '' : 's'} → ${locationName}?\n\n` +
      `Cards with live rows elsewhere get MOVED here. Cards the app has as all-sold (or doesn't know) get RE-ADDED here with the scanned qty — the physical copy in your hand wins.`
    )) return
    setBulkMoveExtrasRunning(true)
    let moved = 0, readded = 0, failed = 0
    const survivors = []
    for (const e of physicalExtras) {
      try {
        const outcome = await resolveOneExtraCore(e)
        if (outcome === 'moved') moved++
        else readded++
      } catch (err) {
        console.warn('[bulk-resolve-extras] failed', e.id, err.message)
        failed++
        survivors.push(e)
      }
    }
    setPhysicalExtras(survivors)
    setBulkMoveExtrasRunning(false)
    addToast(
      `Moved ${moved} · re-added ${readded}${failed ? ` · ${failed} failed (still listed)` : ''}`,
      failed ? 'info' : 'success'
    )
  }

  // Bulk-push every "Sheet out of date" entry in the physical-count
  // review. Same per-row endpoint as pushPhysicalToSheet, sequential
  // so we don't hammer Google's API and so the staffer sees the
  // count tick down. Each successful push marks the local snapshot
  // as _just_pushed so the row drops from the section.
  const [pushAllStaleRunning, setPushAllStaleRunning] = useState(false)
  const pushAllSheetStale = async (entries) => {
    if (!entries || entries.length === 0) return
    if (!confirm(`Push ${entries.length} row${entries.length === 1 ? '' : 's'} of stale sheet data to match the app?`)) return
    setPushAllStaleRunning(true)
    let ok = 0, failed = 0
    for (const entry of entries) {
      const dbRowId = entry.info?.db_row_ids?.[0]
      if (!dbRowId) { failed++; continue }
      try {
        const r = await fetch('/api/sheet-mark-sold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, id: dbRowId }),
        })
        const body = await r.json()
        if (body.ok) {
          ok++
          setPhysicalSheetById(prev => {
            const next = { ...prev }
            if (next[entry.id]) next[entry.id] = { ...next[entry.id], _just_pushed: true }
            return next
          })
        } else {
          failed++
        }
      } catch { failed++ }
    }
    setPushAllStaleRunning(false)
    addToast(`Pushed ${ok} row${ok === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`,
             failed ? 'info' : 'success')
  }

  // Push sheet to match the app's current truth for an id. Used for the
  // "sheet out of date" case — physical and app agree, sheet hasn't
  // caught up yet. Hits the same /api/sheet-mark-sold endpoint as the
  // other audit modes (it handles qty>1 / sold / location all in one).
  const pushPhysicalToSheet = async (id, dbRowId) => {
    if (!dbRowId) {
      addToast(`Can't push: no app row for ${id}`, 'error')
      return
    }
    setPhysicalResolving(id)
    try {
      const r = await fetch('/api/sheet-mark-sold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: dbRowId }),
      })
      const body = await r.json()
      if (body.ok) {
        addToast(body.message || `Pushed ${id} to sheet`, 'success')
        // Update the local sheet snapshot so the row re-renders as clean.
        // We approximate by clearing the sheet entry — next sheet read
        // would pull the new value, but for now the green ✓ on the row
        // is enough confirmation.
        setPhysicalSheetById(prev => {
          const next = { ...prev }
          if (next[id]) next[id] = { ...next[id], _just_pushed: true }
          return next
        })
      } else {
        addToast(`Push failed: ${body.message || body.outcome}`, 'error')
      }
    } catch (err) {
      addToast(`Push failed: ${err.message}`, 'error')
    } finally {
      setPhysicalResolving(null)
    }
  }

  const idLabel = kind === 'single' ? 'TCG ID' : 'Cert #'

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Scale className="text-vault-gold" />
          Cards Audit
        </h1>
        <p className="text-gray-400 mt-1">Compare app database vs Google Sheet — find what's out of sync.</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Four ways to use this page:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li><span className="text-vault-gold">Quick scan</span> — scan or paste one {idLabel} to see a detailed side-by-side comparison.</li>
            <li><span className="text-vault-gold">Batch scan</span> — scan many cards in a row; each scan adds a row to the list. "Push all fixable" applies them in bulk.</li>
            <li><span className="text-vault-gold">Full audit</span> — finds every discrepancy across all cards (10-30s for ~2000 rows). "Push all fixable" too.</li>
            <li><span className="text-vault-gold">Physical count</span> — pick a location, scan every card you physically see there, then see what's missing (system says here, you didn't scan) and what's extra (you scanned, system didn't know).</li>
          </ol>

          <div className="mt-3 p-3 bg-vault-darker/40 border border-vault-border rounded">
            <p className="font-medium text-white mb-2">Who's right when the two disagree?</p>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider text-vault-gold bg-vault-gold/15 border border-vault-gold/40 flex-shrink-0 mt-0.5">App → Sheet</span>
                <span><b className="text-white">App wins.</b> Sales and movements happen in the app, so when the app says "sold" or "qty 4", that's truth. Click <i>Push to sheet</i> and the sheet gets fixed.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/40 flex-shrink-0 mt-0.5">Review</span>
                <span><b className="text-white">Could be either side.</b> Usually because the sheet was manually edited (boss marked something sold for a reason we don't know, or wrote a different location). No one-click — investigate, then update whichever side is wrong.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider text-gray-400 bg-vault-darker border border-vault-border flex-shrink-0 mt-0.5">Info only</span>
                <span><b className="text-white">Nothing broken.</b> e.g. card was added in-app and never went through the sheet, or the price hasn't synced yet — the hourly sheet→app sync will catch up on its own.</span>
              </li>
            </ul>
          </div>

          <p className="text-cyan-400 text-xs mt-3">💡 Singles read from <span className="font-mono text-vault-gold">Master Singles</span> only (New Singles is a staging area). Pick a location below to audit qty + location together for that room.</p>
        </div>
      </Instructions>

      {/* Kind toggle + (singles only) location selector — sits together on one row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
          <button
            type="button"
            onClick={() => { setKind('single'); setScanResult(null); setFullResult(null); }}
            className={`px-4 py-2 text-sm rounded-md transition ${kind === 'single' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}
          >
            🎴 Singles
          </button>
          <button
            type="button"
            onClick={() => { setKind('slab'); setScanResult(null); setFullResult(null); }}
            className={`px-4 py-2 text-sm rounded-md transition ${kind === 'slab' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}
          >
            💎 Slabs
          </button>
        </div>

        {kind === 'single' && (
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-gray-500" />
            <select
              value={locationName}
              onChange={(e) => { setLocationName(e.target.value); setScanResult(null); setFullResult(null); }}
              className="text-sm py-1.5 px-2 bg-vault-darker/40 border border-vault-border rounded-md text-white"
            >
              <option value="">All locations</option>
              {locations.map(l => (
                <option key={l.id} value={l.name}>{l.name}</option>
              ))}
            </select>
            {locationName && (
              <span className="text-[10px] text-gray-500">
                comparing qty + location at this room
              </span>
            )}
          </div>
        )}
      </div>

      {/* Mode tabs — pick which workflow you're in so the page stays focused.
          Quick scan: one card.  Batch scan: many in a row.  Full audit: every. */}
      <div className="mb-4">
        <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
          <button
            type="button"
            onClick={() => { setAuditMode('quick') }}
            className={`px-4 py-2 text-sm rounded-md transition flex items-center gap-1.5 ${auditMode === 'quick' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}
          >
            <Search size={14} /> Quick scan
          </button>
          <button
            type="button"
            onClick={() => { setAuditMode('batch') }}
            className={`px-4 py-2 text-sm rounded-md transition flex items-center gap-1.5 ${auditMode === 'batch' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}
          >
            <ScanLine size={14} /> Batch scan {batchOrder.length > 0 && <span className="text-[10px]">({batchOrder.length})</span>}
          </button>
          <button
            type="button"
            onClick={() => { setAuditMode('full') }}
            className={`px-4 py-2 text-sm rounded-md transition flex items-center gap-1.5 ${auditMode === 'full' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}
          >
            <FileSearch size={14} /> Full audit
          </button>
          <button
            type="button"
            onClick={() => { setAuditMode('physical') }}
            className={`px-4 py-2 text-sm rounded-md transition flex items-center gap-1.5 ${auditMode === 'physical' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}
          >
            <Boxes size={14} /> Physical count
            {physicalState !== 'setup' && <span className="text-[10px]">({physicalScanned.size + physicalExtras.length})</span>}
          </button>
        </div>
      </div>

      {/* ─── Quick scan mode (one card) ─────────────────────────────── */}
      {auditMode === 'quick' && (
        <div className="card mb-5">
          <h2 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <Search size={18} /> Quick scan
          </h2>
          <p className="text-xs text-gray-500 mb-3">Scan one card to see a detailed side-by-side comparison.</p>
          <div className="flex items-stretch gap-2">
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={onScanKey}
              placeholder={`Scan or type a ${idLabel}…`}
              disabled={scanning}
              className="flex-1 px-3 py-2 text-sm font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={() => runScan()}
              disabled={scanning || !scanInput.trim()}
              className="btn btn-primary px-4"
            >
              {scanning ? <Loader2 size={16} className="animate-spin" /> : 'Compare'}
            </button>
          </div>

          {scanResult && (
            <div className="mt-4 space-y-3">
              <ScanResult result={scanResult} idLabel={idLabel} pushToSheet={pushToSheet} pushingId={pushingId} />
            </div>
          )}
        </div>
      )}

      {/* ─── Batch scan mode (scan many in a row) ──────────────────── */}
      {auditMode === 'batch' && (
        <div className="card mb-5">
          <h2 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <ScanLine size={18} /> Batch scan
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Scan one card after another. Each scan auto-checks DB vs sheet and adds a row below.
            Same card scanned twice = the newer result replaces the older row.
          </p>
          <div className="flex items-stretch gap-2">
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); runBatchScan() }
              }}
              placeholder={`Scan a ${idLabel} and press Enter — repeats with each new scan…`}
              disabled={scanning}
              className="flex-1 px-3 py-2 text-sm font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={() => runBatchScan()}
              disabled={scanning || !scanInput.trim()}
              className="btn btn-secondary px-4"
            >
              {scanning ? <Loader2 size={16} className="animate-spin" /> : 'Add to batch'}
            </button>
          </div>

          {batchOrder.length > 0 && (
            <BatchResults
              batchById={batchById}
              batchOrder={batchOrder}
              batchExpanded={batchExpanded}
              setBatchExpanded={setBatchExpanded}
              idLabel={idLabel}
              clearBatch={clearBatch}
              removeBatchEntry={removeBatchEntry}
              pushToSheet={pushToSheet}
              pushingId={pushingId}
              pushAllBatchFixable={pushAllBatchFixable}
              batchPushAllRunning={batchPushAllRunning}
            />
          )}
        </div>
      )}

      {/* ─── Full audit mode (every card) ──────────────────────────── */}
      {auditMode === 'full' && (
        <div className="card mb-5">
          <h2 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <FileSearch size={18} /> Full audit
          </h2>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm text-gray-400">
              Pulls every {kind === 'single' ? 'single' : 'slab'} from the app + every row from the sheet and lists discrepancies.
            </p>
            <button
              type="button"
              onClick={runFull}
              disabled={fullRunning}
              className="btn btn-primary px-4 flex items-center gap-2"
            >
              {fullRunning ? <><Loader2 size={16} className="animate-spin" /> Auditing…</> : <><RefreshCw size={16} /> Run full audit</>}
            </button>
          </div>

          {fullResult && (
            <FullAuditResults
              result={fullResult}
              kind={kind}
              idLabel={idLabel}
              filterCode={filterCode}
              setFilterCode={setFilterCode}
              pushToSheet={pushToSheet}
              pushingId={pushingId}
              pushAllFullFixable={pushAllFullFixable}
              pushAllFullRunning={pushAllFullRunning}
            />
          )}
        </div>
      )}

      {/* ─── Physical count mode (reality vs system) ───────────────── */}
      {auditMode === 'physical' && (
        <div className="card mb-5">
          <h2 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <Boxes size={18} /> Physical count
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Pick a location at the top of the page, click <span className="text-vault-gold">Start counting</span>, then scan
            every card you physically see in that room. When you're done, the review shows what's missing (system says it's
            here but you didn't scan) and what's extra (you scanned but system doesn't know).
          </p>

          {physicalState === 'setup' && (
            <PhysicalSetup
              kind={kind}
              locationName={locationName}
              physicalLoading={physicalLoading}
              startPhysicalCount={startPhysicalCount}
            />
          )}

          {physicalState === 'scanning' && (
            <PhysicalScanning
              kind={kind}
              idLabel={idLabel}
              locationName={locationName}
              expected={physicalExpected}
              scanned={physicalScanned}
              extras={physicalExtras}
              scanInput={scanInput}
              setScanInput={setScanInput}
              inputRef={inputRef}
              onScan={onPhysicalScan}
              onKey={onPhysicalScanKey}
              undoOneScanned={undoOnePhysicalScan}
              undoOneExtra={undoOneExtraScan}
              stopCount={stopPhysicalCount}
              resetCount={resetPhysicalCount}
            />
          )}

          {physicalState === 'review' && (
            <PhysicalReview
              kind={kind}
              idLabel={idLabel}
              locationName={locationName}
              locations={locations}
              physicalLocationId={physicalLocationId}
              expected={physicalExpected}
              scanned={physicalScanned}
              extras={physicalExtras}
              sheetById={physicalSheetById}
              resetCount={resetPhysicalCount}
              resolveExtraMoveHere={resolveExtraMoveHere}
              pushPhysicalToSheet={pushPhysicalToSheet}
              pushAllSheetStale={pushAllSheetStale}
              pushAllStaleRunning={pushAllStaleRunning}
              bulkMoveMissingTo={bulkMoveMissingTo}
              bulkMoveMissingRunning={bulkMoveMissingRunning}
              bulkMoveExtrasHere={bulkMoveExtrasHere}
              bulkMoveExtrasRunning={bulkMoveExtrasRunning}
              physicalResolving={physicalResolving}
              backToScanning={() => setPhysicalState('scanning')}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ScanResult({ result, idLabel, pushToSheet, pushingId }) {
  const { sheet, db, issues, id, location_filter } = result
  return (
    <div className={`p-3 rounded-lg border ${issues.length === 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-vault-border bg-vault-darker/40'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm">
          <span className="text-gray-400">Scanned {idLabel}: </span>
          <span className="text-white font-mono font-semibold">{id}</span>
          {location_filter && (
            <span className="ml-2 text-xs text-vault-gold/80">@ {location_filter.name}</span>
          )}
        </div>
        {issues.length === 0 && (
          <span className="text-xs text-emerald-300 flex items-center gap-1">
            <CheckCircle size={14} /> Matches
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="bg-vault-darker rounded p-3">
          <div className="text-gray-500 uppercase tracking-wider mb-2">App (Supabase)</div>
          {db ? (
            <dl className="space-y-1">
              <Pair k="Status" v={db.status || '—'} />
              <Pair k="Remaining qty (total)" v={db.remaining_qty} />
              {location_filter && (
                <Pair
                  k={`Qty @ ${location_filter.name}`}
                  v={db.qty_at_filter ?? 0}
                  highlight={db.qty_at_filter > 0 ? 'gold' : 'red'}
                />
              )}
              <Pair k="Sold qty (history)" v={db.sold_qty} />
              {db.price != null && <Pair k="Price" v={`$${db.price.toFixed(2)}`} />}
              {db.locations?.length > 0 && (
                <Pair
                  k="Held at"
                  v={db.locations.map(l => `${l.qty} × ${l.name}`).join(', ')}
                />
              )}
              <Pair k="Rows in DB" v={db.row_ids.length} />
            </dl>
          ) : (
            <p className="text-gray-500 italic">No row with this {idLabel} in the app.</p>
          )}
        </div>
        <div className="bg-vault-darker rounded p-3">
          <div className="text-gray-500 uppercase tracking-wider mb-2">Sheet (Google)</div>
          {sheet ? (
            <dl className="space-y-1">
              <Pair k="Tab" v={sheet.tab} />
              <Pair k="Row" v={sheet.sheet_row} />
              {sheet.qty != null && <Pair k="Qty" v={sheet.qty} />}
              <Pair k="Status" v={sheet.status || '(empty)'} />
              {'location' in sheet && (
                <Pair k="Location" v={sheet.location || '(empty)'} />
              )}
              {sheet.price != null && <Pair k="Price" v={`$${sheet.price.toFixed(2)}`} />}
            </dl>
          ) : (
            <p className="text-gray-500 italic">No row with this {idLabel} in the sheet.</p>
          )}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mt-3 space-y-2">
          {issues.map((iss, i) => (
            <IssueRow key={i} issue={{ ...iss, id, db, sheet }} pushToSheet={pushToSheet} pushingId={pushingId} />
          ))}
        </div>
      )}
    </div>
  )
}

function FullAuditResults({
  result, kind, idLabel,
  filterCode, setFilterCode,
  pushToSheet, pushingId,
  pushAllFullFixable, pushAllFullRunning,
}) {
  const { summary, issues } = result
  const filtered = filterCode ? issues.filter(i => i.code === filterCode) : issues
  // Count fixable across the entire audit (dedup by id), not just the
  // current filter — that's what the "Push all fixable" button writes.
  const fixableIds = new Set()
  for (const iss of issues) {
    if (iss.suggested_action && iss.db?.row_ids?.length) fixableIds.add(iss.id)
  }
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
        <Stat label="App ids" value={summary.total_db_ids} />
        <Stat label="Sheet ids" value={summary.total_sheet_ids} />
        <Stat label="Issues found" value={summary.total_issues} highlight={summary.total_issues > 0} />
        <Stat label="Fixable now" value={fixableIds.size} highlight={fixableIds.size > 0} />
      </div>

      {/* Filter chips + bulk action */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        {Object.keys(summary.by_code).length > 0 && (
          <div className="flex flex-wrap gap-1">
            <FilterChip active={filterCode === ''} onClick={() => setFilterCode('')}>All ({summary.total_issues})</FilterChip>
            {Object.entries(summary.by_code).map(([code, count]) => (
              <FilterChip key={code} active={filterCode === code} onClick={() => setFilterCode(code)}>
                {CODE_LABELS[code] || code} ({count})
              </FilterChip>
            ))}
          </div>
        )}
        {fixableIds.size > 0 && (
          <button
            type="button"
            onClick={pushAllFullFixable}
            disabled={pushAllFullRunning}
            className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold flex items-center gap-1 whitespace-nowrap"
          >
            {pushAllFullRunning
              ? <><Loader2 size={12} className="animate-spin" /> Pushing…</>
              : <><ExternalLink size={12} /> Push all fixable ({fixableIds.size})</>}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-emerald-300 text-sm flex items-center gap-2 py-3">
          <CheckCircle size={16} /> No issues {filterCode ? 'in this category' : ''}.
        </p>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {filtered.map((iss, i) => (
            <IssueRow key={i} issue={iss} idLabel={idLabel} pushToSheet={pushToSheet} pushingId={pushingId} />
          ))}
        </div>
      )}
    </div>
  )
}

// Per-issue trust-tag: who is the source of truth for this kind of issue,
// and what's the recommended action? Three buckets:
//   db_wins   → App database is right; the sheet hasn't caught up. One-click
//               push will write the app's truth into the sheet.
//   review    → Either could be right; need a human to decide. We DON'T
//               offer a one-click action — the staff must investigate.
//   info_only → Nothing to do programmatically (e.g. card was added in-app
//               and never went through the sheet; or price drift below
//               tolerance — hourly sync will catch up).
const TRUST_BUCKET = {
  // App (DB) is the truth. Sales happen in the app, so when DB says sold
  // or qty=N, that's reality. Push to sheet is safe.
  sold_but_sheet_shows_available:        { bucket: 'db_wins', label: 'App says: sold. Sheet will be updated.' },
  qty_mismatch:                          { bucket: 'db_wins', label: 'App qty wins. Sheet will be updated.' },
  qty_mismatch_at_location:              { bucket: 'db_wins', label: 'App qty at this location wins. Sheet will be updated.' },
  // Ambiguous — sheet says something the app disagrees with, but the
  // sheet may have been manually edited by boss for a reason we don't
  // know. Surface for human decision.
  sheet_says_sold_but_inventory_remains: { bucket: 'review',  label: 'Needs review — was the sheet manually marked sold? Or did the app lose a sale event?' },
  sheet_says_sold_but_app_says_available:{ bucket: 'review',  label: 'Needs review — likely a manual sheet edit. Check before changing either side.' },
  not_at_this_location:                  { bucket: 'review',  label: 'Needs review — physically locate the card, then update either side.' },
  location_mismatch:                     { bucket: 'review',  label: 'Needs review — verify where the card really is.' },
  missing_in_db:                         { bucket: 'review',  label: 'Needs review — has the hourly sheet→app sync run? Or was the row deleted?' },
  // Informational — not actually broken.
  missing_in_sheet:                      { bucket: 'info_only', label: 'Normal — card was added in-app, never went through the sheet.' },
  location_missing_in_sheet:             { bucket: 'info_only', label: 'Sheet location is blank. Optional: fill it in for clarity.' },
  price_mismatch:                        { bucket: 'info_only', label: 'Hourly sheet→app sync will catch up.' },
}

const BUCKET_STYLES = {
  db_wins:   { tag: 'App → Sheet',  color: 'text-vault-gold bg-vault-gold/15 border border-vault-gold/40' },
  review:    { tag: 'Review',       color: 'text-amber-300 bg-amber-500/10 border border-amber-500/40' },
  info_only: { tag: 'Info only',    color: 'text-gray-400 bg-vault-darker border border-vault-border' },
}

function IssueRow({ issue, idLabel = 'ID', pushToSheet, pushingId }) {
  const sev = SEVERITY[issue.severity] || SEVERITY.info
  const Icon = sev.icon
  const isPushing = pushingId === issue.id
  const trust = TRUST_BUCKET[issue.code] || { bucket: 'review', label: 'Unknown — review manually.' }
  const trustStyle = BUCKET_STYLES[trust.bucket]
  return (
    <div className={`p-3 rounded border ${sev.border} ${sev.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon size={16} className={`${sev.color} flex-shrink-0 mt-0.5`} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
              <span className={`text-xs uppercase tracking-wider ${sev.color}`}>
                {CODE_LABELS[issue.code] || issue.code}
              </span>
              <span className="text-white font-mono text-xs">{idLabel}: {issue.id}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${trustStyle.color}`}>
                {trustStyle.tag}
              </span>
            </div>
            <p className="text-xs text-gray-300">{issue.message}</p>
            <p className="text-[10px] text-gray-500 mt-1 italic">{trust.label}</p>
            {issue.sheet && (
              <p className="text-[10px] text-gray-500 mt-1">
                Sheet: {issue.sheet.tab} row {issue.sheet.sheet_row}
                {issue.sheet.qty != null && ` · qty ${issue.sheet.qty}`}
                {issue.sheet.status && ` · status "${issue.sheet.status}"`}
              </p>
            )}
          </div>
        </div>
        {issue.suggested_action && issue.db && (
          <button
            type="button"
            onClick={() => pushToSheet(issue)}
            disabled={isPushing}
            className="text-xs px-2 py-1 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 whitespace-nowrap flex items-center gap-1"
          >
            {isPushing ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
            Push to sheet
          </button>
        )}
      </div>
    </div>
  )
}

function BatchResults({
  batchById, batchOrder, batchExpanded, setBatchExpanded,
  idLabel, clearBatch, removeBatchEntry,
  pushToSheet, pushingId, pushAllBatchFixable, batchPushAllRunning,
}) {
  // Tally stats once across the whole batch — small list, no perf concern.
  let clean = 0, withIssues = 0, totalIssues = 0, fixable = 0
  for (const id of batchOrder) {
    const r = batchById[id]
    if (!r) continue
    const n = r.issues?.length || 0
    if (n === 0) clean++
    else { withIssues++; totalIssues += n }
    for (const iss of r.issues || []) {
      if (iss.suggested_action) fixable++
    }
  }
  return (
    <div className="mt-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
        <Stat label="Scanned" value={batchOrder.length} />
        <Stat label="Clean" value={clean} />
        <Stat label="With issues" value={withIssues} highlight={withIssues > 0} />
        <Stat label="Fixable now" value={fixable} />
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        {fixable > 0 && (
          <button
            type="button"
            onClick={pushAllBatchFixable}
            disabled={batchPushAllRunning}
            className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold flex items-center gap-1"
          >
            {batchPushAllRunning
              ? <><Loader2 size={12} className="animate-spin" /> Pushing…</>
              : <><ExternalLink size={12} /> Push all fixable ({fixable})</>}
          </button>
        )}
        <button
          type="button"
          onClick={clearBatch}
          className="text-xs px-3 py-1.5 text-gray-300 hover:text-red-400 border border-vault-border rounded flex items-center gap-1"
        >
          <Trash2 size={12} /> Clear batch
        </button>
      </div>

      {/* Per-card rows (newest first) */}
      <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
        {batchOrder.map(id => {
          const r = batchById[id]
          if (!r) return null
          const issueCount = r.issues?.length || 0
          const isExpanded = !!batchExpanded[id]
          return (
            <div
              key={id}
              className={`border rounded ${issueCount === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setBatchExpanded(prev => ({ ...prev, [id]: !prev[id] }))}
                  className="text-gray-400 hover:text-white"
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span className="font-mono text-xs text-white flex-shrink-0">{id}</span>
                {issueCount === 0 ? (
                  <span className="text-xs text-emerald-300 flex items-center gap-1">
                    <CheckCircle size={12} /> Matches
                  </span>
                ) : (
                  <span className="text-xs text-amber-300 truncate flex-1">
                    {issueCount} issue{issueCount === 1 ? '' : 's'}: {r.issues.map(i => CODE_LABELS[i.code] || i.code).join(' · ')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeBatchEntry(id)}
                  className="text-gray-500 hover:text-red-400 flex-shrink-0"
                  title="Remove from batch"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {isExpanded && (
                <div className="p-3 border-t border-vault-border/40">
                  <ScanResult result={r} idLabel={idLabel} pushToSheet={pushToSheet} pushingId={pushingId} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Physical count: 3 sub-views ────────────────────────────────────

function PhysicalSetup({ kind, locationName, physicalLoading, startPhysicalCount }) {
  return (
    <div className="bg-vault-darker rounded p-4 text-sm">
      <div className="flex items-center gap-3 mb-3">
        <MapPin size={16} className="text-gray-500" />
        <div className="flex-1">
          <div className="text-gray-400 text-xs">Counting at</div>
          <div className="text-white font-semibold">
            {locationName || <span className="text-amber-300">— pick a location at the top of the page —</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={startPhysicalCount}
          disabled={physicalLoading || !locationName}
          className="btn btn-primary px-4 flex items-center gap-2"
        >
          {physicalLoading
            ? <><Loader2 size={14} className="animate-spin" /> Loading…</>
            : <><Play size={14} /> Start counting</>}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        We'll snapshot what the app thinks is at <b className="text-gray-300">{locationName || 'this location'}</b> right
        now, then track what you actually scan against that snapshot.
        Sales that happen during your count won't move the goalposts.
      </p>
    </div>
  )
}

function PhysicalScanning({
  kind, idLabel, locationName,
  expected, scanned, extras,
  scanInput, setScanInput, inputRef, onScan, onKey,
  undoOneScanned, undoOneExtra,
  stopCount, resetCount,
}) {
  // Derive running counts. A card with expected_qty=5 counts as 1 unique
  // id, and progress is "X of 5 scanned". We tally for the stats card.
  let totalExpectedUnits = 0
  let totalScannedUnits = 0
  let uniqueDone = 0    // unique ids where scanned >= expected
  for (const [, info] of expected) {
    totalExpectedUnits += info.expected_qty
  }
  for (const [id, count] of scanned) {
    totalScannedUnits += count
    const e = expected.get(id)
    if (e && count >= e.expected_qty) uniqueDone++
  }
  const extrasCount = extras.length
  const extrasUnits = extras.reduce((s, e) => s + e.scanned_count, 0)
  const progressPct = totalExpectedUnits > 0
    ? Math.min(100, Math.round(100 * totalScannedUnits / totalExpectedUnits))
    : 0

  return (
    <div>
      <div className="mb-3 text-xs text-gray-400 flex flex-wrap items-center gap-2">
        <MapPin size={12} className="text-gray-500" />
        <span>Counting at <span className="text-vault-gold font-semibold">{locationName}</span></span>
        <span className="text-gray-600">·</span>
        <span>{expected.size} unique expected, {totalExpectedUnits} units total</span>
      </div>

      {/* Scan input */}
      <div className="flex items-stretch gap-2 mb-3">
        <input
          ref={inputRef}
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={`Scan a ${idLabel} → press Enter (or just use a barcode scanner)…`}
          className="flex-1 px-3 py-2 text-sm font-mono"
          autoFocus
        />
        <button
          type="button"
          onClick={() => onScan()}
          disabled={!scanInput.trim()}
          className="btn btn-secondary px-4"
        >
          Add
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-xs">
        <Stat label="Expected" value={`${expected.size} (${totalExpectedUnits}u)`} />
        <Stat label="Scanned" value={`${scanned.size} (${totalScannedUnits}u)`} />
        <Stat label="Done" value={uniqueDone} highlight={uniqueDone > 0 && uniqueDone === expected.size ? 'gold' : null} />
        <Stat label="Still need" value={Math.max(0, expected.size - uniqueDone)} />
        <Stat label="Extras" value={extrasCount} highlight={extrasCount > 0} />
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="w-full h-2 bg-vault-darker rounded overflow-hidden">
          <div className="h-full bg-vault-gold transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5 text-right">{progressPct}% scanned</div>
      </div>

      {/* Recent activity — staff can confirm last few scans landed AND
          undo accidental double-scans without restarting the count. */}
      {(scanned.size > 0 || extras.length > 0) && (
        <details className="mb-3">
          <summary className="cursor-pointer text-xs text-gray-400 hover:text-white">
            Activity ({scanned.size + extras.length}) — click −1 to undo a wrong scan
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Scanned (in expected)</div>
              <div className="bg-vault-darker rounded p-2 max-h-48 overflow-y-auto">
                {[...scanned.entries()].map(([id, count]) => {
                  const info = expected.get(id)
                  const exp = info?.expected_qty || 0
                  const status = count > exp ? `${count}/${exp} ⚠ over`
                              : count >= exp ? '✓'
                              : count > 0 ? `${count}/${exp}` : ''
                  const tone = count > exp ? 'text-red-300'
                            : count >= exp ? 'text-emerald-300'
                            : 'text-amber-300'
                  return (
                    <div key={id} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-gray-300 truncate font-mono flex-1">{id}</span>
                      <span className={`${tone} whitespace-nowrap`}>{status}</span>
                      <button
                        type="button"
                        onClick={() => undoOneScanned(id)}
                        className="text-[10px] px-1.5 py-0.5 text-gray-400 hover:text-red-300 hover:bg-red-500/10 border border-vault-border rounded"
                        title="Undo one scan of this card"
                      >
                        −1
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Extras (not expected)</div>
              <div className="bg-vault-darker rounded p-2 max-h-48 overflow-y-auto">
                {extras.length === 0 ? (
                  <span className="text-gray-600 italic">None yet</span>
                ) : extras.map(e => (
                  <div key={e.id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="text-amber-300 font-mono truncate flex-1">{e.id}</span>
                    {e.scanned_count > 1 && <span className="text-gray-500 whitespace-nowrap">×{e.scanned_count}</span>}
                    <button
                      type="button"
                      onClick={() => undoOneExtra(e.id)}
                      className="text-[10px] px-1.5 py-0.5 text-gray-400 hover:text-red-300 hover:bg-red-500/10 border border-vault-border rounded"
                      title="Undo one scan of this card"
                    >
                      −1
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      )}

      {/* Done + Reset */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={resetCount}
          className="text-xs px-3 py-1.5 text-gray-400 hover:text-red-400 border border-vault-border rounded flex items-center gap-1"
        >
          <RotateCcw size={12} /> Start over
        </button>
        <button
          type="button"
          onClick={stopCount}
          className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 font-semibold flex items-center gap-1"
        >
          <Square size={12} /> Done — show review
        </button>
      </div>
    </div>
  )
}

function PhysicalReview({
  kind, idLabel, locationName, locations, physicalLocationId,
  expected, scanned, extras, sheetById,
  resetCount, resolveExtraMoveHere, pushPhysicalToSheet,
  pushAllSheetStale, pushAllStaleRunning,
  bulkMoveMissingTo, bulkMoveMissingRunning,
  bulkMoveExtrasHere, bulkMoveExtrasRunning,
  physicalResolving, backToScanning,
}) {
  // Local state for the missing-bulk destination picker. Defaults to
  // Master Inventory if present — the most common case for "where did
  // these missing cards probably go?"
  const masterLoc = (locations || []).find(l => l.name === 'Master Inventory')
  const otherLocations = (locations || []).filter(l => l.id !== physicalLocationId)
  const [missingDestinationId, setMissingDestinationId] = useState(masterLoc?.id || otherLocations[0]?.id || '')
  // Categorize every id, and separately detect "sheet out of date" cases
  // by comparing sheet snapshot to physical + app truth.
  const matched = []        // physical == app (exactly)
  const overCount = []      // physical > app — accidental double-scan, or app qty too low
  const sheetStale = []     // physical == app, but sheet differs (push-to-sheet candidates)
  const partial = []        // physical < app, physical > 0
  const missing = []        // physical == 0, app > 0
  for (const [id, info] of expected) {
    const physical = scanned.get(id) || 0
    const sheetInfo = sheetById[id] || null
    const sheetQty = sheetInfo?.qty
    const sheetStatus = sheetInfo?.status
    const appQty = info.expected_qty
    const row = { id, info, physical, app: appQty, sheet: sheetInfo }

    if (physical > appQty) {
      // Most likely: a double-trigger from the scanner, or staff scanned
      // the same card twice by accident. Slight chance: real life has
      // more copies than app thought (intake mis-recorded). Either way
      // staff should investigate before we let it count as matched.
      overCount.push(row)
    } else if (physical === appQty) {
      matched.push(row)
      // Subset: physical == app but sheet is wrong (qty diff or sheet says sold).
      if (sheetInfo && !sheetInfo._just_pushed) {
        const sheetWrong = (sheetQty != null && sheetQty !== appQty)
                       || (sheetStatus === 'sold')   // app has units, sheet says sold
        if (sheetWrong) sheetStale.push(row)
      }
    } else if (physical === 0) missing.push(row)
    else partial.push(row)
  }

  const nameOf = (info) => {
    if (!info) return ''
    if (kind === 'single') return [info.card_name, info.card_number].filter(Boolean).join(' ')
    return [info.item_name, info.grading_company].filter(Boolean).join(' · ')
  }

  return (
    <div>
      <div className="mb-3 text-xs text-gray-400 flex flex-wrap items-center gap-2">
        <MapPin size={12} className="text-gray-500" />
        <span>Review for <span className="text-vault-gold font-semibold">{locationName}</span></span>
        <span className="text-gray-600">·</span>
        <span>showing 3-way comparison: <span className="text-emerald-300">Physical</span> · <span className="text-vault-gold">App</span> · <span className="text-cyan-300">Sheet</span></span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 text-xs">
        <Stat label="Matched ✓" value={matched.length} highlight={matched.length > 0 ? 'gold' : null} />
        <Stat label="Partial" value={partial.length} highlight={partial.length > 0} />
        <Stat label="Missing" value={missing.length} highlight={missing.length > 0} />
        <Stat label="Over-scanned" value={overCount.length} highlight={overCount.length > 0} />
        <Stat label="Extras" value={extras.length} highlight={extras.length > 0} />
        <Stat label="Sheet stale" value={sheetStale.length} highlight={sheetStale.length > 0} />
      </div>

      {/* Missing — system says here, you didn't scan. If staff just
          finished scanning the whole room, these probably aren't here
          at all; bulk-move them to wherever they likely went. */}
      {missing.length > 1 && (
        <div className="mb-1 flex flex-wrap items-center justify-end gap-2 text-xs">
          <span className="text-gray-400">If these aren't here, move them to:</span>
          <select
            value={missingDestinationId}
            onChange={(e) => setMissingDestinationId(e.target.value)}
            className="text-xs py-1 px-2 bg-vault-darker/40 border border-vault-border rounded text-white"
            disabled={bulkMoveMissingRunning}
          >
            {otherLocations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => bulkMoveMissingTo(
              missing,
              missingDestinationId,
              otherLocations.find(l => l.id === missingDestinationId)?.name || ''
            )}
            disabled={bulkMoveMissingRunning || !missingDestinationId}
            className="px-3 py-1.5 bg-red-500/25 border border-red-500/50 text-red-300 rounded hover:bg-red-500/35 disabled:opacity-50 font-semibold flex items-center gap-1"
          >
            {bulkMoveMissingRunning
              ? <><Loader2 size={12} className="animate-spin" /> Moving…</>
              : <><ArrowRightCircle size={12} /> Bulk move {missing.length}</>}
          </button>
        </div>
      )}
      <ThreeWaySection
        title="Missing — system says these should be here, you didn't scan them"
        bucket="missing"
        items={missing.map(m => ({
          id: m.id, name: nameOf(m.info),
          physical: m.physical, app: m.app, sheet: m.sheet,
          severity: 'critical',
        }))}
        emptyText="Nothing missing! Every expected card was scanned."
      />

      {/* Partial */}
      <ThreeWaySection
        title="Partial — scanned fewer than expected"
        bucket="partial"
        items={partial.map(p => ({
          id: p.id, name: nameOf(p.info),
          physical: p.physical, app: p.app, sheet: p.sheet,
          severity: 'warning',
        }))}
        emptyText="No partial counts."
      />

      {/* Over-scanned — you found MORE than app expected. Usually a
          double-trigger from the scanner; staff should review and either
          accept the higher count (app was wrong) or go back and undo. */}
      <ThreeWaySection
        title="Over-scanned — you scanned MORE than app expected (double-trigger? or app qty wrong?)"
        bucket="over"
        items={overCount.map(o => ({
          id: o.id, name: nameOf(o.info),
          physical: o.physical, app: o.app, sheet: o.sheet,
          severity: 'warning',
        }))}
        emptyText="Nothing over-counted."
      />

      {/* Extras — scanned but not in app at this location.
          Each extra is enriched on the fly with its sheet snapshot so
          staff can see if the sheet thinks it belongs here.
          Bulk-move-all-here button at top so 116 extras don't need 116 clicks. */}
      {extras.length > 1 && (
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={bulkMoveExtrasHere}
            disabled={bulkMoveExtrasRunning}
            className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold flex items-center gap-1"
          >
            {bulkMoveExtrasRunning
              ? <><Loader2 size={12} className="animate-spin" /> Moving…</>
              : <><ArrowRightCircle size={12} /> Move all {extras.length} app → {locationName}</>}
          </button>
        </div>
      )}
      <ThreeWaySection
        title="Extras — you scanned these but app didn't expect them here"
        bucket="extras"
        items={extras.map(e => ({
          id: e.id, name: '',
          physical: e.scanned_count, app: 0, sheet: sheetById[e.id] || null,
          severity: 'warning',
          action: (
            <button
              type="button"
              onClick={() => resolveExtraMoveHere(e)}
              disabled={physicalResolving === e.id}
              className="text-[10px] px-2 py-1 bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded hover:bg-vault-gold/30 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              {physicalResolving === e.id
                ? <Loader2 size={10} className="animate-spin" />
                : <><ArrowRightCircle size={10} /> Move app → {locationName}</>}
            </button>
          ),
        }))}
        emptyText="No surprise cards — everything you scanned was expected."
      />

      {/* Sheet out of date — physical and app agree but sheet wasn't pushed yet.
          One-click Push to sheet per row using the existing /api/sheet-mark-sold,
          plus a header "Push all" so 295 stale rows can be cleared in one click. */}
      {sheetStale.length > 1 && (
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={() => pushAllSheetStale(sheetStale)}
            disabled={pushAllStaleRunning}
            className="text-xs px-3 py-1.5 bg-cyan-500/25 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/35 disabled:opacity-50 font-semibold flex items-center gap-1"
          >
            {pushAllStaleRunning
              ? <><Loader2 size={12} className="animate-spin" /> Pushing…</>
              : <><ExternalLink size={12} /> Push all {sheetStale.length} stale rows to sheet</>}
          </button>
        </div>
      )}
      <ThreeWaySection
        title="Sheet out of date — physical and app agree, sheet hasn't caught up"
        bucket="sheet_stale"
        items={sheetStale.map(s => ({
          id: s.id, name: nameOf(s.info),
          physical: s.physical, app: s.app, sheet: s.sheet,
          severity: 'info',
          action: (
            <button
              type="button"
              onClick={() => pushPhysicalToSheet(s.id, s.info.db_row_ids?.[0])}
              disabled={physicalResolving === s.id || pushAllStaleRunning}
              className="text-[10px] px-2 py-1 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 rounded hover:bg-cyan-500/30 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              {physicalResolving === s.id
                ? <Loader2 size={10} className="animate-spin" />
                : <><ExternalLink size={10} /> Push to sheet</>}
            </button>
          ),
        }))}
        emptyText="Sheet is in sync with reality on every matched card."
      />

      {/* Matched — collapsed; just the 3-way values for confidence */}
      <details className="mb-3">
        <summary className="cursor-pointer text-xs text-emerald-300 hover:text-emerald-200">
          ✓ Fully matched ({matched.length - sheetStale.length}) — click to expand
        </summary>
        <div className="mt-2 bg-vault-darker rounded p-2 max-h-48 overflow-y-auto text-xs">
          {matched.filter(m => !sheetStale.some(s => s.id === m.id)).map(m => (
            <div key={m.id} className="flex justify-between gap-2">
              <span className="text-gray-300 truncate">
                <span className="font-mono">{m.id}</span>
                {nameOf(m.info) && <span className="text-gray-500 ml-2">{nameOf(m.info)}</span>}
              </span>
              <span className="text-emerald-300 font-mono whitespace-nowrap">
                P{m.physical} · A{m.app}{m.sheet?.qty != null && ` · S${m.sheet.qty}`}
              </span>
            </div>
          ))}
        </div>
      </details>

      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-vault-border/50">
        <button
          type="button"
          onClick={backToScanning}
          className="text-xs px-3 py-1.5 text-gray-300 hover:text-white border border-vault-border rounded flex items-center gap-1"
        >
          ← Back to scanning
        </button>
        <button
          type="button"
          onClick={resetCount}
          className="text-xs px-3 py-1.5 text-gray-300 hover:text-red-400 border border-vault-border rounded flex items-center gap-1"
        >
          <RotateCcw size={12} /> Done, reset
        </button>
      </div>
    </div>
  )
}

// ThreeWaySection — replaces ReviewSection. Each row shows Physical / App /
// Sheet values with discrepancies highlighted, plus an optional action button.
function ThreeWaySection({ title, bucket, items, emptyText }) {
  const tone = bucket === 'missing'     ? 'border-red-500/40 bg-red-500/5 text-red-300'
            : bucket === 'partial'     ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
            : bucket === 'over'        ? 'border-red-500/40 bg-red-500/5 text-red-300'
            : bucket === 'extras'      ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
            : bucket === 'sheet_stale' ? 'border-cyan-500/40 bg-cyan-500/5 text-cyan-300'
            :                            'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
  return (
    <div className={`p-3 rounded border ${tone} mb-3`}>
      <div className="text-xs font-semibold mb-2">{title} — {items.length}</div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-500 italic">{emptyText}</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-2 bg-vault-darker rounded px-2 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-gray-300">{it.id}</span>
                  {it.name && <span className="text-gray-500 truncate">{it.name}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <ThreeWayValue label="P" value={it.physical} tone="emerald" />
                  <ThreeWayValue label="A" value={it.app}      tone="gold" diffWith={it.physical} />
                  <ThreeWayValue label="S"
                                 value={it.sheet?.qty ?? (it.sheet?.status ? `"${it.sheet.status}"` : '—')}
                                 tone="cyan" diffWith={it.app} />
                  {it.sheet?.location && (
                    <span className="text-[10px] text-gray-500">
                      sheet loc: <span className="text-cyan-300">{it.sheet.location}</span>
                    </span>
                  )}
                </div>
              </div>
              {it.action}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ThreeWayValue({ label, value, tone, diffWith }) {
  // Highlight if this column disagrees with diffWith — but only when both
  // are numeric (status strings + missing values don't make a clean diff).
  const isNum = typeof value === 'number' && typeof diffWith === 'number'
  const mismatch = isNum && value !== diffWith
  const baseCls =
    tone === 'emerald' ? 'text-emerald-300'
    : tone === 'gold'  ? 'text-vault-gold'
    : tone === 'cyan'  ? 'text-cyan-300'
    : 'text-gray-300'
  return (
    <span className={`text-[11px] font-mono ${mismatch ? 'underline decoration-red-400 decoration-dotted' : ''} ${baseCls}`}>
      {label}{value == null || value === '' ? '—' : value}
    </span>
  )
}

function ReviewSection({ title, bucket, items, emptyText }) {
  const tone = bucket === 'missing'  ? 'border-red-500/40 bg-red-500/5 text-red-300'
            : bucket === 'partial'  ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
            : bucket === 'extras'   ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
            :                          'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
  return (
    <div className={`p-3 rounded border ${tone} mb-3`}>
      <div className="text-xs font-semibold mb-2">{title} — {items.length}</div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-500 italic">{emptyText}</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-2 bg-vault-darker rounded px-2 py-1 text-xs">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-gray-300">{it.id}</span>
                {it.name && <span className="text-gray-500 ml-2 truncate">{it.name}</span>}
                {it.badge && <span className="ml-2 text-[10px] text-gray-400">({it.badge})</span>}
              </div>
              {it.action}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Pair({ k, v, highlight }) {
  const cls =
    highlight === 'gold' ? 'text-vault-gold font-semibold'
    : highlight === 'red' ? 'text-red-300'
    : 'text-gray-200'
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{k}:</dt>
      <dd className={`${cls} font-mono`}>{String(v)}</dd>
    </div>
  )
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`bg-vault-darker rounded p-2 text-center ${highlight ? 'border border-red-500/40' : ''}`}>
      <div className={`text-lg font-bold ${highlight ? 'text-red-300' : 'text-vault-gold'}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] px-2 py-1 rounded border whitespace-nowrap ${
        active
          ? 'bg-vault-gold/25 border-vault-gold/50 text-vault-gold font-semibold'
          : 'bg-vault-darker border-vault-border text-gray-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
