import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ShieldCheck,
  Filter,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Send,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'

// ============================================================================
// Audit History
// ============================================================================
// Reads stream_reconciliations + stream_counts and shows one row per finished
// reconciliation. The auto-trigger fires after every TikTok-room stream count
// submit, so this page becomes "Gary's daily review" — open it, see every
// session, see the diffs, drill into outliers.
// ============================================================================

const STATUS_META = {
  success: { icon: CheckCircle2, color: 'text-green-400', label: 'Done' },
  failed:  { icon: XCircle, color: 'text-red-400', label: 'Failed' },
  no_data: { icon: AlertTriangle, color: 'text-yellow-400', label: 'No data' },
}

export default function AuditHistory() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const [filterStatus, setFilterStatus] = useState('')   // '' | 'success' | 'failed'
  const [filterFlaggedOnly, setFilterFlaggedOnly] = useState(false)
  const [searchText, setSearchText] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      // Join with stream_counts via FK relationship. The streamer and
      // location come along through the stream_counts join.
      const { data, error: e } = await supabase
        .from('stream_reconciliations')
        .select(`
          *,
          stream_count:stream_counts!stream_reconciliations_stream_count_id_fkey(
            id, count_time, location_id, streamer_id, total_sold,
            location:locations(name),
            streamer:users!stream_counts_streamer_id_fkey(name)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(200)
      if (e) throw e
      setRows(data || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to load reconciliations')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let out = rows
    if (filterStatus) out = out.filter(r => r.status === filterStatus)
    if (filterFlaggedOnly) out = out.filter(r => r.flagged_count > 0)
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      out = out.filter(r => {
        const room = (r.stream_count?.location?.name || '').toLowerCase()
        const streamer = (r.stream_count?.streamer?.name || '').toLowerCase()
        return room.includes(q) || streamer.includes(q)
      })
    }
    return out
  }, [rows, filterStatus, filterFlaggedOnly, searchText])

  const summary = useMemo(() => {
    return {
      total: filtered.length,
      success: filtered.filter(r => r.status === 'success').length,
      failed: filtered.filter(r => r.status === 'failed').length,
      flaggedTotal: filtered.reduce((s, r) => s + (r.flagged_count || 0), 0),
      diffSum: filtered.reduce((s, r) => s + (r.total_diff || 0), 0),
    }
  }, [filtered])

  // ---- Render ----
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <ShieldCheck className="text-vault-gold" />
            Audit History
          </h1>
          <p className="text-gray-400 mt-1">
            One row per finished reconciliation. Auto-triggered after each TikTok-room stream count.
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Sessions" value={summary.total} />
        <StatCard label="Done" value={summary.success} colorClass="text-green-400" />
        <StatCard label="Failed" value={summary.failed} colorClass={summary.failed > 0 ? 'text-red-400' : 'text-gray-300'} />
        <StatCard label="Flagged products" value={summary.flaggedTotal} colorClass={summary.flaggedTotal > 0 ? 'text-yellow-400' : 'text-green-400'} subtext="total across sessions" />
        <StatCard label="Cumulative diff" value={(summary.diffSum > 0 ? '+' : '') + summary.diffSum} colorClass={summary.diffSum === 0 ? 'text-green-400' : 'text-yellow-400'} subtext="TikTok − count" />
      </div>

      {/* Filters */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-vault-gold" />
          <h2 className="font-semibold text-white text-sm">Filter</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            >
              <option value="">All</option>
              <option value="success">Done</option>
              <option value="failed">Failed</option>
              <option value="no_data">No data</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Room or streamer..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
              />
            </div>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filterFlaggedOnly}
                onChange={(e) => setFilterFlaggedOnly(e.target.checked)}
                className="accent-vault-gold"
              />
              <span>Only show sessions with flagged products</span>
            </label>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 text-sm">
          {filtered.length} reconciliation{filtered.length === 1 ? '' : 's'}
        </h3>

        {filtered.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">
            No reconciliations yet. Submit a stream count at a TikTok room to trigger one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2 pl-2 w-8"></th>
                  <th className="pb-2">When</th>
                  <th className="pb-2">Room</th>
                  <th className="pb-2">Streamer</th>
                  <th className="pb-2 text-right">TikTok</th>
                  <th className="pb-2 text-right">Count</th>
                  <th className="pb-2 text-right">Diff</th>
                  <th className="pb-2 text-right">Flagged</th>
                  <th className="pb-2 text-center">Status</th>
                  <th className="pb-2 text-center">Lark</th>
                  <th className="pb-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <ReconRow
                    key={r.id}
                    r={r}
                    expanded={expandedId === r.id}
                    onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
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

function StatCard({ label, value, subtext, colorClass = 'text-white' }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}

function ReconRow({ r, expanded, onToggle }) {
  const time = r.stream_count?.count_time ? new Date(r.stream_count.count_time) : null
  const dayStr = time ? time.toLocaleDateString('en-CA') : '—'
  const timeStr = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const room = (r.stream_count?.location?.name || '—').replace(/^Stream Room\s*-\s*/, '')
  const streamer = r.stream_count?.streamer?.name || '—'
  const meta = STATUS_META[r.status] || STATUS_META.success
  const StatusIcon = meta.icon

  const diffColor =
    r.total_diff === 0 ? 'text-green-400' :
    r.total_diff > 0 ? 'text-yellow-400' :
    'text-red-400'

  return (
    <>
      <tr className="border-b border-vault-border/50 hover:bg-vault-darker/30">
        <td className="py-2.5 pl-2">
          <button onClick={onToggle} className="text-gray-500 hover:text-vault-gold">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="py-2.5 text-white">
          <div className="font-medium">{dayStr}</div>
          <div className="text-xs text-gray-500">{timeStr}</div>
        </td>
        <td className="py-2.5 text-gray-300">{room}</td>
        <td className="py-2.5 text-white">{streamer}</td>
        <td className="py-2.5 text-right text-white">{(r.total_platform_units || 0).toLocaleString()}</td>
        <td className="py-2.5 text-right text-white">{(r.total_system_units || 0).toLocaleString()}</td>
        <td className={`py-2.5 text-right font-bold ${diffColor}`}>
          {r.total_diff > 0 ? '+' : ''}{(r.total_diff || 0).toLocaleString()}
        </td>
        <td className={`py-2.5 text-right ${r.flagged_count > 0 ? 'text-red-300 font-semibold' : 'text-gray-500'}`}>
          {r.flagged_count > 0 ? r.flagged_count : '—'}
        </td>
        <td className="py-2.5">
          <div className={`flex items-center justify-center gap-1 ${meta.color}`}>
            <StatusIcon size={14} />
            <span className="text-xs">{meta.label}</span>
          </div>
        </td>
        <td className="py-2.5 text-center">
          {r.lark_sent_at ? (
            <span title={`Sent ${new Date(r.lark_sent_at).toLocaleString()} to ${r.lark_target || 'main'}`}>
              <Send size={12} className="inline text-green-400" />
            </span>
          ) : (
            <span className="text-xs text-gray-600">—</span>
          )}
        </td>
        <td className="py-2.5 pr-2">
          <Link
            to={`/reconcile?count_id=${r.stream_count_id}`}
            className="text-xs text-vault-gold hover:underline flex items-center gap-1"
          >
            <ExternalLink size={12} /> Open
          </Link>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-vault-darker/30">
          <td colSpan={11} className="px-2 py-3">
            <ExpandedDetail r={r} />
          </td>
        </tr>
      )}
    </>
  )
}

function ExpandedDetail({ r }) {
  if (r.status === 'failed') {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
        <div className="font-semibold mb-1">Reconciliation failed</div>
        <div className="text-xs">{r.error_message || '(no error message recorded)'}</div>
        <div className="text-xs text-gray-400 mt-2">
          Window: {new Date(r.window_from).toLocaleString()} → {new Date(r.window_to).toLocaleString()}
        </div>
      </div>
    )
  }

  const rows = Array.isArray(r.rows) ? r.rows : []
  const unmapped = Array.isArray(r.unmapped) ? r.unmapped : []
  return (
    <div className="space-y-3 text-xs">
      <div className="text-gray-500">
        Window: {new Date(r.window_from).toLocaleString()} → {new Date(r.window_to).toLocaleString()}
        {' · '}Triggered: <code>{r.triggered_by}</code>
        {' · '}Duration: {(r.duration_ms || 0).toLocaleString()}ms
      </div>

      {rows.length === 0 ? (
        <div className="text-gray-500">No products in this reconciliation.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pb-1">Product</th>
              <th className="pb-1 text-right">TikTok</th>
              <th className="pb-1 text-right">Count</th>
              <th className="pb-1 text-right">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={`border-t border-vault-border/30 ${row.flagged ? (row.diff < 0 ? 'bg-red-500/10' : 'bg-yellow-500/5') : ''}`}>
                <td className="py-1 text-gray-300">
                  {row.flagged && (
                    <AlertTriangle
                      size={11}
                      className={`inline mr-1 -mt-0.5 ${row.diff < 0 ? 'text-red-400' : 'text-yellow-400'}`}
                    />
                  )}
                  {row.product_name}
                  {row.language && <span className="text-gray-600 ml-2">[{row.language}]</span>}
                </td>
                <td className="py-1 text-right text-gray-300">{(row.platform_qty || 0).toLocaleString()}</td>
                <td className="py-1 text-right text-gray-300">{row.system_qty > 0 ? '+' : ''}{(row.system_qty || 0).toLocaleString()}</td>
                <td className={`py-1 text-right font-semibold ${
                  row.diff === 0 ? 'text-green-400' :
                  row.flagged && row.diff < 0 ? 'text-red-400' :
                  row.flagged ? 'text-yellow-400' :
                  'text-gray-400'
                }`}>
                  {row.diff > 0 ? '+' : ''}{(row.diff || 0).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {unmapped.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-yellow-200">
          <div className="font-semibold mb-1">⚠️ {unmapped.length} TikTok product{unmapped.length === 1 ? '' : 's'} not mapped</div>
          <ul className="text-xs space-y-0.5 pl-4 list-disc">
            {unmapped.slice(0, 5).map((u, i) => (
              <li key={i}>{u.name} ({u.qty})</li>
            ))}
            {unmapped.length > 5 && <li className="text-gray-500">…and {unmapped.length - 5} more</li>}
          </ul>
          <div className="mt-1 text-gray-400">
            <Link to="/audit" className="text-vault-gold hover:underline">Open Sales Audit</Link> to map them.
          </div>
        </div>
      )}
    </div>
  )
}
