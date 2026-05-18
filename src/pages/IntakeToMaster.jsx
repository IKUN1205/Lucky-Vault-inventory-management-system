import React, { useState, useEffect, useRef } from 'react'

import {
  fetchAcquisitions,
  fetchLocations,
  fetchProducts,
  createReceipt,
  deleteReceipt,
  updateAcquisitionStatus,
  updateInventory,
  convertToUSD
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import BarcodeScanner from '../components/BarcodeScanner'
import Instructions from '../components/Instructions'
import { Package, Check, AlertTriangle } from 'lucide-react'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function IntakeToMaster() {
  
  const { toasts, addToast, removeToast } = useToast()
  
  const [acquisitions, setAcquisitions] = useState([])
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

      // Filter to show only pending items
      const pending = acqData.filter(a =>
        a.status === 'Purchased' || a.status === 'Partially Received'
      )
      setAcquisitions(pending)
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
  const handleScanMatch = (product) => {
    const matchingAcqs = acquisitions.filter(a => a.product_id === product.id)
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

      addToast(
        `Received ${qty} units into Master Inventory`,
        'success',
        { action: { label: 'Undo', onClick: undo } }
      )

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
      {acquisitions.length > 0 && (
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

      {acquisitions.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">No pending items to receive</p>
        </div>
      ) : (
        <div className="space-y-4">
          {acquisitions.map(acq => (
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
          ))}
        </div>
      )}
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
