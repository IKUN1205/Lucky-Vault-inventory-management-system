import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchProducts,
  fetchUsers,
  fetchJapanVendors,
  fetchPaymentMethods,
  fetchJapanAcquisitions,
  createJapanAcquisition,
  createVendor,
  createPaymentMethod,
  convertToUSD,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../lib/AuthContext'
import { ShoppingCart, Save, Plus, Trash2, X } from 'lucide-react'

// ============================================================================
// 日本进货 — Japan offline acquisitions
// ============================================================================
// Records cash-in-hand offline purchases (conventions, individual sellers).
// Items go straight into Japan Warehouse — no separate Intake step since
// "buy" and "receive" happen at the same moment for offline purchases.
//
// Differences vs the US PurchasedItems page:
//   - currency is fixed to JPY (auto USD conversion shown)
//   - source_country fixed to JP, origin = jp_vendor
//   - status = 'Received' immediately, inventory bumps on submit
//   - no tracking number field (no shipment to track)
//   - vendor dropdown limited to JP vendors (or no-country legacy)
// ============================================================================

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

const productOptionLabel = (p) =>
  `${p.brand || '?'} | ${extractLaunchName(p.name, p.category)} | ${p.category || p.type || '?'} | ${p.language || '?'}`

export default function JapanAcquisitions() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [products, setProducts] = useState([])
  const [users, setUsers] = useState([])
  const [vendors, setVendors] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [recentAcqs, setRecentAcqs] = useState([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Header (shared across all line items in one submission)
  const [header, setHeader] = useState({
    date_purchased: new Date().toLocaleDateString('en-CA'),
    acquirer_id: '',
    vendor_id: '',
    payment_method_id: '',
    notes: '',
  })

  const [lineItems, setLineItems] = useState([
    { id: 1, product_id: '', quantity: 1, unit_cost_jpy: '' },
  ])

  // Inline add-new-vendor / -payment toggles (same UX as US PurchasedItems)
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [showNewPayment, setShowNewPayment] = useState(false)
  const [newPaymentName, setNewPaymentName] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      const [prods, usersData, vs, pms, recent] = await Promise.all([
        fetchProducts(),
        fetchUsers(),
        fetchJapanVendors(),
        fetchPaymentMethods(),
        fetchJapanAcquisitions(20),
      ])
      setProducts(prods.filter(p => p.type === 'Sealed' || p.type === 'Pack'))
      setUsers(usersData)
      setVendors(vs)
      setPaymentMethods(pms)
      setRecentAcqs(recent)
    } catch (err) {
      console.error(err)
      addToast(err.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleHeaderChange = (e) => {
    const { name, value } = e.target
    setHeader(h => ({ ...h, [name]: value }))
  }

  const addLineItem = () => {
    const newId = Math.max(...lineItems.map(i => i.id), 0) + 1
    setLineItems([...lineItems, { id: newId, product_id: '', quantity: 1, unit_cost_jpy: '' }])
  }

  const removeLineItem = (id) => {
    if (lineItems.length <= 1) return
    setLineItems(lineItems.filter(i => i.id !== id))
  }

  const updateLineItem = (id, field, value) => {
    setLineItems(items => items.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  // Totals (live preview)
  const totalJpy = lineItems.reduce((s, i) => {
    const q = parseInt(i.quantity) || 0
    const c = parseFloat(i.unit_cost_jpy) || 0
    return s + q * c
  }, 0)
  const totalUsd = convertToUSD(totalJpy, 'JPY')

  const handleAddNewVendor = async () => {
    const name = newVendorName.trim()
    if (!name) return
    try {
      // vendors.country is an enum (`region`) — canonical Japan value is
      // 'Japan', not 'JP' / 'JPN' (those throw 22P02).
      const newVendor = await createVendor({ name, country: 'Japan', active: true })
      setVendors(v => [...v, newVendor].sort((a, b) => a.name.localeCompare(b.name)))
      setHeader(h => ({ ...h, vendor_id: newVendor.id }))
      setNewVendorName('')
      setShowNewVendor(false)
      addToast(`Vendor added: ${name}`, 'success')
    } catch (err) {
      addToast(`Failed to add vendor: ${err.message}`, 'error')
    }
  }

  const handleAddNewPayment = async () => {
    const name = newPaymentName.trim()
    if (!name) return
    try {
      const newPm = await createPaymentMethod(name)
      setPaymentMethods(pms => [...pms, newPm])
      setHeader(h => ({ ...h, payment_method_id: newPm.id }))
      setNewPaymentName('')
      setShowNewPayment(false)
      addToast(`Payment method added: ${name}`, 'success')
    } catch (err) {
      addToast(`Failed to add payment method: ${err.message}`, 'error')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const valid = lineItems.filter(i => i.product_id && parseInt(i.quantity) > 0)
    if (valid.length === 0) {
      addToast('Add at least one line item with product + quantity', 'error')
      return
    }
    if (!header.acquirer_id) {
      addToast('Pick who made the purchase (Acquirer)', 'error')
      return
    }

    setSubmitting(true)
    let ok = 0, fail = 0
    const larkItems = []
    let totalJpy = 0
    let totalUnits = 0
    try {
      for (const item of valid) {
        try {
          await createJapanAcquisition({
            product_id: item.product_id,
            quantity: parseInt(item.quantity),
            unit_cost_jpy: parseFloat(item.unit_cost_jpy) || 0,
            vendor_id: header.vendor_id || null,
            payment_method_id: header.payment_method_id || null,
            acquirer_id: header.acquirer_id,
            date_purchased: header.date_purchased,
            notes: header.notes || null,
          })
          ok++
          // Build Lark payload pieces from the validated form data so we
          // can fire one consolidated notification at the end of the loop.
          const p = products.find(pp => pp.id === item.product_id)
          const launch = p ? extractLaunchName(p.name, p.category) : 'Unknown'
          const qty = parseInt(item.quantity)
          const unitJpy = parseFloat(item.unit_cost_jpy) || 0
          const lineJpy = qty * unitJpy
          larkItems.push({
            name: p ? `${p.brand} | ${launch} | ${p.category || p.type} | ${p.language}` : 'Unknown',
            quantity: qty,
            cost: lineJpy,
          })
          totalJpy += lineJpy
          totalUnits += qty
        } catch (err) {
          console.error('[JapanAcq] line failed:', err)
          fail++
        }
      }
      if (ok > 0) {
        addToast(`✓ ${ok} item${ok === 1 ? '' : 's'} added to Japan Warehouse${fail ? ` (${fail} failed)` : ''}`, ok === valid.length ? 'success' : 'info')

        // Fire-and-forget Lark — reuses the 'purchased' type with
        // sourceCountry='Japan' so dispatch routes to both the Acquisitions
        // Squad (global visibility) and the Japan group (if configured).
        try {
          const vendor = vendors.find(v => v.id === header.vendor_id)
          const acquirer = users.find(u => u.id === header.acquirer_id)
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'purchased',
              acquirer: acquirer?.name || 'Unknown',
              vendor: vendor?.name || null,
              sourceCountry: 'Japan',
              currency: 'JPY',
              totalCost: totalJpy,
              totalCostUSD: convertToUSD(totalJpy, 'JPY'),
              items: larkItems,
              totalUnits,
              // No carrier/tracking for offline buys
            }),
          }).catch(err => console.error('[lark-notify] jp_acquisition failed:', err))
        } catch (err) {
          console.error('[lark-notify] jp_acquisition payload build failed:', err)
        }

        // Reset only line items, keep header so multiple batches from same
        // vendor go fast.
        setLineItems([{ id: 1, product_id: '', quantity: 1, unit_cost_jpy: '' }])
        // Refresh recent list
        const recent = await fetchJapanAcquisitions(20)
        setRecentAcqs(recent)
      } else {
        addToast('Failed to save acquisitions', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner" /></div>

  return (
    <div className="fade-in space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShoppingCart className="text-vault-gold" />
          🇯🇵 日本进货 / Japan Acquisitions
        </h1>
        <p className="text-gray-400 mt-1">
          Record offline purchases (currency = JPY, instant-receive to <strong>Japan Warehouse</strong>).
          See current stock in <Link to="/jp/inventory" className="text-vault-gold hover:underline">日本库存</Link>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card max-w-4xl space-y-4">
        {/* Header */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
            <input
              type="date"
              name="date_purchased"
              value={header.date_purchased}
              onChange={handleHeaderChange}
              required
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Acquirer *</label>
            <select name="acquirer_id" value={header.acquirer_id} onChange={handleHeaderChange} required>
              <option value="">Who made this purchase?</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Vendor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">Vendor (optional)</label>
              <button
                type="button"
                onClick={() => setShowNewVendor(s => !s)}
                className="text-xs text-vault-gold hover:underline"
              >
                {showNewVendor ? 'Cancel' : '+ New'}
              </button>
            </div>
            {showNewVendor ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newVendorName}
                  onChange={e => setNewVendorName(e.target.value)}
                  placeholder="New JP vendor name"
                  className="flex-1"
                />
                <button type="button" onClick={handleAddNewVendor} className="btn-primary text-sm">Add</button>
              </div>
            ) : (
              <select name="vendor_id" value={header.vendor_id} onChange={handleHeaderChange}>
                <option value="">— No specific vendor —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
          </div>

          {/* Payment method */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">Payment Method (optional)</label>
              <button
                type="button"
                onClick={() => setShowNewPayment(s => !s)}
                className="text-xs text-vault-gold hover:underline"
              >
                {showNewPayment ? 'Cancel' : '+ New'}
              </button>
            </div>
            {showNewPayment ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPaymentName}
                  onChange={e => setNewPaymentName(e.target.value)}
                  placeholder="e.g. Cash, Bank Transfer"
                  className="flex-1"
                />
                <button type="button" onClick={handleAddNewPayment} className="btn-primary text-sm">Add</button>
              </div>
            ) : (
              <select name="payment_method_id" value={header.payment_method_id} onChange={handleHeaderChange}>
                <option value="">— Unspecified —</option>
                {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
              </select>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional)</label>
          <input
            type="text"
            name="notes"
            value={header.notes}
            onChange={handleHeaderChange}
            placeholder="e.g. Akihabara convention purchase"
          />
        </div>

        {/* Line items */}
        <div className="pt-4 border-t border-vault-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm">Items</h3>
            <div className="text-xs text-gray-400">
              Total: <span className="text-vault-gold font-semibold">¥{totalJpy.toLocaleString()}</span>
              <span className="text-gray-500 mx-2">≈</span>
              <span className="text-green-400 font-semibold">${totalUsd.toFixed(2)} USD</span>
            </div>
          </div>

          <div className="space-y-2">
            {lineItems.map((item, idx) => {
              const q = parseInt(item.quantity) || 0
              const c = parseFloat(item.unit_cost_jpy) || 0
              const lineTotal = q * c
              return (
                <div key={item.id} className="p-3 bg-vault-dark rounded-lg border border-vault-border">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 md:col-span-6">
                      <label className="block text-xs text-gray-400 mb-1">Product</label>
                      <SearchableSelect
                        options={products}
                        value={item.product_id}
                        onChange={(val) => updateLineItem(item.id, 'product_id', val)}
                        getOptionValue={(p) => p.id}
                        getOptionLabel={productOptionLabel}
                        placeholder="Search..."
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Qty</label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, 'quantity', e.target.value)}
                        min="1"
                        className="text-sm"
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Unit ¥</label>
                      <input
                        type="number"
                        value={item.unit_cost_jpy}
                        onChange={(e) => updateLineItem(item.id, 'unit_cost_jpy', e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="JPY"
                        className="text-sm"
                      />
                    </div>
                    <div className="col-span-3 md:col-span-1 text-right">
                      <div className="text-[10px] text-gray-500">Line</div>
                      <div className="text-sm text-vault-gold">¥{lineTotal.toLocaleString()}</div>
                    </div>
                    <div className="col-span-1 text-right">
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        disabled={lineItems.length <= 1}
                        className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-30"
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={addLineItem}
            className="w-full mt-3 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors text-sm"
          >
            <Plus size={14} className="inline mr-2" /> Add another item
          </button>
        </div>

        <div className="pt-4 border-t border-vault-border flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary flex items-center gap-2"
          >
            <Save size={16} />
            {submitting ? 'Saving…' : 'Save → Japan Warehouse'}
          </button>
        </div>
      </form>

      {/* Recent acquisitions */}
      <div className="card max-w-4xl">
        <h3 className="font-semibold text-white text-sm mb-3">Recent Japan acquisitions (last 20)</h3>
        {recentAcqs.length === 0 ? (
          <p className="text-gray-500 text-sm py-3">No Japan acquisitions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Vendor</th>
                  <th className="pb-2">Acquirer</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">JPY</th>
                  <th className="pb-2 text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {recentAcqs.map(a => (
                  <tr key={a.id} className="border-b border-vault-border/40">
                    <td className="py-1.5 text-gray-300">{a.date_purchased}</td>
                    <td className="py-1.5 text-white">{extractLaunchName(a.product?.name, a.product?.category)} <span className="text-gray-500 text-xs">[{a.product?.language}]</span></td>
                    <td className="py-1.5 text-gray-400">{a.vendor?.name || '—'}</td>
                    <td className="py-1.5 text-gray-400">{a.acquirer?.name || '—'}</td>
                    <td className="py-1.5 text-right text-white">{a.quantity_purchased}</td>
                    <td className="py-1.5 text-right text-vault-gold">¥{(a.cost || 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right text-green-400">${(a.cost_usd || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
