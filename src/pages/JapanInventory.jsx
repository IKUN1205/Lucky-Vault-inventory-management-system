import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchJapanInventory, supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { Package, Search, RefreshCw, ShoppingCart, ArrowRight, Edit2, Save, X } from 'lucide-react'
import { variantLabel, variantChipClasses, VARIANT_ORDER, VARIANT_META } from '../lib/japanVariants'

// ============================================================================
// Japan Inventory — read-only view of what's at Japan Warehouse right now
// ============================================================================
// Mirrors ViewInventory's style but locks the location filter to Japan
// Warehouse. Inflow/outflow happen on Japan Acquisitions / Japan Stream Sales
// / Japan→US Shipments pages — this page is purely "where do we stand?"
// ============================================================================

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

export default function JapanInventory() {
  const { toasts, addToast, removeToast } = useToast()

  // Edit (name / qty / cost) is open to anyone with /jp/inventory access.
  // Rationale: the Japan team needs to fix typos + cost basis as part of
  // daily work; the previous admin-only gate (isAdmin via Team Management
  // access) blocked legitimate users like hua. Page-level access is the
  // right line — if you can view Japan stock, you can curate it.
  const canEdit = true

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [langFilter, setLangFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [variantFilter, setVariantFilter] = useState('')

  // Inline edit state. editingId = the inventory row currently in edit mode.
  // editForm holds the buffered values. Admin-only — the Actions column
  // hides for non-admins so the button doesn't tease them.
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', quantity: '', avg_cost_basis: '' })
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => { load() }, [])

  const startEdit = (r) => {
    setEditingId(r.id)
    setEditForm({
      name: r.product?.name || '',
      quantity: String(r.quantity ?? 0),
      avg_cost_basis: String(r.avg_cost_basis ?? 0),
    })
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({ name: '', quantity: '', avg_cost_basis: '' })
  }

  const saveEdit = async (r) => {
    try {
      setEditSaving(true)
      const nextName = (editForm.name || '').trim()
      const nextQty = parseInt(editForm.quantity, 10)
      const nextCost = parseFloat(editForm.avg_cost_basis)
      if (!nextName) { addToast('Product name cannot be empty', 'error'); return }
      if (!Number.isFinite(nextQty)) { addToast('Quantity must be a number', 'error'); return }
      if (!Number.isFinite(nextCost) || nextCost < 0) { addToast('Cost must be a non-negative number', 'error'); return }

      // Two-table update: products.name (if changed) + inventory.quantity +
      // inventory.avg_cost_basis. Skip the products update when name didn't
      // change so we don't bump updated_at unnecessarily and so non-admin
      // users (if we ever loosen the gate) can't pivot via this path.
      if (nextName !== (r.product?.name || '')) {
        const { error: pErr } = await supabase
          .from('products')
          .update({ name: nextName })
          .eq('id', r.product_id)
        if (pErr) throw pErr
      }
      const { error: iErr } = await supabase
        .from('inventory')
        .update({
          quantity: nextQty,
          avg_cost_basis: nextCost,
          last_updated: new Date().toISOString(),
        })
        .eq('id', r.id)
      if (iErr) throw iErr

      addToast('✓ Saved', 'success')
      setEditingId(null)
      setEditForm({ name: '', quantity: '', avg_cost_basis: '' })
      load()
    } catch (err) {
      console.error('[JapanInventory] saveEdit failed:', err)
      addToast(`Save failed: ${err.message || err}`, 'error')
    } finally {
      setEditSaving(false)
    }
  }

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const data = await fetchJapanInventory()
      // Sort by brand then product name for a stable read
      data.sort((a, b) => {
        const ab = (a.product?.brand || '').localeCompare(b.product?.brand || '')
        if (ab !== 0) return ab
        return (a.product?.name || '').localeCompare(b.product?.name || '')
      })
      setRows(data)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to load Japan inventory')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let out = rows
    if (brandFilter) out = out.filter(r => r.product?.brand === brandFilter)
    if (langFilter) out = out.filter(r => r.product?.language === langFilter)
    if (typeFilter) out = out.filter(r => r.product?.type === typeFilter)
    if (variantFilter) out = out.filter(r => r.product?.variant === variantFilter)
    if (search.trim()) {
      // Match against name + short_code + aliases — so typing "M2a" or
      // "海贼王" or "OP15" finds the right row even if it's not in the name.
      const q = search.trim().toLowerCase()
      out = out.filter(r => {
        const p = r.product
        if (!p) return false
        const hay = [
          p.name, p.short_code,
          ...(Array.isArray(p.aliases) ? p.aliases : []),
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    }
    return out
  }, [rows, search, brandFilter, langFilter, typeFilter, variantFilter])

  const summary = useMemo(() => ({
    totalSkus: filtered.length,
    totalUnits: filtered.reduce((s, r) => s + (r.quantity || 0), 0),
    totalValueUsd: filtered.reduce((s, r) =>
      s + (r.quantity || 0) * parseFloat(r.avg_cost_basis || 0), 0),
  }), [filtered])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner" /></div>

  return (
    <div className="fade-in space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <Package className="text-vault-gold" />
            🇯🇵 Japan Inventory
          </h1>
          <p className="text-gray-400 mt-1">
            Everything currently at <strong className="text-white">Japan Warehouse</strong>. Inflow via
            <Link to="/jp/acquisitions" className="text-vault-gold mx-1 hover:underline">日本进货</Link>,
            outflow via
            <Link to="/jp/stream-sales" className="text-vault-gold mx-1 hover:underline">日本直播售卖</Link> or
            <Link to="/jp/shipments" className="text-vault-gold mx-1 hover:underline">日本→美国发货</Link>.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 bg-vault-surface border border-vault-border hover:border-vault-gold text-sm text-gray-300 rounded-lg flex items-center gap-2"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
          {error}
          {error.includes('run scripts/add_japan_inventory_system.sql') && (
            <div className="mt-1 text-xs text-red-200/70">
              The Japan migration hasn't been applied to this database yet. Open Supabase SQL Editor and run that file once.
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="SKUs in stock" value={summary.totalSkus} />
        <StatCard label="Total units" value={summary.totalUnits} colorClass="text-vault-gold" />
        <StatCard label="Approx value (USD)"
          value={`$${summary.totalValueUsd.toFixed(2)}`}
          subtext="weighted-avg cost basis × qty"
          colorClass="text-green-400" />
      </div>

      {/* Filters — search matches against name + short_code + aliases, so
          typing "M2a" / "海贼王" / "OP15" / English name all work. */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Search (name / short code / 中文 / aliases)</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="e.g. M2a, 海贼王, OP15..."
                className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Brand</label>
            <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm">
              <option value="">All brands</option>
              <option value="Pokemon">Pokemon</option>
              <option value="One Piece">One Piece</option>
              <option value="Yu-Gi-Oh">Yu-Gi-Oh</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Language</label>
            <select value={langFilter} onChange={e => setLangFilter(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm">
              <option value="">All languages</option>
              <option value="JP">JP</option>
              <option value="EN">EN</option>
              <option value="CN">CN</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Variant 变体</label>
            <select value={variantFilter} onChange={e => setVariantFilter(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm">
              <option value="">All variants</option>
              {VARIANT_ORDER.map(v => (
                <option key={v} value={v}>{VARIANT_META[v]?.zh} ({VARIANT_META[v]?.en})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 text-sm">
          {filtered.length} SKU{filtered.length === 1 ? '' : 's'}
        </h3>
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingCart className="mx-auto text-gray-600 mb-4" size={48} />
            <p className="text-gray-400">
              {rows.length === 0 ? 'Nothing in Japan Warehouse yet.' : 'No SKUs match these filters.'}
            </p>
            {rows.length === 0 && (
              <Link to="/jp/acquisitions"
                className="mt-3 inline-flex items-center gap-2 px-3 py-2 bg-vault-gold/20 border border-vault-gold/60 text-vault-gold rounded-lg text-sm hover:bg-vault-gold/30">
                Record first 日本进货 <ArrowRight size={14} />
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Code</th>
                  <th className="pb-2">Brand</th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">变体</th>
                  <th className="pb-2">Lang</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Avg cost (USD)</th>
                  <th className="pb-2 text-right">Value (USD)</th>
                  {canEdit && <th className="pb-2 text-right pr-2">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const avg = parseFloat(r.avg_cost_basis || 0)
                  const value = (r.quantity || 0) * avg
                  const v = r.product?.variant
                  const isEditing = editingId === r.id
                  return (
                    <tr key={r.id} className={`border-b border-vault-border/50 ${isEditing ? 'bg-vault-gold/5' : 'hover:bg-vault-darker/30'}`}>
                      <td className="py-2 text-gray-300 font-mono text-xs align-middle">{r.product?.short_code || '—'}</td>
                      <td className="py-2 text-vault-gold align-middle">{r.product?.brand || '—'}</td>
                      <td className="py-2 align-middle">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="text-sm w-full max-w-xs"
                            placeholder="Product name"
                          />
                        ) : (
                          <span className="text-white">
                            {extractLaunchName(r.product?.name, r.product?.category) || r.product?.name || '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 align-middle">
                        {v ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${variantChipClasses(v)}`}>
                            {variantLabel(v)}
                          </span>
                        ) : <span className="text-gray-600 text-xs">—</span>}
                      </td>
                      <td className="py-2 text-blue-300 align-middle">{r.product?.language || '—'}</td>
                      <td className="py-2 text-right align-middle">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.quantity}
                            onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                            className="w-20 text-right text-sm"
                            min="0"
                          />
                        ) : (
                          <span className="text-white font-semibold">{(r.quantity || 0).toLocaleString()}</span>
                        )}
                      </td>
                      <td className="py-2 text-right align-middle">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.avg_cost_basis}
                            onChange={(e) => setEditForm(f => ({ ...f, avg_cost_basis: e.target.value }))}
                            className="w-24 text-right text-sm"
                            min="0"
                            step="0.01"
                          />
                        ) : (
                          <span className="text-gray-300">${avg.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-green-400 align-middle">${value.toFixed(2)}</td>
                      {canEdit && (
                        <td className="py-2 pr-2 text-right align-middle">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => saveEdit(r)}
                                disabled={editSaving}
                                className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50"
                                title="Save"
                              >
                                <Save size={16} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={editSaving}
                                className="p-1 text-gray-400 hover:text-white disabled:opacity-50"
                                title="Cancel"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(r)}
                              className="p-1 text-gray-500 hover:text-vault-gold"
                              title="Edit name / qty / cost"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}

function StatCard({ label, value, subtext, colorClass = 'text-white' }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}
