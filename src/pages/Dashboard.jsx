import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
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
  Loader2
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

      {/* Quick Stats Preview */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-gray-400 text-sm mb-1">Today's Purchases</p>
          <p className="font-display text-2xl font-bold text-white">--</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm mb-1">Pending Intake</p>
          <p className="font-display text-2xl font-bold text-yellow-400">--</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm mb-1">In Grading</p>
          <p className="font-display text-2xl font-bold text-purple-400">--</p>
        </div>
      </div>

      {/* Daily sealed usage by stream room (boss directive 2026-06-23) */}
      <DailyUsageCard />
    </div>
  )
}

// Per-stream-room SEALED usage for a chosen day — same data the daily
// Lark report sends (/api/daily-usage-report). Defaults to today; the
// date picker lets staff look back. "Usage" = expected − actual from the
// stream-count handoffs + any sealed sold via Platform Sales, valued at
// cost.
function DailyUsageCard() {
  const todayStr = () => new Date().toLocaleDateString('en-CA')
  const [date, setDate] = useState(todayStr())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    const param = date === todayStr() ? 'today=1' : `date=${date}`
    fetch(`/api/daily-usage-report?${param}&dry=1`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d) } })
      .catch(e => { if (!cancelled) setErr(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  const usd = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  return (
    <div className="mt-8 card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
          <Boxes className="text-vault-gold" size={20} /> Sealed usage by room
        </h2>
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value || todayStr())}
          className="text-sm py-1.5 px-2 bg-vault-darker/40 border border-vault-border rounded-md text-white"
        />
      </div>

      {loading && <div className="text-gray-400 flex items-center gap-2 py-4"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {err && !loading && <div className="text-red-300 text-sm py-4">Couldn't load usage: {err}</div>}

      {!loading && !err && data && (
        data.rooms.length === 0 ? (
          <p className="text-gray-500 py-4">No sealed usage recorded {date === todayStr() ? 'today yet' : 'that day'}.</p>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-3">
              Total <span className="text-white font-semibold">{data.total_units} units</span> ·
              <span className="text-vault-gold font-semibold"> {usd(data.total_usd)}</span> at cost
            </p>
            <div className="space-y-3">
              {data.rooms.map((r) => (
                <div key={r.room} className="rounded-lg border border-vault-border bg-vault-darker/30 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-white">{r.room}</span>
                    <span className="text-sm text-gray-300">{r.units} units · <span className="text-vault-gold">{usd(r.usd)}</span></span>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    {r.top.slice(0, 3).map((p, i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="truncate">{p.name} ×{p.units}</span>
                        <span className="flex-shrink-0">{usd(p.usd)}</span>
                      </div>
                    ))}
                    {r.top.length > 3 && <div className="text-gray-600">+{r.top.length - 3} more products</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  )
}
