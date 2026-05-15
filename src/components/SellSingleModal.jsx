import { useState } from 'react'
import { DollarSign, X, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { markSingleAsSold } from '../lib/supabase'

// ============================================================================
// SellSingleModal — record a single's sale (out-flow)
// ============================================================================
// Opens from the Sell button on SinglesInventory. Reads the card identity
// from the passed `single` prop, takes sale price + channel + date + fees +
// buyer fields, calls markSingleAsSold(), and on success closes the modal
// and notifies the parent so the list reloads.
//
// v1.5 limitation: only handles selling the WHOLE row. Raw stacks with
// quantity > 1 are sold as a single transaction. Splitting (sell 2 of 5)
// will need a follow-up where we either decrement quantity + insert a new
// status=sold row, OR adopt a separate singles_sales table.
// ============================================================================

const CHANNEL_OPTIONS = [
  { value: 'ebay',       label: 'eBay' },
  { value: 'whatnot',    label: 'Whatnot' },
  { value: 'comc',       label: 'COMC' },
  { value: 'tcgplayer',  label: 'TCGplayer' },
  { value: 'in_person',  label: 'In Person' },
  { value: 'trade_out',  label: 'Trade Out' },
  { value: 'other',      label: 'Other' }
]

export default function SellSingleModal({ single, currentUserId, onCancel, onSold, addToast }) {
  const [form, setForm] = useState({
    sale_price_usd: '',
    sale_channel: 'ebay',
    sale_date: new Date().toISOString().slice(0, 10),
    sale_fees_usd: '',
    buyer_name: '',
    sale_notes: ''
  })
  const [submitting, setSubmitting] = useState(false)

  if (!single) return null

  const qty = single.form === 'raw' ? (single.quantity || 1) : 1
  const costUsd = single.acquisition_cost_usd != null ? Number(single.acquisition_cost_usd) : null
  const priceNum = parseFloat(form.sale_price_usd) || 0
  const feesNum = parseFloat(form.sale_fees_usd) || 0
  const netUsd = priceNum - feesNum
  const realizedPl = costUsd != null ? (netUsd - costUsd * qty) : null

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.sale_price_usd || isNaN(parseFloat(form.sale_price_usd))) {
      addToast?.('Sale price is required', 'error')
      return
    }
    if (!form.sale_date) {
      addToast?.('Sale date is required', 'error')
      return
    }
    if (!form.sale_channel) {
      addToast?.('Sale channel is required', 'error')
      return
    }
    setSubmitting(true)
    try {
      const updated = await markSingleAsSold(single.id, {
        sale_price_usd: parseFloat(form.sale_price_usd),
        sale_channel: form.sale_channel,
        sale_date: form.sale_date,
        sale_fees_usd: form.sale_fees_usd ? parseFloat(form.sale_fees_usd) : null,
        buyer_name: form.buyer_name || null,
        sale_notes: form.sale_notes || null,
        sold_by_id: currentUserId || null
      })
      addToast?.('Sale recorded — card moved to sold status', 'success')
      onSold?.(updated)
    } catch (err) {
      console.error('[markSingleAsSold] failed:', err)
      addToast?.(`Sale failed: ${err.message || 'unknown error'}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Card identity strings for the read-only summary at top of the modal
  const cardLine = `${single.card_name} ${single.card_number || ''}`.trim()
  const setLine = single.set?.name
    ? `${single.set.brand} ${single.set.language} — ${single.set.name}${single.set.code ? ` [${single.set.code}]` : ''}`
    : ''
  const formLine = single.form === 'graded'
    ? `Graded · ${single.grading_company || '?'} ${single.grade || '?'}${single.cert_number ? ` · #${single.cert_number}` : ''}`
    : `Raw · ${single.condition || '?'} · qty ${qty}`

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={submitting ? undefined : onCancel}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-vault-surface border border-green-500/40 rounded-xl max-w-lg w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-green-300">
            <DollarSign size={18} />
            <h3 className="font-semibold text-base">Record sale</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-gray-500 hover:text-white p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Identity (read-only) */}
        <div className="bg-vault-darker/60 border border-vault-border rounded-lg p-3 text-xs space-y-1 mb-3">
          <div className="text-white font-medium">{cardLine}</div>
          {setLine && <div className="text-gray-400">{setLine}</div>}
          <div className="text-gray-400">{formLine}</div>
          {costUsd != null && (
            <div className="text-gray-400">
              Cost basis: <span className="text-vault-gold">${(costUsd * qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              {qty > 1 ? ` (${qty}× $${costUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })})` : ''}
            </div>
          )}
        </div>

        {/* Sale fields */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-1">Sale price (USD) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              name="sale_price_usd"
              value={form.sale_price_usd}
              onChange={handleChange}
              required
              disabled={submitting}
              placeholder="e.g. 250.00"
              autoFocus
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-1">Channel *</label>
            <select
              name="sale_channel"
              value={form.sale_channel}
              onChange={handleChange}
              disabled={submitting}
              required
            >
              {CHANNEL_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-1">Sale date *</label>
            <input
              type="date"
              name="sale_date"
              value={form.sale_date}
              onChange={handleChange}
              required
              disabled={submitting}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-1">
              Fees (USD)
              <span className="text-gray-600 ml-1">eBay ~13%, Whatnot ~8%</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              name="sale_fees_usd"
              value={form.sale_fees_usd}
              onChange={handleChange}
              disabled={submitting}
              placeholder="e.g. 25.00"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Buyer (optional)</label>
            <input
              type="text"
              name="buyer_name"
              value={form.buyer_name}
              onChange={handleChange}
              disabled={submitting}
              placeholder="username / name / handle"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
            <textarea
              name="sale_notes"
              value={form.sale_notes}
              onChange={handleChange}
              rows={2}
              disabled={submitting}
              placeholder="condition issues, return notes, shipping details..."
              className="resize-none"
            />
          </div>
        </div>

        {/* Realized P/L preview — only when we have both cost and a price */}
        {realizedPl != null && priceNum > 0 && (
          <div className={`rounded-lg p-3 text-sm mb-3 border ${
            realizedPl >= 0
              ? 'bg-green-500/10 border-green-500/40 text-green-300'
              : 'bg-red-500/10 border-red-500/40 text-red-300'
          }`}>
            <div className="flex items-center gap-2 font-medium">
              {realizedPl >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              Realized P/L: {realizedPl >= 0 ? '+' : '-'}${Math.abs(realizedPl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              Net (after fees): ${netUsd.toFixed(2)}
              {costUsd != null && ` · Cost: $${(costUsd * qty).toFixed(2)}`}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !form.sale_price_usd}
            className="px-3 py-2 text-sm bg-green-500/20 border border-green-500/60 text-green-200 hover:bg-green-500/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
            Record sale
          </button>
        </div>
      </form>
    </div>
  )
}
