import React, { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, updateProductBarcode } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import BarcodeScanner from '../components/BarcodeScanner'
import {
  ScanLine, Search, CheckCircle2, X, AlertCircle, Trash2, Edit2, Loader2,
} from 'lucide-react'

// ============================================================================
// Product Barcodes — admin page for filling / managing UPC barcodes on the
// `products.barcode` column. Primary use case is the one-time backfill pass
// after the scanner infrastructure was built but before any barcodes were
// captured (412 sealed SKUs, 0 mapped at time of writing).
//
// Two parallel workflows:
//   1. Scan-first: USB scanner gun → if matches an existing mapping, just
//      confirms it; if unknown, BarcodeScanner pops its own associate-modal
//      so the user can pick which SKU this code belongs to.
//   2. SKU-first: click any product row → modal opens prompting for a
//      barcode (typed or scanned). Useful when you have the UPC noted
//      down from packaging photos / external source instead of the physical
//      box in front of you.
//
// Both write to `products.barcode` via updateProductBarcode (which is also
// what the BarcodeScanner's associate-modal uses). The DB has a partial
// unique index on barcode, so duplicate UPCs will throw — the toast just
// surfaces that error rather than silently dropping the write.
// ============================================================================

export default function ProductBarcodes() {
  const { toasts, addToast, removeToast } = useToast()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('unmapped')  // 'unmapped' | 'mapped'
  const [search, setSearch] = useState('')
  const [editingProduct, setEditingProduct] = useState(null)  // SKU-first modal target

  useEffect(() => {
    loadProducts()
  }, [])

  // Pull sealed + pack products only — singles / slabs have their own
  // identity (TCG cert#) and don't need UPC mapping here. We intentionally
  // include `active=false` rows too because admins occasionally re-activate
  // a paused SKU and want its previously-recorded barcode to still work.
  const loadProducts = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, brand, name, category, language, type, barcode, active')
        .in('type', ['Sealed', 'Pack'])
        .order('brand', { ascending: true })
        .order('language', { ascending: true })
        .order('name', { ascending: true })
      if (error) throw error
      setProducts(data || [])
    } catch (err) {
      console.error('[ProductBarcodes] load failed:', err)
      addToast('Failed to load products', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Patch a single product's barcode in our local list without re-fetching.
  // Used by both scan-flow (onBarcodeAssociated) and SKU-flow (modal save).
  // Passing barcode=null clears the mapping.
  const patchLocalBarcode = (productId, barcode) => {
    setProducts(prev => prev.map(p =>
      p.id === productId ? { ...p, barcode: barcode || null } : p
    ))
  }

  const mappedCount = useMemo(() => products.filter(p => p.barcode).length, [products])
  const unmappedCount = products.length - mappedCount
  const percent = products.length === 0 ? 0 : Math.round((mappedCount / products.length) * 1000) / 10

  // Filter by current tab + search box. Search hits brand / name / language
  // / category / barcode itself (so admins can type a known UPC to find which
  // SKU it's mapped to, when troubleshooting "wrong product appeared").
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (tab === 'unmapped' && p.barcode) return false
      if (tab === 'mapped' && !p.barcode) return false
      if (!q) return true
      return (
        (p.brand || '').toLowerCase().includes(q) ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.language || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      )
    })
  }, [products, tab, search])

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

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ScanLine className="text-vault-gold" />
          Product Barcodes
        </h1>
        <p className="text-gray-400 mt-1">
          Associate UPC barcodes with sealed products so scanning works on Intake / Move / Online Orders / Purchase.
        </p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Two ways to fill in a barcode:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>
              <span className="text-vault-gold">Scan-first</span>: pick up a sealed box, scan its UPC with the scanner gun.
              If the code is already known it confirms the match; if it's new, a popup lets you pick which SKU it belongs to.
            </li>
            <li>
              <span className="text-vault-gold">SKU-first</span>: click any row below to type / paste a barcode for that specific product. Useful when you have the UPC noted down but no physical box at hand.
            </li>
          </ol>
          <p className="text-blue-400 text-xs mt-3">
            💡 The scanner gun acts as a keyboard — just focus the scan box at the top, then pull the trigger.
          </p>
        </div>
      </Instructions>

      {/* Progress card — gives a clear "are we done yet" answer. Bar fills
          from 0 → 100% as barcodes get attached. */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-gray-300">
            <span className="text-vault-gold font-semibold">{mappedCount}</span>
            <span className="text-gray-500"> / {products.length} </span>
            sealed products have barcodes
          </div>
          <div className="text-sm text-vault-gold font-semibold">{percent}%</div>
        </div>
        <div className="h-2 bg-vault-darker rounded-full overflow-hidden">
          <div
            className="h-full bg-vault-gold transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Primary scanner box. BarcodeScanner already implements:
            - focus on mount
            - match → onMatched fires
            - no-match → unknown-barcode modal pops, user picks SKU,
              barcode gets associated, onBarcodeAssociated fires.
          We just wire onMatched + onBarcodeAssociated to update the
          local list. */}
      <div className="card mb-4">
        <BarcodeScanner
          products={products}
          onMatched={(p) => {
            // If we got here from a brand-new associate, the toast in
            // BarcodeScanner already fired. For a pre-existing match we
            // still want a friendly "already mapped" confirmation so the
            // user doesn't think they need to do something.
            if (p?.barcode) {
              addToast(`${p.name} — already mapped to ${p.barcode}`, 'success')
            }
          }}
          onBarcodeAssociated={(productId, barcode) => {
            patchLocalBarcode(productId, barcode)
          }}
          addToast={addToast}
          hint="Scan a sealed box. Match → confirms mapping. No match → pick which SKU this code belongs to."
          placeholder="Scan or type a UPC (digits)…"
        />
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setTab('unmapped')}
          className={`px-3 py-1.5 text-sm rounded-md border transition-all ${
            tab === 'unmapped'
              ? 'bg-vault-gold/10 border-vault-gold/40 text-vault-gold'
              : 'border-vault-border text-gray-400 hover:text-white hover:border-vault-border'
          }`}
        >
          Without Barcode ({unmappedCount})
        </button>
        <button
          type="button"
          onClick={() => setTab('mapped')}
          className={`px-3 py-1.5 text-sm rounded-md border transition-all ${
            tab === 'mapped'
              ? 'bg-vault-gold/10 border-vault-gold/40 text-vault-gold'
              : 'border-vault-border text-gray-400 hover:text-white hover:border-vault-border'
          }`}
        >
          With Barcode ({mappedCount})
        </button>
        <div className="flex-1" />
        <div className="relative flex-shrink-0 w-64">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brand / name / barcode…"
            className="w-full pl-7 pr-2 py-1.5 bg-vault-dark border border-vault-border rounded-md text-sm text-white focus:outline-none focus:border-vault-gold"
          />
        </div>
      </div>

      {/* Products list */}
      <div className="card">
        {filtered.length === 0 ? (
          <p className="text-gray-400 text-center py-8 text-sm">
            {tab === 'unmapped'
              ? (search ? 'No unmapped products match your search.' : 'Every sealed product has a barcode 🎉')
              : (search ? 'No mapped products match your search.' : 'No barcodes mapped yet — start by scanning a box above.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-vault-border">
                  <th className="px-2 py-2 font-semibold">Brand</th>
                  <th className="px-2 py-2 font-semibold">Lang</th>
                  <th className="px-2 py-2 font-semibold">Type</th>
                  <th className="px-2 py-2 font-semibold">Name</th>
                  <th className="px-2 py-2 font-semibold">Barcode</th>
                  <th className="px-2 py-2 font-semibold w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-vault-border/40 hover:bg-vault-darker/40">
                    <td className="px-2 py-2 text-vault-gold">{p.brand || '—'}</td>
                    <td className="px-2 py-2 text-blue-400">{p.language || '—'}</td>
                    <td className="px-2 py-2 text-gray-300">{p.category || p.type || '—'}</td>
                    <td className="px-2 py-2 text-white">
                      {p.name || '—'}
                      {p.active === false && (
                        <span className="ml-2 text-[10px] uppercase text-gray-500 bg-vault-darker px-1.5 py-0.5 rounded">
                          inactive
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {p.barcode ? (
                        <code className="bg-vault-dark px-2 py-0.5 rounded text-vault-gold text-xs">
                          {p.barcode}
                        </code>
                      ) : (
                        <span className="text-gray-500 text-xs italic">not set</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingProduct(p)}
                          className="p-1 text-gray-400 hover:text-vault-gold"
                          title={p.barcode ? 'Edit barcode' : 'Set barcode'}
                        >
                          <Edit2 size={14} />
                        </button>
                        {p.barcode && (
                          <ClearBarcodeButton
                            product={p}
                            onCleared={() => {
                              patchLocalBarcode(p.id, null)
                              addToast(`Cleared barcode for ${p.name}`, 'info')
                            }}
                            onError={(msg) => addToast(msg, 'error')}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingProduct && (
        <EditBarcodeModal
          product={editingProduct}
          allProducts={products}
          onClose={() => setEditingProduct(null)}
          onSaved={(barcode) => {
            patchLocalBarcode(editingProduct.id, barcode)
            addToast(`Barcode set for ${editingProduct.name}`, 'success')
            setEditingProduct(null)
          }}
          onError={(msg) => addToast(msg, 'error')}
        />
      )}
    </div>
  )
}

// ============================================================================
// Modal: type / paste / scan a barcode for a specific product
// ============================================================================
// Auto-focuses the input on mount so a scanner gun trigger immediately fills
// it. Pre-fills with the existing barcode if there is one (for the "edit"
// case). Submit on Enter so scanner guns (which send Enter after the digits)
// work without an extra click.
function EditBarcodeModal({ product, allProducts, onClose, onSaved, onError }) {
  const [value, setValue] = useState(product.barcode || '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Live conflict check — if the entered code is already mapped to a
  // DIFFERENT product, surface it before the user clicks Save (otherwise the
  // partial unique index throws an opaque DB error). Self-match (the same
  // SKU we're editing) is fine.
  const conflict = useMemo(() => {
    const code = value.trim()
    if (!code) return null
    return allProducts.find(p => p.barcode === code && p.id !== product.id) || null
  }, [value, allProducts, product.id])

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    const code = value.trim()
    if (!code) {
      onError?.('Barcode cannot be empty — use the Clear button instead.')
      return
    }
    if (conflict) {
      onError?.(`That barcode is already on ${conflict.name}. Clear it there first.`)
      return
    }
    try {
      setSaving(true)
      await updateProductBarcode(product.id, code)
      onSaved?.(code)
    } catch (err) {
      console.error('[ProductBarcodes] save failed:', err)
      onError?.(`Save failed: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-md w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-vault-gold">
            <ScanLine size={18} />
            <h3 className="font-semibold text-base">
              {product.barcode ? 'Edit barcode' : 'Set barcode'}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-500 hover:text-white p-1 -m-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="text-sm text-gray-300 mb-1">
          <span className="text-vault-gold">{product.brand}</span>
          {' / '}
          <span className="text-blue-400">{product.language}</span>
          {' / '}
          <span className="text-gray-400">{product.category || product.type}</span>
        </div>
        <div className="text-white font-medium mb-3">{product.name}</div>

        <form onSubmit={handleSubmit}>
          <label className="block text-xs text-gray-400 mb-1">Barcode (UPC / EAN)</label>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Scan or type the UPC printed on the box"
            disabled={saving}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3 py-2 bg-vault-dark border border-vault-border rounded-md text-white focus:outline-none focus:border-vault-gold disabled:opacity-50"
          />
          {conflict && (
            <div className="mt-2 flex items-start gap-2 text-xs text-amber-400">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                This barcode is already on <strong>{conflict.name}</strong>. Clear it there first, or pick a different code.
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !value.trim() || !!conflict}
              className="px-3 py-2 text-sm bg-vault-gold/20 border border-vault-gold/60 text-vault-gold hover:bg-vault-gold/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Save barcode
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// Inline Clear button — confirms once, then nulls the barcode column. Kept
// out of the main row to avoid accidental clicks; the trash icon shows only
// when there's an existing barcode to clear.
// ============================================================================
function ClearBarcodeButton({ product, onCleared, onError }) {
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (!confirm(`Clear barcode "${product.barcode}" from ${product.name}?`)) return
    try {
      setBusy(true)
      const { error } = await supabase
        .from('products')
        .update({ barcode: null })
        .eq('id', product.id)
      if (error) throw error
      onCleared?.()
    } catch (err) {
      console.error('[ProductBarcodes] clear failed:', err)
      onError?.(`Failed to clear: ${err.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
      title="Clear barcode"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  )
}
