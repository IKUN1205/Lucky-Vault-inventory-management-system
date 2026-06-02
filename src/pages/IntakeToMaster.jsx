import React, { useState, useEffect, useRef, useMemo } from 'react'

import {
  fetchAcquisitions,
  fetchLocations,
  fetchProducts,
  createReceipt,
  deleteReceipt,
  updateAcquisitionStatus,
  updateInventory,
  convertToUSD,
  shouldAutoAllocate,
  computeAllocationSuggestion,
  createMovement,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import BarcodeScanner from '../components/BarcodeScanner'
import Instructions from '../components/Instructions'
import { Package, Check, AlertTriangle, Loader2 } from 'lucide-react'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// A pending acquisition still needs receiving. Fully-received ones drop off.
const PENDING_STATUSES = ['Purchased', 'Partially Received']
const isPending = (a) => PENDING_STATUSES.includes(a.status)

// Group acquisitions into batches for the Intake list. A "batch" = all line
// items from one Purchased Items submission (shared batch_id). Items with no
// batch_id (legacy rows) become their own solo group. Only groups that still
// have something to receive are returned; a batch where everything arrived
// drops off the page. Within a batch, pending items sort first so the
// staffer's actions sit at the top, with received items shown below (greyed,
// ✓) so they can see the whole batch and tell if it's complete.
function buildBatchGroups(allAcq) {
  const byKey = new Map()
  for (const a of allAcq) {
    const key = a.batch_id ? `batch:${a.batch_id}` : `solo:${a.id}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(a)
  }
  const groups = []
  for (const [key, items] of byKey) {
    const pendingItems = items.filter(isPending)
    if (pendingItems.length === 0) continue   // whole batch received → hide
    const sorted = [...items].sort((x, y) => {
      const xp = isPending(x) ? 0 : 1
      const yp = isPending(y) ? 0 : 1
      if (xp !== yp) return xp - yp
      return (x.created_at || '').localeCompare(y.created_at || '')
    })
    const first = items[0]
    groups.push({
      key,
      isBatch: key.startsWith('batch:'),
      vendor: first.vendor?.name || null,
      date: first.date_purchased || null,
      tracking: first.tracking_number || null,
      carrier: first.carrier || null,
      acquirer: first.acquirer?.name || null,
      items: sorted,
      totalCount: items.length,
      receivedCount: items.filter(a => !isPending(a)).length,
      pendingCount: pendingItems.length,
    })
  }
  // Most recent purchase first.
  groups.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  return groups
}

export default function IntakeToMaster() {
  
  const { toasts, addToast, removeToast } = useToast()
  
  // allAcquisitions holds EVERYTHING (incl. already-received) so a batch can
  // show its full roster + completeness. The pending list and the grouped
  // view are derived from it below.
  const [allAcquisitions, setAllAcquisitions] = useState([])
  const [products, setProducts] = useState([])           // for BarcodeScanner lookup
  const [masterLocation, setMasterLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState(null)
  // When a scan matches a pending acquisition, we briefly highlight that
  // card so the warehouse staffer's eyes know where to go. Cleared after
  // ~3s by a setTimeout — short enough that consecutive scans don't pile
  // up confusing trails.
  const [highlightedAcqId, setHighlightedAcqId] = useState(null)
  // DOM refs keyed by acquisition id — used to scroll the highlighted
  // card into view after a scan.
  const cardRefs = useRef({})
  // Smart Allocator modal state — opens after a "big enough" receive
  // (qty ≥ category threshold) OR when the user clicks the "Allocate?"
  // link on the small-receive toast. See computeAllocationSuggestion()
  // in supabase.js for the logic; thresholds are in ALLOCATION_THRESHOLDS.
  const [allocator, setAllocator] = useState(null)   // { product, qtyReceived, suggestion: {...} } | null

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [acqData, locData, prodData] = await Promise.all([
        fetchAcquisitions(),
        fetchLocations('Physical'),
        fetchProducts(),
      ])

      // Keep everything — grouping + completeness need received siblings too.
      // We still only RENDER batches that have something pending (see
      // buildBatchGroups), so fully-received history doesn't clutter the page.
      setAllAcquisitions(acqData)
      setProducts(prodData)

      // Find master inventory location
      const master = locData.find(l => l.name === 'Master Inventory')
      setMasterLocation(master)
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Called by BarcodeScanner when a scanned UPC matches a product. We then
  // look for a pending acquisition with that product_id and highlight it.
  // Edge cases:
  //   - No pending acquisition → toast and don't highlight
  //   - Multiple pending acquisitions (same SKU ordered twice) → highlight
  //     the first one; user can scroll if they meant the other
  // Derived: pending items (for scan matching) + grouped view (for render).
  const pendingAcquisitions = useMemo(
    () => allAcquisitions.filter(isPending),
    [allAcquisitions]
  )
  const batchGroups = useMemo(
    () => buildBatchGroups(allAcquisitions),
    [allAcquisitions]
  )

  const handleScanMatch = (product) => {
    const matchingAcqs = pendingAcquisitions.filter(a => a.product_id === product.id)
    if (matchingAcqs.length === 0) {
      addToast(`${product.name} has no pending order to receive`, 'error')
      return
    }
    const first = matchingAcqs[0]
    setHighlightedAcqId(first.id)
    cardRefs.current[first.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (matchingAcqs.length > 1) {
      addToast(`${product.name} has ${matchingAcqs.length} pending orders — highlighted the first`, 'info')
    } else {
      addToast(`${product.name} — ready to receive`, 'success')
    }
    setTimeout(() => setHighlightedAcqId(prev => (prev === first.id ? null : prev)), 3000)
  }

  const handleReceive = async (acquisition, receivedQty) => {
    if (!masterLocation) {
      addToast('Master Inventory location not found', 'error')
      return
    }

    setProcessingId(acquisition.id)

    // Snapshot prior state so undo can restore exactly
    const prevStatus = acquisition.status
    const prevReceived = acquisition.quantity_received || 0
    const acqId = acquisition.id
    const productId = acquisition.product_id
    const masterId = masterLocation.id

    try {
      const qty = parseInt(receivedQty)
      const totalReceived = prevReceived + qty

      // Determine new status
      let newStatus = 'Received'
      if (totalReceived < acquisition.quantity_purchased) {
        newStatus = 'Partially Received'
      } else if (totalReceived !== acquisition.quantity_purchased) {
        newStatus = 'Received - Discrepancy'
      }

      // Create receipt record
      const receipt = await createReceipt({
        acquisition_id: acqId,
        date_received: new Date().toLocaleDateString('en-CA'),
        quantity_received: qty,
        received_by: null
      })

      // Update acquisition status
      await updateAcquisitionStatus(acqId, newStatus, totalReceived)

      // Update inventory
      const costPerUnit = acquisition.cost_usd / acquisition.quantity_purchased
      await updateInventory(productId, masterId, qty, costPerUnit)

      // Fire-and-forget Lark notification — never roll back the receipt if Lark is down.
      try {
        const product = acquisition.product || {}
        const launchName = extractLaunchName(product.name, product.category)
        const productLabel = `${product.brand || 'Unknown'} | ${launchName} | ${product.category || ''} (${product.language || '—'})`
        const unit = (product.category || '').toLowerCase().includes('pack') ? 'packs' : 'boxes'
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'receive',
            productLabel,
            acquirer: acquisition.acquirer?.name || null,
            thisBatch: qty,
            totalReceived,
            totalOrdered: acquisition.quantity_purchased,
            status: newStatus,
            unit
          })
        }).catch(err => {
          console.error('[lark-notify] receive request failed (receipt still saved):', err)
        })
      } catch (err) {
        console.error('[lark-notify] failed to build receive payload:', err)
      }

      const undo = async () => {
        try {
          // Reverse inventory delta
          await updateInventory(productId, masterId, -qty)
          // Restore acquisition's prior status + qty_received
          await updateAcquisitionStatus(acqId, prevStatus, prevReceived)
          // Hard-delete the receipt row
          if (receipt?.id) await deleteReceipt(receipt.id)
          addToast('Undone — receipt reverted', 'info')
          loadData()
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }

      const product = acquisition.product || {}
      const openAllocator = async () => {
        try {
          const suggestion = await computeAllocationSuggestion({
            productId, qtyAvailable: qty,
          })
          setAllocator({ product, productId, qtyReceived: qty, suggestion })
        } catch (err) {
          console.error('[IntakeToMaster] allocator load failed:', err)
          addToast(`Could not load allocation suggestion: ${err.message || err}`, 'error')
        }
      }
      const auto = shouldAutoAllocate(product.category, qty)
      if (auto) {
        addToast(`Received ${qty} into Master`, 'success', { action: { label: 'Undo', onClick: undo } })
        // Wait a tick so the receive Lark POST is in flight, then open modal
        setTimeout(openAllocator, 0)
      } else {
        // Below threshold — quiet success + optional manual link
        addToast(
          `Received ${qty} into Master`,
          'success',
          { action: { label: 'Allocate?', onClick: openAllocator } }
        )
      }

      // Refresh data
      loadData()
    } catch (error) {
      console.error('Error processing intake:', error)
      addToast('Failed to process intake', 'error')
    } finally {
      setProcessingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Package className="text-cyan-400" />
          Intake to Master
        </h1>
        <p className="text-gray-400 mt-1">Receive purchased items into Master Inventory</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">When purchased items arrive:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Find the <span className="text-vault-gold">purchase order</span> in the list below</li>
            <li>Verify <span className="text-vault-gold">physical items match</span> the order</li>
            <li>Enter <span className="text-vault-gold">quantity received</span> (can be partial)</li>
            <li>Click <span className="text-vault-gold">Receive</span></li>
          </ol>
          <p className="text-cyan-400 text-xs mt-3">💡 Items are added to Master Inventory with their purchase cost</p>
        </div>
      </Instructions>

      {/* Scan a box's UPC to jump to its pending order card. Works any
          time there are pending acquisitions to filter through (skip the
          empty-state). The unknown-barcode modal lets warehouse staff
          associate a freshly-arrived box's UPC with the matching product
          on the fly. */}
      {pendingAcquisitions.length > 0 && (
        <div className="mb-4">
          <BarcodeScanner
            products={products}
            onMatched={handleScanMatch}
            onBarcodeAssociated={(productId, barcode) => {
              setProducts(prev => prev.map(p =>
                p.id === productId ? { ...p, barcode } : p
              ))
            }}
            addToast={addToast}
            hint="Scan a box's UPC to jump to its pending order below."
          />
        </div>
      )}

      {pendingAcquisitions.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">No pending items to receive</p>
        </div>
      ) : (
        <div className="space-y-5">
          {batchGroups.map(group => (
            group.isBatch ? (
              <BatchGroup
                key={group.key}
                group={group}
                onReceive={handleReceive}
                processingId={processingId}
                highlightedAcqId={highlightedAcqId}
                cardRefs={cardRefs}
              />
            ) : (
              // Legacy solo row (no batch_id) — render the bare card like before.
              group.items.filter(isPending).map(acq => (
                <div
                  key={acq.id}
                  ref={(el) => { cardRefs.current[acq.id] = el }}
                  className={`transition-all duration-300 rounded-xl ${
                    highlightedAcqId === acq.id ? 'ring-2 ring-vault-gold ring-offset-2 ring-offset-vault-dark' : ''
                  }`}
                >
                  <IntakeCard
                    acquisition={acq}
                    onReceive={handleReceive}
                    processing={processingId === acq.id}
                  />
                </div>
              ))
            )
          ))}
        </div>
      )}

      {/* Smart Allocator modal — opens after a big-enough Receive (per-category
          threshold) OR via the manual "Allocate?" link on small receives. */}
      {allocator && (
        <AllocatorModal
          allocator={allocator}
          onClose={() => setAllocator(null)}
          masterLocationId={masterLocation?.id}
          addToast={addToast}
          reload={loadData}
        />
      )}
    </div>
  )
}

// A batch = all items from one purchase order (shared batch_id). Header shows
// who/when + an X/Y received completeness badge so staff can tell at a glance
// whether the whole shipment has landed. Pending items get the full IntakeCard
// (with Receive); already-received items show as a greyed ✓ row so the batch
// roster stays complete.
function BatchGroup({ group, onReceive, processingId, highlightedAcqId, cardRefs }) {
  const complete = group.receivedCount === group.totalCount
  return (
    <div className="card border-cyan-500/20">
      {/* Batch header */}
      <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-vault-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Package size={16} className="text-cyan-400 flex-shrink-0" />
            <span className="font-semibold text-white">{group.vendor || 'Purchase'}</span>
            {group.date && <span className="text-gray-500 text-sm">{new Date(group.date).toLocaleDateString()}</span>}
            {group.acquirer && <span className="text-gray-500 text-sm">· {group.acquirer}</span>}
          </div>
          {group.tracking && (
            <div className="text-xs text-gray-500 mt-1">
              {group.carrier ? `${group.carrier} · ` : ''}{group.tracking}
            </div>
          )}
        </div>
        <span className={`badge flex-shrink-0 ${complete ? 'badge-success' : 'badge-warning'}`}>
          {group.receivedCount}/{group.totalCount} received
        </span>
      </div>

      {/* Items */}
      <div className="space-y-3">
        {group.items.map(item => (
          isPending(item) ? (
            <div
              key={item.id}
              ref={(el) => { cardRefs.current[item.id] = el }}
              className={`transition-all duration-300 rounded-xl ${
                highlightedAcqId === item.id ? 'ring-2 ring-vault-gold ring-offset-2 ring-offset-vault-dark' : ''
              }`}
            >
              <IntakeCard
                acquisition={item}
                onReceive={onReceive}
                processing={processingId === item.id}
              />
            </div>
          ) : (
            <ReceivedRow key={item.id} acquisition={item} />
          )
        ))}
      </div>
    </div>
  )
}

// Greyed, non-actionable row for an already-received item inside a batch.
function ReceivedRow({ acquisition }) {
  const p = acquisition.product || {}
  const launchName = extractLaunchName(p.name, p.category)
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-vault-darker/30 border border-vault-border/50 rounded-lg opacity-70">
      <div className="flex items-center gap-2 min-w-0">
        <Check size={16} className="text-emerald-400 flex-shrink-0" />
        <span className="text-sm text-gray-300 truncate">
          <span className="text-vault-gold">{p.brand}</span>
          {' | '}{launchName}
          {p.category ? ` | ${p.category}` : ''}
        </span>
      </div>
      <span className="text-xs text-emerald-400 flex-shrink-0 whitespace-nowrap">
        {acquisition.quantity_received}/{acquisition.quantity_purchased} ✓
      </span>
    </div>
  )
}

function IntakeCard({ acquisition, onReceive, processing }) {
  const [receiveQty, setReceiveQty] = useState(
    acquisition.quantity_purchased - (acquisition.quantity_received || 0)
  )
  const [showConfirm, setShowConfirm] = useState(false)

  const remaining = acquisition.quantity_purchased - (acquisition.quantity_received || 0)
  const isPartial = acquisition.quantity_received > 0

  const handleSubmit = () => {
    if (receiveQty <= 0 || receiveQty > remaining) return
    onReceive(acquisition, receiveQty)
    setShowConfirm(false)
  }

  return (
    <div className="card">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Product Info */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge ${isPartial ? 'badge-warning' : 'badge-info'}`}>
              {isPartial ? 'Partial' : 'Pending'}
            </span>
            <span className="text-gray-500 text-sm">
              {new Date(acquisition.date_purchased).toLocaleDateString()}
            </span>
          </div>
          
          <h3 className="font-display text-lg font-semibold text-white">
            <span className="text-vault-gold">{acquisition.product?.brand}</span>
            <span className="text-gray-400"> | </span>
            {extractLaunchName(acquisition.product?.name, acquisition.product?.category)}
            <span className="text-gray-400"> | </span>
            <span className="text-gray-300">{acquisition.product?.category}</span>
          </h3>
          
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-400">
            <span>Sealed/Unsealed: {acquisition.product?.type}</span>
            <span>Language: {acquisition.product?.language}</span>
            <span>Acquirer: {acquisition.acquirer?.name}</span>
          </div>
          
          <div className="mt-2">
            <span className="text-vault-gold font-semibold">
              {acquisition.quantity_received || 0} / {acquisition.quantity_purchased} received
            </span>
            <span className="text-gray-500 ml-2">
              (${acquisition.cost_usd?.toFixed(2)} total)
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {showConfirm ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={receiveQty}
                onChange={(e) => setReceiveQty(parseInt(e.target.value) || 0)}
                min="1"
                max={remaining}
                className="w-20"
              />
              <button
                onClick={handleSubmit}
                disabled={processing || receiveQty <= 0 || receiveQty > remaining}
                className="btn btn-primary"
              >
                {processing ? (
                  <div className="spinner w-5 h-5 border-2"></div>
                ) : (
                  <Check size={20} />
                )}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="btn btn-secondary"
                disabled={processing}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="btn btn-primary"
            >
              <Package size={20} />
              Receive {remaining}
            </button>
          )}
        </div>
      </div>

      {/* Discrepancy warning */}
      {receiveQty < remaining && showConfirm && (
        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2 text-yellow-400 text-sm">
          <AlertTriangle size={18} />
          Receiving less than expected will mark as partial/discrepancy
        </div>
      )}
    </div>
  )
}

// ============================================================================
// AllocatorModal — Smart restock dialog after a Receive
// ============================================================================
// Suggests how the just-received units should be moved out of Master to each
// Stream Room + Front Store, based on last 7 days of channel-level sales.
// Three exits:
//   - Apply        → creates real Move records (Master → each room) and
//                    fires the existing 'move' Lark per route
//   - Adjust       → numbers become editable; same Apply path on commit
//   - Skip         → no Moves; fires an 'allocation_suggestion' Lark so the
//                    channel team sees the recommendation as advisory
// ============================================================================
function AllocatorModal({ allocator, onClose, masterLocationId, addToast, reload }) {
  const { product, productId, qtyReceived, suggestion } = allocator
  // Local editable copy of rows so the user can tweak before applying.
  const [rows, setRows] = useState(
    (suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))
  )
  const [submitting, setSubmitting] = useState(false)
  const productLabel = `${product.brand || ''} | ${extractLaunchName(product.name, product.category)} | ${product.category || ''}`.replace(/^\s*\|\s*/, '').trim()
  const totalSend = rows.reduce((s, r) => s + (Number(r.send) || 0), 0)
  const keepAtMaster = qtyReceived - totalSend
  const overcommitted = totalSend > qtyReceived

  const setRowSend = (locationId, v) => {
    const n = Math.max(0, parseInt(v) || 0)
    setRows(prev => prev.map(r => r.location_id === locationId ? { ...r, send: n } : r))
  }

  const apply = async () => {
    if (overcommitted) {
      addToast(`Can't send more than received (${qtyReceived})`, 'error')
      return
    }
    if (!masterLocationId) {
      addToast('Master location id missing', 'error')
      return
    }
    setSubmitting(true)
    try {
      let moved = 0
      for (const r of rows) {
        const qty = Number(r.send) || 0
        if (qty <= 0) continue
        // Real Move: decrement Master, increment room, record movement row.
        await createMovement({
          product_id: productId,
          from_location_id: masterLocationId,
          to_location_id: r.location_id,
          quantity: qty,
          notes: `Smart allocation after receive`,
        })
        await updateInventory(productId, masterLocationId, -qty)
        await updateInventory(productId, r.location_id, +qty)
        // One 'move' Lark per destination (matches existing move format).
        try {
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'move',
              fromLocation: 'Master Inventory',
              toLocation: r.location_name,
              items: [{ name: productLabel, quantity: qty }],
              totalUnits: qty,
              user: 'Allocator',
            }),
          }).catch(() => {})
        } catch (_) {}
        moved += qty
      }
      addToast(`Moved ${moved} unit${moved === 1 ? '' : 's'} to ${rows.filter(r => Number(r.send) > 0).length} location${rows.filter(r => Number(r.send) > 0).length === 1 ? '' : 's'}`, 'success')
      onClose()
      reload?.()
    } catch (err) {
      console.error('[AllocatorModal] apply failed:', err)
      addToast(`Apply failed: ${err.message || err}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const skip = async () => {
    setSubmitting(true)
    try {
      // Fire-and-forget — the receive happened regardless of Lark health.
      const payloadRows = rows.map(r => ({
        location_name: r.location_name,
        current_stock: r.current_stock,
        daily_velocity: r.daily_velocity,
        suggested_send: Number(r.send) || 0,   // honor any user tweaks
      }))
      fetch('/api/lark-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'allocation_suggestion',
          productLabel,
          qtyReceived,
          windowDays: suggestion.window_days,
          totalSold: suggestion.total_sold_in_window,
          isDying: suggestion.is_dying,
          rows: payloadRows,
        }),
      }).catch(() => {})
      addToast('Saved as suggestion — not moved', 'info')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-2xl w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Package size={18} className="text-vault-gold" />
          <h3 className="font-semibold text-base text-white">Smart restock — how should this split?</h3>
        </div>
        <p className="text-sm text-gray-300 mb-1">
          Just received: <span className="text-white">{productLabel}</span> × <span className="text-vault-gold font-semibold">{qtyReceived}</span> at Master
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Last {suggestion.window_days} days total: {suggestion.total_sold_in_window} sold ({suggestion.total_daily_velocity}/day)
          {suggestion.is_dying && (
            <span className="ml-2 text-amber-300">· ⚠ Slow seller — no restock suggested</span>
          )}
        </p>

        {suggestion.is_dying ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-sm text-amber-200">
            This SKU has barely moved in the last {suggestion.window_days} days. We recommend
            keeping all {qtyReceived} at Master and pushing them out later if demand picks up.
            You can still tweak the numbers below and Apply if you want to override.
          </div>
        ) : null}

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs border-b border-vault-border/50">
                <th className="py-2">STREAM ROOM</th>
                <th className="py-2 text-right">SOLD/DAY</th>
                <th className="py-2 text-right">CURRENT</th>
                <th className="py-2 text-right">TARGET</th>
                <th className="py-2 text-right">SEND</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vault-border/30">
              {rows.map(r => {
                const short = r.location_name.replace(/^Stream Room\s*[-—]\s*/i, '')
                return (
                  <tr key={r.location_id}>
                    <td className="py-1.5 text-white">{short}</td>
                    <td className="py-1.5 text-right text-gray-300">{r.daily_velocity}</td>
                    <td className="py-1.5 text-right text-gray-300">{r.current_stock}</td>
                    <td className="py-1.5 text-right text-gray-300">{r.target}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number" min="0"
                        value={r.send}
                        onChange={(e) => setRowSend(r.location_id, e.target.value)}
                        disabled={submitting}
                        className="w-20 text-right px-2 py-1 text-sm"
                      />
                    </td>
                  </tr>
                )
              })}
              <tr className="font-semibold">
                <td className="py-2 text-gray-300">Keep at Master</td>
                <td className="py-2 text-right text-gray-500">—</td>
                <td className="py-2 text-right text-gray-500">—</td>
                <td className="py-2 text-right text-gray-500">—</td>
                <td className={`py-2 text-right font-mono ${overcommitted ? 'text-red-300' : 'text-gray-200'}`}>{keepAtMaster}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-vault-border/50">
                <td colSpan={4} className="py-2 text-right text-xs text-gray-500">Total send</td>
                <td className={`py-2 text-right font-mono ${overcommitted ? 'text-red-300' : 'text-vault-gold'}`}>
                  {totalSend} / {qtyReceived}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {overcommitted && (
          <div className="text-xs text-red-300 mt-2">Total send is more than what was received — reduce some numbers.</div>
        )}

        <div className="flex justify-between items-center gap-2 mt-5">
          <button
            type="button"
            onClick={skip}
            disabled={submitting}
            className="text-sm px-3 py-2 text-gray-300 hover:text-white"
          >
            Skip — keep at Master (send Lark advisory)
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={submitting || totalSend === 0 || overcommitted}
              className="btn btn-primary px-4 py-2 text-sm"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : `Apply — move ${totalSend}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
