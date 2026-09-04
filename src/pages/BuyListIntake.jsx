import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Check, AlertTriangle, X } from 'lucide-react'
import { supabase, fetchAllPages, createAcquisition, deleteAcquisition, updateInventory, convertToUSD, createStorefrontSale } from '../lib/supabase'
import { createProductChecked } from '../lib/duplicateGuard'
import useMarketPrices from '../lib/useMarketPrices'
import { marketFor } from '../lib/marketPct'
import { parseBuyList, rankCandidates } from '../lib/buyListParse'
import { ToastContainer, useToast } from '../components/Toast'

// Store staff paste the seller's item list after a collection / lot buy.
// Every line must be confirmed against a real SKU by a person — the matcher
// only ranks candidates, it never books a guess. Submit books acquisitions
// (goods already in hand -> status Received) + inventory at the chosen room.
//
// Concurrency note: updateInventory is the same read-modify-write every other
// intake page uses (no optimistic lock — known repo-wide limitation pending
// the checkout RPC). This flow adds no new exposure class beyond IntakeToMaster.

const NEW_SKU_CATEGORIES = ['Booster Box', 'Booster Pack', 'ETB', 'Booster Bundle', 'Tin', 'Blister Pack', 'Collection Box', 'Deck', 'Other']
const LANGS = ['EN', 'JP', 'CN']

const validQty = (q) => Number.isInteger(q) && q > 0
const priceOf = (l) => {
  const p = parseFloat(l.price)
  return Number.isFinite(p) && p > 0 ? p : null
}

export default function BuyListIntake() {
  const { toasts, addToast, removeToast } = useToast()
  const { prices: marketPrices, feedDown } = useMarketPrices()
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState([])
  const [users, setUsers] = useState([])
  const [locations, setLocations] = useState([])
  const [text, setText] = useState('')
  const [lines, setLines] = useState([])       // {uid, raw, qty, name, note, candidates, product_id, skipped, price}
  const [totalPaid, setTotalPaid] = useState('')
  const [buyerId, setBuyerId] = useState('')
  const [locationId, setLocationId] = useState('')
  // How we paid. Recorded on every acquisition in the batch (Gary 2026-09-04
  // "记一下付款"). Until now this page wrote no payment at all, so a store buy
  // paid out of the drawer left the goods and the cost in the books and the
  // cash nowhere — the 09-03 $11,198 buy is exactly that hole.
  //
  // "Not paid yet" is a real method here (IOU (we owe)), not a blank. A blank
  // cannot be told apart from nobody filling it in, and that ambiguity is what
  // let 500 rows accumulate with no payment on them.
  const [payMethods, setPayMethods] = useState([])
  const [paymentMethodId, setPaymentMethodId] = useState('')
  // A lot of loose singles bought alongside the sealed. Recorded as money and a
  // card count ONLY — never as inventory, because Cards Scan intakes each card
  // properly later and booking stock here would count them twice. Same
  // contract as the register's Bulk Buy.
  const [singlesCount, setSinglesCount] = useState('')
  const [singlesPaid, setSinglesPaid] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)
  const submitLock = useRef(false)
  const uidSeq = useRef(1)

  useEffect(() => {
    (async () => {
      try {
        const [prods, us, locs, pms] = await Promise.all([
          fetchAllPages(() => supabase.from('products')
            .select('id,name,aliases,brand,language,type,variant,active,category')
            .order('id')),
          supabase.from('users').select('id,name').order('name'),
          supabase.from('locations').select('id,name,type,active').order('name'),
          supabase.from('payment_methods').select('id,name').order('name'),
        ])
        setProducts(prods)
        setUsers(us.data || [])
        setPayMethods(pms.data || [])
        const phys = (locs.data || []).filter(l => l.active && l.type === 'Physical')
        setLocations(phys)
        const front = phys.find(l => l.name === 'Front Store')
        if (front) setLocationId(front.id)
      } catch (e) {
        console.error(e)
        addToast('Failed to load products/rooms — reload the page', 'error')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeProducts = useMemo(() => products.filter(p => p.active !== false), [products])

  const doParse = () => {
    const parsed = parseBuyList(text)
    if (!parsed.length) {
      addToast('Nothing to parse — paste the list first', 'error')
      return
    }
    setLines(parsed.map(p => {
      const candidates = rankCandidates(p.name, activeProducts, { limit: 5 })
      // Preselect ONLY when exactly ONE candidate is a perfect bidirectional
      // match — two same-name products in different languages must both stay
      // a human decision (a wrong preselect is how bad SKUs get booked).
      const exacts = candidates.filter(c => c.exact)
      return {
        ...p,
        uid: uidSeq.current++,
        qty: validQty(p.qty) ? p.qty : null,
        candidates,
        product_id: exacts.length === 1 ? exacts[0].id : '',
        skipped: false,
        price: '',
      }
    }))
    setDone(null)
  }

  const setLine = (uid, patch) => setLines(ls => ls.map(l => (l.uid === uid ? { ...l, ...patch } : l)))

  const searchMore = (uid, q) => {
    const cands = rankCandidates(q, activeProducts, { limit: 8 })
    if (!cands.length) addToast('No catalog match for that search — try fewer words or create a new SKU', 'info')
    setLine(uid, { candidates: cands, product_id: '' })
  }

  const createNewSku = async (uid) => {
    const l = lines.find(x => x.uid === uid)
    if (!l) return
    const name = (window.prompt('Exact product name for the new SKU (as it should appear everywhere):', l.name) || '').trim()
    if (!name) return
    const category = (window.prompt(`Category — exactly one of:\n${NEW_SKU_CATEGORIES.join(' / ')}`, 'Other') || '').trim()
    if (!NEW_SKU_CATEGORIES.includes(category)) {
      addToast('Category must be one of the listed values — nothing created', 'error')
      return
    }
    const language = (window.prompt('Language — EN / JP / CN:', 'EN') || '').trim().toUpperCase()
    if (!LANGS.includes(language)) {
      addToast('Language must be EN, JP or CN — nothing created', 'error')
      return
    }
    try {
      const created = await createProductChecked({
        name, brand: 'Pokemon', type: category === 'Booster Pack' ? 'Pack' : 'Sealed',
        category, language,
      })
      setProducts(ps => [...ps, created])
      setLine(uid, { product_id: created.id, candidates: [{ id: created.id, name: created.name, exact: true }] })
      addToast(`SKU created: ${created.name}`)
    } catch (err) {
      if (err.code === 'DUPLICATE_CANCELLED') {
        // Cancel means "one of these existing SKUs is probably it" — offer
        // them, but the person still has to pick. Never auto-select.
        const cands = (err.candidates || []).map(c => ({ id: c.id, name: c.name, exact: false }))
        setLine(uid, { candidates: cands.length ? cands : l.candidates, product_id: '' })
        addToast('Existing SKUs offered on that line — pick the right one from the list', 'info')
      } else {
        addToast('Could not create the SKU', 'error')
      }
    }
  }

  const activeLines = lines.filter(l => !l.skipped)
  const unresolved = activeLines.filter(l => !l.product_id || !validQty(l.qty))
  // money is cents, full stop — 10.005 typed into the box must not book as 10.01
  const rawPaid = parseFloat(totalPaid)
  const paidNum = Number.isFinite(rawPaid) ? Math.round(rawPaid * 100) / 100 : NaN
  const langById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p.language])), [products])

  // Cost allocation. Per-line prices are honored where entered; whatever is
  // left of the total is spread over the UNPRICED lines by market weight
  // (average-weight fallback so a missing market price never reads as $0).
  // The last allocated line absorbs the rounding remainder, so line totals
  // always sum exactly to the money that was actually paid.
  const allocation = useMemo(() => {
    if (!activeLines.length || !(paidNum > 0) || unresolved.length > 0) return null
    const priced = activeLines.filter(l => priceOf(l) !== null)
    const unpriced = activeLines.filter(l => priceOf(l) === null)
    const out = priced.map(l => ({ line: l, lineTotal: Math.round(priceOf(l) * l.qty * 100) / 100, method: 'entered' }))
    const pricedSum = out.reduce((n, a) => n + a.lineTotal, 0)
    if (unpriced.length === 0) {
      return { rows: out, pricedSum, remainder: Math.round((paidNum - pricedSum) * 100) / 100, blocked: null }
    }
    const remainder = Math.round((paidNum - pricedSum) * 100) / 100
    if (remainder <= 0) {
      return { rows: null, pricedSum, remainder, blocked: 'line prices already reach the total paid — nothing left for the unpriced lines' }
    }
    const weights = unpriced.map(l => {
      const m = !feedDown && l.product_id ? marketFor(l.product_id, marketPrices) : null
      return m && m.market > 0 ? m.market * l.qty : null
    })
    const knownUnits = unpriced.filter((l, i) => weights[i] !== null).reduce((n, l) => n + l.qty, 0)
    const knownSum = weights.filter(w => w !== null).reduce((a, b) => a + b, 0)
    const avgUnit = knownUnits > 0 ? knownSum / knownUnits : 1
    const filled = weights.map((w, i) => (w !== null ? w : avgUnit * unpriced[i].qty))
    const totalW = filled.reduce((a, b) => a + b, 0) || 1
    let allocated = 0
    unpriced.forEach((l, i) => {
      const last = i === unpriced.length - 1
      const lineTotal = last
        ? Math.round((remainder - allocated) * 100) / 100
        : Math.round((remainder * filled[i] / totalW) * 100) / 100
      allocated = Math.round((allocated + lineTotal) * 100) / 100
      out.push({ line: l, lineTotal, method: weights[i] !== null ? 'market-weight' : 'avg-weight (no market price)' })
    })
    return { rows: out, pricedSum, remainder: 0, blocked: null }
  }, [activeLines, unresolved.length, paidNum, marketPrices, feedDown])

  const canSubmit = activeLines.length > 0 && unresolved.length === 0 && paidNum > 0 &&
    buyerId && locationId && paymentMethodId && allocation && allocation.rows && !submitting

  const submit = async () => {
    if (!canSubmit || submitLock.current) return
    if (allocation.remainder !== 0 && Math.abs(allocation.remainder) > 0.005) {
      if (!window.confirm(`Line prices add to $${allocation.pricedSum.toFixed(2)} but total paid is $${paidNum.toFixed(2)} (difference $${allocation.remainder.toFixed(2)}). Book with the line prices anyway?`)) return
    }
    submitLock.current = true
    setSubmitting(true)
    const batchId = (crypto.randomUUID ? crypto.randomUUID() : `bl-${Date.now()}`)
    const today = new Date().toLocaleDateString('en-CA')
    // each entry: {acqId, product_id, qty, invApplied, snapshot}
    const created = []
    try {
      for (const { line, lineTotal, method } of allocation.rows) {
        const unit = lineTotal / line.qty   // full precision — basis math divides the same way IntakeToMaster does
        const acq = await createAcquisition({
          batch_id: batchId,
          date_purchased: today,
          acquirer_id: buyerId,
          source_country: 'USA',
          product_id: line.product_id,
          quantity_purchased: line.qty,
          quantity_received: line.qty,
          cost: lineTotal,
          currency: 'USD',
          cost_usd: convertToUSD(lineTotal, 'USD'),
          status: 'Received',
          payment_method_id: paymentMethodId,
          notes: `BUYLIST | raw="${line.raw.replace(/"/g, "'")}" | alloc=${method}${line.note ? ` | note=${line.note}` : ''}`,
        })
        const entry = { acqId: acq.id, product_id: line.product_id, qty: line.qty, invApplied: false, snapshot: null }
        created.push(entry)   // pushed BEFORE the inventory write: a failed bump must still roll this acquisition back
        try {
          // direct select (not fetchInventoryRow) because the restore needs the row id
          const { data: snap } = await supabase.from('inventory')
            .select('id,quantity,avg_cost_basis')
            .eq('product_id', line.product_id).eq('location_id', locationId).maybeSingle()
          entry.snapshot = snap
        } catch { /* snapshot is best-effort; rollback falls back to -qty only */ }
        await updateInventory(line.product_id, locationId, line.qty, unit)
        entry.invApplied = true
      }
      const bookedTotal = Math.round(allocation.rows.reduce((n, r) => n + r.lineTotal, 0) * 100) / 100
      const payName = payMethods.find(p => p.id === paymentMethodId)?.name || ''

      // Loose singles bought with the lot: money and count, NO stock. Written
      // as a counter buy line, the same shape the register's Bulk Buy uses, so
      // Cards Scan picks it up from one place instead of two. If this wrote
      // inventory, every card would be counted again the moment it is scanned.
      const nCards = parseInt(singlesCount, 10)
      const singlesAmt = Math.round((parseFloat(singlesPaid) || 0) * 100) / 100
      if (Number.isInteger(nCards) && nCards > 0 && singlesAmt > 0) {
        await createStorefrontSale({
          date: today,
          sale_type: 'Itemized',
          product_id: null,
          location_id: locationId,
          quantity: nCards,
          sale_price: singlesAmt,
          cost_basis: null,
          profit: null,
          payment_method_id: paymentMethodId,
          cashier_id: buyerId,
          transaction_id: batchId,
          transaction_type: 'buy',
          net_cash_usd: -singlesAmt,
          notes: `BUY: bulk singles — ${nCards} cards (pending Cards Scan intake) | BUYLIST batch ${batchId}`,
        })
      }

      // Cash is the only method that moves the drawer, so it is the only one
      // that writes a counter row. Recording a Zelle or a card payment as cash
      // out would make the next count read short by exactly this amount — and
      // reporting a normal handover as a shortfall is what stopped anyone
      // counting for the six weeks before 09-04.
      if (/^cash$/i.test(payName) && bookedTotal > 0) {
        await createStorefrontSale({
          date: today,
          sale_type: 'Itemized',
          product_id: null,
          location_id: locationId,
          quantity: activeLines.reduce((n, l) => n + l.qty, 0),
          sale_price: bookedTotal,
          cost_basis: null,
          profit: null,
          payment_method_id: paymentMethodId,
          cashier_id: buyerId,
          transaction_id: batchId,
          transaction_type: 'buy',
          net_cash_usd: -bookedTotal,
          notes: `BUY: sealed buy-list paid in cash — ${activeLines.length} line(s) | BUYLIST batch ${batchId}`,
        })
      }

      // fire-and-forget group notification (never awaited, never blocks booking).
      // Report what was BOOKED — if the user confirmed line prices that differ
      // from the cash paid, the notification must match the books, not the till.
      try {
        const buyer = users.find(u => u.id === buyerId)?.name || 'store'
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'purchased',
            acquirer: buyer, vendor: 'Store buy-list', sourceCountry: 'USA', currency: 'USD',
            totalCost: bookedTotal, totalCostUSD: bookedTotal,
            totalUnits: activeLines.reduce((n, l) => n + l.qty, 0),
            items: allocation.rows.map(({ line }) => ({
              name: products.find(p => p.id === line.product_id)?.name || line.name,
              quantity: line.qty,
            })),
          }),
        }).catch(err => console.error('[lark-notify] buylist request failed:', err))
      } catch { /* notification must never block the booking */ }
      setDone({ count: created.length, units: created.reduce((n, c) => n + c.qty, 0), batchId })
      setLines([]); setText(''); setTotalPaid('')
      addToast(`Booked ${created.length} lines into inventory`)
    } catch (err) {
      console.error(err)
      // Roll back what this submit created, in reverse, verifying each step —
      // a half-booked list is worse than no booking, and an unverified
      // rollback is worse than admitting failure.
      let failures = 0
      for (const c of [...created].reverse()) {
        try {
          if (c.invApplied) {
            await updateInventory(c.product_id, locationId, -c.qty)
            // updateInventory only recomputes basis on inflow; restore the
            // pre-write basis explicitly so the weighted average isn't left
            // polluted by the rolled-back batch.
            if (c.snapshot && c.snapshot.id != null && c.snapshot.avg_cost_basis != null) {
              const { error: bErr } = await supabase.from('inventory')
                .update({ avg_cost_basis: c.snapshot.avg_cost_basis, last_updated: new Date().toISOString() })
                .eq('id', c.snapshot.id)
              if (bErr) throw bErr
            }
          }
          await deleteAcquisition(c.acqId)
          const { data: still } = await supabase.from('acquisitions').select('id').eq('id', c.acqId).maybeSingle()
          if (still) throw new Error('acquisition still present after delete')
        } catch (e2) {
          failures += 1
          console.error('rollback failed for', c.acqId, e2)
        }
      }
      addToast(
        failures === 0
          ? 'Booking failed — everything this attempt wrote was rolled back and verified. Nothing recorded; try again.'
          : `Booking failed MID-WAY and ${failures} line(s) could NOT be verified as rolled back — STOP and tell a manager before retrying`,
        'error',
      )
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ClipboardPaste className="text-vault-gold" />
          Buy List Intake
        </h1>
        <p className="text-gray-400 mt-1">Bought a collection or a lot? Paste the seller's item list, confirm each SKU, and it books cost + stock in one go.</p>
      </div>

      {done && (
        <div className="card mb-6 border-green-500/40">
          <p className="text-green-400 font-semibold">Booked: {done.count} lines / {done.units} units. Cost and stock are recorded.</p>
        </div>
      )}

      <div className="card mb-6">
        <h2 className="font-display text-lg font-semibold text-white mb-4">1 · Paste the list</h2>
        <textarea rows={8} className="w-full" placeholder={'One item per line, e.g.\n23 pb booster boxes\n2 pb pkc etb\nFirst partner series 2 - 113'}
          value={text} onChange={e => setText(e.target.value)} />
        <div className="flex flex-wrap gap-3 mt-3 items-end">
          <label className="text-sm text-gray-400">Total paid (USD) *
            <input type="number" min="0" step="0.01" className="block mt-1 w-36" value={totalPaid} onChange={e => setTotalPaid(e.target.value)} />
          </label>
          <label className="text-sm text-gray-400">Bought by *
            <select className="block mt-1" value={buyerId} onChange={e => setBuyerId(e.target.value)}>
              <option value="">Select…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-400">Goods are at *
            <select className="block mt-1" value={locationId} onChange={e => setLocationId(e.target.value)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-400">Paid with *
            <select className="block mt-1" value={paymentMethodId} onChange={e => setPaymentMethodId(e.target.value)}>
              <option value="">Select…</option>
              {payMethods.map(p => (
                <option key={p.id} value={p.id}>
                  {/^iou/i.test(p.name) ? `${p.name} — not paid yet` : p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 mt-3 items-end border-t border-white/10 pt-3">
          <div className="text-sm text-gray-400 w-full">
            Loose singles bought with this lot <span className="text-gray-500">— optional</span>
          </div>
          <label className="text-sm text-gray-400">How many cards
            <input type="number" min="0" step="1" className="block mt-1 w-32"
              value={singlesCount} onChange={e => setSinglesCount(e.target.value)} />
          </label>
          <label className="text-sm text-gray-400">Paid for them (USD)
            <input type="number" min="0" step="0.01" className="block mt-1 w-36"
              value={singlesPaid} onChange={e => setSinglesPaid(e.target.value)} />
          </label>
          <p className="text-xs text-gray-500 flex-1 min-w-64">
            Records the money and the count only. The cards themselves stay out of
            inventory until Cards Scan intakes them one by one — booking stock here
            would count every card twice.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 mt-3 items-end">
          <button className="btn btn-primary" onClick={doParse}>Parse list</button>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-display text-lg font-semibold text-white mb-1">2 · Confirm every line</h2>
          <p className="text-sm text-gray-400 mb-4">
            The matcher only suggests — <b>a person picks every SKU</b>. Skip lines we don't stock (sports cards etc.).
            {feedDown && <span className="text-amber-400"> Market feed unreachable — cost will be split evenly, not by market value.</span>}
          </p>
          <div className="space-y-3">
            {lines.map(l => (
              <div key={l.uid} className={`border rounded-lg p-3 ${l.skipped ? 'border-vault-border opacity-50' : l.product_id && validQty(l.qty) ? 'border-green-500/40' : 'border-amber-500/50'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-gray-400 text-sm w-64 truncate" title={l.raw}>{l.raw}</span>
                  <input type="number" min="1" step="1" className="w-20" value={l.qty ?? ''} placeholder="qty"
                    onChange={e => { const q = parseInt(e.target.value, 10); setLine(l.uid, { qty: validQty(q) ? q : null }) }} disabled={l.skipped} />
                  <select className="flex-1 min-w-56" value={l.product_id} disabled={l.skipped}
                    onChange={e => setLine(l.uid, { product_id: e.target.value })}>
                    <option value="">— pick the SKU —</option>
                    {l.candidates.map(c => <option key={c.id} value={c.id}>{c.name}{langById[c.id] ? ` [${langById[c.id]}]` : ''}{c.exact ? ' ✓' : ''}</option>)}
                  </select>
                  <input type="number" min="0" step="0.01" className="w-24" placeholder="$/unit (opt)"
                    value={l.price} onChange={e => setLine(l.uid, { price: e.target.value })} disabled={l.skipped} />
                  <button className="px-2 py-1 text-xs bg-vault-surface border border-vault-border rounded text-gray-300 hover:text-vault-gold hover:border-vault-gold"
                    onClick={() => { const q = window.prompt('Search the catalog:', l.name); if (q) searchMore(l.uid, q) }} disabled={l.skipped}>search</button>
                  <button className="px-2 py-1 text-xs bg-vault-surface border border-vault-border rounded text-gray-300 hover:text-vault-gold hover:border-vault-gold"
                    onClick={() => createNewSku(l.uid)} disabled={l.skipped}>new SKU</button>
                  <button className="px-2 py-1 text-xs bg-vault-surface border border-vault-border rounded text-gray-300 hover:text-red-400"
                    onClick={() => setLine(l.uid, { skipped: !l.skipped })}>{l.skipped ? 'unskip' : 'skip'}</button>
                  {!l.skipped && (l.product_id && validQty(l.qty)
                    ? <Check size={16} className="text-green-400" />
                    : <AlertTriangle size={16} className="text-amber-400" />)}
                  {l.skipped && <X size={16} className="text-gray-500" />}
                </div>
                {l.note && <p className="text-xs text-amber-400 mt-1">note: {l.note}</p>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
              {submitting ? 'Booking…' : `Book ${activeLines.length} lines / ${activeLines.reduce((n, l) => n + (validQty(l.qty) ? l.qty : 0), 0)} units for $${paidNum > 0 ? paidNum.toFixed(2) : '…'}`}
            </button>
            {unresolved.length > 0 && (
              <span className="text-amber-400 text-sm">{unresolved.length} line(s) still need a SKU or a qty — confirm or skip them first</span>
            )}
            {activeLines.length === 0 && lines.length > 0 && (
              <span className="text-amber-400 text-sm">every line is skipped — nothing to book</span>
            )}
            {allocation && allocation.blocked && (
              <span className="text-red-400 text-sm">{allocation.blocked}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
