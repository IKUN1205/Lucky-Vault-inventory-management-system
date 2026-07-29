import React, { useState, useEffect, useMemo } from 'react'
import { fetchSlabs, softDeleteSlab } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import {
  ShieldCheck, Search, X, Trash2, ChevronUp, ChevronDown,
  Package
} from 'lucide-react'

// ============================================================================
// SlabsInventory — list view for graded slabs
// ============================================================================
// Reads from the new `slabs` table (separate from singles). Same UX
// conventions as SinglesInventory: sortable columns, status filter,
// search box, soft-delete via 🗑.
//
// v1 columns shown: Cert # · Grading · Item name · Status · Acquired
// (cost / sale / P&L columns will surface as we wire the sell flow)
// ============================================================================

const STATUS_OPTIONS = [
  { value: '',             label: 'All' },
  { value: 'in_inventory', label: 'In inventory' },
  { value: 'listed',       label: 'Listed' },
  { value: 'sold',         label: 'Sold' },
  { value: 'sent_out',     label: 'Sent out' },
  { value: 'lost',         label: 'Lost' },
]

const GRADING_COMPANIES = ['', 'PSA', 'CGC', 'BGS', 'SGC', 'Other']

const STATUS_BADGE = {
  in_inventory: 'badge-secondary',
  listed:       'badge-warning',
  sold:         'badge-success',
  sent_out:     'badge-info',
  lost:         'badge-danger',
}

export default function SlabsInventory() {
  const { toasts, addToast, removeToast } = useToast()
  const { user, isAdmin } = useAuth()

  const [slabs, setSlabs] = useState([])
  const [loading, setLoading] = useState(true)

  const [filters, setFilters] = useState({
    status: '',           // empty = all statuses
    grading_company: '',
    search: '',
  })

  const [sort, setSort] = useState({ column: 'acquired', direction: 'desc' })

  // Pagination (Gary 2026-07-29: /cards froze rendering every row at once).
  // Filters/sort/metrics still cover the FULL set; only the table is paged.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [filters, sort])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.grading_company])

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await fetchSlabs({
        status: filters.status || undefined,
        grading_company: filters.grading_company || undefined,
      })
      setSlabs(data)
    } catch (err) {
      console.error('SlabsInventory load failed:', err)
      addToast(`Failed to load slabs: ${err.message || 'unknown'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ---- Sort getters (parallel to singles) ----
  const SORT_KEYS = {
    cert:     (s) => s.cert_number || '',
    grading:  (s) => s.grading_company || '',
    item:     (s) => (s.item_name || '').toLowerCase(),
    status:   (s) => s.status || '',
    cost:     (s) => s.acquisition_cost_usd != null ? Number(s.acquisition_cost_usd) : null,
    list:     (s) => s.list_price_usd != null ? Number(s.list_price_usd) : null,
    market:   (s) => s.market_price_usd != null ? Number(s.market_price_usd) : null,
    sale:     (s) => s.sale_price_usd != null ? Number(s.sale_price_usd) : null,
    acquired: (s) => s.date_acquired || '',
    listed:   (s) => s.listed_at || '',
    sold:     (s) => s.sale_date || '',
  }

  const toggleSort = (column) => {
    setSort(prev => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: ['cert','grading','item','status'].includes(column) ? 'asc' : 'desc' }
    )
  }

  // ---- Client-side search + sort on top of the server-fetched list ----
  const filteredSlabs = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    const list = slabs.filter(s => {
      if (search) {
        const haystack = [
          s.cert_number, s.grading_company, s.item_name, s.notes,
          s.acquirer?.name, s.sold_by?.name, s.buyer_name
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
    const getter = SORT_KEYS[sort.column] || SORT_KEYS.acquired
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const av = getter(a)
      const bv = getter(b)
      const aIsNull = av === null || av === undefined || av === ''
      const bIsNull = bv === null || bv === undefined || bv === ''
      if (aIsNull && bIsNull) return 0
      if (aIsNull) return 1
      if (bIsNull) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slabs, filters.search, sort])

  const pageCount = Math.max(1, Math.ceil(filteredSlabs.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = useMemo(
    () => filteredSlabs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredSlabs, safePage]
  )

  const renderPager = (borderClass) => filteredSlabs.length > PAGE_SIZE && (
    <div className={`flex items-center justify-between px-4 py-2 ${borderClass} border-vault-border text-xs text-gray-400`}>
      <span>
        {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredSlabs.length)} of {filteredSlabs.length.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={safePage <= 1} onClick={() => setPage(1)}
          className="px-2 py-1 border border-vault-border rounded disabled:opacity-40 hover:text-white">«</button>
        <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}
          className="px-2 py-1 border border-vault-border rounded disabled:opacity-40 hover:text-white">‹ Prev</button>
        <span className="px-2 text-gray-300">Page {safePage} / {pageCount}</span>
        <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}
          className="px-2 py-1 border border-vault-border rounded disabled:opacity-40 hover:text-white">Next ›</button>
        <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(pageCount)}
          className="px-2 py-1 border border-vault-border rounded disabled:opacity-40 hover:text-white">»</button>
      </div>
    </div>
  )

  // ---- Summary metrics (filtered view) ----
  const metrics = useMemo(() => {
    // Slabs have no acquisition cost (boss 2026-06-25) — value the book by
    // MARKET price (MP) instead.
    let totalMarket = 0
    let totalList = 0
    let totalSale = 0
    let marketRows = 0
    let listRows = 0
    let saleRows = 0
    let byStatus = { in_inventory: 0, listed: 0, sold: 0, sent_out: 0, lost: 0 }
    for (const s of filteredSlabs) {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1
      if (s.market_price_usd != null) { totalMarket += Number(s.market_price_usd); marketRows++ }
      if (s.list_price_usd != null)   { totalList += Number(s.list_price_usd);     listRows++ }
      if (s.sale_price_usd != null)   { totalSale += Number(s.sale_price_usd);     saleRows++ }
    }
    return { totalMarket, totalList, totalSale, marketRows, listRows, saleRows, byStatus }
  }, [filteredSlabs])

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setFilters(f => ({ ...f, [name]: value }))
  }

  const clearFilters = () => setFilters({ status: '', grading_company: '', search: '' })

  const handleDelete = async (slab) => {
    if (!isAdmin()) {
      addToast('Only admins can delete slabs', 'error')
      return
    }
    const reason = window.prompt(
      `Soft-delete slab #${slab.cert_number}?\n${slab.item_name}\n\nOptional reason:`,
      ''
    )
    if (reason === null) return
    try {
      await softDeleteSlab(slab.id, user.id, reason || null)
      addToast('Slab removed', 'success')
      loadData()
    } catch (err) {
      addToast(`Delete failed: ${err.message || 'unknown'}`, 'error')
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
            <ShieldCheck className="text-vault-gold" />
            Slabs Inventory
          </h1>
          <p className="text-gray-400 mt-1">Graded TCG cards (PSA / CGC / BGS / SGC)</p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>One row per physical graded slab, identified by cert #.</p>
          <p className="text-gray-400 text-xs">
            Status: <strong>in_inventory</strong> (in our possession) ·
            <strong> listed</strong> (up for sale, see Listed date) ·
            <strong> sold</strong> (sale recorded) ·
            <strong> sent_out</strong> (with grading service or consignment) ·
            <strong> lost</strong>.
          </p>
        </div>
      </Instructions>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-gray-400 text-sm">Slabs (filtered)</p>
          <p className="font-display text-2xl font-bold text-white">{filteredSlabs.length}</p>
          <p className="text-gray-500 text-xs mt-0.5">
            {metrics.byStatus.in_inventory} in inv · {metrics.byStatus.listed} listed · {metrics.byStatus.sold} sold
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total market <span className="text-gray-600 text-xs">({metrics.marketRows} priced)</span></p>
          <p className="font-display text-2xl font-bold text-vault-gold">${metrics.totalMarket.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total list <span className="text-gray-600 text-xs">({metrics.listRows} priced)</span></p>
          <p className="font-display text-2xl font-bold text-blue-400">${metrics.totalList.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total sold <span className="text-gray-600 text-xs">({metrics.saleRows} sold)</span></p>
          <p className="font-display text-2xl font-bold text-green-400">${metrics.totalSale.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div className="md:col-span-3 lg:col-span-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                name="search"
                value={filters.search}
                onChange={handleFilterChange}
                placeholder="Search cert #, item name, notes, buyer, acquirer..."
                className="pl-9"
              />
            </div>
          </div>

          <select name="status" value={filters.status} onChange={handleFilterChange}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select name="grading_company" value={filters.grading_company} onChange={handleFilterChange}>
            <option value="">All grading cos</option>
            {GRADING_COMPANIES.filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <button type="button" onClick={clearFilters} className="btn btn-secondary">
            <X size={14} /> Clear
          </button>
        </div>
      </div>

      {/* Table */}
      {filteredSlabs.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">
            {slabs.length === 0
              ? 'No slabs in this view. Try changing the status filter.'
              : 'No slabs match the search.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          {renderPager('border-b')}
          <table className="w-full text-sm">
            <thead className="border-b border-vault-border text-gray-400 text-xs uppercase">
              <tr>
                <SortHeader col="cert"     align="left"  sort={sort} onToggle={toggleSort}>Cert #</SortHeader>
                <SortHeader col="grading"  align="left"  sort={sort} onToggle={toggleSort}>Grading</SortHeader>
                <SortHeader col="item"     align="left"  sort={sort} onToggle={toggleSort}>Item</SortHeader>
                <SortHeader col="status"   align="left"  sort={sort} onToggle={toggleSort}>Status</SortHeader>
                <SortHeader col="market"   align="right" sort={sort} onToggle={toggleSort}>Market</SortHeader>
                <SortHeader col="list"     align="right" sort={sort} onToggle={toggleSort}>List</SortHeader>
                <SortHeader col="sale"     align="right" sort={sort} onToggle={toggleSort}>Sale</SortHeader>
                <SortHeader col="acquired" align="left"  sort={sort} onToggle={toggleSort}>Acquired</SortHeader>
                {isAdmin() && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(s => {
                const statusClass = STATUS_BADGE[s.status] || 'badge-secondary'
                return (
                  <tr key={s.id} className="border-b border-vault-border last:border-0 hover:bg-vault-darker/40">
                    <td className="px-4 py-3 font-mono text-white text-xs">{s.cert_number}</td>
                    <td className="px-4 py-3 text-gray-300">{s.grading_company}</td>
                    <td className="px-4 py-3 text-white max-w-[420px]">
                      <div className="truncate" title={s.item_name}>{s.item_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusClass} text-xs`}>{s.status}</span>
                      {s.status === 'listed' && s.listed_at && (
                        <div className="text-gray-500 text-xs mt-0.5">
                          listed {new Date(s.listed_at).toLocaleDateString('en-CA')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-vault-gold">
                      {s.market_price_usd != null
                        ? `$${Number(s.market_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-400">
                      {s.list_price_usd != null
                        ? `$${Number(s.list_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400">
                      {s.sale_price_usd != null
                        ? `$${Number(s.sale_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.date_acquired || '—'}</td>
                    {isAdmin() && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          className="text-gray-500 hover:text-red-400"
                          title="Soft-delete this slab"
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
          {renderPager('border-t')}
        </div>
      )}
    </div>
  )
}

// Clickable column header — same widget as SinglesInventory's
function SortHeader({ col, align = 'left', sort, onToggle, children }) {
  const active = sort.column === col
  const Arrow = sort.direction === 'asc' ? ChevronUp : ChevronDown
  const justify = align === 'right' ? 'justify-end' : 'justify-start'
  return (
    <th className={`px-4 py-3 text-${align} select-none`}>
      <button
        type="button"
        onClick={() => onToggle(col)}
        className={`flex items-center gap-1 ${justify} w-full hover:text-vault-gold transition ${
          active ? 'text-vault-gold' : 'text-gray-400'
        }`}
      >
        <span>{children}</span>
        <Arrow size={12} className={active ? 'opacity-100' : 'opacity-30'} />
      </button>
    </th>
  )
}
