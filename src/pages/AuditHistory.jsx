import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
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
  Loader2,
  Users,
  Trash2,
  RotateCcw,
  X,
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
  running: { icon: Loader2, color: 'text-blue-400', label: 'Running…' },
}

export default function AuditHistory() {
  const { user, isAdmin } = useAuth()
  const { toasts, addToast, removeToast } = useToast()
  const admin = isAdmin()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const [filterStatus, setFilterStatus] = useState('')   // '' | 'success' | 'failed'
  const [filterFlaggedOnly, setFilterFlaggedOnly] = useState(false)
  const [searchText, setSearchText] = useState('')

  // Admin-only state for the delete-count flow. `deletingRow` is the
  // reconciliation row currently shown in the confirm modal (null = closed).
  // `deleteMode` is 'retract' (reverse inventory + hide) or 'hide' (hide only).
  // Initial mode is decided when the modal opens, based on whether a
  // subsequent count exists at the same room — see openDeleteModal.
  const [deletingRow, setDeletingRow] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteMode, setDeleteMode] = useState('hide')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  // Set of stream_reconciliation ids currently being re-audited. Used to
  // disable the Re-audit button + show a spinner.
  const [reauditing, setReauditing] = useState(new Set())

  useEffect(() => { load() }, [])

  // Decide whether 'retract' is even an option for a given row. Looks at
  // all currently-loaded rows at the same location with a later count_time
  // — if any are found, retract would double-correct inventory, so the
  // modal greys it out and we force 'hide'.
  //
  // Note: this only checks the loaded window (last 200 audits). If a
  // subsequent count exists beyond that window the server-side enforcement
  // in /api/delete-stream-count will reject the retract anyway — UI optimism
  // is fine.
  const hasSubsequentCount = (row) => {
    const here = row.stream_count
    if (!here) return false
    return rows.some(r => {
      if (r.id === row.id) return false
      const other = r.stream_count
      if (!other || other.deleted === true) return false
      if (other.location_id !== here.location_id) return false
      return new Date(other.count_time).getTime() > new Date(here.count_time).getTime()
    })
  }

  const openDeleteModal = (row) => {
    setDeletingRow(row)
    setDeleteReason('')
    // If there's a later count at this room, retract is unsafe — default
    // (and constrain) to 'hide'. Otherwise default to 'retract' since
    // most admin-deletes outside the test-data case are operator-error
    // retractions.
    setDeleteMode(hasSubsequentCount(row) ? 'hide' : 'retract')
  }

  // ---- Admin: delete a stream_count (and flag the next audit as stale) ----
  const handleDelete = async () => {
    if (!deletingRow || !user?.id) return
    const reason = (deleteReason || '').trim()
    if (!reason) {
      addToast('Reason is required', 'error')
      return
    }
    if (deleteMode !== 'retract' && deleteMode !== 'hide') {
      addToast('Pick a delete mode (Retract or Hide)', 'error')
      return
    }
    try {
      setDeleteSubmitting(true)
      const r = await fetch('/api/delete-stream-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count_id: deletingRow.stream_count?.id,
          caller_user_id: user.id,
          reason,
          mode: deleteMode,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) {
        addToast(`Delete failed: ${data.error || r.status}`, 'error')
        return
      }
      const modeLabel = data.mode === 'retract' ? 'Retracted' : 'Hidden'
      const reversed = data.mode === 'retract' && typeof data.deltas_reversed === 'number'
        ? ` (${data.deltas_reversed} inventory line${data.deltas_reversed === 1 ? '' : 's'} reversed)`
        : ''
      const tail = data.next_audit_needs_recompute
        ? ' — next audit flagged for re-run'
        : ''
      addToast(`${modeLabel}${reversed}${tail}. Lark notified.`, 'success')
      setDeletingRow(null)
      setDeleteReason('')
      // Reload so the deleted row vanishes and any needs_recompute flags
      // we just set show up.
      load()
    } catch (err) {
      console.error('[delete-stream-count] failed:', err)
      addToast(`Delete failed: ${err.message || err}`, 'error')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // ---- Re-audit: fire /api/auto-reconcile for a stale row ----
  //
  // The endpoint upserts into stream_reconciliations on the same
  // stream_count_id, so the existing row gets overwritten (window_from,
  // totals, rows, etc.) and needs_recompute resets to false on the next
  // load. Background fire-and-forget so the page stays snappy.
  const handleReaudit = async (row) => {
    const countId = row.stream_count?.id
    if (!countId) return
    setReauditing(prev => new Set(prev).add(row.id))
    try {
      // We don't use sendBeacon here because the page isn't unloading —
      // we want a real response so we can show a result toast.
      const r = await fetch('/api/auto-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count_id: countId,
          trigger: 'manual_recompute',
          triggered_by_user_id: user?.id || null,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) {
        addToast(`Re-audit failed: ${data.error || r.status}`, 'error')
      } else {
        addToast('Re-audit done — refreshing.', 'success')
        load()
      }
    } catch (err) {
      console.error('[re-audit] failed:', err)
      addToast(`Re-audit failed: ${err.message || err}`, 'error')
    } finally {
      setReauditing(prev => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    }
  }

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      // Join with stream_counts via FK relationship. The streamer and
      // location come along through the stream_counts join.
      //
      // We pull `deleted` on the stream_count so we can hide reconciliations
      // tied to soft-deleted counts (admin retroactive delete or post-submit
      // Undo). For the admin user, "deleted = as if never entered" — the
      // audit row that was created for the now-deleted count must vanish
      // from the page.
      const { data, error: e } = await supabase
        .from('stream_reconciliations')
        .select(`
          *,
          stream_count:stream_counts!stream_reconciliations_stream_count_id_fkey(
            id, count_time, location_id, streamer_id, total_sold, deleted,
            location:locations(name),
            streamer:users!stream_counts_streamer_id_fkey(name)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(200)
      if (e) throw e
      // Hide rows whose underlying stream_count was soft-deleted. Supabase
      // doesn't filter joined tables server-side cleanly, so we filter here.
      const visible = (data || []).filter(r => r.stream_count?.deleted !== true)
      setRows(visible)
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
                  {admin && <th className="pb-2 text-center pr-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <ReconRow
                    key={r.id}
                    r={r}
                    expanded={expandedId === r.id}
                    onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    admin={admin}
                    onAskDelete={() => openDeleteModal(r)}
                    onReaudit={() => handleReaudit(r)}
                    reauditing={reauditing.has(r.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Admin: Delete-count confirm modal. Stops event propagation aggressively
          since rows underneath are click-to-expand. */}
      {deletingRow && (
        <DeleteCountModal
          row={deletingRow}
          reason={deleteReason}
          setReason={setDeleteReason}
          mode={deleteMode}
          setMode={setDeleteMode}
          retractBlocked={hasSubsequentCount(deletingRow)}
          submitting={deleteSubmitting}
          onCancel={() => { if (!deleteSubmitting) { setDeletingRow(null); setDeleteReason('') } }}
          onConfirm={handleDelete}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}

// Admin-only confirm modal for soft-deleting a count. Two modes:
//   - retract: reverse inventory + hide. Only safe if no subsequent count
//     exists at the same room (otherwise reversal double-corrects).
//   - hide:    don't touch inventory, just hide everywhere. Always safe.
//
// `retractBlocked` is precomputed by the parent based on currently-loaded
// rows; when true, the Retract radio is disabled and a yellow note explains
// why. The server enforces the same gate regardless.
function DeleteCountModal({ row, reason, setReason, mode, setMode, retractBlocked, submitting, onCancel, onConfirm }) {
  const sc = row.stream_count || {}
  const room = (sc.location?.name || '—').replace(/^Stream Room\s*-\s*/, '')
  const streamer = sc.streamer?.name || '—'
  const time = sc.count_time ? new Date(sc.count_time) : null
  const when = time
    ? time.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
    : '—'
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-vault-surface border border-red-500/40 rounded-xl max-w-lg w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-red-300">
            <Trash2 size={18} />
            <h3 className="font-semibold text-base">Delete this stream count?</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-gray-500 hover:text-white p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="bg-vault-darker/60 border border-vault-border rounded-lg p-3 text-xs space-y-1 mb-3">
          <div><span className="text-gray-500">Room:</span> <span className="text-white">{room}</span></div>
          <div><span className="text-gray-500">Streamer:</span> <span className="text-white">{streamer}</span></div>
          <div><span className="text-gray-500">Count time:</span> <span className="text-white">{when}</span></div>
          <div><span className="text-gray-500">Reported:</span> <span className="text-white">{(row.total_system_units || 0).toLocaleString()} items</span></div>
        </div>

        <label className="block text-xs text-gray-400 mb-1">Delete mode</label>
        <div className="space-y-2 mb-3">
          <ModeOption
            id="retract"
            active={mode === 'retract'}
            disabled={retractBlocked || submitting}
            onSelect={() => setMode('retract')}
            title={<>🔄 <span className="font-semibold">Retract</span> — operator input error</>}
            body="Reverse every inventory delta from this count AND hide it from reports. Use when someone counted the wrong number and missed the in-app Undo window. The system will behave as if this count never happened."
            hint={retractBlocked
              ? '⚠️ Not available: a later count already exists at this room. Reversing now would double-correct inventory (the later count already adjusted from this count\'s state). Use Hide instead, or delete the later count first.'
              : 'Safe: no later count exists at this room.'}
            hintColor={retractBlocked ? 'text-yellow-300' : 'text-green-400'}
          />
          <ModeOption
            id="hide"
            active={mode === 'hide'}
            disabled={submitting}
            onSelect={() => setMode('hide')}
            title={<>🧹 <span className="font-semibold">Hide</span> — test data / cleanup</>}
            body="Don't touch inventory — just hide this count from reports, audit history, and turnover. Use when inventory is already correct (e.g. a later count fixed it) but you want this test/erroneous row out of the data."
            hint="Always safe. Inventory is unchanged."
            hintColor="text-gray-500"
          />
        </div>

        <label className="block text-xs text-gray-400 mb-1">Reason (required)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          rows={2}
          placeholder={mode === 'retract'
            ? 'e.g. streamer typo\'d 10 instead of 100; missed Undo window...'
            : 'e.g. test count for debugging; inventory already correct...'}
          className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-red-500/60 resize-none"
          autoFocus
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting || !reason.trim() || (mode === 'retract' && retractBlocked)}
            className="px-3 py-2 text-sm bg-red-500/20 border border-red-500/60 text-red-200 hover:bg-red-500/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {mode === 'retract' ? 'Retract count' : 'Hide count'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Radio-like option row for the delete mode picker. We use a card-style
// layout instead of a bare <input type=radio> so each option has room
// for its description + safety hint.
function ModeOption({ id, active, disabled, onSelect, title, body, hint, hintColor }) {
  const base = 'w-full text-left rounded-lg p-3 border transition'
  const cls = disabled
    ? `${base} bg-vault-darker/30 border-vault-border/40 opacity-50 cursor-not-allowed`
    : active
      ? `${base} bg-red-500/10 border-red-500/50`
      : `${base} bg-vault-darker/40 border-vault-border hover:border-vault-gold/40 cursor-pointer`
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      aria-pressed={active}
      data-mode={id}
      className={cls}
    >
      <div className="flex items-start gap-2">
        <div
          className={`mt-1 flex-shrink-0 w-3.5 h-3.5 rounded-full border-2 ${
            active ? 'border-red-300 bg-red-300' : 'border-gray-500'
          }`}
        />
        <div className="flex-1">
          <div className="text-sm text-white">{title}</div>
          <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{body}</div>
          {hint && <div className={`text-[11px] mt-1 ${hintColor || 'text-gray-500'}`}>{hint}</div>}
        </div>
      </div>
    </button>
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

function ReconRow({ r, expanded, onToggle, admin, onAskDelete, onReaudit, reauditing }) {
  const time = r.stream_count?.count_time ? new Date(r.stream_count.count_time) : null
  const dayStr = time ? time.toLocaleDateString('en-CA') : '—'
  const timeStr = time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const room = (r.stream_count?.location?.name || '—').replace(/^Stream Room\s*-\s*/, '')
  const streamer = r.stream_count?.streamer?.name || '—'
  const meta = STATUS_META[r.status] || STATUS_META.success
  const StatusIcon = meta.icon
  const stale = r.needs_recompute === true

  const diffColor =
    r.total_diff === 0 ? 'text-green-400' :
    r.total_diff > 0 ? 'text-yellow-400' :
    'text-red-400'

  const colSpan = admin ? 11 : 10

  // Make the whole row clickable (apart from the lark icon / status pill).
  // The original chevron button was 14×14 — way too small a target.
  //
  // Stale rows get a yellow left-border so reviewers spot them at a glance
  // without expanding. The full explanation lives in ExpandedDetail.
  return (
    <>
      <tr
        className={`border-b border-vault-border/50 hover:bg-vault-darker/30 cursor-pointer ${
          stale ? 'bg-yellow-500/5' : ''
        }`}
        onClick={onToggle}
      >
        <td className="py-2.5 pl-2 text-gray-500">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </td>
        <td className="py-2.5 text-white">
          <div className="font-medium">{dayStr}</div>
          <div className="text-xs text-gray-500">{timeStr}</div>
        </td>
        <td className="py-2.5 text-gray-300">
          {room}
          {(r.merged_session_count || 1) > 1 && (
            <span
              className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/40 align-middle"
              title={`This count covered ${r.merged_session_count} LIVE sessions — per-streamer attribution may be unreliable. Expand for breakdown.`}
            >
              🔀 {r.merged_session_count}
            </span>
          )}
          {stale && (
            <span
              className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/20 text-yellow-200 border border-yellow-500/40 align-middle"
              title={r.recompute_reason || 'An upstream count was deleted; this audit\'s window is stale.'}
            >
              ⚠ Stale
            </span>
          )}
        </td>
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
        <td className="py-2.5 pr-2 text-center">
          {r.lark_sent_at ? (
            <span title={`Sent ${new Date(r.lark_sent_at).toLocaleString()} to ${r.lark_target || 'main'}`}>
              <Send size={12} className="inline text-green-400" />
            </span>
          ) : (
            <span className="text-xs text-gray-600">—</span>
          )}
        </td>
        {admin && (
          <td className="py-2.5 pr-2 text-center">
            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
              {stale && (
                <button
                  onClick={onReaudit}
                  disabled={reauditing}
                  title="Re-run reconciliation with the corrected window"
                  className="p-1 rounded text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50"
                >
                  {reauditing ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                </button>
              )}
              <button
                onClick={onAskDelete}
                title="Soft-delete this count (admin only)"
                className="p-1 rounded text-gray-500 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="bg-vault-darker/30">
          <td colSpan={colSpan} className="px-2 py-3">
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
  const perCreator = Array.isArray(r.per_creator_breakdown) ? r.per_creator_breakdown : []
  const analyticsSessions = Array.isArray(r.analytics_live_sessions) ? r.analytics_live_sessions : []
  const isMerged = (r.merged_session_count || 1) > 1
  const analyticsTotalItems = analyticsSessions.reduce((s, x) => s + (x.items_sold || 0), 0)
  const analyticsTotalGmv = analyticsSessions.reduce((s, x) => s + (x.gmv_usd || 0), 0)
  return (
    <div className="space-y-3 text-xs">
      <div className="text-gray-500">
        Window: {new Date(r.window_from).toLocaleString()} → {new Date(r.window_to).toLocaleString()}
        {' · '}Triggered: <code>{r.triggered_by}</code>
        {' · '}Duration: {(r.duration_ms || 0).toLocaleString()}ms
      </div>

      {/* Surfaced when an upstream count was deleted, since this audit's
          window_from was anchored to that now-removed count. The numbers
          above are still readable, but the reviewer should re-audit before
          treating any diff as actionable. */}
      {r.needs_recompute === true && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2 text-yellow-200">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Stale audit — needs re-run
          </div>
          {r.recompute_reason && <div className="text-gray-300 mt-1">{r.recompute_reason}</div>}
          <div className="text-gray-400 mt-1">
            The window above no longer reflects the latest set of counts at this room. Click the
            re-audit button (the ↺ icon on the row) to rerun reconciliation with the corrected window.
          </div>
        </div>
      )}

      {/* P2 slice 3: TikTok's OFFICIAL per-session breakdown, scraped from
          Content Analytics → LIVE. Includes both LIVE-tagged orders AND
          shop-tab attribution during the stream — more accurate than the
          order-list per-creator block below (which only sees LIVE tags).
          Shown when populated; missing on old rows that pre-date the
          P2 integration. */}
      {analyticsSessions.length > 0 && (
        <div className="rounded-lg p-2 border bg-blue-500/10 border-blue-500/40">
          <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5 text-blue-300">
            <Users size={12} />
            🎯 TikTok Official LIVE sessions ({analyticsSessions.length})
            <span className="ml-auto text-blue-200/70 font-normal">
              {analyticsTotalItems.toLocaleString()} items · ${analyticsTotalGmv.toFixed(2)} GMV
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 text-[10px] uppercase">
                <th className="pb-0.5">Title</th>
                <th className="pb-0.5">Start</th>
                <th className="pb-0.5 text-right">Duration</th>
                <th className="pb-0.5 text-right">Items</th>
                <th className="pb-0.5 text-right">SKUs</th>
                <th className="pb-0.5 text-right">Customers</th>
                <th className="pb-0.5 text-right">GMV</th>
              </tr>
            </thead>
            <tbody>
              {analyticsSessions.map((s, i) => {
                const fmt = (u) => u ? new Date(u * 1000).toLocaleString([], {
                  weekday: 'short', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '—'
                const durH = Math.floor((s.duration_minutes || 0) / 60)
                const durM = (s.duration_minutes || 0) % 60
                const durStr = durH ? `${durH}h${durM ? ` ${durM}m` : ''}` : `${durM}m`
                return (
                  <tr key={s.live_id || i} className="border-t border-vault-border/30">
                    <td className="py-0.5 text-gray-200 max-w-[280px] truncate" title={s.title}>{s.title || '(untitled)'}</td>
                    <td className="py-0.5 text-gray-400">{fmt(s.start_unix)}</td>
                    <td className="py-0.5 text-right text-gray-500">{durStr}</td>
                    <td className="py-0.5 text-right text-gray-200 font-semibold">{(s.items_sold || 0).toLocaleString()}</td>
                    <td className="py-0.5 text-right text-gray-500">{(s.sku_orders || 0).toLocaleString()}</td>
                    <td className="py-0.5 text-right text-gray-500">{(s.customers || 0).toLocaleString()}</td>
                    <td className="py-0.5 text-right text-gray-300">${(s.gmv_usd || 0).toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-blue-200/60">
            Source: TikTok Seller Center → Content Analytics → LIVE. Items count includes both LIVE-tagged orders and shop-tab attribution. Compare to the per-creator block below (order-list LIVE-tag aggregation only) to see how much of the count was non-LIVE-tagged.
          </div>
        </div>
      )}

      {/* L1: per-creator breakdown. Shown whenever per_creator_breakdown
          is populated — single-session counts get a tidy one-row table,
          merged sessions (>1 creator) get a loud warning header so the
          reviewer doesn't mistake a coincidentally-matching combined
          total for a clean audit. */}
      {perCreator.length > 0 && (
        <div className={`rounded-lg p-2 border ${isMerged ? 'bg-orange-500/10 border-orange-500/40' : 'bg-vault-darker/40 border-vault-border/50'}`}>
          <div className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isMerged ? 'text-orange-300' : 'text-gray-400'}`}>
            <Users size={12} />
            {isMerged ? (
              <>🔀 MERGED — this count covered {r.merged_session_count} LIVE sessions. Per-streamer attribution unreliable.</>
            ) : (
              <>Per-creator LIVE sales</>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 text-[10px] uppercase">
                <th className="pb-0.5">Creator</th>
                <th className="pb-0.5 text-right">Units</th>
                <th className="pb-0.5 text-right">Lines</th>
                <th className="pb-0.5 text-right">First → Last</th>
              </tr>
            </thead>
            <tbody>
              {perCreator.map((c, i) => {
                const fmt = (u) => u ? new Date(u * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
                return (
                  <tr key={i} className="border-t border-vault-border/30">
                    <td className="py-0.5 text-gray-200">{c.creator}</td>
                    <td className="py-0.5 text-right text-gray-300">{(c.total_qty || 0).toLocaleString()}</td>
                    <td className="py-0.5 text-right text-gray-500">{(c.line_count || 0).toLocaleString()}</td>
                    <td className="py-0.5 text-right text-gray-500">
                      {c.earliest_unix && c.latest_unix && c.earliest_unix !== c.latest_unix
                        ? `${fmt(c.earliest_unix)} → ${fmt(c.latest_unix)}`
                        : fmt(c.earliest_unix)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
