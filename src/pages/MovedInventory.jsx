import React, { useState, useEffect } from 'react'
import { fetchLocations, fetchInventory, createMovement, updateInventory, deleteMovement, fetchUsers } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import { ArrowRightLeft, ArrowRight, Save, Plus, X, Trash2 } from 'lucide-react'

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
  const { user } = useAuth()

  const [locations, setLocations] = useState([])
  const [inventory, setInventory] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    from_location_id: '',
    to_location_id: '',
    moved_by_id: '',
    product_id: '',
    quantity: 1,
    notes: ''
  })

  // Cart of items to transfer in one batch
  // Each item: { product_id, quantity, inventory: <full inventory row for display + cost> }
  const [cart, setCart] = useState([])

  const [productFilters, setProductFilters] = useState({ brand: '', type: '' })

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (form.from_location_id) loadInventoryForLocation(form.from_location_id)
  }, [form.from_location_id])

  const loadData = async () => {
    try {
      const [locData, userData] = await Promise.all([
        fetchLocations(),
        fetchUsers()
      ])
      setLocations(locData)
      setUsers(userData)

      // Default Moved By to the currently logged-in user (if they exist in the users list).
      // Operator can always change it before submitting if someone else is doing the move.
      if (user?.id && userData.some(u => u.id === user.id)) {
        setForm(f => ({ ...f, moved_by_id: user.id }))
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
      // Changing source invalidates the cart (different products available)
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

  const filteredInventory = inventory.filter(inv => {
    if (productFilters.brand && inv.product?.brand !== productFilters.brand) return false
    if (productFilters.type && inv.product?.type !== productFilters.type) return false
    return true
  })

  const selectedInventory = inventory.find(inv => inv.product_id === form.product_id)

  // How much of this product is already reserved in the cart
  const cartQtyForProduct = (productId) =>
    cart.filter(c => c.product_id === productId).reduce((s, c) => s + c.quantity, 0)

  // Available qty after subtracting what's already in cart
  const availableQty = selectedInventory
    ? Math.max(0, selectedInventory.quantity - cartQtyForProduct(form.product_id))
    : 0

  const allowedLocations = locations.filter(l => ALLOWED_LOCATION_NAMES.includes(l.name))
  const physicalLocations = allowedLocations.filter(l => l.type === 'Physical')
  const allDestinations = allowedLocations.filter(l => l.id !== form.from_location_id)

  // -------- Cart actions --------
  const handleAddToCart = () => {
    if (!form.from_location_id || !form.to_location_id) {
      addToast('Pick From and To locations first', 'error')
      return
    }
    if (!form.product_id) {
      addToast('Pick a product first', 'error')
      return
    }
    const qty = parseInt(form.quantity)
    if (!qty || qty < 1) {
      addToast('Quantity must be at least 1', 'error')
      return
    }
    if (qty > availableQty) {
      const inCart = cartQtyForProduct(form.product_id)
      addToast(
        inCart > 0
          ? `Only ${availableQty} more available (${inCart} already in cart)`
          : `Only ${availableQty} available`,
        'error'
      )
      return
    }

    // If product already in cart, merge by summing qty
    const existing = cart.find(c => c.product_id === form.product_id)
    if (existing) {
      setCart(cart.map(c =>
        c.product_id === form.product_id
          ? { ...c, quantity: c.quantity + qty }
          : c
      ))
      addToast(`Updated: ${qty} more added (total ${existing.quantity + qty})`)
    } else {
      setCart([...cart, {
        product_id: form.product_id,
        quantity: qty,
        inventory: selectedInventory,
      }])
      addToast(`Added ${qty} × ${selectedInventory?.product?.name?.slice(0, 40)}`)
    }

    // Clear product + quantity, keep filters and locations
    setForm(f => ({ ...f, product_id: '', quantity: 1 }))
  }

  const handleRemoveFromCart = (productId) => {
    setCart(cart.filter(c => c.product_id !== productId))
  }

  const handleClearCart = () => {
    if (cart.length === 0) return
    if (!confirm(`Clear all ${cart.length} items from cart?`)) return
    setCart([])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!form.from_location_id || !form.to_location_id) {
      addToast('Pick From and To locations first', 'error')
      return
    }
    if (!form.moved_by_id) {
      addToast('Pick who is moving the items', 'error')
      return
    }
    if (cart.length === 0) {
      addToast('Cart is empty — add at least one product', 'error')
      return
    }

    setSubmitting(true)

    // Track what we created, so the Undo button can reverse it
    const completedMoves = []
    // Snapshot of the cart for the closure (state will be cleared on success)
    const movedFromId = form.from_location_id
    const movedToId = form.to_location_id

    try {
      // Create movements + update inventory for each cart item
      for (const item of cart) {
        const inv = item.inventory
        const cost = (inv?.avg_cost_basis || 0) * item.quantity

        const movement = await createMovement({
          date: form.date,
          product_id: item.product_id,
          from_location_id: movedFromId,
          to_location_id: movedToId,
          quantity: item.quantity,
          cost_basis: cost,
          movement_type: 'Transfer',
          notes: form.notes
        })

        await updateInventory(item.product_id, movedFromId, -item.quantity)
        await updateInventory(item.product_id, movedToId, item.quantity, inv?.avg_cost_basis)

        completedMoves.push({
          movement_id: movement?.id,
          product_id: item.product_id,
          quantity: item.quantity,
          avg_cost_basis: inv?.avg_cost_basis,
        })
      }

      const totalUnits = cart.reduce((s, c) => s + c.quantity, 0)

      // Fire-and-forget Lark notification. Failures here MUST NOT bubble up
      // (the move already succeeded — we don't want to roll it back if Lark is down).
      try {
        const fromLoc = locations.find(l => l.id === movedFromId)
        const toLoc = locations.find(l => l.id === movedToId)
        const movedByUser = users.find(u => u.id === form.moved_by_id)
        const itemsForLark = cart.map(c => ({
          name: c.inventory?.product?.name || 'Unknown product',
          quantity: c.quantity
        }))
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'move',
            fromLocation: fromLoc?.name || 'Unknown',
            toLocation: toLoc?.name || 'Unknown',
            items: itemsForLark,
            user: movedByUser?.name || 'Unknown',
            totalUnits
          })
        }).catch(err => {
          console.error('[lark-notify] request failed (move still succeeded):', err)
        })
      } catch (err) {
        console.error('[lark-notify] failed to build payload:', err)
      }

      // Build undo callback — reverses every movement we just created
      const undo = async () => {
        try {
          for (const m of completedMoves) {
            // Reverse inventory deltas
            await updateInventory(m.product_id, movedFromId, m.quantity)
            await updateInventory(m.product_id, movedToId, -m.quantity)
            // Delete the movement record so the audit log is clean
            if (m.movement_id) {
              await deleteMovement(m.movement_id)
            }
          }
          addToast(`Undone — ${completedMoves.length} ${completedMoves.length === 1 ? 'transfer' : 'transfers'} reverted`, 'info')
          // Refresh inventory view since balances changed
          if (form.from_location_id) loadInventoryForLocation(form.from_location_id)
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }

      setCart([])
      setForm(f => ({ ...f, product_id: '', quantity: 1, notes: '' }))
      loadInventoryForLocation(movedFromId)

      addToast(
        `Moved ${completedMoves.length} ${completedMoves.length === 1 ? 'product' : 'products'} (${totalUnits} units) successfully!`,
        'success',
        { action: { label: 'Undo', onClick: undo } }
      )
    } catch (error) {
      console.error('Error moving inventory:', error)
      // Best-effort partial undo: reverse whatever already succeeded
      if (completedMoves.length > 0) {
        try {
          for (const m of completedMoves) {
            await updateInventory(m.product_id, movedFromId, m.quantity)
            await updateInventory(m.product_id, movedToId, -m.quantity)
            if (m.movement_id) await deleteMovement(m.movement_id)
          }
          addToast(`Move failed mid-way. Reverted ${completedMoves.length} completed transfers.`, 'error')
        } catch (rollbackErr) {
          console.error('Rollback also failed:', rollbackErr)
          addToast('Move failed AND rollback failed — check console + DB!', 'error')
        }
      } else {
        addToast('Failed to move inventory — check console', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Format for SearchableSelect - new nomenclature
  const formatProductOption = (inv) => {
    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
    const inCart = cartQtyForProduct(inv.product_id)
    const remaining = Math.max(0, inv.quantity - inCart)
    return (
      <div className="flex items-center gap-2">
        <span className="text-vault-gold">{inv.product?.brand}</span>
        <span className="text-gray-400">|</span>
        <span className="text-white">{launchName}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-300">{inv.product?.category}</span>
        <span className="text-gray-400">|</span>
        <span className="text-blue-400">{inv.product?.language}</span>
        <span className={`ml-2 ${remaining > 0 ? 'text-green-400' : 'text-red-400'}`}>
          • {remaining} avail{inCart > 0 ? ` (${inCart} in cart)` : ''}
        </span>
      </div>
    )
  }

  const getProductLabel = (inv) => {
    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
    const inCart = cartQtyForProduct(inv.product_id)
    const remaining = Math.max(0, inv.quantity - inCart)
    return `${inv.product?.brand} | ${launchName} | ${inv.product?.category} | ${inv.product?.language} - ${remaining} avail${inCart > 0 ? ` (${inCart} in cart)` : ''}`
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  const totalCartUnits = cart.reduce((s, c) => s + c.quantity, 0)

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ArrowRightLeft className="text-orange-400" />
          Move Inventory
        </h1>
        <p className="text-gray-400 mt-1">Transfer one or many products between locations in a single batch</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Bulk transfer flow:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select <span className="text-vault-gold">FROM location</span> (where it's coming from)</li>
            <li>Select <span className="text-vault-gold">TO location</span> (where it's going)</li>
            <li>Pick a <span className="text-vault-gold">product</span> + <span className="text-vault-gold">quantity</span> → click <span className="text-vault-gold">Add to Cart</span></li>
            <li>Repeat for as many products as you need — they accumulate in the cart below</li>
            <li>When done, click <span className="text-vault-gold">Move N Items</span> to transfer everything in one batch</li>
          </ol>
          <p className="text-orange-400 text-xs mt-3">💡 Changing FROM location clears the cart. Same product added twice merges quantities.</p>
        </div>
      </Instructions>

      <form onSubmit={handleSubmit} className="card max-w-3xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Moved By *</label>
            <select
              name="moved_by_id"
              value={form.moved_by_id}
              onChange={handleChange}
              required
            >
              <option value="">Who is moving these items...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
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
            <h3 className="font-display text-lg font-semibold text-white mb-4">Add Products to Cart</h3>

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
              <label className="block text-sm font-medium text-gray-300 mb-2">Product (in stock)</label>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Quantity (max: {availableQty})
                  </label>
                  <input
                    type="number"
                    name="quantity"
                    value={form.quantity}
                    onChange={handleChange}
                    min="1"
                    max={availableQty}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={availableQty < 1}
                  className="btn btn-secondary"
                >
                  <Plus size={18} /> Add to Cart
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cart display */}
        {cart.length > 0 && (
          <div className="mt-6 p-4 bg-vault-bg/60 rounded-lg border border-vault-gold/30">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-display text-sm uppercase tracking-wide text-vault-gold">
                Cart — {cart.length} {cart.length === 1 ? 'product' : 'products'} · {totalCartUnits} units
              </h4>
              <button
                type="button"
                onClick={handleClearCart}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 size={14} /> Clear all
              </button>
            </div>
            <div className="space-y-2">
              {cart.map(item => {
                const launchName = extractLaunchName(item.inventory?.product?.name, item.inventory?.product?.category)
                return (
                  <div key={item.product_id} className="flex items-center justify-between gap-3 p-3 bg-vault-card rounded border border-vault-border">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span className="text-vault-gold font-medium">{item.inventory?.product?.brand}</span>
                        <span className="text-gray-500">|</span>
                        <span className="text-white">{launchName}</span>
                        <span className="text-gray-500">|</span>
                        <span className="text-gray-300">{item.inventory?.product?.category}</span>
                        <span className="text-gray-500">|</span>
                        <span className="text-blue-400">{item.inventory?.product?.language}</span>
                      </div>
                    </div>
                    <span className="text-orange-400 font-bold whitespace-nowrap">× {item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromCart(item.product_id)}
                      className="text-gray-400 hover:text-red-400 p-1"
                      aria-label="Remove from cart"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes (applied to all items)</label>
          <input type="text" name="notes" value={form.notes} onChange={handleChange} placeholder="Optional" />
        </div>

        <div className="mt-6">
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={submitting || cart.length === 0}
          >
            {submitting ? (
              <div className="spinner w-5 h-5 border-2"></div>
            ) : (
              <>
                <Save size={20} /> Move {cart.length || ''} {cart.length === 1 ? 'Item' : 'Items'}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
