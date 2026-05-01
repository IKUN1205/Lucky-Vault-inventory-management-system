import React, { useState, useEffect } from 'react'
import {
  fetchLocations,
  fetchInventory,
  fetchUsers,
  createOnlineOrder,
  createOnlineOrderItem,
  deleteOnlineOrder,
  updateInventory
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import { ShoppingBag, Save, Plus, X, Trash2 } from 'lucide-react'

// 4 platform/channel combos that Aldo ships from. Internally split into
// platform + channel (so reports can group either way), single dropdown for UX.
const PLATFORM_CHANNELS = [
  { value: 'TikTok|RocketsHQ',     label: 'TikTok @ RocketsHQ',     platform: 'TikTok', channel: 'RocketsHQ' },
  { value: 'TikTok|Packheads',     label: 'TikTok @ Packheads',     platform: 'TikTok', channel: 'Packheads' },
  { value: 'eBay|LuckyVaultUS',    label: 'eBay @ LuckyVaultUS',    platform: 'eBay',   channel: 'LuckyVaultUS' },
  { value: 'eBay|SlabbiePatty',    label: 'eBay @ SlabbiePatty',    platform: 'eBay',   channel: 'SlabbiePatty' }
]

const ALLOWED_LOCATION_NAMES = [
  'Master Inventory',
  'Front Store',
  'Slab Room',
  'Stream Room - eBay LuckyVaultUS',
  'Stream Room - eBay SlabbiePatty',
  'Stream Room - TikTok RocketsHQ',
  'Stream Room - TikTok Packheads',
  'Stream Room - Whatnot'
]

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function OnlineOrders() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [locations, setLocations] = useState([])
  const [inventory, setInventory] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    platform_channel: '',                // combined "TikTok|RocketsHQ" etc.
    order_number: '',
    customer_name: '',
    source_location_id: '',
    handled_by_id: '',
    tracking_number: '',
    notes: '',
    product_id: '',
    quantity: 1
  })

  // Cart of items to ship in one order
  const [cart, setCart] = useState([])
  const [productFilters, setProductFilters] = useState({ brand: '', type: '' })

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (form.source_location_id) loadInventoryForLocation(form.source_location_id)
  }, [form.source_location_id])

  const loadData = async () => {
    try {
      const [locData, userData] = await Promise.all([
        fetchLocations(),
        fetchUsers()
      ])
      setLocations(locData)
      setUsers(userData)

      // Default source location to Master Inventory (most common)
      const master = locData.find(l => l.name === 'Master Inventory')
      // Default Handled By to logged-in user (overridable)
      const defaultHandledBy = (user?.id && userData.some(u => u.id === user.id)) ? user.id : ''

      setForm(f => ({
        ...f,
        source_location_id: master?.id || '',
        handled_by_id: defaultHandledBy
      }))
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
    if (name === 'source_location_id') {
      // Switching source resets the cart since available products change
      if (cart.length > 0) {
        setCart([])
        addToast('Cart cleared — source location changed', 'info')
      }
      setForm(f => ({ ...f, product_id: '', quantity: 1 }))
    }
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setProductFilters(f => ({ ...f, [name]: value }))
    setForm(f => ({ ...f, product_id: '' }))
  }

  // Filter inventory list by brand + type filters and exclude items already in cart
  const filteredInventory = inventory.filter(inv => {
    if (productFilters.brand && inv.product?.brand !== productFilters.brand) return false
    if (productFilters.type && inv.product?.type !== productFilters.type) return false
    return true
  })

  const physicalLocations = locations.filter(l => ALLOWED_LOCATION_NAMES.includes(l.name))

  const addToCart = () => {
    if (!form.product_id) {
      addToast('Pick a product first', 'error')
      return
    }
    const qty = parseInt(form.quantity, 10)
    if (!qty || qty < 1) {
      addToast('Quantity must be at least 1', 'error')
      return
    }
    const inv = inventory.find(i => i.product_id === form.product_id)
    if (!inv) {
      addToast('That product has no stock at the source location', 'error')
      return
    }
    // Sum any qty already in cart for this same product
    const alreadyInCart = cart
      .filter(c => c.product_id === form.product_id)
      .reduce((s, c) => s + c.quantity, 0)
    if (alreadyInCart + qty > inv.quantity) {
      addToast(`Only ${inv.quantity - alreadyInCart} left at source for this product`, 'error')
      return
    }
    setCart(prev => [...prev, { product_id: form.product_id, quantity: qty, inventory: inv }])
    setForm(f => ({ ...f, product_id: '', quantity: 1 }))
  }

  const removeFromCart = (idx) => {
    setCart(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!form.platform_channel) {
      addToast('Pick a Platform / Channel', 'error')
      return
    }
    if (!form.source_location_id) {
      addToast('Pick a source location', 'error')
      return
    }
    if (!form.handled_by_id) {
      addToast('Pick who handled this order', 'error')
      return
    }
    if (cart.length === 0) {
      addToast('Cart is empty — add at least one product', 'error')
      return
    }

    const pc = PLATFORM_CHANNELS.find(p => p.value === form.platform_channel)
    if (!pc) {
      addToast('Unknown platform/channel', 'error')
      return
    }

    setSubmitting(true)

    const sourceLocId = form.source_location_id
    const handledById = form.handled_by_id
    const cartSnapshot = [...cart]
    let createdOrderId = null
    const completedItems = []  // {product_id, quantity} for inventory rollback on failure

    try {
      // 1. Create the order header
      const order = await createOnlineOrder({
        date: form.date,
        platform: pc.platform,
        channel: pc.channel,
        order_number: form.order_number || null,
        customer_name: form.customer_name || null,
        handled_by_id: handledById,
        source_location_id: sourceLocId,
        tracking_number: form.tracking_number || null,
        notes: form.notes || null
      })
      createdOrderId = order.id

      // 2. Create each line item + decrement inventory at source
      for (const item of cartSnapshot) {
        await createOnlineOrderItem({
          order_id: createdOrderId,
          product_id: item.product_id,
          quantity: item.quantity
        })
        await updateInventory(item.product_id, sourceLocId, -item.quantity)
        completedItems.push({ product_id: item.product_id, quantity: item.quantity })
      }

      const totalUnits = cartSnapshot.reduce((s, c) => s + c.quantity, 0)

      // 3. Fire-and-forget Lark notification (failures must not roll back the order)
      try {
        const sourceLoc = locations.find(l => l.id === sourceLocId)
        const handledByUser = users.find(u => u.id === handledById)
        const itemsForLark = cartSnapshot.map(c => ({
          name: c.inventory?.product?.name || 'Unknown product',
          quantity: c.quantity
        }))
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'online_order',
            handledBy: handledByUser?.name || 'Unknown',
            platform: pc.platform,
            channel: pc.channel,
            orderNumber: form.order_number || null,
            customerName: form.customer_name || null,
            sourceLocation: sourceLoc?.name || 'Unknown',
            items: itemsForLark,
            totalUnits,
            trackingNumber: form.tracking_number || null
          })
        }).catch(err => console.error('[lark-notify] online_order request failed:', err))
      } catch (err) {
        console.error('[lark-notify] failed to build online_order payload:', err)
      }

      // 4. Build undo callback — reverses inventory, deletes items + order
      const undo = async () => {
        try {
          for (const ci of completedItems) {
            await updateInventory(ci.product_id, sourceLocId, ci.quantity)
          }
          // Hard-delete order; ON DELETE CASCADE cleans up items
          if (createdOrderId) await deleteOnlineOrder(createdOrderId)
          addToast('Undone — online order reverted', 'info')
          loadInventoryForLocation(sourceLocId)
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }

      setCart([])
      setForm(f => ({ ...f, order_number: '', customer_name: '', tracking_number: '', notes: '', product_id: '', quantity: 1 }))
      loadInventoryForLocation(sourceLocId)

      addToast(
        `Order shipped — ${cartSnapshot.length} ${cartSnapshot.length === 1 ? 'product' : 'products'} (${totalUnits} units)`,
        'success',
        { action: { label: 'Undo', onClick: undo } }
      )
    } catch (error) {
      console.error('Error creating online order:', error)
      // Best-effort partial rollback
      try {
        for (const ci of completedItems) {
          await updateInventory(ci.product_id, sourceLocId, ci.quantity)
        }
        if (createdOrderId) await deleteOnlineOrder(createdOrderId)
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr)
      }
      addToast('Failed to ship order — check console', 'error')
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

  // Build option list for the SearchableSelect
  const productOptions = filteredInventory.map(inv => {
    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
    return {
      value: inv.product_id,
      label: `${inv.product?.brand} | ${launchName} | ${inv.product?.category} | ${inv.product?.language}  (stock: ${inv.quantity})`
    }
  })

  // Distinct brands + types in current source location for filter dropdowns
  const brandsAtSource = [...new Set(inventory.map(i => i.product?.brand).filter(Boolean))]
  const typesAtSource  = [...new Set(inventory.map(i => i.product?.type).filter(Boolean))]

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShoppingBag className="text-vault-gold" />
          Online Orders
        </h1>
        <p className="text-gray-400 mt-1">Record outbound shipments for online platform orders (TikTok / eBay)</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">When an online order needs to ship out:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Pick the <span className="text-vault-gold">platform / channel</span> the order came from</li>
            <li>Enter the <span className="text-vault-gold">order number</span> (optional but useful for trace-back)</li>
            <li>Pick the <span className="text-vault-gold">source warehouse</span> the goods are coming out of (default: Master Inventory)</li>
            <li>Add each product + qty to the cart</li>
            <li>Click <span className="text-vault-gold">Ship Order</span> — this decrements inventory and posts to Lark</li>
          </ol>
          <p className="text-cyan-400 text-xs mt-3">💡 This is a logistics record only — no sale price / cost is tracked here. Use Platform Sales for revenue.</p>
        </div>
      </Instructions>

      <form onSubmit={handleSubmit} className="card max-w-3xl">
        {/* Header: date + platform + handled by */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Platform / Channel *</label>
            <select name="platform_channel" value={form.platform_channel} onChange={handleChange} required>
              <option value="">Select platform...</option>
              {PLATFORM_CHANNELS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Handled By *</label>
            <select name="handled_by_id" value={form.handled_by_id} onChange={handleChange} required>
              <option value="">Who shipped this order...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Order metadata: number + customer + tracking */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Order #</label>
            <input
              type="text"
              name="order_number"
              value={form.order_number}
              onChange={handleChange}
              placeholder="Platform order id (optional)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Customer</label>
            <input
              type="text"
              name="customer_name"
              value={form.customer_name}
              onChange={handleChange}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Tracking #</label>
            <input
              type="text"
              name="tracking_number"
              value={form.tracking_number}
              onChange={handleChange}
              placeholder="Optional, can fill later"
            />
          </div>
        </div>

        {/* Source location */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Source Warehouse *</label>
          <select name="source_location_id" value={form.source_location_id} onChange={handleChange} required>
            <option value="">Select source...</option>
            {physicalLocations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>

        {/* Cart builder */}
        <div className="border-t border-vault-border pt-4">
          <h3 className="font-display text-lg font-semibold text-white mb-3">Add Products to Cart</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Brand</label>
              <select name="brand" value={productFilters.brand} onChange={handleFilterChange}>
                <option value="">All</option>
                {brandsAtSource.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Sealed/Unsealed</label>
              <select name="type" value={productFilters.type} onChange={handleFilterChange}>
                <option value="">All</option>
                {typesAtSource.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-300 mb-2">Product (in stock at source)</label>
            <p className="text-xs text-gray-500 mb-2">Format: Brand | Launch Name | Product Type | Language (stock: N)</p>
            <SearchableSelect
              value={form.product_id}
              onChange={(value) => setForm(f => ({ ...f, product_id: value }))}
              options={productOptions}
              placeholder="Search..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end mb-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">Quantity</label>
              <input
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                min="1"
                step="1"
              />
            </div>
            <button type="button" onClick={addToCart} className="btn-secondary flex items-center justify-center gap-2">
              <Plus size={16} /> Add to Cart
            </button>
          </div>

          {cart.length > 0 && (
            <div className="bg-vault-darker rounded-lg p-4 mb-4">
              <h4 className="text-white font-medium mb-3">Cart ({cart.length} {cart.length === 1 ? 'item' : 'items'})</h4>
              <div className="space-y-2">
                {cart.map((item, idx) => {
                  const launchName = extractLaunchName(item.inventory?.product?.name, item.inventory?.product?.category)
                  return (
                    <div key={idx} className="flex items-center justify-between bg-vault-surface rounded px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-white text-sm">
                          {item.inventory?.product?.brand} | {launchName} | {item.inventory?.product?.category} | {item.inventory?.product?.language}
                        </span>
                        <span className="text-vault-gold ml-2">× {item.quantity}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(idx)}
                        className="text-gray-400 hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <p className="text-gray-400 text-xs mt-3">
                Total: {cart.length} {cart.length === 1 ? 'SKU' : 'SKUs'} / {cart.reduce((s, c) => s + c.quantity, 0)} units
              </p>
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows="2"
            placeholder="Optional"
          />
        </div>

        <button
          type="submit"
          className="btn-primary w-full flex items-center justify-center gap-2"
          disabled={submitting || cart.length === 0}
        >
          {submitting ? (
            <>
              <div className="spinner-sm"></div> Shipping...
            </>
          ) : (
            <>
              <Save size={18} /> Ship Order
            </>
          )}
        </button>
      </form>
    </div>
  )
}
