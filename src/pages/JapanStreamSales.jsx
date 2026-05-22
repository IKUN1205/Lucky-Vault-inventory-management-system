import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchJapanInventory,
  fetchUsers,
  fetchJapanStreamSales,
  createJapanStreamSale,
  undoJapanStreamSale,
  convertToUSD,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../lib/AuthContext'
import { Tv2, Save, Plus, Trash2, Undo2 } from 'lucide-react'

// ============================================================================
// 日本直播售卖 — Japan livestream sale log
// ============================================================================
// One stream room = the whole Japan Warehouse, no reconciliation needed
// (per user directive). Streamers log what they sold + how much (JPY),
// inventory decrements on submit. Each row is one SKU per submission;
// multiple SKUs per stream = multiple rows.
//
// Sale rows are soft-deletable so an obvious typo can be reverted (refunds
// inventory at the same time — uses undoJapanStreamSale helper).
// ============================================================================

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

export default function JapanStreamSales() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [inventory, setInventory] = useState([])
  const [users, setUsers] = useState([])
  const [recentSales, setRecentSales] = useState([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Header: who streamed, when. Items: one row each.
  const [header, setHeader] = useState({
    sale_date: new Date().toLocaleDateString('en-CA'),
    streamer_id: '',
    notes: '',
  })

  const [items, setItems] = useState([
    { id: 1, product_id: '', quantity: 1, unit_price_jpy: '' },
  ])

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      const [inv, usersData, recent] = await Promise.all([
        fetchJapanInventory(),
        fetchUsers(),
        fetchJapanStreamSales(20),
      ])
      // Only show products with stock to sell from
      setInventory(inv.filter(r => (r.quantity || 0) > 0))
      setUsers(usersData)
      setRecentSales(recent)
    } catch (err) {
      console.error(err)
      addToast(err.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addItem = () => {
    const newId = Math.max(...items.map(i => i.id), 0) + 1
    setItems([...items, { id: newId, product_id: '', quantity: 1, unit_price_jpy: '' }])
  }
  const removeItem = (id) => {
    if (items.length <= 1) return
    setItems(items.filter(i => i.id !== id))
  }
  const updateItem = (id, field, value) => {
    setItems(items => items.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  // Totals
  const totalJpy = items.reduce((s, i) => {
    const q = parseInt(i.quantity) || 0
    const p = parseFloat(i.unit_price_jpy) || 0
    return s + q * p
  }, 0)
  const totalUsd = convertToUSD(totalJpy, 'JPY')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const valid = items.filter(i => i.product_id && parseInt(i.quantity) > 0)
    if (valid.length === 0) {
      addToast('Add at least one item with product + quantity', 'error')
      return
    }
    if (!header.streamer_id) {
      addToast('Pick the streamer', 'error')
      return
    }
    // Stock check
    for (const item of valid) {
      const inv = inventory.find(r => r.product_id === item.product_id)
      const q = parseInt(item.quantity) || 0
      if (!inv) {
        addToast(`Product not in Japan stock`, 'error'); return
      }
      if (q > (inv.quantity || 0)) {
        const name = extractLaunchName(inv.product?.name, inv.product?.category)
        addToast(`Not enough stock for ${name} — have ${inv.quantity}, selling ${q}`, 'error')
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
          await createJapanStreamSale({
            product_id: item.product_id,
            quantity: parseInt(item.quantity),
            unit_price_jpy: parseFloat(item.unit_price_jpy) || 0,
            sale_date: header.sale_date,
            streamer_id: header.streamer_id,
            recorded_by_id: user?.id || null,
            notes: header.notes || null,
          })
          ok++
          // Build Lark payload pieces from the form so one digest goes out
          // after the whole submit completes.
          const inv = inventory.find(r => r.product_id === item.product_id)
          const p = inv?.product
          const launch = p ? extractLaunchName(p.name, p.category) : 'Unknown'
          const qty = parseInt(item.quantity)
          const unitJpy = parseFloat(item.unit_price_jpy) || 0
          const lineJpy = qty * unitJpy
          larkItems.push({
            name: p ? `${p.brand} | ${launch} | ${p.category || p.type} | ${p.language}` : 'Unknown',
            quantity: qty,
            unitJpy,
            lineJpy,
            lineUsd: convertToUSD(lineJpy, 'JPY'),
          })
          totalJpyAccum += lineJpy
          totalUnitsAccum += qty
        } catch (err) {
          console.error('[JapanStreamSale] line failed:', err)
          fail++
        }
      }
      if (ok > 0) {
        addToast(`✓ ${ok} sale${ok === 1 ? '' : 's'} recorded${fail ? ` (${fail} failed)` : ''}`, ok === valid.length ? 'success' : 'info')

        // Fire-and-forget Lark — jp_stream_sale type, routes to Japan group
        // (LARK_WEBHOOK_JAPAN env var, falls back to main URL).
        try {
          const streamer = users.find(u => u.id === header.streamer_id)
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'jp_stream_sale',
              streamer: streamer?.name || 'Unknown',
              recordedBy: user?.name || null,
              saleDate: header.sale_date,
              notes: header.notes || null,
              items: larkItems,
              totalUnits: totalUnitsAccum,
              totalJpy: totalJpyAccum,
              totalUsd: convertToUSD(totalJpyAccum, 'JPY'),
            }),
          }).catch(err => console.error('[lark-notify] jp_stream_sale failed:', err))
        } catch (err) {
          console.error('[lark-notify] jp_stream_sale payload build failed:', err)
        }

        setItems([{ id: 1, product_id: '', quantity: 1, unit_price_jpy: '' }])
        const [inv, recent] = await Promise.all([
          fetchJapanInventory(),
          fetchJapanStreamSales(20),
        ])
        setInventory(inv.filter(r => (r.quantity || 0) > 0))
        setRecentSales(recent)
      } else {
        addToast('Failed to save sales', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleUndo = async (sale) => {
    if (!confirm(`Undo sale of ${sale.quantity} × ${sale.product?.name}? Inventory will be refunded.`)) return
    try {
      await undoJapanStreamSale(sale.id, user?.id || null)
      addToast('Sale undone — inventory refunded', 'success')
      const [inv, recent] = await Promise.all([
        fetchJapanInventory(),
        fetchJapanStreamSales(20),
      ])
      setInventory(inv.filter(r => (r.quantity || 0) > 0))
      setRecentSales(recent)
    } catch (err) {
      addToast(`Failed to undo: ${err.message}`, 'error')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner" /></div>

  return (
    <div className="fade-in space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Tv2 className="text-vault-gold" />
          🇯🇵 日本直播售卖 / Japan Stream Sales
        </h1>
        <p className="text-gray-400 mt-1">
          Record direct livestream sales. Inventory at <Link to="/jp/inventory" className="text-vault-gold hover:underline">Japan Warehouse</Link> decrements on save.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card max-w-4xl space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Sale Date *</label>
            <input type="date" name="sale_date" value={header.sale_date}
              onChange={(e) => setHeader(h => ({ ...h, sale_date: e.target.value }))}
              required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Streamer *</label>
            <select value={header.streamer_id}
              onChange={(e) => setHeader(h => ({ ...h, streamer_id: e.target.value }))}
              required>
              <option value="">Who was streaming?</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional)</label>
          <input type="text" value={header.notes}
            onChange={(e) => setHeader(h => ({ ...h, notes: e.target.value }))}
            placeholder="e.g. afternoon stream, special promo" />
        </div>

        <div className="pt-4 border-t border-vault-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm">Items sold</h3>
            <div className="text-xs text-gray-400">
              Total: <span className="text-vault-gold font-semibold">¥{totalJpy.toLocaleString()}</span>
              <span className="text-gray-500 mx-2">≈</span>
              <span className="text-green-400 font-semibold">${totalUsd.toFixed(2)} USD</span>
            </div>
          </div>

          <div className="space-y-2">
            {items.map(item => {
              const inv = inventory.find(r => r.product_id === item.product_id)
              const q = parseInt(item.quantity) || 0
              const p = parseFloat(item.unit_price_jpy) || 0
              const lineTotal = q * p
              const overStock = inv && q > inv.quantity
              return (
                <div key={item.id} className="p-3 bg-vault-dark rounded-lg border border-vault-border">
                  {/* items-start so each column lays out label + control top-aligned
                      consistently — the previous items-end was getting thrown off
                      by the helper text below Qty (it pushed the input up while
                      other columns aligned to the bottom, breaking horizontal
                      alignment). Trash uses an invisible label as a spacer. */}
                  <div className="grid grid-cols-12 gap-3 items-start">
                    <div className="col-span-12 md:col-span-5">
                      <label className="block text-xs text-gray-400 mb-1">Product (in Japan stock)</label>
                      <SearchableSelect
                        options={inventory}
                        value={item.product_id}
                        onChange={(val) => updateItem(item.id, 'product_id', val)}
                        getOptionValue={(inv) => inv.product_id}
                        getOptionLabel={productOptionLabel}
                        placeholder="Search what to sell..."
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
                      {inv && (
                        <div className="text-[10px] text-gray-500 mt-1">
                          {inv.quantity} in stock
                        </div>
                      )}
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Unit ¥</label>
                      <input
                        type="number"
                        value={item.unit_price_jpy}
                        onChange={(e) => updateItem(item.id, 'unit_price_jpy', e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="sale price"
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
                      {/* Invisible label keeps the trash button vertically aligned
                          with the inputs above (matches label height + mb-1). */}
                      <label className="block text-xs mb-1 invisible" aria-hidden="true">.</label>
                      <button type="button" onClick={() => removeItem(item.id)}
                        disabled={items.length <= 1}
                        className="w-full h-9 flex items-center justify-center text-gray-500 hover:text-red-400 rounded-md hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        title="Remove line">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <button type="button" onClick={addItem}
            className="w-full mt-3 py-2 border-2 border-dashed border-vault-border rounded-lg text-gray-400 hover:text-white hover:border-vault-gold transition-colors text-sm">
            <Plus size={14} className="inline mr-2" /> Add another item
          </button>
        </div>

        <div className="pt-4 border-t border-vault-border flex justify-end">
          <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-2">
            <Save size={16} />
            {submitting ? 'Recording…' : 'Record sale (−Japan stock)'}
          </button>
        </div>
      </form>

      {/* Recent sales */}
      <div className="card max-w-4xl">
        <h3 className="font-semibold text-white text-sm mb-3">Recent sales (last 20)</h3>
        {recentSales.length === 0 ? (
          <p className="text-gray-500 text-sm py-3">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Streamer</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Unit ¥</th>
                  <th className="pb-2 text-right">Revenue ¥</th>
                  <th className="pb-2 text-right">≈ USD</th>
                  <th className="pb-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map(s => (
                  <tr key={s.id} className="border-b border-vault-border/40">
                    <td className="py-1.5 text-gray-300">{s.sale_date}</td>
                    <td className="py-1.5 text-white">
                      {extractLaunchName(s.product?.name, s.product?.category)}
                      <span className="text-gray-500 text-xs"> [{s.product?.language}]</span>
                    </td>
                    <td className="py-1.5 text-gray-400">{s.streamer?.name || '—'}</td>
                    <td className="py-1.5 text-right text-white">{s.quantity}</td>
                    <td className="py-1.5 text-right text-gray-300">¥{(s.unit_price_jpy || 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right text-vault-gold">¥{(s.revenue_jpy || 0).toLocaleString()}</td>
                    <td className="py-1.5 text-right text-green-400">${(s.revenue_usd || 0).toFixed(2)}</td>
                    <td className="py-1.5 text-center">
                      <button onClick={() => handleUndo(s)}
                        className="p-1 text-gray-500 hover:text-red-300"
                        title="Undo (refund inventory + soft-delete)">
                        <Undo2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
