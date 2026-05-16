import React, { useState, useEffect, useRef } from 'react'
import { fetchSlabByCert } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SellSlabModal from '../components/SellSlabModal'
import QuickIntakeSlabModal from '../components/QuickIntakeSlabModal'
import BulkSellSlabModal from '../components/BulkSellSlabModal'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import {
  ScanLine, ArrowRight, AlertTriangle, CheckCircle2, Loader2,
  ShieldCheck, DollarSign, X
} from 'lucide-react'

// ============================================================================
// SlabsScan — barcode-scanner workflow for graded slabs
// ============================================================================
// Same 2-tier mode picker as SinglesScan: Intake/Sell + Single/Batch.
//   - Intake + Single → scan a new cert → QuickIntakeSlabModal pops
//   - Intake + Batch  → scans queue, "Continue" submits via inline modal
//                        (TODO: BulkAddSlabsModal not built yet — for now
//                         user does single intakes per card in batch)
//   - Sell + Single   → scan a known cert → SellSlabModal pops
//   - Sell + Batch    → scans queue, "Continue" opens BulkSellSlabModal
// ============================================================================

const HISTORY_LIMIT = 20

export default function SlabsScan() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [actionType, setActionType] = useState('intake')   // 'intake' | 'sell'
  const [flowMode, setFlowMode] = useState('single')        // 'single' | 'batch'
  const mode = (
    actionType === 'intake'
      ? (flowMode === 'batch' ? 'batch_intake' : 'intake')
      : (flowMode === 'batch' ? 'batch_sell' : 'sell')
  )

  const [cert, setCert] = useState('')
  const [processing, setProcessing] = useState(false)
  const [history, setHistory] = useState([])

  // Modal state
  const [pendingIntake, setPendingIntake] = useState(null)   // scanned cert# (new)
  const [pendingSell, setPendingSell] = useState(null)       // slab object to sell
  const [sellQueue, setSellQueue] = useState([])
  const [showBulkSell, setShowBulkSell] = useState(false)
  // Note: batch intake queue not implemented yet — slabs bulk add UI TBD

  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const refocus = () => setTimeout(() => inputRef.current?.focus(), 0)

  const pushHistory = (entry) => {
    setHistory(prev => [{ ts: Date.now(), ...entry }, ...prev].slice(0, HISTORY_LIMIT))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = cert.trim()
    if (!trimmed) { refocus(); return }

    setProcessing(true)
    try {
      const existing = await fetchSlabByCert(trimmed)

      if (mode === 'intake') {
        if (existing) {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Already in inventory (${existing.status}): ${existing.item_name}`,
            slab: existing
          })
          addToast?.(`Cert ${trimmed} already in inventory`, 'error')
        } else {
          // Open in-page intake modal — TCG ID style is "stay on page"
          setPendingIntake(trimmed)
        }
      } else if (mode === 'sell') {
        if (!existing) {
          pushHistory({ cert: trimmed, mode, ok: false, msg: 'Not in inventory — intake first' })
          addToast?.(`Cert ${trimmed} not in inventory`, 'error')
        } else if (existing.status === 'sold') {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Already sold on ${existing.sale_date || '?'}`,
            slab: existing
          })
          addToast?.(`Cert ${trimmed} already sold`, 'error')
        } else if (existing.status !== 'in_inventory' && existing.status !== 'listed') {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Status is "${existing.status}" — can only sell from in_inventory or listed`,
            slab: existing
          })
          addToast?.(`Cert ${trimmed} status: ${existing.status}`, 'error')
        } else {
          setPendingSell(existing)
        }
      } else if (mode === 'batch_sell') {
        if (!existing) {
          pushHistory({ cert: trimmed, mode, ok: false, msg: 'Not in inventory — cannot queue' })
        } else if (existing.status === 'sold') {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Already sold on ${existing.sale_date || '?'}`, slab: existing
          })
        } else if (existing.status !== 'in_inventory' && existing.status !== 'listed') {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Status is "${existing.status}" — can only sell from in_inventory or listed`,
            slab: existing
          })
        } else if (sellQueue.some(s => s.id === existing.id)) {
          pushHistory({ cert: trimmed, mode, ok: false, msg: 'Already in the sell queue' })
        } else {
          setSellQueue(prev => [...prev, existing])
          pushHistory({
            cert: trimmed, mode, ok: true,
            msg: `Queued for batch sell (${sellQueue.length + 1} total)`,
            slab: existing
          })
        }
      } else if (mode === 'batch_intake') {
        // Batch intake for slabs not wired yet — single intake instead
        if (existing) {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Already in inventory: ${existing.item_name}`,
            slab: existing
          })
        } else {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: 'Batch intake for slabs not implemented yet — switch to Single mode'
          })
          addToast?.('Batch intake for slabs coming soon — use Single mode', 'error')
        }
      }
    } catch (err) {
      pushHistory({ cert: trimmed, mode, ok: false, msg: err.message || 'lookup failed' })
      addToast?.(`Lookup failed: ${err.message || 'unknown'}`, 'error')
    } finally {
      setCert('')
      setProcessing(false)
      refocus()
    }
  }

  const setActionTypeSafe = (next) => {
    if (processing) return
    setActionType(next)
    setCert('')
    refocus()
  }
  const setFlowModeSafe = (next) => {
    if (processing) return
    setFlowMode(next)
    setCert('')
    refocus()
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <ScanLine className="text-vault-gold" />
            Scan Slabs
          </h1>
          <p className="text-gray-400 mt-1">
            Barcode-driven intake + sell flow for graded slabs (PSA / CGC / BGS / SGC)
          </p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>Pick Intake or Sell, pick Single or Batch, then scan slab cert#s.</p>
          <p className="text-gray-400 text-xs">
            Auto-focused input. Scanner gun sends digits + Enter, manual typing + Enter both work.
          </p>
        </div>
      </Instructions>

      {/* Tier 1 — Intake vs Sell */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <button
          type="button"
          onClick={() => setActionTypeSafe('intake')}
          className={`p-5 rounded-xl text-left transition-all border-2 ${
            actionType === 'intake'
              ? 'bg-green-500/25 border-green-400 text-white shadow-lg shadow-green-500/20'
              : 'bg-vault-darker/40 border-vault-border text-gray-400 hover:border-green-500/40 hover:text-green-300'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={20} className={actionType === 'intake' ? 'text-green-300' : ''} />
            <span className="font-bold text-base">Intake</span>
            {actionType === 'intake' && <span className="ml-auto text-green-300 text-xs uppercase font-semibold tracking-wider">Active</span>}
          </div>
          <p className={`text-xs ${actionType === 'intake' ? 'text-green-100/80' : 'text-gray-500'}`}>
            Scan to add new slabs to inventory.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setActionTypeSafe('sell')}
          className={`p-5 rounded-xl text-left transition-all border-2 ${
            actionType === 'sell'
              ? 'bg-red-500/25 border-red-400 text-white shadow-lg shadow-red-500/20'
              : 'bg-vault-darker/40 border-vault-border text-gray-400 hover:border-red-500/40 hover:text-red-300'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={20} className={actionType === 'sell' ? 'text-red-300' : ''} />
            <span className="font-bold text-base">Sell</span>
            {actionType === 'sell' && <span className="ml-auto text-red-300 text-xs uppercase font-semibold tracking-wider">Active</span>}
          </div>
          <p className={`text-xs ${actionType === 'sell' ? 'text-red-100/80' : 'text-gray-500'}`}>
            Scan to record sales of slabs already in inventory.
          </p>
        </button>
      </div>

      {/* Tier 2 — Single / Batch */}
      <div className="flex items-center gap-3 mb-6 px-1">
        <span className="text-xs text-gray-400 uppercase font-semibold tracking-wider">Flow:</span>
        <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
          <button
            type="button"
            onClick={() => setFlowModeSafe('single')}
            className={`px-4 py-1.5 text-sm rounded-md transition ${
              flowMode === 'single' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'
            }`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => setFlowModeSafe('batch')}
            className={`px-4 py-1.5 text-sm rounded-md transition ${
              flowMode === 'batch' ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'
            }`}
          >
            Batch
          </button>
        </div>
        <span className="text-xs text-gray-500 ml-2">
          {flowMode === 'single'
            ? (actionType === 'intake'
                ? 'Each scan opens the quick intake form right away.'
                : 'Each scan opens the Sell modal right away.')
            : (actionType === 'intake'
                ? 'Batch intake for slabs not yet implemented — use Single.'
                : 'Scans queue below — click Continue to Bulk Sell when done.')}
        </span>
      </div>

      {/* Batch SELL queue */}
      {mode === 'batch_sell' && sellQueue.length > 0 && (
        <div className="card mb-6 border-orange-500/40 border-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-orange-300">
              <DollarSign size={16} />
              <h3 className="font-semibold text-sm">Sell queue ({sellQueue.length})</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => setSellQueue([])}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                <X size={12} /> Clear queue
              </button>
              <button
                type="button" onClick={() => setShowBulkSell(true)}
                className="btn btn-primary text-sm py-1.5 px-3"
              >
                Continue to Bulk Sell <ArrowRight size={14} />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {sellQueue.map((s, i) => (
              <span
                key={s.id}
                className="badge badge-info font-mono text-xs flex items-center gap-1"
                title={s.item_name}
              >
                {s.cert_number}
                <span className="text-gray-400 normal-case">— {s.grading_company}</span>
                <button
                  type="button"
                  onClick={() => setSellQueue(prev => prev.filter((_, idx) => idx !== i))}
                  className="hover:text-red-300"
                  title="Remove from queue"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Scan input */}
      <form onSubmit={handleSubmit} className="card mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Cert # <span className="text-gray-500 text-xs">(scanner or type + Enter)</span>
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={cert}
            onChange={(e) => setCert(e.target.value)}
            disabled={processing}
            placeholder="Scan or type a PSA / CGC / BGS / SGC cert number..."
            className="font-mono text-base flex-1"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={processing || !cert.trim()}
            className="btn btn-primary flex-shrink-0"
          >
            {processing
              ? <Loader2 className="animate-spin" size={18} />
              : <>
                  {mode === 'intake' ? 'Intake'
                    : mode === 'batch_sell' ? 'Queue'
                    : 'Sell'}
                  <ArrowRight size={18} />
                </>}
          </button>
        </div>
      </form>

      {/* History feed */}
      <div className="card overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-vault-border flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm">Recent scans</h3>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No scans yet. Scan a cert# above to start.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-xs uppercase border-b border-vault-border">
              <tr>
                <th className="text-left px-4 py-2 w-24">Time</th>
                <th className="text-left px-4 py-2 w-24">Mode</th>
                <th className="text-left px-4 py-2 w-40">Cert #</th>
                <th className="text-left px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => {
                const tstr = new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                return (
                  <tr key={`${h.ts}-${i}`} className="border-b border-vault-border/50 last:border-0">
                    <td className="px-4 py-2 text-gray-500 text-xs">{tstr}</td>
                    <td className="px-4 py-2">
                      <span className={`badge text-xs ${
                        h.mode === 'intake' || h.mode === 'batch_intake' ? 'badge-info' : 'badge-warning'
                      }`}>
                        {h.mode}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-200">{h.cert}</td>
                    <td className="px-4 py-2">
                      <div className={`flex items-center gap-2 ${
                        h.ok ? 'text-green-400' : 'text-red-300'
                      }`}>
                        {h.ok
                          ? <CheckCircle2 size={14} className="flex-shrink-0" />
                          : <AlertTriangle size={14} className="flex-shrink-0" />}
                        <span>{h.msg}</span>
                      </div>
                      {h.slab && (
                        <div className="text-gray-500 text-xs mt-0.5 truncate max-w-[600px]" title={h.slab.item_name}>
                          {h.slab.grading_company} · {h.slab.item_name}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sell modal (single) */}
      {pendingSell && (
        <SellSlabModal
          slab={pendingSell}
          currentUserId={user?.id}
          currentUserName={user?.name}
          addToast={addToast}
          onCancel={() => { setPendingSell(null); refocus() }}
          onSold={(updated) => {
            pushHistory({
              cert: updated.cert_number,
              mode: 'sell',
              ok: true,
              msg: `Sold for $${Number(updated.sale_price_usd || 0).toFixed(2)} via ${updated.sale_channel || 'unknown'}`,
              slab: updated
            })
            setPendingSell(null)
            refocus()
          }}
        />
      )}

      {/* Bulk sell modal */}
      {showBulkSell && sellQueue.length > 0 && (
        <BulkSellSlabModal
          slabs={sellQueue}
          currentUserId={user?.id}
          currentUserName={user?.name}
          addToast={addToast}
          onCancel={() => { setShowBulkSell(false); refocus() }}
          onSold={(soldSlabs) => {
            soldSlabs.forEach(s => {
              pushHistory({
                cert: s.cert_number,
                mode: 'batch_sell',
                ok: true,
                msg: `Sold for $${Number(s.sale_price_usd || 0).toFixed(2)} via ${s.sale_channel || '?'}`,
                slab: s
              })
            })
            const soldIds = new Set(soldSlabs.map(s => s.id))
            setSellQueue(prev => prev.filter(s => !soldIds.has(s.id)))
            if (soldSlabs.length === sellQueue.length) setShowBulkSell(false)
            refocus()
          }}
        />
      )}

      {/* Quick intake modal */}
      {pendingIntake && (
        <QuickIntakeSlabModal
          scannedCert={pendingIntake}
          currentUserId={user?.id}
          currentUserName={user?.name}
          addToast={addToast}
          onCancel={() => {
            pushHistory({
              cert: pendingIntake, mode: 'intake', ok: false,
              msg: 'Cancelled — not added'
            })
            setPendingIntake(null)
            refocus()
          }}
          onCreated={(created) => {
            pushHistory({
              cert: pendingIntake, mode: 'intake', ok: true,
              msg: `Added ${created.grading_company} ${created.item_name}`.trim(),
              slab: created
            })
            setPendingIntake(null)
            refocus()
          }}
        />
      )}
    </div>
  )
}
