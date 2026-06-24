import React, { useState, useEffect } from 'react'
import { fetchWeeklyUsage } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import {
  BarChart3, ChevronLeft, ChevronRight, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'

// How many goods to show before "展开全部".
const TOP_N = 8

// Compact "where it sold from" tag for one product row. One channel → label;
// multiple → ranked breakdown. `defs` is [{ key, label, cls }] in display order.
function channelBreakdown(p, defs) {
  const parts = defs
    .map(d => ({ ...d, n: p[d.key] || 0 }))
    .filter(d => d.n > 0)
    .sort((a, b) => b.n - a.n)
  return parts
}

// ============================================================================
// 每周用量 / Weekly Usage
// ============================================================================
// Units that left inventory to customers in a chosen week, by channel:
//   门店 storefront · 直播 livestream · 线上 online → US subtotal
//   日本 Japan reported separately (different warehouse).
// "Usage" excludes internal flows (moves / break box / JP→US transfer) so the
// number reflects real demand, not stock shuffling. See fetchWeeklyUsage.
// ============================================================================

// Trim the trailing category off a full product name for a cleaner label
// (e.g. "OP-15 Adventure ... Booster Box" + category "Booster Box").
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const re = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(re, '').trim() || fullName
}

// Monday (local) of the week containing `d`. Weeks run Mon–Sun.
const mondayOf = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7   // 0 = Monday
  x.setDate(x.getDate() - day)
  return x
}
const toYMD = (d) => {
  const x = new Date(d)
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${m}-${day}`
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

export default function WeeklyUsage() {
  const { toasts, addToast, removeToast } = useToast()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAllUs, setShowAllUs] = useState(false)
  const [showAllJp, setShowAllJp] = useState(false)

  const weekEnd = addDays(weekStart, 6)
  const start = toYMD(weekStart)
  const end = toYMD(weekEnd)
  const isThisWeek = toYMD(mondayOf(new Date())) === start

  useEffect(() => { load() }, [start, end])

  const load = async () => {
    try {
      setLoading(true)
      const res = await fetchWeeklyUsage(start, end)
      setData(res)
    } catch (err) {
      console.error(err)
      addToast(err.message || 'Failed to load weekly usage', 'error')
    } finally {
      setLoading(false)
    }
  }

  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))
  const thisWeek = () => setWeekStart(mondayOf(new Date()))

  const rangeLabel = `${start} → ${end}`

  return (
    <div className="fade-in space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <BarChart3 className="text-vault-gold" />
            每周用量 / Weekly Usage
          </h1>
          <p className="text-gray-400 mt-1">
            本周卖出(出库到客人)的件数,按渠道分。内部调拨 / 拆盒 / 日本→美国发货不计入。
          </p>
        </div>
        <button onClick={load}
          className="px-3 py-2 bg-vault-surface border border-vault-border hover:border-vault-gold text-sm text-gray-300 rounded-lg flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Week selector */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-4 flex items-center justify-between">
        <button onClick={prevWeek}
          className="px-3 py-2 bg-vault-darker border border-vault-border hover:border-vault-gold text-sm text-gray-300 rounded-lg flex items-center gap-1">
          <ChevronLeft size={14} /> 上一周
        </button>
        <div className="text-center">
          <div className="text-white font-semibold">{rangeLabel}</div>
          <div className="text-xs text-gray-500">{isThisWeek ? '本周 (Mon–Sun)' : '周 (Mon–Sun)'}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isThisWeek && (
            <button onClick={thisWeek}
              className="px-3 py-2 bg-vault-darker border border-vault-border hover:border-vault-gold text-sm text-gray-300 rounded-lg">
              本周
            </button>
          )}
          <button onClick={nextWeek} disabled={isThisWeek}
            className="px-3 py-2 bg-vault-darker border border-vault-border hover:border-vault-gold text-sm text-gray-300 rounded-lg flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed">
            下一周 <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="spinner" /></div>
      ) : !data ? (
        <p className="text-gray-500 text-sm">No data.</p>
      ) : (
        <>
          {/* 1️⃣ 本周卖出 — headline + channel split + Japan separate */}
          <Section n="1️⃣" title="本周卖出">
            <div className="flex items-baseline gap-2">
              <span className="text-gray-400 text-sm">🇺🇸 美国合计</span>
              <span className="text-3xl font-bold text-vault-gold">{data.usSubtotal.toLocaleString()}</span>
              <span className="text-gray-400 text-sm">件</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span><span className="text-amber-400">🏪 门店</span> <b className="text-white">{data.storefront.units.toLocaleString()}</b> <span className="text-gray-600 text-xs">· {data.storefront.txns} 笔</span></span>
              <span><span className="text-blue-400">📺 直播</span> <b className="text-white">{data.stream.units.toLocaleString()}</b> <span className="text-gray-600 text-xs">· {data.stream.sessions} 场</span></span>
              <span><span className="text-emerald-400">🛒 线上</span> <b className="text-white">{data.online.units.toLocaleString()}</b> <span className="text-gray-600 text-xs">· {data.online.orders} 单</span></span>
            </div>
            <div className="mt-3 pt-3 border-t border-vault-border/60 text-sm text-gray-400">
              🇯🇵 日本仓(单独) <b className="text-white">{data.japan.units.toLocaleString()}</b> 件
              <span className="text-gray-600 text-xs"> · 📺 直播 {data.japan.stream.toLocaleString()} · 🏪 当地 {data.japan.local.toLocaleString()}</span>
            </div>
          </Section>

          {/* 2️⃣ 美国卖得最多的货物 — top N + fold */}
          <Section n="2️⃣" title="美国卖得最多的货物" right={`${data.products.length} 种`}>
            {data.products.length === 0 ? (
              <p className="text-gray-500 text-sm py-1">本周美国没有货物卖出。</p>
            ) : (
              <>
                <div className="divide-y divide-vault-border/40">
                  {(showAllUs ? data.products : data.products.slice(0, TOP_N)).map((p, i) => (
                    <ProductLine key={p.product_id} rank={i + 1} p={p}
                      defs={[
                        { key: 'storefront', label: '门店', cls: 'text-amber-300' },
                        { key: 'stream', label: '直播', cls: 'text-blue-300' },
                        { key: 'online', label: '线上', cls: 'text-emerald-300' },
                      ]} />
                  ))}
                </div>
                {data.products.length > TOP_N && (
                  <FoldToggle open={showAllUs} onClick={() => setShowAllUs(s => !s)}
                    moreCount={data.products.length - TOP_N} />
                )}
              </>
            )}
          </Section>

          {/* 3️⃣ 日本仓货物 — top N + fold */}
          <Section n="3️⃣" title="日本仓卖得最多的货物" right={`${data.japan.products.length} 种 · 单独`}>
            {data.japan.products.length === 0 ? (
              <p className="text-gray-500 text-sm py-1">本周日本仓没有货物卖出。</p>
            ) : (
              <>
                <div className="divide-y divide-vault-border/40">
                  {(showAllJp ? data.japan.products : data.japan.products.slice(0, TOP_N)).map((p, i) => (
                    <ProductLine key={p.product_id} rank={i + 1} p={p}
                      defs={[
                        { key: 'stream', label: '直播', cls: 'text-blue-300' },
                        { key: 'local', label: '当地', cls: 'text-purple-300' },
                      ]} />
                  ))}
                </div>
                {data.japan.products.length > TOP_N && (
                  <FoldToggle open={showAllJp} onClick={() => setShowAllJp(s => !s)}
                    moreCount={data.japan.products.length - TOP_N} />
                )}
              </>
            )}
          </Section>

          {/* 口径说明 — small footnote */}
          <div className="text-[11px] text-gray-500 leading-relaxed px-1">
            只统计货物(封装盒/包),散卡和评级卡走各自系统不在此。计入卖给客人的出库(门店/直播/线上);
            不计入调拨、拆盒、日本→美国发货等内部流转。周一至周日。
          </div>
        </>
      )}
    </div>
  )
}

// Numbered section wrapper — gives every block the same "n️⃣ Title …… right"
// header so the page reads top-to-bottom like the Buy Report template.
function Section({ n, title, right, children }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white text-sm flex items-center gap-2">
          <span>{n}</span> {title}
        </h3>
        {right && <span className="text-xs text-gray-500">{right}</span>}
      </div>
      {children}
    </div>
  )
}

// One product row: rank · name · total (big) · where-it-sold-from breakdown.
function ProductLine({ rank, p, defs }) {
  const parts = channelBreakdown(p, defs)
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-gray-600 text-xs w-5 text-right flex-shrink-0">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm truncate">
          {p.short_code && <span className="text-[10px] font-mono text-gray-500 mr-1.5">{p.short_code}</span>}
          {extractLaunchName(p.name, p.category)}
          {p.language && <span className="text-gray-500 text-xs"> [{p.language}]</span>}
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
          {parts.map(d => (
            <span key={d.key}><span className={d.cls}>{d.label}</span> {d.n}</span>
          ))}
        </div>
      </div>
      <span className="text-vault-gold font-semibold text-sm flex-shrink-0">{p.total.toLocaleString()}</span>
    </div>
  )
}

function FoldToggle({ open, onClick, moreCount }) {
  return (
    <button onClick={onClick}
      className="w-full mt-2 py-1.5 text-xs text-gray-400 hover:text-vault-gold flex items-center justify-center gap-1">
      {open ? <><ChevronUp size={13} /> 收起</> : <><ChevronDown size={13} /> 展开全部(还有 {moreCount} 种)</>}
    </button>
  )
}
