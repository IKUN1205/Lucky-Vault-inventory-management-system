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
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-2">
          Welcome to Lucky Vault
        </h1>
        <p className="text-gray-400">What do you want to do today?</p>
      </div>

      {/* Action Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

      {/* Quick Stats — wired to real data; each card hides itself when
          it has nothing to show (boss directive 2026-06-23). */}
      <QuickStats />

      {/* Sealed usage by stream room — daily / weekly (boss 2026-06-23) */}
      <DailyUsageCard />
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
              Total <span className="text-white font-semibold">{data.total_units} units</span> ·
              <span className="text-vault-gold font-semibold"> {usd(data.total_usd)}</span> at cost
            </p>
            <div className="space-y-2">
              {data.rooms.map((r) => {
                const products = r.products || r.top || []
                const isOpen = !!open[r.room]
                return (
                  <div key={r.room} className="rounded-lg border border-vault-border bg-vault-darker/30">
                    <button type="button" onClick={() => toggle(r.room)}
                      className="w-full flex items-center justify-between gap-2 p-3 hover:bg-vault-darker/50 rounded-lg">
                      <span className="flex items-center gap-2 font-medium text-white">
                        {isOpen ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
                        {r.label || r.room}
                        <span className="text-xs text-gray-500">({products.length} product{products.length === 1 ? '' : 's'})</span>
                      </span>
                      <span className="text-sm text-gray-300">{r.units} units · <span className="text-vault-gold">{usd(r.usd)}</span></span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 text-xs text-gray-400 space-y-0.5 max-h-80 overflow-y-auto">
                        {products.map((p, i) => (
                          <div key={i} className="flex justify-between gap-2 border-b border-vault-border/20 py-1 last:border-0">
                            <span className="truncate">{p.name} ×{p.units}</span>
                            <span className="flex-shrink-0 text-gray-300">{usd(p.usd)}</span>
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
