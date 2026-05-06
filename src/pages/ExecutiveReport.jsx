import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  Calendar,
  TrendingDown,
  TrendingUp,
  Package,
  Skull,
  AlertTriangle,
  MapPin,
  ShoppingCart,
  Tv,
  Store,
  ShoppingBag,
  BarChart3,
} from 'lucide-react'

// Cost-only executive report. The owner asked for a daily / weekly summary
// that ignores revenue and profit (someone else handles those numbers) — this
// page reports inventory value, what flowed in, what flowed out, top movers,
// dead stock, and low-stock alerts, all in cost-basis dollars.
export default function ExecutiveReport() {
  const [view, setView] = useState('daily') // 'daily' | 'weekly'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [view])

  // Period selection. "Daily" = yesterday in browser-local time (the team is
  // PST so this matches their workday). "Weekly" = trailing 7 days (today
  // back). For date-only columns we compare YYYY-MM-DD strings; for timestamp
  // columns we use ISO instants.
  const getPeriod = () => {
    const now = new Date()
    if (view === 'daily') {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      const start = new Date(yesterday); start.setHours(0, 0, 0, 0)
      const end = new Date(yesterday); end.setHours(23, 59, 59, 999)
      return { start, end, label: yesterday.toLocaleDateString('en-CA') }
    }
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return {
      start, end,
      label: `${start.toLocaleDateString('en-CA')} → ${end.toLocaleDateString('en-CA')}`,
    }
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = getPeriod()
      const startISO = start.toISOString()
      const endISO = end.toISOString()
      const startDate = start.toLocaleDateString('en-CA') // YYYY-MM-DD
      const endDate = end.toLocaleDateString('en-CA')

      // Fire the static lookups in parallel with the period-bounded outflow /
      // inflow queries. Stream-count items and online-order items still need a
      // second round-trip after we have parent IDs.
      const [
        invRes, prodRes, locRes,
        acqRes, scRes, sfRes, psRes, ooRes,
      ] = await Promise.all([
        supabase.from('inventory').select('product_id, location_id, quantity, avg_cost_basis').gt('quantity', 0),
        supabase.from('products').select('id, name, brand, language, type, category'),
        supabase.from('locations').select('id, name'),
        supabase.from('acquisitions')
          .select('id, product_id, quantity, unit_cost, total_cost, date_purchased, vendor:vendors(name)')
          .gte('date_purchased', startDate).lte('date_purchased', endDate),
        supabase.from('stream_counts')
          .select('id, location_id, count_time')
          .gte('count_time', startISO).lte('count_time', endISO)
          .eq('deleted', false),
        supabase.from('storefront_sales')
          .select('id, product_id, quantity, cost_basis, sale_type, date')
          .gte('date', startDate).lte('date', endDate)
          .eq('deleted', false),
        supabase.from('platform_sales')
          .select('id, channel, date, cost'),
        supabase.from('online_orders')
          .select('id, channel, date'),
      ])

      // Filter platform_sales / online_orders by date in JS — Supabase
      // sometimes barfs on date filters when the column is TEXT not DATE.
      const platformInPeriod = (psRes.data || []).filter(p => p.date >= startDate && p.date <= endDate)
      const onlineInPeriod = (ooRes.data || []).filter(o => o.date >= startDate && o.date <= endDate)

      // Pull line items for the IDs we care about
      let scItems = []
      if (scRes.data?.length) {
        const ids = scRes.data.map(c => c.id)
        const r = await supabase
          .from('stream_count_items')
          .select('stream_count_id, product_id, expected_qty, actual_qty')
          .in('stream_count_id', ids)
        scItems = r.data || []
      }
      let ooItems = []
      if (onlineInPeriod.length) {
        const ids = onlineInPeriod.map(o => o.id)
        const r = await supabase
          .from('online_order_items')
          .select('online_order_id, product_id, quantity, unit_cost, cost_basis')
          .in('online_order_id', ids)
        ooItems = r.data || []
      }

      // Lookup maps
      const productMap = new Map((prodRes.data || []).map(p => [p.id, p]))
      const locationMap = new Map((locRes.data || []).map(l => [l.id, l]))
      const scLocationMap = new Map((scRes.data || []).map(c => [c.id, c.location_id]))
      // Per-product cost lookup — averaged across that product's inventory rows
      // (different locations may hold the same product at slightly different
      // historical costs; we use a quantity-weighted average for outflow $$).
      const productCost = new Map()
      const productCostQty = new Map()
      for (const i of invRes.data || []) {
        const cost = parseFloat(i.avg_cost_basis || 0)
        const qty = i.quantity || 0
        const cur = productCost.get(i.product_id) || 0
        const curQty = productCostQty.get(i.product_id) || 0
        productCost.set(i.product_id, cur + cost * qty)
        productCostQty.set(i.product_id, curQty + qty)
      }
      const productAvgCost = (pid) => {
        const total = productCost.get(pid) || 0
        const qty = productCostQty.get(pid) || 0
        return qty > 0 ? total / qty : 0
      }

      // ===== Inventory snapshot =====
      let invValue = 0
      const invByLocation = new Map()
      for (const i of invRes.data || []) {
        const cost = parseFloat(i.avg_cost_basis || 0) * (i.quantity || 0)
        invValue += cost
        const locName = locationMap.get(i.location_id)?.name || 'Unknown'
        invByLocation.set(locName, (invByLocation.get(locName) || 0) + cost)
      }

      // ===== Outflow aggregation =====
      let outStream = 0, outStorefront = 0, outOnline = 0, outPlatform = 0
      const productOutflow = new Map() // product_id -> { cost, qty, channels:Set }

      const addOutflow = (productId, qty, cost, channel) => {
        if (!productId || qty <= 0) return
        const cur = productOutflow.get(productId) || { cost: 0, qty: 0, channels: new Set() }
        cur.cost += cost
        cur.qty += qty
        cur.channels.add(channel)
        productOutflow.set(productId, cur)
      }

      // Stream rooms: items where actual < expected => sold during stream
      for (const item of scItems) {
        const sold = (item.expected_qty || 0) - (item.actual_qty || 0)
        if (sold <= 0) continue
        const cost = sold * productAvgCost(item.product_id)
        outStream += cost
        addOutflow(item.product_id, sold, cost, 'Stream')
      }

      // Storefront: only Itemized has product_id and pre-computed cost_basis.
      // Bulk sales aren't tied to a product — we skip those for product-level
      // breakdowns but still count them in the storefront total.
      for (const s of sfRes.data || []) {
        const cost = parseFloat(s.cost_basis || 0)
        outStorefront += cost
        if (s.sale_type !== 'Bulk' && s.product_id) {
          addOutflow(s.product_id, s.quantity || 0, cost, 'Storefront')
        }
      }

      // Online order line items
      for (const it of ooItems) {
        const qty = it.quantity || 0
        const unit = parseFloat(it.unit_cost || it.cost_basis || 0) || productAvgCost(it.product_id)
        const cost = qty * unit
        outOnline += cost
        addOutflow(it.product_id, qty, cost, 'Online')
      }

      // Platform sales — currently aggregated at session level (no line items
      // schema visible), so we add their cost to the channel total but can't
      // break them down per product.
      for (const ps of platformInPeriod) {
        outPlatform += parseFloat(ps.cost || 0)
      }

      const outTotal = outStream + outStorefront + outOnline + outPlatform

      // Top 5 by outflow cost
      const top5 = Array.from(productOutflow.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 5)
        .map(([pid, d]) => ({
          product: productMap.get(pid),
          cost: d.cost,
          qty: d.qty,
          channels: Array.from(d.channels).join(', '),
        }))

      // ===== Inflow =====
      let inTotal = 0
      const inflowByVendor = new Map()
      for (const a of acqRes.data || []) {
        const cost = parseFloat(a.total_cost || 0) || (parseFloat(a.unit_cost || 0) * (a.quantity || 0))
        inTotal += cost
        const vendor = a.vendor?.name || 'Unknown'
        inflowByVendor.set(vendor, (inflowByVendor.get(vendor) || 0) + cost)
      }

      // ===== Dead stock (no outflow in last 30 days) =====
      // Look 30 days back across every outflow channel, build a set of moved
      // product_ids, then subtract from products that currently have stock.
      const deadCutoff = new Date()
      deadCutoff.setDate(deadCutoff.getDate() - 30)
      const deadCutoffISO = deadCutoff.toISOString()
      const deadCutoffDate = deadCutoff.toLocaleDateString('en-CA')

      const [deadSc, deadSf, deadOo, deadPs] = await Promise.all([
        supabase.from('stream_counts').select('id').gte('count_time', deadCutoffISO).eq('deleted', false),
        supabase.from('storefront_sales').select('product_id').gte('date', deadCutoffDate).eq('deleted', false),
        supabase.from('online_orders').select('id').gte('date', deadCutoffDate),
        supabase.from('platform_sales').select('id').gte('date', deadCutoffDate),
      ])

      const movedSet = new Set()
      // Stream items in the 30-day window
      if (deadSc.data?.length) {
        const ids = deadSc.data.map(c => c.id)
        const r = await supabase
          .from('stream_count_items')
          .select('product_id, expected_qty, actual_qty')
          .in('stream_count_id', ids)
        for (const it of r.data || []) {
          if ((it.expected_qty || 0) > (it.actual_qty || 0) && it.product_id) movedSet.add(it.product_id)
        }
      }
      for (const s of deadSf.data || []) if (s.product_id) movedSet.add(s.product_id)
      if (deadOo.data?.length) {
        const ids = deadOo.data.map(o => o.id)
        const r = await supabase.from('online_order_items').select('product_id').in('online_order_id', ids)
        for (const it of r.data || []) if (it.product_id) movedSet.add(it.product_id)
      }
      // Platform sales don't expose product-level data in the current schema —
      // we conservatively skip them rather than mark all platform-sold items
      // as having moved (would risk hiding real dead stock).

      // Build dead stock list: products with quantity > 0 not in movedSet
      const deadByProduct = new Map() // product_id -> { qty, value }
      for (const i of invRes.data || []) {
        if (movedSet.has(i.product_id)) continue
        const cur = deadByProduct.get(i.product_id) || { qty: 0, value: 0 }
        cur.qty += (i.quantity || 0)
        cur.value += parseFloat(i.avg_cost_basis || 0) * (i.quantity || 0)
        deadByProduct.set(i.product_id, cur)
      }
      const deadStock = Array.from(deadByProduct.entries())
        .map(([pid, d]) => ({ product: productMap.get(pid), qty: d.qty, value: d.value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15)

      // ===== Low stock alerts =====
      // Per-row qty < 5, ignoring Master Inventory (running low at Master is
      // a procurement signal, not an immediate alert — we care about empty
      // shelves at sales locations).
      const lowStock = (invRes.data || [])
        .filter(i => {
          if (i.quantity <= 0 || i.quantity >= 5) return false
          const locName = locationMap.get(i.location_id)?.name || ''
          return !/master/i.test(locName)
        })
        .map(i => ({
          product: productMap.get(i.product_id),
          location: locationMap.get(i.location_id)?.name,
          quantity: i.quantity,
        }))
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 12)

      setData({
        period: getPeriod().label,
        invValue,
        invByLocation: Array.from(invByLocation.entries()).sort((a, b) => b[1] - a[1]),
        outflow: { stream: outStream, storefront: outStorefront, online: outOnline, platform: outPlatform, total: outTotal },
        inflow: { total: inTotal, byVendor: Array.from(inflowByVendor.entries()).sort((a, b) => b[1] - a[1]) },
        top5,
        deadStock,
        lowStock,
      })
    } catch (err) {
      console.error('Error loading executive report:', err)
      setError(err.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-red-300">
        Failed to load report: {error}
      </div>
    )
  }

  return (
    <div className="fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <BarChart3 className="text-vault-gold" />
            Executive Report
          </h1>
          <p className="text-gray-400 mt-1">Cost-basis view of inventory, inflow, outflow</p>
          <p className="text-xs text-gray-500 mt-1">Period: {data?.period}</p>
        </div>
        <div className="flex gap-2 bg-vault-surface rounded-lg p-1 border border-vault-border">
          <button
            onClick={() => setView('daily')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              view === 'daily' ? 'bg-vault-gold text-vault-dark' : 'text-gray-400 hover:text-white'
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setView('weekly')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              view === 'weekly' ? 'bg-vault-gold text-vault-dark' : 'text-gray-400 hover:text-white'
            }`}
          >
            Weekly (last 7 days)
          </button>
        </div>
      </div>

      {/* Top-line cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
            <Package size={16} /> Total Inventory Value
          </div>
          <div className="text-2xl font-bold text-white">{fmt(data?.invValue)}</div>
          <div className="text-xs text-gray-500 mt-1">across all locations, at cost</div>
        </div>
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <div className="flex items-center gap-2 text-red-400 text-sm mb-1">
            <TrendingDown size={16} /> Outflow (cost)
          </div>
          <div className="text-2xl font-bold text-white">{fmt(data?.outflow?.total)}</div>
          <div className="text-xs text-gray-500 mt-1">stream + storefront + online + platform</div>
        </div>
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <div className="flex items-center gap-2 text-green-400 text-sm mb-1">
            <TrendingUp size={16} /> Inflow (cost)
          </div>
          <div className="text-2xl font-bold text-white">{fmt(data?.inflow?.total)}</div>
          <div className="text-xs text-gray-500 mt-1">acquisitions logged in period</div>
        </div>
      </div>

      {/* Outflow breakdown + Inventory by location */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <TrendingDown size={18} className="text-red-400" /> Outflow by channel
          </h3>
          <div className="space-y-2 text-sm">
            <Row icon={<Tv size={14} />} label="Stream rooms" value={fmt(data?.outflow?.stream)} />
            <Row icon={<Store size={14} />} label="Storefront" value={fmt(data?.outflow?.storefront)} />
            <Row icon={<ShoppingBag size={14} />} label="Online orders" value={fmt(data?.outflow?.online)} />
            <Row icon={<TrendingUp size={14} />} label="Platform sales" value={fmt(data?.outflow?.platform)} />
            <div className="border-t border-vault-border pt-2 mt-2">
              <Row label="Total" value={fmt(data?.outflow?.total)} bold />
            </div>
          </div>
        </div>

        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <MapPin size={18} className="text-vault-gold" /> Inventory by location
          </h3>
          <div className="space-y-2 text-sm">
            {data?.invByLocation?.map(([name, value]) => (
              <Row key={name} label={name} value={fmt(value)} sub={`${((value / (data?.invValue || 1)) * 100).toFixed(1)}%`} />
            ))}
          </div>
        </div>
      </div>

      {/* Top 5 outflow products */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <BarChart3 size={18} className="text-vault-gold" /> Top 5 outflow products (by cost)
        </h3>
        {!data?.top5?.length ? (
          <p className="text-gray-500 text-sm">No outflow in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs uppercase tracking-wider">
                <tr><th className="text-left pb-2">Product</th><th className="text-right pb-2">Qty</th><th className="text-right pb-2">Cost</th><th className="text-left pb-2 pl-4">Channels</th></tr>
              </thead>
              <tbody>
                {data.top5.map((row, i) => (
                  <tr key={i} className="border-t border-vault-border">
                    <td className="py-2 text-white">
                      {row.product?.name || 'Unknown'}
                      <span className="text-xs text-gray-500 ml-2">{row.product?.language}</span>
                    </td>
                    <td className="py-2 text-right text-gray-300">{row.qty}</td>
                    <td className="py-2 text-right text-white font-medium">{fmt(row.cost)}</td>
                    <td className="py-2 pl-4 text-gray-400 text-xs">{row.channels}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inflow detail */}
      {data?.inflow?.byVendor?.length > 0 && (
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <ShoppingCart size={18} className="text-green-400" /> Inflow by vendor
          </h3>
          <div className="space-y-2 text-sm">
            {data.inflow.byVendor.map(([name, value]) => (
              <Row key={name} label={name} value={fmt(value)} />
            ))}
          </div>
        </div>
      )}

      {/* Dead stock + Low stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Skull size={18} className="text-purple-400" /> Dead stock — no outflow in 30 days
          </h3>
          {!data?.deadStock?.length ? (
            <p className="text-gray-500 text-sm">No dead stock 🎉</p>
          ) : (
            <div className="space-y-1.5 text-sm max-h-80 overflow-y-auto">
              {data.deadStock.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-vault-border/50 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-white truncate">{d.product?.name || 'Unknown'}</div>
                    <div className="text-xs text-gray-500">{d.product?.brand} · {d.product?.language} · {d.qty} units</div>
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <div className="text-white font-medium">{fmt(d.value)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-yellow-400" /> Low stock — under 5 at sales location
          </h3>
          {!data?.lowStock?.length ? (
            <p className="text-gray-500 text-sm">All sales locations stocked above 5 ✅</p>
          ) : (
            <div className="space-y-1.5 text-sm max-h-80 overflow-y-auto">
              {data.lowStock.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-vault-border/50 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-white truncate">{d.product?.name || 'Unknown'}</div>
                    <div className="text-xs text-gray-500">{d.location} · {d.product?.language}</div>
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <div className={`font-bold ${d.quantity <= 1 ? 'text-red-400' : 'text-yellow-400'}`}>{d.quantity}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ icon, label, value, sub, bold }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-gray-300">
        {icon && <span className="text-gray-500">{icon}</span>}
        <span className={bold ? 'text-white font-semibold' : ''}>{label}</span>
      </div>
      <div className="text-right">
        <div className={bold ? 'text-white font-bold' : 'text-white'}>{value}</div>
        {sub && <div className="text-xs text-gray-500">{sub}</div>}
      </div>
    </div>
  )
}
