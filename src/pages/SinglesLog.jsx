import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSinglesAuditLog, fetchUsers } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import {
  History, Filter, RefreshCw, Plus, DollarSign, Trash2,
  Search, X
} from 'lucide-react'

// ============================================================================
// SinglesLog — activity log for the singles inventory + sales
// ============================================================================
// Reads singles_audit_log, joined with the underlying single (for card name /
// set context) and acted_by (for the operator's name). Shows a chronological
// feed with filters by event type, operator, date range, and free-text search.
//
// Backend logging is fire-and-forget from createSingle / createSinglesBatch /
// markSingleAsSold / softDeleteSingle in src/lib/supabase.js — see
// logSingleEvent there for the write side.
// ============================================================================

const EVENT_TYPES = [
  { value: '',          label: 'All events' },
  { value: 'created',   label: 'Created' },
  { value: 'sold',      label: 'Sold' },
  { value: 'deleted',   label: 'Deleted' }
]

const EVENT_META = {
  created: { Icon: Plus,       color: 'text-green-400',  bg: 'bg-green-500/10',  label: 'Created' },
  sold:    { Icon: DollarSign, color: 'text-vault-gold', bg: 'bg-vault-gold/10', label: 'Sold' },
  deleted: { Icon: Trash2,     color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'Deleted' },
  restored:{ Icon: RefreshCw,  color: 'text-blue-400',   bg: 'bg-blue-500/10',   label: 'Restored' },
  updated: { Icon: RefreshCw,  color: 'text-gray-400',   bg: 'bg-gray-500/10',   label: 'Updated' }
}

export default function SinglesLog() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [events, setEvents] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  // Default to last 7 days so the initial view is "recent activity".
  const sevenDaysAgo = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  }, [])
  const today = new Date().toISOString().slice(0, 10)

  const [filters, setFilters] = useState({
    event_type: '',
    acted_by_id: '',
    date_from: sevenDaysAgo,
    date_to: '',          // empty = no upper bound
    search: ''
  })

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.event_type, filters.acted_by_id, filters.date_from, filters.date_to])

  const load = async () => {
    setLoading(true)
    try {
      const [logData, userData] = await Promise.all([
        fetchSinglesAuditLog({
          event_type: filters.event_type || undefined,
          acted_by_id: filters.acted_by_id || undefined,
          date_from: filters.date_from
            ? new Date(filters.date_from + 'T00:00:00').toISOString()
            : undefined,
          date_to: filters.date_to
            ? new Date(filters.date_to + 'T23:59:59').toISOString()
            : undefined,
          limit: 500
        }),
        // Only fetch users on initial load; this list rarely changes.
        users.length === 0 ? fetchUsers(true) : Promise.resolve(users)
      ])
      setEvents(logData)
      if (users.length === 0) setUsers(userData)
    } catch (err) {
      console.error('Activity log load failed:', err)
      addToast(`Failed to load activity log: ${err.message || 'unknown'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Client-side filter by search text — searches summary + card identity.
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    if (!q) return events
    return events.filter(e => {
      const hay = [
        e.summary,
        e.single?.card_name,
        e.single?.card_number,
        e.single?.cert_number,
        e.single?.set?.name,
        e.single?.set?.code,
        e.acted_by?.name
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [events, filters.search])

  // Summary card counts (filtered view)
  const summary = useMemo(() => {
    const by = { created: 0, sold: 0, deleted: 0 }
    for (const e of filtered) {
      if (by[e.event_type] != null) by[e.event_type]++
    }
    return by
  }, [filtered])

  const handleFilterChange = (e) => {
    const { name, value } = e.target
    setFilters(f => ({ ...f, [name]: value }))
  }

  const clearFilters = () => {
    setFilters({
      event_type: '',
      acted_by_id: '',
      date_from: sevenDaysAgo,
      date_to: '',
      search: ''
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <History className="text-vault-gold" />
            Singles Activity Log
          </h1>
          <p className="text-gray-400 mt-1">
            Every create / sale / delete on the singles inventory — who, when, what
          </p>
        </div>
        <button
          onClick={load}
          className="btn btn-secondary"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>Audit trail of singles activity. Default view shows the last 7 days; expand the date range to see more.</p>
          <p className="text-gray-400 text-xs">
            Logging happens automatically when you Add Single, Bulk Add, record a sale, or soft-delete a card. Events before this feature shipped won't appear.
          </p>
        </div>
      </Instructions>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-gray-400 text-sm">Total events</p>
          <p className="font-display text-2xl font-bold text-white">{filtered.length}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Created</p>
          <p className="font-display text-2xl font-bold text-green-400">{summary.created}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Sold</p>
          <p className="font-display text-2xl font-bold text-vault-gold">{summary.sold}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Deleted</p>
          <p className="font-display text-2xl font-bold text-red-400">{summary.deleted}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                name="search"
                value={filters.search}
                onChange={handleFilterChange}
                placeholder="card name, number, cert#, set, operator..."
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Event type</label>
            <select name="event_type" value={filters.event_type} onChange={handleFilterChange}>
              {EVENT_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Operator</label>
            <select name="acted_by_id" value={filters.acted_by_id} onChange={handleFilterChange}>
              <option value="">All operators</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearFilters}
              className="btn btn-secondary w-full"
            >
              <X size={14} /> Clear
            </button>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="date"
              name="date_from"
              value={filters.date_from}
              onChange={handleFilterChange}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input
              type="date"
              name="date_to"
              value={filters.date_to}
              onChange={handleFilterChange}
              max={today}
            />
          </div>
        </div>
      </div>

      {/* Event feed */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <History className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-400">
            {events.length === 0
              ? 'No activity in this date range. Try expanding the range.'
              : 'No events match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-vault-border text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 w-44">When</th>
                <th className="text-left px-4 py-3 w-28">Event</th>
                <th className="text-left px-4 py-3">Summary</th>
                <th className="text-left px-4 py-3 w-40">Operator</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const meta = EVENT_META[e.event_type] || EVENT_META.updated
                const Icon = meta.Icon
                const when = new Date(e.acted_at)
                const whenStr = when.toLocaleString([], {
                  month: 'numeric', day: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })
                const isDeletedCard = e.single?.deleted === true
                return (
                  <tr
                    key={e.id}
                    className="border-b border-vault-border last:border-0 hover:bg-vault-darker/40"
                  >
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      {whenStr}
                      <div className="text-gray-600 text-xs">
                        {when.toLocaleDateString('en-CA')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${meta.bg} ${meta.color}`}>
                        <Icon size={12} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-200">
                      <div>{e.summary}</div>
                      {e.single && !isDeletedCard && e.event_type !== 'deleted' && (
                        <button
                          type="button"
                          onClick={() => navigate(`/singles?focus=${e.single.id}`)}
                          className="text-xs text-vault-gold hover:underline mt-0.5"
                        >
                          → View in inventory
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {e.acted_by?.name || <span className="text-gray-600 italic">unknown</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
