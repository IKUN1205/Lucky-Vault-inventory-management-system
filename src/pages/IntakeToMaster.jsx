import React, { useState, useEffect } from 'react'

import { 
  fetchAcquisitions,
  fetchLocations,
  createReceipt,
  updateAcquisitionStatus,
  updateInventory,
  convertToUSD
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
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
  const [masterLocation, setMasterLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [acqData, locData] = await Promise.all([
        fetchAcquisitions(),
        fetchLocations('Physical')
      ])
      
      // Filter to show only pending items
      const pending = acqData.filter(a => 
        a.status === 'Purchased' || a.status === 'Partially Received'
      )
      setAcquisitions(pending)
      
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

  const handleReceive = async (acquisition, receivedQty) => {
    if (!masterLocation) {
      addToast('Master Inventory location not found', 'error')
      return
    }

    setProcessingId(acquisition.id)

    try {
      const qty = parseInt(receivedQty)
      const totalReceived = (acquisition.quantity_received || 0) + qty
      
      // Determine new status
      let newStatus = 'Received'
      if (totalReceived < acquisition.quantity_purchased) {
        newStatus = 'Partially Received'
      } else if (totalReceived !== acquisition.quantity_purchased) {
        newStatus = 'Received - Discrepancy'
      }

      // Create receipt record
      await createReceipt({
        acquisition_id: acquisition.id,
        date_received: new Date().toISOString().split('T')[0],
        quantity_received: qty,
        received_by: null
      })

      // Update acquisition status
      await updateAcquisitionStatus(acquisition.id, newStatus, totalReceived)

      // Update inventory
      const costPerUnit = acquisition.cost_usd / acquisition.quantity_purchased
      await updateInventory(
        acquisition.product_id,
        masterLocation.id,
        qty,
        costPerUnit
      )

      addToast(`Received ${qty} units into Master Inventory`)
      
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

      {acquisitions.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">No pending items to receive</p>
        </div>
      ) : (
        <div className="space-y-4">
          {acquisitions.map(acq => (
            <IntakeCard 
              key={acq.id} 
              acquisition={acq} 
              onReceive={handleReceive}
              processing={processingId === acq.id}
            />
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
