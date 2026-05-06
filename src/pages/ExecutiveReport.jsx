import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  TrendingDown,
  TrendingUp,
  Package,
  Skull,
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

// Display labels for language codes. Falls back to the raw code if unknown.
const LANG_LABEL = {
  EN: 'EN — US/English',
  JP: 'JP — Japan',
  CN: 'CN — China',
  KR: 'KR — Korea',
  Unknown: 'Unknown',
}
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
      // Track value two ways: by physical location and by product language.
      // Eric (the boss's lieutenant) specifically asked for JP vs US split,
      // because cost levels differ a lot per market and it tells him where
      // the cash is parked.
      let invValue = 0
      const invByLocation = new Map()
      const invByLanguage = new Map()
      for (const i of invRes.data || []) {
        const cost = parseFloat(i.avg_cost_basis || 0) * (i.quantity || 0)
        invValue += cost
        const locName = locationMap.get(i.location_id)?.name || 'Unknown'
        invByLocation.set(locName, (invByLocation.get(locName) || 0) + cost)
        const lang = productMap.get(i.product_id)?.language || 'Unknown'
        invByLanguage.set(lang, (invByLanguage.get(lang) || 0) + cost)
      }

      // ===== Outflow aggregation =====
      let outStream = 0, outStorefront = 0, outOnline = 0, outPlatform = 0
      // Units tracked separately from cost so Eric can see "一周用货量" — total
      // pieces leaving the warehouse, not just dollars. Platform sales don't
      // expose unit counts in the current schema, so unitsPlatform stays 0.
      let unitsStream = 0, unitsStorefront = 0, unitsOnline = 0
      // product_id -> { cost, qty, channels: Map(channelLabel -> { cost, qty }) }
      // Tracking per-channel breakdown so the top-5 list can show stream-room
      // mix as percentages (Eric's request: "百分之多少是哪个直播间").
      const productOutflow = new Map()
      // Per-room breakdown for stream outflow — owner wants to see which room
      // moved the most so he knows where the cost-of-goods is leaving from.
      const streamByRoom = new Map() // locationName -> { cost, units }

      const addOutflow = (productId, qty, cost, channelLabel) => {
        if (!productId || qty <= 0) return
        const cur = productOutflow.get(productId) || { cost: 0, qty: 0, channels: new Map() }
        cur.cost += cost
        cur.qty += qty
        const ch = cur.channels.get(channelLabel) || { cost: 0, qty: 0 }
        ch.cost += cost
        ch.qty += qty
        cur.channels.set(channelLabel, ch)
        productOutflow.set(productId, cur)
      }

      // Stream rooms: items where actual < expected => sold during stream.
      // Pass the short room name (sans "Stream Room - " prefix) as the channel
      // label so top-5 can show "Packheads 60% · LuckyVaultUS 40%".
      for (const item of scItems) {
        const sold = (item.expected_qty || 0) - (item.actual_qty || 0)
        if (sold <= 0) continue
        const cost = sold * productAvgCost(item.product_id)
        outStream += cost
        unitsStream += sold
        const locId = scLocationMap.get(item.stream_count_id)
        const roomName = locationMap.get(locId)?.name || 'Unknown room'
        const shortRoom = roomName.replace(/^Stream Room\s*-\s*/, '')
        addOutflow(item.product_id, sold, cost, shortRoom)
        const cur = streamByRoom.get(roomName) || { cost: 0, units: 0 }
        streamByRoom.set(roomName, { cost: cur.cost + cost, units: cur.units + sold })
      }

      // Storefront: only Itemized has product_id and pre-computed cost_basis.
      // Bulk sales aren't tied to a product — we skip those for product-level
      // breakdowns but still count them in the storefront total.
      for (const s of sfRes.data || []) {
        const cost = parseFloat(s.cost_basis || 0)
        outStorefront += cost
        unitsStorefront += s.quantity || 0
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
        unitsOnline += qty
        addOutflow(it.product_id, qty, cost, 'Online')
      }

      // Platform sales — currently aggregated at session level (no line items
      // schema visible), so we add their cost to the channel total but can't
      // break them down per product.
      for (const ps of platformInPeriod) {
        outPlatform += parseFloat(ps.cost || 0)
      }

      const outTotal = outStream + outStorefront + outOnline + outPlatform
      const unitsTotal = unitsStream + unitsStorefront + unitsOnline

      // Build top-5 with per-channel percentages, then split by language.
      // Eric specifically asked for JP and US best sellers separately —
      // different markets, different cost structures, different decisions.
      const buildTopRow = ([pid, d]) => {
        const product = productMap.get(pid)
        // Top channels for this product, sorted by cost
        const chArr = Array.from(d.channels.entries())
          .sort((a, b) => b[1].cost - a[1].cost)
          .map(([label, info]) => ({
            label,
            pct: d.cost > 0 ? (info.cost / d.cost) * 100 : 0,
            cost: info.cost,
            qty: info.qty,
          }))
        return { product, cost: d.cost, qty: d.qty, channels: chArr }
      }
      const allEntries = Array.from(productOutflow.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
      // Owner asked for both an overall view and a per-market drilldown.
      // Total = 5 across all languages; each market = 5 within its own slice.
      const top5All = allEntries.slice(0, 5).map(buildTopRow)
      const top5JP = allEntries
        .filter(([pid]) => productMap.get(pid)?.language === 'JP')
        .slice(0, 5)
        .map(buildTopRow)
      const top5EN = allEntries
        .filter(([pid]) => productMap.get(pid)?.language === 'EN')
        .slice(0, 5)
        .map(buildTopRow)
      const top5CN = allEntries
        .filter(([pid]) => productMap.get(pid)?.language === 'CN')
        .slice(0, 5)
        .map(buildTopRow)

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

      const [deadSc, deadSf, deadOo] = await Promise.all([
        supabase.from('stream_counts').select('id').gte('count_time', deadCutoffISO).eq('deleted', false),
        supabase.from('storefront_sales')
          .select('product_id, quantity, cost_basis')
          .gte('date', deadCutoffDate).eq('deleted', false),
        supabase.from('online_orders').select('id').gte('date', deadCutoffDate),
      ])

      const movedSet = new Set()
      // Track 30-day quantities so the Hot Products card can rank by volume.
      // Eric wanted "热门产品" defined as "sold a lot in the last 30 days" —
      // this map gives us exactly that.
      const moved30d = new Map() // product_id -> { units, cost }
      const bumpMoved = (pid, qty, cost) => {
        if (!pid || qty <= 0) return
        movedSet.add(pid)
        const cur = moved30d.get(pid) || { units: 0, cost: 0 }
        cur.units += qty
        cur.cost += cost
        moved30d.set(pid, cur)
      }
      // Stream items in the 30-day window
      if (deadSc.data?.length) {
        const ids = deadSc.data.map(c => c.id)
        const r = await supabase
          .from('stream_count_items')
          .select('product_id, expected_qty, actual_qty')
          .in('stream_count_id', ids)
        for (const it of r.data || []) {
          const sold = (it.expected_qty || 0) - (it.actual_qty || 0)
          if (sold > 0 && it.product_id) bumpMoved(it.product_id, sold, sold * productAvgCost(it.product_id))
        }
      }
      for (const s of deadSf.data || []) {
        if (s.product_id) bumpMoved(s.product_id, s.quantity || 0, parseFloat(s.cost_basis || 0))
      }
      if (deadOo.data?.length) {
        const ids = deadOo.data.map(o => o.id)
        const r = await supabase.from('online_order_items')
          .select('product_id, quantity, unit_cost, cost_basis')
          .in('online_order_id', ids)
        for (const it of r.data || []) {
          if (!it.product_id) continue
          const qty = it.quantity || 0
          const unit = parseFloat(it.unit_cost || it.cost_basis || 0) || productAvgCost(it.product_id)
          bumpMoved(it.product_id, qty, qty * unit)
        }
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

      // ===== Popular products (last 30 days, by units) =====
      // Replaces the old Low Stock card. Eric pointed out that the same
      // products kept showing up there (static state, not actionable). What
      // he actually wants is "what's hot right now" — top movers in the
      // 30-day window, split by language so JP / US best-sellers are visible
      // at a glance.
      const totalStockByProduct = new Map() // product_id -> total qty across locations
      for (const i of invRes.data || []) {
        totalStockByProduct.set(i.product_id, (totalStockByProduct.get(i.product_id) || 0) + (i.quantity || 0))
      }
      const popularRows = Array.from(moved30d.entries())
        .sort((a, b) => b[1].units - a[1].units)
        .map(([pid, d]) => ({
          product: productMap.get(pid),
          units30d: d.units,
          cost30d: d.cost,
          stock: totalStockByProduct.get(pid) || 0,
        }))
      const popularAll = popularRows.slice(0, 10)
      const popularJP = popularRows.filter(r => r.product?.language === 'JP').slice(0, 8)
      const popularEN = popularRows.filter(r => r.product?.language === 'EN').slice(0, 8)
      const popularCN = popularRows.filter(r => r.product?.language === 'CN').slice(0, 8)

      setData({
        period: getPeriod().label,
        invValue,
        invByLocation: Array.from(invByLocation.entries()).sort((a, b) => b[1] - a[1]),
        invByLanguage: Array.from(invByLanguage.entries()).sort((a, b) => b[1] - a[1]),
        outflow: {
          stream: outStream,
          storefront: outStorefront,
          online: outOnline,
          platform: outPlatform,
          total: outTotal,
          unitsStream, unitsStorefront, unitsOnline,
          unitsTotal,
          streamByRoom: Array.from(streamByRoom.entries()).sort((a, b) => b[1].cost - a[1].cost),
        },
        inflow: { total: inTotal, byVendor: Array.from(inflowByVendor.entries()).sort((a, b) => b[1] - a[1]) },
        top5All, top5JP, top5EN, top5CN,
        deadStock,
        popularAll, popularJP, popularEN, popularCN,
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
            <TrendingDown size={16} /> Outflow
          </div>
          <div className="text-2xl font-bold text-white">{fmt(data?.outflow?.total)}</div>
          <div className="text-sm text-gray-300 mt-1">{(data?.outflow?.unitsTotal || 0).toLocaleString()} units</div>
          <div className="text-xs text-gray-500 mt-0.5">stream + storefront + online + platform</div>
        </div>
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <div className="flex items-center gap-2 text-green-400 text-sm mb-1">
            <TrendingUp size={16} /> Inflow (cost)
          </div>
          <div className="text-2xl font-bold text-white">{fmt(data?.inflow?.total)}</div>
          <div className="text-xs text-gray-500 mt-1">acquisitions logged in period</div>
        </div>
      </div>

      {/* Outflow breakdown + Inventory by location + Inventory by language */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <TrendingDown size={18} className="text-red-400" /> Outflow by channel
          </h3>
          <div className="space-y-2 text-sm">
            <Row
              icon={<Tv size={14} />}
              label="Stream rooms"
              value={fmt(data?.outflow?.stream)}
              sub={`${(data?.outflow?.unitsStream || 0).toLocaleString()} units`}
            />
            {data?.outflow?.streamByRoom?.length > 0 && (
              <div className="pl-6 space-y-1 border-l-2 border-vault-border ml-2">
                {data.outflow.streamByRoom.map(([roomName, val]) => (
                  <div key={roomName} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 truncate">↳ {roomName.replace(/^Stream Room\s*-\s*/, '')}</span>
                    <span className="text-gray-300">
                      {fmt(val.cost)} <span className="text-gray-500">· {(val.units || 0).toLocaleString()}u</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Row
              icon={<Store size={14} />}
              label="Storefront"
              value={fmt(data?.outflow?.storefront)}
              sub={`${(data?.outflow?.unitsStorefront || 0).toLocaleString()} units`}
            />
            <Row
              icon={<ShoppingBag size={14} />}
              label="Online orders"
              value={fmt(data?.outflow?.online)}
              sub={`${(data?.outflow?.unitsOnline || 0).toLocaleString()} units`}
            />
            <Row icon={<TrendingUp size={14} />} label="Platform sales" value={fmt(data?.outflow?.platform)} />
            <div className="border-t border-vault-border pt-2 mt-2">
              <Row label="Total" value={fmt(data?.outflow?.total)} sub={`${(data?.outflow?.unitsTotal || 0).toLocaleString()} units`} bold />
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

        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Package size={18} className="text-blue-400" /> Inventory by language / market
          </h3>
          <div className="space-y-2 text-sm">
            {data?.invByLanguage?.map(([lang, value]) => (
              <Row
                key={lang}
                label={LANG_LABEL[lang] || lang}
                value={fmt(value)}
                sub={`${((value / (data?.invValue || 1)) * 100).toFixed(1)}%`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Top 5 outflow products — Total (full width), then JP/US/CN side-by-side */}
      <Top5Card title="Top 5 outflow — Overall" rows={data?.top5All} fmt={fmt} accent="🌐" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Top5Card title="JP (Japan)" rows={data?.top5JP} fmt={fmt} accent="🇯🇵" />
        <Top5Card title="EN (US)" rows={data?.top5EN} fmt={fmt} accent="🇺🇸" />
        <Top5Card title="CN (China)" rows={data?.top5CN} fmt={fmt} accent="🇨🇳" />
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

      {/* Hot products (last 30 days) — Overall first, then per-language */}
      <PopularCard title="🔥 Hot products — Overall (last 30 days)" rows={data?.popularAll} fmt={fmt} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PopularCard title="🇯🇵 Hot products — JP" rows={data?.popularJP} fmt={fmt} />
        <PopularCard title="🇺🇸 Hot products — EN/US" rows={data?.popularEN} fmt={fmt} />
        <PopularCard title="🇨🇳 Hot products — CN" rows={data?.popularCN} fmt={fmt} />
      </div>

      {/* Dead stock — kept separately. Useful for write-off / clearance decisions. */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Skull size={18} className="text-purple-400" /> Dead stock — no outflow in 30 days
        </h3>
        {!data?.deadStock?.length ? (
          <p className="text-gray-500 text-sm">No dead stock 🎉</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm max-h-80 overflow-y-auto">
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
    </div>
  )
}

// Top-5 outflow card with per-channel percentage breakdown.
// Eric requested seeing "百分之多少是哪个直播间" — channel mix as percentages,
// not raw counts. We show up to the top 3 channels per product so the line
// stays readable; channels beyond that are grouped as "others".
function Top5Card({ title, rows, fmt, accent }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <BarChart3 size={18} className="text-vault-gold" />
        <span className="mr-1">{accent}</span>
        {title}
      </h3>
      {!rows?.length ? (
        <p className="text-gray-500 text-sm">No outflow in this period.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => {
            const topCh = r.channels.slice(0, 3)
            const others = r.channels.slice(3)
            const othersPct = others.reduce((sum, c) => sum + c.pct, 0)
            return (
              <div key={i} className="border-b border-vault-border/50 pb-2 last:border-b-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-white text-sm flex-1 min-w-0">
                    <span className="font-medium">{r.product?.name || 'Unknown'}</span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-white font-semibold text-sm">{fmt(r.cost)}</div>
                    <div className="text-xs text-gray-500">{r.qty} units</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {topCh.map((c, j) => (
                    <span key={j}>
                      <span className="text-gray-500">{c.label}:</span>{' '}
                      <span className="text-gray-300">{c.pct.toFixed(0)}%</span>
                    </span>
                  ))}
                  {others.length > 0 && (
                    <span className="text-gray-500">+ {others.length} others ({othersPct.toFixed(0)}%)</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Hot products in the last 30 days, ranked by units moved out.
// Replaced the old Low-Stock card per Eric's feedback — he found that one
// repeated the same names every day (static state) and wanted instead a
// pulse on what's actually selling.
function PopularCard({ title, rows, fmt }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
      <h3 className="font-semibold text-white mb-3">{title}</h3>
      {!rows?.length ? (
        <p className="text-gray-500 text-sm">No outflow in the last 30 days.</p>
      ) : (
        <div className="space-y-1.5 text-sm max-h-80 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between py-1 border-b border-vault-border/50 last:border-b-0">
              <div className="min-w-0">
                <div className="text-white truncate">{r.product?.name || 'Unknown'}</div>
                <div className="text-xs text-gray-500">in stock: {r.stock} · cost moved: {fmt(r.cost30d)}</div>
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <div className="text-white font-bold">{r.units30d}</div>
                <div className="text-xs text-gray-500">units / 30d</div>
              </div>
            </div>
          ))}
        </div>
      )}
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
