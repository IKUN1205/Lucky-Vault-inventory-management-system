import { useState, useEffect, useMemo } from 'react'
import { Package, X, Loader2, Plus } from 'lucide-react'
import { createSingle, convertToUSD } from '../lib/supabase'
import AddCardSetModal from './AddCardSetModal'

// ============================================================================
// QuickIntakeModal — in-page card intake from the Scan workflow
// ============================================================================
// Opens on Scan page when an Intake-mode scan hits a NEW identifier (not
// already in inventory). Stripped-down version of the full Add Single page:
//
//   - TCG ID / cert# is already filled (from the scan) — readonly display
//   - Form toggle (Raw / Graded) — defaults to Raw (Gary's dominant case)
//   - Set picker (auto-creates via embedded + Add new set modal)
//   - Card name + Card # + Qty + Condition (raw) OR Grade+Company (graded)
//   - Cost is optional
//
// On save: stays on Scan page (parent re-focuses the scan input so the
// scanner gun can immediately read the next card). No navigation away.
// ============================================================================

const BRANDS = ['Pokemon', 'One Piece', 'Magic', 'Yu-Gi-Oh!', 'Lorcana', 'Weiss Schwarz', 'Digimon', 'Other']
const LANGUAGES = ['EN', 'JP', 'KR', 'CN']
const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DM']
const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'Other']
const GRADE_OPTIONS = ['10', '9.5', '9', '8.5', '8', '7', '6', '5', '4', '3', '2', '1', 'Pristine 10', 'Black Label 10', 'Authentic']
const CURRENCIES = ['USD', 'JPY', 'RMB']

export default function QuickIntakeModal({
  scannedId,
  cardSets,
  setCardSets,   // so we can append new sets created via AddCardSetModal
  currentUserId,
  addToast,
  onCancel,
  onCreated,
}) {
  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState({
    form: 'raw',
    brand: 'Pokemon',
    language: 'EN',
    set_id: '',
    card_name: '',
    card_number: '',
    variant: '',
    condition: 'NM',
    quantity: 1,
    grading_company: '',
    grade: '',
    acquisition_cost_native: '',
    acquisition_currency: 'USD',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [showAddSetModal, setShowAddSetModal] = useState(false)

  const filteredSets = useMemo(
    () => (cardSets || []).filter(s => s.brand === form.brand && s.language === form.language),
    [cardSets, form.brand, form.language]
  )

  // Clear set_id if brand/language change invalidates it
  useEffect(() => {
    if (form.set_id && !filteredSets.find(s => s.id === form.set_id)) {
      setForm(f => ({ ...f, set_id: '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSets])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Lightweight validation
    if (!form.card_name.trim()) return addToast?.('Card name is required', 'error')
    if (!form.set_id) return addToast?.('Pick a set', 'error')
    if (form.form === 'graded' && (!form.grading_company || !form.grade)) {
      return addToast?.('Grading company + grade required for graded slabs', 'error')
    }
    if (form.form === 'raw' && !form.condition) {
      return addToast?.('Condition required for raw cards', 'error')
    }

    setSubmitting(true)
    try {
      const setRow = cardSets.find(s => s.id === form.set_id)
      const native = form.acquisition_cost_native === '' ? null : parseFloat(form.acquisition_cost_native)
      const costUsd = (native != null && !isNaN(native))
        ? convertToUSD(native, form.acquisition_currency)
        : null

      const payload = {
        card_name: form.card_name.trim(),
        card_number: form.card_number.trim() || '',
        variant: form.variant.trim() || null,
        set_id: form.set_id,
        brand: setRow?.brand || form.brand,
        language: setRow?.language || form.language,
        form: form.form,
        condition: form.form === 'raw' ? form.condition : null,
        quantity: form.form === 'graded' ? 1 : Math.max(1, parseInt(form.quantity || 1, 10)),
        grading_company: form.form === 'graded' ? form.grading_company : null,
        grade: form.form === 'graded' ? form.grade : null,
        // The scanned identifier — store in tcg_id for raw, cert_number for graded
        tcg_id: form.form === 'raw' ? scannedId : null,
        cert_number: form.form === 'graded' ? scannedId : null,
        acquisition_cost_native: native,
        acquisition_currency: form.acquisition_currency,
        acquisition_cost_usd: costUsd,
        date_acquired: today,
        acquirer_id: currentUserId || null,
        status: 'in_inventory',
        notes: form.notes.trim() || null,
      }
      const created = await createSingle(payload)
      addToast?.(`Added ${created.card_name}`, 'success')
      onCreated?.(created)
    } catch (err) {
      const msg = err.message || 'unknown error'
      // Dupe handling: surface in friendly way
      if (/duplicate key|unique constraint/i.test(msg)) {
        addToast?.(`Identifier ${scannedId} already in inventory`, 'error')
      } else {
        addToast?.(`Save failed: ${msg}`, 'error')
      }
      console.error('[QuickIntakeModal] save failed:', err)
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
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-2xl w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-vault-gold">
            <Package size={18} />
            <h3 className="font-semibold text-base">Quick intake — new card</h3>
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

        {/* Scanned identifier (read-only) */}
        <div className="bg-vault-darker/60 border border-vault-border rounded-lg p-3 mb-3 text-sm flex items-center gap-2">
          <span className="text-gray-400">
            {form.form === 'raw' ? 'TCG ID' : 'Cert #'}:
          </span>
          <span className="font-mono text-white text-base">{scannedId}</span>
          <span className="ml-auto text-gray-500 text-xs">scanned at intake</span>
        </div>

        {/* Form toggle */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Card form</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, form: 'raw' }))}
              className={`py-2 px-3 rounded-lg text-sm font-medium border ${
                form.form === 'raw'
                  ? 'bg-vault-gold/20 border-vault-gold text-vault-gold'
                  : 'border-vault-border text-gray-400 hover:border-vault-border/80'
              }`}
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, form: 'graded' }))}
              className={`py-2 px-3 rounded-lg text-sm font-medium border ${
                form.form === 'graded'
                  ? 'bg-vault-gold/20 border-vault-gold text-vault-gold'
                  : 'border-vault-border text-gray-400 hover:border-vault-border/80'
              }`}
            >
              Graded slab
            </button>
          </div>
        </div>

        {/* Brand + Language */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Brand *</label>
            <select name="brand" value={form.brand} onChange={handleChange} required disabled={submitting}>
              {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Language *</label>
            <select name="language" value={form.language} onChange={handleChange} required disabled={submitting}>
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* Set picker with inline + Add new set */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-gray-400">
              Set * <span className="text-gray-500">({filteredSets.length} {form.brand}/{form.language})</span>
            </label>
            <button
              type="button"
              onClick={() => setShowAddSetModal(true)}
              className="text-xs text-vault-gold hover:text-amber-300 flex items-center gap-1"
            >
              <Plus size={12} /> Add new set
            </button>
          </div>
          <select name="set_id" value={form.set_id} onChange={handleChange} required disabled={submitting}>
            <option value="">
              {filteredSets.length === 0 ? `No ${form.brand}/${form.language} sets — click "Add new set"` : 'Select a set...'}
            </option>
            {filteredSets.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.code ? ` [${s.code}]` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Card name + number + variant */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Card name *</label>
            <input
              type="text"
              name="card_name"
              value={form.card_name}
              onChange={handleChange}
              required
              disabled={submitting}
              placeholder="e.g. Charizard ex 4/102"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Card #</label>
            <input
              type="text"
              name="card_number"
              value={form.card_number}
              onChange={handleChange}
              disabled={submitting}
              placeholder="199/197"
            />
          </div>
        </div>

        {/* Variant */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Variant <span className="text-gray-500">(optional)</span></label>
          <input
            type="text"
            name="variant"
            value={form.variant}
            onChange={handleChange}
            disabled={submitting}
            placeholder="holo / reverse / 1st ed / promo stamp..."
          />
        </div>

        {/* Form-specific: condition + qty for raw, grading_co + grade for graded */}
        {form.form === 'raw' ? (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Condition *</label>
              <select name="condition" value={form.condition} onChange={handleChange} required disabled={submitting}>
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Qty *</label>
              <input
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                min="1"
                required
                disabled={submitting}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Grading company *</label>
              <select name="grading_company" value={form.grading_company} onChange={handleChange} required disabled={submitting}>
                <option value="">Select...</option>
                {GRADING_COMPANIES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Grade *</label>
              <select name="grade" value={form.grade} onChange={handleChange} required disabled={submitting}>
                <option value="">Select...</option>
                {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Cost (optional) */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Cost <span className="text-gray-500">(optional)</span></label>
            <input
              type="number"
              name="acquisition_cost_native"
              value={form.acquisition_cost_native}
              onChange={handleChange}
              min="0"
              step="0.01"
              disabled={submitting}
              placeholder="—"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Currency</label>
            <select name="acquisition_currency" value={form.acquisition_currency} onChange={handleChange} disabled={submitting}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Notes <span className="text-gray-500">(optional)</span></label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={2}
            disabled={submitting}
            className="resize-none"
            placeholder="condition notes, source, anything to remember..."
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
            disabled={submitting || !form.card_name.trim() || !form.set_id}
            className="px-4 py-2 text-sm bg-vault-gold/20 border border-vault-gold/60 text-vault-gold hover:bg-vault-gold/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
            Save &amp; scan next
          </button>
        </div>

        {/* Embedded Add new set modal */}
        {showAddSetModal && (
          <AddCardSetModal
            initialBrand={form.brand}
            initialLanguage={form.language}
            addToast={addToast}
            onCancel={() => setShowAddSetModal(false)}
            onCreated={(newSet) => {
              setCardSets?.(prev => [...prev, newSet])
              setForm(f => ({
                ...f,
                brand: newSet.brand,
                language: newSet.language,
                set_id: newSet.id,
              }))
              setShowAddSetModal(false)
            }}
          />
        )}
      </form>
    </div>
  )
}
