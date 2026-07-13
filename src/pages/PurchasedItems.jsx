import React, { useState, useEffect } from 'react'
import {
  fetchProducts, fetchUsers, fetchVendors, fetchPaymentMethods,
  createAcquisition, deleteAcquisition, createVendor, createPaymentMethod, convertToUSD, getExchangeRates
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import BarcodeScanner from '../components/BarcodeScanner'
import ProductThumb from '../components/ProductThumb'
import { ShoppingCart, Plus, Save, X, Trash2, HelpCircle, ChevronDown, ChevronUp, ClipboardPaste, Sparkles, Loader2, AlertTriangle } from 'lucide-react'
import { parsePurchaseText } from '../lib/parsePurchaseText'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// Carrier options. Keep in sync with CARRIER_TRACKING_URLS in api/lark-notify.js
// so the Lark message can build the correct deep-link to the carrier site.
const CARRIER_OPTIONS = [
  'USPS',
  'UPS',
  'FedEx',
  'DHL',
  'Japan Post',
  'EMS',
  'Yamato',
  'SF Express',
  'China Post',
  'Other'
]

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
  // Paste-from-message: staff drop a vendor chat in, we parse it, they confirm.
  const [pasteOpen, setPasteOpen] = useState(false)
  // Zero-cost guard: when a submit is attempted with any product line at 0/blank
  // cost, holds the offending 1-based line numbers so the confirm modal can list
  // them. null = no pending confirmation.
  const [zeroCostConfirm, setZeroCostConfirm] = useState(null)

  const [header, setHeader] = useState({
    date_purchased: new Date().toLocaleDateString('en-CA'),
    acquirer_id: '',
    source_country: 'USA',
    vendor_id: '',
    payment_method_id: '',
    currency: 'USD',
    carrier: '',
    tracking_number: ''
  })

  // price_mode: 'unit' = the cost field holds the per-unit price (system
  // multiplies by qty on save); 'total' = it holds the whole-line total.
  // Default 'unit' because that's how vendors quote and how staff think —
  // it makes the common "typed unit price into total" mistake self-correct.
  const [lineItems, setLineItems] = useState([
    { id: 1, product_id: '', quantity: 1, cost: '', price_mode: 'unit', notes: '' }
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
    setLineItems([...lineItems, { id: newId, product_id: '', quantity: 1, cost: '', price_mode: 'unit', notes: '' }])
  }

  // Take a confirmed parse result (from PasteParseModal — already edited
  // by the staff member) and stamp it onto the form. We REPLACE lineItems
  // wholesale because the user explicitly clicked Apply from the paste
  // modal and shouldn't end up with a stray empty first row mixed in.
  // Header fields only update when the parse found something — never
  // clobber a value the staff already typed with null.
  //
  // HARD RULE (directive 2026-06-04): every parsed line MUST have a chosen
  // product. The modal's Apply button is already disabled when any line is
  // unresolved — but we double-check here so this can never silently drop
  // a line. If somehow a no-match line slipped through, we bail with a
  // toast and the modal stays open for the staff to fix it.
  const applyParsedPurchase = (parsed) => {
    const lines = parsed.lineItems || []
    if (lines.length === 0) {
      addToast('No line items in the parse — nothing to fill', 'error')
      return
    }
    const unresolved = lines.filter(li => !li.productMatch?.id)
    if (unresolved.length > 0) {
      addToast(
        `Pick a product for ${unresolved.length} unmatched line${unresolved.length === 1 ? '' : 's'} first (or remove them)`,
        'error'
      )
      return
    }

    if (parsed.tracking) {
      setHeader(h => ({
        ...h,
        tracking_number: parsed.tracking,
        // Default carrier to USPS for 22-digit; UPS for 18; FedEx for 12/14.
        carrier: h.carrier
          || (parsed.tracking.length === 22 ? 'USPS'
              : parsed.tracking.length === 18 ? 'UPS'
              : parsed.tracking.length === 12 || parsed.tracking.length === 14 ? 'FedEx'
              : h.carrier),
      }))
    }
    if (parsed.paymentMethod?.id) {
      setHeader(h => ({ ...h, payment_method_id: parsed.paymentMethod.id }))
    }
    if (parsed.vendor?.id) {
      setHeader(h => ({ ...h, vendor_id: parsed.vendor.id }))
    }
    setLineItems(lines.map((li, idx) => ({
      id: idx + 1,
      product_id: li.productMatch.id,
      quantity: li.qty || 1,
      // Carry the unit/total choice the staffer confirmed per line in the
      // paste modal straight through — `cost` already holds the number in
      // that mode. (Fixes the old bug where a per-unit price was always
      // stored as the whole-line total.)
      price_mode: li.price_mode || 'unit',
      cost: li.cost != null ? String(li.cost) : (li.total != null ? String(li.total) : ''),
      notes: '',
    })))
    addToast(
      `Filled ${lines.length} line${lines.length === 1 ? '' : 's'} from message`,
      'success'
    )
    setPasteOpen(false)
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

  const round2 = (n) => Math.round(n * 100) / 100

  // A line's total cost in the entered currency, regardless of entry mode.
  // This is the single source of truth for what gets saved and summed.
  const lineTotalOf = (item) => {
    const c = parseFloat(item.cost) || 0
    const q = parseInt(item.quantity) || 0
    return item.price_mode === 'unit' ? round2(c * q) : c
  }

  // Flip a line between per-unit and total entry. KEEP the number the
  // staffer typed and only change what it means — flipping is "I picked the
  // wrong kind of price," not "convert my number." The live readout under
  // the field shows the resulting total / per-unit so the effect is obvious.
  const setPriceMode = (id, mode) => {
    setLineItems(items => items.map(it =>
      it.id === id ? { ...it, price_mode: mode } : it
    ))
  }

  // Called by BarcodeScanner when a UPC matches a known SKU. Fills the
  // first line item that doesn't yet have a product picked; if every line
  // already has one, appends a new line pre-filled with this product. This
  // means "scan repeatedly" works for logging multi-SKU purchases without
  // clicking "+ Add Item" between each scan.
  const handleScannedProduct = (product) => {
    if (!product?.id) return
    const emptyIdx = lineItems.findIndex(i => !i.product_id)
    if (emptyIdx >= 0) {
      setLineItems(prev => prev.map((item, idx) =>
        idx === emptyIdx ? { ...item, product_id: product.id } : item
      ))
      addToast(`Filled Item ${emptyIdx + 1}: ${product.name}`, 'success')
    } else {
      const newId = Math.max(...lineItems.map(i => i.id), 0) + 1
      setLineItems(prev => [
        ...prev,
        { id: newId, product_id: product.id, quantity: 1, cost: '', price_mode: 'unit', notes: '' },
      ])
      addToast(`Added new item: ${product.name}`, 'success')
    }
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

  // A product line whose entered cost is blank or parses to 0 — it would save
  // at 0 cost (or be silently dropped), poisoning avg cost & pricing reports.
  // Currency-agnostic: 0 is 0 in USD/YEN/RMB.
  const isZeroCostLine = (item) => {
    const c = String(item.cost).trim()
    return c === '' || (parseFloat(c) || 0) === 0
  }

  // Final submit handler. The zero-cost guard runs BEFORE the existing submit
  // logic: if any product line is 0/blank cost, block and make the staffer
  // consciously confirm. "Submit with 0 anyway" re-enters submitPurchases()
  // so the actual submit path below stays completely UNCHANGED.
  const handleSubmit = (e) => {
    e.preventDefault()
    const zeroLines = lineItems
      .map((item, idx) => ({ item, num: idx + 1 }))
      .filter(({ item }) => item.product_id && isZeroCostLine(item))
      .map(({ num }) => num)
    if (zeroLines.length > 0) {
      setZeroCostConfirm(zeroLines)
      return
    }
    submitPurchases()
  }

  // itemsOverride: the zero-cost confirm passes a normalized copy (blank→'0')
  // directly, because setLineItems hasn't flushed yet when we submit — and a
  // blank cost is falsy, so the validItems filter below would silently DROP a
  // line the staffer just explicitly confirmed (Codex blocker 2026-07-13).
  const submitPurchases = async (itemsOverride) => {
    if (!header.acquirer_id) {
      addToast('Please select an acquirer', 'error')
      return
    }

    const validItems = (itemsOverride ?? lineItems).filter(item => item.product_id && item.cost)
    if (validItems.length === 0) {
      addToast('Please add at least one product with cost', 'error')
      return
    }

    setSubmitting(true)
    const createdIds = []
    // One batch_id per submission — every line item from this purchase order
    // shares it so the Intake to Master page can group them and show whether
    // the whole batch has arrived. crypto.randomUUID is available in all
    // modern browsers; fall back to a timestamp-random string just in case.
    const batchId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    // Track everything we'll need for the Lark notification + cost totals
    let totalCostOriginal = 0
    let totalCostUSD = 0
    let totalUnits = 0
    const larkItems = []

    try {
      for (const item of validItems) {
        // `cost`/`cost_usd` are stored as the LINE TOTAL (the buy reports
        // sum cost_usd as spend). In per-unit mode the staffer typed the
        // unit price, so multiply by qty here.
        const costNum = lineTotalOf(item)
        const costUSD = convertToUSD(costNum, header.currency)

        const acq = await createAcquisition({
          batch_id: batchId,
          date_purchased: header.date_purchased,
          acquirer_id: header.acquirer_id,
          source_country: header.source_country,
          vendor_id: header.vendor_id || null,
          payment_method_id: header.payment_method_id || null,
          product_id: item.product_id,
          quantity_purchased: parseInt(item.quantity),
          cost: costNum,
          currency: header.currency,
          cost_usd: costUSD,
          status: 'Purchased',
          notes: item.notes || null,
          // Tracking lives on each acquisition row (header-level concept duplicated
          // per row for query simplicity — the daily AfterShip cron just needs to
          // find rows with tracking_number IS NOT NULL).
          carrier: header.carrier || null,
          tracking_number: header.tracking_number?.trim() || null
        })
        if (acq?.id) createdIds.push(acq.id)

        // Build Lark payload pieces from the validated form data (not the DB
        // response) so we have product names already in memory.
        const product = products.find(p => p.id === item.product_id)
        const launchName = product ? extractLaunchName(product.name, product.category) : 'Unknown product'
        larkItems.push({
          name: product
            ? `${product.brand} | ${launchName} | ${product.category} | ${product.language}`
            : 'Unknown product',
          quantity: parseInt(item.quantity)
        })
        totalCostOriginal += costNum
        totalCostUSD += costUSD
        totalUnits += parseInt(item.quantity)
      }

      // Fire-and-forget Lark notification. Failures here must NOT roll back the
      // purchase, so we don't await and we eat any error.
      try {
        const acquirerUser = users.find(u => u.id === header.acquirer_id)
        const vendorObj = vendors.find(v => v.id === header.vendor_id)
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'purchased',
            acquirer: acquirerUser?.name || 'Unknown',
            vendor: vendorObj?.name || null,
            sourceCountry: header.source_country || null,
            currency: header.currency,
            totalCost: totalCostOriginal,
            totalCostUSD: totalCostUSD,
            items: larkItems,
            totalUnits,
            carrier: header.carrier || null,
            trackingNumber: header.tracking_number?.trim() || null
          })
        }).catch(err => console.error('[lark-notify] purchased request failed:', err))
      } catch (err) {
        console.error('[lark-notify] failed to build purchased payload:', err)
      }

      const undo = async () => {
        try {
          for (const id of createdIds) {
            await deleteAcquisition(id)
          }
          addToast(`Undone — ${createdIds.length} purchase${createdIds.length === 1 ? '' : 's'} removed`, 'info')
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }
      addToast(
        `${validItems.length} purchase(s) logged! Go to "Intake to Master" to receive.`,
        'success',
        createdIds.length > 0 ? { action: { label: 'Undo', onClick: undo } } : undefined
      )
      setLineItems([{ id: 1, product_id: '', quantity: 1, cost: '', price_mode: 'unit', notes: '' }])
      // Reset shipping fields so the next entry starts clean — date/acquirer/vendor
      // intentionally stay so users can log multiple shipments from the same trip.
      setHeader(h => ({ ...h, carrier: '', tracking_number: '' }))
    } catch (error) {
      console.error('Error creating acquisition:', error)
      // Best-effort rollback of partial inserts
      if (createdIds.length > 0) {
        try {
          for (const id of createdIds) await deleteAcquisition(id)
          addToast(`Save failed mid-way. Reverted ${createdIds.length} created purchase${createdIds.length === 1 ? '' : 's'}.`, 'error')
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr)
          addToast('Save AND rollback failed — check console', 'error')
        }
      } else {
        addToast('Failed to log purchase', 'error')
      }
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

  const totalCost = lineItems.reduce((sum, item) => sum + lineTotalOf(item), 0)
  const totalItems = lineItems.filter(i => i.product_id).length
  const cur = header.currency === 'USD' ? '$' : '¥'

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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowInstructions(!showInstructions)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-vault-surface border border-vault-border rounded-lg text-gray-300 hover:text-vault-gold hover:border-vault-gold transition-colors"
        >
          <HelpCircle size={16} />
          <span>Instructions</span>
          {showInstructions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          onClick={() => setPasteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-vault-gold/10 border border-vault-gold/40 rounded-lg text-vault-gold hover:bg-vault-gold/20 transition-colors"
          title="Paste a vendor message — we'll extract tracking, line items, and payment for you to confirm."
        >
          <ClipboardPaste size={16} />
          <span>Paste from message</span>
          <Sparkles size={14} />
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
                <li>Add products with <span className="text-vault-gold">quantity and cost</span> — pick <span className="text-vault-gold">Per unit</span> (auto ×qty) or <span className="text-vault-gold">Total</span></li>
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

          {/* Shipping info — optional. Filling these out posts a tracking link
              to the Lark group and (Phase 2) auto-pings when the package is
              about to arrive. */}
          <div className="mt-6 pt-4 border-t border-vault-border">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Shipping (optional)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Carrier</label>
                <select name="carrier" value={header.carrier} onChange={handleHeaderChange}>
                  <option value="">— None —</option>
                  {CARRIER_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Tracking Number</label>
                <input
                  type="text"
                  name="tracking_number"
                  value={header.tracking_number}
                  onChange={handleHeaderChange}
                  placeholder="Optional — paste from receipt / vendor email"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              💡 If you fill in tracking, the team gets a Lark notification with a one-click track link.
            </p>
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

          {/* Scan a UPC to autofill the next empty line item. Pool is all
              sealed/pack products (you may be buying anything). Unknown
              barcode → BarcodeScanner pops its associate-modal so you
              teach the system what SKU this code is — useful when logging
              a first-time purchase of a brand-new product. */}
          {products.length > 0 && (
            <div className="mb-4">
              <BarcodeScanner
                products={products}
                onMatched={handleScannedProduct}
                addToast={addToast}
                hint="Scan a sealed box. Matched SKU fills the next empty line below; new barcodes can be associated on the spot."
              />
            </div>
          )}

          {/* Line Items */}
          <div className="space-y-3">
            {lineItems.map((item, index) => (
              <div key={item.id} className="p-4 bg-vault-dark rounded-lg border border-vault-border">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-vault-gold font-semibold text-sm">Item {index + 1}</span>
                  {/* Thumbnail of the chosen product — appears only once a product
                      is picked (nothing on an empty line), so staff can eyeball
                      that the right box was selected. */}
                  {item.product_id && <ProductThumb productId={item.product_id} size={32} />}
                  {lineItems.length > 1 && (
                    <button type="button" onClick={() => removeLineItem(item.id)} className="ml-auto p-1 text-gray-500 hover:text-red-400">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-3">
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
                </div>

                {/* Cost — choose how you're entering it. "Per unit" multiplies
                    by qty on save (prevents the unit-price-as-total mistake);
                    "Total" stores the number as-is. The live line below
                    cross-checks the other value so either error is obvious. */}
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-gray-400">
                      {item.price_mode === 'unit' ? 'Cost per unit' : 'Total cost'} ({header.currency}) *
                    </label>
                    <div className="inline-flex rounded-md border border-vault-border overflow-hidden shrink-0">
                      {['unit', 'total'].map(m => (
                        <button key={m} type="button" onClick={() => setPriceMode(item.id, m)}
                          className={`px-2 py-0.5 text-[11px] transition ${item.price_mode === m ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}>
                          {m === 'unit' ? 'Per unit' : 'Total'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="number" value={item.cost}
                    onChange={(e) => updateLineItem(item.id, 'cost', e.target.value)}
                    min="0" step="0.01" className="w-full text-sm"
                    placeholder={item.price_mode === 'unit' ? 'Price for ONE unit' : 'Total for the whole line'}
                  />
                  {item.cost !== '' && !isNaN(parseFloat(item.cost)) && (parseInt(item.quantity) || 0) > 0 && (
                    <p className="text-[11px] mt-1 text-gray-500">
                      {item.price_mode === 'unit' ? (
                        <>= <span className="text-vault-gold font-medium">{cur}{lineTotalOf(item).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> total
                          <span className="text-gray-600"> ({item.quantity} × {cur}{parseFloat(item.cost).toLocaleString(undefined, { maximumFractionDigits: 2 })})</span></>
                      ) : (
                        <>= <span className="text-gray-300">{cur}{(parseFloat(item.cost) / (parseInt(item.quantity) || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> per unit</>
                      )}
                    </p>
                  )}
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

      {pasteOpen && (
        <PasteParseModal
          onClose={() => setPasteOpen(false)}
          onApply={applyParsedPurchase}
          products={products}
          paymentMethods={paymentMethods}
          vendors={vendors}
          getProductLabel={getProductLabel}
        />
      )}

      {zeroCostConfirm && (
        <ZeroCostConfirmModal
          lineNumbers={zeroCostConfirm}
          onCancel={() => setZeroCostConfirm(null)}
          onConfirm={() => {
            setZeroCostConfirm(null)
            // Blank costs were consciously confirmed as 0 — make them explicit
            // ('0' is truthy) so the submit filter keeps them, and pass the
            // normalized copy straight in (state flush is async).
            const normalized = lineItems.map(it =>
              it.product_id && isZeroCostLine(it) ? { ...it, cost: '0' } : it)
            setLineItems(normalized)
            submitPurchases(normalized)
          }}
        />
      )}
    </div>
  )
}

// ============================================================================
// PasteParseModal — paste vendor chat → confirm parse → apply to main form
// ============================================================================
// Two-stage flow keeps the heuristic parse out of the staff member's way:
//   1. Paste raw text + Parse → see what we found
//   2. Edit each line (qty / cost / which product) → Apply
//
// We do NOT auto-create vendors / payment methods here. If the parse found
// a payment keyword (e.g. "Zelle") but it isn't in payment_methods yet,
// we show the suggested label so the staffer knows what to add — but
// require them to handle the actual creation in the main form's "+ Add"
// flow. Reason: vendor/payment creation has side-effects (Lark, schemas)
// that should go through the normal review path.
function PasteParseModal({ onClose, onApply, products, paymentMethods, vendors, getProductLabel }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [parsing, setParsing] = useState(false)

  const runParse = () => {
    if (!text.trim()) return
    setParsing(true)
    // Synchronous, but a tiny tick lets the button show "Parsing…" so it
    // doesn't feel like the click did nothing on big pastes.
    setTimeout(() => {
      const result = parsePurchaseText(text, { products, paymentMethods, vendors })
      // Parser pulls a per-unit price out of the "unit × qty" pattern, so each
      // line starts in per-unit mode. But a message can genuinely quote a line
      // TOTAL — staff flip individual lines to Total after eyeballing the
      // original text (shown on each line). Can't be auto-detected reliably.
      result.lineItems = (result.lineItems || []).map(li => ({ ...li, price_mode: 'unit' }))
      setParsed(result)
      setParsing(false)
    }, 50)
  }

  const updateLine = (idx, patch) => {
    setParsed(p => ({
      ...p,
      lineItems: p.lineItems.map((li, i) => i === idx ? { ...li, ...patch } : li),
    }))
  }
  const removeLine = (idx) => {
    setParsed(p => ({ ...p, lineItems: p.lineItems.filter((_, i) => i !== idx) }))
  }

  const round2 = (n) => Math.round(n * 100) / 100
  // A parsed line's total in the entered currency, honoring its unit/total mode.
  const lineTotalOfParsed = (li) => {
    const c = Number(li.cost) || 0, q = Number(li.qty) || 0
    return (li.price_mode || 'unit') === 'unit' ? round2(c * q) : c
  }
  // Flip one parsed line unit↔total. KEEP the parsed number and only change
  // what it means — this is the whole point of the boss's note: the parser
  // grabbed a number that might actually be a line total, so flipping to
  // Total must leave the number alone (never multiply it by qty).
  const setLineMode = (idx, mode) => {
    setParsed(p => ({
      ...p,
      lineItems: p.lineItems.map((li, i) =>
        i === idx ? { ...li, price_mode: mode } : li
      ),
    }))
  }

  const productOptions = products.map(p => ({ value: p.id, label: getProductLabel(p) }))
  const lineCount = parsed?.lineItems?.length || 0
  const matchedCount = (parsed?.lineItems || []).filter(li => li.productMatch?.id).length
  const unmatchedCount = lineCount - matchedCount
  // Hard rule: every line must have a product chosen before Apply is allowed
  // (directive 2026-06-04 from boss). Empty parse list also blocks Apply.
  const canApply = lineCount > 0 && unmatchedCount === 0

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-3xl w-full p-5 shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <ClipboardPaste size={18} className="text-vault-gold" />
            <h3 className="font-semibold text-base text-white">Paste from message</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xs">close</button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Paste the vendor's chat / receipt. We'll pull out the tracking, line items, payment method, and vendor — you confirm before filling the form.
        </p>

        {!parsed ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              autoFocus
              placeholder={`Example:\n\n9489 1472 2842 6840 2627 67\n\n45 first partner boxes\n$49x45=$2,205.00\n\n29 30th anniversary boxes\n$31x29=$899.00\n\nZelle\n504-303-2659\nTien Nguyen`}
              className="w-full font-mono text-sm bg-vault-darker/40 border border-vault-border rounded-lg p-3 text-gray-200 placeholder:text-gray-600"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={onClose}
                className="text-xs px-3 py-1.5 text-gray-300 hover:text-white border border-vault-border rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runParse}
                disabled={parsing || !text.trim()}
                className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 font-semibold flex items-center gap-1"
              >
                {parsing ? <><Loader2 size={12} className="animate-spin" /> Parsing…</> : <><Sparkles size={12} /> Parse</>}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Header summary */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between text-sm bg-vault-darker/40 rounded-lg p-2">
                <span className="text-gray-400">Tracking</span>
                <span className={`font-mono text-xs ${parsed.tracking ? 'text-vault-gold' : 'text-gray-600'}`}>
                  {parsed.tracking || 'not found'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm bg-vault-darker/40 rounded-lg p-2">
                <span className="text-gray-400">Payment</span>
                <span className={`text-xs ${parsed.paymentMethod?.id ? 'text-vault-gold' : parsed.paymentMethod ? 'text-amber-300' : 'text-gray-600'}`}>
                  {parsed.paymentMethod
                    ? (parsed.paymentMethod.id ? parsed.paymentMethod.label : `${parsed.paymentMethod.label} (no saved method — add later)`)
                    : 'not found'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm bg-vault-darker/40 rounded-lg p-2">
                <span className="text-gray-400">Vendor</span>
                <span className={`text-xs ${parsed.vendor?.id ? 'text-vault-gold' : parsed.vendor ? 'text-amber-300' : 'text-gray-600'}`}>
                  {parsed.vendor
                    ? `${parsed.vendor.name || ''}${parsed.vendor.phone ? ` · ${parsed.vendor.phone}` : ''}${parsed.vendor.id ? '' : ' (new — add later)'}`
                    : 'not found'}
                </span>
              </div>
              {parsed.rawTotal != null && (
                <div className="flex items-center justify-between text-sm bg-vault-darker/40 rounded-lg p-2">
                  <span className="text-gray-400">Grand total in message</span>
                  <span className="text-vault-gold font-mono text-xs">${parsed.rawTotal.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Line items */}
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs uppercase tracking-wider text-gray-500">
                Line items — {matchedCount} of {lineCount} matched
              </h4>
              {unmatchedCount > 0 && (
                <span className="text-[10px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-0.5">
                  ⚠ {unmatchedCount} need a product
                </span>
              )}
            </div>
            {parsed.lineItems.length === 0 ? (
              <p className="text-xs text-gray-500 bg-vault-darker/40 rounded-lg p-3 text-center">
                No quantity-and-price lines found in the message.
              </p>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {parsed.lineItems.map((li, idx) => (
                  <div key={idx} className={`bg-vault-darker/40 border-2 rounded-lg p-3 ${
                    li.productMatch?.id ? 'border-vault-border' : 'border-red-500/60 ring-1 ring-red-500/20'
                  }`}>
                    <div className="text-xs text-gray-500 mb-2 truncate flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="text-gray-400">from message:</span> "{li.productName}"
                        {li.productMatch?.score != null && (
                          <span className="ml-2 text-gray-600">({Math.round(li.productMatch.score * 100)}% match)</span>
                        )}
                      </span>
                      {!li.productMatch?.id && (
                        <span className="text-[10px] text-red-300 whitespace-nowrap font-semibold">
                          ⚠ pick a product or remove
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-6">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Product</label>
                        <SearchableSelect
                          value={li.productMatch?.id || ''}
                          onChange={(value) => {
                            const prod = products.find(p => p.id === value)
                            updateLine(idx, {
                              productMatch: prod ? { id: prod.id, product: prod, score: 1 } : null,
                            })
                          }}
                          options={productOptions}
                          placeholder="Pick a product…"
                          getOptionValue={(opt) => opt.value}
                          getOptionLabel={(opt) => opt.label}
                        />
                        {/* Alternate candidates — surfaces when the parse
                            wasn't sure. One click swaps the SearchableSelect
                            to the chosen alternate so staff don't have to
                            scroll the whole catalog. */}
                        {li.productCandidates && li.productCandidates.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span className="text-[10px] text-gray-500 self-center">or:</span>
                            {li.productCandidates.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => updateLine(idx, {
                                  productMatch: { id: c.id, product: c.product, score: c.score },
                                })}
                                className="text-[10px] px-1.5 py-0.5 border border-vault-border rounded hover:border-vault-gold/50 hover:text-vault-gold text-gray-400 truncate max-w-[200px]"
                                title={getProductLabel(c.product)}
                              >
                                {c.product.brand} {extractLaunchName(c.product.name, c.product.category)} ({Math.round(c.score * 100)}%)
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Qty</label>
                        <input
                          type="number" min="1"
                          value={li.qty}
                          onChange={(e) => updateLine(idx, { qty: parseInt(e.target.value) || 0 })}
                          className="w-full text-sm py-1 px-2"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                          {(li.price_mode || 'unit') === 'unit' ? 'Cost / unit' : 'Line total'}
                        </label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
                          <input
                            type="number" min="0" step="0.01"
                            value={li.cost ?? ''}
                            onChange={(e) => updateLine(idx, { cost: e.target.value === '' ? null : Number(e.target.value) })}
                            className="w-full text-sm pl-5 py-1 text-right font-mono"
                          />
                        </div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="p-1.5 text-gray-400 hover:text-red-400"
                          title="Drop this line"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {/* Per-line entry mode + live cross-check. Default per-unit
                        (parser native), but flip to Total when the message
                        actually quoted a line total. */}
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <div className="inline-flex rounded border border-vault-border overflow-hidden shrink-0">
                        {['unit', 'total'].map(m => (
                          <button key={m} type="button" onClick={() => setLineMode(idx, m)}
                            className={`px-1.5 py-0.5 text-[10px] transition ${(li.price_mode || 'unit') === m ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}>
                            {m === 'unit' ? 'Per unit' : 'Total'}
                          </button>
                        ))}
                      </div>
                      {li.cost != null && li.qty > 0 && (
                        <div className="text-[11px] text-gray-500 text-right">
                          {(li.price_mode || 'unit') === 'unit'
                            ? <>= <span className="text-vault-gold">${lineTotalOfParsed(li).toFixed(2)}</span> total</>
                            : <>= ${(Number(li.cost) / (Number(li.qty) || 1)).toFixed(2)} / unit</>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center gap-2 mt-4 pt-3 border-t border-vault-border/50">
              <button
                type="button"
                onClick={() => setParsed(null)}
                className="text-xs px-3 py-1.5 text-gray-300 hover:text-white"
              >
                ← Edit paste
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs px-3 py-1.5 text-gray-300 hover:text-white border border-vault-border rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onApply(parsed)}
                  disabled={!canApply}
                  title={canApply
                    ? `Apply ${matchedCount} line${matchedCount === 1 ? '' : 's'} to the purchase form`
                    : `Pick a product for ${unmatchedCount} unmatched line${unmatchedCount === 1 ? '' : 's'} first (or remove them)`}
                  className="text-xs px-3 py-1.5 bg-vault-gold/25 border border-vault-gold/50 text-vault-gold rounded hover:bg-vault-gold/35 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {canApply
                    ? `Apply to form (${matchedCount})`
                    : `Resolve ${unmatchedCount} unmatched line${unmatchedCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// ZeroCostConfirmModal — bilingual guard before logging a 0-cost purchase line
// ============================================================================
// JP staff kept submitting purchase lines at cost 0, which poisons avg cost and
// every downstream pricing report. This forces a conscious choice: go back and
// fix it (default), or explicitly submit at 0 anyway. All copy is 中文 / English.
// Minimal inline modal reusing the app's overlay+card dark-theme pattern (see
// PasteParseModal / DeleteCountModal) — no new dependency.
function ZeroCostConfirmModal({ lineNumbers, onCancel, onConfirm }) {
  // Escape closes (= Go back), same as clicking the overlay.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Zero cost confirmation"
        className="bg-vault-surface border border-amber-500/50 rounded-xl max-w-md w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-amber-300 mb-3">
          <AlertTriangle size={18} />
          <h3 className="font-semibold text-base">成本为 0 / Zero cost</h3>
        </div>

        <div className="space-y-1 mb-3">
          {lineNumbers.map(n => (
            <p key={n} className="text-sm text-amber-200">
              ⚠️ 第 {n} 行成本为 0 / Line {n} has zero cost
            </p>
          ))}
        </div>

        <p className="text-sm text-gray-300 mb-4 leading-relaxed">
          按 0 成本入库会污染均价和定价报表。确定继续吗？/ Zero cost poisons avg cost and pricing reports. Continue anyway?
        </p>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-2 text-sm bg-red-500/20 border border-red-500/60 text-red-200 hover:bg-red-500/30 rounded-lg"
          >
            确认按 0 提交 / Submit with 0 anyway
          </button>
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="btn btn-primary text-sm"
          >
            返回修改 / Go back
          </button>
        </div>
      </div>
    </div>
  )
}
