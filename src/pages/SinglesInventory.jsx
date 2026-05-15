import React, { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchSingles, fetchCardSets, fetchLocations, softDeleteSingle } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import {
  Layers, Plus, Search, X, TrendingUp, TrendingDown,
  Package, DollarSign, Trash2
} from 'lucide-react'

const BRAND_OPTIONS = ['Pokemon', 'One Piece', 'Magic', 'Yu-Gi-Oh!', 'Other']
const LANGUAGE_OPTIONS = ['EN', 'JP', 'KR', 'CN']
const FORM_OPTIONS = [
  { value: '', label: 'All forms' },
  { value: 'raw', label: 'Raw only' },
  { value: 'graded', label: 'Graded only' }
]
const GRADING_COMPANY_OPTIONS = ['PSA', 'BGS', 'CGC', 'SGC', 'Other']

export default function SinglesInventory() {
  const { toasts, addToast, removeToast } = useToast()
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [singles, setSingles] = useState([])
  const [cardSets, setCardSets] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  const [filters, setFilters] = useState({
    brand: '',
    language: '',
    form: '',
    set_id: '',
    grading_company: '',
    location_id: '',
    search: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [singlesData, setsData, locData] = await Promise.all([
        fetchSingles({ status: 'in_inventory' }),
        fetchCardSets(),
        fetchLocations('Physical')
      ])
      setSingles(singlesData)
      setCardSets(setsData)
      setLocations(locData)
    } catch (error) {
      console.error('Error loading singles:', error)
      addToast(`Failed to load: ${error.message || 'unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setFilters(f => ({ ...f, [name]: value }))
  }

  const clearFilters = () => {
    setFilters({
      brand: '', language: '', form: '', set_id: '',
      grading_company: '', location_id: '', search: ''
    })
  }

  // Client-side filtering on top of the soft-delete + status filter already
  // applied by fetchSingles. Server-side filtering for all these dimensions
  // is overkill for v1 (inventory is small enough); revisit if rows grow.
  const filteredSingles = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    return singles.filter(s => {
      if (filters.brand && s.brand !== filters.brand) return false
      if (filters.language && s.language !== filters.language) return false
      if (filters.form && s.form !== filters.form) return false
      if (filters.set_id && s.set_id !== filters.set_id) return false
      if (filters.grading_company && s.grading_company !== filters.grading_company) return false
      if (filters.location_id && s.location_id !== filters.location_id) return false
      if (search) {
        const haystack = [
          s.card_name, s.card_number, s.variant, s.cert_number,
          s.set?.name, s.set?.code, s.notes
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [singles, filters])

  // Aggregate metrics across the filtered view.
  const metrics = useMemo(() => {
    let totalUnits = 0
    let totalCost = 0
    let totalMarket = 0
    let costRows = 0
    let marketRows = 0
    for (const s of filteredSingles) {
      const qty = s.form === 'raw' ? (s.quantity || 1) : 1
      totalUnits += qty
      if (s.acquisition_cost_usd != null) {
        totalCost += Number(s.acquisition_cost_usd) * qty
        costRows++
      }
      if (s.current_market_price_usd != null) {
        totalMarket += Number(s.current_market_price_usd) * qty
        marketRows++
      }
    }
    return {
      cardCount: filteredSingles.length,
      totalUnits,
      totalCost,
      totalMarket,
      profitLoss: totalMarket - totalCost,
      costRows,
      marketRows
    }
  }, [filteredSingles])

  // Sets for the active brand+language filter (so the Set dropdown shrinks
  // sensibly as the user narrows).
  const setsForFilter = useMemo(() => {
    return cardSets.filter(s =>
      (!filters.brand || s.brand === filters.brand) &&
      (!filters.language || s.language === filters.language)
    )
  }, [cardSets, filters.brand, filters.language])

  const handleDelete = async (single) => {
    if (!isAdmin()) {
      addToast('Only admins can delete singles', 'error')
      return
    }
    const reason = window.prompt(
      `Soft-delete "${single.card_name} ${single.card_number}"?\nOptional reason:`,
      ''
    )
    if (reason === null) return // user cancelled
    try {
      await softDeleteSingle(single.id, user.id, reason || null)
      addToast('Single removed', 'success')
      loadData()
    } catch (error) {
      console.error('Error deleting single:', error)
      addToast(`Failed to delete: ${error.message || 'unknown error'}`, 'error')
    }
  }

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
            <Layers className="text-vault-gold" />
            Singles Inventory
          </h1>
          <p className="text-gray-400 mt-1">Per-card tracking for graded slabs and raw cards</p>
        </div>
        <Link to="/singles/add" className="btn btn-primary">
          <Plus size={20} /> Add Single
        </Link>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p className="font-medium text-white">v1 scope — inventory only.</p>
          <p>Sales recording, box-break pull tracing, and P&amp;L reports are coming in v2.</p>
          <p>The existing High Value page is unchanged and continues to work for legacy $100+ items.</p>
        </div>
      </Instructions>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-gray-400 text-sm">Cards / Units</p>
          <p className="font-display text-2xl font-bold text-white">
            {metrics.cardCount}
            <span className="text-gray-500 text-base font-normal"> / {metrics.totalUnits}</span>
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">
            Total cost
            <span className="text-gray-600 text-xs ml-1">({metrics.costRows} priced)</span>
          </p>
          <p className="font-display text-2xl font-bold text-vault-gold">
            ${metrics.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">
            Market value
            <span className="text-gray-600 text-xs ml-1">({metrics.marketRows} priced)</span>
          </p>
          <p className="font-display text-2xl font-bold text-blue-400">
            ${metrics.totalMarket.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Unrealized P/L</p>
          <p className={`font-display text-2xl font-bold flex items-center gap-1 ${
            metrics.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {metrics.profitLoss >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            ${Math.abs(metrics.profitLoss).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div className="md:col-span-3 lg:col-span-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="text"
                name="search"
                value={filters.search}
                onChange={handleFilterChange}
                placeholder="Search card name, number, cert#, set, notes..."
                className="pl-10"
              />
            </div>
          </div>

          <select name="brand" value={filters.brand} onChange={handleFilterChange}>
            <option value="">All brands</option>
            {BRAND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <select name="language" value={filters.language} onChange={handleFilterChange}>
            <option value="">All languages</option>
            {LANGUAGE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <select name="form" value={filters.form} onChange={handleFilterChange}>
            {FORM_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          <select name="set_id" value={filters.set_id} onChange={handleFilterChange}>
            <option value="">All sets</option>
            {setsForFilter.map(s => (
              <option key={s.id} value={s.id}>
                {s.brand} {s.language} — {s.name}
              </option>
            ))}
          </select>

          <select name="grading_company" value={filters.grading_company} onChange={handleFilterChange}>
            <option value="">All grading cos</option>
            {GRADING_COMPANY_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <select name="location_id" value={filters.location_id} onChange={handleFilterChange}>
            <option value="">All locations</option>
            {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>

          <button
            type="button"
            onClick={clearFilters}
            className="btn btn-secondary"
          >
            <X size={16} /> Clear filters
          </button>
        </div>
      </div>

      {/* Result list */}
      {filteredSingles.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400 mb-4">
            {singles.length === 0
              ? 'No singles in inventory yet.'
              : 'No singles match your filters.'}
          </p>
          {singles.length === 0 && (
            <Link to="/singles/add" className="btn btn-primary inline-flex">
              <Plus size={20} /> Add your first single
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-vault-border text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Card</th>
                <th className="text-left px-4 py-3">Set</th>
                <th className="text-left px-4 py-3">Form</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3">Cost (USD)</th>
                <th className="text-right px-4 py-3">Market (USD)</th>
                <th className="text-right px-4 py-3">P/L</th>
                <th className="text-left px-4 py-3">Location</th>
                <th className="text-left px-4 py-3">Acquired</th>
                {isAdmin() && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {filteredSingles.map(s => {
                const qty = s.form === 'raw' ? (s.quantity || 1) : 1
                const costEach = s.acquisition_cost_usd
                const marketEach = s.current_market_price_usd
                const pl = (costEach != null && marketEach != null)
                  ? (Number(marketEach) - Number(costEach)) * qty
                  : null
                return (
                  <tr
                    key={s.id}
                    className="border-b border-vault-border last:border-0 hover:bg-vault-darker/40"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {s.card_name} <span className="text-gray-500">{s.card_number}</span>
                      </div>
                      <div className="text-gray-500 text-xs">
                        {s.brand} · {s.language}
                        {s.variant ? ` · ${s.variant}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {s.set?.name || '—'}
                      {s.set?.code ? <span className="text-gray-500 text-xs"> [{s.set.code}]</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {s.form === 'graded' ? (
                        <div>
                          <span className="badge badge-info text-xs">
                            {s.grading_company} {s.grade}
                          </span>
                          {s.cert_number && (
                            <div className="text-gray-500 text-xs mt-1">#{s.cert_number}</div>
                          )}
                        </div>
                      ) : (
                        <span className="badge badge-secondary text-xs">
                          Raw {s.condition || ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{qty}</td>
                    <td className="px-4 py-3 text-right text-vault-gold">
                      {costEach != null
                        ? `$${Number(costEach).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-400">
                      {marketEach != null
                        ? `$${Number(marketEach).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right ${
                      pl == null ? 'text-gray-500'
                        : pl >= 0 ? 'text-green-400'
                        : 'text-red-400'
                    }`}>
                      {pl == null
                        ? '—'
                        : `${pl >= 0 ? '+' : ''}$${Math.abs(pl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{s.location?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.date_acquired}</td>
                    {isAdmin() && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          className="text-gray-500 hover:text-red-400"
                          title="Soft-delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
