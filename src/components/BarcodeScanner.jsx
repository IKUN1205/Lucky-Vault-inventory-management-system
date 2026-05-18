import React, { useState, useEffect, useRef } from 'react'
import { ScanLine, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import { updateProductBarcode } from '../lib/supabase'

// ============================================================================
// BarcodeScanner — shared barcode entry box used by Intake / Manual /
// Move Inventory and (optionally) Stream Counts.
// ============================================================================
// Hardware contract: a USB barcode scanner gun acts as a keyboard — it types
// the digits of the barcode then sends Enter. So this component is really
// just a focused text input that listens for the Enter key. No camera APIs,
// no special drivers.
//
// Lookup is purely client-side against the `products` prop (already loaded
// by the parent page). Matching by exact equality on `barcode`. Match found
// → onMatched(product) callback fires; no match → an "associate this
// barcode" modal opens, the user picks the right SKU from a SearchableSelect,
// and we PATCH products.barcode = scanned + then call onMatched(product).
// Over time this "learn as you scan" path fills in every SKU we touch
// without anyone doing a separate barcode-entry pass.
//
// Props:
//   - products:   [{ id, name, barcode?, brand, language, type, category }]
//                 already-loaded products list (parent fetches once).
//   - onMatched:  (product) => void
//   - addToast:   optional. (msg, level) => void  — reuses parent toast.
//   - hint:       short helper text shown under the input.
//   - placeholder: input placeholder (defaults to generic UPC prompt).
//   - onBarcodeAssociated: optional. (productId, barcode) => void  — fires
//                 after a successful associate so parent can update its
//                 in-memory products list without re-fetching.
// ============================================================================

export default function BarcodeScanner({
  products = [],
  onMatched,
  addToast,
  hint = 'Scan a product\'s UPC barcode with your scanner gun, or type the digits and press Enter.',
  placeholder = 'Scan or type a barcode (UPC / EAN)…',
  onBarcodeAssociated,
}) {
  const [value, setValue] = useState('')
  const [processing, setProcessing] = useState(false)
  const [unknownBarcode, setUnknownBarcode] = useState(null)   // string the user just scanned that didn't match
  const [lastMatched, setLastMatched] = useState(null)         // {product, ts} — for the green "✓ matched X" line
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const refocus = () => setTimeout(() => inputRef.current?.focus(), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const code = value.trim()
    if (!code) { refocus(); return }

    // Look up client-side. Exact match on `barcode`.
    const match = products.find(p => (p.barcode || '').trim() === code)
    if (match) {
      onMatched?.(match)
      setLastMatched({ product: match, ts: Date.now() })
      setValue('')
      refocus()
      return
    }

    // No match — open the associate-this-barcode modal so the user can
    // teach the system what SKU this code maps to. The modal handles the
    // save + downstream callback.
    setUnknownBarcode(code)
    setValue('')
  }

  // Called from the modal once the user has picked the SKU to associate.
  const handleAssociate = async (productId) => {
    if (!productId || !unknownBarcode) return
    try {
      setProcessing(true)
      await updateProductBarcode(productId, unknownBarcode)
      const associated = products.find(p => p.id === productId)
      // Update parent's products list so future scans of the same code
      // hit the cache directly (no second modal). The actual write hit DB
      // above; this just keeps the in-memory copy consistent.
      onBarcodeAssociated?.(productId, unknownBarcode)
      // Pretend it was a normal match so the parent's onMatched fires.
      if (associated) {
        const enriched = { ...associated, barcode: unknownBarcode }
        onMatched?.(enriched)
        setLastMatched({ product: enriched, ts: Date.now() })
        addToast?.(`Barcode ${unknownBarcode} associated with ${associated.name}`, 'success')
      }
      setUnknownBarcode(null)
      refocus()
    } catch (err) {
      console.error('[BarcodeScanner] associate failed:', err)
      addToast?.(`Failed to associate barcode: ${err.message || err}`, 'error')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="bg-vault-darker/40 border border-vault-border rounded-lg p-3 space-y-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <ScanLine size={18} className="text-vault-gold flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={processing}
          className="flex-1 px-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-sm focus:outline-none focus:border-vault-gold disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
          // Hint to mobile browsers that this is a numeric scanner field —
          // most UPCs are digits-only.
          inputMode="numeric"
        />
        <button
          type="submit"
          disabled={processing || !value.trim()}
          className="px-3 py-2 bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md text-sm hover:bg-vault-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? <Loader2 size={14} className="animate-spin" /> : 'Lookup'}
        </button>
      </form>
      <div className="text-[11px] text-gray-500 leading-snug">{hint}</div>
      {lastMatched && (Date.now() - lastMatched.ts < 4000) && (
        <div className="flex items-center gap-2 text-xs text-green-300">
          <CheckCircle2 size={12} />
          Matched: {lastMatched.product.name}
        </div>
      )}

      {unknownBarcode && (
        <UnknownBarcodeModal
          barcode={unknownBarcode}
          products={products}
          submitting={processing}
          onCancel={() => { setUnknownBarcode(null); refocus() }}
          onConfirm={handleAssociate}
        />
      )}
    </div>
  )
}

// Modal that pops when a scanned barcode doesn't match any product.
// User picks the SKU to associate, we PATCH the product's barcode field,
// then onConfirm(productId) fires. Dropdown is SearchableSelect so the
// user can type to filter long product lists fast.
function UnknownBarcodeModal({ barcode, products, submitting, onCancel, onConfirm }) {
  const [picked, setPicked] = useState('')

  const options = products
    .filter(p => p.active !== false)
    .map(p => ({
      ...p,
      _label: `${p.brand || '?'} / ${p.language || '?'} / ${p.type || '?'}  —  ${p.name}${p.barcode ? `  (already has barcode ${p.barcode})` : ''}`,
    }))

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-xl w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-vault-gold">
            <AlertTriangle size={18} />
            <h3 className="font-semibold text-base">Unknown barcode</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-gray-500 hover:text-white p-1 -m-1"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-gray-300 mb-3">
          The barcode <code className="px-1.5 py-0.5 bg-vault-darker rounded text-vault-gold">{barcode}</code> isn't associated with any product yet.
          Pick the matching product below and we'll remember it for next time.
        </p>

        <label className="block text-xs text-gray-400 mb-1">Associate with product</label>
        <SearchableSelect
          options={options}
          value={picked}
          onChange={(opt) => setPicked(opt?.id || '')}
          getOptionLabel={(opt) => opt._label}
          getOptionValue={(opt) => opt.id}
          placeholder="Search products by name / brand / language…"
          disabled={submitting}
        />

        <div className="text-[11px] text-gray-500 mt-2 leading-snug">
          If this product doesn't exist yet, cancel this dialog and go to <strong>Add Product</strong> first — there's a barcode field there you can fill in directly.
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(picked)}
            disabled={submitting || !picked}
            className="px-3 py-2 text-sm bg-vault-gold/20 border border-vault-gold/60 text-vault-gold hover:bg-vault-gold/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
            Associate & continue
          </button>
        </div>
      </div>
    </div>
  )
}
