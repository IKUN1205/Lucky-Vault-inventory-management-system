import React, { useState, useEffect } from 'react'
import { fetchInventory, fetchLocations, supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Eye, Package, Search, Edit2, Save, X, Trash2, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronUp, Layers, Diamond } from 'lucide-react'

// All cost values stored in inventory.avg_cost_basis are USD-denominated —
// they're converted at acquisition time using the rates in src/lib/supabase.js.
// The CURRENCY column was removed since it was always "USD" and added no info;
// the per-location header carries an "All values in USD" hint instead.

// Helper to extract Launch Name from full product name
// e.g., "Raging Surf Booster Box" -> "Raging Surf"
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  // Remove the category/product type from the end if present
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function ViewInventory() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [inventory, setInventory] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedLocation, setSelectedLocation] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filters, setFilters] = useState({
    brand: '',
    type: '',
    language: '', // '' = all, 'JP' | 'EN' | 'CN' | 'KR'
  })
  // Sort state — { field, direction }. Click a column header to sort by it;
  // click again to flip asc/desc. Sort is applied within each location group
  // so "highest-value first" works the way you'd expect per shelf.
  const [sort, setSort] = useState({ field: 'totalValue', direction: 'desc' })
  const [editingId, setEditingId] = useState(null)
  // applyToAll defaults ON because the typical mental model is "this product
  // costs $X" — same across locations. Staff who legitimately want a
  // per-location cost (rare — different intake batches at different prices)
  // can uncheck it. Bug-fix 2026-06-04: previously the cost edit only hit
  // the one location row, which surprised staff editing at Master expecting
  // Stream Rooms to follow.
  const [editForm, setEditForm] = useState({ quantity: '', avg_cost_basis: '', applyToAll: true })

  // Per-location buckets of sellable singles / slabs, plus which buckets the
  // user has expanded. Collapsed by default — sealed stays the headline; the
  // cards roll up underneath each location card on demand (directive 2026-05-29).
  const [singlesByLoc, setSinglesByLoc] = useState({})
  const [slabsByLoc, setSlabsByLoc] = useState({})
  const [expandedSingles, setExpandedSingles] = useState(new Set())
  const [expandedSlabs, setExpandedSlabs] = useState(new Set())
  const toggleSingles = (loc) => setExpandedSingles(prev => {
    const next = new Set(prev); next.has(loc) ? next.delete(loc) : next.add(loc); return next
  })
  const toggleSlabs = (loc) => setExpandedSlabs(prev => {
    const next = new Set(prev); next.has(loc) ? next.delete(loc) : next.add(loc); return next
  })

  // Toggle sort: same column = flip direction; different column = start desc
  // (descending is the more useful default for $ and qty — biggest first).
  const handleSort = (field) => {
    setSort(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'desc' ? 'asc' : 'desc' }
      }
      return { field, direction: 'desc' }
    })
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    loadInventory()
  }, [selectedLocation])

  const loadData = async () => {
    try {
      const locData = await fetchLocations('Physical')
      setLocations(locData)
      loadInventory()
      loadCardsByLocation()
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Pull every sellable single + slab once, grouped by location name so each
  // location card below has its own bucket. Sold rows are excluded; deleted
  // rows are excluded.
  const loadCardsByLocation = async () => {
    try {
      const slabCols = (extras) => `
          id, item_name, grading_company, cert_number, market_price_usd, lv_price_usd,
          ${extras.length ? extras.join(', ') + ', ' : ''}status,
          location:locations(id, name)
        `
      const slabQuery = (extras) => supabase.from('slabs').select(slabCols(extras))
        .eq('deleted', false).in('status', ['in_inventory', 'listed'])
      const [singlesRes, slabsResFirst] = await Promise.all([
        supabase.from('singles').select(`
          id, card_name, card_number, condition, quantity, current_market_price_usd,
          tcg_id, status,
          set:card_sets(name),
          location:locations(id, name)
        `).eq('deleted', false).in('status', ['in_inventory', 'listed']),
        slabQuery(['sheet_note', 'sheet_bin']),
      ])
      // sheet_note / sheet_bin land via scripts/add_slabs_sheet_note.sql /
      // add_slabs_sheet_bin.sql — until those migrations run, retry with
      // fewer optional columns so the sub-sections still render.
      let slabsRes = slabsResFirst
      if (slabsRes.error && /sheet_bin/.test(slabsRes.error.message || '')) {
        slabsRes = await slabQuery(['sheet_note'])
      }
      if (slabsRes.error && /sheet_note/.test(slabsRes.error.message || '')) {
        slabsRes = await slabQuery([])
      }
      if (singlesRes.error) throw singlesRes.error
      if (slabsRes.error) throw slabsRes.error
      const sg = {}
      for (const s of singlesRes.data || []) {
        const name = s.location?.name || 'Unknown'
        if (!sg[name]) sg[name] = []
        sg[name].push(s)
      }
      const sl = {}
      for (const s of slabsRes.data || []) {
        const name = s.location?.name || 'Unknown'
        if (!sl[name]) sl[name] = []
        sl[name].push(s)
      }
      setSinglesByLoc(sg)
      setSlabsByLoc(sl)
    } catch (err) {
      console.error('[ViewInventory] loadCardsByLocation failed:', err)
    }
  }

  const loadInventory = async () => {
    try {
      const invData = await fetchInventory(selectedLocation || null)
      // Filter to only sealed products (no singles/slabs)
      const sealedOnly = invData.filter(inv => 
        inv.product?.type === 'Sealed' || inv.product?.type === 'Pack'
      )
      setInventory(sealedOnly)
    } catch (error) {
      console.error('Error loading inventory:', error)
    }
  }

  const startEdit = (inv) => {
    setEditingId(inv.id)
    setEditForm({
      quantity: inv.quantity.toString(),
      avg_cost_basis: inv.avg_cost_basis?.toString() || '0',
      applyToAll: true,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({ quantity: '', avg_cost_basis: '', applyToAll: true })
  }

  const saveEdit = async (invId) => {
    try {
      const newQty = parseInt(editForm.quantity) || 0
      const newCost = parseFloat(editForm.avg_cost_basis) || 0
      // Always update the row the user actually clicked Edit on (quantity
      // is genuinely per-location, so this must stay row-scoped).
      const { error } = await supabase
        .from('inventory')
        .update({ quantity: newQty, avg_cost_basis: newCost })
        .eq('id', invId)
      if (error) throw error

      // If "Apply to all locations" is checked, also push the new cost to
      // every other inventory row for the same product. We have to look up
      // the product_id first because the table row only knows its own id.
      // Quantity is never propagated — each location's qty is independent.
      let propagated = 0
      if (editForm.applyToAll) {
        const target = inventory.find(i => i.id === invId)
        const productId = target?.product_id || target?.product?.id
        if (productId) {
          const { data: others, error: othersErr } = await supabase
            .from('inventory')
            .update({ avg_cost_basis: newCost })
            .eq('product_id', productId)
            .neq('id', invId)
            .select('id')
          if (othersErr) throw othersErr
          propagated = (others || []).length
        }
      }

      addToast(
        propagated > 0
          ? `Updated — cost applied to ${propagated + 1} location${propagated + 1 === 1 ? '' : 's'}`
          : 'Inventory updated!'
      )
      setEditingId(null)
      loadInventory()
    } catch (error) {
      console.error('Error updating inventory:', error)
      addToast('Failed to update inventory', 'error')
    }
  }

  const deleteInventory = async (invId) => {
    if (!confirm('Are you sure you want to delete this inventory record?')) return
    
    try {
      const { error } = await supabase
        .from('inventory')
        .delete()
        .eq('id', invId)

      if (error) throw error

      addToast('Inventory deleted!')
      loadInventory()
    } catch (error) {
      console.error('Error deleting inventory:', error)
      addToast('Failed to delete inventory', 'error')
    }
  }

  // Filter inventory
  const filteredInventory = inventory.filter(inv => {
    if (filters.brand && inv.product?.brand !== filters.brand) return false
    if (filters.type && inv.product?.type !== filters.type) return false
    if (filters.language && inv.product?.language !== filters.language) return false
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
      return (
        launchName.toLowerCase().includes(search) ||
        inv.product?.brand?.toLowerCase().includes(search) ||
        inv.product?.category?.toLowerCase().includes(search)
      )
    }
    return true
  })

  // Sort comparator. Returns the value used for ordering for the given field.
  // Strings get lower-cased so case-insensitive sort is consistent.
  const sortValue = (inv, field) => {
    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
    switch (field) {
      case 'launchName':  return (launchName || '').toLowerCase()
      case 'brand':       return (inv.product?.brand || '').toLowerCase()
      case 'productType': return (inv.product?.category || '').toLowerCase()
      case 'sealed':      return (inv.product?.type || '').toLowerCase()
      case 'language':    return (inv.product?.language || '').toLowerCase()
      case 'qty':         return inv.quantity || 0
      case 'avgCost':     return inv.avg_cost_basis || 0
      case 'totalValue':  return (inv.quantity || 0) * (inv.avg_cost_basis || 0)
      default:            return 0
    }
  }

  const sortItems = (items) => {
    const sorted = [...items].sort((a, b) => {
      const av = sortValue(a, sort.field)
      const bv = sortValue(b, sort.field)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.direction === 'desc' ? bv - av : av - bv
      }
      // String comparison
      if (av < bv) return sort.direction === 'desc' ? 1 : -1
      if (av > bv) return sort.direction === 'desc' ? -1 : 1
      return 0
    })
    return sorted
  }

  // Tiny arrow indicator next to sortable column headers.
  const SortArrow = ({ field }) => {
    if (sort.field !== field) {
      return <ArrowUpDown size={12} className="inline-block ml-1 text-gray-600" />
    }
    return sort.direction === 'desc'
      ? <ArrowDown size={12} className="inline-block ml-1 text-vault-gold" />
      : <ArrowUp size={12} className="inline-block ml-1 text-vault-gold" />
  }

  // Group by location
  const groupedByLocation = filteredInventory.reduce((acc, inv) => {
    const locName = inv.location?.name || 'Unknown'
    if (!acc[locName]) acc[locName] = []
    acc[locName].push(inv)
    return acc
  }, {})

  // ---- Card-aware search (boss directive 2026-06-23) ----
  // The search box used to filter SEALED only. Now it ALSO searches
  // singles (name / card # / TCG ID / set) and slabs (item name / cert /
  // grading / bin). When a search is active we surface every LOCATION that
  // holds a matching card — even card-only locations with no sealed stock
  // — and auto-expand its card sub-sections, so staff can type a card and
  // instantly see where it physically is. With NO search the view is
  // unchanged (sealed-grouped locations, cards rolled up + collapsed).
  const q = searchTerm.trim().toLowerCase()
  const searching = q.length > 0
  const matchSingle = (s) =>
    (s.card_name || '').toLowerCase().includes(q) ||
    String(s.card_number || '').toLowerCase().includes(q) ||
    String(s.tcg_id || '').toLowerCase().includes(q) ||
    (s.set?.name || '').toLowerCase().includes(q)
  const matchSlab = (s) =>
    (s.item_name || '').toLowerCase().includes(q) ||
    String(s.cert_number || '').toLowerCase().includes(q) ||
    (s.grading_company || '').toLowerCase().includes(q) ||
    String(s.sheet_bin || '').toLowerCase().includes(q)
  const singlesForLoc = (loc) =>
    searching ? (singlesByLoc[loc] || []).filter(matchSingle) : (singlesByLoc[loc] || [])
  const slabsForLoc = (loc) =>
    searching ? (slabsByLoc[loc] || []).filter(matchSlab) : (slabsByLoc[loc] || [])

  // When a specific Location is picked, the card search must stay WITHIN it
  // too. The sealed side is already location-filtered server-side; the
  // singles/slabs buckets hold every location, so constrain them here by the
  // selected location's NAME (selectedLocation is the location id).
  const selectedLocName = selectedLocation
    ? (locations.find(l => String(l.id) === String(selectedLocation))?.name || null)
    : null

  // Locations to render. No search → sealed-grouped locations (unchanged).
  // Search → union of matching-sealed locations + locations holding a
  // matching single/slab, then narrowed to the selected location (if any).
  const locationNames = searching
    ? Array.from(new Set([
        ...Object.keys(groupedByLocation),
        ...Object.keys(singlesByLoc).filter(loc => (singlesByLoc[loc] || []).some(matchSingle)),
        ...Object.keys(slabsByLoc).filter(loc => (slabsByLoc[loc] || []).some(matchSlab)),
      ]))
        .filter(loc => !selectedLocName || loc === selectedLocName)
        .sort((a, b) => a.localeCompare(b))
    : Object.keys(groupedByLocation)

  // Calculate totals
  const totalValue = filteredInventory.reduce((sum, inv) => 
    sum + (inv.quantity * (inv.avg_cost_basis || 0)), 0
  )
  const totalItems = filteredInventory.reduce((sum, inv) => sum + inv.quantity, 0)

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
          <Eye className="text-slate-400" />
          View Inventory
        </h1>
        <p className="text-gray-400 mt-1">View sealed product inventory across all locations</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">View and manage inventory:</p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><span className="text-vault-gold">Filter</span> by location, brand, or type</li>
            <li><span className="text-vault-gold">Search</span> a card name, cert #, or TCG ID to see which location it's at (covers sealed, singles & slabs). Card search stays within the selected Location, but ignores the Brand / Market / Sealed filters.</li>
            <li>See <span className="text-vault-gold">quantity</span> and <span className="text-vault-gold">cost basis</span> per item</li>
            <li>Click <span className="text-vault-gold">Edit</span> to adjust quantities directly</li>
            <li>Click <span className="text-vault-gold">Delete</span> to remove a line item</li>
          </ul>
          <p className="text-slate-400 text-xs mt-3">💡 Inventory is grouped by location</p>
        </div>
      </Instructions>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Location</label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
            >
              <option value="">All Locations</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Brand</label>
            <select
              value={filters.brand}
              onChange={(e) => setFilters(f => ({ ...f, brand: e.target.value }))}
            >
              <option value="">All Brands</option>
              <option value="Pokemon">Pokemon</option>
              <option value="One Piece">One Piece</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Language / market filter — JP vs EN vs CN. Asked for explicitly:
              owner often wants to look at one market's stock at a time. */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Language / Market</label>
            <select
              value={filters.language}
              onChange={(e) => setFilters(f => ({ ...f, language: e.target.value }))}
            >
              <option value="">All Markets</option>
              <option value="JP">🇯🇵 JP — Japan</option>
              <option value="EN">🇺🇸 EN — US/English</option>
              <option value="CN">🇨🇳 CN — China</option>
              <option value="KR">🇰🇷 KR — Korea</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Sealed/Unsealed</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters(f => ({ ...f, type: e.target.value }))}
            >
              <option value="">All</option>
              <option value="Sealed">Sealed</option>
              <option value="Pack">Pack (Unsealed)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name / cert # / TCG ID — sealed, singles & slabs"
                className="pl-10"
              />
            </div>
          </div>
        </div>
        {searching && (filters.brand || filters.type || filters.language) && (
          <p className="text-amber-300/80 text-xs mt-3">
            ⚠ Card search scans every single &amp; slab to locate the physical card — it ignores the Brand / Market / Sealed filters above. Clear the search to apply those filters.
          </p>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-gray-400 text-sm">Total Items</p>
          <p className="text-2xl font-bold text-white">{totalItems.toLocaleString()}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-sm">Total Value</p>
          <p className="text-2xl font-bold text-vault-gold">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-sm">Locations</p>
          <p className="text-2xl font-bold text-white">{locationNames.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-sm">SKUs</p>
          <p className="text-2xl font-bold text-white">{filteredInventory.length}</p>
        </div>
      </div>

      {/* Inventory by Location */}
      {locationNames.map((locationName) => {
        const items = groupedByLocation[locationName] || []
        const locationTotal = items.reduce((sum, inv) => sum + (inv.quantity * (inv.avg_cost_basis || 0)), 0)
        const locationItems = items.reduce((sum, inv) => sum + inv.quantity, 0)
        const locSingles = singlesForLoc(locationName)
        const locSlabs = slabsForLoc(locationName)
        const cardCount = locSingles.length + locSlabs.length

        return (
          <div key={locationName} className="card mb-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <Package className="text-vault-gold" size={20} />
                <h2 className="font-display text-lg font-semibold text-white">
                  {locationName}
                </h2>
                {items.length > 0
                  ? <span className="text-gray-400 text-sm">({locationItems} sealed{cardCount > 0 ? ` · ${cardCount} card${cardCount === 1 ? '' : 's'}` : ''})</span>
                  : <span className="text-gray-400 text-sm">({cardCount} card{cardCount === 1 ? '' : 's'})</span>}
                {items.length > 0 && <span className="text-gray-600 text-xs">· all values in USD</span>}
              </div>
              {items.length > 0 && (
                <span className="text-vault-gold font-semibold">
                  ${locationTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>

            {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gray-400 text-sm border-b border-vault-border">
                    <th className="pb-3 font-medium cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('launchName')}>
                      LAUNCH NAME<SortArrow field="launchName" />
                    </th>
                    <th className="pb-3 font-medium cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('brand')}>
                      BRAND<SortArrow field="brand" />
                    </th>
                    <th className="pb-3 font-medium cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('productType')}>
                      PRODUCT TYPE<SortArrow field="productType" />
                    </th>
                    <th className="pb-3 font-medium cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('sealed')}>
                      SEALED<SortArrow field="sealed" />
                    </th>
                    <th className="pb-3 font-medium cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('language')}>
                      LANG<SortArrow field="language" />
                    </th>
                    <th className="pb-3 font-medium text-right cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('qty')}>
                      QTY<SortArrow field="qty" />
                    </th>
                    <th className="pb-3 font-medium text-right cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('avgCost')}>
                      AVG COST<SortArrow field="avgCost" />
                    </th>
                    <th className="pb-3 font-medium text-right cursor-pointer select-none hover:text-white transition-colors" onClick={() => handleSort('totalValue')}>
                      TOTAL VALUE<SortArrow field="totalValue" />
                    </th>
                    <th className="pb-3 font-medium text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vault-border">
                  {sortItems(items).map(inv => {
                    const isEditing = editingId === inv.id
                    const launchName = extractLaunchName(inv.product?.name, inv.product?.category)

                    return (
                      <tr key={inv.id} className="hover:bg-vault-dark/50">
                        <td className="py-3 font-medium text-white">{launchName}</td>
                        <td className="py-3">
                          <span className={`badge ${
                            inv.product?.brand === 'Pokemon' ? 'badge-warning' : 
                            inv.product?.brand === 'One Piece' ? 'badge-info' : 
                            'badge-secondary'
                          }`}>
                            {inv.product?.brand}
                          </span>
                        </td>
                        <td className="py-3 text-gray-300">{inv.product?.category || '-'}</td>
                        <td className="py-3 text-gray-400">{inv.product?.type}</td>
                        <td className="py-3 text-gray-400">{inv.product?.language}</td>
                        <td className="py-3 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editForm.quantity}
                              onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                              className="w-20 text-right py-1 px-2 text-sm"
                              min="0"
                            />
                          ) : (
                            <span className="font-medium">{inv.quantity}</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {isEditing ? (
                            <div className="flex flex-col items-end gap-1">
                              <input
                                type="number"
                                value={editForm.avg_cost_basis}
                                onChange={(e) => setEditForm(f => ({ ...f, avg_cost_basis: e.target.value }))}
                                className="w-24 text-right py-1 px-2 text-sm"
                                min="0"
                                step="0.01"
                              />
                              {/* Default ON — most edits should propagate so all
                                  locations show the same cost for the same SKU. */}
                              <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer select-none whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={editForm.applyToAll}
                                  onChange={(e) => setEditForm(f => ({ ...f, applyToAll: e.target.checked }))}
                                  className="w-3 h-3 accent-vault-gold"
                                />
                                Apply to all locations
                              </label>
                            </div>
                          ) : (
                            <span className="text-gray-400">${inv.avg_cost_basis?.toFixed(2) || '0.00'}</span>
                          )}
                        </td>
                        <td className="py-3 text-right text-vault-gold font-medium">
                          ${(inv.quantity * (inv.avg_cost_basis || 0)).toFixed(2)}
                        </td>
                        <td className="py-3 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => saveEdit(inv.id)}
                                className="p-1 text-green-400 hover:text-green-300"
                                title="Save"
                              >
                                <Save size={16} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="p-1 text-gray-400 hover:text-white"
                                title="Cancel"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => startEdit(inv)}
                                className="p-1 text-gray-500 hover:text-white"
                                title="Edit"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => deleteInventory(inv.id)}
                                className="p-1 text-gray-500 hover:text-red-400"
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )}

            {/* Collapsible sub-sections — singles + slabs at this location.
                Default collapsed so the sealed view stays the main story;
                staff click to expand when they want to see what cards are
                physically here. While a search is active they're filtered
                to matches and force-expanded so the found card is visible. */}
            <LocationCardsSubSections
              locationName={locationName}
              singles={locSingles}
              slabs={locSlabs}
              expandedSingles={searching || expandedSingles.has(locationName)}
              expandedSlabs={searching || expandedSlabs.has(locationName)}
              onToggleSingles={() => toggleSingles(locationName)}
              onToggleSlabs={() => toggleSlabs(locationName)}
            />
          </div>
        )
      })}

      {locationNames.length === 0 && (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">{searching ? `Nothing matches "${searchTerm.trim()}"` : 'No inventory found'}</p>
        </div>
      )}
    </div>
  )
}

// Two collapsible sub-sections rendered inside each location card —
// 🎴 Singles at {loc} and 💎 Slabs at {loc}. Default collapsed so the
// sealed view stays the headline; the count next to each header tells
// staff at a glance how many cards are at that location.
function LocationCardsSubSections({
  locationName, singles, slabs,
  expandedSingles, expandedSlabs,
  onToggleSingles, onToggleSlabs,
}) {
  const hasSingles = singles.length > 0
  const hasSlabs = slabs.length > 0
  if (!hasSingles && !hasSlabs) return null
  return (
    <div className="mt-4 space-y-2 border-t border-vault-border/50 pt-3">
      {hasSingles && (
        <div className="rounded-lg border border-vault-border/50 bg-vault-darker/30">
          <button
            type="button"
            onClick={onToggleSingles}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-vault-darker/50 rounded-lg"
          >
            <span className="flex items-center gap-2 text-blue-300">
              <Layers size={14} />
              <span className="font-medium">Singles at {locationName}</span>
              <span className="text-xs text-gray-500">
                ({singles.length} card{singles.length === 1 ? '' : 's'},
                {' '}{singles.reduce((s, r) => s + (Number(r.quantity) || 1), 0)} units)
              </span>
            </span>
            {expandedSingles ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
          </button>
          {expandedSingles && (
            <div className="px-3 pb-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs border-b border-vault-border/50">
                    <th className="py-2 font-medium">CARD</th>
                    <th className="py-2 font-medium">SET</th>
                    <th className="py-2 font-medium">CONDITION</th>
                    <th className="py-2 font-medium text-right">QTY</th>
                    <th className="py-2 font-medium text-right">MARKET</th>
                    <th className="py-2 font-medium">TCG ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vault-border/30">
                  {singles
                    .slice()
                    .sort((a, b) => (Number(b.current_market_price_usd) || 0) - (Number(a.current_market_price_usd) || 0))
                    .map(s => (
                      <tr key={s.id} className="hover:bg-vault-dark/30">
                        <td className="py-1.5 text-white">
                          {s.card_name}{s.card_number ? ` #${s.card_number}` : ''}
                        </td>
                        <td className="py-1.5 text-gray-400">{s.set?.name || '—'}</td>
                        <td className="py-1.5 text-gray-400">{s.condition || '—'}</td>
                        <td className="py-1.5 text-right text-gray-300">{s.quantity || 1}</td>
                        <td className="py-1.5 text-right text-gray-300">
                          {s.current_market_price_usd != null ? `$${Number(s.current_market_price_usd).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-1.5 text-gray-500 text-xs">{s.tcg_id || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {hasSlabs && (
        <div className="rounded-lg border border-vault-border/50 bg-vault-darker/30">
          <button
            type="button"
            onClick={onToggleSlabs}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-vault-darker/50 rounded-lg"
          >
            <span className="flex items-center gap-2 text-emerald-300">
              <Diamond size={14} />
              <span className="font-medium">Slabs at {locationName}</span>
              <span className="text-xs text-gray-500">({slabs.length})</span>
            </span>
            {expandedSlabs ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
          </button>
          {expandedSlabs && (
            <div className="px-3 pb-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs border-b border-vault-border/50">
                    <th className="py-2 font-medium">ITEM</th>
                    <th className="py-2 font-medium">GRADE</th>
                    <th className="py-2 font-medium">CERT #</th>
                    <th className="py-2 font-medium text-right">MARKET</th>
                    <th className="py-2 font-medium text-right">LV</th>
                    <th className="py-2 font-medium">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vault-border/30">
                  {slabs
                    .slice()
                    .sort((a, b) => (Number(b.market_price_usd) || 0) - (Number(a.market_price_usd) || 0))
                    .map(s => (
                      <tr key={s.id} className="hover:bg-vault-dark/30">
                        <td className="py-1.5 text-white max-w-md" title={s.item_name}>
                          <div className="truncate">
                            {s.item_name}
                            {s.sheet_bin && (
                              <span className="ml-2 text-[11px] text-cyan-300/80" title={`Sheet location / bin: ${s.sheet_bin}`}>📍 {s.sheet_bin}</span>
                            )}
                          </div>
                          {s.sheet_note && (
                            <div className="text-[11px] text-amber-300/80 truncate" title={s.sheet_note}>📝 {s.sheet_note}</div>
                          )}
                        </td>
                        <td className="py-1.5 text-gray-400">{s.grading_company || '—'}</td>
                        <td className="py-1.5 text-gray-500 text-xs">{s.cert_number || '—'}</td>
                        <td className="py-1.5 text-right text-gray-300">
                          {s.market_price_usd != null ? `$${Number(s.market_price_usd).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-1.5 text-right text-gray-300">
                          {s.lv_price_usd != null ? `$${Number(s.lv_price_usd).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-1.5 text-gray-400">{s.status}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
