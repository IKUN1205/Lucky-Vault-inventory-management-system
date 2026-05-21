import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  fetchPaymentMethods,
  lookupScannedCode,
  submitStorefrontTransaction,
  fetchStorefrontDailySummary,
} from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import {
  ScanLine, X, Trash2, Loader2, Package, Diamond, Layers,
  AlertTriangle, CreditCard, Save, ShoppingCart, TrendingUp, RefreshCw,
  ChevronDown, ChevronUp, ArrowLeftRight, Coins,
} from 'lucide-react'

// ============================================================================
// StorefrontSale — unified POS checkout
// ============================================================================
// Scan-first POS handling sealed boxes + slabs + raw singles in one cart.
// Two transaction types: Sale (cash in) and Trade (customer brings items,
// net cash can be positive / negative / zero).
//
// Behaviour decisions (per directive 2026-05-21):
//   - Cashier hidden from UI (still recorded silently for audit)
//   - Price is a required field per line; empty rejects on submit
//   - Sale (default) vs Trade tabs at top of cart
//   - Trade: extra Trade-in value input; net cash = cart total − trade-in
//   - Daily summary widget at top of page (sales count, cash by method)
//   - Sealed not at Front Store → silent auto-Move from Master
//   - Submit partial fail → ok lines drop, failed stay in cart
//   - One Lark message per cart submit
// ============================================================================

const today = () => new Date().toLocaleDateString('en-CA')

const KIND_META = {
  sealed:        { icon: Package, color: 'text-amber-300',   label: 'Sealed'    },
  slab:          { icon: Diamond, color: 'text-emerald-300', label: 'Slab'      },
  single:        { icon: Layers,  color: 'text-blue-300',    label: 'Single'    },
  // Buy-only manual lines: cashier types description because the item isn't
  // in our cards inventory yet (cert / TCG ID not captured). These rows are
  // recorded in storefront_sales only; no slabs / singles row is created.
  slab_manual:   { icon: Diamond, color: 'text-emerald-300', label: 'Slab (manual)' },
  single_manual: { icon: Layers,  color: 'text-blue-300',    label: 'Single (manual)' },
}

const fmtUsd = (n) => {
  const v = Number(n) || 0
  const abs = Math.abs(v).toFixed(2)
  return v < 0 ? `-$${abs}` : `$${abs}`
}

export default function StorefrontSale() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [paymentMethods, setPaymentMethods] = useState([])
  const [paymentMethodId, setPaymentMethodId] = useState('')
  // Split-payment state — when enabled, two methods + two amounts.
  // Default amount1 = "(due − amount2)" computed on the fly so the
  // cashier only has to type one number. Disabled automatically when
  // the transaction direction is "we pay customer" (Buy or trade w/
  // negative net cash) since the user-selected scope is sale + trade-w/-positive-net only.
  const [splitPayment, setSplitPayment] = useState(false)
  const [paymentMethodId2, setPaymentMethodId2] = useState('')
  const [splitAmount2, setSplitAmount2] = useState('')   // string so input stays controlled
  const [saleDate, setSaleDate] = useState(today())
  const [scanValue, setScanValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cart, setCart] = useState([])
  const [unknownCode, setUnknownCode] = useState(null)

  // Transaction type: 'sale' (default), 'trade', or 'buy'.
  //   - sale  : customer pays us. cart total = customer pays.
  //   - trade : items exchanged. trade-in value input shows; net cash signed.
  //   - buy   : we pay customer. cart shows what we're buying (sealed via
  //             scan, slabs/singles via Manual Line button). net cash = -gross.
  const [transactionType, setTransactionType] = useState('sale')
  const [tradeInValue, setTradeInValue] = useState('')   // string so the input stays controlled
  const [manualLineDraft, setManualLineDraft] = useState(null)  // open modal state

  // Daily summary state. Re-fetched after each successful submit so the
  // widget always reflects today's running totals.
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  const inputRef = useRef(null)

  const loadSummary = useCallback(async (date) => {
    setSummaryLoading(true)
    try {
      const data = await fetchStorefrontDailySummary(date || saleDate)
      setSummary(data)
    } catch (err) {
      console.error('[StorefrontSale] summary load failed:', err)
    } finally {
      setSummaryLoading(false)
    }
  }, [saleDate])

  useEffect(() => {
    fetchPaymentMethods()
      .then(rows => {
        setPaymentMethods(rows)
        const cash = rows.find(r => /^cash$/i.test(r.name))
        if (cash) setPaymentMethodId(cash.id)
      })
      .catch(err => addToast(`Failed to load payment methods: ${err.message}`, 'error'))
    loadSummary(saleDate)
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh summary whenever the selected date changes (e.g. cashier
  // backdates a transaction to fix a missed entry from yesterday).
  useEffect(() => {
    loadSummary(saleDate)
  }, [saleDate, loadSummary])

  const cartGross = useMemo(() => {
    return cart.reduce((sum, line) => {
      const qty = Number(line.quantity ?? 1) || 0
      const price = Number(line.price) || 0
      return sum + price * qty
    }, 0)
  }, [cart])

  const cartTotalUnits = useMemo(() => {
    return cart.reduce((sum, line) => sum + (Number(line.quantity ?? 1) || 0), 0)
  }, [cart])

  // Net cash direction by transaction type:
  //   sale  → +cartGross (customer pays us)
  //   trade → cartGross − tradeIn  (signed; can be negative)
  //   buy   → -cartGross           (we pay customer the full amount)
  const tradeInNum = Number(tradeInValue) || 0
  const netCash =
    transactionType === 'buy'   ? -cartGross
    : transactionType === 'trade' ? (cartGross - tradeInNum)
    :                              cartGross

  // Split-payment is only meaningful when CUSTOMER pays US (sale, or trade
  // with positive net cash). When direction is "we pay customer" (buy or
  // trade w/ negative net) we keep the single-method dropdown — the user
  // explicitly scoped split out of those cases.
  const customerPaysIn =
    transactionType === 'sale' ||
    (transactionType === 'trade' && netCash > 0)
  const splitEligible = customerPaysIn && cartGross > 0

  // Amount due from customer (positive). For trades with positive net,
  // that's the net cash; for sale, the full gross.
  const amountDueFromCustomer = transactionType === 'trade' ? Math.max(0, netCash) : cartGross

  const amount2Num = Number(splitAmount2) || 0
  const amount1Num = Math.max(0, +(amountDueFromCustomer - amount2Num).toFixed(2))
  const splitSum = amount1Num + amount2Num
  const splitMismatch = splitPayment && splitEligible
    ? Math.abs(splitSum - amountDueFromCustomer) > 0.01
    : false
  const splitMethodsClash = splitPayment && splitEligible && paymentMethodId && paymentMethodId2 && paymentMethodId === paymentMethodId2

  // When the transaction direction flips away from "customer pays in",
  // collapse the split UI so the next checkout starts clean.
  useEffect(() => {
    if (!splitEligible && splitPayment) {
      setSplitPayment(false)
      setPaymentMethodId2('')
      setSplitAmount2('')
    }
  }, [splitEligible, splitPayment])

  // ---------- cart line builders (unchanged from v1) ----------

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
          product, inventory,
          available: totalAvailable,
          quantity: 1,
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
          single, available,
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
        // In Buy mode, scanning an existing slab's cert# doesn't make sense
        // — customer is selling us a NEW slab that isn't in our system yet.
        // Tell the cashier to use the manual-line button so they capture
        // the right description (no auto-create into slabs table).
        if (transactionType === 'buy') {
          addToast('In Buy mode, add slabs via + Add Manual Line (we don\'t auto-create slab records)', 'info')
        } else {
          addSlab(result.slab)
        }
      } else if (result.kind === 'single') {
        if (transactionType === 'buy') {
          addToast('In Buy mode, add singles via + Add Manual Line', 'info')
        } else {
          addOrIncrementSingle(result.single)
        }
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

  // Open the manual-line modal (Buy mode only). The modal handles the form;
  // saveManualLine validates + appends a slab_manual / single_manual cart
  // line. The `stayOpen` option lets the cashier rapid-fire several items
  // in one customer visit without closing/reopening the modal each time.
  const openManualLine = (subKind /* 'slab' | 'single' */) => {
    setManualLineDraft({ subKind, description: '', quantity: 1, price: '' })
  }
  const saveManualLine = ({ stayOpen = false } = {}) => {
    const draft = manualLineDraft
    if (!draft) return
    const desc = (draft.description || '').trim()
    if (!desc) { addToast('Description is required', 'error'); return }
    const qty = Math.max(1, parseInt(draft.quantity) || 1)
    const price = parseFloat(draft.price)
    if (isNaN(price) || price < 0) { addToast('Price required', 'error'); return }
    const kind = draft.subKind === 'slab' ? 'slab_manual' : 'single_manual'
    const key = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCart(prev => [
      ...prev,
      { kind, key, description: desc, quantity: draft.subKind === 'slab' ? 1 : qty, price: String(price) },
    ])
    addToast(`Added: ${draft.subKind} — ${desc}`, 'success')
    if (stayOpen) {
      // Reset to a fresh blank entry of the same kind so the cashier can
      // keep typing the next item without losing focus / context.
      setManualLineDraft({ subKind: draft.subKind, description: '', quantity: 1, price: '' })
    } else {
      setManualLineDraft(null)
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
    setTradeInValue('')
  }

  // ---------- submit ----------

  const validateCart = () => {
    if (cart.length === 0) return 'Cart is empty'
    if (!paymentMethodId) return 'Pick a payment method'
    if (!saleDate) return 'Pick a date'
    if (splitPayment && splitEligible) {
      if (!paymentMethodId2) return 'Pick the second payment method (or turn off Split payment)'
      if (paymentMethodId === paymentMethodId2) return 'Split payments must use two different methods'
      if (amount2Num <= 0) return 'Second payment amount must be greater than 0'
      if (amount1Num <= 0) return 'First payment amount must be greater than 0'
      if (Math.abs(splitSum - amountDueFromCustomer) > 0.01) {
        return `Payment split ($${splitSum.toFixed(2)}) doesn't match amount due ($${amountDueFromCustomer.toFixed(2)})`
      }
    }
    for (const line of cart) {
      const price = Number(line.price)
      if (line.price === '' || line.price == null || isNaN(price) || price < 0) {
        const label =
          line.kind === 'sealed' ? line.product.name
          : line.kind === 'slab' ? line.slab.item_name
          : line.kind === 'single' ? line.single.card_name
          : line.kind === 'slab_manual' || line.kind === 'single_manual' ? (line.description || '(no description)')
          : 'unknown'
        return `Missing price for: ${label}`
      }
      const qty = Number(line.quantity ?? 1)
      if (line.kind !== 'slab' && (!qty || qty < 1)) {
        return 'Quantity must be at least 1'
      }
      // In buy mode, manual lines require a description (already enforced in
      // the modal save path, but double-check here).
      if ((line.kind === 'slab_manual' || line.kind === 'single_manual') && !(line.description || '').trim()) {
        return 'Manual line missing description'
      }
    }
    if (transactionType === 'trade') {
      const tv = Number(tradeInValue)
      if (tradeInValue === '' || isNaN(tv) || tv < 0) {
        return 'Trade-in value required for a trade (use 0 for "we gave them goods, they gave nothing")'
      }
    }
    return null
  }

  const handleSubmit = async () => {
    const validationErr = validateCart()
    if (validationErr) { addToast(validationErr, 'error'); return }
    setSubmitting(true)
    // Build the payments array. Single-method: [{ method, amount: due }].
     // Split: [{ method1, amount1 }, { method2, amount2 }].
    const submittedPayments = (() => {
      if (splitPayment && splitEligible) {
        return [
          { payment_method_id: paymentMethodId,  amount: amount1Num },
          { payment_method_id: paymentMethodId2, amount: amount2Num },
        ]
      }
      return [{ payment_method_id: paymentMethodId, amount: Math.abs(netCash) }]
    })()
    try {
      const result = await submitStorefrontTransaction({
        cart,
        paymentMethodId,
        payments: submittedPayments,
        cashierId: user?.id || null,
        saleDate,
        transactionType,
        tradeInValue: transactionType === 'trade' ? Number(tradeInValue) || 0 : null,
      })

      const { ok, failed, transaction_id, net_cash } = result
      const failedKeys = new Set(failed.map(f => f.line.key))
      setCart(prev => prev.filter(l => failedKeys.has(l.key)))

      if (ok.length > 0) {
        const verb = transactionType === 'trade' ? 'trade' : 'sale'
        addToast(
          `${ok.length} item${ok.length === 1 ? '' : 's'} ${verb}d${failed.length > 0 ? `, ${failed.length} failed (kept in cart)` : ''}`,
          failed.length > 0 ? 'info' : 'success'
        )
        // Lark notification (fire-and-forget)
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
            if (line.kind === 'single') {
              const setLabel = line.single.set?.name ? ` (${line.single.set.name})` : ''
              return {
                kind: 'single',
                name: `${line.single.card_name}${line.single.card_number ? ` #${line.single.card_number}` : ''}${setLabel}`,
                quantity: Number(line.quantity) || 1,
                price: Number(line.price) || 0,
              }
            }
            // Buy-mode manual lines (slab_manual / single_manual) — Lark
            // gets the kind + description as-is so the feed clearly says
            // "this was hand-typed for a buy, not a system match".
            return {
              kind: line.kind,
              name: line.description || '(no description)',
              quantity: Number(line.quantity) || 1,
              price: Number(line.price) || 0,
            }
          })
          const gross = lineItems.reduce((s, it) => s + (it.price * it.quantity), 0)
          // For Lark, pass either the single method name OR a split[] so
          // the message can render "Cash $30 + Store Credit $60" naturally.
          const paymentName = paymentMethods.find(p => p.id === paymentMethodId)?.name || 'Unknown'
          const splitForLark = (splitPayment && splitEligible && paymentMethodId2)
            ? submittedPayments.map(p => ({
                method: paymentMethods.find(m => m.id === p.payment_method_id)?.name || 'Unknown',
                amount: p.amount,
              }))
            : null
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'storefront_transaction',
              transaction_id,
              transaction_type: transactionType,
              payment_method: paymentName,
              payment_split: splitForLark,
              date: saleDate,
              items: lineItems,
              total: gross,
              total_units: lineItems.reduce((s, it) => s + it.quantity, 0),
              trade_in_value: transactionType === 'trade' ? (Number(tradeInValue) || 0) : null,
              net_cash,
            }),
          }).catch(err => console.error('[lark-notify] storefront_transaction failed:', err))
        } catch (err) {
          console.error('[StorefrontSale] failed to build Lark payload:', err)
        }
        // Refresh today's summary widget so the cashier sees the update.
        loadSummary(saleDate)
        // Reset trade-in input + split-payment state when the cart fully cleared
        if (cart.length === ok.length) {
          setTradeInValue('')
          setSplitPayment(false)
          setPaymentMethodId2('')
          setSplitAmount2('')
        }
      }

      if (failed.length > 0) {
        for (const f of failed) addToast(`Line failed: ${f.error}`, 'error')
      }
    } catch (err) {
      console.error('[StorefrontSale] submit threw:', err)
      addToast(`Submit failed: ${err.message || err}`, 'error')
    } finally {
      setSubmitting(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // Submit-button caption captures the most useful number for the cashier
  // at-a-glance: how much money is changing hands and which direction.
  const submitLabel = (() => {
    if (transactionType === 'sale') return `Complete Sale (${fmtUsd(cartGross)})`
    if (transactionType === 'buy')  return `Complete Buy (we pay ${fmtUsd(cartGross)})`
    if (netCash > 0) return `Complete Trade (customer pays ${fmtUsd(netCash)})`
    if (netCash < 0) return `Complete Trade (we pay ${fmtUsd(Math.abs(netCash))})`
    return 'Complete Trade (even)'
  })()

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShoppingCart className="text-vault-gold" />
          Storefront Sale
        </h1>
        <p className="text-gray-400 mt-1">
          Scan any UPC, slab cert#, or single TCG ID. Sale or Trade — net cash either way.
        </p>
      </div>

      {/* Today's summary widget */}
      <DailySummaryCard
        summary={summary}
        loading={summaryLoading}
        onRefresh={() => loadSummary(saleDate)}
      />

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>
            <span className="text-vault-gold font-medium">Scan-first POS</span>: scanner gun fills the box automatically. One trigger-pull adds the item to the cart.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>📦 Sealed box / pack → UPC barcode</li>
            <li>💎 Graded slab → cert#</li>
            <li>🎴 Raw single → TCG ID</li>
          </ul>
          <p className="text-xs text-gray-500">
            Trade mode: customer brings items + maybe extra cash. Enter the value of what they brought; net cash auto-computes (signed). Items they brought aren't added to inventory here — intake those via Cards Scan if needed.
          </p>
        </div>
      </Instructions>

      {/* Header row: date + payment method (cashier hidden) */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <label className="block text-sm font-medium text-gray-300 mb-2">
              <CreditCard size={14} className="inline mr-1" /> Payment Method <span className="text-red-400">*</span>
            </label>
            {!splitPayment ? (
              <select
                value={paymentMethodId}
                onChange={(e) => setPaymentMethodId(e.target.value)}
                disabled={submitting}
                className={!paymentMethodId ? 'border-red-500/50' : ''}
              >
                <option value="">— pick —</option>
                {paymentMethods.map(pm => (
                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                ))}
              </select>
            ) : (
              // Split-payment UI: two side-by-side rows. The first row's
              // amount is auto-computed (due − second amount); cashier
              // only types the second number. Visual cue if the methods
              // collide or the math doesn't add up.
              <div className="space-y-2">
                <div className="grid grid-cols-5 gap-2 items-center">
                  <select
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    disabled={submitting}
                    className={`col-span-3 ${!paymentMethodId || splitMethodsClash ? 'border-red-500/50' : ''}`}
                  >
                    <option value="">— pick method 1 —</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                  <div className="col-span-2 px-3 py-2 bg-vault-darker/50 border border-vault-border rounded-md text-right text-white text-sm font-mono">
                    ${amount1Num.toFixed(2)}
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2 items-center">
                  <select
                    value={paymentMethodId2}
                    onChange={(e) => setPaymentMethodId2(e.target.value)}
                    disabled={submitting}
                    className={`col-span-3 ${!paymentMethodId2 || splitMethodsClash ? 'border-red-500/50' : ''}`}
                  >
                    <option value="">— pick method 2 —</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                  <div className="col-span-2 relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={splitAmount2}
                      onChange={(e) => setSplitAmount2(e.target.value)}
                      disabled={submitting}
                      placeholder="0.00"
                      className="w-full pl-5 pr-2 py-2 text-right font-mono"
                    />
                  </div>
                </div>
                <div className={`text-xs ${splitMismatch || splitMethodsClash ? 'text-red-400' : 'text-gray-500'}`}>
                  {splitMethodsClash
                    ? 'Pick two different payment methods'
                    : splitMismatch
                      ? `Paid $${splitSum.toFixed(2)} / Due $${amountDueFromCustomer.toFixed(2)}`
                      : `Paid $${splitSum.toFixed(2)} / Due $${amountDueFromCustomer.toFixed(2)} ✓`}
                </div>
              </div>
            )}
            {/* Split toggle — only available when customer pays us. Hidden
                for Buy and Trade-where-we-pay-customer (no money coming in). */}
            {splitEligible && (
              <label className="flex items-center gap-2 mt-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={splitPayment}
                  onChange={(e) => {
                    setSplitPayment(e.target.checked)
                    if (!e.target.checked) {
                      setPaymentMethodId2('')
                      setSplitAmount2('')
                    }
                  }}
                  disabled={submitting}
                  className="cursor-pointer"
                />
                Split payment (e.g. half cash + half store credit)
              </label>
            )}
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
            Auto-detects: UPC → sealed, cert# → slab, TCG ID → single.
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
                Open <a href="/product-barcodes" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">Product Barcodes</a> to associate it with a sealed SKU, or intake the slab/single first via Cards Scan, then come back.
              </div>
            </div>
            <button onClick={() => setUnknownCode(null)} className="p-1 text-gray-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Cart with Sale/Trade tabs */}
      <div className="card mb-4">
        {/* Type tabs */}
        <div className="flex items-center gap-2 mb-3">
          <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
            <button
              type="button"
              onClick={() => { setTransactionType('sale'); setTradeInValue('') }}
              disabled={submitting}
              className={`px-4 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
                transactionType === 'sale'
                  ? 'bg-vault-gold text-vault-dark font-semibold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Sale
            </button>
            <button
              type="button"
              onClick={() => setTransactionType('trade')}
              disabled={submitting}
              className={`px-4 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
                transactionType === 'trade'
                  ? 'bg-vault-gold text-vault-dark font-semibold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Trade
            </button>
            <button
              type="button"
              onClick={() => { setTransactionType('buy'); setTradeInValue('') }}
              disabled={submitting}
              className={`px-4 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
                transactionType === 'buy'
                  ? 'bg-vault-gold text-vault-dark font-semibold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Buy
            </button>
          </div>

          {/* Buy mode only: manual-line button — slabs/singles entered by
              hand here, since they aren't in our cards inventory yet. */}
          {transactionType === 'buy' && (
            <>
              <button
                type="button"
                onClick={() => openManualLine('slab')}
                disabled={submitting}
                className="text-xs px-2.5 py-1 border border-emerald-500/40 text-emerald-300 rounded hover:bg-emerald-500/10 disabled:opacity-50"
              >
                + Slab (manual)
              </button>
              <button
                type="button"
                onClick={() => openManualLine('single')}
                disabled={submitting}
                className="text-xs px-2.5 py-1 border border-blue-500/40 text-blue-300 rounded hover:bg-blue-500/10 disabled:opacity-50"
              >
                + Single (manual)
              </button>
            </>
          )}

          <div className="flex-1" />

          <h2 className="font-display text-lg font-semibold text-white">
            Cart {cart.length > 0 && (
              <span className="text-sm font-normal text-gray-400 ml-1">
                ({cart.length} {cart.length === 1 ? 'line' : 'lines'} · {cartTotalUnits} units)
              </span>
            )}
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

            {/* Subtotal / trade math */}
            <div className="pt-3 mt-3 border-t border-vault-border space-y-2">
              <div className="flex justify-between items-center text-sm text-gray-300">
                <span>
                  {transactionType === 'buy'
                    ? 'Cart total (items we are buying from customer)'
                    : 'Cart total (items going to customer)'}
                </span>
                <span className="text-white font-semibold">{fmtUsd(cartGross)}</span>
              </div>

              {transactionType === 'trade' && (
                <>
                  <div className="flex justify-between items-center text-sm text-gray-300">
                    <label className="flex items-center gap-2">
                      Trade-in value <span className="text-red-400">*</span>
                      <span className="text-xs text-gray-500">(value of what customer brought)</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tradeInValue}
                      onChange={(e) => setTradeInValue(e.target.value)}
                      placeholder="0.00"
                      disabled={submitting}
                      className={`w-32 text-right ${
                        tradeInValue === '' || tradeInValue == null ? 'border-red-500/50' : ''
                      }`}
                    />
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-vault-border/50">
                    <span className="text-sm text-gray-300">Net cash</span>
                    <span className={`text-xl font-bold ${
                      netCash > 0 ? 'text-emerald-300' : netCash < 0 ? 'text-red-300' : 'text-gray-300'
                    }`}>
                      {fmtUsd(netCash)}
                      {netCash > 0 && <span className="text-xs text-gray-400 ml-2">(customer pays us)</span>}
                      {netCash < 0 && <span className="text-xs text-gray-400 ml-2">(we pay customer)</span>}
                      {netCash === 0 && <span className="text-xs text-gray-400 ml-2">(even trade)</span>}
                    </span>
                  </div>
                </>
              )}

              {transactionType === 'sale' && (
                <div className="flex justify-end">
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wider text-gray-500">Customer pays</div>
                    <div className="text-2xl font-bold text-vault-gold">{fmtUsd(cartGross)}</div>
                  </div>
                </div>
              )}

              {transactionType === 'buy' && (
                <div className="flex justify-end">
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wider text-gray-500">We pay customer</div>
                    <div className="text-2xl font-bold text-red-300">{fmtUsd(cartGross)}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            submitting
            || cart.length === 0
            || !paymentMethodId
            || (splitPayment && splitEligible && (splitMismatch || splitMethodsClash || !paymentMethodId2))
          }
          className="btn btn-primary px-6 py-3 text-base"
        >
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
            : <><Save size={18} /> {submitLabel}</>
          }
        </button>
      </div>

      {/* Manual buy-line modal (Buy mode only) */}
      {manualLineDraft && (
        <ManualLineModal
          draft={manualLineDraft}
          onChange={(patch) => setManualLineDraft(d => ({ ...d, ...patch }))}
          onSave={(opts) => saveManualLine(opts)}
          onCancel={() => setManualLineDraft(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// ManualLineModal — used in Buy mode to add a slab / single without an
// existing card record. Cashier types description + qty + price. We don't
// auto-create slabs/singles rows — that's a separate Cards Scan intake.
// ============================================================================
function ManualLineModal({ draft, onChange, onSave, onCancel }) {
  if (!draft) return null
  const isSlab = draft.subKind === 'slab'
  // Enter (form submit) defaults to "Add & next" — bulk-friendly: type
  // description → tab → price → Enter → form clears → type next item.
  // Cashier clicks "Add to cart" explicitly when they're done.
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); onSave({ stayOpen: true }) }}
        className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-md w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          {isSlab
            ? <Diamond size={18} className="text-emerald-300" />
            : <Layers size={18} className="text-blue-300" />}
          <h3 className="font-semibold text-base text-white">
            Buy {isSlab ? 'slab' : 'single'} — manual entry
          </h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          The {isSlab ? 'slab' : 'single'} isn't in our cards inventory yet, so we just record the money out.
          The store staff intakes the card properly later via Cards Scan.
        </p>

        <label className="block text-xs text-gray-400 mb-1">
          Description <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={isSlab ? 'e.g. PSA 10 Charizard Base Set #4' : 'e.g. NM Pikachu Promo'}
          autoFocus
          className="w-full mb-3"
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Qty {isSlab && <span className="text-gray-600">(slab = 1)</span>}
            </label>
            <input
              type="number"
              min="1"
              value={draft.quantity}
              onChange={(e) => onChange({ quantity: parseInt(e.target.value) || 1 })}
              disabled={isSlab}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Price (USD, per unit) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.price}
              onChange={(e) => onChange({ price: e.target.value })}
              placeholder="0.00"
              className="w-full"
            />
          </div>
        </div>

        <div className="flex justify-between items-center gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {/* "Add & next" = form submit = Enter key. Bulk-friendly default. */}
            <button
              type="submit"
              className="px-3 py-2 text-sm border border-vault-border text-gray-200 hover:bg-vault-darker rounded-lg"
              title="Or press Enter"
            >
              Add &amp; next
            </button>
            <button
              type="button"
              onClick={() => onSave({ stayOpen: false })}
              className="px-3 py-2 text-sm bg-vault-gold/20 border border-vault-gold/60 text-vault-gold hover:bg-vault-gold/30 rounded-lg"
            >
              Add &amp; close
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ============================================================================
// DailySummaryCard — running today-so-far KPIs at top of the page
// ============================================================================
// Shows:
//   - sale count + total cash from sales
//   - trade count + net cash from trades (signed; sum may be negative if we
//     paid customers more than they paid us)
//   - net cash today across all transactions
//   - breakdown by payment method (so the cashier can reconcile the drawer)
// Refreshes after each successful submit. Manual refresh button for the
// rare case where another tab on another machine wrote rows.
// ============================================================================
function DailySummaryCard({ summary, loading, onRefresh }) {
  // Toggle for the collapsible per-transaction breakdown. Default
  // collapsed so the card stays compact; one click expands to show
  // every sale/trade/buy with its items.
  const [showDetails, setShowDetails] = useState(false)

  if (loading && !summary) {
    return (
      <div className="card mb-4 flex items-center justify-center py-6 text-gray-500 text-sm">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading today's numbers…
      </div>
    )
  }
  if (!summary) return null

  const { totals = {}, by_payment = {}, date, transactions = [] } = summary
  const paymentEntries = Object.entries(by_payment)
    .sort((a, b) => (b[1].total_net_cash || 0) - (a[1].total_net_cash || 0))

  const hasActivity = (totals.sale_count || 0) > 0
    || (totals.trade_count || 0) > 0
    || (totals.buy_count || 0) > 0

  return (
    <div className="card mb-4 border-vault-gold/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-vault-gold" />
          <h2 className="font-display text-sm font-semibold text-white uppercase tracking-wider">
            Today ({date})
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-gray-400 hover:text-white p-1 disabled:opacity-50"
          title="Refresh"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {!hasActivity ? (
        <p className="text-sm text-gray-500 text-center py-2">No transactions yet today.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Sales column */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Sales</div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-bold text-vault-gold">{fmtUsd(totals.sale_net_cash)}</span>
              <span className="text-xs text-gray-400">/ {totals.sale_count} sale{totals.sale_count === 1 ? '' : 's'}</span>
            </div>
          </div>

          {/* Trades column */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Trades (net)</div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-2xl font-bold ${
                (totals.trade_net_cash || 0) > 0 ? 'text-emerald-300'
                  : (totals.trade_net_cash || 0) < 0 ? 'text-red-300'
                  : 'text-gray-300'
              }`}>
                {fmtUsd(totals.trade_net_cash)}
              </span>
              <span className="text-xs text-gray-400">/ {totals.trade_count} trade{totals.trade_count === 1 ? '' : 's'}</span>
            </div>
          </div>

          {/* Buys column — cash flows OUT, so usually negative */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Buys</div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-2xl font-bold ${
                (totals.buy_net_cash || 0) < 0 ? 'text-red-300'
                  : 'text-gray-300'
              }`}>
                {fmtUsd(totals.buy_net_cash)}
              </span>
              <span className="text-xs text-gray-400">/ {totals.buy_count} buy{totals.buy_count === 1 ? '' : 's'}</span>
            </div>
          </div>

          {/* Net total column */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Net cash today</div>
            <div className={`text-2xl font-bold ${
              (totals.total_net_cash || 0) > 0 ? 'text-emerald-300'
                : (totals.total_net_cash || 0) < 0 ? 'text-red-300'
                : 'text-white'
            }`}>
              {fmtUsd(totals.total_net_cash)}
            </div>
          </div>
        </div>
      )}

      {/* Payment-method breakdown row */}
      {paymentEntries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-vault-border/50">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">By payment method</div>
          <div className="flex flex-wrap gap-3">
            {paymentEntries.map(([name, info]) => (
              <div key={name} className="flex items-baseline gap-1.5 px-3 py-1.5 bg-vault-darker/60 rounded border border-vault-border">
                <span className="text-xs text-gray-400">{name}</span>
                <span className={`text-sm font-semibold ${
                  info.total_net_cash > 0 ? 'text-emerald-300'
                    : info.total_net_cash < 0 ? 'text-red-300'
                    : 'text-white'
                }`}>
                  {fmtUsd(info.total_net_cash)}
                </span>
                <span className="text-[10px] text-gray-500">({info.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible per-transaction details — only render the toggle when
          there's actually something to show. Click expands the panel with
          every sale/trade/buy + its items, time, and payment method. */}
      {transactions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-vault-border/50">
          <button
            type="button"
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"
          >
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showDetails ? 'Hide details' : 'Show details'}
            <span className="text-gray-600">({transactions.length} transaction{transactions.length === 1 ? '' : 's'})</span>
          </button>

          {showDetails && (
            <div className="mt-3 space-y-2">
              {transactions.map((t) => (
                <TransactionDetail key={t.transaction_id} txn={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// One row in the expanded daily-summary details: header with type +
// payment method + time + signed net cash, then the item bullets.
function TransactionDetail({ txn }) {
  const KIND_ICON_TXT = {
    sealed: '📦', slab: '💎', single: '🎴',
    slab_manual: '💎', single_manual: '🎴',
  }
  const headerMeta = (() => {
    if (txn.type === 'trade') {
      const nc = Number(txn.net_cash || 0)
      const direction =
        nc > 0 ? `customer paid $${nc.toFixed(2)}`
        : nc < 0 ? `we paid $${Math.abs(nc).toFixed(2)}`
        : 'even'
      return {
        Icon: ArrowLeftRight,
        label: 'Trade',
        color: 'text-blue-300',
        money: `${fmtUsd(nc)}`,
        sub: direction,
        netColor: nc > 0 ? 'text-emerald-300' : nc < 0 ? 'text-red-300' : 'text-gray-300',
      }
    }
    if (txn.type === 'buy') {
      const nc = Number(txn.net_cash || 0)
      return {
        Icon: Coins,
        label: 'Buy',
        color: 'text-orange-300',
        money: `${fmtUsd(nc)}`,
        sub: `we paid $${Math.abs(nc).toFixed(2)}`,
        netColor: 'text-red-300',
      }
    }
    const nc = Number(txn.net_cash || 0)
    return {
      Icon: ShoppingCart,
      label: 'Sale',
      color: 'text-vault-gold',
      money: `${fmtUsd(nc)}`,
      sub: null,
      netColor: 'text-emerald-300',
    }
  })()

  const { Icon } = headerMeta
  const timeStr = txn.timestamp
    ? new Date(txn.timestamp).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null

  // Payment label: when we have split data with 2+ rows, render
  // "Cash $30 + Store Credit $60". When we have 1 split row or no split
  // data, render the legacy single method name.
  const paymentLabel = (() => {
    if (Array.isArray(txn.payments) && txn.payments.length >= 2) {
      return txn.payments
        .map(p => `${p.method_name} $${Number(p.amount).toFixed(2)}`)
        .join(' + ')
    }
    return txn.payment_method
  })()

  return (
    <div className="bg-vault-darker/40 border border-vault-border rounded px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className={`${headerMeta.color} flex-shrink-0`} />
          <span className={`font-semibold ${headerMeta.color}`}>{headerMeta.label}</span>
          {timeStr && <span className="text-xs text-gray-500">{timeStr}</span>}
          <span className="text-xs text-gray-500">·</span>
          <span className="text-xs text-gray-400 truncate">{paymentLabel}</span>
        </div>
        <div className="flex items-baseline gap-1.5 flex-shrink-0">
          <span className={`font-semibold ${headerMeta.netColor}`}>{headerMeta.money}</span>
          {headerMeta.sub && <span className="text-[10px] text-gray-500">({headerMeta.sub})</span>}
        </div>
      </div>
      {txn.items && txn.items.length > 0 && (
        <ul className="space-y-0.5 pl-1">
          {txn.items.map((it, i) => {
            const qty = Number(it.quantity) || 1
            const sub = Number(it.subtotal) || 0
            return (
              <li key={i} className="text-xs text-gray-300 flex items-center gap-1.5">
                <span className="flex-shrink-0">{KIND_ICON_TXT[it.kind] || '•'}</span>
                <span className="truncate flex-1 min-w-0">
                  {it.name}{qty > 1 ? ` ×${qty}` : ''}
                </span>
                <span className="text-gray-500 flex-shrink-0">${sub.toFixed(2)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {txn.type === 'trade' && Number(txn.trade_in_value || 0) > 0 && (
        <div className="text-[11px] text-gray-500 mt-1 pl-1">
          Customer brought ${Number(txn.trade_in_value).toFixed(2)} in trade-in
        </div>
      )}
    </div>
  )
}

// ============================================================================
// CartRow — single cart entry (sealed / slab / single)
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
  } else if (line.kind === 'single') {
    const setLine = line.single.set?.name ? ` · ${line.single.set.name}` : ''
    title = `${line.single.card_name}${line.single.card_number ? ` #${line.single.card_number}` : ''}`
    sub = `${line.single.condition || 'raw'}${setLine} · TCG ${line.single.tcg_id}`
    available = line.available
    qtyEditable = true
  } else if (line.kind === 'slab_manual') {
    // Buy mode manual entry — only description (cashier-typed) to show.
    title = line.description || '(no description)'
    sub = 'Manual buy — not yet in slabs inventory (intake separately via Cards Scan)'
    available = 1
    qtyEditable = false
  } else if (line.kind === 'single_manual') {
    title = line.description || '(no description)'
    sub = 'Manual buy — not yet in singles inventory (intake separately via Cards Scan)'
    // No DB-side cap for manual singles — qty is whatever cashier typed.
    available = 999
    qtyEditable = true
  } else {
    title = '(unknown line kind)'
    sub = ''
    available = 1
    qtyEditable = false
  }

  const qty = Number(line.quantity ?? 1) || 1
  const price = Number(line.price) || 0
  const subtotal = price * qty
  const priceMissing = line.price === '' || line.price == null

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
        <label className="block text-[10px] uppercase tracking-wider text-gray-500">
          Price (USD) <span className="text-red-400">*</span>
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={line.price}
          onChange={(e) => onUpdate({ price: e.target.value })}
          disabled={disabled}
          placeholder="0.00"
          className={`w-full px-2 py-1 text-sm ${priceMissing ? 'border-red-500/50 bg-red-500/5' : ''}`}
        />
      </div>

      <div className="col-span-1 text-right text-sm text-vault-gold font-semibold">
        {fmtUsd(subtotal)}
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
