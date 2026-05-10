import React, { useState, useEffect } from 'react'
import { fetchInventory, fetchLocations, supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Eye, Package, Search, Edit2, Save, X, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'

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
  const [editForm, setEditForm] = useState({ quantity: '', avg_cost_basis: '' })

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
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
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
      avg_cost_basis: inv.avg_cost_basis?.toString() || '0'
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({ quantity: '', avg_cost_basis: '' })
  }

  const saveEdit = async (invId) => {
    try {
      const { error } = await supabase
        .from('inventory')
        .update({
          quantity: parseInt(editForm.quantity) || 0,
          avg_cost_basis: parseFloat(editForm.avg_cost_basis) || 0
        })
        .eq('id', invId)

      if (error) throw error

      addToast('Inventory updated!')
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
            <li><span className="text-vault-gold">Search</span> by product name</li>
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
                placeholder="Search by launch name..."
                className="pl-10"
              />
            </div>
          </div>
        </div>
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
          <p className="text-2xl font-bold text-white">{Object.keys(groupedByLocation).length}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-400 text-sm">SKUs</p>
          <p className="text-2xl font-bold text-white">{filteredInventory.length}</p>
        </div>
      </div>

      {/* Inventory by Location */}
      {Object.entries(groupedByLocation).map(([locationName, items]) => {
        const locationTotal = items.reduce((sum, inv) => sum + (inv.quantity * (inv.avg_cost_basis || 0)), 0)
        const locationItems = items.reduce((sum, inv) => sum + inv.quantity, 0)

        return (
          <div key={locationName} className="card mb-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <Package className="text-vault-gold" size={20} />
                <h2 className="font-display text-lg font-semibold text-white">
                  {locationName}
                </h2>
                <span className="text-gray-400 text-sm">({locationItems} items)</span>
                <span className="text-gray-600 text-xs">· all values in USD</span>
              </div>
              <span className="text-vault-gold font-semibold">
                ${locationTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

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
                            <input
                              type="number"
                              value={editForm.avg_cost_basis}
                              onChange={(e) => setEditForm(f => ({ ...f, avg_cost_basis: e.target.value }))}
                              className="w-24 text-right py-1 px-2 text-sm"
                              min="0"
                              step="0.01"
                            />
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
          </div>
        )
      })}

      {filteredInventory.length === 0 && (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">No inventory found</p>
        </div>
      )}
    </div>
  )
}
