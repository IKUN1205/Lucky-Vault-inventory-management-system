import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { DollarSign, Save, Upload, AlertCircle, Check, Plus } from 'lucide-react'

// Channel configurations
const PLATFORMS = {
  eBay: {
    channels: ['LuckyVaultUS', 'SlabbiePatty'],
    level: 'session'
  },
  TikTok: {
    channels: ['RocketsHQ'],
    level: 'item'
  },
  Whatnot: {
    channels: ['Rockets'],
    level: 'session',
    productTypes: ['Slabs', 'Singles', 'Nullifying Zero', 'Other']
  }
}

export default function PlatformSales() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [platform, setPlatform] = useState('eBay')
  const [users, setUsers] = useState([])
  const [products, setProducts] = useState([])
  const [aliases, setAliases] = useState([])
  const [recentSales, setRecentSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showCsvUpload, setShowCsvUpload] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState(null)

  // eBay/Whatnot form (session-level)
  const [sessionForm, setSessionForm] = useState({
    date: new Date().toISOString().split('T')[0],
    channel: '',
    streamer_id: '',
    order_count: '',
    gross_sales: '',
    net_sales: '',
    profit: '',
    margin_percent: '',
    stream_hours: '',
    product_type: '', // Whatnot only
    notes: ''
  })

  // TikTok form (item-level)
  const [itemForm, setItemForm] = useState({
    date: new Date().toISOString().split('T')[0],
    external_product_name: '',
    product_id: '',
    quantity: '',
    net_sales: '',
    net_income: '',
    cost: '',
    profit: '',
    margin_percent: '',
    shipping: '',
    streamer_id: '',
    notes: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    // Reset channel when platform changes
    setSessionForm(f => ({ ...f, channel: PLATFORMS[platform].channels[0] }))
    loadRecentSales()
  }, [platform])

  const loadData = async () => {
    try {
      const [usersRes, productsRes, aliasesRes] = await Promise.all([
        supabase.from('users').select('*').eq('active', true).order('name'),
        supabase.from('products').select('*').eq('active', true).order('name'),
        supabase.from('product_aliases').select('*, product:products(name, brand)').order('external_name')
      ])
      
      setUsers(usersRes.data || [])
      setProducts(productsRes.data || [])
      setAliases(aliasesRes.data || [])
      setSessionForm(f => ({ ...f, channel: PLATFORMS.eBay.channels[0] }))
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadRecentSales = async () => {
    try {
      const { data } = await supabase
        .from('platform_sales')
        .select('*, streamer:users(name), product:products(name)')
        .eq('platform', platform)
        .eq('deleted', false)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20)
      
      setRecentSales(data || [])
    } catch (error) {
      console.error('Error loading recent sales:', error)
    }
  }

  // Check for duplicate entry
  const checkDuplicate = async (data) => {
    if (platform === 'TikTok') {
      // For TikTok, check date + product + streamer
      const { data: existing } = await supabase
        .from('platform_sales')
        .select('id')
        .eq('platform', 'TikTok')
        .eq('date', data.date)
        .eq('external_product_name', data.external_product_name)
        .eq('streamer_id', data.streamer_id)
        .eq('deleted', false)
        .single()
      return existing
    } else {
      // For eBay/Whatnot, check date + channel + streamer
      const { data: existing } = await supabase
        .from('platform_sales')
        .select('id')
        .eq('platform', platform)
        .eq('date', data.date)
        .eq('channel', data.channel)
        .eq('streamer_id', data.streamer_id)
        .eq('deleted', false)
        .single()
      return existing
    }
  }

  // Handle session form submit (eBay/Whatnot)
  const handleSessionSubmit = async (e) => {
    e.preventDefault()
    
    if (!sessionForm.streamer_id) {
      addToast('Please select a streamer', 'error')
      return
    }

    setSubmitting(true)
    setDuplicateWarning(null)

    try {
      // Check for duplicate
      const duplicate = await checkDuplicate(sessionForm)
      if (duplicate) {
        setDuplicateWarning({
          id: duplicate.id,
          message: `Entry already exists for ${sessionForm.date} - ${sessionForm.channel} - ${users.find(u => u.id === sessionForm.streamer_id)?.name}`
        })
        setSubmitting(false)
        return
      }

      const hourlyNet = sessionForm.net_sales && sessionForm.stream_hours 
        ? parseFloat(sessionForm.net_sales) / parseFloat(sessionForm.stream_hours)
        : null

      const { error } = await supabase.from('platform_sales').insert({
        platform,
        channel: sessionForm.channel,
        date: sessionForm.date,
        streamer_id: sessionForm.streamer_id,
        order_count: parseInt(sessionForm.order_count) || null,
        gross_sales: parseFloat(sessionForm.gross_sales) || null,
        net_sales: parseFloat(sessionForm.net_sales) || null,
        profit: parseFloat(sessionForm.profit) || null,
        margin_percent: parseFloat(sessionForm.margin_percent) || null,
        stream_hours: parseFloat(sessionForm.stream_hours) || null,
        hourly_net: hourlyNet,
        product_type: sessionForm.product_type || null,
        notes: sessionForm.notes || null
      })

      if (error) throw error

      addToast('Sale entry saved!')
      setSessionForm(f => ({
        ...f,
        streamer_id: '',
        order_count: '',
        gross_sales: '',
        net_sales: '',
        profit: '',
        margin_percent: '',
        stream_hours: '',
        product_type: '',
        notes: ''
      }))
      loadRecentSales()
    } catch (error) {
      console.error('Error saving sale:', error)
      addToast('Failed to save sale', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle item form submit (TikTok)
  const handleItemSubmit = async (e) => {
    e.preventDefault()
    
    if (!itemForm.external_product_name) {
      addToast('Please enter a product name', 'error')
      return
    }
    if (!itemForm.streamer_id) {
      addToast('Please select a seller', 'error')
      return
    }

    setSubmitting(true)
    setDuplicateWarning(null)

    try {
      // Check for duplicate
      const duplicate = await checkDuplicate(itemForm)
      if (duplicate) {
        setDuplicateWarning({
          id: duplicate.id,
          message: `Entry already exists for ${itemForm.date} - ${itemForm.external_product_name} - ${users.find(u => u.id === itemForm.streamer_id)?.name}`
        })
        setSubmitting(false)
        return
      }

      // Try to find product mapping
      let productId = itemForm.product_id || null
      if (!productId) {
        const alias = aliases.find(a => 
          a.external_name.toLowerCase() === itemForm.external_product_name.toLowerCase()
        )
        if (alias) {
          productId = alias.product_id
        }
      }

      // If product mapped, ensure it exists in inventory history
      if (productId) {
        // Check if product has any inventory record
        const { data: invRecord } = await supabase
          .from('inventory')
          .select('id')
          .eq('product_id', productId)
          .limit(1)
          .single()
        
        // If no inventory record, create one with qty 0 for history
        if (!invRecord) {
          // Get a default location (Master Inventory or first location)
          const { data: locations } = await supabase
            .from('locations')
            .select('id')
            .eq('name', 'Master Inventory')
            .single()
          
          if (locations) {
            await supabase.from('inventory').insert({
              product_id: productId,
              location_id: locations.id,
              quantity: 0,
              avg_cost_basis: null
            })
          }
        }
      }

      const { error } = await supabase.from('platform_sales').insert({
        platform: 'TikTok',
        channel: 'RocketsHQ',
        date: itemForm.date,
        streamer_id: itemForm.streamer_id,
        external_product_name: itemForm.external_product_name,
        product_id: productId,
        quantity: parseInt(itemForm.quantity) || null,
        net_sales: parseFloat(itemForm.net_sales) || null,
        net_income: parseFloat(itemForm.net_income) || null,
        cost: parseFloat(itemForm.cost) || null,
        profit: parseFloat(itemForm.profit) || null,
        margin_percent: parseFloat(itemForm.margin_percent) || null,
        shipping: parseFloat(itemForm.shipping) || null,
        notes: itemForm.notes || null
      })

      if (error) throw error

      addToast('TikTok sale saved!')
      setItemForm(f => ({
        ...f,
        external_product_name: '',
        product_id: '',
        quantity: '',
        net_sales: '',
        net_income: '',
        cost: '',
        profit: '',
        margin_percent: '',
        shipping: '',
        notes: ''
      }))
      loadRecentSales()
    } catch (error) {
      console.error('Error saving sale:', error)
      addToast('Failed to save sale', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Update existing entry (for duplicate override)
  const handleUpdateExisting = async () => {
    if (!duplicateWarning?.id) return
    
    setSubmitting(true)
    try {
      const formData = platform === 'TikTok' ? itemForm : sessionForm
      const hourlyNet = formData.net_sales && formData.stream_hours 
        ? parseFloat(formData.net_sales) / parseFloat(formData.stream_hours)
        : null

      const updateData = platform === 'TikTok' ? {
        external_product_name: itemForm.external_product_name,
        product_id: itemForm.product_id || null,
        quantity: parseInt(itemForm.quantity) || null,
        net_sales: parseFloat(itemForm.net_sales) || null,
        net_income: parseFloat(itemForm.net_income) || null,
        cost: parseFloat(itemForm.cost) || null,
        profit: parseFloat(itemForm.profit) || null,
        margin_percent: parseFloat(itemForm.margin_percent) || null,
        shipping: parseFloat(itemForm.shipping) || null,
        notes: itemForm.notes || null
      } : {
        order_count: parseInt(sessionForm.order_count) || null,
        gross_sales: parseFloat(sessionForm.gross_sales) || null,
        net_sales: parseFloat(sessionForm.net_sales) || null,
        profit: parseFloat(sessionForm.profit) || null,
        margin_percent: parseFloat(sessionForm.margin_percent) || null,
        stream_hours: parseFloat(sessionForm.stream_hours) || null,
        hourly_net: hourlyNet,
        product_type: sessionForm.product_type || null,
        notes: sessionForm.notes || null
      }

      const { error } = await supabase
        .from('platform_sales')
        .update(updateData)
        .eq('id', duplicateWarning.id)

      if (error) throw error

      addToast('Entry updated!')
      setDuplicateWarning(null)
      
      // Reset form
      if (platform === 'TikTok') {
        setItemForm(f => ({
          ...f,
          external_product_name: '',
          product_id: '',
          quantity: '',
          net_sales: '',
          net_income: '',
          cost: '',
          profit: '',
          margin_percent: '',
          shipping: '',
          notes: ''
        }))
      } else {
        setSessionForm(f => ({
          ...f,
          streamer_id: '',
          order_count: '',
          gross_sales: '',
          net_sales: '',
          profit: '',
          margin_percent: '',
          stream_hours: '',
          product_type: '',
          notes: ''
        }))
      }
      loadRecentSales()
    } catch (error) {
      console.error('Error updating sale:', error)
      addToast('Failed to update sale', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Auto-calculate fields for TikTok
  const handleItemFormChange = (e) => {
    const { name, value } = e.target
    setItemForm(f => {
      const updated = { ...f, [name]: value }
      
      // Auto-calc profit
      if (name === 'net_income' || name === 'cost') {
        const netIncome = parseFloat(name === 'net_income' ? value : f.net_income) || 0
        const cost = parseFloat(name === 'cost' ? value : f.cost) || 0
        if (netIncome && cost) {
          updated.profit = (netIncome - cost).toFixed(2)
          updated.margin_percent = ((netIncome - cost) / netIncome * 100).toFixed(2)
        }
      }
      
      return updated
    })
  }

  // Auto-calculate hourly net for session forms
  const handleSessionFormChange = (e) => {
    const { name, value } = e.target
    setSessionForm(f => ({ ...f, [name]: value }))
  }

  // Calculate hourly net display
  const hourlyNetPreview = sessionForm.net_sales && sessionForm.stream_hours
    ? (parseFloat(sessionForm.net_sales) / parseFloat(sessionForm.stream_hours)).toFixed(2)
    : null

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
          <DollarSign className="text-green-400" />
          Platform Sales
        </h1>
        <p className="text-gray-400 mt-1">Log revenue from streaming platforms</p>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-2 mb-6">
        {Object.keys(PLATFORMS).map(p => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              platform === p
                ? 'bg-vault-gold text-vault-dark'
                : 'bg-vault-surface text-gray-400 hover:text-white'
            }`}
          >
            {p}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setShowCsvUpload(!showCsvUpload)}
          className="btn btn-secondary"
        >
          <Upload size={18} /> CSV Upload
        </button>
      </div>

      {/* Duplicate Warning */}
      {duplicateWarning && (
        <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-yellow-400" />
            <span className="text-yellow-200">{duplicateWarning.message}</span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleUpdateExisting}
              className="btn btn-primary text-sm py-1"
              disabled={submitting}
            >
              Update Existing
            </button>
            <button 
              onClick={() => setDuplicateWarning(null)}
              className="btn btn-secondary text-sm py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Entry Form */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4">
            {platform === 'TikTok' ? 'Item Entry' : 'Session Entry'}
          </h2>

          {platform === 'TikTok' ? (
            /* TikTok Item-Level Form */
            <form onSubmit={handleItemSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
                  <input
                    type="date"
                    name="date"
                    value={itemForm.date}
                    onChange={handleItemFormChange}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Seller *</label>
                  <select
                    name="streamer_id"
                    value={itemForm.streamer_id}
                    onChange={handleItemFormChange}
                    required
                  >
                    <option value="">Select seller...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Product Name *</label>
                <input
                  type="text"
                  name="external_product_name"
                  value={itemForm.external_product_name}
                  onChange={handleItemFormChange}
                  placeholder="e.g., Pokemon - MEGA Dream ex Booster Box - Japanese"
                  required
                />
                {itemForm.external_product_name && aliases.find(a => 
                  a.external_name.toLowerCase() === itemForm.external_product_name.toLowerCase()
                ) && (
                  <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                    <Check size={12} /> Mapped to: {aliases.find(a => 
                      a.external_name.toLowerCase() === itemForm.external_product_name.toLowerCase()
                    )?.product?.name}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Quantity</label>
                  <input
                    type="number"
                    name="quantity"
                    value={itemForm.quantity}
                    onChange={handleItemFormChange}
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Net Sales ($)</label>
                  <input
                    type="number"
                    name="net_sales"
                    value={itemForm.net_sales}
                    onChange={handleItemFormChange}
                    step="0.01"
                    placeholder="799.46"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Net Income ($)</label>
                  <input
                    type="number"
                    name="net_income"
                    value={itemForm.net_income}
                    onChange={handleItemFormChange}
                    step="0.01"
                    placeholder="751.49"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Cost ($)</label>
                  <input
                    type="number"
                    name="cost"
                    value={itemForm.cost}
                    onChange={handleItemFormChange}
                    step="0.01"
                    placeholder="639.57"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Profit ($)</label>
                  <input
                    type="number"
                    name="profit"
                    value={itemForm.profit}
                    onChange={handleItemFormChange}
                    step="0.01"
                    placeholder="Auto-calc"
                    className="bg-vault-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Margin %</label>
                  <input
                    type="number"
                    name="margin_percent"
                    value={itemForm.margin_percent}
                    onChange={handleItemFormChange}
                    step="0.01"
                    placeholder="Auto-calc"
                    className="bg-vault-dark"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
                <input
                  type="text"
                  name="notes"
                  value={itemForm.notes}
                  onChange={handleItemFormChange}
                  placeholder="Optional notes..."
                />
              </div>

              <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={18} /> Save Entry</>}
              </button>
            </form>
          ) : (
            /* eBay/Whatnot Session-Level Form */
            <form onSubmit={handleSessionSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
                  <input
                    type="date"
                    name="date"
                    value={sessionForm.date}
                    onChange={handleSessionFormChange}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Channel *</label>
                  <select
                    name="channel"
                    value={sessionForm.channel}
                    onChange={handleSessionFormChange}
                    required
                  >
                    {PLATFORMS[platform].channels.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Streamer *</label>
                  <select
                    name="streamer_id"
                    value={sessionForm.streamer_id}
                    onChange={handleSessionFormChange}
                    required
                  >
                    <option value="">Select streamer...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                {platform === 'Whatnot' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Product Type</label>
                    <select
                      name="product_type"
                      value={sessionForm.product_type}
                      onChange={handleSessionFormChange}
                    >
                      <option value="">Select type...</option>
                      {PLATFORMS.Whatnot.productTypes.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                )}
                {platform === 'eBay' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Order Count</label>
                    <input
                      type="number"
                      name="order_count"
                      value={sessionForm.order_count}
                      onChange={handleSessionFormChange}
                      min="0"
                      placeholder="141"
                    />
                  </div>
                )}
              </div>

              {platform === 'Whatnot' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Order Count</label>
                  <input
                    type="number"
                    name="order_count"
                    value={sessionForm.order_count}
                    onChange={handleSessionFormChange}
                    min="0"
                    placeholder="277"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Gross Sales ($)</label>
                  <input
                    type="number"
                    name="gross_sales"
                    value={sessionForm.gross_sales}
                    onChange={handleSessionFormChange}
                    step="0.01"
                    placeholder="5387.82"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Net Sales ($)</label>
                  <input
                    type="number"
                    name="net_sales"
                    value={sessionForm.net_sales}
                    onChange={handleSessionFormChange}
                    step="0.01"
                    placeholder="4750.32"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Profit ($)</label>
                  <input
                    type="number"
                    name="profit"
                    value={sessionForm.profit}
                    onChange={handleSessionFormChange}
                    step="0.01"
                    placeholder="712.55"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Margin %</label>
                  <input
                    type="number"
                    name="margin_percent"
                    value={sessionForm.margin_percent}
                    onChange={handleSessionFormChange}
                    step="0.01"
                    placeholder="13.53"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Stream Hours</label>
                  <input
                    type="number"
                    name="stream_hours"
                    value={sessionForm.stream_hours}
                    onChange={handleSessionFormChange}
                    step="0.01"
                    placeholder="6.42"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Hourly Net</label>
                  <div className="px-3 py-2 bg-vault-dark border border-vault-border rounded-lg text-gray-400">
                    {hourlyNetPreview ? `$${hourlyNetPreview}` : 'Auto-calculated'}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
                <input
                  type="text"
                  name="notes"
                  value={sessionForm.notes}
                  onChange={handleSessionFormChange}
                  placeholder="Optional notes..."
                />
              </div>

              <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Save size={18} /> Save Entry</>}
              </button>
            </form>
          )}
        </div>

        {/* Recent Entries */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4">
            Recent {platform} Entries
          </h2>
          
          {recentSales.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No entries yet</p>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="text-sm">
                <thead className="sticky top-0 bg-vault-surface">
                  <tr>
                    <th>Date</th>
                    {platform === 'TikTok' ? (
                      <>
                        <th>Product</th>
                        <th>Seller</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Net Income</th>
                      </>
                    ) : (
                      <>
                        <th>Streamer</th>
                        {platform === 'Whatnot' && <th>Type</th>}
                        <th className="text-right">Orders</th>
                        <th className="text-right">Net Sales</th>
                        <th className="text-right">Profit</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map(sale => (
                    <tr key={sale.id}>
                      <td className="text-gray-400">{sale.date}</td>
                      {platform === 'TikTok' ? (
                        <>
                          <td className="text-white max-w-[200px] truncate" title={sale.external_product_name}>
                            {sale.external_product_name}
                          </td>
                          <td className="text-gray-300">{sale.streamer?.name}</td>
                          <td className="text-right">{sale.quantity}</td>
                          <td className="text-right text-green-400">${sale.net_income?.toFixed(2)}</td>
                        </>
                      ) : (
                        <>
                          <td className="text-white">{sale.streamer?.name}</td>
                          {platform === 'Whatnot' && <td className="text-gray-400">{sale.product_type}</td>}
                          <td className="text-right">{sale.order_count}</td>
                          <td className="text-right text-green-400">${sale.net_sales?.toFixed(2)}</td>
                          <td className="text-right text-vault-gold">${sale.profit?.toFixed(2)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* CSV Upload Modal */}
      {showCsvUpload && (
        <CsvUploadModal
          platform={platform}
          users={users}
          aliases={aliases}
          onClose={() => setShowCsvUpload(false)}
          onSuccess={() => { setShowCsvUpload(false); loadRecentSales(); }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// CSV Upload Modal Component
function CsvUploadModal({ platform, users, aliases, onClose, onSuccess, addToast }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState([])
  const [importing, setImporting] = useState(false)

  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    
    setFile(f)
    
    // Parse CSV preview
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target.result
      const lines = text.split('\n')
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
      
      const rows = []
      for (let i = 1; i < Math.min(lines.length, 11); i++) {
        if (!lines[i].trim()) continue
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''))
        const row = {}
        headers.forEach((h, idx) => {
          row[h] = values[idx]
        })
        rows.push(row)
      }
      setPreview(rows)
    }
    reader.readAsText(f)
  }

  const handleImport = async () => {
    if (!file) return
    
    setImporting(true)
    try {
      const reader = new FileReader()
      reader.onload = async (event) => {
        const text = event.target.result
        const lines = text.split('\n')
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
        
        let imported = 0
        let skipped = 0
        
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue
          
          const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''))
          const row = {}
          headers.forEach((h, idx) => {
            row[h] = values[idx]
          })
          
          // Map to database format based on platform
          try {
            // This is simplified - would need more robust mapping
            const entry = mapCsvRowToEntry(row, platform, users, aliases)
            if (entry) {
              const { error } = await supabase.from('platform_sales').insert(entry)
              if (!error) imported++
              else skipped++
            } else {
              skipped++
            }
          } catch (err) {
            skipped++
          }
        }
        
        addToast(`Imported ${imported} entries, skipped ${skipped}`)
        onSuccess()
      }
      reader.readAsText(file)
    } catch (error) {
      console.error('Import error:', error)
      addToast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-vault-surface border border-vault-border rounded-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-vault-border flex justify-between items-center">
          <h2 className="font-display text-lg font-semibold text-white">
            Upload {platform} CSV
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        
        <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Select CSV File</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full"
            />
          </div>
          
          {preview.length > 0 && (
            <div>
              <p className="text-sm text-gray-400 mb-2">Preview (first 10 rows):</p>
              <div className="overflow-x-auto bg-vault-dark rounded-lg p-2">
                <table className="text-xs">
                  <thead>
                    <tr>
                      {Object.keys(preview[0]).map(key => (
                        <th key={key} className="px-2 py-1 text-left">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="px-2 py-1 text-gray-300 max-w-[150px] truncate">{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-vault-border flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button 
            onClick={handleImport} 
            className="btn btn-primary"
            disabled={!file || importing}
          >
            {importing ? <div className="spinner w-4 h-4 border-2"></div> : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper to map CSV row to database entry
function mapCsvRowToEntry(row, platform, users, aliases) {
  // Find streamer by name
  const streamerName = row['Streamer'] || row['Seller'] || row['streamer'] || row['seller']
  const streamer = users.find(u => u.name.toLowerCase() === streamerName?.toLowerCase())
  
  // Parse date
  const dateStr = row['Date'] || row['date']
  const date = dateStr ? new Date(dateStr + '/2025').toISOString().split('T')[0] : null
  
  if (!date) return null
  
  if (platform === 'TikTok') {
    return {
      platform: 'TikTok',
      channel: 'RocketsHQ',
      date,
      streamer_id: streamer?.id || null,
      external_product_name: row['Product title'] || row['product'],
      quantity: parseInt(row['Quantity'] || row['quantity'] || row['Units']) || null,
      net_sales: parseFloat(row['Net sales']?.replace('$', '').replace(',', '')) || null,
      net_income: parseFloat(row['Net Income']?.replace('$', '').replace(',', '')) || null,
      cost: parseFloat(row['Cost']?.replace('$', '').replace(',', '')) || null,
      profit: parseFloat(row['Profit']?.replace('$', '').replace(',', '')) || null,
      margin_percent: parseFloat(row['Margin']?.replace('%', '')) || null,
      shipping: parseFloat(row['Shipping']?.replace('$', '').replace(',', '')) || null
    }
  } else if (platform === 'eBay') {
    return {
      platform: 'eBay',
      channel: row['Channel'] || 'LuckyVaultUS',
      date,
      streamer_id: streamer?.id || null,
      order_count: parseInt(row['Order Count'] || row['Orders']) || null,
      gross_sales: parseFloat(row['Total Sales']?.replace('$', '').replace(',', '') || row['Gross Sales']?.replace('$', '').replace(',', '')) || null,
      net_sales: parseFloat(row['Net sales']?.replace('$', '').replace(',', '') || row['Net Sales']?.replace('$', '').replace(',', '')) || null,
      profit: parseFloat(row['Profit']?.replace('$', '').replace(',', '')) || null,
      stream_hours: parseFloat(row['Stream Time'] || row['Stream Hours'] || row['Hours']) || null,
      hourly_net: parseFloat(row['Hourly Net Sales']?.replace('$', '').replace(',', '')) || null
    }
  } else if (platform === 'Whatnot') {
    return {
      platform: 'Whatnot',
      channel: 'Rockets',
      date,
      streamer_id: streamer?.id || null,
      product_type: row['Product Type'] || row['Type'] || null,
      order_count: parseInt(row['Order Count'] || row['Orders']) || null,
      gross_sales: parseFloat(row['Total Sales']?.replace('$', '').replace(',', '') || row['Gross']?.replace('$', '').replace(',', '')) || null,
      net_sales: parseFloat(row['Net sales']?.replace('$', '').replace(',', '') || row['Net']?.replace('$', '').replace(',', '')) || null,
      profit: parseFloat(row['Profit']?.replace('$', '').replace(',', '')) || null,
      margin_percent: parseFloat(row['Margin']?.replace('%', '')) || null,
      stream_hours: parseFloat(row['Stream Time'] || row['Hours']) || null,
      hourly_net: parseFloat(row['Hourly Net']?.replace('$', '').replace(',', '')) || null
    }
  }
  
  return null
}
