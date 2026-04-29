import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { Link2, Plus, Trash2, Search } from 'lucide-react'

export default function ProductMapping() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [aliases, setAliases] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  
  const [form, setForm] = useState({
    external_name: '',
    product_id: '',
    platform: ''
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [aliasesRes, productsRes] = await Promise.all([
        supabase
          .from('product_aliases')
          .select('*, product:products(id, name, brand, type, language)')
          .order('external_name'),
        supabase
          .from('products')
          .select('*')
          .eq('active', true)
          .order('brand')
          .order('name')
      ])
      
      setAliases(aliasesRes.data || [])
      setProducts(productsRes.data || [])
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.external_name.trim()) {
      addToast('Please enter an external name', 'error')
      return
    }
    if (!form.product_id) {
      addToast('Please select a product', 'error')
      return
    }

    setSubmitting(true)
    try {
      const { error } = await supabase.from('product_aliases').insert({
        external_name: form.external_name.trim(),
        product_id: form.product_id,
        platform: form.platform || null
      })

      if (error) {
        if (error.message.includes('duplicate')) {
          addToast('This mapping already exists', 'error')
        } else {
          throw error
        }
      } else {
        addToast('Mapping added!')
        setForm({ external_name: '', product_id: '', platform: '' })
        loadData()
      }
    } catch (error) {
      console.error('Error adding mapping:', error)
      addToast('Failed to add mapping', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this mapping?')) return
    
    try {
      const { error } = await supabase
        .from('product_aliases')
        .delete()
        .eq('id', id)
      
      if (error) throw error
      
      addToast('Mapping deleted')
      loadData()
    } catch (error) {
      console.error('Error deleting mapping:', error)
      addToast('Failed to delete mapping', 'error')
    }
  }

  const filteredAliases = aliases.filter(a => 
    a.external_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.product?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

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
          <Link2 className="text-purple-400" />
          Product Mapping
        </h1>
        <p className="text-gray-400 mt-1">Map external product names to your inventory</p>
      </div>

      {/* Add New Mapping */}
      <div className="card mb-6">
        <h2 className="font-display text-lg font-semibold text-white mb-4">Add New Mapping</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                External Product Name *
              </label>
              <input
                type="text"
                value={form.external_name}
                onChange={(e) => setForm(f => ({ ...f, external_name: e.target.value }))}
                placeholder="e.g., Pokemon - MEGA Dream ex Booster Box - Japanese"
                required
              />
              <p className="text-gray-500 text-xs mt-1">
                Copy/paste the exact name from TikTok or other platform reports
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Platform (optional)
              </label>
              <select
                value={form.platform}
                onChange={(e) => setForm(f => ({ ...f, platform: e.target.value }))}
              >
                <option value="">All Platforms</option>
                <option value="TikTok">TikTok</option>
                <option value="eBay">eBay</option>
                <option value="Whatnot">Whatnot</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Maps To (Your Inventory) *
            </label>
            <select
              value={form.product_id}
              onChange={(e) => setForm(f => ({ ...f, product_id: e.target.value }))}
              required
            >
              <option value="">Select product...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.brand} - {p.name} ({p.language})
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Plus size={18} /> Add Mapping</>}
          </button>
        </form>
      </div>

      {/* Existing Mappings */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-lg font-semibold text-white">
            Existing Mappings ({aliases.length})
          </h2>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search mappings..."
              className="pl-10"
            />
          </div>
        </div>

        {filteredAliases.length === 0 ? (
          <p className="text-gray-400 text-center py-8">
            {aliases.length === 0 ? 'No mappings yet. Add your first one above!' : 'No mappings match your search'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>External Name</th>
                  <th>Maps To</th>
                  <th>Platform</th>
                  <th className="w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredAliases.map(alias => (
                  <tr key={alias.id}>
                    <td className="text-gray-300 max-w-[300px]">
                      <div className="truncate" title={alias.external_name}>
                        {alias.external_name}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`badge ${
                          alias.product?.brand === 'Pokemon' ? 'badge-warning' :
                          alias.product?.brand === 'One Piece' ? 'badge-info' : 'badge-secondary'
                        }`}>
                          {alias.product?.brand}
                        </span>
                        <span className="text-white">{alias.product?.name}</span>
                        <span className="text-gray-500">({alias.product?.language})</span>
                      </div>
                    </td>
                    <td>
                      {alias.platform ? (
                        <span className="badge badge-secondary">{alias.platform}</span>
                      ) : (
                        <span className="text-gray-500">All</span>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(alias.id)}
                        className="p-1 text-gray-500 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Tips */}
      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <h3 className="text-blue-400 font-semibold mb-2">Tips for Mapping</h3>
        <ul className="text-gray-400 text-sm space-y-1">
          <li>• Copy product names exactly as they appear in platform reports</li>
          <li>• One external name can only map to one inventory product</li>
          <li>• Leave platform blank to apply mapping to all platforms</li>
          <li>• When importing TikTok data, unmapped products will be flagged for review</li>
        </ul>
      </div>
    </div>
  )
}
