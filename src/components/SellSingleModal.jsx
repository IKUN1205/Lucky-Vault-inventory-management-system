import { useState, useEffect } from 'react'
import { DollarSign, X, Loader2, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react'
import { sellSingleQtySplit, notifySinglesLark } from '../lib/supabase'
import { SINGLES_CHANNEL_OPTIONS, tcgProductUrl } from '../lib/saleChannels'

// ============================================================================
// SellSingleModal — record a single's sale (out-flow)
// ============================================================================
// Opens from the Sell button on SinglesInventory. Reads the card identity
// from the passed `single` prop, takes quantity + sale price + channel +
// date + fees + buyer fields, calls sellSingleQtySplit(), and on success
// closes the modal and notifies the parent so the list reloads.
//
// 2026-07-29: raw stacks (quantity > 1) can now be sold PARTIALLY — a
// quantity selector appears and sellSingleQtySplit() splits the row
// (source qty drops, sold clone inserted), same semantics as the
// storefront POS. Selling the full stack still just flips the row.
// ============================================================================

export default function SellSingleModal({ single, currentUserId, currentUserName, onCancel, onSold, addToast }) {
  const [form, setForm] = useState({
    sale_price_usd: '',
    // No default channel (Gary 2026-07-29): the cashier must consciously pick
    // the room/account — a wrong prefilled channel poisons per-room reporting.
    sale_channel: '',
    sale_date: new Date().toISOString().slice(0, 10),
    sale_fees_usd: '',
    buyer_name: '',
    sale_notes: ''
  })
  // How many of the stack this sale covers. Defaults to 1 (the store's
  // 1-by-1 case); the "All" button jumps to the whole stack.
  const [sellQty, setSellQty] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  // Recent-sales text from the boss's singles sheet (col D "Prices") — lives
  // only on the sheet, fetched via /api/singles-price-detail at open. Null
  // until loaded / when the card isn't on the sheet; fails silently (the
  // modal must never block on it).
  const [sheetDetail, setSheetDetail] = useState(null)

  useEffect(() => {
    setSheetDetail(null)
    const tcgId = single?.tcg_id
    if (!tcgId) return
    let alive = true
    fetch(`/api/singles-price-detail?tcg_id=${encodeURIComponent(tcgId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.found) setSheetDetail(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [single?.id, single?.tcg_id])

  if (!single) return null

  const qty = single.form === 'raw' ? (single.quantity || 1) : 1
  const sellQtyNum = Math.min(qty, Math.max(1, parseInt(sellQty) || 1))
  const costUsd = single.acquisition_cost_usd != null ? Number(single.acquisition_cost_usd) : null
  const priceNum = parseFloat(form.sale_price_usd) || 0
  const feesNum = parseFloat(form.sale_fees_usd) || 0
  const netUsd = priceNum - feesNum
  // Sale price is the TOTAL for the units being sold (unchanged semantics —
  // it was previously always the whole stack), so P/L costs sellQtyNum units.
  const realizedPl = costUsd != null ? (netUsd - costUsd * sellQtyNum) : null

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
      // Cashier types the TOTAL for the units sold (natural at the counter);
      // the singles table stores sale_price_usd PER UNIT (the convention the
      // POS split clones + daily summary already use — Codex review 7/29).
      const totalNum = parseFloat(form.sale_price_usd)
      // Full precision (no cent-rounding): $10/3 stored as 3.3333… keeps
      // total×qty ≈ $10.00; rounding to 3.33 would leak a cent per unit.
      const perUnit = totalNum / sellQtyNum
      const updated = await sellSingleQtySplit(single.id, sellQtyNum, {
        sale_price_usd: perUnit,
        sale_channel: form.sale_channel,
        sale_date: form.sale_date,
        sale_fees_usd: form.sale_fees_usd ? parseFloat(form.sale_fees_usd) : null,
        buyer_name: form.buyer_name || null,
        sale_notes: form.sale_notes || null,
        sold_by_id: currentUserId || null
      })
      // Fire-and-forget Lark notification (message shows the TOTAL + ×N)
      notifySinglesLark({
        type: 'single_sold',
        card_name: updated.card_name,
        card_number: updated.card_number,
        set_name: updated.set?.name,
        quantity: sellQtyNum,
        sale_price_usd: totalNum,
        sale_channel: updated.sale_channel,
        buyer_name: updated.buyer_name,
        operator_name: currentUserName,
      })
      addToast?.(
        sellQtyNum < qty
          ? `Sold ${sellQtyNum} of ${qty} — ${qty - sellQtyNum} remain in inventory`
          : 'Sale recorded — card moved to sold status',
        'success'
      )
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

        {/* Identity (read-only). Title deep-links to the TCGplayer product
            page (tcg_id = product id) so the seller can check market price
            while picking channel + price (Gary 2026-07-29). */}
        <div className="bg-vault-darker/60 border border-vault-border rounded-lg p-3 text-xs space-y-1 mb-3">
          {tcgProductUrl(single.tcg_id) ? (
            <a
              href={tcgProductUrl(single.tcg_id)}
              target="_blank"
              rel="noreferrer"
              className="text-white font-medium hover:text-vault-gold hover:underline inline-flex items-center gap-1"
              title="Open on TCGplayer"
            >
              {cardLine} <ExternalLink size={11} className="opacity-60" />
            </a>
          ) : (
            <div className="text-white font-medium">{cardLine}</div>
          )}
          {setLine && <div className="text-gray-400">{setLine}</div>}
          <div className="text-gray-400">{formLine}</div>
          {costUsd != null && (
            <div className="text-gray-400">
              Cost basis: <span className="text-vault-gold">${(costUsd * qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              {qty > 1 ? ` (${qty}× $${costUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })})` : ''}
            </div>
          )}
          {/* Market price (DB, sheet-synced) + the sheet's recent-sales text */}
          {(single.current_market_price_usd != null || sheetDetail?.market) && (
            <div className="text-gray-400">
              Market: <span className="text-blue-300">
                {single.current_market_price_usd != null
                  ? `$${Number(single.current_market_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : sheetDetail.market}
              </span>
              {qty > 1 && single.current_market_price_usd != null
                ? ` (×${qty} = $${(Number(single.current_market_price_usd) * qty).toLocaleString(undefined, { maximumFractionDigits: 2 })})`
                : ''}
            </div>
          )}
          {sheetDetail?.detail && (
            <div className="text-blue-200/80">
              {sheetDetail.detail}
            </div>
          )}
        </div>

        {/* Quantity — only for raw stacks with more than one copy. Sell 1
            (default), any number up to the stack, or All. Selling fewer than
            the stack splits the row; the rest stays in inventory. */}
        {qty > 1 && (
          <div className="bg-vault-darker/40 border border-vault-border rounded-lg p-3 mb-3">
            <label className="block text-xs text-gray-400 mb-1">Quantity to sell *</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max={qty}
                step="1"
                value={sellQty}
                onChange={(e) => setSellQty(e.target.value)}
                disabled={submitting}
                className="w-24"
              />
              <button
                type="button"
                onClick={() => setSellQty(String(qty))}
                disabled={submitting}
                className="px-2 py-1 text-xs border border-vault-border rounded text-gray-300 hover:text-white hover:border-vault-gold/40"
              >
                All ({qty})
              </button>
              <span className="text-xs text-gray-500">
                {sellQtyNum < qty
                  ? `${sellQtyNum} of ${qty} — the other ${qty - sellQtyNum} stay in inventory`
                  : 'whole stack'}
              </span>
            </div>
          </div>
        )}

        {/* Sale fields */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-1">
              Sale price (USD{sellQtyNum > 1 ? `, total for ${sellQtyNum}` : ''}) *
            </label>
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
              className={!form.sale_channel ? 'border-red-500/50' : ''}
            >
              <option value="">— pick channel —</option>
              {SINGLES_CHANNEL_OPTIONS.map(c => (
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
              {costUsd != null && ` · Cost: $${(costUsd * sellQtyNum).toFixed(2)}${sellQtyNum > 1 ? ` (${sellQtyNum}×)` : ''}`}
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
