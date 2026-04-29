import React, { useState, useEffect } from 'react'
import { fetchLocations, fetchInventory, createMovement, updateInventory } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import Instructions from '../components/Instructions'
import { ArrowRightLeft, ArrowRight, Save } from 'lucide-react'

// All valid physical locations for inventory movement
const ALLOWED_LOCATION_NAMES = [
  'Master Inventory',
  'Front Store',
  'Slab Room',
  // Stream Rooms (correctly named — TikTok and Whatnot are separate platforms)
  'Stream Room - eBay LuckyVaultUS',
  'Stream Room - eBay SlabbiePatty',
  'Stream Room - TikTok RocketsHQ',
  'Stream Room - TikTok Packheads',
  'Stream Room - Whatnot'
]

// Helper to extract Launch Name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function MovedInventory() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [locations, setLocations] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    from_location_id: '',
    to_location_id: '',
    product_id: '',
    quantity: 1,
    notes: ''
  })

  const [productFilters, setProductFilters] = useState({ brand: '', type: '' })

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (form.from_location_id) loadInventoryForLocation(form.from_location_id)
  }, [form.from_location_id])

  const loadData = async () => {
    try {
      const locData = await fetchLocations()
      setLocations(locData)
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
      // Filter to sealed products only
      const sealedOnly = invData.filter(inv => 
        inv.product?.type === 'Sealed' || inv.product?.type === 'Pack'
      )
      setInventory(sealedOnly)
    } catch (error) {
      console.error('Error loading inventory:', error)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (name === 'from_location_id') {
      setForm(f => ({ ...f, product_id: '', quantity: 1 }))
    }
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setProductFilters(f => ({ ...f, [name]: value }))
    setForm(f => ({ ...f, product_id: '' }))
  }

  const filteredInventory = inventory.filter(inv => {
    if (productFilters.brand && inv.product?.brand !== productFilters.brand) return false
    if (productFilters.type && inv.product?.type !== productFilters.type) return false
    return true
  })

  const selectedInventory = inventory.find(inv => inv.product_id === form.product_id)
  const maxQuantity = selectedInventory?.quantity || 0

  const allowedLocations = locations.filter(l => ALLOWED_LOCATION_NAMES.includes(l.name))
  const physicalLocations = allowedLocations.filter(l => l.type === 'Physical')
  const allDestinations = allowedLocations.filter(l => l.id !== form.from_location_id)

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.from_location_id || !form.to_location_id || !form.product_id) {
      addToast('Please fill all required fields', 'error')
      return
    }
    
    if (form.quantity > maxQuantity) {
      addToast(`Only ${maxQuantity} available`, 'error')
      return
    }

    setSubmitting(true)

    try {
      const qty = parseInt(form.quantity)
      const costBasis = selectedInventory?.avg_cost_basis * qty

      await createMovement({
        date: form.date,
        product_id: form.product_id,
        from_location_id: form.from_location_id,
        to_location_id: form.to_location_id,
        quantity: qty,
        cost_basis: costBasis,
        movement_type: 'Transfer',
        notes: form.notes
      })

      await updateInventory(form.product_id, form.from_location_id, -qty)
      await updateInventory(form.product_id, form.to_location_id, qty, selectedInventory?.avg_cost_basis)

      addToast('Inventory moved successfully!')
      setForm(f => ({ ...f, product_id: '', quantity: 1, notes: '' }))
      loadInventoryForLocation(form.from_location_id)
    } catch (error) {
      console.error('Error moving inventory:', error)
      addToast('Failed to move inventory', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Format for SearchableSelect - new nomenclature
  const formatProductOption = (inv) => {
    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
    return (
      <div className="flex items-center gap-2">
        <span className="text-vault-gold">{inv.product?.brand}</span>
        <span className="text-gray-400">|</span>
        <span className="text-white">{launchName}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-300">{inv.product?.category}</span>
        <span className="text-gray-400">|</span>
        <span className="text-blue-400">{inv.product?.language}</span>
        <span className="text-green-400 ml-2">• {inv.quantity} avail</span>
      </div>
    )
  }

  const getProductLabel = (inv) => {
    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
    return `${inv.product?.brand} | ${launchName} | ${inv.product?.category} | ${inv.product?.language} - ${inv.quantity} avail`
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ArrowRightLeft className="text-orange-400" />
          Move Inventory
        </h1>
        <p className="text-gray-400 mt-1">Transfer inventory between locations</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Transfer products between locations:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select <span className="text-vault-gold">FROM location</span> (where it's coming from)</li>
            <li>Select <span className="text-vault-gold">TO location</span> (where it's going)</li>
            <li>Search and select the <span className="text-vault-gold">product</span></li>
            <li>Enter <span className="text-vault-gold">quantity</span> to move</li>
            <li>Click <span className="text-vault-gold">Move Inventory</span></li>
          </ol>
          <p className="text-orange-400 text-xs mt-3">💡 Common: Master Inventory → Stream Room before streams</p>
        </div>
      </Instructions>

      <form onSubmit={handleSubmit} className="card max-w-2xl">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
          <input type="date" name="date" value={form.date} onChange={handleChange} required />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">From Location *</label>
            <select name="from_location_id" value={form.from_location_id} onChange={handleChange} required>
              <option value="">Select source...</option>
              {physicalLocations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </div>

          <div className="flex justify-center">
            <ArrowRight className="text-vault-gold" size={24} />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">To Location *</label>
            <select name="to_location_id" value={form.to_location_id} onChange={handleChange} required>
              <option value="">Select destination...</option>
              {allDestinations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </div>
        </div>

        {form.from_location_id && (
          <div className="pt-6 border-t border-vault-border">
            <h3 className="font-display text-lg font-semibold text-white mb-4">Select Product</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Brand</label>
                <select name="brand" value={productFilters.brand} onChange={handleFilterChange}>
                  <option value="">All</option>
                  <option value="Pokemon">Pokemon</option>
                  <option value="One Piece">One Piece</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Sealed/Unsealed</label>
                <select name="type" value={productFilters.type} onChange={handleFilterChange}>
                  <option value="">All</option>
                  <option value="Sealed">Sealed</option>
                  <option value="Pack">Pack</option>
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Product * (in stock)</label>
              <p className="text-xs text-gray-500 mb-2">Format: Brand | Launch Name | Product Type | Language</p>
              <SearchableSelect
                options={filteredInventory}
                value={form.product_id}
                onChange={(val) => setForm(f => ({ ...f, product_id: val, quantity: 1 }))}
                placeholder="Search..."
                getOptionValue={(inv) => inv.product_id}
                getOptionLabel={getProductLabel}
                renderOption={formatProductOption}
              />
            </div>

            {form.product_id && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">Quantity * (max: {maxQuantity})</label>
                <input type="number" name="quantity" value={form.quantity} onChange={handleChange} min="1" max={maxQuantity} required />
              </div>
            )}

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
              <input type="text" name="notes" value={form.notes} onChange={handleChange} placeholder="Optional" />
            </div>
          </div>
        )}

        <div className="mt-6">
          <button type="submit" className="btn btn-primary w-full" disabled={submitting || !form.product_id}>
            {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Move Inventory</>}
          </button>
        </div>
      </form>
    </div>
  )
}
