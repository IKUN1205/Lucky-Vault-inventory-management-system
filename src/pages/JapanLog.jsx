import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchJapanAcquisitions,
  fetchJapanStreamSales,
  fetchJapanToUSShipments,
  convertToUSD,
} from '../lib/supabase'
import {
  History, ShoppingCart, Tv2, Truck, Filter, RefreshCw, Search, AlertCircle, Store
} from 'lucide-react'
import { variantLabel, variantChipClasses } from '../lib/japanVariants'

// ============================================================================
// 日本日志 / Japan Activity Log
// ============================================================================
// Unified chronological timeline of every Japan-side write event:
//   - 🛒 进货 (acquisitions where origin = 'jp_vendor')
//   - 📺 直播售卖 (japan_stream_sales rows)
//   - 🚚 美国发货 (acquisitions where origin = 'jp_to_us_shipment')
//
// Each source returns its own shape; we normalize into a flat timeline row
// shape and merge-sort by timestamp before render. The page intentionally
// stays read-only — undo / edit happens on the source pages.
// ============================================================================

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// `sale` and `local_sale` are two faces of the same japan_stream_sales table
// (distinguished by the `channel` column). We render them as different rows
// in the timeline so operators can spot at a glance whether revenue came
// from a livestream vs an over-the-counter sale, even though the underlying
// inventory math is identical.
const TYPE_META = {
  acquisition: { zh: '进货',     en: 'Intake', icon: ShoppingCart, color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', sign: '+' },
  sale:        { zh: '直播售卖', en: 'Stream', icon: Tv2,          color: 'bg-blue-500/15 text-blue-300 border-blue-500/40',         sign: '−' },
  local_sale:  { zh: '当地售卖', en: 'Local',  icon: Store,        color: 'bg-purple-500/15 text-purple-300 border-purple-500/40',   sign: '−' },
  shipment:    { zh: '发货',     en: 'Ship',   icon: Truck,        color: 'bg-orange-500/15 text-orange-300 border-orange-500/40',   sign: '−' },
}

export default function JapanLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true); setError(null)
      // Pull all three sources concurrently. We grab a wide window (200
      // each) — the JS merge below caps the visible list at 200 after
      // sort. Real usage is dozens of events per week so this is plenty.
      const [acqs, sales, ships] = await Promise.all([
        fetchJapanAcquisitions(200),
        fetchJapanStreamSales(200),
        fetchJapanToUSShipments({ limit: 200, includeAll: true }),
      ])

      const timeline = []

      // 进货 normalization
      for (const a of acqs) {
        timeline.push({
          id: 'acq-' + a.id,
          type: 'acquisition',
          ts: a.created_at || a.date_purchased,        // created_at is best; falls back to date
          dateStr: a.date_purchased,
          actor: a.acquirer?.name || '—',
          product: a.product,
          quantity: a.quantity_purchased || 0,
          jpy: Number(a.cost || 0),
          usd: Number(a.cost_usd || 0),
          notes: a.notes,
          extraLabel: a.vendor?.name && `vendor: ${a.vendor.name}`,
          link: '/jp/acquisitions',
        })
      }

      // 售卖 normalization — both stream and local sales live in
      // japan_stream_sales, distinguished by `channel`. Default to 'stream'
      // for legacy rows written before the channel column existed.
      for (const s of sales) {
        const isLocal = s.channel === 'local'
        timeline.push({
          id: 'sale-' + s.id,
          type: isLocal ? 'local_sale' : 'sale',
          ts: s.created_at || s.sale_date,
          dateStr: s.sale_date,
          actor: s.streamer?.name || '—',
          product: s.product,
          quantity: s.quantity || 0,
          jpy: Number(s.revenue_jpy || 0),
          usd: Number(s.revenue_usd || 0),
          notes: s.notes,
          extraLabel: s.recorded_by?.name && s.recorded_by.name !== s.streamer?.name
            ? `recorded by: ${s.recorded_by.name}` : null,
          link: isLocal ? '/jp/local-sales' : '/jp/stream-sales',
        })
      }

      // 美国发货 normalization. acquirer_id = shipper for jp_to_us_shipment.
      for (const sh of ships) {
        const isReceived = sh.status === 'Received'
        timeline.push({
          id: 'ship-' + sh.id,
          type: 'shipment',
          ts: sh.created_at || sh.date_purchased,
          dateStr: sh.date_purchased,
          actor: sh.acquirer?.name || '—',
          product: sh.product,
          quantity: sh.quantity_purchased || 0,
          jpy: Number(sh.cost || 0),
          usd: Number(sh.cost_usd || 0),
          notes: sh.notes,
          extraLabel: [
            sh.carrier && `${sh.carrier}${sh.tracking_number ? ' · ' + sh.tracking_number : ''}`,
            isReceived && 'received in US',
          ].filter(Boolean).join(' · '),
          status: sh.status,
          link: '/jp/shipments',
        })
      }

      // Sort newest first, cap to 200 visible
      timeline.sort((a, b) => new Date(b.ts) - new Date(a.ts))
      setRows(timeline.slice(0, 200))
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to load Japan activity')
    } finally {
      setLoading(false)
    }
  }

  // Filter — by type and free-text search
  const filtered = useMemo(() => {
    let out = rows
    if (typeFilter) out = out.filter(r => r.type === typeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter(r => {
        const hay = [
          r.product?.name, r.product?.short_code, r.actor, r.notes, r.extraLabel,
          ...(Array.isArray(r.product?.aliases) ? r.product.aliases : []),
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    return out
  }, [rows, typeFilter, search])

  const summary = useMemo(() => {
    const groups = { acquisition: 0, sale: 0, local_sale: 0, shipment: 0 }
    let inflow = 0, outflow = 0, jpyAcq = 0, jpySale = 0, jpyLocalSale = 0, jpyShip = 0
    for (const r of filtered) {
      groups[r.type] = (groups[r.type] || 0) + 1
      if (r.type === 'acquisition') { inflow += r.quantity; jpyAcq += r.jpy }
      else { outflow += r.quantity }
      if (r.type === 'sale') jpySale += r.jpy
      if (r.type === 'local_sale') jpyLocalSale += r.jpy
      if (r.type === 'shipment') jpyShip += r.jpy
    }
    return { groups, inflow, outflow, jpyAcq, jpySale, jpyLocalSale, jpyShip }
  }, [filtered])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner" /></div>

  return (
    <div className="fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <History className="text-vault-gold" />
            🇯🇵 日本日志 / Japan Activity Log
          </h1>
          <p className="text-gray-400 mt-1">
            Unified timeline of every Japan write event — 进货, 直播售卖, 美国发货. Read-only; undo/edit on the source page.
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard
          label="进货 Intake"
          value={summary.groups.acquisition}
          subtext={`+${summary.inflow.toLocaleString()} units · ¥${summary.jpyAcq.toLocaleString()}`}
          colorClass="text-emerald-400"
        />
        <StatCard
          label="直播售卖 Stream"
          value={summary.groups.sale}
          subtext={`¥${summary.jpySale.toLocaleString()} revenue`}
          colorClass="text-blue-400"
        />
        <StatCard
          label="当地售卖 Local"
          value={summary.groups.local_sale}
          subtext={`¥${summary.jpyLocalSale.toLocaleString()} revenue`}
          colorClass="text-purple-400"
        />
        <StatCard
          label="发货 Ship"
          value={summary.groups.shipment}
          subtext={`¥${summary.jpyShip.toLocaleString()} cost basis`}
          colorClass="text-orange-400"
        />
        <StatCard
          label="Net units"
          value={summary.inflow - summary.outflow}
          subtext={`+${summary.inflow} − ${summary.outflow}`}
          colorClass={summary.inflow - summary.outflow >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Events shown"
          value={filtered.length}
          subtext={filtered.length < rows.length ? `of ${rows.length} total` : 'all'}
        />
      </div>

      {/* Filters */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-400 mb-1">Search (product / short code / actor / notes)</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="e.g. M2a, Yuki, EE12345..."
                className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <div className="flex flex-wrap gap-1">
              <TypeChip active={typeFilter === ''} onClick={() => setTypeFilter('')}>All</TypeChip>
              <TypeChip active={typeFilter === 'acquisition'} onClick={() => setTypeFilter('acquisition')} color="bg-emerald-500/20 border-emerald-500/40 text-emerald-300">进货</TypeChip>
              <TypeChip active={typeFilter === 'sale'} onClick={() => setTypeFilter('sale')} color="bg-blue-500/20 border-blue-500/40 text-blue-300">直播</TypeChip>
              <TypeChip active={typeFilter === 'local_sale'} onClick={() => setTypeFilter('local_sale')} color="bg-purple-500/20 border-purple-500/40 text-purple-300">当地</TypeChip>
              <TypeChip active={typeFilter === 'shipment'} onClick={() => setTypeFilter('shipment')} color="bg-orange-500/20 border-orange-500/40 text-orange-300">发货</TypeChip>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline table */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
          <Filter size={14} className="text-vault-gold" />
          {filtered.length} event{filtered.length === 1 ? '' : 's'} (newest first)
        </h3>

        {filtered.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">
            {rows.length === 0
              ? 'No Japan activity yet. Try recording an 进货 or 直播售卖 first.'
              : 'No events match these filters.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">When</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">变体</th>
                  <th className="pb-2">By</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">JPY</th>
                  <th className="pb-2 text-right">≈ USD</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => <LogRow key={r.id} r={r} />)}
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
      {subtext && <div className="text-xs text-gray-500 mt-0.5 truncate" title={subtext}>{subtext}</div>}
    </div>
  )
}

function TypeChip({ children, active, onClick, color }) {
  const base = 'px-2.5 py-1.5 text-xs font-semibold rounded-md border transition cursor-pointer flex-1 text-center'
  const cls = active
    ? (color || 'bg-vault-gold/20 border-vault-gold/60 text-vault-gold')
    : 'bg-vault-darker border-vault-border text-gray-400 hover:text-white hover:border-vault-gold/40'
  return <button type="button" onClick={onClick} className={`${base} ${cls}`}>{children}</button>
}

function LogRow({ r }) {
  const meta = TYPE_META[r.type] || {}
  const Icon = meta.icon
  const variant = r.product?.variant
  const ts = r.ts ? new Date(r.ts) : null
  const dayStr = ts ? ts.toLocaleDateString('en-CA') : (r.dateStr || '—')
  const timeStr = ts ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <tr className="border-b border-vault-border/40 hover:bg-vault-darker/30">
      <td className="py-2 align-top">
        <div className="text-gray-300 text-xs">{dayStr}</div>
        <div className="text-gray-500 text-[10px]">{timeStr}</div>
      </td>
      <td className="py-2 align-top">
        <Link
          to={r.link}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold border ${meta.color} hover:opacity-80`}
          title={`Open ${meta.en} page`}
        >
          {Icon && <Icon size={11} />}
          {meta.zh}
        </Link>
      </td>
      <td className="py-2 align-top">
        <div className="flex items-center gap-1.5">
          {r.product?.short_code && (
            <span className="text-[10px] font-mono text-gray-500">{r.product.short_code}</span>
          )}
          <span className="text-white text-sm">
            {extractLaunchName(r.product?.name, r.product?.category) || r.product?.name || '—'}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {r.actor && <span className="text-[10px] text-gray-500">{r.product?.brand} · {r.product?.language}</span>}
        </div>
        {(r.extraLabel || r.notes) && (
          <div className="text-[10px] text-gray-500 mt-0.5">
            {r.extraLabel && <span>{r.extraLabel}</span>}
            {r.extraLabel && r.notes && <span className="mx-1">·</span>}
            {r.notes && <span className="italic">"{r.notes}"</span>}
          </div>
        )}
      </td>
      <td className="py-2 align-top">
        {variant ? (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${variantChipClasses(variant)}`}>
            {variantLabel(variant)}
          </span>
        ) : <span className="text-gray-600 text-xs">—</span>}
      </td>
      <td className="py-2 align-top text-gray-300 text-xs">{r.actor}</td>
      <td className={`py-2 align-top text-right font-semibold ${
        r.type === 'acquisition' ? 'text-emerald-300' : 'text-orange-300'
      }`}>
        {meta.sign}{r.quantity.toLocaleString()}
      </td>
      <td className="py-2 align-top text-right text-vault-gold text-xs">
        {r.jpy ? '¥' + r.jpy.toLocaleString() : '—'}
      </td>
      <td className="py-2 align-top text-right text-green-400 text-xs">
        {r.usd ? '$' + r.usd.toFixed(2) : '—'}
      </td>
    </tr>
  )
}
