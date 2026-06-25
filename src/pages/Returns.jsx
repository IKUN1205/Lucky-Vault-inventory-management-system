import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import { processReturn, fetchRecentReturns } from '../lib/supabase'
import { Undo2, ScanLine, Loader2, Package, Diamond, Box, AlertTriangle } from 'lucide-react'

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
  const inputRef = useRef(null)

  useEffect(() => { loadRecent(); inputRef.current?.focus() }, [])

  const loadRecent = async () => {
    try { setRecent(await fetchRecentReturns(50)) }
    catch (e) { console.warn('[Returns] loadRecent failed:', e.message) }
  }

  const submitScan = async () => {
    const code = scan.trim()
    if (!code || processing) return
    setProcessing(true)
    try {
      const res = await processReturn({ code, reason, notes: notes.trim() || null, returnedById: user?.id || null })
      if (res.logged === false) setMigrated(false)
      const meta = KIND_META[res.kind]
      setSession(prev => [{ ...res, code, at: new Date().toLocaleTimeString() }, ...prev])
      addToast(`${meta?.label || res.kind}: ${res.name} — ${res.action}`, 'success')
      setScan('')
      loadRecent()
    } catch (e) {
      addToast(e.message || 'Return failed', 'error')
    } finally {
      setProcessing(false)
      inputRef.current?.focus()
    }
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
          Scan a cancelled / returned item back into <span className="text-white">Master Inventory</span>. The original
          sale is kept — this just puts the goods back and records the return.
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
            <label className="block text-sm font-medium text-gray-300 mb-2">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">Note (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. buyer changed mind / arrived damaged" />
          </div>
        </div>
        <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
          <ScanLine size={16} className="text-vault-gold" /> Scan returned item (sealed UPC · slab cert# · single TCG ID)
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
          Type auto-detected: sealed → +1 to Master · single → added to Master (sale kept) ·
          slab → flipped back to Master (unique item, so its sale is un-marked).
        </p>
      </div>

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
