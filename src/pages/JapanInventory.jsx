import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchJapanInventory } from '../lib/supabase'
import { Package, Search, RefreshCw, ShoppingCart, ArrowRight } from 'lucide-react'

// ============================================================================
// Japan Inventory — read-only view of what's at Japan Warehouse right now
// ============================================================================
// Mirrors ViewInventory's style but locks the location filter to Japan
// Warehouse. Inflow/outflow happen on Japan Acquisitions / Japan Stream Sales
// / Japan→US Shipments pages — this page is purely "where do we stand?"
// ============================================================================

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function JapanInventory() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [langFilter, setLangFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const data = await fetchJapanInventory()
      // Sort by brand then product name for a stable read
      data.sort((a, b) => {
        const ab = (a.product?.brand || '').localeCompare(b.product?.brand || '')
        if (ab !== 0) return ab
        return (a.product?.name || '').localeCompare(b.product?.name || '')
      })
      setRows(data)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to load Japan inventory')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let out = rows
    if (brandFilter) out = out.filter(r => r.product?.brand === brandFilter)
    if (langFilter) out = out.filter(r => r.product?.language === langFilter)
    if (typeFilter) out = out.filter(r => r.product?.type === typeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter(r => (r.product?.name || '').toLowerCase().includes(q))
    }
    return out
  }, [rows, search, brandFilter, langFilter, typeFilter])

  const summary = useMemo(() => ({
    totalSkus: filtered.length,
    totalUnits: filtered.reduce((s, r) => s + (r.quantity || 0), 0),
    totalValueUsd: filtered.reduce((s, r) =>
      s + (r.quantity || 0) * parseFloat(r.avg_cost_basis || 0), 0),
  }), [filtered])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner" /></div>

  return (
    <div className="fade-in space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <Package className="text-vault-gold" />
            🇯🇵 Japan Inventory
          </h1>
          <p className="text-gray-400 mt-1">
            Everything currently at <strong className="text-white">Japan Warehouse</strong>. Inflow via
            <Link to="/jp/acquisitions" className="text-vault-gold mx-1 hover:underline">日本进货</Link>,
            outflow via
            <Link to="/jp/stream-sales" className="text-vault-gold mx-1 hover:underline">日本直播售卖</Link> or
            <Link to="/jp/shipments" className="text-vault-gold mx-1 hover:underline">日本→美国发货</Link>.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 bg-vault-surface border border-vault-border hover:border-vault-gold text-sm text-gray-300 rounded-lg flex items-center gap-2"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
          {error}
          {error.includes('run scripts/add_japan_inventory_system.sql') && (
            <div className="mt-1 text-xs text-red-200/70">
              The Japan migration hasn't been applied to this database yet. Open Supabase SQL Editor and run that file once.
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="SKUs in stock" value={summary.totalSkus} />
        <StatCard label="Total units" value={summary.totalUnits} colorClass="text-vault-gold" />
        <StatCard label="Approx value (USD)"
          value={`$${summary.totalValueUsd.toFixed(2)}`}
          subtext="weighted-avg cost basis × qty"
          colorClass="text-green-400" />
      </div>

      {/* Filters */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Search by product name</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="e.g. Prismatic, OP-13..."
                className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Brand</label>
            <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm">
              <option value="">All brands</option>
              <option value="Pokemon">Pokemon</option>
              <option value="One Piece">One Piece</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Language</label>
            <select value={langFilter} onChange={e => setLangFilter(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm">
              <option value="">All languages</option>
              <option value="JP">JP</option>
              <option value="EN">EN</option>
              <option value="CN">CN</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 text-sm">
          {filtered.length} SKU{filtered.length === 1 ? '' : 's'}
        </h3>
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingCart className="mx-auto text-gray-600 mb-4" size={48} />
            <p className="text-gray-400">
              {rows.length === 0 ? 'Nothing in Japan Warehouse yet.' : 'No SKUs match these filters.'}
            </p>
            {rows.length === 0 && (
              <Link to="/jp/acquisitions"
                className="mt-3 inline-flex items-center gap-2 px-3 py-2 bg-vault-gold/20 border border-vault-gold/60 text-vault-gold rounded-lg text-sm hover:bg-vault-gold/30">
                Record first 日本进货 <ArrowRight size={14} />
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Brand</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Lang</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Avg cost (USD)</th>
                  <th className="pb-2 text-right">Value (USD)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const avg = parseFloat(r.avg_cost_basis || 0)
                  const value = (r.quantity || 0) * avg
                  return (
                    <tr key={r.id} className="border-b border-vault-border/50 hover:bg-vault-darker/30">
                      <td className="py-2 text-vault-gold">{r.product?.brand || '—'}</td>
                      <td className="py-2 text-white">{extractLaunchName(r.product?.name, r.product?.category) || r.product?.name || '—'}</td>
                      <td className="py-2 text-blue-300">{r.product?.language || '—'}</td>
                      <td className="py-2 text-gray-400">{r.product?.category || r.product?.type || '—'}</td>
                      <td className="py-2 text-right text-white font-semibold">{(r.quantity || 0).toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-300">${avg.toFixed(2)}</td>
                      <td className="py-2 text-right text-green-400">${value.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, subtext, colorClass = 'text-white' }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}
