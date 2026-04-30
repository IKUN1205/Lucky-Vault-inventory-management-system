import React, { useState, useEffect } from 'react'
import { fetchProducts, fetchLocations, updateInventory } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import Instructions from '../components/Instructions'
import { PackagePlus, Save, Plus, Trash2 } from 'lucide-react'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// Get currency based on language
const getCurrency = (language) => {
  switch(language) {
    case 'JP': return 'YEN'
    case 'CN': return 'RMB'
    default: return 'USD'
  }
}

export default function ManualInventory() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [products, setProducts] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('single')

  const [form, setForm] = useState({
    product_id: '',
    location_id: '',
    quantity: '',
    avg_cost_basis: ''
  })

  const [bulkItems, setBulkItems] = useState([
    { id: 1, product_id: '', quantity: 1, avg_cost_basis: '' }
  ])
  const [bulkLocation, setBulkLocation] = useState('')

  const [productFilters, setProductFilters] = useState({
    brand: '',
    type: '',
    language: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [productsData, locationsData] = await Promise.all([
        fetchProducts(),
        fetchLocations('Physical')
      ])
      // Filter to only sealed products
      const sealedProducts = productsData.filter(p => p.type === 'Sealed' || p.type === 'Pack')
      setProducts(sealedProducts)
      setLocations(locationsData)
      
      const master = locationsData.find(l => l.name === 'Master Inventory')
      if (master) {
        setForm(f => ({ ...f, location_id: master.id }))
        setBulkLocation(master.id)
      }
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setProductFilters(f => ({ ...f, [name]: value }))
    setForm(f => ({ ...f, product_id: '' }))
  }

  const filteredProducts = products.filter(p => {
    if (productFilters.brand && p.brand !== productFilters.brand) return false
    if (productFilters.type && p.type !== productFilters.type) return false
    if (productFilters.language && p.language !== productFilters.language) return false
    return true
  })

  // Bulk handlers
  const addBulkItem = () => {
    const newId = Math.max(...bulkItems.map(i => i.id), 0) + 1
    setBulkItems([...bulkItems, { id: newId, product_id: '', quantity: 1, avg_cost_basis: '' }])
  }

  const removeBulkItem = (id) => {
    if (bulkItems.length <= 1) return
    setBulkItems(bulkItems.filter(i => i.id !== id))
  }

  const updateBulkItem = (id, field, value) => {
    setBulkItems(bulkItems.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!form.product_id || !form.location_id) {
      addToast('Please select product and location', 'error')
      return
    }

    if (!form.quantity || parseInt(form.quantity) <= 0) {
      addToast('Please enter a valid quantity', 'error')
      return
    }

    setSubmitting(true)

    const productId = form.product_id
    const locationId = form.location_id
    const qty = parseInt(form.quantity)

    try {
      const avgCostBasis = form.avg_cost_basis !== '' ? parseFloat(form.avg_cost_basis) : null
      await updateInventory(productId, locationId, qty, avgCostBasis)

      // Undo: subtract the same qty back. Cost basis isn't restored — it's
      // only changed if the user supplied one, and we don't track the prior
      // value. Reversing the qty is the meaningful part for accidental adds.
      const undo = async () => {
        try {
          await updateInventory(productId, locationId, -qty)
          addToast('Undone — inventory reverted', 'info')
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }

      setForm(f => ({ ...f, product_id: '', quantity: '', avg_cost_basis: '' }))
      addToast(`Added ${qty} units to inventory`, 'success', { action: { label: 'Undo', onClick: undo } })
    } catch (error) {
      console.error('Error adding inventory:', error)
      addToast('Failed to add inventory', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkSubmit = async (e) => {
    e.preventDefault()

    if (!bulkLocation) {
      addToast('Please select a location', 'error')
      return
    }

    const validItems = bulkItems.filter(item => item.product_id && item.quantity > 0)
    if (validItems.length === 0) {
      addToast('Please add at least one product', 'error')
      return
    }

    setSubmitting(true)
    const completed = []  // { product_id, qty } per successful row
    const targetLocation = bulkLocation

    for (const item of validItems) {
      try {
        const qty = parseInt(item.quantity)
        const avgCostBasis = item.avg_cost_basis !== '' ? parseFloat(item.avg_cost_basis) : null
        await updateInventory(item.product_id, targetLocation, qty, avgCostBasis)
        completed.push({ product_id: item.product_id, qty })
      } catch (err) {
        console.error('Error adding item:', err)
      }
    }

    const undo = async () => {
      try {
        for (const c of completed) {
          await updateInventory(c.product_id, targetLocation, -c.qty)
        }
        addToast(`Undone — ${completed.length} item${completed.length === 1 ? '' : 's'} reverted`, 'info')
      } catch (err) {
        console.error('Undo failed:', err)
        addToast('Undo failed — check console', 'error')
      }
    }

    setBulkItems([{ id: 1, product_id: '', quantity: 1, avg_cost_basis: '' }])
    setSubmitting(false)
    addToast(
      `${completed.length} item${completed.length === 1 ? '' : 's'} added to inventory`,
      'success',
      completed.length > 0 ? { action: { label: 'Undo', onClick: undo } } : undefined
    )
  }

  // Format product for SearchableSelect - using new nomenclature
  const formatProductOption = (product) => {
    const launchName = extractLaunchName(product.name, product.category)
    return (
      <div className="flex items-center gap-2">
        <span className="text-vault-gold">{product.brand}</span>
        <span className="text-gray-400">|</span>
        <span className="text-white">{launchName}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-300">{product.category}</span>
        <span className="text-gray-400">|</span>
        <span className="text-blue-400">{product.language}</span>
      </div>
    )
  }

  const getProductLabel = (product) => {
    const launchName = extractLaunchName(product.name, product.category)
    return `${product.brand} | ${launchName} | ${product.category} | ${product.language}`
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <PackagePlus className="text-teal-400" />
          Manual Inventory
        </h1>
        <p className="text-gray-400 mt-1">Add inventory directly without purchase record</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Add inventory directly to a location:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select the <span className="text-vault-gold">location</span></li>
            <li>Search and select the <span className="text-vault-gold">product</span></li>
            <li>Enter <span className="text-vault-gold">quantity</span></li>
            <li>Optionally enter <span className="text-vault-gold">avg purchase price</span></li>
            <li>Click <span className="text-vault-gold">Add to Inventory</span></li>
          </ol>
          <p className="text-teal-400 text-xs mt-3">💡 Use this for initial inventory setup or corrections</p>
        </div>
      </Instructions>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            mode === 'single' ? 'bg-vault-gold text-vault-dark' : 'bg-vault-surface text-gray-400 hover:text-white'
          }`}
        >
          Single Item
        </button>
        <button
          type="button"
          onClick={() => setMode('bulk')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            mode === 'bulk' ? 'bg-vault-gold text-vault-dark' : 'bg-vault-surface text-gray-400 hover:text-white'
          }`}
        >
          Bulk Add
        </button>
      </div>

      {mode === 'single' ? (
        <form onSubmit={handleSubmit} className="card max-w-2xl">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Location *</label>
            <select name="location_id" value={form.location_id} onChange={handleChange} required>
              <option value="">Select location...</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>

          <div className="pt-4 border-t border-vault-border">
            <h3 className="font-display text-lg font-semibold text-white mb-4">Product Selection</h3>
            
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Brand</label>
                <select name="brand" value={productFilters.brand} onChange={handleFilterChange}>
                  <option value="">All Brands</option>
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
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Language</label>
                <select name="language" value={productFilters.language} onChange={handleFilterChange}>
                  <option value="">All</option>
                  <option value="EN">EN</option>
                  <option value="JP">JP</option>
                  <option value="CN">CN</option>
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Product *</label>
              <p className="text-xs text-gray-500 mb-2">Format: Brand | Launch Name | Product Type | Language</p>
              <SearchableSelect
                options={filteredProducts}
                value={form.product_id}
                onChange={(val) => setForm(f => ({ ...f, product_id: val }))}
                placeholder="Type to search products..."
                getOptionValue={(p) => p.id}
                getOptionLabel={getProductLabel}
                renderOption={formatProductOption}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Quantity *</label>
              <input
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                min="1"
                placeholder="Enter quantity"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Avg Purchase Price</label>
              <input
                type="number"
                name="avg_cost_basis"
                value={form.avg_cost_basis}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="mt-6">
            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Add Inventory</>}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleBulkSubmit}>
          <div className="card mb-4">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Location (applies to all) *</label>
              <select value={bulkLocation} onChange={(e) => setBulkLocation(e.target.value)} required>
                <option value="">Select location...</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>

            <p className="text-xs text-gray-500 mb-3">Product format: Brand | Launch Name | Product Type | Language</p>

            <div className="space-y-3">
              {bulkItems.map((item, index) => (
                <div key={item.id} className="p-4 bg-vault-dark rounded-lg border border-vault-border">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-vault-gold font-semibold text-sm">Item {index + 1}</span>
                    {bulkItems.length > 1 && (
                      <button type="button" onClick={() => removeBulkItem(item.id)} className="p-1 text-gray-500 hover:text-red-400">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-400 mb-1">Product *</label>
                      <SearchableSelect
                        options={products}
                        value={item.product_id}
                        onChange={(val) => updateBulkItem(item.id, 'product_id', val)}
                        placeholder="Search..."
                        getOptionValue={(p) => p.id}
                        getOptionLabel={getProductLabel}
                        renderOption={formatProductOption}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Qty *</label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateBulkItem(item.id, 'quantity', e.target.value)}
                        min="1"
                        className="w-full text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Avg Cost</label>
                      <input
                        type="number"
                        value={item.avg_cost_basis}
                        onChange={(e) => updateBulkItem(item.id, 'avg_cost_basis', e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="Optional"
                        className="w-full text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addBulkItem}
              className="w-full mt-4 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors"
            >
              <Plus size={16} className="inline mr-2" /> Add Another Item
            </button>
          </div>

          <div className="card">
            <button 
              type="submit" 
              className="btn btn-primary w-full"
              disabled={submitting || bulkItems.filter(i => i.product_id).length === 0}
            >
              {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Add {bulkItems.filter(i => i.product_id).length} Item(s)</>}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
