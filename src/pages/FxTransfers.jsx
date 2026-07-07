import React, { useState, useEffect } from 'react'
import {
  fetchFxTransfers,
  backfillFxTransfer,
  createFxTransfer,
  undoFxTransfer,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { useAuth } from '../lib/AuthContext'
import { ArrowRightLeft, Save, RotateCcw, Loader2, Check, Plus } from 'lucide-react'

// ============================================================================
// 外汇划转 — fx_transfers CNY/USD cross-border ledger
// ============================================================================
// Shared table with lv-finance. The automation AUTO-INSERTS the USD leg from US
// bank feeds; the China team's job here is to BACKFILL the RMB actually received
// against each USD outflow (primary flow). A secondary manual form covers
// transfers the automation missed. Rate is always CNY per USD = cny / usd.
// Backed by fx_transfers in sql/cn_jp_finance.sql.
// ============================================================================

const fmtRate = (r) => (r == null ? '—' : Number(r).toFixed(4))
const fmtMoney = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export default function FxTransfers() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [pending, setPending] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [rowBusy, setRowBusy] = useState(null)

  // Per-row RMB entry for the backfill queue, keyed by transfer id.
  const [rmbInput, setRmbInput] = useState({})

  // Secondary manual-entry form.
  const [showManual, setShowManual] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toLocaleDateString('en-CA'),
    usd_amount: '',
    cny_amount: '',
    counterparty: '',
    bank_txn_ref: '',
    purpose: '',
    note: '',
  })

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true)
      const [pend, rec] = await Promise.all([
        fetchFxTransfers({ pendingBackfill: true, limit: 100 }),
        fetchFxTransfers({ limit: 50 }),
      ])
      setPending(pend)
      setRecent(rec)
    } catch (err) {
      console.error(err)
      addToast(err.message || 'Failed to load fx transfers', 'error')
    } finally {
      setLoading(false)
    }
  }

  const setField = (field, value) => setForm(f => ({ ...f, [field]: value }))

  // --- Primary: backfill the RMB leg on an auto-inserted USD row ---
  const handleBackfill = async (row) => {
    const raw = rmbInput[row.id]
    const cny = parseFloat(raw)
    if (!Number.isFinite(cny) || cny <= 0) { addToast('填入收到的人民币金额', 'error'); return }
    setRowBusy(row.id)
    try {
      await backfillFxTransfer(row.id, { cny_amount: cny })
      addToast(`✓ 已回填 ¥${cny.toLocaleString()}`, 'success')
      setRmbInput(m => { const n = { ...m }; delete n[row.id]; return n })
      await load()
    } catch (err) {
      console.error('[FxTransfers] backfill failed:', err)
      addToast(err.message || 'Failed to backfill', 'error')
    } finally {
      setRowBusy(null)
    }
  }

  // --- Secondary: manual full-row insert for missed transfers ---
  const usdNum = form.usd_amount === '' ? null : parseFloat(form.usd_amount)
  const cnyNum = form.cny_amount === '' ? null : parseFloat(form.cny_amount)
  const manualRate = (cnyNum != null && usdNum != null && usdNum !== 0) ? cnyNum / usdNum : null

  const handleManualSubmit = async (e) => {
    e.preventDefault()
    if (usdNum == null && cnyNum == null) { addToast('至少填一个金额 (USD 或 CNY)', 'error'); return }
    setSubmitting(true)
    try {
      await createFxTransfer({
        date: form.date,
        usd_amount: form.usd_amount,
        cny_amount: form.cny_amount,
        counterparty: form.counterparty || null,
        bank_txn_ref: form.bank_txn_ref || null,
        purpose: form.purpose || null,
        note: form.note || null,
        created_by_id: user?.id || null,
      })
      addToast('✓ 已补录一笔划转', 'success')
      setForm(f => ({ ...f, usd_amount: '', cny_amount: '', bank_txn_ref: '', purpose: '', note: '' }))
      await load()
    } catch (err) {
      console.error('[FxTransfers] manual create failed:', err)
      const msg = err.message || 'Failed to record transfer'
      addToast(/duplicate key|unique constraint/i.test(msg) ? '这笔银行流水已存在 (bank_txn_ref 重复)' : msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUndo = async (t) => {
    const reason = window.prompt(
      `撤销这笔划转?\n${t.counterparty || '—'} · USD ${fmtMoney(t.usd_amount)} / CNY ${fmtMoney(t.cny_amount)}\n\n可填撤销原因(可留空):`,
      ''
    )
    if (reason === null) return
    setRowBusy(t.id)
    try {
      await undoFxTransfer(t.id, { deletedById: user?.id || null, reason: reason || null })
      addToast('✓ 划转已撤销', 'success')
      await load()
    } catch (err) {
      console.error('[FxTransfers] undo failed:', err)
      addToast(err.message || 'Failed to undo transfer', 'error')
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
          <ArrowRightLeft className="text-vault-gold" />
          🇨🇳 外汇划转 / FX Transfers (CNY ⇄ USD)
        </h1>
        <p className="text-gray-400 mt-1">
          美国出账由系统自动导入;这里<strong>回填每笔实际收到的人民币</strong>。汇率 = 人民币 ÷ 美元 (CNY per USD),自动计算。
        </p>
      </div>

      {/* Primary: RMB backfill queue */}
      <div className="card max-w-4xl">
        <h3 className="font-semibold text-white text-sm mb-3">
          待回填 RMB / Pending backfill
          {pending.length > 0 && <span className="ml-2 text-xs text-vault-gold">({pending.length})</span>}
        </h3>
        {pending.length === 0 ? (
          <p className="text-gray-500 text-sm py-3">没有待回填的划转 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Counterparty</th>
                  <th className="pb-2">Purpose</th>
                  <th className="pb-2 text-right">USD out</th>
                  <th className="pb-2 text-right">收到 RMB</th>
                  <th className="pb-2 text-right">Rate</th>
                  <th className="pb-2 text-right">Save</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(row => {
                  const usd = row.usd_amount != null ? Number(row.usd_amount) : null
                  const raw = rmbInput[row.id]
                  const cny = raw === undefined || raw === '' ? null : parseFloat(raw)
                  const preview = (cny != null && usd != null && usd !== 0) ? cny / usd : null
                  return (
                    <tr key={row.id} className="border-b border-vault-border/40">
                      <td className="py-1.5 text-gray-300">{row.date}</td>
                      <td className="py-1.5 text-gray-300">{row.counterparty || '—'}</td>
                      <td className="py-1.5 text-gray-400">{row.purpose || '—'}</td>
                      <td className="py-1.5 text-right text-blue-300">${fmtMoney(row.usd_amount)}</td>
                      <td className="py-1.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={raw ?? ''}
                          onChange={(e) => setRmbInput(m => ({ ...m, [row.id]: e.target.value }))}
                          placeholder="¥"
                          className="text-sm w-28 text-right"
                        />
                      </td>
                      <td className="py-1.5 text-right text-gray-400">{fmtRate(preview)}</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleBackfill(row)}
                          disabled={rowBusy === row.id}
                          className="p-1.5 text-gray-400 hover:text-green-400 rounded-md hover:bg-green-500/10 disabled:opacity-40"
                          title="回填人民币"
                        >
                          {rowBusy === row.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Secondary: manual entry for missed transfers */}
      <div className="card max-w-4xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm">手动补录 / Manual entry</h3>
          <button type="button" onClick={() => setShowManual(s => !s)} className="text-xs text-vault-gold hover:underline flex items-center gap-1">
            <Plus size={12} /> {showManual ? '收起' : '补录一笔自动化漏掉的划转'}
          </button>
        </div>
        {showManual && (
          <form onSubmit={handleManualSubmit} className="mt-4 space-y-4">
            <p className="text-[11px] text-gray-500">自动化通常已导入美国出账。只在系统漏掉某笔时手动补录。至少填一个金额;两个都填则自动算汇率。</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
                <input type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} required className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">USD out (optional)</label>
                <input type="number" min="0" step="0.01" value={form.usd_amount} onChange={(e) => setField('usd_amount', e.target.value)} placeholder="$" className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">CNY received (optional)</label>
                <input type="number" min="0" step="0.01" value={form.cny_amount} onChange={(e) => setField('cny_amount', e.target.value)} placeholder="¥" className="w-full" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Counterparty (optional)</label>
                <input type="text" value={form.counterparty} onChange={(e) => setField('counterparty', e.target.value)} placeholder="e.g. XIYIMEI / SHAODAN" className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Bank txn ref (optional)</label>
                <input type="text" value={form.bank_txn_ref} onChange={(e) => setField('bank_txn_ref', e.target.value)} placeholder="US bank fingerprint" className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Purpose (optional)</label>
                <input type="text" value={form.purpose} onChange={(e) => setField('purpose', e.target.value)} placeholder="货款 / 运费 / …" className="w-full" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Note (optional)</label>
              <input type="text" value={form.note} onChange={(e) => setField('note', e.target.value)} placeholder="备注" className="w-full" />
            </div>
            <div className="pt-2 flex items-center justify-between">
              <div className="text-sm text-gray-400">
                Rate (CNY per USD): <span className="text-vault-gold font-semibold">{fmtRate(manualRate)}</span>
              </div>
              <button type="submit" disabled={submitting} className="btn btn-primary flex items-center gap-2">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {submitting ? 'Saving…' : '补录'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Recent (both legs) */}
      <div className="card max-w-4xl">
        <h3 className="font-semibold text-white text-sm mb-3">Recent transfers (last 50)</h3>
        {recent.length === 0 ? (
          <p className="text-gray-500 text-sm py-3">No fx transfers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Counterparty</th>
                  <th className="pb-2 text-right">USD</th>
                  <th className="pb-2 text-right">CNY</th>
                  <th className="pb-2 text-right">Rate</th>
                  <th className="pb-2">Purpose</th>
                  <th className="pb-2">By</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(t => (
                  <tr key={t.id} className="border-b border-vault-border/40">
                    <td className="py-1.5 text-gray-300">{t.date}</td>
                    <td className="py-1.5 text-gray-300">{t.counterparty || '—'}</td>
                    <td className="py-1.5 text-right text-blue-300">{t.usd_amount == null ? '—' : `$${fmtMoney(t.usd_amount)}`}</td>
                    <td className="py-1.5 text-right text-vault-gold">
                      {t.cny_amount == null
                        ? <span className="text-amber-400/80 text-xs">待回填</span>
                        : `¥${fmtMoney(t.cny_amount)}`}
                    </td>
                    <td className="py-1.5 text-right text-gray-400">{fmtRate(t.rate)}</td>
                    <td className="py-1.5 text-gray-400">{t.purpose || '—'}</td>
                    <td className="py-1.5 text-gray-400">{t.created_by?.name || '—'}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleUndo(t)}
                        disabled={rowBusy === t.id}
                        className="p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/10 disabled:opacity-40"
                        title="撤销这笔划转"
                      >
                        {rowBusy === t.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
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
