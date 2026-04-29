import React, { useState } from 'react'
import { createProduct } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Plus, Save, Trash2 } from 'lucide-react'

// Product Type options matching sheet nomenclature
const PRODUCT_TYPES = [
  'Booster Box',
  'Booster Pack',
  'ETB',
  'Booster Bundle',
  'Build & Battle',
  'Tin',
  'UPC',
  'Premium Collection',
  'Ultra-Premium Collection',
  'Collection Box',
  'Figure Collection',
  'Collector Chest',
  'Starter Deck',
  'Deck',
  'Packs Set',
  'Bundle Box',
  'Blister Pack',
  'Special Box',
  'Special',
  'Collection',
  'Other'
]

// Get currency based on language
const getCurrency = (language) => {
  switch(language) {
    case 'JP': return 'YEN'
    case 'CN': return 'RMB'
    default: return 'USD'
  }
}

export default function AddProduct() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('single')

  // Form matches sheet: Brand, Launch Name, Product Type, Sealed/Unsealed, Language, Breakable, # of Packs
  const [form, setForm] = useState({
    brand: 'Pokemon',
    launch_name: '',
    product_type: 'Booster Box',
    sealed_unsealed: 'Sealed',  // Sealed or Pack
    language: 'EN',
    breakable: true,
    packs_per_box: ''
  })

  // Bulk products
  const [bulkProducts, setBulkProducts] = useState([
    { id: 1, brand: 'Pokemon', launch_name: '', product_type: 'Booster Box', sealed_unsealed: 'Sealed', language: 'EN', breakable: true, packs_per_box: '' }
  ])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(f => ({ 
      ...f, 
      [name]: type === 'checkbox' ? checked : value 
    }))
  }

  // Auto-set sealed/unsealed based on product type
  const handleProductTypeChange = (e) => {
    const productType = e.target.value
    const isUnsealed = productType === 'Booster Pack'
    setForm(f => ({ 
      ...f, 
      product_type: productType,
      sealed_unsealed: isUnsealed ? 'Pack' : 'Sealed',
      breakable: !isUnsealed // Packs aren't breakable
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.launch_name.trim()) {
      addToast('Please enter a Launch Name', 'error')
      return
    }

    if (form.breakable && !form.packs_per_box) {
      addToast('Please enter # of Packs for breakable products', 'error')
      return
    }

    setSubmitting(true)

    try {
      // Build full product name: "Launch Name Product Type"
      const fullName = `${form.launch_name.trim()} ${form.product_type}`
      
      await createProduct({
        brand: form.brand,
        type: form.sealed_unsealed,  // "Sealed" or "Pack"
        category: form.product_type,  // "Booster Box", "ETB", etc.
        name: fullName,
        language: form.language,
        breakable: form.breakable,
        packs_per_box: form.breakable && form.packs_per_box ? parseInt(form.packs_per_box) : null
      })

      addToast(`Added: ${form.brand} | ${form.launch_name} ${form.product_type} (${form.language})`)
      
      setForm(f => ({
        ...f,
        launch_name: '',
        packs_per_box: ''
      }))
    } catch (error) {
      console.error('Error adding product:', error)
      if (error.message?.includes('duplicate')) {
        addToast('This product already exists', 'error')
      } else {
        addToast('Failed to add product', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Bulk handlers
  const addBulkProduct = () => {
    const last = bulkProducts[bulkProducts.length - 1]
    const newId = Math.max(...bulkProducts.map(p => p.id), 0) + 1
    setBulkProducts([...bulkProducts, {
      id: newId,
      brand: last?.brand || 'Pokemon',
      launch_name: '',
      product_type: last?.product_type || 'Booster Box',
      sealed_unsealed: last?.sealed_unsealed || 'Sealed',
      language: last?.language || 'EN',
      breakable: last?.breakable ?? true,
      packs_per_box: last?.packs_per_box || ''
    }])
  }

  const removeBulkProduct = (id) => {
    if (bulkProducts.length <= 1) {
      addToast('Must have at least one product', 'error')
      return
    }
    setBulkProducts(bulkProducts.filter(p => p.id !== id))
  }

  const updateBulkProduct = (id, field, value) => {
    setBulkProducts(bulkProducts.map(p => {
      if (p.id !== id) return p
      
      // Auto-set sealed/unsealed when product type changes
      if (field === 'product_type') {
        const isUnsealed = value === 'Booster Pack'
        return { 
          ...p, 
          product_type: value,
          sealed_unsealed: isUnsealed ? 'Pack' : 'Sealed',
          breakable: !isUnsealed
        }
      }
      
      return { ...p, [field]: value }
    }))
  }

  const handleBulkSubmit = async (e) => {
    e.preventDefault()
    
    const validProducts = bulkProducts.filter(p => p.launch_name.trim())
    if (validProducts.length === 0) {
      addToast('Please enter at least one Launch Name', 'error')
      return
    }

    const invalidBreakable = validProducts.find(p => p.breakable && !p.packs_per_box)
    if (invalidBreakable) {
      addToast('Please enter # of Packs for all breakable products', 'error')
      return
    }

    setSubmitting(true)
    let successCount = 0
    let failCount = 0

    for (const product of validProducts) {
      try {
        const fullName = `${product.launch_name.trim()} ${product.product_type}`
        
        await createProduct({
          brand: product.brand,
          type: product.sealed_unsealed,
          category: product.product_type,
          name: fullName,
          language: product.language,
          breakable: product.breakable,
          packs_per_box: product.breakable && product.packs_per_box ? parseInt(product.packs_per_box) : null
        })
        successCount++
      } catch (err) {
        console.error('Error adding product:', err)
        failCount++
      }
    }

    if (successCount > 0) {
      addToast(`${successCount} product(s) added!${failCount > 0 ? ` ${failCount} failed.` : ''}`)
      setBulkProducts(bulkProducts.map(p => ({ ...p, launch_name: '' })))
    } else {
      addToast('Failed to add products', 'error')
    }

    setSubmitting(false)
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Plus className="text-emerald-400" />
          Add New Product
        </h1>
        <p className="text-gray-400 mt-1">Add sealed products following the standard nomenclature</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Add a new product to the system:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select <span className="text-vault-gold">Brand</span> (Pokemon, One Piece)</li>
            <li>Select <span className="text-vault-gold">Language</span> (EN, JP, CN)</li>
            <li>Enter <span className="text-vault-gold">Launch Name</span> (e.g., "Prismatic Evolutions")</li>
            <li>Select <span className="text-vault-gold">Product Type</span> (Booster Box, ETB, etc.)</li>
            <li>If breakable, check the box and enter <span className="text-vault-gold"># of packs</span></li>
            <li>Click <span className="text-vault-gold">Add Product</span></li>
          </ol>
          <p className="text-emerald-400 text-xs mt-3">💡 Use "Bulk Add" mode to add multiple products at once</p>
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
          Single Product
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
          {/* Row 1: Brand + Language */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Brand *</label>
              <select name="brand" value={form.brand} onChange={handleChange} required>
                <option value="Pokemon">Pokemon</option>
                <option value="One Piece">One Piece</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Language *</label>
              <select name="language" value={form.language} onChange={handleChange} required>
                <option value="EN">EN (English)</option>
                <option value="JP">JP (Japanese)</option>
                <option value="CN">CN (Chinese)</option>
              </select>
            </div>
          </div>

          {/* Row 2: Launch Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Launch Name *</label>
            <input
              type="text"
              name="launch_name"
              value={form.launch_name}
              onChange={handleChange}
              placeholder="e.g., Prismatic Evolutions, Journey Together, OP-13"
              required
            />
            <p className="text-xs text-gray-500 mt-1">The set/release name (without product type)</p>
          </div>

          {/* Row 3: Product Type + Sealed/Unsealed */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Product Type *</label>
              <select name="product_type" value={form.product_type} onChange={handleProductTypeChange} required>
                {PRODUCT_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Sealed/Unsealed</label>
              <input
                type="text"
                value={form.sealed_unsealed}
                disabled
                className="bg-vault-dark/50 text-gray-400"
              />
              <p className="text-xs text-gray-500 mt-1">Auto-set based on Product Type</p>
            </div>
          </div>

          {/* Row 4: Breakable + # of Packs */}
          <div className="p-4 bg-vault-dark rounded-lg border border-vault-border mb-4">
            <div className="flex items-center gap-3 mb-3">
              <input
                type="checkbox"
                id="breakable"
                name="breakable"
                checked={form.breakable}
                onChange={handleChange}
                className="w-5 h-5"
                disabled={form.sealed_unsealed === 'Pack'}
              />
              <label htmlFor="breakable" className="text-sm text-gray-300">
                Breakable (can be opened into packs)
              </label>
            </div>
            
            {form.breakable && form.sealed_unsealed !== 'Pack' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2"># of Packs *</label>
                <input
                  type="number"
                  name="packs_per_box"
                  value={form.packs_per_box}
                  onChange={handleChange}
                  min="1"
                  placeholder="e.g., 36 for EN boxes, 30 for JP boxes"
                  required={form.breakable}
                  className="max-w-xs"
                />
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="p-4 bg-vault-dark rounded-lg border border-vault-border mb-6">
            <p className="text-gray-400 text-sm mb-2">Preview:</p>
            <div className="grid grid-cols-4 gap-2 text-xs text-gray-500 mb-1">
              <span>BRAND</span>
              <span className="col-span-2">LAUNCH NAME + PRODUCT TYPE</span>
              <span>LANG</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <span className="text-vault-gold">{form.brand}</span>
              <span className="col-span-2 text-white">{form.launch_name || '[Launch Name]'} {form.product_type}</span>
              <span className="text-blue-400">{form.language}</span>
            </div>
            {form.breakable && form.packs_per_box && (
              <p className="text-green-400 text-sm mt-2">• Breakable: {form.packs_per_box} packs</p>
            )}
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Add Product</>}
          </button>
        </form>
      ) : (
        /* Bulk Add Form */
        <form onSubmit={handleBulkSubmit}>
          <div className="card mb-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display text-lg font-semibold text-white">Bulk Add Products</h2>
              <button type="button" onClick={addBulkProduct} className="btn btn-secondary text-sm">
                <Plus size={16} /> Add Row
              </button>
            </div>

            {/* Header row showing nomenclature */}
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 mb-2 px-4">
              <span>BRAND</span>
              <span>LANG</span>
              <span className="col-span-3">LAUNCH NAME</span>
              <span className="col-span-2">PRODUCT TYPE</span>
              <span>SEALED</span>
              <span>BREAKABLE</span>
              <span># PACKS</span>
              <span></span>
            </div>

            <div className="space-y-3">
              {bulkProducts.map((product, index) => (
                <div key={product.id} className="p-3 bg-vault-dark rounded-lg border border-vault-border">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={product.brand}
                      onChange={(e) => updateBulkProduct(product.id, 'brand', e.target.value)}
                      className="text-sm"
                    >
                      <option value="Pokemon">Pokemon</option>
                      <option value="One Piece">One Piece</option>
                      <option value="Other">Other</option>
                    </select>
                    
                    <select
                      value={product.language}
                      onChange={(e) => updateBulkProduct(product.id, 'language', e.target.value)}
                      className="text-sm"
                    >
                      <option value="EN">EN</option>
                      <option value="JP">JP</option>
                      <option value="CN">CN</option>
                    </select>
                    
                    <input
                      type="text"
                      value={product.launch_name}
                      onChange={(e) => updateBulkProduct(product.id, 'launch_name', e.target.value)}
                      placeholder="Launch Name"
                      className="col-span-3 text-sm"
                    />
                    
                    <select
                      value={product.product_type}
                      onChange={(e) => updateBulkProduct(product.id, 'product_type', e.target.value)}
                      className="col-span-2 text-sm"
                    >
                      {PRODUCT_TYPES.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    
                    <span className="text-gray-400 text-sm text-center">{product.sealed_unsealed}</span>
                    
                    <div className="text-center">
                      <input
                        type="checkbox"
                        checked={product.breakable}
                        onChange={(e) => updateBulkProduct(product.id, 'breakable', e.target.checked)}
                        className="w-4 h-4"
                        disabled={product.sealed_unsealed === 'Pack'}
                      />
                    </div>
                    
                    <input
                      type="number"
                      value={product.packs_per_box}
                      onChange={(e) => updateBulkProduct(product.id, 'packs_per_box', e.target.value)}
                      placeholder="#"
                      className="text-sm"
                      disabled={!product.breakable || product.sealed_unsealed === 'Pack'}
                      min="1"
                    />
                    
                    <button
                      type="button"
                      onClick={() => removeBulkProduct(product.id)}
                      className="p-1 text-gray-500 hover:text-red-400 justify-self-center"
                      disabled={bulkProducts.length <= 1}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addBulkProduct}
              className="w-full mt-4 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors"
            >
              <Plus size={16} className="inline mr-2" /> Add Another Product
            </button>
          </div>

          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <span className="text-gray-400">
                Products to add: <span className="text-white font-semibold">{bulkProducts.filter(p => p.launch_name.trim()).length}</span>
              </span>
            </div>
            <button 
              type="submit" 
              className="btn btn-primary w-full"
              disabled={submitting || bulkProducts.filter(p => p.launch_name.trim()).length === 0}
            >
              {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Add {bulkProducts.filter(p => p.launch_name.trim()).length} Product(s)</>}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
