import React, { useState, useEffect } from 'react'
import { fetchWeeklyUsage } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import {
  BarChart3, ChevronLeft, ChevronRight, RefreshCw, Store, Tv2, ShoppingBag,
} from 'lucide-react'

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
          {/* US channels */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ChannelCard
              icon={Store} colorClass="text-amber-400"
              zh="门店" en="Storefront"
              units={data.storefront.units}
              sub={`${data.storefront.txns} 笔`}
            />
            <ChannelCard
              icon={Tv2} colorClass="text-blue-400"
              zh="直播" en="Livestream"
              units={data.stream.units}
              sub={`${data.stream.sessions} 场`}
            />
            <ChannelCard
              icon={ShoppingBag} colorClass="text-emerald-400"
              zh="线上" en="Online"
              units={data.online.units}
              sub={`${data.online.orders} 单`}
            />
          </div>

          {/* US subtotal */}
          <div className="bg-vault-gold/10 border border-vault-gold/40 rounded-lg p-5 flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-300">🇺🇸 美国合计 (门店 + 直播 + 线上)</div>
              <div className="text-xs text-gray-500 mt-0.5">{rangeLabel}</div>
            </div>
            <div className="text-3xl font-bold text-vault-gold">{data.usSubtotal.toLocaleString()} <span className="text-base font-normal text-gray-400">件</span></div>
          </div>

          {/* US per-product breakdown: which goods, sold from which channel */}
          <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
            <h3 className="font-semibold text-white text-sm mb-3">🇺🇸 美国 · 按货物明细(从哪个渠道卖出)</h3>
            {data.products.length === 0 ? (
              <p className="text-gray-500 text-sm py-3">本周美国没有货物卖出。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                      <th className="pb-2">货物 Product</th>
                      <th className="pb-2 text-right">🏪 门店</th>
                      <th className="pb-2 text-right">📺 直播</th>
                      <th className="pb-2 text-right">🛒 线上</th>
                      <th className="pb-2 text-right">合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map(p => (
                      <tr key={p.product_id} className="border-b border-vault-border/40">
                        <td className="py-1.5 text-white">
                          {p.short_code && <span className="text-[10px] font-mono text-gray-500 mr-1.5">{p.short_code}</span>}
                          {extractLaunchName(p.name, p.category)}
                          {p.language && <span className="text-gray-500 text-xs"> [{p.language}]</span>}
                        </td>
                        <td className="py-1.5 text-right text-amber-300">{p.storefront || '—'}</td>
                        <td className="py-1.5 text-right text-blue-300">{p.stream || '—'}</td>
                        <td className="py-1.5 text-right text-emerald-300">{p.online || '—'}</td>
                        <td className="py-1.5 text-right text-vault-gold font-semibold">{p.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Japan — reported separately */}
          <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white text-sm">🇯🇵 日本仓 · 按货物明细(单独,不计入美国合计)</h3>
              <div className="text-sm font-bold text-white">{data.japan.units.toLocaleString()} <span className="text-xs font-normal text-gray-400">件</span></div>
            </div>
            {data.japan.products.length === 0 ? (
              <p className="text-gray-500 text-sm py-3">本周日本仓没有货物卖出。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                      <th className="pb-2">货物 Product</th>
                      <th className="pb-2 text-right">📺 直播</th>
                      <th className="pb-2 text-right">🏪 当地</th>
                      <th className="pb-2 text-right">合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.japan.products.map(p => (
                      <tr key={p.product_id} className="border-b border-vault-border/40">
                        <td className="py-1.5 text-white">
                          {p.short_code && <span className="text-[10px] font-mono text-gray-500 mr-1.5">{p.short_code}</span>}
                          {extractLaunchName(p.name, p.category)}
                          {p.language && <span className="text-gray-500 text-xs"> [{p.language}]</span>}
                        </td>
                        <td className="py-1.5 text-right text-blue-300">{p.stream || '—'}</td>
                        <td className="py-1.5 text-right text-purple-300">{p.local || '—'}</td>
                        <td className="py-1.5 text-right text-vault-gold font-semibold">{p.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* What's counted / excluded */}
          <div className="bg-vault-darker/40 border border-vault-border rounded-lg p-4 text-xs text-gray-400 leading-relaxed">
            <div className="text-gray-300 font-semibold mb-1">口径说明</div>
            <div>✅ 只统计货物(封装盒/包)。散卡(single)和评级卡(slab)走各自的系统,不在这里。</div>
            <div>✅ 计入:卖给客人的出库 —— 门店、直播(每场盘点卖出)、线上(订单)。</div>
            <div>❌ 不计入:调拨库存、拆盒、日本→美国发货(内部流转);platform_sales(旧扫码卡,基本没用)。</div>
            <div className="mt-1 text-gray-500">周界:周一至周日。直播按盘点时间归周,跨午夜的极少数场次可能有 ±1 天误差。</div>
          </div>
        </>
      )}
    </div>
  )
}

function ChannelCard({ icon: Icon, colorClass, zh, en, units, sub }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        {Icon && <Icon size={16} className={colorClass} />}
        <span className="text-white font-medium">{zh}</span>
        <span className="text-gray-500">{en}</span>
      </div>
      <div className={`text-3xl font-bold mt-2 ${colorClass}`}>{units.toLocaleString()} <span className="text-base font-normal text-gray-500">件</span></div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </div>
  )
}
