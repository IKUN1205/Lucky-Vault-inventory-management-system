import { useState, useMemo } from 'react'
import { DollarSign, X, Loader2, TrendingUp, TrendingDown, Trash2 } from 'lucide-react'
import { markSinglesAsSoldBatch, notifySinglesLark } from '../lib/supabase'

// ============================================================================
// BulkSellModal — record sales for N queued cards in one go
// ============================================================================
// Opens from Scan page's Batch Sell mode, with `cards` = the singles that
// were verified as sellable (in_inventory, not soft-deleted) during the
// scan queue phase.
//
// Layout:
//   - Common fields at top (sale date, default channel)
//   - One row per card with: card info, cost (read-only), sale price input,
//     fees input, per-row channel override, realized P/L preview
//   - "Sell all N" submits — each row goes through markSingleAsSold so
//     the audit log gets one event per card
// ============================================================================

const CHANNEL_OPTIONS = [
  { value: 'ebay',       label: 'eBay' },
  { value: 'whatnot',    label: 'Whatnot' },
  { value: 'comc',       label: 'COMC' },
  { value: 'tcgplayer',  label: 'TCGplayer' },
  { value: 'in_person',  label: 'In Person' },
  { value: 'trade_out',  label: 'Trade Out' },
  { value: 'other',      label: 'Other' },
]

export default function BulkSellModal({ cards, currentUserId, currentUserName, addToast, onCancel, onSold }) {
  const today = new Date().toISOString().slice(0, 10)
  const [common, setCommon] = useState({
    sale_date: today,
    sale_channel: 'ebay',
    buyer_name: '',
  })
  const [rows, setRows] = useState(() => cards.map(c => ({
    id: c.id,
    card: c,
    sale_price_usd: '',
    sale_fees_usd: '',
    sale_channel_override: '',   // empty = use common channel
  })))
  const [submitting, setSubmitting] = useState(false)

  const updateRow = (idx, patch) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  const removeRow = (idx) => {
    setRows(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
  }
  const handleCommon = (e) => {
    const { name, value } = e.target
    setCommon(c => ({ ...c, [name]: value }))
  }

  // Aggregates for the summary at top
  const totals = useMemo(() => {
    let sale = 0, fees = 0, cost = 0, rowsWithPrice = 0
    for (const r of rows) {
      const p = parseFloat(r.sale_price_usd) || 0
      const f = parseFloat(r.sale_fees_usd) || 0
      const qty = r.card.form === 'raw' ? (r.card.quantity || 1) : 1
      const c = r.card.acquisition_cost_usd != null ? Number(r.card.acquisition_cost_usd) * qty : null
      if (p > 0) { sale += p; rowsWithPrice++ }
      fees += f
      if (c != null) cost += c
    }
    return {
      sale,
      fees,
      net: sale - fees,
      cost,
      realizedPl: (sale - fees) - cost,
      rowsWithPrice,
    }
  }, [rows])

  const allFilled = rows.every(r => parseFloat(r.sale_price_usd) > 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (rows.length === 0) return
    if (!allFilled) return addToast?.('Fill in sale price for every row', 'error')

    setSubmitting(true)
    try {
      const entries = rows.map(r => ({
        id: r.id,
        saleData: {
          sale_price_usd: parseFloat(r.sale_price_usd),
          sale_fees_usd: r.sale_fees_usd === '' ? null : parseFloat(r.sale_fees_usd),
          sale_channel: r.sale_channel_override || common.sale_channel,
          sale_date: common.sale_date,
          buyer_name: common.buyer_name || null,
          sale_currency: 'USD',
          sold_by_id: currentUserId || null,
        }
      }))
      const result = await markSinglesAsSoldBatch(entries)
      // Fire-and-forget Lark notification with batch summary (only if some succeeded)
      if (result.ok.length > 0) {
        const totalSale = result.ok.reduce((s, c) => s + (Number(c.sale_price_usd) || 0), 0)
        const totalFees = result.ok.reduce((s, c) => s + (Number(c.sale_fees_usd) || 0), 0)
        const totalCost = result.ok.reduce((s, c) => {
          const qty = c.form === 'raw' ? (c.quantity || 1) : 1
          return s + (Number(c.acquisition_cost_usd) || 0) * qty
        }, 0)
        const realizedPl = (totalSale - totalFees) - totalCost
        // Unique channels across the batch (for "mixed channels" detection)
        const channels = Array.from(new Set(result.ok.map(c => c.sale_channel).filter(Boolean)))
        notifySinglesLark({
          type: 'bulk_sold',
          count: result.ok.length,
          total_sale_usd: totalSale,
          channels,
          realized_pl_usd: totalCost > 0 ? realizedPl : null,
          operator_name: currentUserName,
        })
      }
      if (result.failed.length === 0) {
        addToast?.(`Sold ${result.ok.length} card${result.ok.length === 1 ? '' : 's'}`, 'success')
        onSold?.(result.ok)
      } else {
        addToast?.(`${result.ok.length} sold, ${result.failed.length} failed — see console`, 'error')
        console.error('[BulkSellModal] partial failures:', result.failed)
        onSold?.(result.ok)
      }
    } catch (err) {
      console.error('[BulkSellModal] submit failed:', err)
      addToast?.(`Batch sell failed: ${err.message || 'unknown'}`, 'error')
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
        className="bg-vault-surface border border-green-500/40 rounded-xl max-w-5xl w-full p-5 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-green-300">
            <DollarSign size={18} />
            <h3 className="font-semibold text-base">
              Batch sell — {rows.length} card{rows.length === 1 ? '' : 's'}
            </h3>
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

        {/* Common fields */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Sale date *</label>
            <input
              type="date"
              name="sale_date"
              value={common.sale_date}
              onChange={handleCommon}
              required
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Default channel</label>
            <select
              name="sale_channel"
              value={common.sale_channel}
              onChange={handleCommon}
              disabled={submitting}
            >
              {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Buyer <span className="text-gray-500">(applies to all)</span></label>
            <input
              type="text"
              name="buyer_name"
              value={common.buyer_name}
              onChange={handleCommon}
              disabled={submitting}
              placeholder="—"
            />
          </div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto -mx-5 px-5 mb-3 border-y border-vault-border">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-xs uppercase sticky top-0 bg-vault-surface">
              <tr>
                <th className="text-left  px-2 py-2">Card</th>
                <th className="text-right px-2 py-2 w-20">Cost</th>
                <th className="text-right px-2 py-2 w-28">Sale $ *</th>
                <th className="text-right px-2 py-2 w-20">Fees</th>
                <th className="text-left  px-2 py-2 w-32">Channel</th>
                <th className="text-right px-2 py-2 w-28">P/L</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const c = r.card
                const qty = c.form === 'raw' ? (c.quantity || 1) : 1
                const costEach = c.acquisition_cost_usd != null ? Number(c.acquisition_cost_usd) : null
                const totalCost = costEach != null ? costEach * qty : null
                const priceNum = parseFloat(r.sale_price_usd) || 0
                const feesNum = parseFloat(r.sale_fees_usd) || 0
                const netUsd = priceNum - feesNum
                const realizedPl = (priceNum > 0 && totalCost != null) ? netUsd - totalCost : null
                const ident = c.form === 'graded'
                  ? `${c.grading_company || '?'} ${c.grade || '?'}${c.cert_number ? ` #${c.cert_number}` : ''}`
                  : `Raw ${c.condition || ''}${c.tcg_id ? ` (TCG ${c.tcg_id})` : ''}${qty > 1 ? ` ×${qty}` : ''}`
                return (
                  <tr key={r.id} className="border-b border-vault-border/50 last:border-0">
                    <td className="px-2 py-2">
                      <div className="text-white">{c.card_name} <span className="text-gray-500">{c.card_number}</span></div>
                      <div className="text-gray-500 text-xs">
                        {c.set?.name || '—'} · {ident}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-vault-gold text-xs">
                      {totalCost != null
                        ? `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.sale_price_usd}
                        onChange={(e) => updateRow(idx, { sale_price_usd: e.target.value })}
                        required
                        disabled={submitting}
                        placeholder="—"
                        className="text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.sale_fees_usd}
                        onChange={(e) => updateRow(idx, { sale_fees_usd: e.target.value })}
                        disabled={submitting}
                        placeholder="—"
                        className="text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={r.sale_channel_override}
                        onChange={(e) => updateRow(idx, { sale_channel_override: e.target.value })}
                        disabled={submitting}
                        className="text-xs"
                      >
                        <option value="">(use default)</option>
                        {CHANNEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className={`px-2 py-2 text-right text-xs ${
                      realizedPl == null ? 'text-gray-500'
                        : realizedPl >= 0 ? 'text-green-400'
                        : 'text-red-400'
                    }`}>
                      {realizedPl == null
                        ? '—'
                        : `${realizedPl >= 0 ? '+' : ''}$${Math.abs(realizedPl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={submitting || rows.length === 1}
                        className="text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={rows.length === 1 ? 'At least one row required' : 'Remove from batch'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Totals + actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400 flex flex-wrap gap-3">
            <span>Sale: <span className="text-green-400">${totals.sale.toFixed(2)}</span></span>
            <span>Fees: <span className="text-gray-300">${totals.fees.toFixed(2)}</span></span>
            <span>Cost: <span className="text-vault-gold">${totals.cost.toFixed(2)}</span></span>
            <span className={`font-semibold flex items-center gap-1 ${
              totals.realizedPl >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {totals.realizedPl >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              Realized P/L: {totals.realizedPl >= 0 ? '+' : '-'}${Math.abs(totals.realizedPl).toFixed(2)}
            </span>
          </div>
          <div className="flex gap-2">
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
              disabled={submitting || !allFilled}
              className="px-4 py-2 text-sm bg-green-500/20 border border-green-500/60 text-green-200 hover:bg-green-500/30 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />}
              Sell all {rows.length}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
