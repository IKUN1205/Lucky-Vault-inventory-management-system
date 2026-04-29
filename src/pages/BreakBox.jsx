import React, { useState, useEffect } from 'react'
import { fetchProducts, fetchLocations, fetchInventory, createBoxBreak, updateInventory } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import Instructions from '../components/Instructions'
import { Box, ArrowDown, Save, AlertCircle, Package } from 'lucide-react'

// Helper to extract Launch Name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function BreakBox() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [products, setProducts] = useState([])
  const [masterLocation, setMasterLocation] = useState(null)
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    sealed_product_id: '',
    boxes_broken: 1,
    override_pack_count: false,
    manual_pack_count: '',
    notes: ''
  })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [productsData, locData] = await Promise.all([
        fetchProducts(),
        fetchLocations('Physical')
      ])
      setProducts(productsData)
      
      const master = locData.find(l => l.name === 'Master Inventory')
      if (master) {
        setMasterLocation(master)
        const invData = await fetchInventory(master.id)
        const breakableInv = invData.filter(inv => inv.product?.breakable && inv.quantity > 0)
        setInventory(breakableInv)
      } else {
        addToast('Master Inventory location not found', 'error')
      }
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const selectedProduct = products.find(p => p.id === form.sealed_product_id)
  const selectedInventory = inventory.find(inv => inv.product_id === form.sealed_product_id)
  const maxBoxes = selectedInventory?.quantity || 0
  
  const defaultPackCount = selectedProduct?.packs_per_box || 0
  const actualPackCount = form.override_pack_count ? parseInt(form.manual_pack_count) || 0 : defaultPackCount
  const totalPacks = actualPackCount * parseInt(form.boxes_broken || 0)

  const findPackProduct = () => {
    if (!selectedProduct) return null
    const launchName = extractLaunchName(selectedProduct.name, selectedProduct.category)
    return products.find(p => 
      p.brand === selectedProduct.brand &&
      p.language === selectedProduct.language &&
      p.type === 'Pack' &&
      p.name.includes(launchName)
    )
  }

  const packProduct = findPackProduct()

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.sealed_product_id || !masterLocation) {
      addToast('Please select a product', 'error')
      return
    }

    if (parseInt(form.boxes_broken) > maxBoxes) {
      addToast(`Only ${maxBoxes} boxes available`, 'error')
      return
    }

    if (actualPackCount <= 0) {
      addToast('Pack count must be greater than 0', 'error')
      return
    }

    if (!packProduct) {
      addToast('No matching pack product found. Please create a pack product first.', 'error')
      return
    }

    setSubmitting(true)

    try {
      const boxesBroken = parseInt(form.boxes_broken)
      
      await createBoxBreak({
        date: form.date,
        sealed_product_id: form.sealed_product_id,
        pack_product_id: packProduct.id,
        boxes_broken: boxesBroken,
        packs_created: totalPacks,
        location_id: masterLocation.id,
        notes: form.notes
      })

      await updateInventory(form.sealed_product_id, masterLocation.id, -boxesBroken)

      const costPerPack = selectedInventory?.avg_cost_basis ? selectedInventory.avg_cost_basis / actualPackCount : null
      await updateInventory(packProduct.id, masterLocation.id, totalPacks, costPerPack)

      const launchName = extractLaunchName(selectedProduct.name, selectedProduct.category)
      addToast(`Broke ${boxesBroken} ${launchName} box(es) into ${totalPacks} packs!`)
      
      setForm(f => ({ ...f, sealed_product_id: '', boxes_broken: 1, override_pack_count: false, manual_pack_count: '', notes: '' }))
      
      const invData = await fetchInventory(masterLocation.id)
      const breakableInv = invData.filter(inv => inv.product?.breakable && inv.quantity > 0)
      setInventory(breakableInv)
    } catch (error) {
      console.error('Error breaking box:', error)
      addToast('Failed to break box', 'error')
    } finally {
      setSubmitting(false)
    }
  }

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
        <span className="text-purple-400">• {inv.product?.packs_per_box} packs</span>
        {inv.avg_cost_basis > 0 && (
          <span className="text-yellow-400">• ${inv.avg_cost_basis.toFixed(2)}/box</span>
        )}
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
          <Box className="text-amber-400" />
          Break Box
        </h1>
        <p className="text-gray-400 mt-1">Break sealed products into packs</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Open sealed boxes into individual packs:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select the <span className="text-vault-gold">sealed product</span> to break</li>
            <li>Enter <span className="text-vault-gold">number of boxes</span> to break</li>
            <li>Verify the <span className="text-vault-gold">pack count</span> is correct</li>
            <li>Click <span className="text-vault-gold">Break Box</span></li>
          </ol>
          <div className="mt-4 p-3 bg-vault-surface rounded border border-vault-border">
            <p className="font-medium text-white mb-2">Result:</p>
            <p>System removes <span className="text-red-400">-1 sealed box</span> and adds <span className="text-green-400">+X packs</span> to inventory</p>
            <p className="text-gray-400 text-xs mt-1">Cost per pack is auto-calculated from box cost</p>
          </div>
        </div>
      </Instructions>

      <form onSubmit={handleSubmit} className="card max-w-2xl">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
          <input type="date" name="date" value={form.date} onChange={handleChange} required />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Sealed Product * (breakable in Master)</label>
          <p className="text-xs text-gray-500 mb-2">Format: Brand | Launch Name | Product Type | Language</p>
          
          {inventory.length === 0 ? (
            <div className="p-4 bg-vault-dark rounded-lg border border-vault-border text-gray-400 text-sm">
              No breakable products in Master Inventory
            </div>
          ) : (
            <SearchableSelect
              options={inventory}
              value={form.sealed_product_id}
              onChange={(val) => setForm(f => ({ ...f, sealed_product_id: val, boxes_broken: 1 }))}
              placeholder="Search breakable products..."
              getOptionValue={(inv) => inv.product_id}
              getOptionLabel={getProductLabel}
              renderOption={formatProductOption}
            />
          )}
        </div>

        {form.sealed_product_id && (
          <>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Boxes to Break * (max: {maxBoxes})</label>
              <input type="number" name="boxes_broken" value={form.boxes_broken} onChange={handleChange} min="1" max={maxBoxes} required />
            </div>

            <div className="mt-4 p-4 bg-vault-dark rounded-lg border border-vault-border">
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="checkbox"
                  id="override_pack_count"
                  name="override_pack_count"
                  checked={form.override_pack_count}
                  onChange={handleChange}
                  className="w-5 h-5"
                />
                <label htmlFor="override_pack_count" className="text-sm text-gray-300">
                  Override pack count (default: {defaultPackCount} packs/box)
                </label>
              </div>
              
              {form.override_pack_count && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Manual Pack Count *</label>
                  <input
                    type="number"
                    name="manual_pack_count"
                    value={form.manual_pack_count}
                    onChange={handleChange}
                    min="1"
                    placeholder="Enter packs per box"
                    required={form.override_pack_count}
                  />
                </div>
              )}
            </div>

            <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <h4 className="text-blue-400 font-medium mb-2 flex items-center gap-2">
                <Package size={16} /> Break Summary
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Breaking:</span>
                  <span className="text-white ml-2">{form.boxes_broken} box(es)</span>
                </div>
                <div>
                  <span className="text-gray-400">Packs per box:</span>
                  <span className="text-white ml-2">{actualPackCount}</span>
                </div>
                <div>
                  <span className="text-gray-400">Total packs created:</span>
                  <span className="text-vault-gold font-semibold ml-2">{totalPacks}</span>
                </div>
                <div>
                  <span className="text-gray-400">Box cost:</span>
                  <span className="text-white ml-2">
                    ${selectedInventory?.avg_cost_basis?.toFixed(2) || '0.00'} each
                  </span>
                </div>
                {selectedInventory?.avg_cost_basis > 0 && actualPackCount > 0 && (
                  <div className="col-span-2 pt-2 border-t border-blue-500/30">
                    <span className="text-gray-400">Cost per pack:</span>
                    <span className="text-green-400 font-semibold ml-2">
                      ${(selectedInventory.avg_cost_basis / actualPackCount).toFixed(2)}
                    </span>
                    <span className="text-gray-500 ml-2">
                      (${selectedInventory.avg_cost_basis.toFixed(2)} ÷ {actualPackCount} packs)
                    </span>
                  </div>
                )}
              </div>
              
              {!packProduct && (
                <div className="mt-3 p-2 bg-red-500/20 rounded flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle size={16} />
                  No matching pack product found. Create one first in Add Product.
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
              <input type="text" name="notes" value={form.notes} onChange={handleChange} placeholder="Optional" />
            </div>
          </>
        )}

        <div className="mt-6">
          <button type="submit" className="btn btn-primary w-full" disabled={submitting || !form.sealed_product_id || !packProduct}>
            {submitting ? <div className="spinner w-5 h-5 border-2"></div> : (
              <>
                <Box size={20} />
                <ArrowDown size={16} className="mx-1" />
                Break {form.boxes_broken} Box(es) into {totalPacks} Packs
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
