import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchCardSets,
  fetchLocations,
  fetchVendors,
  fetchUsers,
  createSingle,
  convertToUSD
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import { Layers, Save, ArrowLeft } from 'lucide-react'

const BRANDS = ['Pokemon', 'One Piece', 'Magic', 'Yu-Gi-Oh!', 'Other']
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

export default function AddSingle() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [cardSets, setCardSets] = useState([])
  const [locations, setLocations] = useState([])
  const [vendors, setVendors] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState({
    // Identity
    brand: 'Pokemon',
    language: 'EN',
    set_id: '',
    card_name: '',
    card_number: '',
    variant: '',

    // Form
    form: 'raw',

    // Raw-specific
    condition: 'NM',
    quantity: 1,

    // Graded-specific
    grading_company: '',
    grade: '',
    cert_number: '',

    // Cost (optional in v1)
    acquisition_cost_native: '',
    acquisition_currency: 'USD',
    current_market_price_usd: '',

    // Provenance (optional in v1)
    source_type: '',

    // Location / ownership
    location_id: '',
    acquirer_id: user?.id || '',
    vendor_id: '',

    date_acquired: today,
    notes: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [setsData, locData, vendorData, userData] = await Promise.all([
        fetchCardSets(),
        fetchLocations('Physical'),
        fetchVendors(),
        fetchUsers()
      ])
      setCardSets(setsData)
      setLocations(locData)
      setVendors(vendorData)
      setUsers(userData)
    } catch (error) {
      console.error('Error loading reference data:', error)
      addToast('Failed to load reference data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Filter sets to whatever brand + language the user picked.
  const filteredSets = useMemo(() => {
    return cardSets.filter(s =>
      s.brand === form.brand && s.language === form.language
    )
  }, [cardSets, form.brand, form.language])

  // When brand or language changes, clear set_id if the previous selection
  // no longer matches the new filter.
  useEffect(() => {
    if (form.set_id && !filteredSets.find(s => s.id === form.set_id)) {
      setForm(f => ({ ...f, set_id: '' }))
    }
  }, [filteredSets]) // eslint-disable-line react-hooks/exhaustive-deps

  // When form switches, reset conditional fields so we never submit
  // condition='NM' on a graded card or grade='10' on a raw card.
  const handleFormToggle = (newForm) => {
    setForm(f => ({
      ...f,
      form: newForm,
      condition: newForm === 'raw' ? (f.condition || 'NM') : '',
      quantity: newForm === 'raw' ? (f.quantity || 1) : 1,
      grading_company: newForm === 'graded' ? f.grading_company : '',
      grade: newForm === 'graded' ? f.grade : '',
      cert_number: newForm === 'graded' ? f.cert_number : ''
    }))
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  // Currency follows language for sensible defaults, but is still editable.
  const handleLanguageChange = (e) => {
    const lang = e.target.value
    const defaultCurrency =
      lang === 'JP' ? 'JPY' :
      lang === 'CN' ? 'RMB' :
      'USD'
    setForm(f => ({ ...f, language: lang, acquisition_currency: defaultCurrency }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Required fields
    if (!form.card_name.trim()) return addToast('Card name is required', 'error')
    if (!form.card_number.trim()) return addToast('Card number is required', 'error')
    if (!form.set_id) return addToast('Please select a set', 'error')
    if (form.form === 'raw' && !form.condition) return addToast('Condition is required for raw cards', 'error')
    if (form.form === 'graded' && (!form.grading_company || !form.grade)) {
      return addToast('Grading company and grade are required for graded cards', 'error')
    }

    // Convert numerics
    const qty = parseInt(form.quantity, 10) || 1
    if (form.form === 'raw' && qty < 1) {
      return addToast('Quantity must be at least 1', 'error')
    }

    const costNative = form.acquisition_cost_native === ''
      ? null
      : parseFloat(form.acquisition_cost_native)
    const marketUsd = form.current_market_price_usd === ''
      ? null
      : parseFloat(form.current_market_price_usd)

    // Currency conversion uses the same static rates module Lucky Vault uses
    // elsewhere. For USD it's a no-op; for JPY/RMB it converts to USD so the
    // singles dashboard can sum a single currency.
    let costUsd = null
    if (costNative != null && !Number.isNaN(costNative)) {
      costUsd = convertToUSD(costNative, form.acquisition_currency)
    }

    const payload = {
      // Identity
      card_name: form.card_name.trim(),
      card_number: form.card_number.trim(),
      set_id: form.set_id,
      brand: form.brand,
      language: form.language,
      variant: form.variant.trim() || null,

      // Form
      form: form.form,

      // Raw vs graded
      condition: form.form === 'raw' ? form.condition : null,
      quantity: form.form === 'raw' ? qty : 1,
      grading_company: form.form === 'graded' ? form.grading_company : null,
      grade: form.form === 'graded' ? form.grade : null,
      cert_number: form.form === 'graded' && form.cert_number.trim()
        ? form.cert_number.trim()
        : null,

      // Cost
      acquisition_cost_usd: costUsd,
      acquisition_cost_native: costNative,
      acquisition_currency: form.acquisition_currency,
      current_market_price_usd: marketUsd,
      market_price_source: marketUsd != null ? 'manual' : null,
      market_price_updated_at: marketUsd != null ? new Date().toISOString() : null,

      // Provenance
      source_type: form.source_type || null,

      // Location / ownership
      location_id: form.location_id || null,
      acquirer_id: form.acquirer_id || null,
      vendor_id: form.vendor_id || null,

      // Lifecycle
      status: 'in_inventory',
      date_acquired: form.date_acquired,
      notes: form.notes.trim() || null
    }

    setSubmitting(true)
    try {
      await createSingle(payload)
      addToast('Single added', 'success')
      navigate('/singles')
    } catch (error) {
      console.error('Error adding single:', error)
      addToast(`Failed to add: ${error.message || 'unknown error'}`, 'error')
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

  const isGraded = form.form === 'graded'

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
            Add Single
          </h1>
          <p className="text-gray-400 mt-1">Record a new graded slab or raw card</p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p className="font-medium text-white">Required: card name, card number, set, condition (raw) or grading info (graded).</p>
          <p>Cost and market price are optional in v1. Leave blank if unknown — they can be edited later.</p>
          <p>Raw cards can be stacked via quantity (e.g. 5x Pikachu NM). Graded cards are always one row per cert#.</p>
        </div>
      </Instructions>

      <form onSubmit={handleSubmit} className="card max-w-3xl">
        {/* Form toggle: Raw vs Graded */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Card form *</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleFormToggle('raw')}
              className={`btn flex-1 ${form.form === 'raw' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => handleFormToggle('graded')}
              className={`btn flex-1 ${form.form === 'graded' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Graded slab
            </button>
          </div>
        </div>

        {/* Identity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Brand *</label>
            <select name="brand" value={form.brand} onChange={handleChange} required>
              {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Language *</label>
            <select name="language" value={form.language} onChange={handleLanguageChange} required>
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Set * <span className="text-gray-500 text-xs">({filteredSets.length} {form.brand} / {form.language} sets)</span>
            </label>
            <select name="set_id" value={form.set_id} onChange={handleChange} required>
              <option value="">Select a set...</option>
              {filteredSets.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.code ? ` [${s.code}]` : ''}
                </option>
              ))}
            </select>
            {filteredSets.length === 0 && (
              <p className="text-yellow-400 text-xs mt-1">
                No sets for {form.brand} / {form.language}. Ask an admin to add one to card_sets.
              </p>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">Card name *</label>
            <input
              type="text"
              name="card_name"
              value={form.card_name}
              onChange={handleChange}
              placeholder="e.g. Charizard ex"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Card number *</label>
            <input
              type="text"
              name="card_number"
              value={form.card_number}
              onChange={handleChange}
              placeholder="e.g. 199/197"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Variant</label>
            <input
              type="text"
              name="variant"
              value={form.variant}
              onChange={handleChange}
              placeholder="holo / reverse / 1st ed / promo"
            />
          </div>
        </div>

        {/* Raw vs Graded specifics */}
        {isGraded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 rounded-lg bg-vault-darker border border-vault-border">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Grading company *</label>
              <select
                name="grading_company"
                value={form.grading_company}
                onChange={handleChange}
                required={isGraded}
              >
                <option value="">Select...</option>
                {GRADING_COMPANIES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Grade *</label>
              <select
                name="grade"
                value={form.grade}
                onChange={handleChange}
                required={isGraded}
              >
                <option value="">Select...</option>
                {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Cert #
                <span className="text-gray-500 text-xs ml-2">unique per card; leave blank if unknown</span>
              </label>
              <input
                type="text"
                name="cert_number"
                value={form.cert_number}
                onChange={handleChange}
                placeholder="e.g. 12345678"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 rounded-lg bg-vault-darker border border-vault-border">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Condition *</label>
              <select
                name="condition"
                value={form.condition}
                onChange={handleChange}
                required={!isGraded}
              >
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Quantity *</label>
              <input
                type="number"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                min="1"
                step="1"
                required={!isGraded}
              />
            </div>
          </div>
        )}

        {/* Cost (optional in v1) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Acquisition cost</label>
            <input
              type="number"
              name="acquisition_cost_native"
              value={form.acquisition_cost_native}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Currency</label>
            <select
              name="acquisition_currency"
              value={form.acquisition_currency}
              onChange={handleChange}
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Market price (USD)</label>
            <input
              type="number"
              name="current_market_price_usd"
              value={form.current_market_price_usd}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="Optional"
            />
          </div>
        </div>

        {/* Provenance + location */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Source</label>
            <select name="source_type" value={form.source_type} onChange={handleChange}>
              {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Location</label>
            <select name="location_id" value={form.location_id} onChange={handleChange}>
              <option value="">Select location...</option>
              {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Acquirer</label>
            <select name="acquirer_id" value={form.acquirer_id} onChange={handleChange}>
              <option value="">Select...</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Vendor</label>
            <select name="vendor_id" value={form.vendor_id} onChange={handleChange}>
              <option value="">Select...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date acquired *</label>
            <input
              type="date"
              name="date_acquired"
              value={form.date_acquired}
              onChange={handleChange}
              required
            />
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows="3"
            placeholder="Optional"
          />
        </div>

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
              ? <div className="spinner w-5 h-5 border-2"></div>
              : <><Save size={20} /> Add Single</>
            }
          </button>
        </div>
      </form>
    </div>
  )
}
