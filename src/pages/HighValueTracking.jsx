import React, { useState, useEffect } from 'react'
import { 
  fetchHighValueItems,
  fetchLocations,
  fetchVendors,
  fetchUsers,
  createHighValueItem,
  updateHighValueItemLocation,
  supabase
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Star, Plus, Save, X, ArrowRightLeft, Camera, Upload, TrendingUp, TrendingDown, Edit2 } from 'lucide-react'

// Grade options for dropdown
const GRADE_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
  { value: '7', label: '7' },
  { value: '8', label: '8' },
  { value: '9', label: '9' },
  { value: '10', label: '10' },
  { value: 'Pristine 10', label: 'Pristine 10' },
  { value: 'Black Label 10', label: 'Black Label 10' }
]

// Item type options
const ITEM_TYPES = [
  { value: 'Single', label: 'Single ($100+)' },
  { value: 'Slab $200-400', label: 'Slab ($200-400)' },
  { value: 'Slab $400+', label: 'Slab ($400+)' },
  { value: 'Other', label: 'Other' }
]

export default function HighValueTracking() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [items, setItems] = useState([])
  const [locations, setLocations] = useState([])
  const [vendors, setVendors] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showMoveModal, setShowMoveModal] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [itemsData, locData, vendorData, userData] = await Promise.all([
        fetchHighValueItems('In Inventory'),
        fetchLocations('Physical'),
        fetchVendors(),
        fetchUsers()
      ])
      setItems(itemsData)
      setLocations(locData)
      setVendors(vendorData)
      setUsers(userData)
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Calculate totals
  const totalPurchaseValue = items.reduce((sum, i) => sum + (i.purchase_price_usd || 0), 0)
  const totalMarketValue = items.reduce((sum, i) => sum + (i.current_market_price || i.purchase_price_usd || 0), 0)
  const profitLoss = totalMarketValue - totalPurchaseValue

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
      
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <Star className="text-yellow-400" />
            High Value Tracking
          </h1>
          <p className="text-gray-400 mt-1">$100+ singles and $200+ slabs</p>
        </div>
        
        <button onClick={() => setShowAddForm(true)} className="btn btn-primary">
          <Plus size={20} />
          Add Item
        </button>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Track high-value cards and slabs:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Click <span className="text-vault-gold">Add Item</span> to log a new high-value piece</li>
            <li>Enter <span className="text-vault-gold">card name, brand, grade</span> (if slab)</li>
            <li>Enter <span className="text-vault-gold">purchase price</span> and <span className="text-vault-gold">market price</span></li>
            <li>Upload a <span className="text-vault-gold">photo</span> (optional)</li>
            <li>Click <span className="text-vault-gold">Move</span> to transfer between locations</li>
          </ol>
          <p className="text-yellow-400 text-xs mt-3">💡 Update market prices regularly to track P&L</p>
        </div>
      </Instructions>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-gray-400 text-sm">Total Items</p>
          <p className="font-display text-2xl font-bold text-white">{items.length}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total Cost</p>
          <p className="font-display text-2xl font-bold text-vault-gold">
            ${totalPurchaseValue.toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Market Value</p>
          <p className="font-display text-2xl font-bold text-blue-400">
            ${totalMarketValue.toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Profit/Loss</p>
          <p className={`font-display text-2xl font-bold flex items-center gap-1 ${profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {profitLoss >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            ${Math.abs(profitLoss).toLocaleString()}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card text-center py-12">
          <Star className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">No high value items tracked yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(item => (
            <HighValueCard key={item.id} item={item} onMove={() => setShowMoveModal(item)} onUpdate={loadData} />
          ))}
        </div>
      )}

      {showAddForm && (
        <AddHighValueForm
          locations={locations}
          vendors={vendors}
          users={users}
          onClose={() => setShowAddForm(false)}
          onSuccess={() => { setShowAddForm(false); loadData(); addToast('High value item added!'); }}
          addToast={addToast}
        />
      )}

      {showMoveModal && (
        <MoveHighValueModal
          item={showMoveModal}
          locations={locations}
          onClose={() => setShowMoveModal(null)}
          onSuccess={() => { setShowMoveModal(null); loadData(); addToast('Item moved successfully!'); }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

function HighValueCard({ item, onMove, onUpdate }) {
  const [editingMarket, setEditingMarket] = useState(false)
  const [editingPaid, setEditingPaid] = useState(false)
  const [marketPrice, setMarketPrice] = useState(item.current_market_price || '')
  const [paidPrice, setPaidPrice] = useState(item.purchase_price_usd || '')

  const handleUpdateMarketPrice = async () => {
    try {
      await supabase
        .from('high_value_items')
        .update({ current_market_price: parseFloat(marketPrice) || null })
        .eq('id', item.id)
      setEditingMarket(false)
      onUpdate()
    } catch (error) {
      console.error('Error updating market price:', error)
    }
  }

  const handleUpdatePaidPrice = async () => {
    try {
      const newPrice = parseFloat(paidPrice) || null
      await supabase
        .from('high_value_items')
        .update({ 
          purchase_price: newPrice,
          purchase_price_usd: newPrice 
        })
        .eq('id', item.id)
      setEditingPaid(false)
      onUpdate()
    } catch (error) {
      console.error('Error updating paid price:', error)
    }
  }

  const priceDiff = (item.current_market_price || 0) - (item.purchase_price_usd || 0)
  const hasMarketPrice = item.current_market_price != null

  return (
    <div className="card border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-amber-600/5">
      {/* Square thumbnail with object-contain */}
      <div className="aspect-square bg-vault-dark rounded-lg mb-3 flex items-center justify-center overflow-hidden">
        {item.photo_url ? (
          <img src={item.photo_url} alt={item.card_name} className="w-full h-full object-contain" />
        ) : (
          <Camera className="text-gray-600" size={48} />
        )}
      </div>
      
      <div>
        <h3 className="font-display text-base font-semibold text-white mb-1 truncate">{item.card_name}</h3>
        
        <div className="flex items-center gap-2 mb-2">
          <span className={`badge text-xs ${item.brand === 'Pokemon' ? 'badge-warning' : item.brand === 'One Piece' ? 'badge-info' : 'badge-secondary'}`}>{item.brand}</span>
          <span className="text-gray-500 text-xs">{item.item_type}</span>
        </div>
        
        {item.grading_company && (
          <p className="text-gray-400 text-xs mb-2">{item.grading_company} {item.grade}</p>
        )}
        
        {/* Date */}
        <p className="text-gray-500 text-xs mb-3">Added: {item.date_added || 'N/A'}</p>
        
        {/* Pricing Section */}
        <div className="border-t border-vault-border pt-3 space-y-2">
          {/* Purchase Price - Editable */}
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-xs">Paid:</span>
            {editingPaid ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={paidPrice}
                  onChange={(e) => setPaidPrice(e.target.value)}
                  className="w-20 text-sm py-1 px-2"
                  placeholder="0"
                />
                <button onClick={handleUpdatePaidPrice} className="text-green-400 hover:text-green-300">
                  <Save size={14} />
                </button>
                <button onClick={() => setEditingPaid(false)} className="text-gray-400 hover:text-white">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-vault-gold font-semibold">
                  {item.purchase_price_usd ? `$${item.purchase_price_usd.toLocaleString()}` : '-'}
                </span>
                <button onClick={() => setEditingPaid(true)} className="text-gray-500 hover:text-white">
                  <Edit2 size={12} />
                </button>
              </div>
            )}
          </div>
          
          {/* Market Price - Editable */}
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-xs">Market:</span>
            {editingMarket ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={marketPrice}
                  onChange={(e) => setMarketPrice(e.target.value)}
                  className="w-20 text-sm py-1 px-2"
                  placeholder="0"
                />
                <button onClick={handleUpdateMarketPrice} className="text-green-400 hover:text-green-300">
                  <Save size={14} />
                </button>
                <button onClick={() => setEditingMarket(false)} className="text-gray-400 hover:text-white">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-blue-400 font-semibold">
                  {hasMarketPrice ? `$${item.current_market_price?.toLocaleString()}` : '-'}
                </span>
                <button onClick={() => setEditingMarket(true)} className="text-gray-500 hover:text-white">
                  <Edit2 size={12} />
                </button>
              </div>
            )}
          </div>
          
          {/* Profit/Loss */}
          {hasMarketPrice && item.purchase_price_usd && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-xs">P/L:</span>
              <span className={`font-semibold text-sm ${priceDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceDiff >= 0 ? '+' : ''}{priceDiff.toLocaleString()}
              </span>
            </div>
          )}
        </div>
        
        {/* Location & Move Button */}
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-vault-border">
          <p className="text-gray-500 text-xs truncate max-w-[60%]">{item.location?.name}</p>
          <button onClick={onMove} className="btn btn-secondary text-xs py-1 px-2">
            <ArrowRightLeft size={12} /> Move
          </button>
        </div>
      </div>
    </div>
  )
}

function AddHighValueForm({ locations, vendors, users, onClose, onSuccess, addToast }) {
  const [submitting, setSubmitting] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [form, setForm] = useState({
    card_name: '', 
    brand: 'Pokemon', 
    item_type: 'Slab $400+', 
    grading_company: '', 
    grade: '',
    purchase_price: '', 
    currency: 'USD', 
    current_market_price: '', 
    location_id: '', 
    acquirer_id: '', 
    vendor_id: '',
    date_added: new Date().toISOString().split('T')[0], 
    notes: ''
  })

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  const handlePhotoChange = (e) => {
    const file = e.target.files[0]
    if (file) { setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); }
  }

  const isSlab = form.item_type.includes('Slab')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      let photoUrl = null
      if (photoFile) {
        const fileName = `${Date.now()}-${photoFile.name}`
        const { error } = await supabase.storage.from('high-value-photos').upload(fileName, photoFile)
        if (!error) {
          const { data: urlData } = supabase.storage.from('high-value-photos').getPublicUrl(fileName)
          photoUrl = urlData.publicUrl
        }
      }
      
      const purchasePrice = form.purchase_price ? parseFloat(form.purchase_price) : null
      
      await createHighValueItem({
        card_name: form.card_name,
        brand: form.brand,
        item_type: form.item_type,
        grading_company: form.grading_company || null,
        grade: form.grade || null,
        purchase_price: purchasePrice,
        purchase_price_usd: purchasePrice,
        currency: form.currency,
        current_market_price: form.current_market_price ? parseFloat(form.current_market_price) : null,
        location_id: form.location_id,
        acquirer_id: form.acquirer_id || null,
        vendor_id: form.vendor_id || null,
        date_added: form.date_added,
        photo_url: photoUrl,
        status: 'In Inventory'
      })
      onSuccess()
    } catch (error) {
      console.error('Error adding item:', error)
      addToast('Failed to add item', 'error')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-vault-surface border border-vault-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-display text-xl font-semibold text-white">Add High Value Item</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Photo</label>
              <div className="border-2 border-dashed border-vault-border rounded-lg p-4 text-center">
                {photoPreview ? (
                  <div className="relative">
                    <img src={photoPreview} alt="Preview" className="max-h-40 mx-auto rounded" />
                    <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null); }} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1"><X size={16} /></button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <Upload className="mx-auto text-gray-500 mb-2" size={32} />
                    <span className="text-gray-400 text-sm">Click to upload photo</span>
                    <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                  </label>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">Card Name *</label>
                <input type="text" name="card_name" value={form.card_name} onChange={handleChange} placeholder="e.g., Charizard VMAX Alt Art" required />
              </div>
              
              {/* Date Added */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Date Added *</label>
                <input type="date" name="date_added" value={form.date_added} onChange={handleChange} required />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Brand *</label>
                <select name="brand" value={form.brand} onChange={handleChange} required>
                  <option value="Pokemon">Pokemon</option>
                  <option value="One Piece">One Piece</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              {/* Type with subheader */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1">Type *</label>
                <p className="text-xs text-gray-500 mb-2">Current Market Price</p>
                <select name="item_type" value={form.item_type} onChange={handleChange} required>
                  {ITEM_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              
              {/* Grading fields - show for all Slab types */}
              {isSlab && (<>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Grading Company</label>
                  <select name="grading_company" value={form.grading_company} onChange={handleChange}>
                    <option value="">Select...</option>
                    <option value="PSA">PSA</option>
                    <option value="CGC">CGC</option>
                    <option value="Beckett">Beckett</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Grade</label>
                  <select name="grade" value={form.grade} onChange={handleChange}>
                    <option value="">Select...</option>
                    {GRADE_OPTIONS.map(g => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </div>
              </>)}
              
              {/* Purchase Price - now optional */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Purchase Price</label>
                <input type="number" name="purchase_price" value={form.purchase_price} onChange={handleChange} min="0" step="0.01" placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Currency</label>
                <select name="currency" value={form.currency} onChange={handleChange}>
                  <option value="USD">USD</option>
                  <option value="JPY">JPY</option>
                  <option value="RMB">RMB</option>
                </select>
              </div>
              
              {/* Current Market Price */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">Current Market Price (USD)</label>
                <input type="number" name="current_market_price" value={form.current_market_price} onChange={handleChange} min="0" step="0.01" placeholder="Optional - for P/L tracking" />
              </div>
              
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">Location *</label>
                <select name="location_id" value={form.location_id} onChange={handleChange} required>
                  <option value="">Select location...</option>
                  {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                </select>
              </div>
              
              {/* Acquirer - optional */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Acquirer</label>
                <select name="acquirer_id" value={form.acquirer_id} onChange={handleChange}>
                  <option value="">Select...</option>
                  {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </div>
              
              {/* Vendor - optional */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Vendor</label>
                <select name="vendor_id" value={form.vendor_id} onChange={handleChange}>
                  <option value="">Select...</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
                {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={20} /> Add Item</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function MoveHighValueModal({ item, locations, onClose, onSuccess, addToast }) {
  const [submitting, setSubmitting] = useState(false)
  const [newLocationId, setNewLocationId] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!newLocationId) return
    setSubmitting(true)
    try {
      await updateHighValueItemLocation(item.id, newLocationId)
      onSuccess()
    } catch (error) {
      console.error('Error moving item:', error)
      addToast('Failed to move item', 'error')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-vault-surface border border-vault-border rounded-xl w-full max-w-md">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-display text-xl font-semibold text-white">Move Item</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
          </div>
          <div className="mb-4">
            <p className="text-white font-medium">{item.card_name}</p>
            <p className="text-gray-400 text-sm">Current: {item.location?.name}</p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Move To *</label>
              <select value={newLocationId} onChange={(e) => setNewLocationId(e.target.value)} required>
                <option value="">Select location...</option>
                {locations.filter(l => l.id !== item.location_id).map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="btn btn-secondary flex-1">Cancel</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={submitting || !newLocationId}>
                {submitting ? <div className="spinner w-5 h-5 border-2"></div> : 'Move'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
