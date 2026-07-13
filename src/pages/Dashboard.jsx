import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Package,
  ShoppingCart,
  Receipt,
  ArrowRightLeft,
  Box,
  Diamond,
  DollarSign,
  Eye,
  Star,
  BarChart3,
  Plus,
  PackagePlus,
  ClipboardList,
  Boxes,
  Loader2,
  ChevronDown,
  ChevronRight
} from 'lucide-react'

const actions = [
  { 
    path: '/stream-counts', 
    label: 'Stream Counts', 
    icon: ClipboardList, 
    color: 'from-vault-gold to-amber-600'
  },
  { 
    path: '/add-product', 
    label: 'Add New Product', 
    icon: Plus, 
    color: 'from-emerald-500 to-emerald-700'
  },
  { 
    path: '/manual-inventory', 
    label: 'Manual Inventory', 
    icon: PackagePlus, 
    color: 'from-teal-500 to-teal-700'
  },
  { 
    path: '/purchased-items', 
    label: 'Purchased Items', 
    icon: ShoppingCart, 
    color: 'from-blue-500 to-blue-700' 
  },
  { 
    path: '/expenses', 
    label: 'Business Expenses', 
    icon: Receipt, 
    color: 'from-purple-500 to-purple-700' 
  },
  { 
    path: '/intake', 
    label: 'Intake to Master', 
    icon: Package, 
    color: 'from-cyan-500 to-cyan-700' 
  },
  { 
    path: '/move-inventory', 
    label: 'Move Inventory', 
    icon: ArrowRightLeft, 
    color: 'from-orange-500 to-orange-700' 
  },
  { 
    path: '/break-box', 
    label: 'Break Box', 
    icon: Box, 
    color: 'from-pink-500 to-pink-700' 
  },
  { 
    path: '/grading', 
    label: 'Send to Grading', 
    icon: Diamond, 
    color: 'from-indigo-500 to-indigo-700' 
  },
  { 
    path: '/storefront-sale', 
    label: 'Storefront Sale', 
    icon: DollarSign, 
    color: 'from-green-500 to-green-700' 
  },
  { 
    path: '/inventory', 
    label: 'View Inventory', 
    icon: Eye, 
    color: 'from-slate-500 to-slate-700' 
  },
  { 
    path: '/high-value', 
    label: 'High Value Tracking', 
    icon: Star, 
    color: 'from-yellow-500 to-amber-600'
  },
  { 
    path: '/reports', 
    label: 'Reports', 
    icon: BarChart3, 
    color: 'from-red-500 to-red-700'
  },
]

export default function Dashboard() {
  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-white mb-2">
          Welcome to Lucky Vault
        </h1>
        <p className="text-gray-400">What do you want to do today?</p>
      </div>

      {/* Sealed usage by stream room — moved to the TOP (boss 2026-06-23).
          Daily / weekly, per room → per streamer → full product list. */}
      <DailyUsageCard />

      {/* Sealed BUYS — the purchasing mirror of the usage card above
          (boss 2026-06-24). One 进 / one 出, shown together. */}
      <DailyBuyCard />

      {/* 🇯🇵 JP Buyback Board — embeds the nightly kaitori price image so the
          US + JP teams see today's JP market at a glance. Hides itself if the
          image can't load. */}
      <KaitoriBoardCard />

      {/* Quick Stats — wired to real data; each card hides itself when
          it has nothing to show. */}
      <QuickStats />

      {/* Action Grid */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {actions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            className="action-card group"
          >
            <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${action.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
              <action.icon className="text-white" size={28} />
            </div>
            <span className="label text-gray-300 group-hover:text-white transition-colors">
              {action.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// Per-stream-room SEALED usage — same data the Lark report sends
// (/api/daily-usage-report). Daily or Weekly toggle; each room collapses
// (click to expand the FULL product list). Rooms show the full platform +
// channel name. "Usage" = expected − actual from the stream-count
// handoffs + any sealed sold via Platform Sales, valued at cost.
function DailyUsageCard() {
  const todayStr = () => new Date().toLocaleDateString('en-CA')
  const [mode, setMode] = useState('daily')   // 'daily' | 'weekly'
  const [date, setDate] = useState(todayStr())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState({})         // room → expanded?

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null); setOpen({})
    const param = mode === 'weekly'
      ? `week=${date}`
      : (date === todayStr() ? 'today=1' : `date=${date}`)
    fetch(`/api/daily-usage-report?${param}&dry=1`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d) } })
      .catch(e => { if (!cancelled) setErr(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, mode])

  const usd = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  // Quantity is what matters here (cost is only an estimate and can be off),
  // so we lead with it — gold/bold — and split units into boxes vs packs so
  // it's clear at a glance (boss 2026-06-24).
  const qtyLabel = (boxes, packs) => {
    const parts = []
    if (boxes) parts.push(`${boxes} box${boxes === 1 ? '' : 'es'}`)
    if (packs) parts.push(`${packs} pack${packs === 1 ? '' : 's'}`)
    return parts.length ? parts.join(' · ') : '0 units'
  }
  const toggle = (room) => setOpen(o => ({ ...o, [room]: !o[room] }))

  return (
    <div className="mt-8 card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
          <Boxes className="text-vault-gold" size={20} /> Sealed usage by room
        </h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
            {['daily', 'weekly'].map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs rounded-md transition ${mode === m ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}>
                {m === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value || todayStr())}
            className="text-sm py-1.5 px-2 bg-vault-darker/40 border border-vault-border rounded-md text-white"
          />
        </div>
      </div>

      {data?.range_label && !loading && !err && (
        <p className="text-xs text-gray-500 mb-3">{mode === 'weekly' ? 'Week' : 'Day'}: {data.range_label}</p>
      )}

      {loading && <div className="text-gray-400 flex items-center gap-2 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {err && !loading && <div className="text-red-300 text-sm py-4">Couldn't load usage: {err}</div>}

      {!loading && !err && data && (
        data.rooms.length === 0 ? (
          <p className="text-gray-500 py-4">No sealed usage recorded for this {mode === 'weekly' ? 'week' : 'day'}.</p>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-3">
              Total <span className="text-vault-gold font-semibold">{qtyLabel(data.total_boxes, data.total_packs)}</span>
              <span className="text-gray-500"> · {usd(data.total_usd)} at cost</span>
            </p>
            <div className="space-y-2">
              {data.rooms.map((r) => {
                const streamers = r.streamers || []
                const isOpen = !!open[r.room]
                return (
                  <div key={r.room} className="rounded-lg border border-vault-border bg-vault-darker/30">
                    <button type="button" onClick={() => toggle(r.room)}
                      className="w-full flex items-center justify-between gap-2 p-3 hover:bg-vault-darker/50 rounded-lg">
                      <span className="flex items-center gap-2 font-medium text-white">
                        {isOpen ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
                        {r.label || r.room}
                        <span className="text-xs text-gray-500">({streamers.length} streamer{streamers.length === 1 ? '' : 's'})</span>
                      </span>
                      <span className="text-sm">
                        <span className="text-vault-gold font-semibold">{qtyLabel(r.boxes, r.packs)}</span>
                        <span className="text-gray-500"> · {usd(r.usd)}</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-3 max-h-96 overflow-y-auto">
                        {streamers.map((s, si) => (
                          <div key={si}>
                            <div className="flex items-center justify-between text-sm border-b border-vault-border/40 pb-1 mb-1">
                              <span className="text-blue-300 font-medium">👤 {s.name}</span>
                              <span className="text-sm">
                                <span className="text-vault-gold font-medium">{qtyLabel(s.boxes, s.packs)}</span>
                                <span className="text-gray-500"> · {usd(s.usd)}</span>
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 space-y-0.5 pl-2">
                              {s.products.map((p, i) => (
                                <div key={i} className="flex justify-between gap-2">
                                  <span className="truncate">{p.name} <span className="text-vault-gold">×{p.units}</span></span>
                                  <span className="flex-shrink-0 text-gray-500">{usd(p.usd)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      )}
    </div>
  )
}

// Mon–Sun week (date strings, en-CA) containing the given YYYY-MM-DD —
// the in-app analog of weekContaining() used by the buy/usage reports.
function weekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  const dow = (d.getDay() + 6) % 7              // Mon=0 … Sun=6
  const mon = new Date(d); mon.setDate(d.getDate() - dow)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const f = (x) => x.toLocaleDateString('en-CA')
  return { from: f(mon), to: f(sun) }
}

// Aggregate raw `acquisitions` rows into 🇺🇸 US / 🇯🇵 Japan → who bought →
// product. Mirrors api/weekly-buy-report.js: spend = real cost_usd on both
// sides; origin 'jp_to_us_shipment' is logistics (already counted when
// bought in Japan), surfaced as a 🚢 FYI line and NEVER in the totals.
function buildBuys(rows, from, to) {
  let totalUsd = 0, totalUnits = 0
  const side = {
    us: { usd: 0, units: 0, buyers: new Map() },
    jp: { usd: 0, units: 0, buyers: new Map() },
  }
  const shipped = { units: 0, usd: 0 }
  const plabel = (p) => {
    if (!p) return '(unknown product)'
    let s = p.name || '(unnamed)'
    if (p.language && p.language !== 'EN') s += ` [${p.language}]`
    return s
  }
  for (const b of rows) {
    const units = Number(b.quantity_purchased) || 0
    const cu = Number(b.cost_usd) || (b.currency === 'USD' ? Number(b.cost) || 0 : 0)
    if (b.origin === 'jp_to_us_shipment') { shipped.units += units; shipped.usd += cu; continue }
    const s = side[b.origin === 'jp_vendor' ? 'jp' : 'us']
    s.usd += cu; s.units += units
    totalUsd += cu; totalUnits += units
    const who = b.acquirer?.name || '(unknown)'
    const bu = s.buyers.get(who) || { usd: 0, units: 0, products: new Map() }
    bu.usd += cu; bu.units += units
    const label = plabel(b.product)
    const pr = bu.products.get(label) || { name: label, units: 0, usd: 0 }
    pr.units += units; pr.usd += cu
    bu.products.set(label, pr)
    s.buyers.set(who, bu)
  }
  const groups = [
    { key: 'us', label: '🇺🇸 US', ...side.us },
    { key: 'jp', label: '🇯🇵 Japan', ...side.jp },
  ].filter(g => g.units > 0 || g.usd > 0).map(g => ({
    key: g.key, label: g.label, units: g.units, usd: g.usd,
    buyers: [...g.buyers.entries()].map(([name, b]) => ({
      name, units: b.units, usd: b.usd,
      products: [...b.products.values()].sort((a, c) => c.usd - a.usd),
    })).sort((a, c) => c.usd - a.usd),
  }))
  return {
    range_label: from === to ? from : `${from} → ${to}`,
    total_units: totalUnits, total_usd: totalUsd,
    us: { usd: side.us.usd, units: side.us.units },
    jp: { usd: side.jp.usd, units: side.jp.units },
    shipped, groups,
  }
}

// Per-day / per-week SEALED BUYS — the purchasing mirror of the usage card
// (boss 2026-06-24: "记录每天/每周 buy 的 record like 记录每天用量"). Pulled
// straight from `acquisitions` (single table, real cost_usd — no valued-
// at-cost estimate needed), grouped 🇺🇸 US / 🇯🇵 Japan → who bought →
// product. Same daily/weekly UX as the usage card above it.
function DailyBuyCard() {
  const todayStr = () => new Date().toLocaleDateString('en-CA')
  const [mode, setMode] = useState('daily')    // 'daily' | 'weekly'
  const [date, setDate] = useState(todayStr())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState({})          // group key → expanded?

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null); setOpen({})
    ;(async () => {
      try {
        const { from, to } = mode === 'weekly' ? weekRange(date) : { from: date, to: date }
        const { data: rows, error } = await supabase
          .from('acquisitions')
          .select('quantity_purchased, cost, currency, cost_usd, origin, acquirer:users!acquisitions_acquirer_id_fkey(name), product:products(name, brand, language, type)')
          .eq('deleted', false)
          .gte('date_purchased', from)
          .lte('date_purchased', to)
        if (error) throw error
        if (!cancelled) setData(buildBuys(rows || [], from, to))
      } catch (e) { if (!cancelled) setErr(e.message || String(e)) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [date, mode])

  const usd = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))

  return (
    <div className="mt-8 card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
          <ShoppingCart className="text-vault-gold" size={20} /> Sealed buys by side
        </h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
            {['daily', 'weekly'].map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs rounded-md transition ${mode === m ? 'bg-vault-gold text-vault-dark font-semibold' : 'text-gray-400 hover:text-white'}`}>
                {m === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value || todayStr())}
            className="text-sm py-1.5 px-2 bg-vault-darker/40 border border-vault-border rounded-md text-white"
          />
        </div>
      </div>

      {data?.range_label && !loading && !err && (
        <p className="text-xs text-gray-500 mb-3">{mode === 'weekly' ? 'Week' : 'Day'}: {data.range_label}</p>
      )}

      {loading && <div className="text-gray-400 flex items-center gap-2 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {err && !loading && <div className="text-red-300 text-sm py-4">Couldn't load buys: {err}</div>}

      {!loading && !err && data && (
        data.groups.length === 0 ? (
          <p className="text-gray-500 py-4">No buys recorded for this {mode === 'weekly' ? 'week' : 'day'}.</p>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-1">
              Total <span className="text-white font-semibold">{data.total_units} units</span> ·
              <span className="text-vault-gold font-semibold"> {usd(data.total_usd)}</span> spent
            </p>
            <p className="text-xs text-gray-500 mb-3">
              🇺🇸 US {usd(data.us.usd)} ({data.us.units}u) · 🇯🇵 Japan {usd(data.jp.usd)} ({data.jp.units}u)
              {data.shipped.units > 0 && <span> · 🚢 JP→US {data.shipped.units}u (logistics, not spend)</span>}
            </p>
            <div className="space-y-2">
              {data.groups.map((g) => {
                const buyers = g.buyers || []
                const isOpen = !!open[g.key]
                return (
                  <div key={g.key} className="rounded-lg border border-vault-border bg-vault-darker/30">
                    <button type="button" onClick={() => toggle(g.key)}
                      className="w-full flex items-center justify-between gap-2 p-3 hover:bg-vault-darker/50 rounded-lg">
                      <span className="flex items-center gap-2 font-medium text-white">
                        {isOpen ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
                        {g.label}
                        <span className="text-xs text-gray-500">({buyers.length} buyer{buyers.length === 1 ? '' : 's'})</span>
                      </span>
                      <span className="text-sm text-gray-300">{g.units} units · <span className="text-vault-gold">{usd(g.usd)}</span></span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-3 max-h-96 overflow-y-auto">
                        {buyers.map((b, bi) => (
                          <div key={bi}>
                            <div className="flex items-center justify-between text-sm border-b border-vault-border/40 pb-1 mb-1">
                              <span className="text-emerald-300 font-medium">👤 {b.name}</span>
                              <span className="text-gray-300">{b.units} units · <span className="text-vault-gold">{usd(b.usd)}</span></span>
                            </div>
                            <div className="text-xs text-gray-400 space-y-0.5 pl-2">
                              {b.products.map((p, i) => (
                                <div key={i} className="flex justify-between gap-2">
                                  <span className="truncate">{p.name} ×{p.units}</span>
                                  <span className="flex-shrink-0 text-gray-300">{usd(p.usd)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      )}
    </div>
  )
}

// 🇯🇵 JP Buyback Board — embeds the nightly-rendered kaitori (買取) price
// board image, served at a fixed public URL that updates in place ~23:40
// (boss: US + JP teams see today's JP market at a glance). The ?v= day
// stamp busts the browser cache once per day; if the image can't load we
// hide the whole card — no broken-image icon.
function KaitoriBoardCard() {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  const day = new Date().toLocaleDateString('en-CA').replace(/-/g, '')
  const url = `https://lv-slabs.luckyvault.us/kaitori/today.png?v=${day}`
  return (
    <div className="mt-8 card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
          <BarChart3 className="text-vault-gold" size={20} /> 🇯🇵 日本買取行情 · JP Buyback Board
        </h2>
        <a href={url} target="_blank" rel="noreferrer"
          className="text-xs text-vault-gold hover:underline">
          在新窗口打开 · Open full size
        </a>
      </div>
      <p className="text-xs text-gray-500 mb-3">每晚 23:40 自动更新 · auto-updates nightly</p>
      <div className="max-h-[420px] overflow-y-auto">
        <img
          src={url}
          loading="lazy"
          alt="JP Buyback Board"
          onError={() => setBroken(true)}
          className="w-full rounded-lg"
        />
      </div>
    </div>
  )
}

// Wired Today's Purchases / Pending Intake / In Grading. Each tile hides
// itself when its metric is zero (boss directive 2026-06-23 — "if it's
// useless, don't show it").
function QuickStats() {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const today = new Date().toLocaleDateString('en-CA')
      try {
        const [purch, pending, grading] = await Promise.all([
          // Today's purchases — acquisitions logged today (real buys, not JP→US transfers)
          supabase.from('acquisitions').select('id', { count: 'exact', head: true })
            .eq('deleted', false).eq('date_purchased', today).neq('origin', 'jp_to_us_shipment'),
          // Pending intake — ordered but not fully received yet
          supabase.from('acquisitions').select('id', { count: 'exact', head: true })
            .eq('deleted', false).in('status', ['Purchased', 'Partially Received']),
          // In grading — slabs sitting at any "Grading - ..." location
          supabase.from('slabs').select('id, location:locations!inner(name)', { count: 'exact', head: true })
            .eq('deleted', false).like('location.name', 'Grading -%'),
        ])
        if (cancelled) return
        setStats({
          purchases: purch.count || 0,
          pending: pending.count || 0,
          grading: grading.count || 0,
        })
      } catch (e) { console.warn('[dashboard] quick stats failed:', e); if (!cancelled) setStats({}) }
    })()
    return () => { cancelled = true }
  }, [])

  if (!stats) return null
  const tiles = [
    { label: "Today's Purchases", value: stats.purchases, cls: 'text-white' },
    { label: 'Pending Intake', value: stats.pending, cls: 'text-yellow-400' },
    { label: 'In Grading', value: stats.grading, cls: 'text-purple-400' },
  ].filter(t => t.value > 0)
  if (tiles.length === 0) return null

  return (
    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
      {tiles.map(t => (
        <div key={t.label} className="card">
          <p className="text-gray-400 text-sm mb-1">{t.label}</p>
          <p className={`font-display text-2xl font-bold ${t.cls}`}>{t.value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  )
}
