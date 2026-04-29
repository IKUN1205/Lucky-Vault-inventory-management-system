import React, { useState, useEffect } from 'react'
import { 
  fetchProducts,
  fetchLocations,
  fetchInventory,
  createGradingSubmission,
  createMovement,
  updateInventory
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { Diamond, Save } from 'lucide-react'

export default function SendToGrading() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [locations, setLocations] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    date_sent: new Date().toISOString().split('T')[0],
    grading_company: 'PSA',
    grading_location: 'USA',
    from_location_id: '',
    product_id: '',
    quantity_sent: 1,
    notes: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (form.from_location_id) {
      loadInventoryForLocation(form.from_location_id)
    }
  }, [form.from_location_id])

  const loadData = async () => {
    try {
      const locData = await fetchLocations('Physical')
      setLocations(locData)
      
      const master = locData.find(l => l.name === 'Master Inventory')
      if (master) {
        setForm(f => ({ ...f, from_location_id: master.id }))
      }
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryForLocation = async (locationId) => {
    try {
      const invData = await fetchInventory(locationId)
      // Filter to singles only (cards that can be graded)
      const singlesInv = invData.filter(inv => inv.product?.type === 'Single')
      setInventory(singlesInv)
    } catch (error) {
      console.error('Error loading inventory:', error)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const selectedInventory = inventory.find(inv => inv.product_id === form.product_id)
  const maxQuantity = selectedInventory?.quantity || 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.product_id || !form.from_location_id) {
      addToast('Please fill all required fields', 'error')
      return
    }

    if (parseInt(form.quantity_sent) > maxQuantity) {
      addToast(`Only ${maxQuantity} available`, 'error')
      return
    }

    setSubmitting(true)

    try {
      const qty = parseInt(form.quantity_sent)

      // Create grading submission
      await createGradingSubmission({
        date_sent: form.date_sent,
        grading_company: form.grading_company,
        grading_location: form.grading_location,
        product_id: form.product_id,
        quantity_sent: qty,
        status: 'Sent',
        notes: form.notes,
        created_by: profile?.id
      })

      // Update inventory - subtract from source
      await updateInventory(
        form.product_id,
        form.from_location_id,
        -qty
      )

      addToast(`Sent ${qty} singles to ${form.grading_company} for grading!`)
      
      // Reset form
      setForm(f => ({
        ...f,
        product_id: '',
        quantity_sent: 1,
        notes: ''
      }))
      
      loadInventoryForLocation(form.from_location_id)
    } catch (error) {
      console.error('Error creating grading submission:', error)
      addToast('Failed to create grading submission', 'error')
    } finally {
      setSubmitting(false)
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
      
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Diamond className="text-indigo-400" />
          Send to Grading
        </h1>
        <p className="text-gray-400 mt-1">Send singles to PSA, CGC, or Beckett for grading</p>
      </div>

      <form onSubmit={handleSubmit} className="card max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date Sent *</label>
            <input
              type="date"
              name="date_sent"
              value={form.date_sent}
              onChange={handleChange}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">From Location *</label>
            <select
              name="from_location_id"
              value={form.from_location_id}
              onChange={handleChange}
              required
            >
              <option value="">Select location...</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Grading Company *</label>
            <select
              name="grading_company"
              value={form.grading_company}
              onChange={handleChange}
              required
            >
              <option value="PSA">PSA</option>
              <option value="CGC">CGC</option>
              <option value="Beckett">Beckett</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Grading Location *</label>
            <select
              name="grading_location"
              value={form.grading_location}
              onChange={handleChange}
              required
            >
              <option value="USA">USA</option>
              <option value="China">China</option>
            </select>
          </div>
        </div>

        {form.from_location_id && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Singles to Grade * (showing singles in stock)
              </label>
              <select
                name="product_id"
                value={form.product_id}
                onChange={handleChange}
                required
              >
                <option value="">Select singles...</option>
                {inventory
                  .sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || ''))
                  .map(inv => (
                  <option key={inv.id} value={inv.product_id}>
                    {inv.product?.brand} - {inv.product?.type} - {inv.product?.name} - {inv.product?.category} ({inv.product?.language}) - {inv.quantity} avail
                  </option>
                ))}
              </select>
            </div>

            {form.product_id && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Quantity * (max: {maxQuantity})
                </label>
                <input
                  type="number"
                  name="quantity_sent"
                  value={form.quantity_sent}
                  onChange={handleChange}
                  min="1"
                  max={maxQuantity}
                  required
                />
              </div>
            )}
          </>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={2}
            placeholder="Optional notes..."
          />
        </div>

        <div className="mt-6">
          <button 
            type="submit" 
            className="btn btn-primary w-full"
            disabled={submitting || !form.product_id}
          >
            {submitting ? (
              <div className="spinner w-5 h-5 border-2"></div>
            ) : (
              <>
                <Save size={20} />
                Send to Grading
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
