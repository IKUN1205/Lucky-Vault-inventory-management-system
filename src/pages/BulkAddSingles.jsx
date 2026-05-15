import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchCardSets,
  fetchLocations,
  fetchVendors,
  fetchUsers,
  createSinglesBatch,
  convertToUSD
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import AddCardSetModal from '../components/AddCardSetModal'
import { useAuth } from '../lib/AuthContext'
import {
  Layers, Save, ArrowLeft, Plus, Trash2, X, Loader2
} from 'lucide-react'

// ============================================================================
// BulkAddSingles — add many singles in one submission
// ============================================================================
// Two paths into this page:
//   1. Manual: user clicks "Bulk add" from Add Single → start with one empty
//      row, hit "+ Add row" to grow.
//   2. Scanner: SinglesScan's Batch Intake mode passes scanned cert#s via
//      ?certs=ABC,DEF,GHI → one row per cert, form=graded, cert_number
//      pre-filled. User fills the rest.
//
// Shape:
//   - Common fields (brand, language, set, location, acquirer, date,
//     source_type, vendor, currency) apply to EVERY row → fill once.
//   - Per-row fields (form, card_name, card_number, variant,
//     condition or grade+company+cert#, cost, market price) → fill per row.
//
// Submit: createSinglesBatch is one INSERT statement — atomicity is at the
// statement level, so either every row lands or none do. A cert# dupe error
// will abort the whole batch; the toast surfaces the failing cert so the
// user knows which row to remove.
// ============================================================================

const BRANDS = ['Pokemon', 'One Piece', 'Magic', 'Yu-Gi-Oh!', 'Lorcana', 'Weiss Schwarz', 'Digimon', 'Other']
const LANGUAGES = ['EN', 'JP', 'KR', 'CN']
const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DM']
const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'Other']
const GRADE_OPTIONS = [
  '10', '9.5', '9', '8.5', '8', '7', '6', '5', '4', '3', '2', '1',
  'Pristine 10', 'Black Label 10', 'Authentic'
]
const SOURCE_TYPES = [
  { value: '',                label: 'Not specified' },
  { value: 'purchase',        label: 'Direct purchase' },
  { value: 'box_break',       label: 'Pulled from box break' },
  { value: 'trade_in',        label: 'Trade-in' },
  { value: 'grading_return',  label: 'Grading return' },
  { value: 'other',           label: 'Other' }
]
const CURRENCIES = ['USD', 'JPY', 'RMB']

const newEmptyRow = (overrides = {}) => ({
  // crypto.randomUUID is available in modern browsers; fallback to Date.now+rand
  rowKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  form: 'raw',
  card_name: '',
  card_number: '',
  variant: '',
  condition: 'NM',
  quantity: 1,
  grading_company: '',
  grade: '',
  cert_number: '',
  acquisition_cost_native: '',
  current_market_price_usd: '',
  notes: '',
  ...overrides
})

export default function BulkAddSingles() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [cardSets, setCardSets] = useState([])
  const [locations, setLocations] = useState([])
  const [vendors, setVendors] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showAddSetModal, setShowAddSetModal] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  const [common, setCommon] = useState({
    brand: 'Pokemon',
    language: 'EN',
    set_id: '',
    location_id: '',
    acquirer_id: user?.id || '',
    vendor_id: '',
    date_acquired: today,
    source_type: '',
    acquisition_currency: 'USD'
  })

  // Initialize rows from ?certs= URL param if present (Scan → Batch Intake).
  const [rows, setRows] = useState(() => {
    const certsParam = searchParams.get('certs')
    if (certsParam) {
      const list = certsParam
        .split(',')
        .map(c => c.trim())
        .filter(Boolean)
      if (list.length > 0) {
        return list.map(cert => newEmptyRow({
          form: 'graded',
          cert_number: cert,
          condition: ''  // graded rows don't need condition
        }))
      }
    }
    return [newEmptyRow()]
  })

  useEffect(() => {
    (async () => {
      try {
        const [setsData, locData, vendorData, userData] = await Promise.all([
          fetchCardSets(),
          fetchLocations('Physical'),
          fetchVendors(),
          fetchUsers(true)
        ])
        setCardSets(setsData)
        setLocations(locData)
        setVendors(vendorData)
        setUsers(userData)
      } catch (err) {
        console.error('Bulk add load failed:', err)
        addToast(`Failed to load reference data: ${err.message || 'unknown'}`, 'error')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Filtered set dropdown — narrows with brand/language
  const filteredSets = useMemo(
    () => cardSets.filter(s => s.brand === common.brand && s.language === common.language),
    [cardSets, common.brand, common.language]
  )
  // If brand/language change makes current set_id invalid, clear it
  useEffect(() => {
    if (common.set_id && !filteredSets.find(s => s.id === common.set_id)) {
      setCommon(c => ({ ...c, set_id: '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSets])

  // ---- row helpers ----
  const updateRow = (idx, patch) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  const addRow = () => setRows(prev => [...prev, newEmptyRow({
    // Inherit form from last row so adding more graded cards stays graded
    form: prev[prev.length - 1]?.form || 'raw',
    condition: prev[prev.length - 1]?.form === 'graded' ? '' : 'NM'
  })])
  const removeRow = (idx) => {
    setRows(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
  }
  const clearAllRows = () => setRows([newEmptyRow()])

  const handleCommon = (e) => {
    const { name, value } = e.target
    setCommon(c => ({ ...c, [name]: value }))
  }

  // ---- validation ----
  const validate = () => {
    const errors = []
    if (!common.set_id) errors.push('Pick a Set')
    if (!common.date_acquired) errors.push('Date acquired required')
    if (rows.length === 0) errors.push('At least one card row required')
    rows.forEach((r, i) => {
      const rowLabel = `Row ${i + 1}`
      if (!r.card_name.trim()) errors.push(`${rowLabel}: card name required`)
      if (!r.card_number.trim()) errors.push(`${rowLabel}: card number required`)
      if (r.form === 'graded') {
        if (!r.grading_company) errors.push(`${rowLabel}: grading company required`)
        if (!r.grade) errors.push(`${rowLabel}: grade required`)
      }
      if (r.form === 'raw' && !r.condition) errors.push(`${rowLabel}: condition required`)
    })
    return errors
  }

  // ---- submit ----
  const handleSubmit = async (e) => {
    e.preventDefault()
    const errors = validate()
    if (errors.length > 0) {
      addToast(errors[0], 'error')   // first error only, to avoid stacking toasts
      return
    }
    setSubmitting(true)
    try {
      const setRow = cardSets.find(s => s.id === common.set_id)
      const payload = rows.map(r => {
        const native = r.acquisition_cost_native === '' ? null : parseFloat(r.acquisition_cost_native)
        const usd = (native != null && !isNaN(native))
          ? convertToUSD(native, common.acquisition_currency)
          : null
        return {
          card_name: r.card_name.trim(),
          card_number: r.card_number.trim(),
          variant: r.variant.trim() || null,
          set_id: common.set_id,
          brand: setRow?.brand || common.brand,
          language: setRow?.language || common.language,
          form: r.form,
          condition: r.form === 'raw' ? r.condition : null,
          quantity: r.form === 'graded' ? 1 : Math.max(1, parseInt(r.quantity || 1, 10)),
          grading_company: r.form === 'graded' ? r.grading_company : null,
          grade: r.form === 'graded' ? r.grade : null,
          cert_number: r.form === 'graded' && r.cert_number.trim() ? r.cert_number.trim() : null,
          acquisition_cost_native: native,
          acquisition_currency: common.acquisition_currency,
          acquisition_cost_usd: usd,
          current_market_price_usd:
            r.current_market_price_usd === '' || isNaN(parseFloat(r.current_market_price_usd))
              ? null
              : parseFloat(r.current_market_price_usd),
          source_type: common.source_type || null,
          location_id: common.location_id || null,
          acquirer_id: common.acquirer_id || null,
          vendor_id: common.vendor_id || null,
          date_acquired: common.date_acquired,
          notes: r.notes.trim() || null,
          status: 'in_inventory'
        }
      })
      const created = await createSinglesBatch(payload)
      addToast(`Added ${created.length} single${created.length === 1 ? '' : 's'} to inventory`, 'success')
      navigate('/singles')
    } catch (err) {
      console.error('[createSinglesBatch] failed:', err)
      // Friendly error for cert# dupe
      const msg = err.message || 'unknown error'
      if (/duplicate key|unique constraint/i.test(msg) && /cert/i.test(msg)) {
        addToast('Duplicate cert# — one of the rows has a cert that already exists in inventory. Remove or change it and retry.', 'error')
      } else {
        addToast(`Batch save failed: ${msg}`, 'error')
      }
    } finally {
      setSubmitting(false)
    }
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
          <button
            onClick={() => navigate('/singles')}
            className="text-gray-400 hover:text-white text-sm flex items-center gap-1 mb-2"
          >
            <ArrowLeft size={16} /> Back to Singles
          </button>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <Layers className="text-vault-gold" />
            Bulk Add Singles
          </h1>
          <p className="text-gray-400 mt-1">
            Common fields apply to every row · {rows.length} card{rows.length === 1 ? '' : 's'} ready
          </p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>Fill the <strong>common fields</strong> once at the top (brand, set, location, acquirer, date, source). Then add one row per card with name + number + form-specific details.</p>
          <p className="text-gray-400 text-xs">All rows submit in one transaction — if any row's cert# clashes with an existing inventory cert, the whole batch aborts and you can fix and retry. To bulk-intake from scanned barcodes, use Scan Singles → Batch Intake mode first.</p>
        </div>
      </Instructions>

      <form onSubmit={handleSubmit}>
        {/* ============================================================ */}
        {/* Common fields                                                  */}
        {/* ============================================================ */}
        <div className="card mb-6">
          <h2 className="text-white font-semibold text-base mb-4">Common (applies to every row)</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Brand *</label>
              <select name="brand" value={common.brand} onChange={handleCommon} required>
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Language *</label>
              <select name="language" value={common.language} onChange={handleCommon} required>
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-gray-400">
                  Set * <span className="text-gray-500">({filteredSets.length} {common.brand}/{common.language})</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddSetModal(true)}
                  className="text-xs text-vault-gold hover:text-amber-300 flex items-center gap-1"
                >
                  <Plus size={12} /> Add new set
                </button>
              </div>
              <select name="set_id" value={common.set_id} onChange={handleCommon} required>
                <option value="">
                  {filteredSets.length === 0 ? `No ${common.brand}/${common.language} sets — click "Add new set"` : 'Select a set...'}
                </option>
                {filteredSets.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.code ? ` [${s.code}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Location</label>
              <select name="location_id" value={common.location_id} onChange={handleCommon}>
                <option value="">—</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Acquired by</label>
              <select name="acquirer_id" value={common.acquirer_id} onChange={handleCommon}>
                <option value="">—</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Vendor</label>
              <select name="vendor_id" value={common.vendor_id} onChange={handleCommon}>
                <option value="">—</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Date acquired *</label>
              <input
                type="date"
                name="date_acquired"
                value={common.date_acquired}
                onChange={handleCommon}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Source</label>
              <select name="source_type" value={common.source_type} onChange={handleCommon}>
                {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cost currency</label>
              <select name="acquisition_currency" value={common.acquisition_currency} onChange={handleCommon}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* Rows                                                           */}
        {/* ============================================================ */}
        <div className="card mb-6 p-0">
          <div className="px-4 py-3 border-b border-vault-border flex items-center justify-between">
            <h2 className="text-white font-semibold text-base">
              Cards <span className="text-gray-500 text-sm">({rows.length})</span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearAllRows}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                <X size={12} /> Clear all
              </button>
              <button
                type="button"
                onClick={addRow}
                className="text-xs text-vault-gold hover:text-amber-300 flex items-center gap-1"
              >
                <Plus size={12} /> Add row
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs uppercase border-b border-vault-border">
                <tr>
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2 w-28">Form</th>
                  <th className="text-left px-3 py-2">Card name *</th>
                  <th className="text-left px-3 py-2 w-28">Card # *</th>
                  <th className="text-left px-3 py-2 w-32">Variant</th>
                  <th className="text-left px-3 py-2 w-40">Cond / Grade *</th>
                  <th className="text-left px-3 py-2 w-32">Cert #</th>
                  <th className="text-right px-3 py-2 w-24">Cost ({common.acquisition_currency})</th>
                  <th className="text-right px-3 py-2 w-24">Market $</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.rowKey} className="border-b border-vault-border/50 last:border-0">
                    <td className="px-3 py-2 text-gray-500 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <select
                        value={r.form}
                        onChange={(e) => {
                          const f = e.target.value
                          updateRow(idx, {
                            form: f,
                            // Reset form-specific fields when toggling
                            condition: f === 'raw' ? 'NM' : '',
                            grading_company: f === 'graded' ? r.grading_company : '',
                            grade: f === 'graded' ? r.grade : '',
                            cert_number: f === 'graded' ? r.cert_number : '',
                            quantity: f === 'graded' ? 1 : (r.quantity || 1)
                          })
                        }}
                        className="text-xs"
                      >
                        <option value="raw">Raw</option>
                        <option value="graded">Graded</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.card_name}
                        onChange={(e) => updateRow(idx, { card_name: e.target.value })}
                        placeholder="e.g. Charizard ex"
                        required
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.card_number}
                        onChange={(e) => updateRow(idx, { card_number: e.target.value })}
                        placeholder="199/197"
                        required
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.variant}
                        onChange={(e) => updateRow(idx, { variant: e.target.value })}
                        placeholder="holo / reverse / promo"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {r.form === 'graded' ? (
                        <div className="flex gap-1">
                          <select
                            value={r.grading_company}
                            onChange={(e) => updateRow(idx, { grading_company: e.target.value })}
                            required
                            className="text-xs"
                          >
                            <option value="">Co...</option>
                            {GRADING_COMPANIES.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                          <select
                            value={r.grade}
                            onChange={(e) => updateRow(idx, { grade: e.target.value })}
                            required
                            className="text-xs"
                          >
                            <option value="">Gr.</option>
                            {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                      ) : (
                        <select
                          value={r.condition}
                          onChange={(e) => updateRow(idx, { condition: e.target.value })}
                          required
                          className="text-xs"
                        >
                          {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.form === 'graded' ? (
                        <input
                          type="text"
                          value={r.cert_number}
                          onChange={(e) => updateRow(idx, { cert_number: e.target.value })}
                          placeholder="12345678"
                          className="font-mono text-xs"
                        />
                      ) : (
                        <input
                          type="number"
                          min="1"
                          value={r.quantity}
                          onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                          placeholder="qty"
                          className="text-xs"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.acquisition_cost_native}
                        onChange={(e) => updateRow(idx, { acquisition_cost_native: e.target.value })}
                        placeholder="—"
                        className="text-right text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.current_market_price_usd}
                        onChange={(e) => updateRow(idx, { current_market_price_usd: e.target.value })}
                        placeholder="—"
                        className="text-right text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={rows.length === 1}
                        className="text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={rows.length === 1 ? 'At least one row required' : 'Remove row'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-vault-border">
            <button
              type="button"
              onClick={addRow}
              className="text-xs text-vault-gold hover:text-amber-300 flex items-center gap-1"
            >
              <Plus size={12} /> Add row
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* Submit                                                         */}
        {/* ============================================================ */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/singles')}
            className="btn btn-secondary flex-1"
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
            {submitting
              ? <Loader2 className="animate-spin" size={20} />
              : <><Save size={20} /> Save all {rows.length} card{rows.length === 1 ? '' : 's'}</>}
          </button>
        </div>
      </form>

      {/* Inline add new set modal — same as Add Single */}
      {showAddSetModal && (
        <AddCardSetModal
          initialBrand={common.brand}
          initialLanguage={common.language}
          addToast={addToast}
          onCancel={() => setShowAddSetModal(false)}
          onCreated={(newSet) => {
            setCardSets(prev => [...prev, newSet])
            setCommon(c => ({
              ...c,
              brand: newSet.brand,
              language: newSet.language,
              set_id: newSet.id
            }))
            setShowAddSetModal(false)
          }}
        />
      )}
    </div>
  )
}
