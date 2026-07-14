import { useState, useEffect, useMemo } from 'react'
import { fetchLocations, fetchAuditProducts, fetchUsers } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { ClipboardCheck, Save, Loader2, Search } from 'lucide-react'

// ============================================================================
// Inventory Audit — Master Inventory SEALED (Gary 2026-07-14, Mon/Wed/Fri)
// ============================================================================
// A BLIND count: staff enter what they physically count; the system quantity is
// never shown. It ONLY records the numbers — the /api/inventory-audit endpoint
// appends them to the SEALED AUDIT sheet tab and NEVER changes inventory. A
// Master Inventory variance is shrinkage / misplacement / mis-entry to be
// reviewed by a human, not auto-applied like a stream-room sale.
const AUDIT_LOCATION = 'Master Inventory'

export default function InventoryAudit() {
  const { toasts, addToast, removeToast } = useToast()
  const [locationId, setLocationId] = useState(null)
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})     // product_id -> string
  const [users, setUsers] = useState([])
  const [countedBy, setCountedBy] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const [locs, us] = await Promise.all([fetchLocations('Physical'), fetchUsers()])
      const master = (locs || []).find(l => l.name === AUDIT_LOCATION)
      if (!master) { addToast(`Location "${AUDIT_LOCATION}" not found`, 'error'); return }
      setLocationId(master.id)
      setUsers(us || [])
      const inv = await fetchAuditProducts(master.id)   // blind: no quantity returned
      setItems((inv || []).map(r => ({
        product_id: r.product_id,
        name: r.product?.name || '(unnamed)',
        brand: r.product?.brand || '',
        type: r.product?.type || '',
        language: r.product?.language || '',
      })))
    } catch (e) {
      console.error('[inventory-audit] load failed', e)
      addToast('Failed to load inventory / 加载失败', 'error')
    } finally { setLoading(false) }
  }

  const setCount = (pid, val) => setCounts(c => ({ ...c, [pid]: val.replace(/[^0-9]/g, '') }))
  const filled = useMemo(
    () => Object.values(counts).filter(v => v !== '' && v != null).length, [counts])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(it => `${it.name} ${it.brand} ${it.language}`.toLowerCase().includes(q))
  }, [items, search])

  async function submit() {
    if (!countedBy) { addToast('Select who counted / 选择盘点人', 'error'); return }
    const payload = items
      .filter(it => counts[it.product_id] !== '' && counts[it.product_id] != null)
      .map(it => ({ product_id: it.product_id, counted: Number(counts[it.product_id]) }))
    if (payload.length === 0) { addToast('Enter at least one count / 至少填一个数', 'error'); return }
    setSubmitting(true); setResult(null)
    try {
      const r = await fetch('/api/inventory-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId, counted_by_name: countedBy, items: payload }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'submit failed')
      setResult(j)
      addToast(j.message || 'Recorded / 已记录', 'success')
      setCounts({})
    } catch (e) {
      addToast(`Failed / 失败: ${e.message}`, 'error')
    } finally { setSubmitting(false) }
  }

  if (loading) {
    return <div className="p-8 text-gray-400 flex items-center gap-2">
      <Loader2 className="animate-spin" size={18} /> Loading…</div>
  }

  return (
    <div className="max-w-3xl mx-auto">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <ClipboardCheck className="text-vault-gold" size={24} /> 库存盘点 · Inventory Audit
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Master Inventory · 密封货 Sealed · 盲数(不显示系统数量)/ blind count — records numbers only, never changes stock.
        </p>
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">盘点人 / Counted by *</label>
          <select value={countedBy} onChange={e => setCountedBy(e.target.value)}
            className="bg-vault-dark border border-vault-border rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Select… / 选择</option>
            {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-gray-400 mb-1">搜索 / Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-2 top-2.5 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="product name…"
              className="w-full bg-vault-dark border border-vault-border rounded-lg pl-8 pr-3 py-2 text-sm text-white" />
          </div>
        </div>
        <div className="text-sm text-gray-400">
          {filled}/{items.length} counted
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-vault-border">
          {shown.map(it => (
            <div key={it.product_id} className="flex items-center gap-3 px-4 py-2 hover:bg-vault-dark/40">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{it.name}</div>
                <div className="text-xs text-gray-500">{it.brand} · {it.type} · {it.language}</div>
              </div>
              <input
                inputMode="numeric" value={counts[it.product_id] ?? ''}
                onChange={e => setCount(it.product_id, e.target.value)}
                placeholder="qty"
                className={`w-20 text-right bg-vault-dark border rounded-lg px-2 py-1.5 text-sm text-white
                  ${counts[it.product_id] ? 'border-vault-gold/60' : 'border-vault-border'}`} />
            </div>
          ))}
          {shown.length === 0 && <div className="px-4 py-6 text-gray-500 text-sm">No products match.</div>}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} disabled={submitting || filled === 0 || !locationId}
          className="btn btn-primary flex items-center gap-2 disabled:opacity-50">
          {submitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          记录盘点 / Record audit ({filled})
        </button>
        {result && (
          <span className="text-sm text-gray-300">
            ✓ recorded {result.recorded}{result.flagged ? ` · ${result.flagged} variance` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
