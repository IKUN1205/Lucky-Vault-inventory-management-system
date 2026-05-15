import { useState } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { createCardSet } from '../lib/supabase'

// ============================================================================
// AddCardSetModal — inline set creation from the Add Single form
// ============================================================================
// The seeded card_sets table only covers Pokemon EN/JP/CN + One Piece EN/JP.
// Anything else (Magic, Yu-Gi-Oh, Lorcana, Weiss Schwarz, One Piece KR, new
// Pokemon releases, etc.) was previously a dead end on the Add Single page —
// dropdown would be empty + user couldn't proceed without "asking an admin".
//
// This modal lets the same user creating the Single also create the missing
// Set inline. On success the parent appends it to its cardSets state and
// auto-selects it, so the user is back in the Add Single flow with no
// context switch.
//
// Brand + language are pre-filled from the parent form (the most common
// case: "I'm adding a Magic card in EN, no Magic EN sets exist yet").
// Editable in case the user wants to create a different one anyway.
// ============================================================================

const BRAND_OPTIONS = ['Pokemon', 'One Piece', 'Magic', 'Yu-Gi-Oh!', 'Lorcana', 'Weiss Schwarz', 'Digimon', 'Other']
const LANGUAGE_OPTIONS = ['EN', 'JP', 'KR', 'CN']

export default function AddCardSetModal({ initialBrand, initialLanguage, onCancel, onCreated, addToast }) {
  const [form, setForm] = useState({
    brand: initialBrand || 'Pokemon',
    language: initialLanguage || 'EN',
    name: '',
    code: '',
    release_date: ''
  })
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      addToast?.('Set name is required', 'error')
      return
    }
    if (!form.brand || !form.language) {
      addToast?.('Brand and language are required', 'error')
      return
    }
    setSubmitting(true)
    try {
      const created = await createCardSet({
        brand: form.brand,
        language: form.language,
        name: form.name.trim(),
        code: form.code.trim() || null,
        release_date: form.release_date || null,
        active: true
      })
      addToast?.(`Set "${created.name}" created`, 'success')
      onCreated?.(created)
    } catch (err) {
      // Postgres UNIQUE violation on (brand, language, name) → friendly message
      const msg = err.message || 'unknown error'
      if (/duplicate key|unique constraint/i.test(msg)) {
        addToast?.(`A set named "${form.name}" already exists for ${form.brand} / ${form.language} — pick it from the dropdown`, 'error')
      } else {
        addToast?.(`Failed to create set: ${msg}`, 'error')
      }
      console.error('[createCardSet] failed:', err)
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
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-md w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-vault-gold">
            <Plus size={18} />
            <h3 className="font-semibold text-base">Add new card set</h3>
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

        <p className="text-xs text-gray-400 mb-3">
          Creates a new entry in card_sets so it shows up in the Set dropdown for everyone going forward. Brand + language + name must be unique together.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Brand *</label>
            <select
              name="brand"
              value={form.brand}
              onChange={handleChange}
              required
              disabled={submitting}
            >
              {BRAND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Language *</label>
            <select
              name="language"
              value={form.language}
              onChange={handleChange}
              required
              disabled={submitting}
            >
              {LANGUAGE_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Set name *</label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            disabled={submitting}
            placeholder="e.g. Murders at Karlov Manor / Memorial Collection / Romance Dawn"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Set code <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              name="code"
              value={form.code}
              onChange={handleChange}
              disabled={submitting}
              placeholder="e.g. MKM / EB-04 / OP-13"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Release date <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="date"
              name="release_date"
              value={form.release_date}
              onChange={handleChange}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
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
            disabled={submitting || !form.name.trim()}
            className="px-3 py-2 text-sm bg-vault-gold/20 border border-vault-gold/60 text-vault-gold hover:bg-vault-gold/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create set
          </button>
        </div>
      </form>
    </div>
  )
}
