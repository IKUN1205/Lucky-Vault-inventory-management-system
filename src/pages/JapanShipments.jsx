import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchJapanInventory,
  fetchUsers,
  fetchJapanAcquisitions,
  fetchJapanToUSShipments,
  createJapanToUSShipment,
  updateJapanToUSShipment,
  undoJapanToUSShipment,
  convertToUSD,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../lib/AuthContext'
import { Truck, Save, Plus, Trash2, ExternalLink, Package, Pencil, X, RotateCcw, Lock, Loader2 } from 'lucide-react'
import { variantLabel, variantChipClasses } from '../lib/japanVariants'

// ============================================================================
// 日本→美国发货 — Japan→US cross-border shipment
// ============================================================================
// Records that we packed up N units of SKU X in Japan and shipped to the US
// Master Vault, with tracking #. Behind the scenes this creates a pending
// acquisition row owned by the synthetic "Japan Warehouse (Internal Transfer)"
// vendor — the US side then sees it in Intake to Master and runs the normal
// receive flow when the package arrives. AfterShip cron tracks the package
// in transit for free (reuses the cron that already exists for US vendor
// orders).
//
// Optional `source_acquisition_id` links the shipment back to the Japan
// purchase the items came from — useful for cost-trace audits later.
// ============================================================================

// Same carriers as US PurchasedItems page so the Lark URL templates work
// unchanged. Japan Post + EMS + SF Express are the common Japan→US carriers.
const CARRIER_OPTIONS = [
  'Japan Post',
  'EMS',
  'Yamato',
  'DHL',
  'FedEx',
  'UPS',
  'USPS',
  'SF Express',
  'Other',
]

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

const productOptionLabel = (inv) => {
  const p = inv.product
  if (!p) return '(unknown)'
  const shortCode = p.short_code ? `${p.short_code} · ` : ''
  return `${shortCode}${p.brand || '?'} | ${extractLaunchName(p.name, p.category)} | ${p.category || p.type || '?'} | ${p.language || '?'}  ·  ${inv.quantity} in stock`
}

const productSearchText = (inv) => {
  const p = inv.product
  if (!p) return ''
  const parts = []
  if (p.short_code) parts.push(p.short_code)
  if (Array.isArray(p.aliases)) parts.push(...p.aliases)
  return parts.join(' ')
}

const renderProductOption = (inv) => {
  const p = inv.product
  const v = p?.variant
  return (
    <div className="flex items-center gap-2">
      {v && (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${variantChipClasses(v)} flex-shrink-0`}>
          {variantLabel(v)}
        </span>
      )}
      <span className="flex-1 truncate">{productOptionLabel(inv)}</span>
    </div>
  )
}

export default function JapanShipments() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [inventory, setInventory] = useState([])           // qty>0, for the create form picker
  const [fullInventory, setFullInventory] = useState([])   // all Japan rows, for the edit modal picker
  const [users, setUsers] = useState([])
  const [japanAcqs, setJapanAcqs] = useState([])           // source-acq linkage candidates
  const [shipments, setShipments] = useState([])           // in-transit list

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Edit/Undo state for the in-transit table. `editing` holds the row being
  // edited (null = modal closed); `rowBusy` is the id of a row mid-cancel so
  // we can disable its buttons.
  const [editing, setEditing] = useState(null)
  const [rowBusy, setRowBusy] = useState(null)

  // Header (per-shipment-batch): one tracking# typically covers multiple SKUs
  const [header, setHeader] = useState({
    shipped_date: new Date().toLocaleDateString('en-CA'),
    shipper_id: '',
    carrier: '',
    tracking_number: '',
    notes: '',
  })

  const [items, setItems] = useState([
    { id: 1, product_id: '', quantity: 1, unit_cost_jpy: '', source_acquisition_id: '' },
  ])

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      const [inv, usersData, acqs, ships] = await Promise.all([
        fetchJapanInventory(),
        fetchUsers(),
        fetchJapanAcquisitions(100),         // wide list for source picker
        fetchJapanToUSShipments({ limit: 30 }),
      ])
      setFullInventory(inv)
      setInventory(inv.filter(r => (r.quantity || 0) > 0))
      setUsers(usersData)
      setJapanAcqs(acqs)
      setShipments(ships)
    } catch (err) {
      console.error(err)
      addToast(err.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addItem = () => {
    const newId = Math.max(...items.map(i => i.id), 0) + 1
    setItems([...items, { id: newId, product_id: '', quantity: 1, unit_cost_jpy: '', source_acquisition_id: '' }])
  }
  const removeItem = (id) => {
    if (items.length <= 1) return
    setItems(items.filter(i => i.id !== id))
  }
  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i
      const next = { ...i, [field]: value }
      // When picking product, default unit cost to current Japan avg cost
      // basis (in JPY ≈ USD ÷ rate). This is a hint; user can override.
      if (field === 'product_id' && value) {
        const inv = inventory.find(r => r.product_id === value)
        if (inv) {
          const avgUsd = parseFloat(inv.avg_cost_basis || 0)
          // Convert USD avg back to JPY for display continuity
          const rate = convertToUSD(1, 'JPY') || 0.0067
          const avgJpy = rate > 0 ? avgUsd / rate : 0
          if (!next.unit_cost_jpy) {
            next.unit_cost_jpy = avgJpy ? avgJpy.toFixed(0) : ''
          }
        }
      }
      return next
    }))
  }

  // Auto-suggest source acquisitions for a given product (any non-deleted
  // Japan acquisition with the same product_id). Optional — user can ignore.
  const sourceOptionsFor = (product_id) => {
    if (!product_id) return []
    return japanAcqs
      .filter(a => a.product_id === product_id)
      .map(a => ({
        id: a.id,
        _label: `${a.date_purchased} · ${a.vendor?.name || 'no vendor'} · ${a.quantity_purchased}@¥${(a.cost / Math.max(1, a.quantity_purchased)).toFixed(0)}`,
      }))
  }

  const totalJpy = items.reduce((s, i) => {
    const q = parseInt(i.quantity) || 0
    const c = parseFloat(i.unit_cost_jpy) || 0
    return s + q * c
  }, 0)
  const totalUsd = convertToUSD(totalJpy, 'JPY')
  const totalUnits = items.reduce((s, i) => s + (parseInt(i.quantity) || 0), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const valid = items.filter(i => i.product_id && parseInt(i.quantity) > 0)
    if (valid.length === 0) {
      addToast('Add at least one item with product + quantity', 'error')
      return
    }
    if (!header.shipper_id) {
      addToast('Pick who shipped this', 'error')
      return
    }
    // Stock check
    for (const item of valid) {
      const inv = inventory.find(r => r.product_id === item.product_id)
      const q = parseInt(item.quantity) || 0
      if (!inv) { addToast('Product not in Japan stock', 'error'); return }
      if (q > (inv.quantity || 0)) {
        const name = extractLaunchName(inv.product?.name, inv.product?.category)
        addToast(`Not enough stock for ${name} — have ${inv.quantity}, shipping ${q}`, 'error')
        return
      }
    }

    setSubmitting(true)
    let ok = 0, fail = 0
    const larkItems = []
    let totalJpyAccum = 0
    let totalUnitsAccum = 0
    try {
      for (const item of valid) {
        try {
          await createJapanToUSShipment({
            product_id: item.product_id,
            quantity: parseInt(item.quantity),
            unit_cost_jpy: parseFloat(item.unit_cost_jpy) || 0,
            source_acquisition_id: item.source_acquisition_id || null,
            carrier: header.carrier || null,
            tracking_number: header.tracking_number || null,
            shipped_date: header.shipped_date,
            shipper_id: header.shipper_id,
            notes: header.notes || null,
          })
          ok++
          const inv = inventory.find(r => r.product_id === item.product_id)
          const p = inv?.product
          const launch = p ? extractLaunchName(p.name, p.category) : 'Unknown'
          const qty = parseInt(item.quantity)
          const unitJpy = parseFloat(item.unit_cost_jpy) || 0
          const lineJpy = qty * unitJpy
          larkItems.push({
            name: p ? `${p.brand} | ${launch} | ${p.category || p.type} | ${p.language}` : 'Unknown',
            quantity: qty,
            lineJpy,
            lineUsd: convertToUSD(lineJpy, 'JPY'),
          })
          totalJpyAccum += lineJpy
          totalUnitsAccum += qty
        } catch (err) {
          console.error('[JapanShipment] line failed:', err)
          fail++
        }
      }
      if (ok > 0) {
        addToast(
          `✓ Shipped ${ok} line${ok === 1 ? '' : 's'} → US (pending receive)${fail ? ` · ${fail} failed` : ''}`,
          ok === valid.length ? 'success' : 'info'
        )

        // Fire-and-forget Lark — jp_to_us_shipment type. Dual-target:
        // Japan group sees "we shipped this" + Acquisitions Squad sees
        // "incoming package, ready for Intake to Master". AfterShip cron
        // takes over for real-time tracking updates from here.
        try {
          const shipper = users.find(u => u.id === header.shipper_id)
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'jp_to_us_shipment',
              shipper: shipper?.name || 'Unknown',
              shippedDate: header.shipped_date,
              notes: header.notes || null,
              items: larkItems,
              totalUnits: totalUnitsAccum,
              totalJpy: totalJpyAccum,
              totalUsd: convertToUSD(totalJpyAccum, 'JPY'),
              carrier: header.carrier || null,
              trackingNumber: header.tracking_number?.trim() || null,
            }),
          }).catch(err => console.error('[lark-notify] jp_to_us_shipment failed:', err))
        } catch (err) {
          console.error('[lark-notify] jp_to_us_shipment payload build failed:', err)
        }

        // Reset items, keep header for batch-shipping same package
        setItems([{ id: 1, product_id: '', quantity: 1, unit_cost_jpy: '', source_acquisition_id: '' }])
        // Refresh
        const [inv, ships] = await Promise.all([
          fetchJapanInventory(),
          fetchJapanToUSShipments({ limit: 30 }),
        ])
        setInventory(inv.filter(r => (r.quantity || 0) > 0))
        setShipments(ships)
      } else {
        addToast('Failed to record shipment', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // A shipment is editable/cancelable from the Japan side only while it's
  // purely pending (US side hasn't received any). Mirror the server guard so
  // the UI doesn't even offer the action when it would be rejected.
  const isPending = (s) => s.status === 'Purchased' && (s.quantity_received || 0) === 0

  const handleCancelShipment = async (s) => {
    // One dialog doubles as confirm + reason capture: Cancel (null) aborts,
    // OK (even empty string) proceeds and the text becomes the Lark reason.
    const reason = window.prompt(
      `撤销这单发货?\n${extractLaunchName(s.product?.name, s.product?.category)} × ${s.quantity_purchased}\n\n日本库存会退回,美国群会收到「不要收货」提醒。\n可填撤销原因(可留空):`,
      ''
    )
    if (reason === null) return  // user hit Cancel

    setRowBusy(s.id)
    try {
      await undoJapanToUSShipment(s.id, { deletedById: user?.id || null, reason: reason || null })
      addToast('✓ 发货已撤销,日本库存已退回', 'success')

      // Tell the US team to stop expecting the package.
      try {
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'jp_shipment_canceled',
            canceledBy: user?.name || 'Unknown',
            productName: s.product
              ? `${s.product.brand} | ${extractLaunchName(s.product.name, s.product.category)} | ${s.product.category || s.product.type} | ${s.product.language}`
              : 'Unknown',
            quantity: s.quantity_purchased,
            carrier: s.carrier || null,
            trackingNumber: s.tracking_number || null,
            reason: reason || null,
            shippedDate: s.date_purchased || null,
          }),
        }).catch(err => console.error('[lark-notify] jp_shipment_canceled failed:', err))
      } catch (err) {
        console.error('[lark-notify] jp_shipment_canceled payload build failed:', err)
      }

      await load()
    } catch (err) {
      console.error('[JapanShipment] cancel failed:', err)
      addToast(err.message || 'Failed to cancel shipment', 'error')
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
          <Truck className="text-vault-gold" />
          🇯🇵→🇺🇸 日本往美国发货 / Japan→US Shipment
        </h1>
        <p className="text-gray-400 mt-1">
          Decrements <Link to="/jp/inventory" className="text-vault-gold hover:underline">Japan Warehouse</Link> and creates a pending acquisition on the US side — US team receives it via <strong className="text-white">Intake to Master</strong> when the package arrives. AfterShip cron auto-tracks the package.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card max-w-4xl space-y-4">
        {/* Header */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Shipped Date *</label>
            <input type="date" value={header.shipped_date}
              onChange={(e) => setHeader(h => ({ ...h, shipped_date: e.target.value }))}
              required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Shipper *</label>
            <select value={header.shipper_id}
              onChange={(e) => setHeader(h => ({ ...h, shipper_id: e.target.value }))}
              required>
              <option value="">Who shipped this?</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Carrier</label>
            <select value={header.carrier}
              onChange={(e) => setHeader(h => ({ ...h, carrier: e.target.value }))}>
              <option value="">— Select —</option>
              {CARRIER_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Tracking #</label>
          <input type="text" value={header.tracking_number}
            onChange={(e) => setHeader(h => ({ ...h, tracking_number: e.target.value }))}
            placeholder="e.g. EE123456789JP"
            spellCheck={false} />
          <p className="text-xs text-gray-500 mt-1">
            Used by AfterShip cron + Lark notifications. Same # is visible from US Intake to Master.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional)</label>
          <input type="text" value={header.notes}
            onChange={(e) => setHeader(h => ({ ...h, notes: e.target.value }))}
            placeholder="e.g. shipped with insurance, fragile" />
        </div>

        {/* Line items */}
        <div className="pt-4 border-t border-vault-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm">Contents</h3>
            <div className="text-xs text-gray-400">
              {totalUnits} unit{totalUnits === 1 ? '' : 's'} · Total cost basis:
              <span className="text-vault-gold font-semibold mx-1">¥{totalJpy.toLocaleString()}</span>
              ≈ <span className="text-green-400 font-semibold">${totalUsd.toFixed(2)} USD</span>
            </div>
          </div>

          <div className="space-y-2">
            {items.map(item => {
              const inv = inventory.find(r => r.product_id === item.product_id)
              const q = parseInt(item.quantity) || 0
              const overStock = inv && q > inv.quantity
              const sources = sourceOptionsFor(item.product_id)
              return (
                <div key={item.id} className="p-3 bg-vault-dark rounded-lg border border-vault-border space-y-2">
                  {/* items-start so the "{n} in stock" helper text under Qty doesn't
                      vertically shift the input relative to its neighbours. Trash
                      uses an invisible label as a vertical-align spacer. */}
                  <div className="grid grid-cols-12 gap-3 items-start">
                    <div className="col-span-12 md:col-span-6">
                      <label className="block text-xs text-gray-400 mb-1">Product (in Japan stock)</label>
                      <SearchableSelect
                        options={inventory}
                        value={item.product_id}
                        onChange={(val) => updateItem(item.id, 'product_id', val)}
                        getOptionValue={(inv) => inv.product_id}
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
                        onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                        min="1"
                        max={inv?.quantity || 999999}
                        className={`text-sm w-full ${overStock ? 'border-red-500' : ''}`}
                      />
                      {inv && <div className="text-[10px] text-gray-500 mt-1">{inv.quantity} in stock</div>}
                    </div>
                    <div className="col-span-4 md:col-span-3">
                      <label className="block text-xs text-gray-400 mb-1">Unit cost ¥ (basis)</label>
                      <input
                        type="number"
                        value={item.unit_cost_jpy}
                        onChange={(e) => updateItem(item.id, 'unit_cost_jpy', e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="auto from avg"
                        className="text-sm w-full"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-xs mb-1 invisible" aria-hidden="true">.</label>
                      <button type="button" onClick={() => removeItem(item.id)}
                        disabled={items.length <= 1}
                        className="w-full h-9 flex items-center justify-center text-gray-500 hover:text-red-400 rounded-md hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        title="Remove line">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {sources.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Source Japan purchase <span className="text-gray-600">(optional, for cost trace)</span>
                      </label>
                      <select
                        value={item.source_acquisition_id}
                        onChange={(e) => updateItem(item.id, 'source_acquisition_id', e.target.value)}
                        className="text-sm w-full"
                      >
                        <option value="">— no specific source —</option>
                        {sources.map(s => <option key={s.id} value={s.id}>{s._label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button type="button" onClick={addItem}
            className="w-full mt-3 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors text-sm">
            <Plus size={14} className="inline mr-2" /> Add another item to the package
          </button>
        </div>

        <div className="pt-4 border-t border-vault-border flex justify-end">
          <button type="submit" disabled={submitting} className="btn btn-primary flex items-center gap-2">
            <Save size={16} />
            {submitting ? 'Shipping…' : 'Record shipment (−Japan, +Pending US)'}
          </button>
        </div>
      </form>

      {/* In-transit shipments */}
      <div className="card max-w-4xl">
        <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
          <Package size={14} className="text-vault-gold" /> In-transit Japan→US shipments
        </h3>
        {shipments.length === 0 ? (
          <p className="text-gray-500 text-sm py-3">No active shipments. Items already received in the US won't show here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Shipped</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2">Carrier / Tracking</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Shipper</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map(s => (
                  <tr key={s.id} className="border-b border-vault-border/40">
                    <td className="py-1.5 text-gray-300">{s.date_purchased}</td>
                    <td className="py-1.5 text-white">
                      {extractLaunchName(s.product?.name, s.product?.category)}
                      <span className="text-gray-500 text-xs"> [{s.product?.language}]</span>
                    </td>
                    <td className="py-1.5 text-right text-white">
                      {s.quantity_received > 0
                        ? `${s.quantity_received}/${s.quantity_purchased}`
                        : s.quantity_purchased}
                    </td>
                    <td className="py-1.5 text-gray-300">
                      {s.carrier || '—'}
                      {s.tracking_number && (
                        <div className="text-xs text-gray-500 font-mono">{s.tracking_number}</div>
                      )}
                    </td>
                    <td className="py-1.5">
                      <span className={`text-xs ${s.status === 'Partially Received' ? 'text-yellow-300' : 'text-blue-300'}`}>
                        {s.status}
                      </span>
                      {s.tracking_status && (
                        <div className="text-[10px] text-gray-500">{s.tracking_status}</div>
                      )}
                    </td>
                    <td className="py-1.5 text-gray-400">{s.acquirer?.name || '—'}</td>
                    <td className="py-1.5 text-right">
                      {isPending(s) ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(s)}
                            disabled={rowBusy === s.id}
                            className="p-1.5 text-gray-400 hover:text-vault-gold rounded-md hover:bg-vault-gold/10 disabled:opacity-40"
                            title="修改这单发货"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelShipment(s)}
                            disabled={rowBusy === s.id}
                            className="p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/10 disabled:opacity-40"
                            title="撤销这单发货(退回日本库存)"
                          >
                            {rowBusy === s.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                          </button>
                        </div>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-gray-500"
                          title="美国端已开始收货,需在美国团队侧处理"
                        >
                          <Lock size={11} /> 已锁定
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-gray-500 mt-3 flex items-center gap-1">
              <ExternalLink size={11} /> US team marks these as received via Intake to Master once the package arrives.
            </div>
          </div>
        )}
      </div>

      {editing && (
        <EditShipmentModal
          shipment={editing}
          inventory={fullInventory}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ============================================================================
// Edit modal for a still-pending Japan→US shipment.
// ============================================================================
// Pre-fills the row's fields. Save routes through updateJapanToUSShipment,
// which re-points Japan stock for any product/qty change (stock-checked
// server-side) and rewrites the acquisition row. Edits are intentionally
// SILENT on Lark (unlike cancel) — the US team reads the live DB value when
// they receive, so a typo fix doesn't need to spam the group. Only fields
// likely to be mis-entered are exposed; shipper + source-link stay as-is.
function EditShipmentModal({ shipment, inventory, onClose, onSaved, addToast }) {
  const seedUnitJpy = shipment.quantity_purchased > 0
    ? Math.round((Number(shipment.cost) || 0) / shipment.quantity_purchased)
    : 0

  const [form, setForm] = useState({
    product_id: shipment.product_id || '',
    quantity: shipment.quantity_purchased || 1,
    unit_cost_jpy: seedUnitJpy ? String(seedUnitJpy) : '',
    carrier: shipment.carrier || '',
    tracking_number: shipment.tracking_number || '',
    shipped_date: shipment.date_purchased || new Date().toLocaleDateString('en-CA'),
    notes: shipment.notes || '',
  })
  const [saving, setSaving] = useState(false)

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const qty = parseInt(form.quantity) || 0
  const unit = parseFloat(form.unit_cost_jpy) || 0
  const lineJpy = qty * unit
  const lineUsd = convertToUSD(lineJpy, 'JPY')

  const handleSave = async () => {
    if (!form.product_id) { addToast('Pick a product', 'error'); return }
    if (qty <= 0) { addToast('Quantity must be at least 1', 'error'); return }
    setSaving(true)
    try {
      await updateJapanToUSShipment(shipment.id, {
        product_id: form.product_id,
        quantity: qty,
        unit_cost_jpy: unit,
        carrier: form.carrier || null,
        tracking_number: form.tracking_number || null,
        shipped_date: form.shipped_date,
        notes: form.notes || null,
      })
      addToast('✓ 发货已更新', 'success')
      await onSaved()
    } catch (err) {
      console.error('[JapanShipment] edit failed:', err)
      addToast(err.message || 'Failed to update shipment', 'error')
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
            <h3 className="font-semibold text-base">修改发货 / Edit shipment</h3>
          </div>
          <button onClick={onClose} disabled={saving} className="text-gray-500 hover:text-white p-1 -m-1">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Product (in Japan stock)</label>
            <SearchableSelect
              options={inventory}
              value={form.product_id}
              onChange={(val) => set('product_id', val)}
              getOptionValue={(inv) => inv.product_id}
              getOptionLabel={productOptionLabel}
              getOptionSearchText={productSearchText}
              renderOption={renderProductOption}
              placeholder="搜索 short code / 中文 / English..."
            />
            <p className="text-[11px] text-gray-500 mt-1">改产品/数量会自动调整日本库存(库存不足会拦下)。</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Qty</label>
              <input type="number" min="1" value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)} className="text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Unit cost ¥ (basis)</label>
              <input type="number" min="0" step="0.01" value={form.unit_cost_jpy}
                onChange={(e) => set('unit_cost_jpy', e.target.value)} className="text-sm w-full" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Carrier</label>
              <select value={form.carrier} onChange={(e) => set('carrier', e.target.value)} className="text-sm w-full">
                <option value="">— Select —</option>
                {CARRIER_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Shipped date</label>
              <input type="date" value={form.shipped_date}
                onChange={(e) => set('shipped_date', e.target.value)} className="text-sm w-full" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Tracking #</label>
            <input type="text" value={form.tracking_number} spellCheck={false}
              onChange={(e) => set('tracking_number', e.target.value)}
              placeholder="e.g. EE123456789JP" className="text-sm w-full" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <input type="text" value={form.notes}
              onChange={(e) => set('notes', e.target.value)} className="text-sm w-full" />
          </div>

          <div className="text-xs text-gray-400 pt-1">
            New cost basis: <span className="text-vault-gold font-semibold">¥{lineJpy.toLocaleString()}</span>
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
