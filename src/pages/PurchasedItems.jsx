import React, { useState, useEffect } from 'react'
import { 
  fetchProducts, fetchUsers, fetchVendors, fetchPaymentMethods,
  createAcquisition, createVendor, createPaymentMethod, convertToUSD, getExchangeRates
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import { ShoppingCart, Plus, Save, X, Trash2, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function PurchasedItems() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [products, setProducts] = useState([])
  const [users, setUsers] = useState([])
  const [vendors, setVendors] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorCountry, setNewVendorCountry] = useState('USA')
  const [showNewPayment, setShowNewPayment] = useState(false)
  const [newPaymentName, setNewPaymentName] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)

  const [header, setHeader] = useState({
    date_purchased: new Date().toISOString().split('T')[0],
    acquirer_id: '',
    source_country: 'USA',
    vendor_id: '',
    payment_method_id: '',
    currency: 'USD'
  })

  const [lineItems, setLineItems] = useState([
    { id: 1, product_id: '', quantity: 1, cost: '', notes: '' }
  ])

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
      const [productsData, usersData, vendorsData, paymentMethodsData] = await Promise.all([
        fetchProducts(), fetchUsers(), fetchVendors(), fetchPaymentMethods()
      ])
      // Filter to sealed products only
      const sealedProducts = productsData.filter(p => p.type === 'Sealed' || p.type === 'Pack')
      setProducts(sealedProducts)
      setUsers(usersData)
      setVendors(vendorsData)
      setPaymentMethods(paymentMethodsData)
      await getExchangeRates()
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleHeaderChange = (e) => {
    const { name, value } = e.target
    setHeader(h => ({ ...h, [name]: value }))
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setProductFilters(f => ({ ...f, [name]: value }))
  }

  const filteredProducts = products.filter(p => {
    if (productFilters.brand && p.brand !== productFilters.brand) return false
    if (productFilters.type && p.type !== productFilters.type) return false
    if (productFilters.language && p.language !== productFilters.language) return false
    return true
  })

  const addLineItem = () => {
    const newId = Math.max(...lineItems.map(i => i.id), 0) + 1
    setLineItems([...lineItems, { id: newId, product_id: '', quantity: 1, cost: '', notes: '' }])
  }

  const removeLineItem = (id) => {
    if (lineItems.length <= 1) return
    setLineItems(lineItems.filter(i => i.id !== id))
  }

  const updateLineItem = (id, field, value) => {
    setLineItems(lineItems.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ))
  }

  const handleAddVendor = async () => {
    if (!newVendorName.trim()) return
    try {
      const vendor = await createVendor({ name: newVendorName.trim(), country: newVendorCountry || null })
      setVendors([...vendors, vendor])
      setHeader(h => ({ ...h, vendor_id: vendor.id }))
      setShowNewVendor(false)
      setNewVendorName('')
      addToast('Vendor added')
    } catch (error) {
      addToast('Failed to add vendor', 'error')
    }
  }

  const handleAddPaymentMethod = async () => {
    if (!newPaymentName.trim()) return
    try {
      const pm = await createPaymentMethod({ name: newPaymentName.trim() })
      setPaymentMethods([...paymentMethods, pm])
      setHeader(h => ({ ...h, payment_method_id: pm.id }))
      setShowNewPayment(false)
      setNewPaymentName('')
      addToast('Payment method added')
    } catch (error) {
      addToast('Failed to add payment method', 'error')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!header.acquirer_id) {
      addToast('Please select an acquirer', 'error')
      return
    }

    const validItems = lineItems.filter(item => item.product_id && item.cost)
    if (validItems.length === 0) {
      addToast('Please add at least one product with cost', 'error')
      return
    }

    setSubmitting(true)

    try {
      for (const item of validItems) {
        const costUSD = convertToUSD(parseFloat(item.cost), header.currency)
        
        await createAcquisition({
          date_purchased: header.date_purchased,
          acquirer_id: header.acquirer_id,
          source_country: header.source_country,
          vendor_id: header.vendor_id || null,
          payment_method_id: header.payment_method_id || null,
          product_id: item.product_id,
          quantity_purchased: parseInt(item.quantity),
          cost: parseFloat(item.cost),
          currency: header.currency,
          cost_usd: costUSD,
          status: 'Purchased',
          notes: item.notes || null
        })
      }

      addToast(`${validItems.length} purchase(s) logged! Go to "Intake to Master" to receive.`)
      setLineItems([{ id: 1, product_id: '', quantity: 1, cost: '', notes: '' }])
    } catch (error) {
      console.error('Error creating acquisition:', error)
      addToast('Failed to log purchase', 'error')
    } finally {
      setSubmitting(false)
    }
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

  const totalCost = lineItems.reduce((sum, item) => sum + (parseFloat(item.cost) || 0), 0)
  const totalItems = lineItems.filter(i => i.product_id).length

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShoppingCart className="text-blue-400" />
          Purchased Items
        </h1>
        <p className="text-gray-400 mt-1">Log new inventory purchases</p>
      </div>

      <div className="mb-4">
        <button
          onClick={() => setShowInstructions(!showInstructions)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-vault-surface border border-vault-border rounded-lg text-gray-300 hover:text-vault-gold hover:border-vault-gold transition-colors"
        >
          <HelpCircle size={16} />
          <span>Instructions</span>
          {showInstructions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        
        {showInstructions && (
          <div className="mt-3 p-4 bg-vault-dark border border-vault-border rounded-lg text-sm relative">
            <button 
              onClick={() => setShowInstructions(false)}
              className="absolute top-2 right-2 text-gray-500 hover:text-white"
            >
              <X size={16} />
            </button>
            <div className="space-y-3 text-gray-300">
              <p className="font-medium text-white">When you buy inventory from a vendor:</p>
              <ol className="list-decimal list-inside space-y-2 ml-2">
                <li>Enter <span className="text-vault-gold">purchase date</span></li>
                <li>Select <span className="text-vault-gold">acquirer</span> (who bought it)</li>
                <li>Select or add <span className="text-vault-gold">vendor</span></li>
                <li>Select <span className="text-vault-gold">payment method</span></li>
                <li>Select <span className="text-vault-gold">currency</span> (USD, YEN, RMB)</li>
                <li>Add products with <span className="text-vault-gold">quantity and cost</span></li>
                <li>Click <span className="text-vault-gold">Log Purchase</span></li>
              </ol>
              <p className="text-blue-400 text-xs mt-3">💡 Items will appear in "Intake to Master" for receiving into inventory</p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Header Section */}
        <div className="card mb-6">
          <h2 className="font-display text-lg font-semibold text-white mb-4">Purchase Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
              <input type="date" name="date_purchased" value={header.date_purchased} onChange={handleHeaderChange} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Acquirer *</label>
              <select name="acquirer_id" value={header.acquirer_id} onChange={handleHeaderChange} required>
                <option value="">Select...</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Source Country *</label>
              <select name="source_country" value={header.source_country} onChange={handleHeaderChange} required>
                <option value="USA">USA</option>
                <option value="Japan">Japan</option>
                <option value="China">China</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Vendor</label>
              {showNewVendor ? (
                <div className="flex gap-2">
                  <input type="text" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="Vendor name" className="flex-1" />
                  <button type="button" onClick={handleAddVendor} className="btn btn-primary p-2"><Save size={18} /></button>
                  <button type="button" onClick={() => setShowNewVendor(false)} className="btn btn-secondary p-2"><X size={18} /></button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select name="vendor_id" value={header.vendor_id} onChange={handleHeaderChange} className="flex-1">
                    <option value="">Select...</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewVendor(true)} className="btn btn-secondary p-2"><Plus size={18} /></button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Payment Method</label>
              {showNewPayment ? (
                <div className="flex gap-2">
                  <input type="text" value={newPaymentName} onChange={(e) => setNewPaymentName(e.target.value)} placeholder="Payment method name" className="flex-1" />
                  <button type="button" onClick={handleAddPaymentMethod} className="btn btn-primary p-2"><Save size={18} /></button>
                  <button type="button" onClick={() => setShowNewPayment(false)} className="btn btn-secondary p-2"><X size={18} /></button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select name="payment_method_id" value={header.payment_method_id} onChange={handleHeaderChange} className="flex-1">
                    <option value="">Select...</option>
                    {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewPayment(true)} className="btn btn-secondary p-2"><Plus size={18} /></button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Currency *</label>
              <select name="currency" value={header.currency} onChange={handleHeaderChange} required>
                <option value="USD">USD ($)</option>
                <option value="JPY">YEN (¥)</option>
                <option value="RMB">RMB (¥)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Products */}
        <div className="card mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-display text-lg font-semibold text-white">Products</h2>
            <button type="button" onClick={addLineItem} className="btn btn-secondary text-sm">
              <Plus size={16} /> Add Item
            </button>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-3 gap-4 mb-4">
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

          <p className="text-xs text-gray-500 mb-3">Product format: Brand | Launch Name | Product Type | Language</p>

          {/* Line Items */}
          <div className="space-y-3">
            {lineItems.map((item, index) => (
              <div key={item.id} className="p-4 bg-vault-dark rounded-lg border border-vault-border">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-vault-gold font-semibold text-sm">Item {index + 1}</span>
                  {lineItems.length > 1 && (
                    <button type="button" onClick={() => removeLineItem(item.id)} className="ml-auto p-1 text-gray-500 hover:text-red-400">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-400 mb-1">Product *</label>
                    <SearchableSelect
                      options={filteredProducts}
                      value={item.product_id}
                      onChange={(val) => updateLineItem(item.id, 'product_id', val)}
                      placeholder="Search..."
                      getOptionValue={(p) => p.id}
                      getOptionLabel={getProductLabel}
                      renderOption={formatProductOption}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Qty *</label>
                    <input type="number" value={item.quantity} onChange={(e) => updateLineItem(item.id, 'quantity', e.target.value)} min="1" className="w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Cost ({header.currency}) *</label>
                    <input type="number" value={item.cost} onChange={(e) => updateLineItem(item.id, 'cost', e.target.value)} min="0" step="0.01" className="w-full text-sm" />
                  </div>
                </div>
                
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
                  <input type="text" value={item.notes} onChange={(e) => updateLineItem(item.id, 'notes', e.target.value)} placeholder="Optional" className="w-full text-sm" />
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addLineItem} className="w-full mt-3 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors">
            <Plus size={16} className="inline mr-2" /> Add Another Item
          </button>
        </div>

        {/* Summary */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <div>
              <span className="text-gray-400">Items:</span>
              <span className="text-white font-semibold ml-2">{totalItems}</span>
            </div>
            <div>
              <span className="text-gray-400">Total:</span>
              <span className="text-vault-gold font-semibold ml-2">
                {header.currency === 'USD' ? '$' : '¥'}{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={submitting || totalItems === 0}>
            {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Log {totalItems} Purchase(s)</>}
          </button>
        </div>
      </form>
    </div>
  )
}
