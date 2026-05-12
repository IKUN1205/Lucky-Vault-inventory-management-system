import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchStreamCounts, fetchLocations } from '../lib/supabase'
import {
  ClipboardList,
  Calendar,
  Filter,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
  Search,
  Eye,
  Package,
} from 'lucide-react'

// ============================================================================
// Stream Session History
// ============================================================================
// A flat per-session view of every stream count. Each row = one finished
// LIVE session (the count records what the previous streamer sold). Replaces
// the "look at /reports for last 7 days" workflow when you want to drill
// into a specific session.
//
// Each row has a one-click Reconcile button that jumps to /reconcile?count_id=X
// so the user can compare that session against TikTok sales.
// ============================================================================

export default function StreamSessions() {
  const [counts, setCounts] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)

  // Filters
  const [filterLocation, setFilterLocation] = useState('')   // '' = all
  const [filterStreamer, setFilterStreamer] = useState('')   // free-text name
  const [filterFrom, setFilterFrom] = useState('')           // YYYY-MM-DD
  const [filterTo, setFilterTo] = useState('')

  // Optional: line-item drill-in cache (loaded on row expand)
  const [expandedId, setExpandedId] = useState(null)
  const [itemsCache, setItemsCache] = useState({})

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      setPageError(null)
      const [countsData, locData] = await Promise.all([
        fetchStreamCounts(null, null, null),
        fetchLocations(),
      ])
      setCounts(countsData || [])
      // Only stream rooms are relevant here — filter the location dropdown
      setLocations((locData || []).filter(l => l.name?.includes('Stream Room')))
    } catch (err) {
      console.error(err)
      setPageError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  // Apply filters in-memory — fetchStreamCounts already returned everything
  // ordered by count_time DESC.
  const filtered = useMemo(() => {
    let rows = counts
    if (filterLocation) rows = rows.filter(c => c.location_id === filterLocation)
    if (filterStreamer.trim()) {
      const q = filterStreamer.trim().toLowerCase()
      rows = rows.filter(c => (c.streamer?.name || '').toLowerCase().includes(q))
    }
    if (filterFrom) {
      const fromDate = new Date(filterFrom + 'T00:00:00')
      rows = rows.filter(c => new Date(c.count_time) >= fromDate)
    }
    if (filterTo) {
      const toDate = new Date(filterTo + 'T23:59:59')
      rows = rows.filter(c => new Date(c.count_time) <= toDate)
    }
    return rows
  }, [counts, filterLocation, filterStreamer, filterFrom, filterTo])

  // Aggregate totals for the filtered view (gives the user a quick "what am
  // I looking at" summary above the table)
  const summary = useMemo(() => {
    const totalSold = filtered.reduce((s, c) => s + (c.total_sold || 0), 0)
    const totalDisc = filtered.reduce((s, c) => s + (c.total_discrepancies || 0), 0)
    const streamerSet = new Set(filtered.map(c => c.streamer?.name).filter(Boolean))
    const roomSet = new Set(filtered.map(c => c.location?.name).filter(Boolean))
    return {
      sessions: filtered.length,
      totalSold,
      totalDisc,
      uniqueStreamers: streamerSet.size,
      uniqueRooms: roomSet.size,
    }
  }, [filtered])

  // ---- Drill-in: load line items for a specific count ----
  const toggleExpand = async (countId) => {
    if (expandedId === countId) {
      setExpandedId(null)
      return
    }
    setExpandedId(countId)
    if (itemsCache[countId]) return
    try {
      const { data } = await supabase
        .from('stream_count_items')
        .select('product_id, expected_qty, actual_qty, product:products(name, language)')
        .eq('stream_count_id', countId)
      // Sort items by qty sold descending so the user sees biggest sellers
      // first when they expand a row.
      const sorted = (data || [])
        .map(item => ({
          ...item,
          diff: (item.expected_qty || 0) - (item.actual_qty || 0),
        }))
        .sort((a, b) => b.diff - a.diff)
      setItemsCache(prev => ({ ...prev, [countId]: sorted }))
    } catch (err) {
      console.error(err)
    }
  }

  const clearFilters = () => {
    setFilterLocation('')
    setFilterStreamer('')
    setFilterFrom('')
    setFilterTo('')
  }

  // ---- Render ----
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ClipboardList className="text-vault-gold" />
          Stream Session History
        </h1>
        <p className="text-gray-400 mt-1">
          Every stream count, one row per session. Click <strong className="text-vault-gold">Reconcile</strong> on any row to compare that session's outflow against TikTok sales.
        </p>
      </div>

      {pageError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
          {pageError}
        </div>
      )}

      {/* Filters */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-vault-gold" />
          <h2 className="font-semibold text-white text-sm">Filter</h2>
          {(filterLocation || filterStreamer || filterFrom || filterTo) && (
            <button
              onClick={clearFilters}
              className="ml-auto text-xs text-gray-400 hover:text-white underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Stream room</label>
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            >
              <option value="">All rooms</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name.replace(/^Stream Room\s*-\s*/, '')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Streamer</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Name contains..."
                value={filterStreamer}
                onChange={(e) => setFilterStreamer(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Sessions" value={summary.sessions} />
        <SummaryCard label="Units sold" value={summary.totalSold} colorClass="text-green-400" />
        <SummaryCard label="Discrepancies" value={summary.totalDisc} colorClass={summary.totalDisc > 0 ? 'text-yellow-400' : 'text-gray-300'} subtext="found extra" />
        <SummaryCard label="Streamers" value={summary.uniqueStreamers} />
        <SummaryCard label="Rooms" value={summary.uniqueRooms} />
      </div>

      {/* Table */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <ClipboardList size={18} className="text-vault-gold" />
          {filtered.length} session{filtered.length === 1 ? '' : 's'}
        </h3>

        {filtered.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">No stream counts match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2 pl-2 w-8"></th>
                  <th className="pb-2">When</th>
                  <th className="pb-2">Room</th>
                  <th className="pb-2">Streamer (prev session)</th>
                  <th className="pb-2">Counted by</th>
                  <th className="pb-2 text-right">Sold</th>
                  <th className="pb-2 text-right">Extra found</th>
                  <th className="pb-2 text-right pr-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <SessionRow
                    key={c.id}
                    count={c}
                    expanded={expandedId === c.id}
                    items={itemsCache[c.id]}
                    onToggle={() => toggleExpand(c.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ----- Sub-components -------------------------------------------------------

function SummaryCard({ label, value, subtext, colorClass = 'text-white' }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}

function SessionRow({ count, expanded, items, onToggle }) {
  const time = count.count_time ? new Date(count.count_time) : null
  const dayStr = time ? time.toLocaleDateString('en-CA') : '—'
  const timeStr = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const roomShort = (count.location?.name || '—').replace(/^Stream Room\s*-\s*/, '')
  const isTikTokRoom = /TikTok/i.test(count.location?.name || '')

  return (
    <>
      <tr className="border-b border-vault-border/50 hover:bg-vault-darker/30">
        <td className="py-2.5 pl-2">
          <button
            onClick={onToggle}
            className="text-gray-500 hover:text-vault-gold"
            title={expanded ? 'Hide items' : 'Show items'}
          >
            <Eye size={14} />
          </button>
        </td>
        <td className="py-2.5 text-white">
          <div className="font-medium">{dayStr}</div>
          <div className="text-xs text-gray-500">{timeStr}</div>
        </td>
        <td className="py-2.5 text-gray-300">{roomShort}</td>
        <td className="py-2.5 text-white">{count.streamer?.name || '—'}</td>
        <td className="py-2.5 text-gray-400 text-xs">{count.counted_by?.name || '—'}</td>
        <td className="py-2.5 text-right text-white font-semibold">{(count.total_sold || 0).toLocaleString()}</td>
        <td className={`py-2.5 text-right ${count.total_discrepancies > 0 ? 'text-yellow-400 font-semibold' : 'text-gray-500'}`}>
          {count.total_discrepancies > 0 ? `+${count.total_discrepancies}` : '—'}
        </td>
        <td className="py-2.5 pr-2 text-right">
          {isTikTokRoom ? (
            <Link
              to={`/reconcile?count_id=${count.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-vault-gold/10 text-vault-gold hover:bg-vault-gold/20 border border-vault-gold/30 rounded text-xs font-medium"
            >
              <ShieldCheck size={12} />
              Reconcile
            </Link>
          ) : (
            <span className="text-xs text-gray-600" title="Reconcile is only wired up for TikTok rooms right now">
              —
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-vault-darker/30">
          <td colSpan={8} className="px-2 py-3">
            {!items ? (
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" /> Loading items...
              </div>
            ) : items.length === 0 ? (
              <p className="text-xs text-gray-500">No line items for this count.</p>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-gray-500 mb-1">
                  {items.length} SKU{items.length === 1 ? '' : 's'} — sorted by sold qty
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="pb-1">Product</th>
                      <th className="pb-1 text-right">Expected</th>
                      <th className="pb-1 text-right">Actual</th>
                      <th className="pb-1 text-right">Sold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className="border-t border-vault-border/30">
                        <td className="py-1 text-gray-300">
                          {it.product?.name || '(unknown)'}
                          {it.product?.language && <span className="text-gray-600 ml-2">[{it.product.language}]</span>}
                        </td>
                        <td className="py-1 text-right text-gray-400">{it.expected_qty ?? '—'}</td>
                        <td className="py-1 text-right text-gray-400">{it.actual_qty ?? '—'}</td>
                        <td className={`py-1 text-right font-semibold ${
                          it.diff > 0 ? 'text-green-400' : it.diff < 0 ? 'text-yellow-400' : 'text-gray-500'
                        }`}>
                          {it.diff > 0 ? `+${it.diff}` : it.diff || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
