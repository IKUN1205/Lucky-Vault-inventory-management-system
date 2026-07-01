import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import { processReturn, fetchRecentReturns, fetchLocations, lookupScannedCode, searchProductsForStorefront, searchSinglesForStorefront, searchSlabsForStorefront } from '../lib/supabase'
import { Undo2, ScanLine, Loader2, Package, Diamond, Box, AlertTriangle, BarChart3, Search, ChevronDown, ChevronUp, ListPlus, X, Trash2 } from 'lucide-react'

// Returns — scan a cancelled/returned item back into Master Inventory and keep
// a light record (boss 2026-06-25). Policy: the ORIGINAL sale is NOT touched —
// goods go back + a returns-log row is written. Slabs are the exception (unique
// item → its sold row flips back to in_inventory). Sealed UPC / slab cert# /
// single TCG ID are all auto-detected from the scanned barcode.

const REASONS = [
  { value: 'return', label: 'Return' },
  { value: 'cancel', label: 'Cancelled order' },
  { value: 'defective', label: 'Defective / damaged' },
  { value: 'other', label: 'Other' },
]

// Which live room / channel CAUSED the return — tagged for "returns by stream
// room" stats (boss 2026-06-25). Labels mirror the daily usage report's rooms
// so reporting lines up.
const SOURCE_ROOMS = [
  { value: '', label: '— which room / channel? —' },
  { value: 'Packheads', label: 'TikTok · PackHeads' },
  { value: 'Rockets', label: 'TikTok · Rockets' },
  { value: 'LuckyVaultUS', label: 'eBay · LuckyVaultUS' },
  { value: 'SlabbiePatty', label: 'eBay · SlabbiePatty' },
  { value: 'Whatnot', label: 'Whatnot' },
  { value: 'Shows', label: 'Card Show' },
  { value: 'Storefront', label: 'Storefront' },
  { value: 'Online', label: 'Online' },
  { value: 'Other', label: 'Other' },
]

const KIND_META = {
  sealed: { icon: Box, color: 'text-amber-300', label: 'Sealed' },
  single: { icon: Package, color: 'text-blue-300', label: 'Single' },
  slab: { icon: Diamond, color: 'text-purple-300', label: 'Slab' },
}

const usd = (n) => n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default function Returns() {
  const { user } = useAuth()
  const { toasts, addToast, removeToast } = useToast()

  const [reason, setReason] = useState('return')
  const [notes, setNotes] = useState('')
  const [scan, setScan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [session, setSession] = useState([])        // returns processed this session (newest first)
  const [recent, setRecent] = useState([])
  const [migrated, setMigrated] = useState(true)    // false once we learn the returns table is missing
  const [sourceRoom, setSourceRoom] = useState('')  // which room/channel caused the return (for stats)
  const [qty, setQty] = useState(1)                 // how many came back (sealed/single; slab is always 1)
  const [locations, setLocations] = useState([])    // physical locations (destination options)
  const [destId, setDestId] = useState('')          // where the goods go back (default Master Inventory)
  const [bulkMode, setBulkMode] = useState(false)   // Friday batch: build a list, process all at once
  const [pending, setPending] = useState([])        // staged returns awaiting "Process all"
  const [openSessions, setOpenSessions] = useState(() => new Set())  // expanded return-log sessions
  const inputRef = useRef(null)

  useEffect(() => {
    loadRecent()
    fetchLocations('Physical')
      .then(locs => {
        setLocations(locs || [])
        const master = (locs || []).find(l => l.name === 'Master Inventory')
        setDestId(master?.id || locs?.[0]?.id || '')
      })
      .catch(e => console.warn('[Returns] locations failed:', e.message))
    inputRef.current?.focus()
  }, [])

  const loadRecent = async () => {
    try { setRecent(await fetchRecentReturns(500)) }
    catch (e) { console.warn('[Returns] loadRecent failed:', e.message) }
  }

  // Light in-page stats: returns grouped by the stream room that caused them
  // (count + total returned value). Computed over the loaded history.
  const byRoom = useMemo(() => {
    const m = new Map()
    for (const r of recent) {
      const key = r.source_stream_room || 'Untagged'
      const e = m.get(key) || { room: key, count: 0, value: 0 }
      e.count += 1
      e.value += Number(r.original_sale_price_usd) || 0
      m.set(key, e)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [recent])

  // Group the return log into time "sessions" so a batch (bulk or a single
  // sitting) collapses into one row instead of N. `recent` is newest-first;
  // adjacent returns within GAP of each other belong to the same session.
  // Pre-bulk one-off returns naturally cluster by when they were done.
  const sessions = useMemo(() => {
    const GAP = 30 * 60 * 1000   // 30 min between adjacent returns starts a new session
    const groups = []
    let cur = null
    for (const r of recent) {
      const t = new Date(r.created_at).getTime()
      if (cur && (cur.oldestT - t) <= GAP) { cur.items.push(r); cur.oldestT = t }
      else { cur = { items: [r], newestT: t, oldestT: t }; groups.push(cur) }
    }
    const fmt = (ms, opts) => new Date(ms).toLocaleString('en-CA', opts)
    return groups.map(g => {
      const rooms = [...new Set(g.items.map(x => x.source_stream_room).filter(Boolean))]
      const users = [...new Set(g.items.map(x => x.returned_by?.name).filter(Boolean))]
      const units = g.items.reduce((a, x) => a + (Number(x.quantity) || 1), 0)
      const value = g.items.reduce((a, x) => a + (Number(x.original_sale_price_usd) || 0), 0)
      const day = fmt(g.newestT, { dateStyle: 'medium' })
      const t1 = fmt(g.oldestT, { timeStyle: 'short' }), t2 = fmt(g.newestT, { timeStyle: 'short' })
      const label = t1 === t2 ? `${day}, ${t2}` : `${day}, ${t1}–${t2}`
      return { key: g.items[0].id, items: g.items, label, rooms, users, count: g.items.length, units, value }
    })
  }, [recent])

  const toggleSession = (key) => setOpenSessions(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  // Shared return runner — from the scan/code box (code) or a manual
  // name-search pick (found, an already-resolved {kind, item} object).
  const runReturn = async ({ code, found }) => {
    if (processing) return
    setProcessing(true)
    try {
      const dest = locations.find(l => l.id === destId)
      const res = await processReturn({
        code, found, reason, notes: notes.trim() || null, returnedById: user?.id || null,
        sourceStreamRoom: sourceRoom || null, quantity: Number(qty) || 1,
        destinationLocationId: destId || null, destinationName: dest?.name || null,
      })
      if (res.logged === false) setMigrated(false)
      const meta = KIND_META[res.kind]
      setSession(prev => [{ ...res, code: code || res.name, at: new Date().toLocaleTimeString() }, ...prev])
      addToast(`${meta?.label || res.kind}: ${res.name} — ${res.action}`, 'success')
      setQty(1)   // reset to 1 so the next return doesn't inherit a big qty
      loadRecent()
    } catch (e) {
      addToast(e.message || 'Return failed', 'error')
    } finally {
      setProcessing(false)
    }
  }

  const submitScan = async () => {
    const code = scan.trim()
    if (!code) return
    await runReturn({ code })
    setScan('')
    inputRef.current?.focus()
  }

  // ---------- bulk session (Friday batch) ----------
  const foundLabel = (found) => {
    if (found.kind === 'sealed') return [found.product?.brand, found.product?.name].filter(Boolean).join(' ') || 'Sealed'
    if (found.kind === 'single') return [found.single?.card_name, found.single?.card_number].filter(Boolean).join(' ') || 'Single'
    if (found.kind === 'slab') return found.slab?.item_name || `Slab cert#${found.slab?.cert_number}`
    return 'Item'
  }
  const refOf = (found) => found.kind === 'sealed' ? `p:${found.product?.id}`
    : found.kind === 'single' ? `t:${found.single?.tcg_id || found.single?.id}`
    : `c:${found.slab?.cert_number || found.slab?.id}`

  // Stage a resolved item onto the pending list, capturing the current control
  // values as its defaults. Slabs/singles dedupe (unique); sealed bumps qty.
  const addPending = (found) => {
    if (!found || found.kind === 'empty') { addToast('Nothing scanned', 'error'); return }
    if (found.kind === 'unknown') {
      addToast(`"${found.code}" isn't a known sealed UPC, slab cert#, or single TCG ID`, 'error'); return
    }
    const ref = refOf(found)
    const existing = pending.find(p => p.ref === ref)
    if (existing) {
      if (found.kind === 'sealed') {
        setPending(prev => prev.map(p => p.ref === ref ? { ...p, qty: (Number(p.qty) || 1) + (Number(qty) || 1) } : p))
        addToast(`+${Number(qty) || 1} ${foundLabel(found)} (now ${(Number(existing.qty) || 1) + (Number(qty) || 1)})`, 'success')
      } else {
        addToast(`${foundLabel(found)} is already in the list`, 'info')
      }
      setQty(1); return
    }
    const line = {
      key: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${ref}-${pending.length}`,
      ref, found, kind: found.kind, label: foundLabel(found),
      qty: found.kind === 'slab' ? 1 : (Number(qty) || 1),
      destId, sourceRoom, reason, notes: notes.trim() || null,
    }
    setPending(prev => [line, ...prev])
    addToast(`Added: ${line.label}${line.qty > 1 ? ` ×${line.qty}` : ''}`, 'success')
    setQty(1)
  }

  const submitScanBulk = async () => {
    const code = scan.trim()
    if (!code || processing) return
    setProcessing(true)
    try {
      addPending(await lookupScannedCode(code))
    } catch (e) {
      addToast(e.message || 'Lookup failed', 'error')
    } finally {
      setProcessing(false); setScan(''); inputRef.current?.focus()
    }
  }

  const updatePending = (key, patch) => setPending(prev => prev.map(p => p.key === key ? { ...p, ...patch } : p))
  const removePending = (key) => setPending(prev => prev.filter(p => p.key !== key))
  const clearPending = () => { if (pending.length && confirm('Clear the pending list?')) setPending([]) }

  // Process every staged return in one pass. Succeeded lines drop off the list
  // and land in "This session"; failures stay so they can be retried.
  const processAll = async () => {
    if (pending.length === 0 || processing) return
    setProcessing(true)
    const done = []
    const failed = []
    // Oldest first so the session log reads in scan order.
    for (const line of [...pending].reverse()) {
      try {
        const dest = locations.find(l => l.id === line.destId)
        const res = await processReturn({
          found: line.found, reason: line.reason, notes: line.notes,
          returnedById: user?.id || null, sourceStreamRoom: line.sourceRoom || null,
          quantity: Number(line.qty) || 1,
          destinationLocationId: line.destId || null, destinationName: dest?.name || null,
        })
        if (res.logged === false) setMigrated(false)
        done.push({ ...res, code: res.name, at: new Date().toLocaleTimeString(), key: line.key })
      } catch (e) {
        failed.push({ line, error: e.message || String(e) })
      }
    }
    const failedKeys = new Set(failed.map(f => f.line.key))
    setPending(prev => prev.filter(p => failedKeys.has(p.key)))
    if (done.length) setSession(prev => [...done.reverse(), ...prev])
    addToast(
      `Processed ${done.length} return${done.length === 1 ? '' : 's'}${failed.length ? `, ${failed.length} failed (kept in list)` : ''}`,
      failed.length ? 'info' : 'success',
    )
    for (const f of failed) addToast(`Failed: ${f.line.label} — ${f.error}`, 'error')
    loadRecent()
    setProcessing(false)
  }

  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); bulkMode ? submitScanBulk() : submitScan() } }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Undo2 className="text-vault-gold" /> Returns
        </h1>
        <p className="text-gray-400 mt-1">
          Scan <span className="text-white">or type</span> a cancelled / returned item to put it back into
          the <span className="text-white">chosen location</span> (Master by default) — and tag which stream room caused
          it, for stats. The original sale is kept; this just returns the goods and logs the return.
        </p>
      </div>

      {!migrated && (
        <div className="card mb-4 border-amber-500/40 flex items-start gap-2 text-sm">
          <AlertTriangle size={16} className="text-amber-300 mt-0.5 shrink-0" />
          <span className="text-amber-200">
            Goods are going back to inventory, but the <code>returns</code> log table isn't created yet —
            run <code className="text-amber-100">scripts/add_returns_table.sql</code> to enable the return history below.
          </span>
        </div>
      )}

      {/* Controls + scan */}
      <div className="card mb-6">
        {/* Mode: process each scan immediately, or batch a list (Friday). */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Mode:</span>
          <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
            <button type="button"
              onClick={() => { if (bulkMode && pending.length && !confirm('Switch to one-at-a-time? The pending list will be kept but not processed.')) return; setBulkMode(false) }}
              className={`px-3 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${!bulkMode ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}>
              <Undo2 size={14} /> One at a time
            </button>
            <button type="button"
              onClick={() => setBulkMode(true)}
              className={`px-3 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${bulkMode ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}>
              <ListPlus size={14} /> Bulk session
            </button>
          </div>
          {bulkMode && <span className="text-xs text-gray-500">— scan / search to build the list, then process all at once</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Return to</label>
            <select value={destId} onChange={(e) => setDestId(e.target.value)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Stream room (caused it)</label>
            <select value={sourceRoom} onChange={(e) => setSourceRoom(e.target.value)}>
              {SOURCE_ROOMS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Note (optional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. buyer changed mind / arrived damaged" className="w-full" />
        </div>
        <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
          <ScanLine size={16} className="text-vault-gold" /> Scan or type returned item (sealed UPC · slab cert# · single TCG ID)
          <span className="text-xs text-gray-500 font-normal">
            {bulkMode ? '— adds to the list using the settings above (editable per row)' : '— set Qty for multiples (sealed / single)'}
          </span>
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={onKey}
            placeholder="Scan or type a barcode, then Enter"
            className="flex-1 font-mono"
            autoFocus
          />
          <div className="flex items-center gap-1.5 px-2 bg-vault-darker border border-vault-border rounded-md">
            <span className="text-xs text-gray-500">Qty</span>
            <input
              type="number" min="1" value={qty}
              onChange={(e) => setQty(e.target.value)}
              title="Quantity returned (sealed / single; slab is always 1)"
              className="w-14 text-center font-mono bg-transparent border-0 focus:ring-0 px-0"
            />
          </div>
          <button type="button" onClick={bulkMode ? submitScanBulk : submitScan} disabled={processing || !scan.trim()}
            className="btn btn-primary px-5">
            {processing ? <Loader2 size={18} className="animate-spin" />
              : bulkMode ? <><ListPlus size={16} /> Add{Number(qty) > 1 ? ` ×${qty}` : ''}</>
              : `Return${Number(qty) > 1 ? ` ×${qty}` : ''}`}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Item type auto-detected: sealed → +1 to the location · single → added there (sale kept) ·
          slab → flipped back there (unique item, so its sale is un-marked).
        </p>
      </div>

      {/* Manual entry — search by name when the code box can't find it */}
      <ReturnsManualEntry onPick={(found) => bulkMode ? addPending(found) : runReturn({ found })} disabled={processing} qty={qty} setQty={setQty} bulkMode={bulkMode} />

      {/* Bulk session — pending list */}
      {bulkMode && (
        <div className="card mb-6 border-vault-gold/30">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
              <ListPlus size={18} className="text-vault-gold" /> Pending returns ({pending.length})
            </h2>
            {pending.length > 0 && (
              <button type="button" onClick={clearPending} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                <Trash2 size={14} /> Clear all
              </button>
            )}
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-500">Scan or search items above to stage them here — then process all at once.</p>
          ) : (
            <>
              <div className="space-y-2">
                {pending.map(line => {
                  const meta = KIND_META[line.kind] || {}
                  const Icon = meta.icon || Package
                  return (
                    <div key={line.key} className="grid grid-cols-12 gap-2 items-center p-2.5 bg-vault-darker/40 border border-vault-border rounded-lg">
                      <div className={`col-span-12 md:col-span-4 flex items-center gap-2 min-w-0 ${meta.color}`}>
                        <Icon size={18} className="flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-white text-sm font-medium truncate">{line.label}</div>
                          <div className="text-[11px] text-gray-500">{meta.label}</div>
                        </div>
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500">Qty</label>
                        {line.kind === 'slab'
                          ? <div className="text-white text-sm pt-1">1</div>
                          : <input type="number" min="1" value={line.qty}
                              onChange={(e) => updatePending(line.key, { qty: Math.max(1, Number(e.target.value) || 1) })}
                              disabled={processing} className="w-full" />}
                      </div>
                      <div className="col-span-8 md:col-span-2">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500">Return to</label>
                        <select value={line.destId} onChange={(e) => updatePending(line.key, { destId: e.target.value })} disabled={processing} className="text-sm">
                          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500">Room</label>
                        <select value={line.sourceRoom} onChange={(e) => updatePending(line.key, { sourceRoom: e.target.value })} disabled={processing} className="text-sm">
                          {SOURCE_ROOMS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-5 md:col-span-1">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500">Reason</label>
                        <select value={line.reason} onChange={(e) => updatePending(line.key, { reason: e.target.value })} disabled={processing} className="text-sm">
                          {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button type="button" onClick={() => removePending(line.key)} disabled={processing} className="text-gray-400 hover:text-red-400 p-1" aria-label="Remove">
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button type="button" onClick={processAll} disabled={processing || pending.length === 0}
                className="btn btn-primary w-full mt-4">
                {processing ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
                  : <><Undo2 size={18} /> Process {pending.length} return{pending.length === 1 ? '' : 's'}</>}
              </button>
            </>
          )}
        </div>
      )}

      {/* This session */}
      {session.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-display text-lg font-semibold text-white mb-3">This session ({session.length})</h2>
          <div className="space-y-2">
            {session.map((r, i) => {
              const meta = KIND_META[r.kind] || {}
              const Icon = meta.icon || Package
              return (
                <div key={i} className="flex items-center justify-between gap-3 p-2.5 bg-vault-dark rounded-lg border border-vault-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={16} className={meta.color || 'text-gray-400'} />
                    <span className="text-white truncate">{r.name}</span>
                    <span className="text-xs text-gray-500 font-mono">{r.code}</span>
                  </div>
                  <div className="text-right shrink-0 max-w-[260px]">
                    <div className="text-xs text-gray-300">{r.action}</div>
                    {r.original && (
                      <div className="text-[11px] text-gray-500">
                        was {usd(r.original.price)} · {r.original.channel || '—'} · {r.original.date || '—'}
                      </div>
                    )}
                    {r.warn && (
                      <div className="text-[11px] text-amber-300 mt-0.5 flex items-start gap-1 justify-end">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0" /> <span>{r.warn}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Light stats: returns by stream room */}
      {recent.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <BarChart3 size={18} className="text-vault-gold" /> Returns by room
            <span className="text-xs text-gray-500 font-normal">({recent.length} logged)</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {byRoom.map(r => (
              <div key={r.room} className="px-3 py-2 bg-vault-darker/60 rounded-lg border border-vault-border">
                <div className="text-sm text-white">{r.room}</div>
                <div className="text-xs text-gray-400">
                  <span className="text-vault-gold font-semibold">{r.count}</span> return{r.count === 1 ? '' : 's'}
                  {r.value > 0 && <span> · {usd(r.value)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent returns log */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-white">Recent returns</h2>
          {sessions.length > 0 && (
            <span className="text-xs text-gray-500">{sessions.length} session{sessions.length === 1 ? '' : 's'} · click to expand</span>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="text-gray-500 text-sm py-2">No returns logged yet.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => {
              const open = openSessions.has(s.key)
              return (
                <div key={s.key} className="border border-vault-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => toggleSession(s.key)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-vault-darker/40 hover:bg-vault-darker/60 text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      {open ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-white text-sm font-medium">{s.label}</div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {s.count} return{s.count === 1 ? '' : 's'}{s.units !== s.count ? ` · ${s.units} units` : ''}
                          {' · '}{s.rooms.length ? s.rooms.join(', ') : 'untagged'}
                          {s.users.length ? ` · ${s.users.join(', ')}` : ''}
                        </div>
                      </div>
                    </div>
                    {s.value > 0 && <div className="text-xs text-gray-400 font-mono shrink-0">{usd(s.value)}</div>}
                  </button>
                  {open && (
                    <div className="overflow-x-auto border-t border-vault-border">
                      <table className="w-full text-sm">
                        <thead className="border-b border-vault-border text-gray-400 text-xs uppercase">
                          <tr>
                            <th className="px-3 py-2 text-left">When</th>
                            <th className="px-3 py-2 text-left">Item</th>
                            <th className="px-3 py-2 text-left">Reason</th>
                            <th className="px-3 py-2 text-left">Room</th>
                            <th className="px-3 py-2 text-right">Was sold</th>
                            <th className="px-3 py-2 text-left">By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.map(r => {
                            const meta = KIND_META[r.kind] || {}
                            const Icon = meta.icon || Package
                            return (
                              <tr key={r.id} className="border-b border-vault-border last:border-0">
                                <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                                  {new Date(r.created_at).toLocaleString('en-CA', { timeStyle: 'short' })}
                                </td>
                                <td className="px-3 py-2 text-white">
                                  <span className="flex items-center gap-2">
                                    <Icon size={14} className={meta.color || 'text-gray-400'} />
                                    <span className="truncate max-w-[280px]" title={r.item_name}>{r.item_name || r.item_ref}</span>
                                    {r.quantity > 1 && <span className="text-[11px] text-vault-gold">×{r.quantity}</span>}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-300">
                                  {r.reason}{r.notes ? <span className="text-gray-500"> · {r.notes}</span> : ''}
                                </td>
                                <td className="px-3 py-2 text-gray-300">{r.source_stream_room || '—'}</td>
                                <td className="px-3 py-2 text-right text-gray-400">
                                  {r.original_sale_price_usd != null ? usd(r.original_sale_price_usd) : '—'}
                                  {r.original_sale_channel ? <span className="text-[11px] text-gray-600"> · {r.original_sale_channel}</span> : ''}
                                </td>
                                <td className="px-3 py-2 text-gray-400">{r.returned_by?.name || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Manual name-search fallback — when the scanner / code box can't find it,
// search sealed / single / slab by name and click Return on the match. The
// search rows are already {kind, single|slab|product}-shaped, so onPick hands
// the row straight to processReturn as `found`.
function ReturnsManualEntry({ onPick, disabled, qty, setQty, bulkMode }) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('single')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { setQuery(''); setResults([]); setErr(null) }, [tab])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); setErr(null); return }
    setSearching(true); setErr(null)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        let rows = []
        if (tab === 'sealed') rows = await searchProductsForStorefront(q)
        else if (tab === 'single') rows = await searchSinglesForStorefront(q)
        else if (tab === 'slab') rows = await searchSlabsForStorefront(q)
        if (!cancelled) setResults(rows || [])
      } catch (e) { if (!cancelled) { setErr(e.message || 'Search failed'); setResults([]) } }
      finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, tab])

  const pick = (row) => { onPick(row); setQuery(''); setResults([]) }
  const placeholder = tab === 'sealed' ? 'Type a brand or product name…'
    : tab === 'single' ? 'Type card name, number, or TCG ID…'
    : 'Type slab name or cert#…'

  return (
    <div className="card mb-6">
      <button type="button" onClick={() => setExpanded(v => !v)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-vault-gold" />
          <span className="text-sm font-semibold text-white">Manual entry (no barcode)</span>
          <span className="text-xs text-gray-500">— search by name when the scanner / code can't find it</span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-1 border-b border-vault-border/50 pb-2">
            <RetTab active={tab === 'sealed'} onClick={() => setTab('sealed')} icon={Box} label="Sealed" color="text-amber-300" />
            <RetTab active={tab === 'single'} onClick={() => setTab('single')} icon={Package} label="Single" color="text-blue-300" />
            <RetTab active={tab === 'slab'} onClick={() => setTab('slab')} icon={Diamond} label="Slab" color="text-emerald-300" />
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled}
                placeholder={placeholder} autoComplete="off" spellCheck={false}
                className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-sm focus:outline-none focus:border-vault-gold disabled:opacity-50" />
              {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />}
            </div>
            <div className={`flex items-center gap-1.5 px-2 bg-vault-darker border border-vault-border rounded-md ${tab === 'slab' ? 'opacity-40' : ''}`}>
              <span className="text-xs text-gray-500">Qty</span>
              <input type="number" min="1" value={tab === 'slab' ? 1 : qty}
                onChange={(e) => setQty(e.target.value)} disabled={disabled || tab === 'slab'}
                title="Quantity (sealed / single; slab is always 1)"
                className="w-14 text-center font-mono bg-transparent border-0 focus:ring-0 px-0 text-white text-sm disabled:opacity-60" />
            </div>
          </div>
          {err && <div className="text-xs text-red-400">{err}</div>}
          {!err && query.trim().length >= 2 && !searching && results.length === 0 && <div className="text-xs text-gray-500">No matches.</div>}
          {results.length > 0 && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-vault-border/50 border border-vault-border rounded-md">
              {results.map((row, i) => <li key={i}><RetResultRow row={row} onPick={pick} disabled={disabled} qty={qty} bulkMode={bulkMode} /></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function RetTab({ active, onClick, icon: Icon, label, color }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${active ? `bg-vault-darker/60 ${color}` : 'text-gray-400 hover:text-white'}`}>
      <Icon size={14} /> {label}
    </button>
  )
}

function RetResultRow({ row, onPick, disabled, qty, bulkMode }) {
  let Icon, color, title, sub
  const showQty = row.kind !== 'slab' && Number(qty) > 1   // slab is always 1
  if (row.kind === 'sealed') {
    Icon = Box; color = 'text-amber-300'
    title = `${row.product.brand} | ${row.product.name}`
    sub = `${row.product.category || row.product.type || 'Sealed'} · ${row.product.language || '—'}`
  } else if (row.kind === 'single') {
    Icon = Package; color = 'text-blue-300'
    const num = row.single.card_number ? ` #${row.single.card_number}` : ''
    title = `${row.single.card_name}${num}`
    sub = `${row.single.condition || 'raw'}${row.single.set?.name ? ' · ' + row.single.set.name : ''} · TCG ${row.single.tcg_id}`
  } else if (row.kind === 'slab') {
    Icon = Diamond; color = 'text-emerald-300'
    title = row.slab.item_name
    sub = `${row.slab.grading_company || '?'} · cert #${row.slab.cert_number}`
  } else return null
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-vault-darker/30 hover:bg-vault-darker/60 transition-colors">
      <Icon size={16} className={`${color} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{title}</div>
        <div className="text-xs text-gray-500 truncate">{sub}</div>
      </div>
      <button type="button" onClick={() => onPick(row)} disabled={disabled}
        className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md hover:bg-vault-gold/30 disabled:opacity-50">
        <Undo2 size={12} /> {bulkMode ? 'Add' : 'Return'}{showQty ? ` ×${qty}` : ''}
      </button>
    </div>
  )
}
