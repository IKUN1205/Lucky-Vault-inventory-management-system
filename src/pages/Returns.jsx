import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import { processReturn, fetchRecentReturns, fetchLocations, searchProductsForStorefront, searchSinglesForStorefront, searchSlabsForStorefront } from '../lib/supabase'
import { Undo2, ScanLine, Loader2, Package, Diamond, Box, AlertTriangle, BarChart3, Search, ChevronDown, ChevronUp } from 'lucide-react'

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
  const [locations, setLocations] = useState([])    // physical locations (destination options)
  const [destId, setDestId] = useState('')          // where the goods go back (default Master Inventory)
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

  // Shared return runner — from the scan/code box (code) or a manual
  // name-search pick (found, an already-resolved {kind, item} object).
  const runReturn = async ({ code, found }) => {
    if (processing) return
    setProcessing(true)
    try {
      const dest = locations.find(l => l.id === destId)
      const res = await processReturn({
        code, found, reason, notes: notes.trim() || null, returnedById: user?.id || null,
        sourceStreamRoom: sourceRoom || null,
        destinationLocationId: destId || null, destinationName: dest?.name || null,
      })
      if (res.logged === false) setMigrated(false)
      const meta = KIND_META[res.kind]
      setSession(prev => [{ ...res, code: code || res.name, at: new Date().toLocaleTimeString() }, ...prev])
      addToast(`${meta?.label || res.kind}: ${res.name} — ${res.action}`, 'success')
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

  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submitScan() } }

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
          <button type="button" onClick={submitScan} disabled={processing || !scan.trim()}
            className="btn btn-primary px-5">
            {processing ? <Loader2 size={18} className="animate-spin" /> : 'Return'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Item type auto-detected: sealed → +1 to the location · single → added there (sale kept) ·
          slab → flipped back there (unique item, so its sale is un-marked).
        </p>
      </div>

      {/* Manual entry — search by name when the code box can't find it */}
      <ReturnsManualEntry onPick={(found) => runReturn({ found })} disabled={processing} />

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
        <h2 className="font-display text-lg font-semibold text-white mb-3">Recent returns</h2>
        {recent.length === 0 ? (
          <p className="text-gray-500 text-sm py-2">No returns logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
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
                {recent.map(r => {
                  const meta = KIND_META[r.kind] || {}
                  const Icon = meta.icon || Package
                  return (
                    <tr key={r.id} className="border-b border-vault-border last:border-0">
                      <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-3 py-2 text-white">
                        <span className="flex items-center gap-2">
                          <Icon size={14} className={meta.color || 'text-gray-400'} />
                          <span className="truncate max-w-[280px]" title={r.item_name}>{r.item_name || r.item_ref}</span>
                          <span className="text-[11px] text-gray-500 font-mono">{r.item_ref}</span>
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
    </div>
  )
}

// Manual name-search fallback — when the scanner / code box can't find it,
// search sealed / single / slab by name and click Return on the match. The
// search rows are already {kind, single|slab|product}-shaped, so onPick hands
// the row straight to processReturn as `found`.
function ReturnsManualEntry({ onPick, disabled }) {
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
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled}
              placeholder={placeholder} autoComplete="off" spellCheck={false}
              className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-sm focus:outline-none focus:border-vault-gold disabled:opacity-50" />
            {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />}
          </div>
          {err && <div className="text-xs text-red-400">{err}</div>}
          {!err && query.trim().length >= 2 && !searching && results.length === 0 && <div className="text-xs text-gray-500">No matches.</div>}
          {results.length > 0 && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-vault-border/50 border border-vault-border rounded-md">
              {results.map((row, i) => <li key={i}><RetResultRow row={row} onPick={pick} disabled={disabled} /></li>)}
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

function RetResultRow({ row, onPick, disabled }) {
  let Icon, color, title, sub
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
        <Undo2 size={12} /> Return
      </button>
    </div>
  )
}
