import { Trash2, X, Loader2 } from 'lucide-react'

// ============================================================================
// DeleteCountModal — admin-only confirm modal for soft-deleting a stream_count
// ============================================================================
// Shared between Audit History (per-reconciliation view) and Stream Sessions
// (raw count list). Takes normalized props (instead of a row shape) so both
// callers can map their own row shape onto the same modal contract.
//
// Two modes:
//   - retract: reverse inventory + hide. Only safe if no subsequent count
//     exists at the same room (otherwise reversal double-corrects). The
//     parent decides this via the `retractBlocked` prop. The server enforces
//     the same gate regardless — front-end disable is UX-only.
//   - hide:    don't touch inventory, just hide everywhere. Always safe.
//
// Required props:
//   - streamCountId     (string)
//   - locationName      (string | null)
//   - streamerName      (string | null)
//   - countTime         (ISO string | null)
//   - reportedItems     (number, optional — total items reported by this count)
//   - reason            (controlled state)
//   - setReason         (setter)
//   - mode              ('retract' | 'hide')
//   - setMode           (setter)
//   - retractBlocked    (boolean — true when a later count exists)
//   - submitting        (boolean)
//   - onCancel          (() => void)
//   - onConfirm         (() => void)
// ============================================================================
export default function DeleteCountModal({
  streamCountId: _ignored, // unused in render, but accepted so callers can pass for clarity
  locationName,
  streamerName,
  countTime,
  reportedItems,
  reason,
  setReason,
  mode,
  setMode,
  retractBlocked,
  submitting,
  onCancel,
  onConfirm,
}) {
  const room = (locationName || '—').replace(/^Stream Room\s*-\s*/, '')
  const streamer = streamerName || '—'
  const time = countTime ? new Date(countTime) : null
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
          {typeof reportedItems === 'number' && (
            <div><span className="text-gray-500">Reported:</span> <span className="text-white">{reportedItems.toLocaleString()} items</span></div>
          )}
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

// ============================================================================
// useDeleteCountFlow — hook that encapsulates the API call + safety helpers
// ============================================================================
// Centralises the duplicated logic (POST /api/delete-stream-count, success
// toast, etc.) so both Audit History and Stream Sessions just wire it up
// with their own rows array + onReload callback.
//
// Usage:
//   const flow = useDeleteCountFlow({ addToast, userId, onReload })
//   <DeleteCountModal {...flow.modalProps()} />
//   <button onClick={() => flow.open(row)}>Delete</button>
//
// `rowsForSubsequentCheck` is an array of objects with shape
//   { id, location_id, count_time, deleted? }
// either at top-level (Stream Sessions) or nested under `stream_count`
// (Audit History). The hook handles both via the `extract` arg.
// ============================================================================
import { useState } from 'react'

export function useDeleteCountFlow({ addToast, userId, onReload }) {
  const [target, setTarget] = useState(null)        // normalized props object, or null
  const [rowsArray, setRowsArray] = useState([])    // for subsequent-count check
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState('hide')
  const [submitting, setSubmitting] = useState(false)

  // Decide whether 'retract' is even an option for a given target. Looks at
  // the currently-loaded rows at the same location with a later count_time
  // — if any are found, retract would double-correct inventory, so the
  // modal greys it out.
  const isRetractBlocked = (currentTarget, rows) => {
    if (!currentTarget || !rows?.length) return false
    return rows.some(r => {
      if (r.id === currentTarget.streamCountId) return false
      if (r.deleted === true) return false
      if (r.location_id !== currentTarget.locationId) return false
      return new Date(r.count_time).getTime() > new Date(currentTarget.countTime).getTime()
    })
  }

  const open = (normalizedTarget, rowsForCheck) => {
    setTarget(normalizedTarget)
    setRowsArray(rowsForCheck || [])
    setReason('')
    setMode(isRetractBlocked(normalizedTarget, rowsForCheck || []) ? 'hide' : 'retract')
  }

  const close = () => {
    if (submitting) return
    setTarget(null)
    setReason('')
  }

  const confirm = async () => {
    if (!target || !userId) return
    const r = (reason || '').trim()
    if (!r) {
      addToast?.('Reason is required', 'error')
      return
    }
    if (mode !== 'retract' && mode !== 'hide') {
      addToast?.('Pick a delete mode', 'error')
      return
    }
    try {
      setSubmitting(true)
      const resp = await fetch('/api/delete-stream-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count_id: target.streamCountId,
          caller_user_id: userId,
          reason: r,
          mode,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data.ok) {
        addToast?.(`Delete failed: ${data.error || resp.status}`, 'error')
        return
      }
      const modeLabel = data.mode === 'retract' ? 'Retracted' : 'Hidden'
      const reversed = data.mode === 'retract' && typeof data.deltas_reversed === 'number'
        ? ` (${data.deltas_reversed} inventory line${data.deltas_reversed === 1 ? '' : 's'} reversed)`
        : ''
      const tail = data.next_audit_needs_recompute
        ? ' — next audit flagged for re-run'
        : ''
      addToast?.(`${modeLabel}${reversed}${tail}. Lark notified.`, 'success')
      setTarget(null)
      setReason('')
      onReload?.()
    } catch (err) {
      console.error('[delete-stream-count] failed:', err)
      addToast?.(`Delete failed: ${err.message || err}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const retractBlocked = isRetractBlocked(target, rowsArray)

  const modalProps = () => target && ({
    streamCountId: target.streamCountId,
    locationName: target.locationName,
    streamerName: target.streamerName,
    countTime: target.countTime,
    reportedItems: target.reportedItems,
    reason,
    setReason,
    mode,
    setMode,
    retractBlocked,
    submitting,
    onCancel: close,
    onConfirm: confirm,
  })

  return { target, open, close, confirm, modalProps, retractBlocked }
}
