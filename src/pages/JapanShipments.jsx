import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchJapanInventory,
  fetchUsers,
  fetchJapanAcquisitions,
  fetchJapanToUSShipments,
  createJapanToUSShipment,
  convertToUSD,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../lib/AuthContext'
import { Truck, Save, Plus, Trash2, ExternalLink, Package } from 'lucide-react'

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
  return `${p.brand || '?'} | ${extractLaunchName(p.name, p.category)} | ${p.category || p.type || '?'} | ${p.language || '?'}  ·  ${inv.quantity} in stock`
}

export default function JapanShipments() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [inventory, setInventory] = useState([])
  const [users, setUsers] = useState([])
  const [japanAcqs, setJapanAcqs] = useState([])           // source-acq linkage candidates
  const [shipments, setShipments] = useState([])           // in-transit list

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

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
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 md:col-span-6">
                      <label className="block text-xs text-gray-400 mb-1">Product (in Japan stock)</label>
                      <SearchableSelect
                        options={inventory}
                        value={item.product_id}
                        onChange={(val) => updateItem(item.id, 'product_id', val)}
                        getOptionValue={(inv) => inv.product_id}
                        getOptionLabel={productOptionLabel}
                        placeholder="Search what to ship..."
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
                        className={`text-sm ${overStock ? 'border-red-500' : ''}`}
                      />
                      {inv && <div className="text-[10px] text-gray-500 mt-0.5">{inv.quantity} in stock</div>}
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
                        className="text-sm"
                      />
                    </div>
                    <div className="col-span-1 text-right">
                      <button type="button" onClick={() => removeItem(item.id)}
                        disabled={items.length <= 1}
                        className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-30">
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
          <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-2">
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
    </div>
  )
}
