import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { Banknote, Plus, X } from 'lucide-react'

// We Owe (IOU) — 挂账 ledger (boss directive 2026-07-24, the Luna $527/$500 case).
//
// Data model: an open IOU IS a storefront_payments row whose method is
// 'IOU (we owe)'. No extra table. The parent buy transaction carries the
// counterparty in its notes ('IOU: <who> — <memo>').
//   - Record a buy you didn't fully pay: either pick 'IOU (we owe)' as the
//     payment method right in Storefront Sales, or add one here (creates a
//     buy transaction dated when the debt started).
//   - Recording a payment here INSERTS a real payment row (Cash/Zelle/...)
//     on the original transaction, timestamped NOW — so a cash payout hits
//     the cash-drawer expectation at the moment the money leaves the drawer
//     (cash-count windows storefront_payments.created_at). Partial payments
//     shrink the IOU row; full payment deletes it.

const IOU_METHOD_NAME = 'IOU (we owe)'

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const todayStr = () => new Date().toLocaleDateString('en-CA')

function daysOpen(dateStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T12:00:00`)
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000))
}

// 'IOU: Luna — buyout balance' → { who: 'Luna', memo: 'buyout balance' }.
// Separator must be a SPACED dash so hyphenated names ('Anne-Marie') survive.
function parseWho(notes) {
  const m = /IOU:\s*(.+?)(?:\s[—–-]\s(.*))?$/s.exec(notes || '')
  if (m) return { who: m[1].trim(), memo: (m[2] || '').trim() }
  return { who: null, memo: (notes || '').trim() }
}

export default function WeOwe() {
  const { toasts, addToast, removeToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [iouMethodIds, setIouMethodIds] = useState([])
  const [methods, setMethods] = useState([])
  const [ious, setIous] = useState([])

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ who: '', amount: '', date: todayStr(), memo: '' })

  // inline "record payment" state, keyed by the IOU payment-row id
  const [payingId, setPayingId] = useState(null)
  const [payMethodId, setPayMethodId] = useState('')
  const [payAmount, setPayAmount] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let { data: pms, error: pmErr } = await supabase
        .from('payment_methods').select('id, name, active').order('name')
      if (pmErr) throw pmErr
      // duplicate-tolerant bootstrap: two first-loads may both insert the
      // method — treat every same-named row as the IOU method, newest last.
      let iouRows = (pms || []).filter(m => m.name === IOU_METHOD_NAME)
      if (iouRows.length === 0) {
        const { error: insErr } = await supabase
          .from('payment_methods').insert({ name: IOU_METHOD_NAME, active: true })
        if (insErr) throw insErr
        const { data: again, error: reErr } = await supabase
          .from('payment_methods').select('id, name, active').order('name')
        if (reErr) throw reErr
        pms = again
        iouRows = (pms || []).filter(m => m.name === IOU_METHOD_NAME)
      }
      const iouIds = iouRows.map(m => m.id)
      setIouMethodIds(iouIds)
      setMethods((pms || []).filter(m => m.active !== false && !iouIds.includes(m.id)))

      const { data: rows, error: payErr } = await supabase
        .from('storefront_payments')
        .select('id, transaction_id, amount_usd, created_at')
        .in('payment_method_id', iouIds)
        .order('created_at', { ascending: true })
      if (payErr) throw payErr

      const txIds = [...new Set((rows || []).map(r => r.transaction_id).filter(Boolean))]
      const parents = new Map()
      for (let i = 0; i < txIds.length; i += 200) {
        const batch = txIds.slice(i, i + 200)
        const [sales, singles, slabs] = await Promise.all([
          supabase.from('storefront_sales')
            .select('transaction_id, notes, date, deleted, payment_method_id').in('transaction_id', batch),
          supabase.from('singles')
            .select('transaction_id, sale_notes, sale_date, deleted').in('transaction_id', batch),
          supabase.from('slabs')
            .select('transaction_id, notes, sale_date, deleted').in('transaction_id', batch),
        ])
        if (sales.error) throw sales.error
        if (singles.error) throw singles.error
        if (slabs.error) throw slabs.error
        for (const r of sales.data || []) {
          if (r.deleted === true) continue
          if (!parents.has(r.transaction_id)) {
            parents.set(r.transaction_id, { notes: r.notes, date: r.date, pmId: r.payment_method_id })
          }
        }
        for (const r of [...(singles.data || []), ...(slabs.data || [])]) {
          if (r.deleted === true) continue
          if (!parents.has(r.transaction_id)) {
            parents.set(r.transaction_id, { notes: r.sale_notes || r.notes, date: r.sale_date, pmId: null })
          }
        }
      }
      // an IOU whose parent rows are all deleted is a voided transaction — hide it
      const open = (rows || [])
        .filter(r => parents.has(r.transaction_id))
        .map(r => {
          const p = parents.get(r.transaction_id)
          const { who, memo } = parseWho(p.notes)
          return { ...r, notes: p.notes, date: p.date, parentPmId: p.pmId, who, memo }
        })
      setIous(open)
    } catch (err) {
      console.error('[we-owe] load failed:', err)
      addToast('Failed to load IOUs — check console', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { load() }, [load])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (submitting) return
    const amt = parseFloat(addForm.amount)
    if (!addForm.who.trim() || !Number.isFinite(amt) || amt <= 0 || !addForm.date) {
      addToast('Who, a positive amount and a date are required', 'error')
      return
    }
    const iouMethodId = iouMethodIds[0]
    if (!iouMethodId) { addToast('IOU method not ready — reload the page', 'error'); return }
    setSubmitting(true)
    try {
      const txId = crypto.randomUUID()
      const notes = `IOU: ${addForm.who.trim()}${addForm.memo.trim() ? ` — ${addForm.memo.trim()}` : ''}`
      const { error: saleErr } = await supabase.from('storefront_sales').insert({
        date: addForm.date,
        sale_type: 'Itemized',
        quantity: 1,
        sale_price: amt,
        notes,
        payment_method_id: iouMethodId,
        transaction_id: txId,
        transaction_type: 'buy',
        net_cash_usd: -amt,
        deleted: false,
      })
      if (saleErr) throw saleErr
      const { error: payErr } = await supabase.from('storefront_payments').insert({
        transaction_id: txId, payment_method_id: iouMethodId, amount_usd: amt,
      })
      if (payErr) {
        // compensate: don't leave a payable transaction with no open IOU row
        await supabase.from('storefront_sales').delete().eq('transaction_id', txId)
        throw payErr
      }
      addToast(`IOU recorded — we owe ${addForm.who.trim()} ${money(amt)}`, 'success')
      setAddForm({ who: '', amount: '', date: todayStr(), memo: '' })
      setShowAdd(false)
      load()
    } catch (err) {
      console.error('[we-owe] add failed:', err)
      addToast('Failed to record IOU — check console', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const startPay = (iou) => {
    setPayingId(iou.id)
    setPayMethodId('')
    setPayAmount(String(iou.amount_usd))
  }

  const handlePay = async (iou) => {
    if (submitting) return
    const amt = parseFloat(payAmount)
    const owed = Number(iou.amount_usd) || 0
    if (!payMethodId) { addToast('Pick how it was paid', 'error'); return }
    if (!Number.isFinite(amt) || amt <= 0 || amt > owed + 0.005) {
      addToast(`Amount must be between $0 and ${money(owed)}`, 'error')
      return
    }
    setSubmitting(true)
    try {
      const methodName = methods.find(m => m.id === payMethodId)?.name || '?'
      // real money movement, timestamped now — cash-count picks this up
      const { data: payRow, error: payErr } = await supabase.from('storefront_payments').insert({
        transaction_id: iou.transaction_id, payment_method_id: payMethodId, amount_usd: amt,
      }).select().single()
      if (payErr) throw payErr

      const remaining = +(owed - amt).toFixed(2)
      const closeErr = remaining <= 0.005
        ? (await supabase.from('storefront_payments').delete().eq('id', iou.id)).error
        : (await supabase.from('storefront_payments').update({ amount_usd: remaining }).eq('id', iou.id)).error
      if (closeErr) {
        // compensate: pull the real payment back out so a retry can't double-count cash
        if (payRow?.id) await supabase.from('storefront_payments').delete().eq('id', payRow.id)
        throw closeErr
      }

      // annotate the parent transaction + retire the IOU method flag when cleared.
      // The ledger (payments rows) is already consistent — note failures are
      // logged but don't fail the settle.
      const stamp = remaining <= 0.005
        ? ` · IOU settled ${todayStr()} via ${methodName} (${money(amt)})`
        : ` · paid ${money(amt)} ${todayStr()} via ${methodName}, ${money(remaining)} still owed`
      const { data: parentRows, error: parentErr } = await supabase.from('storefront_sales')
        .select('id, notes, payment_method_id').eq('transaction_id', iou.transaction_id)
      if (parentErr) console.error('[we-owe] note fetch failed:', parentErr)
      for (const row of parentRows || []) {
        const upd = { notes: `${row.notes || ''}${stamp}` }
        if (remaining <= 0.005 && iouMethodIds.includes(row.payment_method_id)) upd.payment_method_id = payMethodId
        const { error: noteErr } = await supabase.from('storefront_sales').update(upd).eq('id', row.id)
        if (noteErr) console.error('[we-owe] note update failed:', noteErr)
      }

      addToast(
        remaining <= 0.005
          ? `Settled — paid ${iou.who || 'IOU'} ${money(amt)} via ${methodName}`
          : `Paid ${money(amt)} — ${money(remaining)} still owed to ${iou.who || '?'}`,
        'success',
      )
      setPayingId(null)
      load()
    } catch (err) {
      console.error('[we-owe] payment failed:', err)
      addToast('Failed to record payment — check console', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const totalOwed = ious.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0)
  const oldest = ious.reduce((mx, r) => Math.max(mx, daysOpen(r.date) || 0), 0)

  return (
    <div className="max-w-4xl mx-auto">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Banknote className="text-vault-gold" size={28} />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">We Owe (IOU)</h1>
            <p className="text-sm text-gray-400">
              Money the store still owes people. Record the payment HERE when it happens —
              a cash payout updates the drawer expectation automatically.
            </p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(s => !s)}>
          {showAdd ? <X size={18} /> : <Plus size={18} />} {showAdd ? 'Cancel' : 'Add IOU'}
        </button>
      </div>

      <div className="flex gap-4 mb-4 text-sm">
        <span className="badge badge-warning">Open: {ious.length}</span>
        <span className="badge badge-danger">Total owed: {money(totalOwed)}</span>
        {oldest > 0 && <span className="badge badge-info">Oldest: {oldest}d</span>}
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card mb-6">
          <h2 className="font-display text-lg font-semibold text-white mb-4">New IOU (we owe someone)</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Who *</label>
              <input type="text" value={addForm.who} placeholder="Luna"
                onChange={e => setAddForm(f => ({ ...f, who: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Amount (USD) *</label>
              <input type="number" min="0.01" step="0.01" value={addForm.amount} placeholder="0.00"
                onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Since (date) *</label>
              <input type="date" value={addForm.date}
                onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">What for</label>
              <input type="text" value={addForm.memo} placeholder="buyout balance"
                onChange={e => setAddForm(f => ({ ...f, memo: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Records a buy transaction on that date with payment method '{IOU_METHOD_NAME}' —
            no cash moves until you record the payment.
          </p>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <Banknote size={18} /> Save IOU
          </button>
        </form>
      )}

      <div className="card">
        {loading ? (
          <p className="text-gray-400 py-6 text-center">Loading…</p>
        ) : ious.length === 0 ? (
          <p className="text-gray-400 py-6 text-center">Nothing owed — all clear 🎉</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-vault-border">
                <th className="py-2 pr-3">Since</th>
                <th className="py-2 pr-3">Who / what</th>
                <th className="py-2 pr-3 text-right">Owed</th>
                <th className="py-2 pr-3 text-right">Days</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ious.map(iou => (
                <React.Fragment key={iou.id}>
                  <tr className="border-b border-vault-border/50">
                    <td className="py-2 pr-3 whitespace-nowrap">{iou.date || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className="text-white font-medium">{iou.who || '(unnamed)'}</span>
                      {iou.memo && <span className="text-gray-400"> — {iou.memo}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-vault-gold whitespace-nowrap">
                      {money(iou.amount_usd)}
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-400">{daysOpen(iou.date) ?? '—'}</td>
                    <td className="py-2 text-right">
                      {payingId === iou.id ? (
                        <button className="btn btn-secondary p-2" onClick={() => setPayingId(null)}><X size={16} /></button>
                      ) : (
                        <button className="btn btn-primary" onClick={() => startPay(iou)}>Record payment</button>
                      )}
                    </td>
                  </tr>
                  {payingId === iou.id && (
                    <tr className="border-b border-vault-border/50 bg-vault-dark/40">
                      <td colSpan={5} className="py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Paid via *</label>
                            <select value={payMethodId} onChange={e => setPayMethodId(e.target.value)}>
                              <option value="">Select…</option>
                              {methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Amount (partial ok)</label>
                            <input type="number" min="0.01" step="0.01" max={iou.amount_usd}
                              value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                          </div>
                          <button className="btn btn-primary" disabled={submitting} onClick={() => handlePay(iou)}>
                            Confirm {money(parseFloat(payAmount) || 0)}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
