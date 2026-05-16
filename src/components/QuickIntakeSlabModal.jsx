import { useState } from 'react'
import { ShieldCheck, X, Loader2 } from 'lucide-react'
import { createSlab, notifySlabsLark } from '../lib/supabase'

// ============================================================================
// QuickIntakeSlabModal — in-page slab intake from Scan workflow
// ============================================================================
// Opens when an Intake-mode scan hits a brand-new cert#. Three required
// fields per user directive: cert # (pre-filled from scan), grading_company
// (dropdown), item_name (free text — the boss's own descriptor). Cost is
// optional. Everything else nullable for v1.
//
// On save: stays on Scan page (parent re-focuses the scan input).
// ============================================================================

const GRADING_COMPANIES = ['PSA', 'CGC', 'BGS', 'SGC', 'Other']
const CURRENCIES = ['USD']

export default function QuickIntakeSlabModal({
  scannedCert,
  currentUserId,
  currentUserName,
  addToast,
  onCancel,
  onCreated,
}) {
  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState({
    grading_company: 'PSA',
    item_name: '',
    acquisition_cost_usd: '',
    notes: '',
    date_acquired: today,
  })
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.item_name.trim()) return addToast?.('Item name is required', 'error')
    if (!form.grading_company) return addToast?.('Grading company is required', 'error')

    setSubmitting(true)
    try {
      const cost = form.acquisition_cost_usd === ''
        ? null
        : parseFloat(form.acquisition_cost_usd)

      const payload = {
        cert_number: scannedCert,
        grading_company: form.grading_company,
        item_name: form.item_name.trim(),
        status: 'in_inventory',
        date_acquired: form.date_acquired,
        acquirer_id: currentUserId || null,
        acquisition_cost_usd: cost,
        notes: form.notes.trim() || null,
      }
      const created = await createSlab(payload)
      // Fire-and-forget Lark notification
      notifySlabsLark({
        type: 'slab_intake',
        cert_number: created.cert_number,
        grading_company: created.grading_company,
        item_name: created.item_name,
        cost_usd: created.acquisition_cost_usd,
        operator_name: currentUserName,
      })
      addToast?.(`Slab #${created.cert_number} added`, 'success')
      onCreated?.(created)
    } catch (err) {
      const msg = err.message || 'unknown error'
      if (/duplicate key|unique constraint/i.test(msg)) {
        addToast?.(`Cert # ${scannedCert} already in inventory`, 'error')
      } else {
        addToast?.(`Save failed: ${msg}`, 'error')
      }
      console.error('[QuickIntakeSlabModal] save failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={submitting ? undefined : onCancel}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-lg w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-vault-gold">
            <ShieldCheck size={18} />
            <h3 className="font-semibold text-base">Quick intake — new slab</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-gray-500 hover:text-white p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cert # readonly */}
        <div className="bg-vault-darker/60 border border-vault-border rounded-lg p-3 mb-3 text-sm flex items-center gap-2">
          <span className="text-gray-400">Cert #:</span>
          <span className="font-mono text-white text-base">{scannedCert}</span>
          <span className="ml-auto text-gray-500 text-xs">scanned at intake</span>
        </div>

        {/* Grading company */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Grading company *</label>
          <select
            name="grading_company"
            value={form.grading_company}
            onChange={handleChange}
            disabled={submitting}
            required
          >
            {GRADING_COMPANIES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Item name */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">
            Item name *{' '}
            <span className="text-gray-600">
              (full descriptor, e.g. "CGC Pristine 10 Charizard ex #234 Special Illustration Rare")
            </span>
          </label>
          <input
            type="text"
            name="item_name"
            value={form.item_name}
            onChange={handleChange}
            required
            disabled={submitting}
            placeholder="e.g. PSA 10 Charizard #4/102 Base Set"
            autoFocus
          />
        </div>

        {/* Cost (optional) */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Cost <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="number"
              name="acquisition_cost_usd"
              value={form.acquisition_cost_usd}
              onChange={handleChange}
              min="0"
              step="0.01"
              disabled={submitting}
              placeholder="—"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date acquired *</label>
            <input
              type="date"
              name="date_acquired"
              value={form.date_acquired}
              onChange={handleChange}
              required
              disabled={submitting}
            />
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">
            Notes <span className="text-gray-500">(optional)</span>
          </label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={2}
            disabled={submitting}
            className="resize-none"
            placeholder="anything else to remember..."
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !form.item_name.trim()}
            className="px-4 py-2 text-sm bg-vault-gold/20 border border-vault-gold/60 text-vault-gold hover:bg-vault-gold/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Save &amp; scan next
          </button>
        </div>
      </form>
    </div>
  )
}
