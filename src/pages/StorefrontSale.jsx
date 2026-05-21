import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  fetchPaymentMethods,
  lookupScannedCode,
  submitStorefrontTransaction,
} from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import {
  ScanLine, X, Trash2, Loader2, Package, Diamond, Layers,
  AlertTriangle, CreditCard, Save, ShoppingCart,
} from 'lucide-react'

// ============================================================================
// StorefrontSale — unified POS checkout (Phase 1)
// ============================================================================
// One page replaces the old "pick one SKU, type qty + price, submit" flow.
// Cashier scans ANY of three product identities (UPC / cert# / TCG ID),
// the cart accumulates mixed items, and submit fans out writes across
// storefront_sales (sealed) / slabs (graded) / singles (raw cards) — all
// tagged with the same transaction_id so the checkout can be replayed as
// one unit.
//
// Behaviour decisions (per directive 2026-05-21):
//   1. Default price = market price if known, else empty (cashier fills)
//   2. Sealed not at Front Store → silent auto-Move from Master
//   3. Submit partial fail → ok lines saved, failed lines stay in cart
//   4. Bulk mode removed entirely (everything goes through scan)
//   5. sale_channel = 'in_person' always (Cards Scan handles other channels)
//   6. Payment method recorded; receipts skipped for now
//   7. Lark notification per transaction (one message per cart submit)
// ============================================================================

const today = () => new Date().toLocaleDateString('en-CA')

// Map cart line kind → icon + colour for visual scanning. Each row in
// the cart shows the icon so the cashier can tell at a glance whether
// they scanned a box, slab, or raw single.
const KIND_META = {
  sealed: { icon: Package, color: 'text-amber-300',   label: 'Sealed' },
  slab:   { icon: Diamond, color: 'text-emerald-300', label: 'Slab'   },
  single: { icon: Layers,  color: 'text-blue-300',    label: 'Single' },
}

export default function StorefrontSale() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [paymentMethods, setPaymentMethods] = useState([])
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [saleDate, setSaleDate] = useState(today())
  const [scanValue, setScanValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Cart entries shape:
  //   For sealed: { kind:'sealed', key, product, inventory, quantity, price, available }
  //   For slab:   { kind:'slab',   key, slab,    price }
  //   For single: { kind:'single', key, single,  quantity, price, available }
  // `key` is a stable local id so React reconciliation doesn't get confused
  // when the cashier scans the same SKU twice.
  const [cart, setCart] = useState([])
  const [unknownCode, setUnknownCode] = useState(null)  // last unmapped scan

  const inputRef = useRef(null)

  useEffect(() => {
    fetchPaymentMethods()
      .then(rows => {
        setPaymentMethods(rows)
        // Default to Cash if present (most common at storefronts)
        const cash = rows.find(r => /^cash$/i.test(r.name))
        if (cash) setPaymentMethodId(cash.id)
      })
      .catch(err => addToast(`Failed to load payment methods: ${err.message}`, 'error'))
    inputRef.current?.focus()
  }, [])

  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, line) => {
      const qty = Number(line.quantity ?? 1) || 0
      const price = Number(line.price) || 0
      return sum + price * qty
    }, 0)
  }, [cart])

  const cartTotalUnits = useMemo(() => {
    return cart.reduce((sum, line) => sum + (Number(line.quantity ?? 1) || 0), 0)
  }, [cart])

  // ---------- cart line builders ----------

  const addOrIncrementSealed = (lookup) => {
    const { product, inventory } = lookup
    const totalAvailable = inventory.reduce((s, i) => s + (i.quantity || 0), 0)
    if (totalAvailable <= 0) {
      addToast(`${product.name} — no stock anywhere`, 'error')
      return
    }
    setCart(prev => {
      const idx = prev.findIndex(l => l.kind === 'sealed' && l.product.id === product.id)
      if (idx >= 0) {
        // Same sealed SKU already in cart → bump qty by 1 if there's stock
        const existing = prev[idx]
        if ((existing.quantity || 1) + 1 > totalAvailable) {
          addToast(`Only ${totalAvailable} available — cart already has ${existing.quantity}`, 'error')
          return prev
        }
        const next = [...prev]
        next[idx] = { ...existing, quantity: (existing.quantity || 1) + 1 }
        return next
      }
      return [
        ...prev,
        {
          kind: 'sealed',
          key: `sealed-${product.id}-${Date.now()}`,
          product,
          inventory,
          available: totalAvailable,
          quantity: 1,
          // Sealed products don't carry a "market price" — cashier types it.
          price: '',
          scanned_code: product.barcode,
        },
      ]
    })
    addToast(`Added: ${product.brand} ${product.name}`, 'success')
  }

  const addSlab = (slab) => {
    if (slab.status === 'sold') {
      addToast(`Slab #${slab.cert_number} already sold`, 'error')
      return
    }
    if (slab.status !== 'in_inventory' && slab.status !== 'listed') {
      addToast(`Slab status "${slab.status}" — can't sell from here`, 'error')
      return
    }
    setCart(prev => {
      if (prev.find(l => l.kind === 'slab' && l.slab.id === slab.id)) {
        addToast(`Slab #${slab.cert_number} already in cart`, 'info')
        return prev
      }
      // Suggested price priority: lv_price → list_price → market_price → empty
      const suggested =
        slab.lv_price_usd != null ? slab.lv_price_usd
          : slab.list_price_usd != null ? slab.list_price_usd
          : slab.market_price_usd != null ? slab.market_price_usd
          : ''
      return [
        ...prev,
        {
          kind: 'slab',
          key: `slab-${slab.id}`,
          slab,
          price: suggested === '' ? '' : String(suggested),
          scanned_code: slab.cert_number,
        },
      ]
    })
    addToast(`Added: ${slab.item_name}`, 'success')
  }

  const addOrIncrementSingle = (single) => {
    if (single.status === 'sold') {
      addToast('Already sold', 'error')
      return
    }
    if (single.status !== 'in_inventory' && single.status !== 'listed') {
      addToast(`Status "${single.status}" — can't sell from here`, 'error')
      return
    }
    const available = single.quantity || 1
    setCart(prev => {
      const idx = prev.findIndex(l => l.kind === 'single' && l.single.id === single.id)
      if (idx >= 0) {
        const existing = prev[idx]
        if ((existing.quantity || 1) + 1 > available) {
          addToast(`Only ${available} available — cart already has ${existing.quantity}`, 'error')
          return prev
        }
        const next = [...prev]
        next[idx] = { ...existing, quantity: (existing.quantity || 1) + 1 }
        return next
      }
      const suggested = single.current_market_price_usd != null
        ? String(single.current_market_price_usd)
        : ''
      return [
        ...prev,
        {
          kind: 'single',
          key: `single-${single.id}`,
          single,
          available,
          quantity: 1,
          price: suggested,
          scanned_code: single.tcg_id,
        },
      ]
    })
    addToast(`Added: ${single.card_name}`, 'success')
  }

  // ---------- scan handler ----------

  const handleScan = async (e) => {
    e?.preventDefault?.()
    const code = scanValue.trim()
    if (!code) return
    setScanning(true)
    setUnknownCode(null)
    try {
      const result = await lookupScannedCode(code)
      if (result.kind === 'sealed') {
        addOrIncrementSealed(result)
      } else if (result.kind === 'slab') {
        addSlab(result.slab)
      } else if (result.kind === 'single') {
        addOrIncrementSingle(result.single)
      } else if (result.kind === 'unknown') {
        setUnknownCode(code)
      }
    } catch (err) {
      console.error('[StorefrontSale] lookup failed:', err)
      addToast(`Lookup failed: ${err.message || err}`, 'error')
    } finally {
      setScanning(false)
      setScanValue('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // ---------- cart editing ----------

  const updateLine = (key, patch) => {
    setCart(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  const removeLine = (key) => {
    setCart(prev => prev.filter(l => l.key !== key))
  }
  const clearCart = () => {
    if (cart.length === 0) return
    if (!confirm('Clear entire cart?')) return
    setCart([])
  }

  // ---------- submit ----------

  const validateCart = () => {
    if (cart.length === 0) return 'Cart is empty'
    if (!paymentMethodId) return 'Pick a payment method'
    if (!saleDate) return 'Pick a date'
    for (const line of cart) {
      const price = Number(line.price)
      if (line.price === '' || isNaN(price) || price < 0) {
        const label = line.kind === 'sealed' ? line.product.name
                    : line.kind === 'slab'   ? line.slab.item_name
                                              : line.single.card_name
        return `Missing price for: ${label}`
      }
      const qty = Number(line.quantity ?? 1)
      if (line.kind !== 'slab' && (!qty || qty < 1)) {
        return 'Quantity must be at least 1'
      }
    }
    return null
  }

  const handleSubmit = async () => {
    const validationErr = validateCart()
    if (validationErr) {
      addToast(validationErr, 'error')
      return
    }
    setSubmitting(true)
    try {
      const result = await submitStorefrontTransaction({
        cart,
        paymentMethodId,
        cashierId: user?.id || null,
        saleDate,
      })

      const { ok, failed, transaction_id } = result

      // Keep failed lines in cart so the cashier can fix / retry. Drop ok lines.
      const failedKeys = new Set(failed.map(f => f.line.key))
      setCart(prev => prev.filter(l => failedKeys.has(l.key)))

      if (ok.length > 0) {
        addToast(
          `${ok.length} item${ok.length === 1 ? '' : 's'} sold${failed.length > 0 ? `, ${failed.length} failed (kept in cart)` : ''}`,
          failed.length > 0 ? 'info' : 'success'
        )
        // Fire Lark notification for the successful subset. Fire-and-forget;
        // failure here must not roll back the sale.
        try {
          const lineItems = ok.map(({ line }) => {
            if (line.kind === 'sealed') {
              return {
                kind: 'sealed',
                name: `${line.product.brand} | ${line.product.name}`,
                quantity: Number(line.quantity) || 1,
                price: Number(line.price) || 0,
              }
            }
            if (line.kind === 'slab') {
              return {
                kind: 'slab',
                name: line.slab.item_name,
                quantity: 1,
                price: Number(line.price) || 0,
              }
            }
            const setLabel = line.single.set?.name ? ` (${line.single.set.name})` : ''
            return {
              kind: 'single',
              name: `${line.single.card_name}${line.single.card_number ? ` #${line.single.card_number}` : ''}${setLabel}`,
              quantity: Number(line.quantity) || 1,
              price: Number(line.price) || 0,
            }
          })
          const total = lineItems.reduce((s, it) => s + (it.price * it.quantity), 0)
          const paymentName = paymentMethods.find(p => p.id === paymentMethodId)?.name || 'Unknown'
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'storefront_transaction',
              transaction_id,
              cashier: user?.name || 'Unknown',
              payment_method: paymentName,
              date: saleDate,
              items: lineItems,
              total,
              total_units: lineItems.reduce((s, it) => s + it.quantity, 0),
            }),
          }).catch(err => console.error('[lark-notify] storefront_transaction failed:', err))
        } catch (err) {
          console.error('[StorefrontSale] failed to build Lark payload:', err)
        }
      }

      if (failed.length > 0) {
        for (const f of failed) {
          addToast(`Line failed: ${f.error}`, 'error')
        }
      }
    } catch (err) {
      console.error('[StorefrontSale] submit threw:', err)
      addToast(`Submit failed: ${err.message || err}`, 'error')
    } finally {
      setSubmitting(false)
      // Refocus the scan input so the next sale is one trigger-pull away.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // ---------- render ----------

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShoppingCart className="text-vault-gold" />
          Storefront Sale
        </h1>
        <p className="text-gray-400 mt-1">
          Scan any UPC, slab cert#, or single TCG ID. Mixed cart goes to one transaction.
        </p>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>
            <span className="text-vault-gold font-medium">Scan-first POS</span>: scanner gun fills the scan box automatically. One trigger-pull adds the item to the cart.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>📦 Sealed box / pack → UPC barcode</li>
            <li>💎 Graded slab → cert#</li>
            <li>🎴 Raw single → TCG ID</li>
          </ul>
          <p className="text-xs text-gray-500">
            Sealed items not at Front Store are auto-moved from Master Inventory in the background. Slabs and singles flip to <code>sold</code> with channel <code>in_person</code>.
          </p>
        </div>
      </Instructions>

      {/* Header row: date + cashier + payment method */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date</label>
            <input
              type="date"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Cashier</label>
            <div className="px-3 py-2 bg-vault-dark border border-vault-border rounded-md text-white">
              {user?.name || 'Unknown'}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              <CreditCard size={14} className="inline mr-1" /> Payment Method
            </label>
            <select
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
              disabled={submitting}
            >
              <option value="">— pick —</option>
              {paymentMethods.map(pm => (
                <option key={pm.id} value={pm.id}>{pm.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Scan input */}
      <div className="card mb-4">
        <form onSubmit={handleScan} className="bg-vault-darker/40 border border-vault-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ScanLine size={20} className="text-vault-gold flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              disabled={scanning || submitting}
              placeholder="Scan UPC, slab cert#, or single TCG ID…"
              autoComplete="off"
              spellCheck={false}
              inputMode="numeric"
              className="flex-1 px-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-base focus:outline-none focus:border-vault-gold disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={scanning || submitting || !scanValue.trim()}
              className="px-4 py-2 bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md text-sm hover:bg-vault-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
            </button>
          </div>
          <div className="text-[11px] text-gray-500">
            Auto-detects: UPC → sealed, cert# → slab, TCG ID → single. Same item scanned twice = qty bumps (sealed / single only).
          </div>
        </form>

        {unknownCode && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="text-amber-200">
                <code className="bg-vault-darker px-1.5 py-0.5 rounded text-vault-gold">{unknownCode}</code> isn't mapped to any sealed UPC, slab cert#, or single TCG ID.
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Open <a href="/product-barcodes" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">Product Barcodes</a> to associate it with a sealed SKU, or use Add Single / intake the slab first via Cards Scan, then come back.
              </div>
            </div>
            <button onClick={() => setUnknownCode(null)} className="p-1 text-gray-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Cart */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-white">
            Cart {cart.length > 0 && <span className="text-sm font-normal text-gray-400 ml-1">({cart.length} {cart.length === 1 ? 'line' : 'lines'} · {cartTotalUnits} units)</span>}
          </h2>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              disabled={submitting}
              className="text-xs text-gray-400 hover:text-red-400 disabled:opacity-50"
            >
              Clear cart
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <p className="text-center py-12 text-gray-500 text-sm">
            Cart is empty. Scan an item above to start.
          </p>
        ) : (
          <div className="space-y-2">
            {cart.map(line => (
              <CartRow
                key={line.key}
                line={line}
                onUpdate={(patch) => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
                disabled={submitting}
              />
            ))}
            <div className="pt-3 mt-3 border-t border-vault-border flex justify-end">
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-gray-500">Subtotal</div>
                <div className="text-2xl font-bold text-vault-gold">${cartSubtotal.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || cart.length === 0 || !paymentMethodId}
          className="btn btn-primary px-6 py-3 text-base"
        >
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
            : <><Save size={18} /> Complete Sale (${cartSubtotal.toFixed(2)})</>
          }
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// CartRow — single cart entry. Qty input (where applicable), price input,
// remove button. Visual style differs slightly by kind so the cashier can
// tell at a glance whether they're looking at a box / slab / single.
// ============================================================================
function CartRow({ line, onUpdate, onRemove, disabled }) {
  const meta = KIND_META[line.kind]
  const Icon = meta.icon

  let title, sub, available, qtyEditable
  if (line.kind === 'sealed') {
    const launchName = line.product.category && line.product.name
      ? line.product.name.replace(new RegExp(`\\s*${line.product.category}\\s*$`, 'i'), '').trim() || line.product.name
      : line.product.name
    title = `${line.product.brand} | ${launchName}`
    sub = `${line.product.category || line.product.type} · ${line.product.language} · UPC ${line.product.barcode}`
    available = line.available
    qtyEditable = true
  } else if (line.kind === 'slab') {
    title = line.slab.item_name
    sub = `${line.slab.grading_company} · cert #${line.slab.cert_number}`
    available = 1
    qtyEditable = false
  } else {
    // single
    const setLine = line.single.set?.name ? ` · ${line.single.set.name}` : ''
    title = `${line.single.card_name}${line.single.card_number ? ` #${line.single.card_number}` : ''}`
    sub = `${line.single.condition || 'raw'}${setLine} · TCG ${line.single.tcg_id}`
    available = line.available
    qtyEditable = true
  }

  const qty = Number(line.quantity ?? 1) || 1
  const price = Number(line.price) || 0
  const subtotal = price * qty

  return (
    <div className="grid grid-cols-12 gap-3 items-center p-3 bg-vault-darker/40 border border-vault-border rounded-lg">
      <div className={`col-span-6 flex items-center gap-3 min-w-0 ${meta.color}`}>
        <Icon size={20} className="flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-white font-medium truncate">{title}</div>
          <div className="text-xs text-gray-500 truncate">{sub}</div>
        </div>
      </div>

      <div className="col-span-2">
        <label className="block text-[10px] uppercase tracking-wider text-gray-500">
          Qty {available > 1 && <span className="text-gray-600 normal-case">/ {available}</span>}
        </label>
        {qtyEditable ? (
          <input
            type="number"
            min="1"
            max={available}
            value={qty}
            onChange={(e) => {
              const v = Math.max(1, Math.min(available, parseInt(e.target.value) || 1))
              onUpdate({ quantity: v })
            }}
            disabled={disabled}
            className="w-full px-2 py-1 text-sm"
          />
        ) : (
          <div className="px-2 py-1 text-sm text-gray-400">1</div>
        )}
      </div>

      <div className="col-span-2">
        <label className="block text-[10px] uppercase tracking-wider text-gray-500">Price (USD)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={line.price}
          onChange={(e) => onUpdate({ price: e.target.value })}
          disabled={disabled}
          placeholder="0.00"
          className="w-full px-2 py-1 text-sm"
        />
      </div>

      <div className="col-span-1 text-right text-sm text-vault-gold font-semibold">
        ${subtotal.toFixed(2)}
      </div>

      <div className="col-span-1 text-right">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="p-1.5 text-gray-400 hover:text-red-400 disabled:opacity-50"
          title="Remove from cart"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}
