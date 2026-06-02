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
  // Smart Allocator — queues every receive into a pending list rather
  // than popping the modal one SKU at a time (directive 2026-06-02:
  // "shipment as boundary"). Sticky banner shows the count; click it to
  // open ONE modal that walks the user through every pending SKU.
  // pendingAllocations: [{ key, product, productId, qtyReceived, suggestion, done }]
  const [pendingAllocations, setPendingAllocations] = useState([])
  const [allocatorOpen, setAllocatorOpen] = useState(false)

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
      // Queue this receive into pending allocations. Sticky banner shows
      // the count; user clicks to open the modal and work through them.
      // Above the per-category threshold → toast nudges them to open it
      // right away; below → quiet success.
      try {
        const suggestion = await computeAllocationSuggestion({
          productId, qtyAvailable: qty,
        })
        setPendingAllocations(prev => [
          ...prev,
          {
            key: `pa-${acqId}-${Date.now()}`,
            product, productId, qtyReceived: qty, suggestion, done: false,
          },
        ])
      } catch (err) {
        console.error('[IntakeToMaster] suggestion load failed:', err)
        addToast(`Could not load allocation suggestion: ${err.message || err}`, 'error')
      }
      const auto = shouldAutoAllocate(product.category, qty)
      if (auto) {
        addToast(
          `Received ${qty} into Master — pending allocation`,
          'success',
          { action: { label: 'Allocate now', onClick: () => setAllocatorOpen(true) } }
        )
      } else {
        addToast(
          `Received ${qty} into Master`,
          'success',
          { action: { label: 'Undo', onClick: undo } }
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

      {/* Sticky bottom banner — visible whenever there are pending
          allocations from this session. Clicking opens the batch modal. */}
      {pendingAllocations.some(p => !p.done) && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 max-w-2xl">
          <button
            type="button"
            onClick={() => setAllocatorOpen(true)}
            className="flex items-center gap-3 bg-vault-gold/95 text-vault-dark px-4 py-3 rounded-xl shadow-2xl border border-vault-gold/60 hover:bg-vault-gold transition"
          >
            <Package size={18} />
            <span className="font-semibold">
              {pendingAllocations.filter(p => !p.done).length} item{pendingAllocations.filter(p => !p.done).length === 1 ? '' : 's'} pending allocation
            </span>
            <span className="text-sm">— click to review</span>
          </button>
        </div>
      )}

      {/* Batch Allocator modal — one modal handles all pending receives.
          Per-item Apply / Skip + global Apply-all / Skip-remaining. */}
      {allocatorOpen && pendingAllocations.some(p => !p.done) && (
        <BatchAllocatorModal
          items={pendingAllocations.filter(p => !p.done)}
          onClose={() => setAllocatorOpen(false)}
          onItemDone={(key) => {
            setPendingAllocations(prev => prev.map(p => p.key === key ? { ...p, done: true } : p))
          }}
          onAllDone={() => {
            setAllocatorOpen(false)
            setPendingAllocations([])
          }}
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
// BatchAllocatorModal — handle the whole shipment's allocations at once
// ============================================================================
// Renders every pending receive as a card with its own per-room table.
// Each card supports:
//   - Editable Send inputs (always — that's how the cashier "manually changes")
//   - "Reset to suggestion" button (in case you mess up the numbers)
//   - Per-card Apply (real Moves + 'move' Lark per route)
//   - Per-card Skip (advisory 'allocation_suggestion' Lark, no inventory change)
// Plus footer-level batch actions:
//   - "Apply all (use suggested)" — applies every un-actioned card with original numbers
//   - "Skip all" — fires advisories for everything left
// ============================================================================
function BatchAllocatorModal({ items, onClose, onItemDone, onAllDone, masterLocationId, addToast, reload }) {
  // Local copy of each item's editable rows. Indexed by item key.
  const [draft, setDraft] = useState(() => Object.fromEntries(
    items.map(it => [it.key, (it.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))])
  ))
  const [busyKey, setBusyKey] = useState(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const productLabel = (product) => {
    const lname = extractLaunchName(product.name, product.category)
    return `${product.brand || ''} | ${lname} | ${product.category || ''}`.replace(/^\s*\|\s*/, '').trim()
  }
  const totalSend = (key) => draft[key].reduce((s, r) => s + (Number(r.send) || 0), 0)

  const setRowSend = (itemKey, locationId, v) => {
    const n = Math.max(0, parseInt(v) || 0)
    setDraft(d => ({
      ...d,
      [itemKey]: d[itemKey].map(r => r.location_id === locationId ? { ...r, send: n } : r),
    }))
  }
  const resetItem = (item) => {
    setDraft(d => ({
      ...d,
      [item.key]: (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send })),
    }))
  }

  // ---- per-item actions ----
  const applyOne = async (item) => {
    const rows = draft[item.key]
    const ts = rows.reduce((s, r) => s + (Number(r.send) || 0), 0)
    if (ts > item.qtyReceived) {
      addToast(`${productLabel(item.product)}: send (${ts}) exceeds received (${item.qtyReceived})`, 'error')
      return false
    }
    if (!masterLocationId) { addToast('Master location id missing', 'error'); return false }
    setBusyKey(item.key)
    try {
      let moved = 0, routes = 0
      for (const r of rows) {
        const qty = Number(r.send) || 0
        if (qty <= 0) continue
        await createMovement({
          product_id: item.productId,
          from_location_id: masterLocationId,
          to_location_id: r.location_id,
          quantity: qty,
          notes: 'Smart allocation after receive',
        })
        await updateInventory(item.productId, masterLocationId, -qty)
        await updateInventory(item.productId, r.location_id, +qty)
        // Best-effort per-route Lark
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'move',
            fromLocation: 'Master Inventory',
            toLocation: r.location_name,
            items: [{ name: productLabel(item.product), quantity: qty }],
            totalUnits: qty,
            user: 'Allocator',
          }),
        }).catch(() => {})
        moved += qty
        routes += 1
      }
      addToast(`Moved ${moved} of ${productLabel(item.product)} → ${routes} room${routes === 1 ? '' : 's'}`, 'success')
      onItemDone(item.key)
      return true
    } catch (err) {
      console.error('[BatchAllocator] apply failed:', err)
      addToast(`Apply failed: ${err.message || err}`, 'error')
      return false
    } finally {
      setBusyKey(null)
    }
  }
  const skipOne = async (item) => {
    setBusyKey(item.key)
    try {
      const rows = draft[item.key]
      const payloadRows = rows.map(r => ({
        location_name: r.location_name,
        current_stock: r.current_stock,
        daily_velocity: r.daily_velocity,
        suggested_send: Number(r.send) || 0,
      }))
      fetch('/api/lark-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'allocation_suggestion',
          productLabel: productLabel(item.product),
          qtyReceived: item.qtyReceived,
          windowDays: item.suggestion.window_days,
          totalSold: item.suggestion.total_sold_in_window,
          isDying: item.suggestion.is_dying,
          rows: payloadRows,
        }),
      }).catch(() => {})
      addToast(`Saved as suggestion: ${productLabel(item.product)}`, 'info')
      onItemDone(item.key)
      return true
    } finally {
      setBusyKey(null)
    }
  }

  // ---- batch actions ----
  const applyAllSuggested = async () => {
    setBatchBusy(true)
    try {
      // Reset every item to original suggestion before applying, so this
      // button's name "use suggested" matches its behavior.
      for (const item of items) {
        setDraft(d => ({
          ...d,
          [item.key]: (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send })),
        }))
      }
      // Wait a tick for state to settle (or just iterate using item.suggestion directly)
      for (const item of items) {
        const rows = (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))
        const orig = draft
        draft[item.key] = rows   // sync for applyOne
        await applyOne(item)
      }
      reload?.()
      onAllDone()
    } finally {
      setBatchBusy(false)
    }
  }
  const skipAll = async () => {
    setBatchBusy(true)
    try {
      for (const item of items) await skipOne(item)
      onAllDone()
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-3xl w-full p-5 shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-vault-gold" />
            <h3 className="font-semibold text-base text-white">Smart restock — {items.length} item{items.length === 1 ? '' : 's'} to allocate</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xs">close</button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          💡 The Send numbers are suggestions based on last 7 days of sales. <span className="text-gray-300">Tap any Send field to change it</span> — or use the per-item Reset link to put the suggestion back.
        </p>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {items.map(item => {
            const rows = draft[item.key]
            const ts = totalSend(item.key)
            const over = ts > item.qtyReceived
            const keep = item.qtyReceived - ts
            const isBusy = busyKey === item.key
            return (
              <div key={item.key} className="bg-vault-darker/40 border border-vault-border rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{productLabel(item.product)}</div>
                    <div className="text-xs text-gray-500">
                      Received: <span className="text-vault-gold font-semibold">{item.qtyReceived}</span>
                      {' '}· Last {item.suggestion.window_days}d: {item.suggestion.total_sold_in_window} sold ({item.suggestion.total_daily_velocity}/day)
                      {item.suggestion.is_dying && <span className="ml-2 text-amber-300">⚠ slow</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetItem(item)}
                    disabled={isBusy || batchBusy}
                    className="text-[11px] text-gray-400 hover:text-vault-gold underline disabled:opacity-50"
                    title="Put the suggested numbers back"
                  >Reset to suggestion</button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-[10px] border-b border-vault-border/40">
                        <th className="py-1">STREAM ROOM</th>
                        <th className="py-1 text-right">SOLD/DAY</th>
                        <th className="py-1 text-right">CURRENT</th>
                        <th className="py-1 text-right">TARGET</th>
                        <th className="py-1 text-right">SEND</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const short = r.location_name.replace(/^Stream Room\s*[-—]\s*/i, '')
                        const edited = Number(r.send) !== Number(r.suggested_send)
                        return (
                          <tr key={r.location_id} className="border-b border-vault-border/20">
                            <td className="py-1 text-white">{short}</td>
                            <td className="py-1 text-right text-gray-400">{r.daily_velocity}</td>
                            <td className="py-1 text-right text-gray-400">{r.current_stock}</td>
                            <td className="py-1 text-right text-gray-400">{r.target}</td>
                            <td className="py-1 text-right">
                              <input
                                type="number" min="0"
                                value={r.send}
                                onChange={(e) => setRowSend(item.key, r.location_id, e.target.value)}
                                disabled={isBusy || batchBusy}
                                className={`w-16 text-right px-1.5 py-0.5 text-sm border ${edited ? 'border-vault-gold/60 bg-vault-gold/5' : 'border-vault-border'} rounded`}
                              />
                            </td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td className="py-1 text-gray-300 text-xs">Keep at Master</td>
                        <td colSpan={3}></td>
                        <td className={`py-1 text-right font-mono text-sm ${over ? 'text-red-300' : 'text-gray-200'}`}>{keep}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="py-1 text-right text-[10px] text-gray-500">Total send</td>
                        <td className={`py-1 text-right font-mono text-sm ${over ? 'text-red-300' : 'text-vault-gold'}`}>{ts} / {item.qtyReceived}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {over && (
                  <div className="text-[11px] text-red-300 mt-1">Send total exceeds received — reduce.</div>
                )}

                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => skipOne(item)}
                    disabled={isBusy || batchBusy}
                    className="text-xs px-3 py-1.5 text-gray-300 hover:text-white"
                  >
                    Skip (Lark only)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyOne(item)}
                    disabled={isBusy || batchBusy || ts === 0 || over}
                    className="text-xs px-3 py-1.5 bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded hover:bg-vault-gold/30 disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 size={12} className="animate-spin" /> : `Apply ${ts}`}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Batch footer actions */}
        <div className="flex justify-between items-center gap-2 mt-4 pt-3 border-t border-vault-border/50">
          <button
            type="button"
            onClick={skipAll}
            disabled={batchBusy}
            className="text-sm px-3 py-2 text-gray-300 hover:text-white"
          >
            Skip all remaining (Lark advisories)
          </button>
          <button
            type="button"
            onClick={applyAllSuggested}
            disabled={batchBusy || items.length === 0}
            className="btn btn-primary px-4 py-2 text-sm"
          >
            {batchBusy ? <Loader2 size={14} className="animate-spin" /> : `Apply all (use suggested)`}
          </button>
        </div>
      </div>
    </div>
  )
}
