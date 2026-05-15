import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSingleByIdentifier, fetchCardSets } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SellSingleModal from '../components/SellSingleModal'
import QuickIntakeModal from '../components/QuickIntakeModal'
import BulkSellModal from '../components/BulkSellModal'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import {
  ScanLine, ArrowRight, AlertTriangle, CheckCircle2, Loader2,
  Package, DollarSign, X, Layers
} from 'lucide-react'

// ============================================================================
// SinglesScan — barcode-scanner-first workflow page
// ============================================================================
// Most TCG grading slabs (PSA, CGC, BGS, SGC) have a barcode encoding the
// cert#. USB scanner guns emulate a keyboard: they type the cert# into the
// focused input + press Enter. So the UX is just "single input field that
// auto-focuses + re-focuses after every scan", and the scanner does the rest.
//
// Two modes:
//   - intake: scan → if cert NOT in DB → navigate to Add Single with
//     ?cert=XYZ&form=graded prefilled. If cert ALREADY in DB → reject
//     with "this cert is already in inventory" + link.
//   - sell:   scan → if cert in DB and status=in_inventory → open SellSingleModal
//     pre-loaded with that single. If status=sold → reject. If not found
//     → reject ("intake first").
//
// History feed below the scan input shows the last N scans so the user
// can keep scanning rapidly without losing context if something failed.
// ============================================================================

const HISTORY_LIMIT = 20

export default function SinglesScan() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('intake')   // 'intake' | 'sell' | 'batch_intake' | 'batch_sell'
  const [cert, setCert] = useState('')
  const [processing, setProcessing] = useState(false)
  const [history, setHistory] = useState([])   // [{ ts, cert, mode, ok, msg, single? }, ...]
  const [pendingSell, setPendingSell] = useState(null)
  // Batch Intake mode accumulates scanned cert#s. User finalises with the
  // "Continue to Bulk Add" button → /singles/bulk-add?certs=...
  const [batchQueue, setBatchQueue] = useState([])
  // Batch Sell mode accumulates verified-sellable singles (looked up to
  // confirm in_inventory). When user clicks "Continue to Bulk Sell" we
  // open BulkSellModal with the full card data so they don't have to wait
  // for another fetch.
  const [sellQueue, setSellQueue] = useState([])
  // BulkSellModal open flag
  const [showBulkSell, setShowBulkSell] = useState(false)
  // Quick intake modal — opens when single-intake scan hits a brand-new
  // identifier. Holds the scanned id so the modal can pre-fill it.
  const [pendingIntake, setPendingIntake] = useState(null)
  // Pre-fetched card_sets so the modal opens instantly without spinner
  const [cardSets, setCardSets] = useState([])
  const inputRef = useRef(null)

  // Auto-focus on mount + re-focus after every scan so the scanner can
  // chain reads without the user clicking.
  useEffect(() => {
    inputRef.current?.focus()
    // Pre-fetch card_sets once for the intake modal
    fetchCardSets()
      .then(setCardSets)
      .catch(err => console.warn('[SinglesScan] card_sets pre-fetch failed:', err))
  }, [])

  const refocus = () => {
    // setTimeout 0 so React finishes re-render before we steal focus back
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const pushHistory = (entry) => {
    setHistory(prev => [{ ts: Date.now(), ...entry }, ...prev].slice(0, HISTORY_LIMIT))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = cert.trim()
    if (!trimmed) {
      refocus()
      return
    }
    setProcessing(true)
    try {
      const existing = await fetchSingleByIdentifier(trimmed)

      if (mode === 'intake') {
        if (existing) {
          // Duplicate — refuse to intake again, point to existing
          pushHistory({
            cert: trimmed,
            mode,
            ok: false,
            msg: `Already in inventory (${existing.status}). Card: ${existing.card_name} ${existing.card_number || ''}`,
            single: existing
          })
          addToast?.(`Scanned ${trimmed} already in inventory`, 'error')
        } else {
          // Not found → open in-page QuickIntakeModal pre-filled with this
          // scanner-read identifier. Keeps the user on the Scan page so they
          // can chain-scan continuously instead of navigating away each time.
          setPendingIntake(trimmed)
          // Don't push to history yet — wait for the modal's onCreated to
          // log the actual success (or onCancel to log the abort).
        }
      } else if (mode === 'batch_intake') {
        // Dedupe within the current queue. Also check DB to warn about
        // certs that already exist in inventory.
        if (batchQueue.includes(trimmed)) {
          pushHistory({
            cert: trimmed,
            mode,
            ok: false,
            msg: 'Already in the batch queue (duplicate scan)'
          })
        } else if (existing) {
          // Cert already in DB — skip, don't queue (would fail UNIQUE on submit anyway)
          pushHistory({
            cert: trimmed,
            mode,
            ok: false,
            msg: `Skipped — already in inventory (${existing.status})`,
            single: existing
          })
          addToast?.(`Skipped ${trimmed}: already in inventory`, 'error')
        } else {
          setBatchQueue(prev => [...prev, trimmed])
          pushHistory({
            cert: trimmed,
            mode,
            ok: true,
            msg: `Queued for batch intake (${batchQueue.length + 1} total)`
          })
        }
      } else if (mode === 'batch_sell') {
        // Same identity validation as single-sell, but instead of opening
        // the Sell modal now, we queue the card. User finalises the whole
        // batch in BulkSellModal.
        if (!existing) {
          pushHistory({ cert: trimmed, mode, ok: false, msg: 'Not in inventory — cannot queue for sell' })
        } else if (existing.status === 'sold') {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Already sold on ${existing.sale_date || '?'}`,
            single: existing
          })
        } else if (existing.status !== 'in_inventory') {
          pushHistory({
            cert: trimmed, mode, ok: false,
            msg: `Status is "${existing.status}" — can only sell from in_inventory`,
            single: existing
          })
        } else if (sellQueue.some(s => s.id === existing.id)) {
          pushHistory({ cert: trimmed, mode, ok: false, msg: 'Already in the sell queue (duplicate scan)' })
        } else {
          setSellQueue(prev => [...prev, existing])
          pushHistory({
            cert: trimmed, mode, ok: true,
            msg: `Queued for batch sell (${sellQueue.length + 1} total)`,
            single: existing
          })
        }
      } else if (mode === 'sell') {
        if (!existing) {
          pushHistory({
            cert: trimmed,
            mode,
            ok: false,
            msg: 'Not in inventory — switch to Intake mode to add first'
          })
          addToast?.(`Cert ${trimmed} not in inventory`, 'error')
        } else if (existing.status === 'sold') {
          const when = existing.sale_date || '?'
          const price = existing.sale_price_usd != null
            ? `$${Number(existing.sale_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : '?'
          const buyer = existing.buyer_name ? ` to ${existing.buyer_name}` : ''
          pushHistory({
            cert: trimmed,
            mode,
            ok: false,
            msg: `Already sold on ${when} for ${price}${buyer}`,
            single: existing
          })
          addToast?.(`Cert ${trimmed} already sold`, 'error')
        } else if (existing.status !== 'in_inventory') {
          pushHistory({
            cert: trimmed,
            mode,
            ok: false,
            msg: `Status is "${existing.status}" — can only sell from in_inventory`,
            single: existing
          })
          addToast?.(`Cert ${trimmed} status: ${existing.status}`, 'error')
        } else {
          // Sellable — open the sell modal
          setPendingSell(existing)
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

  const handleModeChange = (next) => {
    if (processing) return
    setMode(next)
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
            Scan Singles
          </h1>
          <p className="text-gray-400 mt-1">
            Barcode-driven intake + sell flow for graded slabs (PSA / CGC / BGS / SGC)
          </p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>
            Pick a mode, then scan a card's barcode. The input is auto-focused — your scanner gun just needs to send "digits + Enter" and the page does the rest.
          </p>
          <p className="text-gray-400 text-xs">
            Supports both <strong>TCG ID</strong> (raw cards — TCGplayer product code on the storage sleeve barcode) and <strong>cert#</strong> (graded slabs — PSA/CGC/BGS/SGC). The page tries both columns on every scan, so you don't need to tell it which kind of card you're scanning.
          </p>
        </div>
      </Instructions>

      {/* Mode toggle — 4 columns: Intake (single/batch) + Sell (single/batch) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <button
          type="button"
          onClick={() => handleModeChange('intake')}
          className={`card text-left transition-all border-2 ${
            mode === 'intake'
              ? 'border-green-500/60 bg-green-500/10'
              : 'border-transparent hover:border-vault-border'
          }`}
        >
          <div className="flex items-center gap-2 text-green-400 mb-1">
            <Package size={16} />
            <span className="font-semibold text-sm">Intake (single)</span>
          </div>
          <p className="text-gray-400 text-xs">
            Scan one card → fill quick intake form inline. Save & scan next.
          </p>
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('batch_intake')}
          className={`card text-left transition-all border-2 ${
            mode === 'batch_intake'
              ? 'border-vault-gold/60 bg-vault-gold/10'
              : 'border-transparent hover:border-vault-border'
          }`}
        >
          <div className="flex items-center gap-2 text-vault-gold mb-1">
            <Layers size={16} />
            <span className="font-semibold text-sm">Batch intake</span>
          </div>
          <p className="text-gray-400 text-xs">
            Scan many cards. Queue below. Click <strong>Continue to Bulk Add</strong> to fill details together.
          </p>
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('sell')}
          className={`card text-left transition-all border-2 ${
            mode === 'sell'
              ? 'border-red-500/60 bg-red-500/10'
              : 'border-transparent hover:border-vault-border'
          }`}
        >
          <div className="flex items-center gap-2 text-red-300 mb-1">
            <DollarSign size={16} />
            <span className="font-semibold text-sm">Sell (single)</span>
          </div>
          <p className="text-gray-400 text-xs">
            Scan one card → opens Sell modal with card loaded. Fill price + channel.
          </p>
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('batch_sell')}
          className={`card text-left transition-all border-2 ${
            mode === 'batch_sell'
              ? 'border-orange-500/60 bg-orange-500/10'
              : 'border-transparent hover:border-vault-border'
          }`}
        >
          <div className="flex items-center gap-2 text-orange-300 mb-1">
            <DollarSign size={16} />
            <span className="font-semibold text-sm">Batch sell</span>
          </div>
          <p className="text-gray-400 text-xs">
            Scan many cards. Queue below. Click <strong>Continue to Bulk Sell</strong> to enter prices + channels for all at once.
          </p>
        </button>
      </div>

      {/* Batch SELL queue (only visible in batch_sell mode and non-empty) */}
      {mode === 'batch_sell' && sellQueue.length > 0 && (
        <div className="card mb-6 border-orange-500/40 border-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-orange-300">
              <DollarSign size={16} />
              <h3 className="font-semibold text-sm">Sell queue ({sellQueue.length})</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSellQueue([])}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                <X size={12} /> Clear queue
              </button>
              <button
                type="button"
                onClick={() => setShowBulkSell(true)}
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
                title={`${s.card_name} ${s.card_number || ''}`}
              >
                {s.tcg_id || s.cert_number || '?'}
                <span className="text-gray-400 normal-case">— {s.card_name}</span>
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

      {/* Batch INTAKE queue (only visible in batch_intake mode and when there's something queued) */}
      {mode === 'batch_intake' && batchQueue.length > 0 && (
        <div className="card mb-6 border-vault-gold/40 border-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-vault-gold">
              <Layers size={16} />
              <h3 className="font-semibold text-sm">Batch queue ({batchQueue.length})</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBatchQueue([])}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                <X size={12} /> Clear queue
              </button>
              <button
                type="button"
                onClick={() => {
                  // Comma-separate cert#s into the URL — BulkAddSingles parses ?certs=
                  const qs = encodeURIComponent(batchQueue.join(','))
                  navigate(`/singles/bulk-add?certs=${qs}`)
                }}
                className="btn btn-primary text-sm py-1.5 px-3"
              >
                Continue to Bulk Add <ArrowRight size={14} />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {batchQueue.map((c, i) => (
              <span
                key={`${c}-${i}`}
                className="badge badge-info font-mono text-xs flex items-center gap-1"
              >
                {c}
                <button
                  type="button"
                  onClick={() => setBatchQueue(prev => prev.filter((_, idx) => idx !== i))}
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
            placeholder="Scan or type a TCG ID (raw) or PSA/CGC/BGS/SGC cert# (graded)..."
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
                    : mode === 'batch_intake' ? 'Queue'
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
                <th className="text-left  px-4 py-2 w-24">Time</th>
                <th className="text-left  px-4 py-2 w-20">Mode</th>
                <th className="text-left  px-4 py-2 w-40">Cert #</th>
                <th className="text-left  px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => {
                const tstr = new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                return (
                  <tr
                    key={`${h.ts}-${i}`}
                    className="border-b border-vault-border/50 last:border-0"
                  >
                    <td className="px-4 py-2 text-gray-500 text-xs">{tstr}</td>
                    <td className="px-4 py-2">
                      <span className={`badge text-xs ${
                        h.mode === 'intake' ? 'badge-info' : 'badge-warning'
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
                      {h.single && (
                        <div className="text-gray-500 text-xs mt-0.5">
                          {h.single.card_name} {h.single.card_number || ''} ·
                          {h.single.set?.name ? ` ${h.single.set.name}` : ''}
                          {h.single.grading_company ? ` · ${h.single.grading_company} ${h.single.grade}` : ''}
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

      {/* Sell modal — fires when Sell-mode scan finds an in-inventory card */}
      {pendingSell && (
        <SellSingleModal
          single={pendingSell}
          currentUserId={user?.id}
          addToast={addToast}
          onCancel={() => {
            setPendingSell(null)
            refocus()
          }}
          onSold={(updated) => {
            pushHistory({
              cert: updated.cert_number || updated.tcg_id || '?',
              mode: 'sell',
              ok: true,
              msg: `Sold for $${Number(updated.sale_price_usd || 0).toFixed(2)} via ${updated.sale_channel || 'unknown'}`,
              single: updated
            })
            setPendingSell(null)
            refocus()
          }}
        />
      )}

      {/* Bulk sell modal — opens from Batch Sell mode's "Continue" button.
          Lets user fill in price/fees/channel per queued card and submit
          all at once via markSinglesAsSoldBatch. */}
      {showBulkSell && sellQueue.length > 0 && (
        <BulkSellModal
          cards={sellQueue}
          currentUserId={user?.id}
          addToast={addToast}
          onCancel={() => {
            setShowBulkSell(false)
            refocus()
          }}
          onSold={(soldCards) => {
            soldCards.forEach(c => {
              pushHistory({
                cert: c.tcg_id || c.cert_number || '?',
                mode: 'batch_sell',
                ok: true,
                msg: `Sold ${c.card_name} for $${Number(c.sale_price_usd || 0).toFixed(2)} via ${c.sale_channel || '?'}`,
                single: c
              })
            })
            // Remove sold cards from the queue (in case there were any failures, the remaining stay)
            const soldIds = new Set(soldCards.map(c => c.id))
            setSellQueue(prev => prev.filter(s => !soldIds.has(s.id)))
            if (soldCards.length === sellQueue.length) {
              setShowBulkSell(false)
            }
            refocus()
          }}
        />
      )}

      {/* Quick intake modal — fires when Intake-mode scan hits a NEW
          identifier. Stays in-page so the scanner gun can chain reads
          across many cards without navigation round-trips. */}
      {pendingIntake && (
        <QuickIntakeModal
          scannedId={pendingIntake}
          cardSets={cardSets}
          setCardSets={setCardSets}
          currentUserId={user?.id}
          addToast={addToast}
          onCancel={() => {
            pushHistory({
              cert: pendingIntake,
              mode: 'intake',
              ok: false,
              msg: 'Cancelled — not added'
            })
            setPendingIntake(null)
            refocus()
          }}
          onCreated={(created) => {
            pushHistory({
              cert: pendingIntake,
              mode: 'intake',
              ok: true,
              msg: `Added ${created.card_name || ''} ${created.card_number || ''}`.trim(),
              single: created
            })
            setPendingIntake(null)
            refocus()
          }}
        />
      )}
    </div>
  )
}
