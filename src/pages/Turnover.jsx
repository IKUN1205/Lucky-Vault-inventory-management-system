import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { TrendingUp, ChevronRight, ChevronDown, Search } from 'lucide-react'

// Helper to extract Launch Name from full product name
// (matches the convention used elsewhere in the codebase)
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// Time windows compared side-by-side. 7d added so users can spot week-over-week
// trend changes early; 30/60/90 are the longer baselines.
const WINDOWS = [7, 30, 60, 90]
const DEFAULT_WINDOW = 30

// Status tag thresholds (computed from the SELECTED window's velocity)
function classifyStatus(weeklyVelocity, daysLeft, hasStock, daysSinceLastSale) {
  if (!hasStock) return { tag: 'none', label: '—', color: 'text-gray-500' }
  // Dead = has stock but no sale in 60+ days
  if (daysSinceLastSale === null || daysSinceLastSale >= 60) {
    return { tag: 'dead', label: '💀 Dead', color: 'text-red-400' }
  }
  if (weeklyVelocity >= 10 || (daysLeft !== null && daysLeft < 30)) {
    return { tag: 'hot', label: '🔥 Hot', color: 'text-orange-400' }
  }
  if (daysLeft !== null && daysLeft <= 90) {
    return { tag: 'ok', label: '✅ OK', color: 'text-green-400' }
  }
  return { tag: 'slow', label: '🐌 Slow', color: 'text-yellow-400' }
}

// Round helpers
const r1 = n => Math.round(n * 10) / 10

export default function Turnover() {
  const { toasts, addToast, removeToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState([])
  const [inventory, setInventory] = useState([])     // {product_id, location_id, quantity}
  const [locations, setLocations] = useState([])     // for location_id → name lookup
  const [salesEvents, setSalesEvents] = useState([]) // unified [{product_id, qty, date, channel}]

  const [window, setWindow] = useState(DEFAULT_WINDOW)
  const [filters, setFilters] = useState({ brand: '', type: '', language: '', search: '', channel: '' })
  const [expanded, setExpanded] = useState(new Set())  // launch keys
  const [sortBy, setSortBy] = useState('velocity')     // velocity | sold | stock | daysLeft

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    try {
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      const cutoff = ninetyDaysAgo.toISOString()
      const cutoffDate = cutoff.slice(0, 10)

      // Phase 1: fetch the simple stuff in parallel.
      // We avoid PostgREST nested-table filters (e.g. .gte('foo.bar', x)) since
      // those are flaky — instead we fetch parent rows first and then children
      // by parent_id in phase 2.
      const [productsRes, inventoryRes, locationsRes, streamCountsRes, storefrontRes, onlineOrdersRes] = await Promise.all([
        supabase.from('products').select('id, name, brand, category, language, type'),
        supabase.from('inventory').select('product_id, location_id, quantity').gt('quantity', 0),
        supabase.from('locations').select('id, name'),
        supabase
          .from('stream_counts')
          .select('id, count_time, location_id')
          .gte('count_time', cutoff),
        // storefront_sales: location_id may not exist in this DB (schema drift
        // between app code and actual columns). Just pull the essentials and
        // attribute every storefront sale to a single "Storefront" channel.
        supabase
          .from('storefront_sales')
          .select('product_id, quantity, date, sale_type')
          .gte('date', cutoffDate),
        supabase
          .from('online_orders')
          .select('id, date, platform, channel, source_location_id, deleted')
          .gte('date', cutoffDate)
      ])

      // Surface specific failures so we can pinpoint which query broke
      const failures = []
      if (productsRes.error) failures.push(`products: ${productsRes.error.message}`)
      if (inventoryRes.error) failures.push(`inventory: ${inventoryRes.error.message}`)
      if (locationsRes.error) failures.push(`locations: ${locationsRes.error.message}`)
      if (streamCountsRes.error) failures.push(`stream_counts: ${streamCountsRes.error.message}`)
      if (storefrontRes.error) failures.push(`storefront_sales: ${storefrontRes.error.message}`)
      if (onlineOrdersRes.error) failures.push(`online_orders: ${onlineOrdersRes.error.message}`)
      if (failures.length > 0) {
        console.error('[Turnover] phase 1 failures:', failures)
        throw new Error(failures.join(' | '))
      }

      const streamCountIds = (streamCountsRes.data || []).map(sc => sc.id)
      const streamCountById = Object.fromEntries(
        (streamCountsRes.data || []).map(sc => [sc.id, sc])
      )
      const onlineOrderIds = (onlineOrdersRes.data || [])
        .filter(o => !o.deleted)
        .map(o => o.id)
      const onlineOrderById = Object.fromEntries(
        (onlineOrdersRes.data || []).map(o => [o.id, o])
      )

      // Phase 2: fetch line items by parent ids
      const [streamItemsRes, onlineItemsRes] = await Promise.all([
        streamCountIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from('stream_count_items')
              .select('product_id, difference, stream_count_id')
              .in('stream_count_id', streamCountIds)
              .lt('difference', 0),
        onlineOrderIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from('online_order_items')
              .select('product_id, quantity, order_id')
              .in('order_id', onlineOrderIds)
      ])

      const phase2Failures = []
      if (streamItemsRes.error) phase2Failures.push(`stream_count_items: ${streamItemsRes.error.message}`)
      if (onlineItemsRes.error) phase2Failures.push(`online_order_items: ${onlineItemsRes.error.message}`)
      if (phase2Failures.length > 0) {
        console.error('[Turnover] phase 2 failures:', phase2Failures)
        throw new Error(phase2Failures.join(' | '))
      }

      const locById = Object.fromEntries((locationsRes.data || []).map(l => [l.id, l.name]))

      // Normalize all 3 sources into a single events array
      const events = []

      // 1. Stream counts — channel = location name (the stream room)
      for (const item of streamItemsRes.data || []) {
        const sc = streamCountById[item.stream_count_id]
        if (!sc) continue
        events.push({
          product_id: item.product_id,
          qty: Math.abs(item.difference),
          date: sc.count_time?.slice(0, 10),
          channel: locById[sc.location_id] || 'Unknown room'
        })
      }

      // 2. Storefront — single "Storefront" channel (no location attribution
      //    available in this schema). Filter sale_type in JS in case the
      //    column is missing/NULL on older rows.
      for (const s of storefrontRes.data || []) {
        if (s.sale_type && s.sale_type !== 'Product') continue
        if (!s.product_id) continue
        events.push({
          product_id: s.product_id,
          qty: s.quantity,
          date: s.date,
          channel: 'Storefront'
        })
      }

      // 3. Online orders — channel = "platform @ channel (Online)"
      for (const item of onlineItemsRes.data || []) {
        const order = onlineOrderById[item.order_id]
        if (!order || order.deleted) continue
        events.push({
          product_id: item.product_id,
          qty: item.quantity,
          date: order.date,
          channel: `${order.platform} @ ${order.channel} (Online)`
        })
      }

      setProducts(productsRes.data || [])
      setInventory(inventoryRes.data || [])
      setLocations(locationsRes.data || [])
      setSalesEvents(events)
    } catch (err) {
      console.error('Turnover load failed:', err)
      addToast(`Failed to load: ${err.message || 'unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ---- Aggregation ----
  // For each product, compute: sold (per window), perChannel (per window), lastSaleDate
  // Then group by launch.
  const { launches, brandsAvailable, channelsAvailable } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Inventory sum per product across all locations
    const stockByProduct = {}
    for (const inv of inventory) {
      stockByProduct[inv.product_id] = (stockByProduct[inv.product_id] || 0) + inv.quantity
    }

    // Per-product aggregates
    const perProduct = {}
    for (const p of products) {
      perProduct[p.id] = {
        product: p,
        stock: stockByProduct[p.id] || 0,
        sold: { 7: 0, 30: 0, 60: 0, 90: 0 },
        byChannel: { 7: {}, 30: {}, 60: {}, 90: {} },
        lastSaleDate: null
      }
    }

    // If a channel filter is active, all per-product/launch metrics reflect
    // ONLY that channel's contribution. Stock stays total because online
    // orders aren't tied to a specific source location.
    const filteredEvents = filters.channel
      ? salesEvents.filter(e => e.channel === filters.channel)
      : salesEvents

    for (const e of filteredEvents) {
      const agg = perProduct[e.product_id]
      if (!agg || !e.date) continue
      const eventDate = new Date(e.date)
      const daysAgo = Math.floor((today - eventDate) / (1000 * 60 * 60 * 24))

      // Last sale tracking
      if (!agg.lastSaleDate || eventDate > new Date(agg.lastSaleDate)) {
        agg.lastSaleDate = e.date
      }

      // Bucket into windows
      for (const w of WINDOWS) {
        if (daysAgo <= w) {
          agg.sold[w] += e.qty
          agg.byChannel[w][e.channel] = (agg.byChannel[w][e.channel] || 0) + e.qty
        }
      }
    }

    // Compute velocity + days left + status for each product
    const finalized = Object.values(perProduct).map(agg => {
      const out = { ...agg }
      const sold = agg.sold[window]
      const weeklyVel = sold / (window / 7)
      const dailyVel = sold / window
      const daysLeft = (dailyVel > 0 && agg.stock > 0) ? Math.round(agg.stock / dailyVel) : null
      const daysSinceLastSale = agg.lastSaleDate
        ? Math.floor((today - new Date(agg.lastSaleDate)) / (1000 * 60 * 60 * 24))
        : null
      const status = classifyStatus(weeklyVel, daysLeft, agg.stock > 0, daysSinceLastSale)
      return { ...out, weeklyVel, dailyVel, daysLeft, daysSinceLastSale, status }
    })

    // Filter
    const filtered = finalized.filter((f) => {
      const product = f.product
      if (filters.brand && product.brand !== filters.brand) return false
      if (filters.type && product.type !== filters.type) return false
      if (filters.language && product.language !== filters.language) return false
      if (filters.search) {
        const haystack = `${product.brand} ${product.name} ${product.category} ${product.language}`.toLowerCase()
        if (!haystack.includes(filters.search.toLowerCase())) return false
      }
      // When a channel filter is active, only show products that actually had
      // sales in that channel within 90 days — otherwise we'd show every SKU
      // with stock saying "0 sold", which is noise.
      if (filters.channel) {
        if (f.sold[90] === 0) return false
      } else {
        // No channel filter: hide products with no stock AND no recent sales
        if (f.stock === 0 && f.sold[90] === 0) return false
      }
      return true
    })

    // Group by launch (brand + launchName)
    const launchMap = {}
    for (const f of filtered) {
      const launchName = extractLaunchName(f.product.name, f.product.category)
      const key = `${f.product.brand}||${launchName}`
      if (!launchMap[key]) {
        launchMap[key] = {
          key,
          brand: f.product.brand,
          launchName,
          skus: [],
          stock: 0,
          sold: { 7: 0, 30: 0, 60: 0, 90: 0 },
          byChannel: { 7: {}, 30: {}, 60: {}, 90: {} },
          lastSaleDate: null
        }
      }
      const bucket = launchMap[key]
      bucket.skus.push(f)
      bucket.stock += f.stock
      for (const w of WINDOWS) {
        bucket.sold[w] += f.sold[w]
        for (const [ch, qty] of Object.entries(f.byChannel[w])) {
          bucket.byChannel[w][ch] = (bucket.byChannel[w][ch] || 0) + qty
        }
      }
      if (f.lastSaleDate && (!bucket.lastSaleDate || f.lastSaleDate > bucket.lastSaleDate)) {
        bucket.lastSaleDate = f.lastSaleDate
      }
    }

    // Compute launch-level derived metrics
    const launchList = Object.values(launchMap).map(l => {
      const sold = l.sold[window]
      const weeklyVel = sold / (window / 7)
      const dailyVel = sold / window
      const daysLeft = (dailyVel > 0 && l.stock > 0) ? Math.round(l.stock / dailyVel) : null
      const daysSinceLastSale = l.lastSaleDate
        ? Math.floor((today - new Date(l.lastSaleDate)) / (1000 * 60 * 60 * 24))
        : null
      const status = classifyStatus(weeklyVel, daysLeft, l.stock > 0, daysSinceLastSale)
      return { ...l, weeklyVel, dailyVel, daysLeft, daysSinceLastSale, status }
    })

    // Sort
    launchList.sort((a, b) => {
      if (sortBy === 'velocity') return b.weeklyVel - a.weeklyVel
      if (sortBy === 'sold') return b.sold[window] - a.sold[window]
      if (sortBy === 'stock') return b.stock - a.stock
      if (sortBy === 'daysLeft') {
        // null daysLeft (no velocity) goes to the bottom
        if (a.daysLeft === null) return 1
        if (b.daysLeft === null) return -1
        return a.daysLeft - b.daysLeft
      }
      return 0
    })

    // Sort SKUs within each launch by velocity desc
    launchList.forEach(l => l.skus.sort((a, b) => b.weeklyVel - a.weeklyVel))

    const brandsAvailable = [...new Set(products.map(p => p.brand).filter(Boolean))].sort()
    // Distinct channels found in the (unfiltered) sales events. Sorted with
    // Stream Rooms first, then Storefront, then Online channels — easier to scan.
    const channelsAvailable = [...new Set(salesEvents.map(e => e.channel))].sort((a, b) => {
      const rank = ch => ch.startsWith('Stream Room') ? 0 : ch === 'Storefront' ? 1 : 2
      const ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      return a.localeCompare(b)
    })

    return { launches: launchList, brandsAvailable, channelsAvailable }
  }, [products, inventory, salesEvents, window, filters, sortBy])

  const toggleLaunch = (key) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(launches.map(l => l.key)))
  const collapseAll = () => setExpanded(new Set())

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    )
  }

  const totalStock = launches.reduce((s, l) => s + l.stock, 0)
  const totalSold = launches.reduce((s, l) => s + l.sold[window], 0)

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <TrendingUp className="text-vault-gold" />
          Turnover
        </h1>
        <p className="text-gray-400 mt-1">Which products move fast, which sit. Per-channel breakdown on each SKU.</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">How to read this report:</p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><span className="text-vault-gold">Velocity</span> — units sold per week in the selected window</li>
            <li><span className="text-vault-gold">Days Left</span> — at current velocity, how long until stock runs out</li>
            <li><span className="text-vault-gold">Status tags</span>: 🔥 Hot (≥10/wk or &lt;30d left) · ✅ OK · 🐌 Slow · 💀 Dead (no sales 60+ days)</li>
            <li>Click any launch to drill down to per-SKU + per-channel breakdown</li>
          </ul>
          <p className="text-cyan-400 text-xs mt-3">
            💡 Sales counted: Stream Counts + Storefront + Online Orders. Platform Sales $$ excluded
            to avoid double-counting units already captured in Stream Counts.
          </p>
        </div>
      </Instructions>

      {/* Filters */}
      <div className="card mb-4">
        {/* Row 1: Time window (full row width on its own — most prominent) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Time Window</label>
          <div className="flex bg-vault-dark rounded-lg p-1 max-w-md">
            {WINDOWS.map(w => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`flex-1 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  window === w
                    ? 'bg-vault-gold text-vault-dark'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Slicing filters */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Brand</label>
            <select value={filters.brand} onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}>
              <option value="">All</option>
              {brandsAvailable.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Type</label>
            <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
              <option value="">All</option>
              <option value="Sealed">Sealed</option>
              <option value="Pack">Pack</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Language</label>
            <select value={filters.language} onChange={e => setFilters(f => ({ ...f, language: e.target.value }))}>
              <option value="">All</option>
              <option value="EN">EN</option>
              <option value="JP">JP</option>
              <option value="CN">CN</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Channel</label>
            <select value={filters.channel} onChange={e => setFilters(f => ({ ...f, channel: e.target.value }))}>
              <option value="">All channels</option>
              {channelsAvailable.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input
                type="text"
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                placeholder="Launch / brand..."
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {filters.channel && (
          <p className="text-xs text-yellow-400 mt-3">
            ⚠️ Filtered to <span className="font-semibold">{filters.channel}</span> — Sold/velocity reflect this channel only.
            Stock is total across all locations (online channels can't be tied to a specific location).
          </p>
        )}

        <div className="flex justify-between items-center mt-4 pt-4 border-t border-vault-border">
          <div className="text-sm text-gray-400">
            <span className="text-white font-semibold">{launches.length}</span> launches ·
            <span className="text-white font-semibold ml-2">{totalStock.toLocaleString()}</span> in stock ·
            <span className="text-white font-semibold ml-2">{totalSold.toLocaleString()}</span> sold last {window}d
          </div>
          <div className="flex gap-2">
            <button onClick={expandAll} className="text-xs text-blue-400 hover:text-blue-300">Expand all</button>
            <span className="text-gray-600">|</span>
            <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-gray-300">Collapse all</button>
          </div>
        </div>
      </div>

      {/* Main table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>Launch</th>
                <th className="text-right">SKUs</th>
                <th className="text-right">Stock</th>
                <th className="text-right cursor-pointer hover:text-vault-gold" onClick={() => setSortBy('sold')}>
                  Sold ({window}d) {sortBy === 'sold' && '↓'}
                </th>
                <th className="text-right cursor-pointer hover:text-vault-gold" onClick={() => setSortBy('velocity')}>
                  /week {sortBy === 'velocity' && '↓'}
                </th>
                <th className="text-right cursor-pointer hover:text-vault-gold" onClick={() => setSortBy('daysLeft')}>
                  Days Left {sortBy === 'daysLeft' && '↑'}
                </th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {launches.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-gray-500 py-8">No launches match these filters</td>
                </tr>
              )}
              {launches.map(l => (
                <React.Fragment key={l.key}>
                  <tr
                    className="cursor-pointer hover:bg-vault-surface/50"
                    onClick={() => toggleLaunch(l.key)}
                  >
                    <td>
                      {expanded.has(l.key)
                        ? <ChevronDown size={16} className="text-gray-400" />
                        : <ChevronRight size={16} className="text-gray-400" />}
                    </td>
                    <td>
                      <div className="text-white font-medium">{l.launchName}</div>
                      <div className="text-xs text-gray-500">{l.brand}</div>
                    </td>
                    <td className="text-right text-gray-300">{l.skus.length}</td>
                    <td className="text-right text-gray-300">{l.stock}</td>
                    <td className="text-right text-white font-medium">{l.sold[window]}</td>
                    <td className="text-right text-vault-gold font-medium">{r1(l.weeklyVel)}</td>
                    <td className="text-right text-gray-300">
                      {l.daysLeft === null
                        ? (l.stock > 0 ? '∞' : '—')
                        : `${l.daysLeft}d`}
                    </td>
                    <td className={`text-right font-medium ${l.status.color}`}>{l.status.label}</td>
                  </tr>

                  {/* Expanded SKU rows */}
                  {expanded.has(l.key) && l.skus.map(sku => {
                    const channels = Object.entries(sku.byChannel[window])
                      .sort((a, b) => b[1] - a[1])
                    return (
                      <tr key={sku.product.id} className="bg-vault-darker/40">
                        <td></td>
                        <td className="pl-6">
                          <div className="text-gray-200 text-sm">
                            {sku.product.category} · <span className="text-blue-400">{sku.product.language}</span>
                          </div>
                          {channels.length > 0 ? (
                            <div className="text-xs text-gray-500 mt-1 space-x-3">
                              {channels.map(([ch, qty]) => (
                                <span key={ch}>
                                  <span className="text-gray-400">{ch}:</span>{' '}
                                  <span className="text-gray-300">{qty}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-600 mt-1">No sales in this window</div>
                          )}
                        </td>
                        <td></td>
                        <td className="text-right text-gray-400 text-sm">{sku.stock}</td>
                        <td className="text-right text-gray-200 text-sm">{sku.sold[window]}</td>
                        <td className="text-right text-vault-gold/80 text-sm">{r1(sku.weeklyVel)}</td>
                        <td className="text-right text-gray-400 text-sm">
                          {sku.daysLeft === null
                            ? (sku.stock > 0 ? '∞' : '—')
                            : `${sku.daysLeft}d`}
                        </td>
                        <td className={`text-right text-sm ${sku.status.color}`}>{sku.status.label}</td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
