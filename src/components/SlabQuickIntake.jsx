import { useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { createSlab, notifySlabsLark, convertToUSD } from '../lib/supabase'

// ============================================================================
// SlabQuickIntake — finance-flow quick capture of a graded slab at buy time.
// ============================================================================
// Shared by the China (中国进货) and Japan (日本进货) acquisition pages. At the
// point of purchase the buyer often only knows three things: the cert #, how
// much they paid, and in what currency. Grading company / market price / the
// full item name get filled in later back home — so every row lands with
// price_check='pending' as a to-do flag, and the local-currency amount is
// preserved (acquisition_cost_local + acquisition_currency) alongside the USD
// snapshot the rest of the app reports on.
//
// Requires the columns added in sql/cn_jp_finance.sql (price_check,
// acquisition_cost_local, acquisition_currency). Gated behind the same
// cnJpFinance flag as its host pages.
// ============================================================================

const GRADING_COMPANIES = ['PSA', 'CGC', 'BGS', 'SGC', 'Other']
const CURRENCIES = ['RMB', 'JPY', 'USD']
const CURRENCY_SYMBOL = { RMB: '¥', JPY: '¥', USD: '$' }

export default function SlabQuickIntake({
  defaultCurrency = 'RMB',
  currentUserId,
  currentUserName,
  addToast,
  onCreated,
}) {
  const today = new Date().toLocaleDateString('en-CA')
  const [form, setForm] = useState({
    cert_number: '',
    amount: '',
    currency: defaultCurrency,
    grading_company: 'Other',
    item_name: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const amountNum = parseFloat(form.amount) || 0
  const usd = convertToUSD(amountNum, form.currency)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const cert = form.cert_number.trim()
    if (!cert) return addToast?.('Cert # is required', 'error')

    setSubmitting(true)
    try {
      const localAmount = form.amount === '' ? null : amountNum
      const payload = {
        cert_number: cert,
        // grading_company / item_name are NOT NULL in the slabs table; the
        // quick path defaults them so the buyer only has to enter cert+amount.
        grading_company: form.grading_company || 'Other',
        item_name: form.item_name.trim() || `待定价 Pending pricing (cert ${cert})`,
        status: 'in_inventory',
        date_acquired: today,
        acquirer_id: currentUserId || null,
        acquisition_cost_local: localAmount,
        acquisition_currency: form.currency,
        acquisition_cost_usd: localAmount == null ? null : usd,
        price_check: 'pending',
        notes: null,
      }
      const created = await createSlab(payload)
      // Fire-and-forget Lark (same shape the Scan intake modal uses).
      notifySlabsLark({
        type: 'slab_intake',
        cert_number: created.cert_number,
        grading_company: created.grading_company,
        item_name: created.item_name,
        cost_usd: created.acquisition_cost_usd,
        operator_name: currentUserName,
      })
      addToast?.(`Slab #${created.cert_number} 已入库 (待定价 / pending price)`, 'success')
      // Keep currency + grading sticky for the next scan; clear the row.
      setForm(f => ({ ...f, cert_number: '', amount: '', item_name: '' }))
      onCreated?.(created)
    } catch (err) {
      const msg = err.message || 'unknown error'
      if (/duplicate key|unique constraint/i.test(msg)) {
        addToast?.(`Cert # ${form.cert_number.trim()} already in inventory`, 'error')
      } else {
        addToast?.(`Save failed: ${msg}`, 'error')
      }
      console.error('[SlabQuickIntake] save failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card max-w-4xl space-y-3">
      <div className="flex items-center gap-2 text-vault-gold">
        <ShieldCheck size={16} />
        <h3 className="font-semibold text-sm">评级卡快速入库 / Slab quick intake</h3>
        <span className="text-[11px] text-gray-500 ml-auto">价格稍后核对 · price_check = pending</span>
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-12 md:col-span-4">
          <label className="block text-xs text-gray-400 mb-1">Cert # *</label>
          <input
            type="text"
            value={form.cert_number}
            onChange={(e) => set('cert_number', e.target.value)}
            placeholder="扫描 / 输入评级编号"
            className="text-sm w-full font-mono"
            required
          />
        </div>
        <div className="col-span-5 md:col-span-3">
          <label className="block text-xs text-gray-400 mb-1">金额 / Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder={CURRENCY_SYMBOL[form.currency] || ''}
            className="text-sm w-full"
          />
        </div>
        <div className="col-span-4 md:col-span-2">
          <label className="block text-xs text-gray-400 mb-1">币种 / Cur.</label>
          <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className="text-sm w-full">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-3 md:col-span-3">
          <label className="block text-xs text-gray-400 mb-1">≈ USD</label>
          <div className="text-sm text-green-400 font-semibold py-2 px-3 bg-vault-darker/40 rounded-md border border-vault-border/40 text-right truncate">
            ${usd.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-6 md:col-span-3">
          <label className="block text-xs text-gray-400 mb-1">评级公司 (可选)</label>
          <select value={form.grading_company} onChange={(e) => set('grading_company', e.target.value)} className="text-sm w-full">
            {GRADING_COMPANIES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="col-span-6 md:col-span-7">
          <label className="block text-xs text-gray-400 mb-1">品名 (可选，之后可补)</label>
          <input
            type="text"
            value={form.item_name}
            onChange={(e) => set('item_name', e.target.value)}
            placeholder="留空则记为「待定价」"
            className="text-sm w-full"
          />
        </div>
        <div className="col-span-12 md:col-span-2">
          <label className="block text-xs mb-1 invisible" aria-hidden="true">.</label>
          <button
            type="submit"
            disabled={submitting || !form.cert_number.trim()}
            className="btn btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            入库
          </button>
        </div>
      </div>
    </form>
  )
}
