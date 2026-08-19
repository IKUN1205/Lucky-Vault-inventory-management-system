import React, { useState, useEffect } from 'react'
import {
  fetchProducts,
  fetchUsers,
  fetchChinaVendors,
  fetchPaymentMethods,
  fetchChinaAcquisitions,
  createChinaAcquisition,
  updateChinaAcquisition,
  undoChinaAcquisition,
  createVendor,
  createPaymentMethod,
  createProduct,
  convertToUSD,
} from '../lib/supabase'
import { createProductChecked } from '../lib/duplicateGuard'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import SlabQuickIntake from '../components/SlabQuickIntake'
import { useAuth } from '../lib/AuthContext'
import { ShoppingCart, Save, Plus, Trash2, X, Pencil, RotateCcw, Loader2 } from 'lucide-react'
import { variantLabel, variantChipClasses } from '../lib/japanVariants'

// ============================================================================
// 中国进货 — China offline acquisitions
// ============================================================================
// Records cash-in-hand offline purchases (markets, individual sellers). Items
// go straight into China Warehouse — no separate Intake step since "buy" and
// "receive" happen at the same moment for offline purchases. Direct mirror of
// the Japan Acquisitions page.
//
// Differences vs the US PurchasedItems page:
//   - currency is fixed to RMB (auto USD conversion shown)
//   - source_country fixed to China, origin = cn_vendor
//   - status = 'Received' immediately, inventory bumps on submit
//   - optional 快递/运单号 (Gary 2026-07-06): online CN buys shipped to the
//     warehouse get arrival alerts via the daily AfterShip cron; stock still
//     instant-receives (tracking is informational, not an Intake gate)
//   - vendor dropdown limited to CN vendors (or no-country legacy)
// ============================================================================

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// 中文映射:aliases 里第一个含中文的别名 = 本页显示名(其他页面/库里的英文名不动)
const zhName = (p) =>
  (Array.isArray(p.aliases) && p.aliases.find(a => /[一-鿿]/.test(a))) || null

const productOptionLabel = (p) => {
  const shortCode = p.short_code ? `${p.short_code} · ` : ''
  const zh = zhName(p)
  if (zh) return `${shortCode}${zh}`
  return `${shortCode}${p.brand || '?'} | ${extractLaunchName(p.name, p.category)} | ${p.category || p.type || '?'} | ${p.language || '?'}`
}

// Aliases + short code joined for SearchableSelect's getOptionSearchText.
// Lets typing "M2a", "海贼王", "OP15", etc. find the matching SKU even when
// those terms aren't in the displayed label.
const productSearchText = (p) => {
  const parts = []
  if (p.short_code) parts.push(p.short_code)
  if (p.barcode) parts.push(p.barcode)          // 扫码枪直接命中 (Gary 2026-07-06)
  if (Array.isArray(p.aliases)) parts.push(...p.aliases)
  return parts.join(' ')
}

// Dropdown row renderer: variant chip (中文) prefix + label. Easy visual
// distinction between sealed / in-bag / single-pack versions of the same set.
const renderProductOption = (p) => {
  const v = p.variant
  return (
    <div className="flex items-center gap-2">
      {v && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${variantChipClasses(v)} flex-shrink-0`}>
          {variantLabel(v)}
        </span>
      )}
      <span className="flex-1 truncate">{productOptionLabel(p)}</span>
    </div>
  )
}

export default function ChinaAcquisitions() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [products, setProducts] = useState([])
  const [users, setUsers] = useState([])
  const [vendors, setVendors] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [recentAcqs, setRecentAcqs] = useState([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Edit/Undo state for the recent-acquisitions table.
  const [editing, setEditing] = useState(null)   // row being edited (null = closed)
  const [rowBusy, setRowBusy] = useState(null)    // id mid-undo

  // Quick-add-product ("+ 新货") modal toggle.
  const [showQuickAdd, setShowQuickAdd] = useState(false)

  // Header (shared across all line items in one submission)
  const [header, setHeader] = useState({
    date_purchased: new Date().toLocaleDateString('en-CA'),
    acquirer_id: '',
    vendor_id: '',
    payment_method_id: '',
    notes: '',
    carrier: '',          // optional — 线上买的货有快递才填
    tracking_number: '',
  })

  const [lineItems, setLineItems] = useState([
    { id: 1, product_id: '', quantity: 1, unit_cost_rmb: '' },
  ])

  // Inline add-new-vendor / -payment toggles (same UX as US PurchasedItems)
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [showNewPayment, setShowNewPayment] = useState(false)
  const [newPaymentName, setNewPaymentName] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      const [prods, usersData, vs, pms, recent] = await Promise.all([
        fetchProducts(),
        fetchUsers(),
        fetchChinaVendors(),
        fetchPaymentMethods(),
        fetchChinaAcquisitions(20),
      ])
      // China team only handles CN-language product (Gary 2026-07-06) — a ~34-item
      // dropdown is browsable without typing; name search stays for the rest.
      setProducts(prods.filter(p => (p.type === 'Sealed' || p.type === 'Pack') && (p.language || '').toUpperCase() === 'CN'))
      setUsers(usersData)
      setVendors(vs)
      setPaymentMethods(pms)
      setRecentAcqs(recent)
    } catch (err) {
      console.error(err)
      addToast(err.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleHeaderChange = (e) => {
    const { name, value } = e.target
    setHeader(h => ({ ...h, [name]: value }))
  }

  const addLineItem = () => {
    const newId = Math.max(...lineItems.map(i => i.id), 0) + 1
    setLineItems([...lineItems, { id: newId, product_id: '', quantity: 1, unit_cost_rmb: '' }])
  }

  const removeLineItem = (id) => {
    if (lineItems.length <= 1) return
    setLineItems(lineItems.filter(i => i.id !== id))
  }

  const updateLineItem = (id, field, value) => {
    setLineItems(items => items.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  // A new provisional CN product was just created inline. Add it to the options
  // list and auto-select it into the first empty line (or a fresh line if all
  // are filled), so the buyer keeps going without hunting for it.
  const handleQuickAddCreated = (created) => {
    setProducts(prev => prev.some(p => p.id === created.id) ? prev : [...prev, created])
    setLineItems(items => {
      const idx = items.findIndex(i => !i.product_id)
      if (idx >= 0) {
        const copy = [...items]
        copy[idx] = { ...copy[idx], product_id: created.id }
        return copy
      }
      const newId = Math.max(...items.map(i => i.id), 0) + 1
      return [...items, { id: newId, product_id: created.id, quantity: 1, unit_cost_rmb: '' }]
    })
    setShowQuickAdd(false)
  }

  // Totals (live preview)
  const totalRmb = lineItems.reduce((s, i) => {
    const q = parseInt(i.quantity) || 0
    const c = parseFloat(i.unit_cost_rmb) || 0
    return s + q * c
  }, 0)
  const totalUsd = convertToUSD(totalRmb, 'RMB')

  const handleAddNewVendor = async () => {
    const name = newVendorName.trim()
    if (!name) return
    try {
      // vendors.country is an enum (`region`) — canonical China value is
      // 'China', not 'CN' / 'CHN' (those throw 22P02). Requires the enum value
      // added by sql/cn_jp_finance.sql.
      const newVendor = await createVendor({ name, country: 'China', active: true })
      setVendors(v => [...v, newVendor].sort((a, b) => a.name.localeCompare(b.name)))
      setHeader(h => ({ ...h, vendor_id: newVendor.id }))
      setNewVendorName('')
      setShowNewVendor(false)
      addToast(`Vendor added: ${name}`, 'success')
    } catch (err) {
      addToast(`Failed to add vendor: ${err.message}`, 'error')
    }
  }

  const handleAddNewPayment = async () => {
    const name = newPaymentName.trim()
    if (!name) return
    try {
      const newPm = await createPaymentMethod(name)
      setPaymentMethods(pms => [...pms, newPm])
      setHeader(h => ({ ...h, payment_method_id: newPm.id }))
      setNewPaymentName('')
      setShowNewPayment(false)
      addToast(`Payment method added: ${name}`, 'success')
    } catch (err) {
      addToast(`Failed to add payment method: ${err.message}`, 'error')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const valid = lineItems.filter(i => i.product_id && parseInt(i.quantity) > 0)
    if (valid.length === 0) {
      addToast('Add at least one line item with product + quantity', 'error')
      return
    }
    if (!header.acquirer_id) {
      addToast('Pick who made the purchase (Acquirer)', 'error')
      return
    }

    setSubmitting(true)
    let ok = 0, fail = 0
    const larkItems = []
    let totalRmbSubmit = 0
    let totalUnits = 0
    try {
      for (const item of valid) {
        try {
          await createChinaAcquisition({
            product_id: item.product_id,
            quantity: parseInt(item.quantity),
            unit_cost_rmb: parseFloat(item.unit_cost_rmb) || 0,
            vendor_id: header.vendor_id || null,
            payment_method_id: header.payment_method_id || null,
            acquirer_id: header.acquirer_id,
            date_purchased: header.date_purchased,
            notes: header.notes || null,
            carrier: header.tracking_number.trim() ? (header.carrier || 'Other') : null,
            tracking_number: header.tracking_number || null,
          })
          ok++
          // Build Lark payload pieces from the validated form data so we
          // can fire one consolidated notification at the end of the loop.
          const p = products.find(pp => pp.id === item.product_id)
          const launch = p ? extractLaunchName(p.name, p.category) : 'Unknown'
          const qty = parseInt(item.quantity)
          const unitRmb = parseFloat(item.unit_cost_rmb) || 0
          const lineRmb = qty * unitRmb
          larkItems.push({
            name: p ? `${p.brand} | ${launch} | ${p.category || p.type} | ${p.language}` : 'Unknown',
            quantity: qty,
            cost: lineRmb,
          })
          totalRmbSubmit += lineRmb
          totalUnits += qty
        } catch (err) {
          console.error('[ChinaAcq] line failed:', err)
          fail++
        }
      }
      if (ok > 0) {
        addToast(`✓ ${ok} item${ok === 1 ? '' : 's'} added to China Warehouse${fail ? ` (${fail} failed)` : ''}`, ok === valid.length ? 'success' : 'info')

        // Fire-and-forget Lark — reuses the 'purchased' type with
        // sourceCountry='China' so dispatch routes to the Acquisitions Squad
        // (global spend visibility). A China-specific webhook can be wired
        // server-side later without touching this call.
        try {
          const vendor = vendors.find(v => v.id === header.vendor_id)
          const acquirer = users.find(u => u.id === header.acquirer_id)
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'purchased',
              acquirer: acquirer?.name || 'Unknown',
              vendor: vendor?.name || null,
              sourceCountry: 'China',
              currency: 'RMB',
              totalCost: totalRmbSubmit,
              totalCostUSD: convertToUSD(totalRmbSubmit, 'RMB'),
              items: larkItems,
              totalUnits,
              carrier: header.tracking_number.trim() ? (header.carrier || 'Other') : null,
              trackingNumber: header.tracking_number.trim() || null,
            }),
          }).catch(err => console.error('[lark-notify] cn_acquisition failed:', err))
        } catch (err) {
          console.error('[lark-notify] cn_acquisition payload build failed:', err)
        }

        // Reset line items + tracking (per-shipment), keep the rest of the
        // header so multiple batches from same vendor go fast.
        setLineItems([{ id: 1, product_id: '', quantity: 1, unit_cost_rmb: '' }])
        setHeader(h => ({ ...h, carrier: '', tracking_number: '' }))
        // Refresh recent list
        const recent = await fetchChinaAcquisitions(20)
        setRecentAcqs(recent)
      } else {
        addToast('Failed to save acquisitions', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleUndoAcq = async (a) => {
    // One dialog = confirm + reason capture. Cancel (null) aborts.
    const reason = window.prompt(
      `撤销这笔进货?\n${extractLaunchName(a.product?.name, a.product?.category)} × ${a.quantity_purchased}\n\n会从中国仓扣回 ${a.quantity_purchased} 件。\n(如果这批已经卖掉/发走一部分,会拦下来)\n可填撤销原因(可留空):`,
      ''
    )
    if (reason === null) return

    setRowBusy(a.id)
    try {
      await undoChinaAcquisition(a.id, { deletedById: user?.id || null, reason: reason || null })
      addToast('✓ 进货已撤销,中国库存已扣回', 'success')
      const recent = await fetchChinaAcquisitions(20)
      setRecentAcqs(recent)
    } catch (err) {
      console.error('[ChinaAcq] undo failed:', err)
      addToast(err.message || 'Failed to undo acquisition', 'error')
    } finally {
      setRowBusy(null)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner" /></div>

  return (
    <div className="fade-in space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShoppingCart className="text-vault-gold" />
          🇨🇳 中国进货 / China Acquisitions
        </h1>
        <p className="text-gray-400 mt-1">
          Record offline purchases (currency = RMB, instant-receive to <strong>China Warehouse</strong>).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card max-w-4xl space-y-4">
        {/* Header */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
            <input
              type="date"
              name="date_purchased"
              value={header.date_purchased}
              onChange={handleHeaderChange}
              required
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Acquirer *</label>
            <select name="acquirer_id" value={header.acquirer_id} onChange={handleHeaderChange} required>
              <option value="">Who made this purchase?</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* Vendor + Payment Method removed per Gary 2026-07-06 — CN purchases
            reconcile at channel level (fx_transfers), not per-vendor/per-payment.
            Data layer still accepts nulls, so nothing else changes. */}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional)</label>
          <input
            type="text"
            name="notes"
            value={header.notes}
            onChange={handleHeaderChange}
            placeholder="e.g. 义乌小商品市场进货 / Yiwu market purchase"
          />
        </div>

        {/* Optional shipment tracking (Gary 2026-07-06) — 线上买的货填了单号,
            每天 AfterShip cron 会自动跟踪并在 Lark 播报到货 (LV CLAW)。
            Carrier values must match AFTERSHIP_SLUGS keys in api/aftership-sync.js. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">快递 / Carrier (可选)</label>
            <select name="carrier" value={header.carrier} onChange={handleHeaderChange}>
              <option value="">— 线下自提,没有快递 —</option>
              <option value="SF Express">顺丰 SF Express</option>
              <option value="China Post">EMS / 中国邮政 China Post</option>
              <option value="ZTO">中通 ZTO</option>
              <option value="YTO">圆通 YTO</option>
              <option value="STO">申通 STO</option>
              <option value="Yunda">韵达 Yunda</option>
              <option value="Other">其他 Other (自动识别)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">运单号 / Tracking # (可选)</label>
            <input
              type="text"
              name="tracking_number"
              value={header.tracking_number}
              onChange={handleHeaderChange}
              placeholder="SF1234567890123"
              className="font-mono"
              spellCheck={false}
            />
            <p className="text-[11px] text-gray-500 mt-1">填了单号,到货当天会自动在 Lark 提醒。</p>
          </div>
        </div>

        {/* Line items */}
        <div className="pt-4 border-t border-vault-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-white text-sm">Items</h3>
              <button
                type="button"
                onClick={() => setShowQuickAdd(true)}
                className="text-xs text-vault-gold hover:underline flex items-center gap-1"
                title="买到新的简体中文产品?点这里先建一个"
              >
                <Plus size={12} /> 新货
              </button>
            </div>
            <div className="text-xs text-gray-400">
              Total: <span className="text-vault-gold font-semibold">¥{totalRmb.toLocaleString()}</span>
              <span className="text-gray-500 mx-2">≈</span>
              <span className="text-green-400 font-semibold">${totalUsd.toFixed(2)} USD</span>
            </div>
          </div>

          <div className="space-y-2">
            {lineItems.map((item, idx) => {
              const q = parseInt(item.quantity) || 0
              const c = parseFloat(item.unit_cost_rmb) || 0
              const lineTotal = q * c
              const prod = item.product_id ? products.find(p => p.id === item.product_id) : null
              return (
                <div key={item.id} className="p-3 bg-vault-dark rounded-lg border border-vault-border">
                  {/* items-start + consistent label-then-control structure across all
                      columns. The Line cell is rendered as a readonly box so it
                      visually matches the inputs next to it. Trash uses an
                      invisible label spacer to vertical-align with the inputs. */}
                  <div className="grid grid-cols-12 gap-3 items-start">
                    <div className="col-span-12 md:col-span-5">
                      <label className="block text-xs text-gray-400 mb-1">Product</label>
                      <SearchableSelect
                        options={products}
                        value={item.product_id}
                        onChange={(val) => updateLineItem(item.id, 'product_id', val)}
                        getOptionValue={(p) => p.id}
                        getOptionLabel={productOptionLabel}
                        getOptionSearchText={productSearchText}
                        renderOption={renderProductOption}
                        placeholder="搜索 short code / 中文 / English..."
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Qty</label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, 'quantity', e.target.value)}
                        min="1"
                        className="text-sm w-full"
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Unit ¥</label>
                      <input
                        type="number"
                        value={item.unit_cost_rmb}
                        onChange={(e) => updateLineItem(item.id, 'unit_cost_rmb', e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="RMB"
                        className="text-sm w-full"
                      />
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Line</label>
                      <div className="text-sm text-vault-gold font-semibold py-2 px-3 bg-vault-darker/40 rounded-md border border-vault-border/40 text-right truncate">
                        ¥{lineTotal.toLocaleString()}
                      </div>
                    </div>
                    <div className="col-span-1">
                      <label className="block text-xs mb-1 invisible" aria-hidden="true">.</label>
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        disabled={lineItems.length <= 1}
                        className="w-full h-9 flex items-center justify-center text-gray-500 hover:text-red-400 rounded-md hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        title="Remove line"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {/* Full-width readable name of the selected product — the search
                      box column is too narrow for long CN/JP names (Gary 2026-07-06) */}
                  {prod && (
                    <div className="mt-2 pt-2 border-t border-vault-border/40 flex items-center gap-2">
                      {prod.variant && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${variantChipClasses(prod.variant)} flex-shrink-0`}>
                          {variantLabel(prod.variant)}
                        </span>
                      )}
                      <span className="text-base text-gray-100 font-medium leading-snug">
                        {prod.short_code ? `${prod.short_code} · ` : ''}{zhName(prod) || prod.name}
                      </span>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {[zhName(prod) ? prod.name : null, prod.category || prod.type].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={addLineItem}
            className="w-full mt-3 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors text-sm"
          >
            <Plus size={14} className="inline mr-2" /> Add another item
          </button>
        </div>

        <div className="pt-4 border-t border-vault-border flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save size={16} />
            {submitting ? 'Saving…' : 'Save → China Warehouse'}
          </button>
        </div>
      </form>

      {/* Slab cert quick-intake (shared with Japan). Defaults currency to RMB. */}
      <SlabQuickIntake
        defaultCurrency="RMB"
        currentUserId={user?.id}
        currentUserName={user?.name}
        addToast={addToast}
      />

      {/* Recent acquisitions */}
      <div className="card max-w-4xl">
        <h3 className="font-semibold text-white text-sm mb-3">Recent China acquisitions (last 20)</h3>
        {recentAcqs.length === 0 ? (
          <p className="text-gray-500 text-sm py-3">No China acquisitions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Vendor</th>
                  <th className="pb-2">Acquirer</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">RMB</th>
                  <th className="pb-2 text-right">USD</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentAcqs.map(a => (
                  <tr key={a.id} className="border-b border-vault-border/40">
                    <td className="py-1.5 text-gray-300">{a.date_purchased}</td>
                    <td className="py-1.5 text-white">{extractLaunchName(a.product?.name, a.product?.category)} <span className="text-gray-500 text-xs">[{a.product?.language}]</span></td>
                    <td className="py-1.5 text-gray-400">{a.vendor?.name || '—'}</td>
                    <td className="py-1.5 text-gray-400">{a.acquirer?.name || '—'}</td>
                    <td className="py-1.5 text-right text-white">{a.quantity_purchased}</td>
                    <td className="py-1.5 text-right text-vault-gold">¥{(a.cost || 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right text-green-400">${(a.cost_usd || 0).toFixed(2)}</td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(a)}
                          disabled={rowBusy === a.id}
                          className="p-1.5 text-gray-400 hover:text-vault-gold rounded-md hover:bg-vault-gold/10 disabled:opacity-40"
                          title="修改这笔进货"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUndoAcq(a)}
                          disabled={rowBusy === a.id}
                          className="p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/10 disabled:opacity-40"
                          title="撤销这笔进货(扣回中国库存)"
                        >
                          {rowBusy === a.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditAcquisitionModal
          acq={editing}
          products={products}
          vendors={vendors}
          paymentMethods={paymentMethods}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            const recent = await fetchChinaAcquisitions(20)
            setRecentAcqs(recent)
          }}
          addToast={addToast}
        />
      )}

      {showQuickAdd && (
        <CnQuickAddProduct
          existingProducts={products}
          currentUserName={user?.name}
          addToast={addToast}
          onClose={() => setShowQuickAdd(false)}
          onCreated={handleQuickAddCreated}
        />
      )}
    </div>
  )
}

// ============================================================================
// Edit modal for a China acquisition.
// ============================================================================
// Pre-fills the row. Save routes through updateChinaAcquisition, which
// reconciles China Warehouse stock for any product/qty/cost change (reversing
// the old buy + re-applying the corrected one, stock-checked server-side) and
// rewrites the acquisition record. Edits are SILENT on Lark — this is internal
// China stock bookkeeping; the create already announced the buy and a typo fix
// doesn't need to re-ping the group.
function EditAcquisitionModal({ acq, products, vendors, paymentMethods, onClose, onSaved, addToast }) {
  const seedUnitRmb = acq.quantity_purchased > 0
    ? Math.round((Number(acq.cost) || 0) / acq.quantity_purchased)
    : 0

  const [form, setForm] = useState({
    product_id: acq.product_id || '',
    quantity: acq.quantity_purchased || 1,
    unit_cost_rmb: seedUnitRmb ? String(seedUnitRmb) : '',
    vendor_id: acq.vendor_id || '',
    payment_method_id: acq.payment_method_id || '',
    date_purchased: acq.date_purchased || new Date().toLocaleDateString('en-CA'),
    notes: acq.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const qty = parseInt(form.quantity) || 0
  const unit = parseFloat(form.unit_cost_rmb) || 0
  const lineRmb = qty * unit
  const lineUsd = convertToUSD(lineRmb, 'RMB')

  const handleSave = async () => {
    if (!form.product_id) { addToast('Pick a product', 'error'); return }
    if (qty <= 0) { addToast('Quantity must be at least 1', 'error'); return }
    setSaving(true)
    try {
      await updateChinaAcquisition(acq.id, {
        product_id: form.product_id,
        quantity: qty,
        unit_cost_rmb: unit,
        vendor_id: form.vendor_id || null,
        payment_method_id: form.payment_method_id || null,
        date_purchased: form.date_purchased,
        notes: form.notes || null,
      })
      addToast('✓ 进货已更新,中国库存已同步', 'success')
      await onSaved()
    } catch (err) {
      console.error('[ChinaAcq] edit failed:', err)
      addToast(err.message || 'Failed to update acquisition', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}>
      <div className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-2xl w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 text-vault-gold">
            <Pencil size={18} />
            <h3 className="font-semibold text-base">修改进货 / Edit acquisition</h3>
          </div>
          <button onClick={onClose} disabled={saving} className="text-gray-500 hover:text-white p-1 -m-1">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Product</label>
            <SearchableSelect
              options={products}
              value={form.product_id}
              onChange={(val) => set('product_id', val)}
              getOptionValue={(p) => p.id}
              getOptionLabel={productOptionLabel}
              getOptionSearchText={productSearchText}
              renderOption={renderProductOption}
              placeholder="搜索 short code / 中文 / English..."
            />
            <p className="text-[11px] text-gray-500 mt-1">改产品/数量/成本会自动调整中国库存(原批已卖/已发会拦下)。</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Qty</label>
              <input type="number" min="1" value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)} className="text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Unit ¥</label>
              <input type="number" min="0" step="0.01" value={form.unit_cost_rmb}
                onChange={(e) => set('unit_cost_rmb', e.target.value)} className="text-sm w-full" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Vendor</label>
              <select value={form.vendor_id} onChange={(e) => set('vendor_id', e.target.value)} className="text-sm w-full">
                <option value="">— No specific vendor —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Payment Method</label>
              <select value={form.payment_method_id} onChange={(e) => set('payment_method_id', e.target.value)} className="text-sm w-full">
                <option value="">— Unspecified —</option>
                {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input type="date" value={form.date_purchased}
              onChange={(e) => set('date_purchased', e.target.value)} className="text-sm w-full" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <input type="text" value={form.notes}
              onChange={(e) => set('notes', e.target.value)} className="text-sm w-full" />
          </div>

          <div className="text-xs text-gray-400 pt-1">
            New total: <span className="text-vault-gold font-semibold">¥{lineRmb.toLocaleString()}</span>
            <span className="text-gray-500 mx-1">≈</span>
            <span className="text-green-400 font-semibold">${lineUsd.toFixed(2)} USD</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存修改
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// CnQuickAddProduct — inline "+ 新货" provisional product creator (中国进货)
// ============================================================================
// The China team buys a simplified-Chinese product that isn't in the catalog
// yet (US side asleep). Rather than block, they create a PROVISIONAL product
// here and keep buying; the US side normalizes it later.
//
// NORMALIZATION CONVENTION (no DDL): a CN product whose `name` still contains
// CJK characters = not yet normalized by the US side. The Chinese name is
// written to BOTH products.name AND aliases[0]. When US later renames `name`
// to English + fixes the category, the Chinese stays in aliases[0], so
// China-side search + the CN display mapping keep working unchanged.
// ============================================================================

const CN_TYPE_OPTIONS = [
  { key: 'sealed_box', label: '原盒', type: 'Sealed', category: 'Booster Box' },
  { key: 'pack',       label: '散包', type: 'Pack',   category: 'Booster Pack' },
  { key: 'gift_box',   label: '礼盒', type: 'Sealed', category: 'Collection Box' },
  { key: 'other',      label: '其他', type: 'Sealed', category: 'Other' },
]
const CN_BRAND_OPTIONS = [
  { key: 'pokemon',  label: '宝可梦 Pokemon',   brand: 'Pokemon' },
  { key: 'onepiece', label: '海贼王 One Piece', brand: 'One Piece' },
  { key: 'other',    label: '其他 Other',       brand: null },
]
const cnNorm = (s) => (s || '').toLowerCase().replace(/\s+/g, '')

function CnQuickAddProduct({ existingProducts = [], currentUserName, addToast, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', typeKey: 'sealed_box', brandKey: 'pokemon', brandOther: '', barcode: '' })
  const [dupMatch, setDupMatch] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const typeOpt = CN_TYPE_OPTIONS.find(t => t.key === form.typeKey) || CN_TYPE_OPTIONS[0]

  // Case-insensitive similarity against existing CN products' name + aliases.
  const findDup = (name) => {
    const target = cnNorm(name)
    if (!target) return null
    return existingProducts.find(p => {
      const candidates = [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]
      return candidates.some(c => {
        const x = cnNorm(c)
        return x && (x === target || x.includes(target) || target.includes(x))
      })
    }) || null
  }

  const doCreate = async (force) => {
    const name = form.name.trim()
    if (!name) { addToast?.('中文名必填', 'error'); return }

    if (!force) {
      const match = findDup(name)
      if (match) { setDupMatch(match); return }   // pause; require explicit confirm
    }

    setSubmitting(true)
    try {
      const brand = form.brandKey === 'other'
        ? (form.brandOther.trim() || null)
        : (CN_BRAND_OPTIONS.find(b => b.key === form.brandKey)?.brand || null)
      const created = await createProductChecked({
        name,                 // Chinese = provisional (CJK in name → not yet normalized by US)
        aliases: [name],      // keep Chinese searchable even after US renames name→English
        brand,
        type: typeOpt.type,
        category: typeOpt.category,
        language: 'CN',
        active: true,
        breakable: false,     // provisional; US side sets break config on cleanup
        barcode: form.barcode.trim() || null,
      })

      // US-side heads-up (fire-and-forget). Reuses the /api/lark-notify path;
      // the 'cn_new_product' message is formatted server-side in buildMessage.
      try {
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'cn_new_product',
            name,
            typeLabel: typeOpt.label,
            user: currentUserName || 'Unknown',
          }),
        }).catch(err => console.error('[lark-notify] cn_new_product failed:', err))
      } catch (err) {
        console.error('[lark-notify] cn_new_product payload build failed:', err)
      }

      addToast?.(`✓ 已新建: ${name}`, 'success')
      onCreated?.(created)
    } catch (err) {
      const msg = err.message || 'unknown error'
      if (err.code === 'DUPLICATE_CANCELLED') {
        // They were shown the existing SKUs and picked one. That is the prompt
        // working, not a failure — reporting it as an error would train people
        // to click straight past it.
        addToast?.(`未新建 — 用已有的 SKU: ${err.candidates?.[0]?.name || ''}`)
      } else if (/duplicate key|unique constraint/i.test(msg)) {
        addToast?.('条码已被占用,或产品已存在', 'error')
      } else {
        addToast?.(`创建失败: ${msg}`, 'error')
      }
      console.error('[CnQuickAddProduct] create failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => !submitting && onClose?.()}>
      <div className="bg-vault-surface border border-vault-gold/40 rounded-xl max-w-lg w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 text-vault-gold">
            <Plus size={18} />
            <h3 className="font-semibold text-base">新建产品 / Quick-add product</h3>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-gray-500 hover:text-white p-1 -m-1">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">中文名 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => { set('name', e.target.value); if (dupMatch) setDupMatch(null) }}
              placeholder="例如:黑白闪耀 加强包"
              className="text-sm w-full"
              autoFocus
            />
            <p className="text-[11px] text-gray-500 mt-1">中文名会同时存入 name 和 aliases;美国那边之后补英文名/归类,不影响这里搜索。</p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">类型 *</label>
            <div className="grid grid-cols-4 gap-2">
              {CN_TYPE_OPTIONS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => set('typeKey', t.key)}
                  className={`text-sm py-2 rounded-md border transition-colors ${
                    form.typeKey === t.key
                      ? 'bg-vault-gold/20 border-vault-gold/60 text-vault-gold'
                      : 'border-vault-border text-gray-300 hover:border-vault-gold/40'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{typeOpt.type} · {typeOpt.category}</p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">品牌 (可选)</label>
            <div className="flex gap-2">
              <select value={form.brandKey} onChange={(e) => set('brandKey', e.target.value)} className="text-sm flex-1">
                {CN_BRAND_OPTIONS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              {form.brandKey === 'other' && (
                <input
                  type="text"
                  value={form.brandOther}
                  onChange={(e) => set('brandOther', e.target.value)}
                  placeholder="品牌名 (可留空)"
                  className="text-sm flex-1"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">条码 (可选)</label>
            <input
              type="text"
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              placeholder="扫码枪可直接扫"
              className="text-sm w-full font-mono"
            />
          </div>

          {dupMatch && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 text-sm">
              <p className="text-amber-300 font-medium mb-1">可能已存在类似产品:</p>
              <p className="text-white">{dupMatch.name} <span className="text-gray-500 text-xs">[{dupMatch.language}]</span></p>
              <p className="text-[11px] text-gray-400 mt-1">确认不是这个?点「仍然创建」继续。</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={submitting}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50">
            取消
          </button>
          <button
            onClick={() => doCreate(Boolean(dupMatch))}
            disabled={submitting || !form.name.trim()}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {dupMatch ? '仍然创建' : '创建并选用'}
          </button>
        </div>
      </div>
    </div>
  )
}
