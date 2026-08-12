import React, { useState, useEffect, useRef, useMemo } from 'react'

import {
  fetchAcquisitions,
  fetchLocations,
  fetchProducts,
  createReceipt,
  voidReceipt,
  fetchInventoryRow,
  updateAcquisitionStatus,
  updateInventory,
  convertToUSD,
  shouldAutoAllocate,
  computeAllocationSuggestion,
  createMovement,
  logAllocationDecision,
} from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import BarcodeScanner from '../components/BarcodeScanner'
import Instructions from '../components/Instructions'
import ProductThumb from '../components/ProductThumb'
import { Package, Check, AlertTriangle, Loader2, Search, X } from 'lucide-react'

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
  const { user } = useAuth()
  
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
  // Last receive, kept so it can still be undone after the toast is gone.
  // A toast action lasts 8s; staff notice a wrong receive minutes later
  // (2026-08-05: a receive against a shipment that hadn't physically arrived
  // could only be reversed by hand, because the undo below was never wired up).
  // { label, undo, at, acqId }
  const [lastReceive, setLastReceive] = useState(null)
  const [undoing, setUndoing] = useState(false)

  // Receive notifications are batched into one message per session.
  //
  // Gary 2026-08-12: nine notifications from one sitting, six lines each. They
  // were all correct — a single shipment is several acquisition rows (tracking
  // 875535947181 was eight, including Mega Symphonia as a 1 and a 6) and the
  // message fired per row, so the two lines actually worth reading were buried.
  //
  // Batching trades immediacy for legibility, and it must not trade away
  // delivery: a queue that only flushes on a timer loses everything if the tab
  // closes, where the old code lost at most one message. So the flush also runs
  // on unmount and on pagehide via sendBeacon, which browsers still deliver
  // while the page is going away.
  const pendingNotify = useRef([])
  const notifyTimer = useRef(null)
  const NOTIFY_IDLE_MS = 45000

  const flushNotify = (viaBeacon = false) => {
    const receipts = pendingNotify.current
    if (!receipts.length) return
    pendingNotify.current = []
    if (notifyTimer.current) { clearTimeout(notifyTimer.current); notifyTimer.current = null }
    const payload = JSON.stringify({
      type: 'receive_digest',
      receiver: user?.name || null,
      receipts,
      // Deliveries that landed but were never taken in. Computed from what the
      // page already has, so it costs nothing and puts the thing people keep
      // missing right under what they just did.
      outstanding: outstandingRef.current,
    })
    try {
      if (viaBeacon && navigator.sendBeacon) {
        // sendBeacon returns false when the browser refuses to queue it (size
        // caps, or beacons disabled). The queue is already emptied by then, so
        // ignoring the result drops the whole session's digest silently —
        // StreamCounts.jsx checks this same return for the same reason.
        const queued = navigator.sendBeacon(
          '/api/lark-notify', new Blob([payload], { type: 'application/json' }))
        if (queued) return
        console.warn('[lark-notify] beacon refused — falling back to keepalive fetch')
      }
      fetch('/api/lark-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true,
      }).catch(err => console.error('[lark-notify] digest failed (receipts still saved):', err))
    } catch (err) {
      console.error('[lark-notify] digest send threw:', err)
    }
  }

  const scheduleNotifyFlush = () => {
    if (notifyTimer.current) clearTimeout(notifyTimer.current)
    notifyTimer.current = setTimeout(() => flushNotify(false), NOTIFY_IDLE_MS)
  }

  // Kept in a ref so flushNotify — which also runs from a pagehide handler —
  // never reads a stale render's copy.
  const outstandingRef = useRef([])

  useEffect(() => {
    const onHide = () => flushNotify(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flushNotify(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      // Deliveries the carrier has already dropped that are still not booked
      // into Master. On 2026-08-12 two Storm Emeralda shipments delivered on
      // 08-01 and 08-04 — 148 boxes, ~$28k — sat at zero received while newer
      // arrivals were being taken in around them, and Master was showing 0 of
      // that product while eBay orders shipped from it. Nothing surfaced it,
      // so it rides out on the intake digest.
      outstandingRef.current = (acqData || [])
        .filter(a => !a.deleted && a.tracking_delivered_at
          && (Number(a.quantity_received) || 0) < (Number(a.quantity_purchased) || 0))
        .map(a => ({
          setName: extractLaunchName(a.product?.name, a.product?.category),
          name: a.product?.name || 'Unknown',
          remaining: (Number(a.quantity_purchased) || 0) - (Number(a.quantity_received) || 0),
          totalOrdered: Number(a.quantity_purchased) || 0,
          trackingNumber: a.tracking_number || null,
          deliveredAt: a.tracking_delivered_at,
        }))
        .sort((x, y) => y.remaining - x.remaining)

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

      // Queue for the session digest rather than firing one message per row.
      // Never roll back the receipt if Lark is down.
      try {
        const product = acquisition.product || {}
        pendingNotify.current.push({
          // Identifies this queued line so an undo can pull it back out —
          // announcing a receive that was reversed 30 seconds ago is worse
          // than announcing nothing, because nothing follows to correct it.
          _receiptId: receipt?.id || null,
          setName: extractLaunchName(product.name, product.category),
          name: `${product.brand || 'Unknown'} | ${extractLaunchName(product.name, product.category)} | ${product.category || ''} (${product.language || '—'})`,
          acquirer: acquisition.acquirer?.name || null,
          thisBatch: qty,
          totalReceived,
          totalOrdered: acquisition.quantity_purchased,
          status: newStatus,
          trackingNumber: acquisition.tracking_number || null,
        })
        scheduleNotifyFlush()
      } catch (err) {
        console.error('[lark-notify] failed to queue receive:', err)
      }

      const undo = async () => {
        // Single-shot. The steps below are not a transaction, so a second
        // click after a mid-way failure would deduct the same units again —
        // the offer is withdrawn before anything is touched and never
        // reinstated, except on the pre-flight refusals that write nothing.
        setUndoing(true)
        try {
          // The units have to still be in Master. Smart Allocator moves a
          // receive out to the stream rooms right after it lands, and the
          // undo only ever knew how to take them back out of Master — so
          // undoing an allocated receive drove Master negative while the
          // rooms kept the stock. Read the room, don't assume it.
          const row = await fetchInventoryRow(productId, masterId)
          const inMaster = Number(row?.quantity) || 0
          if (inMaster < qty) {
            addToast(
              `Can't undo — Master holds ${inMaster} of these, not ${qty}. `
              + `They were already allocated out. Reverse the Move first, then undo.`,
              'error')
            setUndoing(false)
            return
          }
          setLastReceive(null)
          // Pull it out of the digest queue before touching anything. If it
          // was already sent this is a no-op and the group saw a receive that
          // really did happen at the time.
          if (receipt?.id) {
            pendingNotify.current = pendingNotify.current.filter(p => p._receiptId !== receipt.id)
          }

          await updateInventory(productId, masterId, -qty)
          // From here a failure leaves a real inconsistency, so say exactly
          // which half survived instead of a generic "undo failed".
          try {
            await updateAcquisitionStatus(acqId, prevStatus, prevReceived)
            if (receipt?.id) await voidReceipt(receipt.id, `intake undo of ${qty} units`)
          } catch (tailErr) {
            console.error('Undo half-completed:', tailErr)
            addToast(
              `Stock was taken back out of Master, but the acquisition still `
              + `shows it as received. Fix the acquisition by hand — do NOT press undo again.`,
              'error')
            loadData()
            return
          }
          addToast('Undone — stock returned and the receipt voided', 'info')
          loadData()
        } catch (err) {
          console.error('Undo failed:', err)
          addToast(`Undo failed: ${err.message || err}. Nothing was changed.`, 'error')
          // The inventory call is the first write; if it threw, nothing
          // moved, so it is safe to offer the button again.
          setLastReceive(prev => prev || {
            acqId, at: Date.now(),
            label: `${qty} × ${acquisition.product?.name || 'item'}`,
            undo,
          })
        } finally {
          setUndoing(false)
        }
      }

      // Keep it reversible after the toast expires. Replacing the previous
      // entry is deliberate: only the most recent receive is offered, so an
      // undo can never reverse a receive that a later one already built on.
      setLastReceive({
        acqId,
        at: Date.now(),
        label: `${qty} × ${acquisition.product?.name || 'item'}`,
        undo,
      })

      const product = acquisition.product || {}
      const auto = shouldAutoAllocate(product.category, qty)
      // Only queue into pendingAllocations when we hit the per-category
      // threshold (Box 30 / Pack 100 / others 10). Below threshold stays
      // quiet — no sticky banner, no modal nag — but the cashier can
      // still force-allocate via the "Allocate?" toast link if they want
      // (useful for high-value low-qty items like Premium Collections).
      const queueAndOpen = async (opts = {}) => {
        try {
          const suggestion = await computeAllocationSuggestion({ productId, qtyAvailable: qty })
          setPendingAllocations(prev => [
            ...prev,
            // acqId is carried as its own field: it is a UUID, so it cannot be
            // parsed back out of `key` by splitting on '-'.
            { key: `pa-${acqId}-${Date.now()}`, acqId, product, productId, qtyReceived: qty, suggestion, done: false },
          ])
          if (opts.openModal) setAllocatorOpen(true)
        } catch (err) {
          console.error('[IntakeToMaster] suggestion load failed:', err)
          addToast(`Could not load allocation suggestion: ${err.message || err}`, 'error')
        }
      }
      if (auto) {
        await queueAndOpen()
        addToast(
          `Received ${qty} into Master — pending allocation`,
          'success',
          { action: { label: 'Allocate now', onClick: () => setAllocatorOpen(true) } }
        )
      } else {
        // Below threshold — no banner, no queue. Cashier can opt in via toast link.
        addToast(
          `Received ${qty} into Master`,
          'success',
          { action: { label: 'Allocate?', onClick: () => queueAndOpen({ openModal: true }) } }
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

      {/* Undo the last receive — stays until it's used or another receive
          replaces it, so a mistake caught minutes later is still fixable. */}
      {lastReceive && (
        <div className="mb-4 card !py-3 border-amber-500/30 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-white">
              Received <span className="text-vault-gold">{lastReceive.label}</span> into Master
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Wrong order, or the shipment hasn't actually arrived? Undo puts the stock,
              the order status and the receipt back exactly as they were.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn btn-secondary !py-1.5 !px-3 text-sm"
              disabled={undoing}
              onClick={async () => {
                if (undoing) return
                if (!window.confirm(`Undo receiving ${lastReceive.label} into Master?`)) return
                setUndoing(true)
                try {
                  await lastReceive.undo()
                } finally {
                  setUndoing(false)
                }
              }}
            >
              {undoing ? 'Undoing…' : 'Undo receive'}
            </button>
            <button
              className="text-gray-500 hover:text-gray-300 text-sm px-2"
              title="Dismiss"
              onClick={() => setLastReceive(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

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
          on the fly. Below the scanner, a text search lets staff type a
          product name instead of scanning — useful when the UPC is
          scuffed, the scanner's dead, or the box hasn't been labeled
          yet. Both paths land on the same handleScanMatch. */}
      {pendingAcquisitions.length > 0 && (
        <div className="mb-4 space-y-3">
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
          <PendingSearch
            pendingAcquisitions={pendingAcquisitions}
            onPick={handleScanMatch}
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
            const allocatedAcqId =
              (pendingAllocations.find(p => p.key === key) || {}).acqId || null
            setPendingAllocations(prev => prev.map(p => p.key === key ? { ...p, done: true } : p))
            // Once these goods have been moved out of Master, undo can no
            // longer put them back — it only knew how to deduct from Master,
            // so it would drive that room negative and leave the stream rooms
            // holding stock nobody ordered. Withdraw the offer for THIS
            // receive only: clearing it unconditionally also killed a
            // perfectly good undo for a different receive still sitting in
            // Master. The undo re-checks Master itself as the real guard.
            setLastReceive(prev =>
              (prev && allocatedAcqId && prev.acqId === allocatedAcqId) ? null : prev)
          }}
          onAllDone={() => {
            setAllocatorOpen(false)
            setPendingAllocations([])
          }}
          masterLocationId={masterLocation?.id}
          decidedById={user?.id || null}
          addToast={addToast}
          reload={loadData}
        />
      )}
    </div>
  )
}

// Text-search box that complements the BarcodeScanner. Builds a deduped
// list of products that still have a pending acquisition, filters as the
// user types, and on pick fires the same onMatched callback that the
// scanner uses — so the scroll-to + highlight behavior is consistent
// between scan and type. Closes on outside click + escape; submits on
// Enter (picks the top match).
function PendingSearch({ pendingAcquisitions, onPick }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(0)
  const boxRef = useRef(null)

  // Dedup pending acquisitions down to unique products (a single batch
  // can have multiple line items for different SKUs; we want one row
  // per product).
  const products = useMemo(() => {
    const byId = new Map()
    for (const a of pendingAcquisitions) {
      const p = a.product
      if (!p?.id) continue
      if (!byId.has(p.id)) byId.set(p.id, { ...p, _pending_count: 1 })
      else byId.get(p.id)._pending_count++
    }
    return [...byId.values()]
  }, [pendingAcquisitions])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return []
    const tokens = q.split(/\s+/).filter(Boolean)
    return products
      .map(p => {
        const hay = [p.name, p.brand, p.category, p.language].filter(Boolean).join(' ').toLowerCase()
        const hits = tokens.filter(t => hay.includes(t)).length
        return { p, hits, hay }
      })
      .filter(m => m.hits === tokens.length)
      // Prefer matches that start with the first token (better feeling).
      .sort((a, b) => {
        const t = tokens[0]
        const aStart = a.hay.indexOf(t)
        const bStart = b.hay.indexOf(t)
        return aStart - bStart
      })
      .slice(0, 8)
      .map(m => m.p)
  }, [q, products])

  // Reset highlight when results change.
  useEffect(() => { setHoverIdx(0) }, [matches.length])

  // Close on outside click.
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (p) => {
    onPick(p)
    setQuery('')
    setOpen(false)
  }

  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => Math.min(i + 1, matches.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => Math.max(i - 1, 0)); return }
    if (e.key === 'Enter')     { e.preventDefault(); pick(matches[hoverIdx]); return }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="card !p-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            placeholder="…or type a product name to find its pending order"
            className="flex-1 bg-transparent border-0 outline-none text-sm py-1"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setOpen(false) }}
              className="text-gray-400 hover:text-white"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {q && open && (
          <div className="mt-2 -mx-3 -mb-3 max-h-72 overflow-y-auto border-t border-vault-border">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500 italic">
                No pending orders match "{query}".
              </p>
            ) : (
              matches.map((p, i) => {
                const lname = extractLaunchName(p.name, p.category)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseEnter={() => setHoverIdx(i)}
                    onClick={() => pick(p)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 ${
                      hoverIdx === i ? 'bg-vault-gold/15' : 'hover:bg-vault-darker/60'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-vault-gold">{p.brand}</span>
                      <span className="text-gray-500"> · </span>
                      <span className="text-white">{lname}</span>
                      <span className="text-gray-500"> · </span>
                      <span className="text-gray-300">{p.category || p.type}</span>
                      {p.language && <>
                        <span className="text-gray-500"> · </span>
                        <span className="text-blue-400">{p.language}</span>
                      </>}
                    </span>
                    {p._pending_count > 1 && (
                      <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 flex-shrink-0">
                        {p._pending_count} pending
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
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
          
          <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            {/* Thumbnail for 收货对版 — eyeball the arriving box against the order */}
            <ProductThumb productId={acquisition.product_id} size={40} />
            <span>
              <span className="text-vault-gold">{acquisition.product?.brand}</span>
              <span className="text-gray-400"> | </span>
              {extractLaunchName(acquisition.product?.name, acquisition.product?.category)}
              <span className="text-gray-400"> | </span>
              <span className="text-gray-300">{acquisition.product?.category}</span>
            </span>
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
function BatchAllocatorModal({ items, onClose, onItemDone, onAllDone, masterLocationId, decidedById, addToast, reload }) {
  // Local editable copy of each item's rows. Indexed by item key.
  // Init lazily, then keep in sync as `items` grows — staff can keep
  // receiving while the modal is open, and each new pending entry needs
  // its own draft slot. Without the sync useEffect below, accessing
  // draft[newItem.key] in render throws and the whole modal blanks.
  // (bug seen in production 2026-06-04.)
  const [draft, setDraft] = useState(() => Object.fromEntries(
    items.map(it => [it.key, (it.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))])
  ))
  useEffect(() => {
    setDraft(prev => {
      let next = prev
      let mutated = false
      for (const it of items) {
        if (next[it.key]) continue
        if (!mutated) { next = { ...prev }; mutated = true }
        next[it.key] = (it.suggestion?.rows || []).map(r => ({ ...r, send: r.suggested_send }))
      }
      return mutated ? next : prev
    })
  }, [items])
  // Which item keys are in "我手动改" / edit mode. Default = display
  // only (numbers shown as gold read-only text). Click "Adjust" to
  // unlock the inputs for that item; click Cancel to revert + lock.
  const [editingKeys, setEditingKeys] = useState(new Set())
  const isEditing = (k) => editingKeys.has(k)
  const setEditing = (k, on) => setEditingKeys(prev => {
    const next = new Set(prev)
    on ? next.add(k) : next.delete(k)
    return next
  })

  const [busyKey, setBusyKey] = useState(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const productLabel = (product) => {
    const lname = extractLaunchName(product.name, product.category)
    return `${product.brand || ''} | ${lname} | ${product.category || ''}`.replace(/^\s*\|\s*/, '').trim()
  }
  // Defensive: if a new item appears in `items` before the sync useEffect
  // has filled in its draft entry, treat its totalSend as 0 rather than
  // crashing on undefined.reduce(...).
  const totalSend = (key) => (draft[key] || []).reduce((s, r) => s + (Number(r.send) || 0), 0)

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
  // useSuggested=true → apply the ORIGINAL suggested numbers regardless of
  // any draft edits ('一键挪过去'). false → apply whatever's in the draft
  // (which is what the user typed in edit mode).
  // skipReload=true → caller (applyAllSuggested) reloads once at the end
  //   instead of N times in the loop. Default false so the per-item buttons
  //   (Apply changes / 一键挪过去) refresh the parent page; without that
  //   reload the IntakeToMaster view never reflected the move and staff
  //   reasonably concluded "smart allocator 移不动" (bug 2026-06-03).
  const applyOne = async (item, { useSuggested = false, skipReload = false, overrideRows = null } = {}) => {
    const rows = overrideRows
      || (useSuggested
        ? (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))
        : (draft[item.key] || (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))))
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
      // Special-case ts=0 = "Keep all at Master, no Lark advisory" — staff
      // explicitly committed the decision to NOT move anything (directive
      // 2026-06-04). Different from Skip, which fires a Lark suggestion.
      if (ts === 0) {
        addToast(`Kept ${item.qtyReceived} of ${productLabel(item.product)} at Master`, 'success')
      } else {
        addToast(`Moved ${moved} of ${productLabel(item.product)} → ${routes} room${routes === 1 ? '' : 's'}`, 'success')
      }
      // Fire-and-forget audit log so future LLM/heuristic refinement
      // can learn from this decision vs the baseline suggestion.
      logAllocationDecision({
        productId: item.productId,
        product: item.product,
        qtyReceived: item.qtyReceived,
        suggestion: item.suggestion,
        finalRows: rows,
        action: ts === 0 ? 'apply_keep_at_master' : (useSuggested ? 'apply_suggested' : 'apply_adjusted'),
        decidedById,
      }).catch(() => {})
      onItemDone(item.key)
      // Refresh the parent inventory view so the user actually sees the
      // move take effect. Skipped when called from applyAllSuggested
      // (it reloads once after the loop).
      if (!skipReload) {
        try { await reload?.() } catch (e) { console.warn('[BatchAllocator] reload after apply failed:', e) }
      }
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
      // Audit log for skipped (advisory) decisions too — same shape as
      // apply, just with action='skip' and no real Moves happened.
      logAllocationDecision({
        productId: item.productId,
        product: item.product,
        qtyReceived: item.qtyReceived,
        suggestion: item.suggestion,
        finalRows: rows,
        action: 'skip',
        decidedById,
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
      // Pass overrideRows directly to applyOne instead of mutating the
      // draft dict — that mutation worked but was a React anti-pattern
      // that could race with the state-tracked draft on re-renders.
      for (const item of items) {
        const rows = (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))
        await applyOne(item, { skipReload: true, overrideRows: rows })
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
          💡 每张卡有三个选项: <span className="text-gray-300">先不动 / 我手动改 / 一键挪过去</span>.
          {' '}底部 "Apply all" 一键全部按建议处理.
        </p>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {items.map(item => {
            const rows = draft[item.key] || (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))
            const ts = totalSend(item.key)
            const over = ts > item.qtyReceived
            const keep = item.qtyReceived - ts
            const isBusy = busyKey === item.key
            const editing = isEditing(item.key)
            // For display, show the SUGGESTED values when not editing
            // (so 一键挪过去 means what you see is what you'll apply).
            const displayRows = editing
              ? rows
              : (item.suggestion.rows || []).map(r => ({ ...r, send: r.suggested_send }))
            const displayTotal = displayRows.reduce((s, r) => s + (Number(r.send) || 0), 0)
            const displayKeep = item.qtyReceived - displayTotal
            const displayOver = displayTotal > item.qtyReceived
            return (
              <div
                key={item.key}
                className={`bg-vault-darker/40 border rounded-lg p-3 ${editing ? 'border-vault-gold/60 ring-1 ring-vault-gold/30' : 'border-vault-border'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{productLabel(item.product)}</div>
                    <div className="text-xs text-gray-500">
                      Received: <span className="text-vault-gold font-semibold">{item.qtyReceived}</span>
                      {' '}· Last {item.suggestion.window_days}d: {item.suggestion.total_sold_in_window} sold ({item.suggestion.total_daily_velocity}/day)
                      {item.suggestion.is_dying && <span className="ml-2 text-amber-300">⚠ slow</span>}
                      {editing && <span className="ml-2 text-vault-gold">· editing</span>}
                    </div>
                  </div>
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
                      {displayRows.map(r => {
                        const short = r.location_name.replace(/^Stream Room\s*[-—]\s*/i, '')
                        return (
                          <tr key={r.location_id} className="border-b border-vault-border/20">
                            <td className="py-1 text-white">{short}</td>
                            <td className="py-1 text-right text-gray-400">{r.daily_velocity}</td>
                            <td className="py-1 text-right text-gray-400">{r.current_stock}</td>
                            <td className="py-1 text-right text-gray-400">{r.target}</td>
                            <td className="py-1 text-right">
                              {editing ? (
                                <input
                                  type="number" min="0"
                                  value={r.send}
                                  onChange={(e) => setRowSend(item.key, r.location_id, e.target.value)}
                                  disabled={isBusy || batchBusy}
                                  className="w-16 text-right px-1.5 py-0.5 text-sm border border-vault-gold/60 bg-vault-gold/5 rounded"
                                />
                              ) : (
                                <span className="font-mono text-sm text-vault-gold">{r.send}</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td className="py-1 text-gray-300 text-xs">Keep at Master</td>
                        <td colSpan={3}></td>
                        <td className={`py-1 text-right font-mono text-sm ${displayOver ? 'text-red-300' : 'text-gray-200'}`}>{displayKeep}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="py-1 text-right text-[10px] text-gray-500">Total send</td>
                        <td className={`py-1 text-right font-mono text-sm ${displayOver ? 'text-red-300' : 'text-vault-gold'}`}>{displayTotal} / {item.qtyReceived}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {displayOver && (
                  <div className="text-[11px] text-red-300 mt-1">Send total exceeds received — reduce.</div>
                )}

                {/* Three primary buttons per directive 2026-06-02:
                    [先不动 / Skip] [我手动改 / Adjust] [一键挪过去 / Apply suggested]
                    In edit mode the middle pair swaps to Cancel + Apply changes. */}
                <div className="flex justify-end gap-2 mt-3">
                  {!editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => skipOne(item)}
                        disabled={isBusy || batchBusy}
                        className="text-xs px-3 py-1.5 text-gray-300 hover:text-white border border-vault-border rounded"
                      >
                        先不动 · Skip
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(item.key, true)}
                        disabled={isBusy || batchBusy}
                        className="text-xs px-3 py-1.5 text-blue-300 hover:bg-blue-500/10 border border-blue-500/40 rounded"
                      >
                        我手动改 · Adjust
                      </button>
                      <button
                        type="button"
                        onClick={() => applyOne(item, { useSuggested: true })}
                        disabled={isBusy || batchBusy || displayTotal === 0}
                        className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold"
                      >
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : `一键挪过去 · Apply ${displayTotal}`}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { resetItem(item); setEditing(item.key, false) }}
                        disabled={isBusy || batchBusy}
                        className="text-xs px-3 py-1.5 text-gray-300 hover:text-white border border-vault-border rounded"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => applyOne(item, { useSuggested: false }).then(ok => ok && setEditing(item.key, false))}
                        disabled={isBusy || batchBusy || over}
                        className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold"
                      >
                        {isBusy
                          ? <Loader2 size={12} className="animate-spin" />
                          : (ts === 0 ? 'Keep at Master' : `Apply changes · ${ts}`)}
                      </button>
                    </>
                  )}
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
