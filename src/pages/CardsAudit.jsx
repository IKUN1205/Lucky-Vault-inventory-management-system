import React, { useState, useRef, useEffect } from 'react'
import { fetchLocations } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import {
  Scale, Search, RefreshCw, AlertTriangle, AlertCircle, Info,
  CheckCircle, ExternalLink, Loader2, FileSearch, MapPin,
  ScanLine, Trash2, ChevronDown, ChevronRight,
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
  // Batch scan state — keyed by id so re-scanning the same card just
  // replaces the prior result instead of stacking duplicates. Order
  // tracked separately so the most-recently-scanned floats to the top.
  const [batchById, setBatchById] = useState({})       // { [id]: result }
  const [batchOrder, setBatchOrder] = useState([])     // [id, id, …] newest first
  const [batchExpanded, setBatchExpanded] = useState({}) // { [id]: true } for inline-expanded rows
  const [batchPushAllRunning, setBatchPushAllRunning] = useState(false)
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
          <p className="font-medium text-white">Two ways to use this page:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li><span className="text-vault-gold">Quick scan</span> — scan or paste a {idLabel} to see side-by-side what the app says vs what the sheet says.</li>
            <li><span className="text-vault-gold">Full audit</span> — finds every discrepancy across all cards (takes ~10-30s for ~2000 rows).</li>
          </ol>
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

function FullAuditResults({ result, kind, idLabel, filterCode, setFilterCode, pushToSheet, pushingId }) {
  const { summary, issues } = result
  const filtered = filterCode ? issues.filter(i => i.code === filterCode) : issues
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
        <Stat label="App ids" value={summary.total_db_ids} />
        <Stat label="Sheet ids" value={summary.total_sheet_ids} />
        <Stat label="Issues found" value={summary.total_issues} highlight={summary.total_issues > 0} />
        <Stat label="Clean" value={Math.max(0, summary.total_db_ids - new Set(issues.map(i => i.id)).size)} />
      </div>

      {/* Filter chips */}
      {Object.keys(summary.by_code).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          <FilterChip active={filterCode === ''} onClick={() => setFilterCode('')}>All ({summary.total_issues})</FilterChip>
          {Object.entries(summary.by_code).map(([code, count]) => (
            <FilterChip key={code} active={filterCode === code} onClick={() => setFilterCode(code)}>
              {CODE_LABELS[code] || code} ({count})
            </FilterChip>
          ))}
        </div>
      )}

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

function IssueRow({ issue, idLabel = 'ID', pushToSheet, pushingId }) {
  const sev = SEVERITY[issue.severity] || SEVERITY.info
  const Icon = sev.icon
  const isPushing = pushingId === issue.id
  return (
    <div className={`p-3 rounded border ${sev.border} ${sev.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon size={16} className={`${sev.color} flex-shrink-0 mt-0.5`} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-xs uppercase tracking-wider ${sev.color}`}>
                {CODE_LABELS[issue.code] || issue.code}
              </span>
              <span className="text-white font-mono text-xs">{idLabel}: {issue.id}</span>
            </div>
            <p className="text-xs text-gray-300">{issue.message}</p>
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
