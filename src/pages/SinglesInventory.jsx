import React, { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchSingles, fetchCardSets, fetchLocations, softDeleteSingle, notifySinglesLark } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import SellSingleModal from '../components/SellSingleModal'
import { useAuth } from '../lib/AuthContext'
import {
  Layers, Plus, Search, X, TrendingUp, TrendingDown,
  Package, DollarSign, Trash2, ChevronUp, ChevronDown
} from 'lucide-react'

const BRAND_OPTIONS = ['Pokemon', 'One Piece', 'Magic', 'Yu-Gi-Oh!', 'Other']
const LANGUAGE_OPTIONS = ['EN', 'JP', 'KR', 'CN']
const FORM_OPTIONS = [
  { value: '', label: 'All forms' },
  { value: 'raw', label: 'Raw only' },
  { value: 'graded', label: 'Graded only' }
]
const STATUS_OPTIONS = [
  { value: 'in_inventory', label: 'In inventory' },
  { value: 'sold',         label: 'Sold' },
  { value: '',             label: 'All (incl. sent / listed / lost)' }
]
const GRADING_COMPANY_OPTIONS = ['PSA', 'BGS', 'CGC', 'SGC', 'Other']

const CHANNEL_LABEL = {
  // current vocabulary (src/lib/saleChannels.js, 2026-07-29)
  in_person:        'Storefront',
  PackHeadsTCG:     'TikTok Packheads',
  RocketsHQ:        'TikTok RocketsHQ',
  Whatnot:          'Whatnot PokeCasino',
  PokeAuctionHouse: 'PokeAuctionHouse',
  SlabbiePatty:     'eBay SlabbiePatty',
  LuckyVaultUS:     'eBay LuckyVaultUS',
  shows:            'Card Show',
  tcgplayer:        'TCGplayer',
  trade_out:        'Trade Out',
  other:            'Other',
  // historical values still present on old sold rows
  ebay:    'eBay',
  whatnot: 'Whatnot',
  comc:    'COMC',
}

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
    search: '',
    status: 'in_inventory'   // 'in_inventory' / 'sold' / '' (all)
  })

  // Sell modal: holds the single being sold (null = closed)
  const [sellingSingle, setSellingSingle] = useState(null)

  // Sortable columns. `column` matches a key in the SORT_KEYS map below;
  // `direction` toggles asc/desc. Default: most recently acquired first.
  const [sort, setSort] = useState({ column: 'acquired', direction: 'desc' })

  // Pagination (Gary 2026-07-29: /cards froze rendering EVERY row — 2,500+
  // in the sold/all views). Filters, sort and the metrics cards still run
  // over the FULL filtered set; only the rendered table slice is paged.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [filters, sort])

  // Extract the comparable value for each column. Returns null for missing
  // values — those sort to the END regardless of direction (sort stability
  // for "unpriced" rows).
  const SORT_KEYS = {
    card:     (s) => (s.card_name || '').toLowerCase(),
    set:      (s) => (s.set?.name || '').toLowerCase(),
    form:     (s) => `${s.form}-${s.grading_company || ''}-${s.grade || ''}-${s.condition || ''}`,
    qty:      (s) => s.form === 'raw' ? (s.quantity || 1) : 1,
    cost:     (s) => s.acquisition_cost_usd != null ? Number(s.acquisition_cost_usd) : null,
    market:   (s) => s.current_market_price_usd != null ? Number(s.current_market_price_usd) : null,
    pl:       (s) => {
      // Unrealized for in_inventory, realized for sold
      const qty = s.form === 'raw' ? (s.quantity || 1) : 1
      const cost = s.acquisition_cost_usd != null ? Number(s.acquisition_cost_usd) : null
      if (s.status === 'sold') {
        // sale_price_usd is PER-UNIT (7/29 convention) — scale by qty.
        const price = s.sale_price_usd != null ? Number(s.sale_price_usd) : null
        const fees = s.sale_fees_usd != null ? Number(s.sale_fees_usd) : 0
        return (price != null && cost != null) ? (price * qty - fees) - cost * qty : null
      }
      const market = s.current_market_price_usd != null ? Number(s.current_market_price_usd) : null
      return (market != null && cost != null) ? (market - cost) * qty : null
    },
    sale:     (s) => s.sale_price_usd != null ? Number(s.sale_price_usd) : null,
    channel:  (s) => (s.sale_channel || '').toLowerCase(),
    location: (s) => (s.location?.name || '').toLowerCase(),
    acquired: (s) => s.date_acquired || '',
    sold:     (s) => s.sale_date || '',
  }

  const toggleSort = (column) => {
    setSort(prev => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      // Sensible default per column type: text → asc, numeric/date → desc
      : { column, direction: ['card','set','form','channel','location'].includes(column) ? 'asc' : 'desc' }
    )
  }

  // Re-load when status filter changes (status is the only server-side filter)
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status])

  const loadData = async () => {
    setLoading(true)
    try {
      const singlesFilter = filters.status ? { status: filters.status } : {}
      const [singlesData, setsData, locData] = await Promise.all([
        fetchSingles(singlesFilter),
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
      grading_company: '', location_id: '', search: '',
      status: 'in_inventory'   // keep status default — wiping it to '' would slow the page
    })
  }

  // Client-side filtering on top of the soft-delete + status filter already
  // applied by fetchSingles. Server-side filtering for all these dimensions
  // is overkill for v1 (inventory is small enough); revisit if rows grow.
  const filteredSingles = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    const list = singles.filter(s => {
      if (filters.brand && s.brand !== filters.brand) return false
      if (filters.language && s.language !== filters.language) return false
      if (filters.form && s.form !== filters.form) return false
      if (filters.set_id && s.set_id !== filters.set_id) return false
      if (filters.grading_company && s.grading_company !== filters.grading_company) return false
      if (filters.location_id && s.location_id !== filters.location_id) return false
      if (search) {
        const haystack = [
          s.card_name, s.card_number, s.variant, s.cert_number, s.tcg_id,
          s.set?.name, s.set?.code, s.notes
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
    // Sort: nulls always sort to the END regardless of direction so that
    // unpriced/unknown rows don't pollute the top of either order.
    const getter = SORT_KEYS[sort.column] || SORT_KEYS.acquired
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const av = getter(a)
      const bv = getter(b)
      // Treat empty strings as null for sort purposes
      const aIsNull = av === null || av === undefined || av === ''
      const bIsNull = bv === null || bv === undefined || bv === ''
      if (aIsNull && bIsNull) return 0
      if (aIsNull) return 1   // null to end
      if (bIsNull) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singles, filters, sort])

  // Rendered slice — clamp the page so shrinking filters can't strand you
  // past the last page.
  const pageCount = Math.max(1, Math.ceil(filteredSingles.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = useMemo(
    () => filteredSingles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredSingles, safePage]
  )

  const renderPager = (borderClass) => filteredSingles.length > PAGE_SIZE && (
    <div className={`flex items-center justify-between px-4 py-2 ${borderClass} border-vault-border text-xs text-gray-400`}>
      <span>
        {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredSingles.length)} of {filteredSingles.length.toLocaleString()}
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

  // Aggregate metrics across the filtered view.
  //
  // Two "value" totals:
  //   - totalMarket   — for in_inventory rows (current market price; unrealized)
  //   - totalSale     — for sold rows (actual sale price - fees; realized)
  //
  // We compute both regardless of the status filter so summary cards can
  // show whichever matches the current view, and a single "all" view can
  // surface lifetime totals later.
  const metrics = useMemo(() => {
    let totalUnits = 0
    let totalCost = 0
    let totalMarket = 0
    let totalSaleNet = 0    // sale_price - fees
    let costRows = 0
    let marketRows = 0
    let saleRows = 0
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
      if (s.status === 'sold' && s.sale_price_usd != null) {
        // sale_price_usd is PER-UNIT (7/29 convention) — scale by qty.
        const fees = s.sale_fees_usd != null ? Number(s.sale_fees_usd) : 0
        totalSaleNet += Number(s.sale_price_usd) * qty - fees
        saleRows++
      }
    }
    return {
      cardCount: filteredSingles.length,
      totalUnits,
      totalCost,
      totalMarket,
      totalSaleNet,
      unrealizedPl: totalMarket - totalCost,
      realizedPl:   totalSaleNet - totalCost,
      costRows,
      marketRows,
      saleRows
    }
  }, [filteredSingles])

  const viewingSold = filters.status === 'sold'

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
      // Fire-and-forget Lark notification
      notifySinglesLark({
        type: 'single_deleted',
        card_name: single.card_name,
        card_number: single.card_number,
        reason: reason || null,
        operator_name: user?.name,
      })
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
          <p className="font-medium text-white">In-flow + out-flow tracking.</p>
          <p>
            Click <strong>Add Single</strong> to record a new card. Hit the <strong>$</strong> button on a row to record a sale (price, channel, fees, buyer). Use the <strong>Status</strong> filter to switch between in-inventory and sold views.
          </p>
          <p className="text-gray-400 text-xs">
            Still pending: box-break pull tracing, photo uploads, raw-stack partial sales. The existing High Value page is unchanged.
          </p>
        </div>
      </Instructions>

      {/* Summary cards — values shown depend on Status filter:
          in_inventory → Market value + Unrealized P/L
          sold         → Sale net (price-fees) + Realized P/L */}
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
        {viewingSold ? (
          <>
            <div className="card">
              <p className="text-gray-400 text-sm">
                Sale net (post-fees)
                <span className="text-gray-600 text-xs ml-1">({metrics.saleRows} sold)</span>
              </p>
              <p className="font-display text-2xl font-bold text-green-400">
                ${metrics.totalSaleNet.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card">
              <p className="text-gray-400 text-sm">Realized P/L</p>
              <p className={`font-display text-2xl font-bold flex items-center gap-1 ${
                metrics.realizedPl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {metrics.realizedPl >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                ${Math.abs(metrics.realizedPl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </>
        ) : (
          <>
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
                metrics.unrealizedPl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {metrics.unrealizedPl >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                ${Math.abs(metrics.unrealizedPl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </>
        )}
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
                placeholder="Search card name, number, TCG ID, cert#, set, notes..."
                className="pl-10"
              />
            </div>
          </div>

          <select name="status" value={filters.status} onChange={handleFilterChange}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

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
          {renderPager('border-b')}
          <table className="w-full text-sm">
            <thead className="border-b border-vault-border text-gray-400 text-xs uppercase">
              <tr>
                <SortHeader col="card"     align="left"  sort={sort} onToggle={toggleSort}>Card</SortHeader>
                <SortHeader col="set"      align="left"  sort={sort} onToggle={toggleSort}>Set</SortHeader>
                <SortHeader col="form"     align="left"  sort={sort} onToggle={toggleSort}>Form</SortHeader>
                <SortHeader col="qty"      align="right" sort={sort} onToggle={toggleSort}>Qty</SortHeader>
                <SortHeader col="cost"     align="right" sort={sort} onToggle={toggleSort}>Cost (USD)</SortHeader>
                {viewingSold ? (
                  <>
                    <SortHeader col="sale"     align="right" sort={sort} onToggle={toggleSort}>Sale (USD)</SortHeader>
                    <SortHeader col="channel"  align="left"  sort={sort} onToggle={toggleSort}>Channel</SortHeader>
                    <SortHeader col="pl"       align="right" sort={sort} onToggle={toggleSort}>Realized P/L</SortHeader>
                    <SortHeader col="sold"     align="left"  sort={sort} onToggle={toggleSort}>Sold</SortHeader>
                  </>
                ) : (
                  <>
                    <SortHeader col="market"   align="right" sort={sort} onToggle={toggleSort}>Market (USD)</SortHeader>
                    <SortHeader col="pl"       align="right" sort={sort} onToggle={toggleSort}>P/L</SortHeader>
                    <SortHeader col="location" align="left"  sort={sort} onToggle={toggleSort}>Location</SortHeader>
                    <SortHeader col="acquired" align="left"  sort={sort} onToggle={toggleSort}>Acquired</SortHeader>
                  </>
                )}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(s => {
                const qty = s.form === 'raw' ? (s.quantity || 1) : 1
                const costEach = s.acquisition_cost_usd
                const marketEach = s.current_market_price_usd
                const unrealized = (costEach != null && marketEach != null)
                  ? (Number(marketEach) - Number(costEach)) * qty
                  : null
                // Realized P/L = (sale_price × qty - fees) - (cost × qty).
                // sale_price_usd is PER-UNIT (7/29 convention — POS split
                // clones + daily summary). Rows sold via the modal BEFORE
                // 7/29 stored the stack TOTAL, so their P/L displays high;
                // display-only, left alone.
                const salePriceNum = s.sale_price_usd != null ? Number(s.sale_price_usd) : null
                const feesNum = s.sale_fees_usd != null ? Number(s.sale_fees_usd) : 0
                const saleNet = salePriceNum != null ? salePriceNum * qty - feesNum : null
                const realized = (saleNet != null && costEach != null)
                  ? saleNet - Number(costEach) * qty
                  : null

                const isSold = s.status === 'sold'

                return (
                  <tr
                    key={s.id}
                    className="border-b border-vault-border last:border-0 hover:bg-vault-darker/40"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {/* tcg_id is the TCGplayer product id (it's what the barcode
                            scan reads), so the title deep-links straight to the
                            product page — same link the singles sheet carries. */}
                        {s.tcg_id && /^\d+$/.test(String(s.tcg_id)) ? (
                          <a
                            href={`https://www.tcgplayer.com/product/${s.tcg_id}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-vault-gold hover:underline"
                            title="Open on TCGplayer"
                          >
                            {s.card_name} <span className="text-gray-500">{s.card_number}</span>
                          </a>
                        ) : (
                          <>{s.card_name} <span className="text-gray-500">{s.card_number}</span></>
                        )}
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
                            <div className="text-gray-500 text-xs mt-1 font-mono">#{s.cert_number}</div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span className="badge badge-secondary text-xs">
                            Raw {s.condition || ''}
                          </span>
                          {s.tcg_id && (
                            <div className="text-gray-500 text-xs mt-1 font-mono">
                              TCG {s.tcg_id}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{qty}</td>
                    <td className="px-4 py-3 text-right text-vault-gold">
                      {costEach != null
                        ? `$${Number(costEach).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>

                    {viewingSold ? (
                      <>
                        <td className="px-4 py-3 text-right text-green-400">
                          {salePriceNum != null
                            ? <>
                                {/* per-unit × qty = line total (7/29 convention) */}
                                ${(salePriceNum * qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                {qty > 1 && (
                                  <div className="text-gray-500 text-xs">
                                    {qty} × ${salePriceNum.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                  </div>
                                )}
                                {feesNum > 0 && (
                                  <div className="text-gray-500 text-xs">
                                    fees ${feesNum.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                  </div>
                                )}
                              </>
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-300">
                          {s.sale_channel ? (CHANNEL_LABEL[s.sale_channel] || s.sale_channel) : '—'}
                          {s.buyer_name && (
                            <div className="text-gray-500 text-xs">→ {s.buyer_name}</div>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right ${
                          realized == null ? 'text-gray-500'
                            : realized >= 0 ? 'text-green-400'
                            : 'text-red-400'
                        }`}>
                          {realized == null
                            ? '—'
                            : `${realized >= 0 ? '+' : ''}$${Math.abs(realized).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{s.sale_date || '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right text-blue-400">
                          {marketEach != null
                            ? `$${Number(marketEach).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right ${
                          unrealized == null ? 'text-gray-500'
                            : unrealized >= 0 ? 'text-green-400'
                            : 'text-red-400'
                        }`}>
                          {unrealized == null
                            ? '—'
                            : `${unrealized >= 0 ? '+' : ''}$${Math.abs(unrealized).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </td>
                        <td className="px-4 py-3 text-gray-300">{s.location?.name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{s.date_acquired}</td>
                      </>
                    )}

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Sell button: only on in_inventory rows */}
                        {!isSold && s.status === 'in_inventory' && (
                          <button
                            type="button"
                            onClick={() => setSellingSingle(s)}
                            className="text-gray-500 hover:text-green-400"
                            title="Record sale"
                          >
                            <DollarSign size={16} />
                          </button>
                        )}
                        {isAdmin() && (
                          <button
                            type="button"
                            onClick={() => handleDelete(s)}
                            className="text-gray-500 hover:text-red-400"
                            title="Soft-delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {renderPager('border-t')}
        </div>
      )}

      {/* Sell modal — rendered last so it stacks above the table */}
      {sellingSingle && (
        <SellSingleModal
          single={sellingSingle}
          currentUserId={user?.id}
          currentUserName={user?.name}
          addToast={addToast}
          onCancel={() => setSellingSingle(null)}
          onSold={() => {
            setSellingSingle(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// Clickable column header. Shows ↑/↓ arrow on the active sort column.
// `align` = 'left' | 'right' for text-align; non-active arrow is faint
// so users can tell columns ARE sortable without the page looking busy.
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
