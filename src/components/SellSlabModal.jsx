import { useState, useMemo } from 'react'
import { DollarSign, X, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { markSlabAsSold, notifySlabsLark } from '../lib/supabase'

// ============================================================================
// SellSlabModal — record a slab's sale
// ============================================================================
// Same UX as SellSingleModal but operates on the `slabs` table. Card
// identity panel at top shows cert# + grading + item_name + cost (if
// known). User fills sale price + channel + date + optional fees +
// optional buyer. On save: status flips to 'sold', sold_at + sale_*
// fields populated.
// ============================================================================

// Channel a slab sale is credited to. Room/platform values MATCH the
// platform_sales.channel vocabulary + CHANNEL_TO_STREAM_ROOM keys in
// supabase.js, so a stream-room slab sale carries the room signal instead of
// masquerading as a Front Store walk-in. `in_person` is (and must stay) the
// Front Store register channel — it is the ONLY value the Storefront daily
// summary counts (see fetchStorefrontDailySummary). Anything else is excluded
// from Storefront, so picking the right room here keeps Packheads/RocketsHQ/
// auction slab sales out of the storefront bucket.
const CHANNEL_OPTIONS = [
  { value: 'in_person',        label: 'Front Store (In Person)' },
  { value: 'PackHeadsTCG',     label: 'TikTok — Packheads' },
  { value: 'RocketsHQ',        label: 'TikTok — RocketsHQ' },
  { value: 'Whatnot',          label: 'Whatnot (auction)' },
  { value: 'PokeAuctionHouse', label: 'PokeAuctionHouse (auction)' },
  { value: 'SlabbiePatty',     label: 'eBay — SlabbiePatty' },
  { value: 'LuckyVaultUS',     label: 'eBay — LuckyVaultUS' },
  { value: 'ebay',             label: 'eBay (other)' },
  { value: 'tcgplayer',        label: 'TCGplayer' },
  { value: 'comc',             label: 'COMC' },
  { value: 'trade_out',        label: 'Trade Out' },
  { value: 'other',            label: 'Other' },
]

export default function SellSlabModal({ slab, currentUserId, currentUserName, onCancel, onSold, addToast }) {
  const [form, setForm] = useState({
    sale_price_usd: '',
    sale_channel: 'ebay',
    sale_date: new Date().toISOString().slice(0, 10),
    sale_fees_usd: '',
    buyer_name: '',
    sale_notes: ''
  })
  const [submitting, setSubmitting] = useState(false)

  if (!slab) return null

  const costUsd = slab.acquisition_cost_usd != null ? Number(slab.acquisition_cost_usd) : null
  const priceNum = parseFloat(form.sale_price_usd) || 0
  const feesNum = parseFloat(form.sale_fees_usd) || 0
  const netUsd = priceNum - feesNum
  const realizedPl = costUsd != null ? netUsd - costUsd : null

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.sale_price_usd) return addToast?.('Sale price is required', 'error')
    if (!form.sale_date) return addToast?.('Sale date is required', 'error')
    if (!form.sale_channel) return addToast?.('Sale channel is required', 'error')

    setSubmitting(true)
    try {
      const updated = await markSlabAsSold(slab.id, {
        sale_price_usd: parseFloat(form.sale_price_usd),
        sale_channel: form.sale_channel,
        sale_date: form.sale_date,
        sale_fees_usd: form.sale_fees_usd ? parseFloat(form.sale_fees_usd) : null,
        buyer_name: form.buyer_name || null,
        sale_notes: form.sale_notes || null,
        sold_by_id: currentUserId || null
      })
      // Fire-and-forget Lark notification
      notifySlabsLark({
        type: 'slab_sold',
        cert_number: updated.cert_number,
        grading_company: updated.grading_company,
        item_name: updated.item_name,
        sale_price_usd: updated.sale_price_usd,
        sale_channel: updated.sale_channel,
        buyer_name: updated.buyer_name,
        operator_name: currentUserName,
      })
      addToast?.('Sale recorded', 'success')
      onSold?.(updated)
    } catch (err) {
      console.error('[markSlabAsSold] failed:', err)
      addToast?.(`Sale failed: ${err.message || 'unknown'}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

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
            <h3 className="font-semibold text-base">Record slab sale</h3>
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

        {/* Card identity */}
        <div className="bg-vault-darker/60 border border-vault-border rounded-lg p-3 text-xs space-y-1 mb-3">
          <div className="text-white font-medium">{slab.item_name}</div>
          <div className="text-gray-400 font-mono">
            {slab.grading_company} · #{slab.cert_number}
          </div>
          {costUsd != null && (
            <div className="text-gray-400">
              Cost basis: <span className="text-vault-gold">${costUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          )}
          {slab.status === 'listed' && slab.listed_at && (
            <div className="text-gray-400">
              Was listed on {new Date(slab.listed_at).toLocaleDateString('en-CA')}
              {slab.list_price_usd != null && ` for $${Number(slab.list_price_usd).toLocaleString()}`}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Sale price (USD) *</label>
            <input
              type="number" step="0.01" min="0"
              name="sale_price_usd" value={form.sale_price_usd}
              onChange={handleChange} required disabled={submitting}
              placeholder="e.g. 500.00" autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Channel *</label>
            <select
              name="sale_channel" value={form.sale_channel}
              onChange={handleChange} disabled={submitting} required
            >
              {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Sale date *</label>
            <input
              type="date" name="sale_date" value={form.sale_date}
              onChange={handleChange} required disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Fees (USD) <span className="text-gray-600">~13% eBay, ~8% Whatnot</span>
            </label>
            <input
              type="number" step="0.01" min="0"
              name="sale_fees_usd" value={form.sale_fees_usd}
              onChange={handleChange} disabled={submitting}
              placeholder="e.g. 65.00"
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Buyer (optional)</label>
          <input
            type="text" name="buyer_name" value={form.buyer_name}
            onChange={handleChange} disabled={submitting}
            placeholder="username / name / handle"
          />
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
          <textarea
            name="sale_notes" value={form.sale_notes} onChange={handleChange}
            rows={2} disabled={submitting}
            placeholder="shipping notes, condition notes..."
            className="resize-none"
          />
        </div>

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
              Net (after fees): ${netUsd.toFixed(2)} · Cost: ${costUsd?.toFixed(2)}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button" onClick={onCancel} disabled={submitting}
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
