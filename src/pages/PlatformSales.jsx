import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  supabase,
  lookupScannedCode,
  submitPlatformTransaction,
  searchProductsForStorefront,
  searchSinglesForStorefront,
  searchSlabsForStorefront,
} from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import {
  ScanLine, X, Trash2, Loader2, Package, Diamond, Layers,
  AlertTriangle, Save, TrendingUp, ChevronDown, ChevronUp,
  Search, Plus,
} from 'lucide-react'

// ============================================================================
// PlatformSales — scan + cart for online channels
// ============================================================================
// Pick a channel (eBay/TikTok/Whatnot room) up top, scan UPC / cert# / TCG ID
// OR search by name, build a mixed cart. Each row shows OUR reference price
// (market) and the streamer types the sold price. Submit decrements inventory
// and writes one platform_sales row per item, all tagged with a shared
// transaction_id so a cart submit is reassembleable.
// ============================================================================

const CHANNELS = [
  { id: 'ebay-slabbiepatty', label: 'eBay · SlabbiePatty',   platform: 'eBay',    channel: 'SlabbiePatty'   },
  { id: 'ebay-luckyvaultus', label: 'eBay · LuckyVaultUS',   platform: 'eBay',    channel: 'LuckyVaultUS'   },
  { id: 'tiktok-packheads',  label: 'TikTok · PackHeadsTCG', platform: 'TikTok',  channel: 'PackHeadsTCG'   },
  { id: 'tiktok-rocketshq',  label: 'TikTok · RocketsHQ',    platform: 'TikTok',  channel: 'RocketsHQ'      },
  { id: 'whatnot',           label: 'Whatnot',               platform: 'Whatnot', channel: 'Whatnot'        },
]

const KIND_META = {
  sealed: { icon: Package, color: 'text-amber-300',   label: 'Sealed' },
  slab:   { icon: Diamond, color: 'text-emerald-300', label: 'Slab'   },
  single: { icon: Layers,  color: 'text-blue-300',    label: 'Single' },
}

const today = () => new Date().toLocaleDateString('en-CA')
const fmtUsd = (n) => {
  const v = Number(n) || 0
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`
}

export default function PlatformSales() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [channelId, setChannelId] = useState('')
  const [streamerId, setStreamerId] = useState('')
  const [saleDate, setSaleDate] = useState(today())
  const [users, setUsers] = useState([])

  const [scanValue, setScanValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cart, setCart] = useState([])
  const [unknownCode, setUnknownCode] = useState(null)

  const inputRef = useRef(null)
  const selectedChannel = CHANNELS.find(c => c.id === channelId) || null

  useEffect(() => {
    supabase.from('users').select('*').eq('active', true).order('name').then(({ data }) => setUsers(data || []))
  }, [])

  useEffect(() => {
    if (selectedChannel) setTimeout(() => inputRef.current?.focus(), 0)
  }, [channelId, selectedChannel])

  // ---------- cart builders ----------

  const addOrIncrementSealed = useCallback((lookup) => {
    const { product, inventory } = lookup
    const totalAvailable = (inventory || []).reduce((s, i) => s + (i.quantity || 0), 0)
    if (totalAvailable <= 0) {
      addToast(`${product.name} — no stock anywhere`, 'error')
      return
    }
    setCart(prev => {
      const idx = prev.findIndex(l => l.kind === 'sealed' && l.product.id === product.id)
      if (idx >= 0) {
        const existing = prev[idx]
        if ((existing.quantity || 1) + 1 > totalAvailable) {
          addToast(`Only ${totalAvailable} available — cart already has ${existing.quantity}`, 'error')
          return prev
        }
        const next = [...prev]
        next[idx] = { ...existing, quantity: (existing.quantity || 1) + 1 }
        return next
      }
      return [...prev, {
        kind: 'sealed',
        key: `sealed-${product.id}-${Date.now()}`,
        product, inventory,
        available: totalAvailable,
        quantity: 1,
        price: '',
        our_price: null,
      }]
    })
    addToast(`Added: ${product.name}`, 'success')
  }, [addToast])

  const addSlab = useCallback((slab) => {
    if (slab.status === 'sold') { addToast('Already sold', 'error'); return }
    if (slab.status !== 'in_inventory' && slab.status !== 'listed') {
      addToast(`Status "${slab.status}" — can't sell from here`, 'error'); return
    }
    setCart(prev => {
      if (prev.some(l => l.kind === 'slab' && l.slab.id === slab.id)) {
        addToast('Slab already in cart', 'info'); return prev
      }
      const ourPrice = slab.market_price_usd != null ? Number(slab.market_price_usd)
                     : slab.lv_price_usd != null     ? Number(slab.lv_price_usd)
                     : slab.list_price_usd != null   ? Number(slab.list_price_usd) : null
      return [...prev, {
        kind: 'slab',
        key: `slab-${slab.id}`,
        slab,
        quantity: 1,
        price: '',
        our_price: ourPrice,
      }]
    })
    addToast(`Added: ${slab.item_name}`, 'success')
  }, [addToast])

  const addOrIncrementSingle = useCallback((single) => {
    if (single.status === 'sold') { addToast('Already sold', 'error'); return }
    if (single.status !== 'in_inventory' && single.status !== 'listed') {
      addToast(`Status "${single.status}" — can't sell from here`, 'error'); return
    }
    const available = single.quantity || 1
    setCart(prev => {
      const idx = prev.findIndex(l => l.kind === 'single' && l.single.id === single.id)
      if (idx >= 0) {
        const existing = prev[idx]
        if ((existing.quantity || 1) + 1 > available) {
          addToast(`Only ${available} available — cart has ${existing.quantity}`, 'error')
          return prev
        }
        const next = [...prev]
        next[idx] = { ...existing, quantity: (existing.quantity || 1) + 1 }
        return next
      }
      const ourPrice = single.current_market_price_usd != null
        ? Number(single.current_market_price_usd) : null
      return [...prev, {
        kind: 'single',
        key: `single-${single.id}`,
        single, available,
        quantity: 1,
        price: '',
        our_price: ourPrice,
      }]
    })
    addToast(`Added: ${single.card_name}`, 'success')
  }, [addToast])

  // ---------- scan ----------

  const handleScan = async (e) => {
    e?.preventDefault?.()
    if (!selectedChannel) {
      addToast('Pick a channel first', 'error'); return
    }
    const code = scanValue.trim()
    if (!code) return
    setScanning(true); setUnknownCode(null)
    try {
      const result = await lookupScannedCode(code)
      if (result.kind === 'sealed')      addOrIncrementSealed(result)
      else if (result.kind === 'slab')   addSlab(result.slab)
      else if (result.kind === 'single') addOrIncrementSingle(result.single)
      else if (result.kind === 'unknown') setUnknownCode(code)
    } catch (err) {
      console.error('[PlatformSales] lookup failed:', err)
      addToast(`Lookup failed: ${err.message || err}`, 'error')
    } finally {
      setScanning(false); setScanValue('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // ---------- cart editing ----------

  const updateLine = (key, patch) => setCart(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  const removeLine = (key) => setCart(prev => prev.filter(l => l.key !== key))
  const clearCart = () => {
    if (cart.length === 0) return
    if (!confirm('Clear entire cart?')) return
    setCart([])
  }

  // ---------- submit ----------

  const cartTotal = cart.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity ?? 1) || 1), 0)
  const cartUnits = cart.reduce((s, l) => s + (Number(l.quantity ?? 1) || 1), 0)

  const validateCart = () => {
    if (!selectedChannel)  return 'Pick a channel'
    if (cart.length === 0) return 'Cart is empty'
    if (!streamerId)       return 'Pick a streamer'
    if (!saleDate)         return 'Pick a date'
    for (const line of cart) {
      const p = Number(line.price)
      if (line.price === '' || line.price == null || isNaN(p) || p < 0) {
        const label = line.kind === 'sealed' ? line.product.name
                    : line.kind === 'slab'   ? line.slab.item_name
                    : line.single.card_name
        return `Missing sold price for: ${label}`
      }
      const qty = Number(line.quantity ?? 1)
      if (line.kind !== 'slab' && (!qty || qty < 1)) return 'Quantity must be at least 1'
    }
    return null
  }

  const handleSubmit = async () => {
    const err = validateCart()
    if (err) { addToast(err, 'error'); return }
    setSubmitting(true)
    try {
      const result = await submitPlatformTransaction({
        cart,
        platform: selectedChannel.platform,
        channel:  selectedChannel.channel,
        streamerId: streamerId || null,
        saleDate,
      })
      const { ok, failed } = result
      const failedKeys = new Set(failed.map(f => f.line.key))
      setCart(prev => prev.filter(l => failedKeys.has(l.key)))
      if (ok.length > 0) {
        addToast(
          `${ok.length} sale${ok.length === 1 ? '' : 's'} recorded on ${selectedChannel.label}${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
          failed.length > 0 ? 'info' : 'success'
        )
      }
      if (failed.length > 0) for (const f of failed) addToast(`Line failed: ${f.error}`, 'error')
    } catch (err) {
      console.error('[PlatformSales] submit threw:', err)
      addToast(`Submit failed: ${err.message || err}`, 'error')
    } finally {
      setSubmitting(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // ---------- render ----------

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <TrendingUp className="text-vault-gold" />
          Platform Sales
        </h1>
        <p className="text-gray-400 mt-1">
          Pick a channel, then scan UPC / slab cert# / single TCG ID to record sales.
        </p>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p>
            <span className="text-vault-gold font-medium">Workflow</span>: pick the channel →
            scan or search → cart shows our price → streamer fills the sold price → submit.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>📦 Sealed box / pack → UPC</li>
            <li>💎 Graded slab → cert#</li>
            <li>🎴 Raw single → TCG ID</li>
          </ul>
        </div>
      </Instructions>

      {/* Channel picker — required */}
      <div className="card mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Channel <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {CHANNELS.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChannelId(c.id)}
              disabled={submitting}
              className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                channelId === c.id
                  ? 'bg-vault-gold/20 border-vault-gold text-vault-gold font-semibold'
                  : 'bg-vault-darker/40 border-vault-border text-gray-300 hover:bg-vault-darker/70'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date + Streamer — only after channel picked */}
      {selectedChannel && (
        <div className="card mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Date</label>
              <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} disabled={submitting} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Streamer <span className="text-red-400">*</span>
              </label>
              <select
                value={streamerId}
                onChange={(e) => setStreamerId(e.target.value)}
                disabled={submitting}
                className={!streamerId ? 'border-red-500/50' : ''}
              >
                <option value="">— pick streamer —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Scan input — only enabled after channel picked */}
      {selectedChannel && (
        <div className="card mb-4">
          <form onSubmit={handleScan} className="bg-vault-darker/40 border border-vault-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ScanLine size={20} className="text-vault-gold flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                disabled={scanning || submitting}
                placeholder="Scan UPC, slab cert#, or single TCG ID…"
                autoComplete="off" spellCheck={false} inputMode="numeric"
                className="flex-1 px-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-base focus:outline-none focus:border-vault-gold disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={scanning || submitting || !scanValue.trim()}
                className="px-4 py-2 bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md text-sm hover:bg-vault-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {scanning ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
              </button>
            </div>
            <div className="text-[11px] text-gray-500">
              Auto-detects: UPC → sealed, cert# → slab, TCG ID → single.
            </div>
          </form>

          {unknownCode && (
            <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <div className="text-amber-200">
                  <code className="bg-vault-darker px-1.5 py-0.5 rounded text-vault-gold">{unknownCode}</code> isn't recognized as any UPC, slab cert#, or single TCG ID.
                </div>
                <div className="text-xs text-gray-400 mt-1">Use Manual entry below to search by name.</div>
              </div>
              <button onClick={() => setUnknownCode(null)} className="p-1 text-gray-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual entry — only after channel picked */}
      {selectedChannel && (
        <ManualEntrySection
          onPickSealed={(result) => addOrIncrementSealed(result)}
          onPickSingle={(single) => addOrIncrementSingle(single)}
          onPickSlab={(slab) => addSlab(slab)}
          disabled={submitting}
        />
      )}

      {/* Cart */}
      {selectedChannel && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-sm font-semibold text-white uppercase tracking-wider">
              Cart {cart.length > 0 && <span className="text-gray-500 normal-case">({cart.length} {cart.length === 1 ? 'line' : 'lines'} · {cartUnits} units)</span>}
            </h2>
            {cart.length > 0 && (
              <button type="button" onClick={clearCart} disabled={submitting} className="text-xs text-gray-400 hover:text-red-300">
                Clear
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-6">
              Cart is empty. Scan or search above to add items.
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map(line => (
                <CartRow key={line.key} line={line} onUpdate={updateLine} onRemove={removeLine} disabled={submitting} />
              ))}
              <div className="flex justify-between items-center pt-3 mt-3 border-t border-vault-border">
                <span className="text-sm text-gray-400">Cart total</span>
                <span className="text-lg font-bold text-vault-gold">{fmtUsd(cartTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      {selectedChannel && cart.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !streamerId}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save size={16} />
            {submitting ? 'Recording…' : `Record ${cart.length} sale${cart.length === 1 ? '' : 's'} (${fmtUsd(cartTotal)})`}
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// CartRow — sealed / slab / single
// ============================================================================
function CartRow({ line, onUpdate, onRemove, disabled }) {
  const meta = KIND_META[line.kind]
  const Icon = meta.icon

  let title, sub, available, qtyEditable
  if (line.kind === 'sealed') {
    title = `${line.product.brand} | ${line.product.name}`
    sub   = `${line.product.category || line.product.type || ''} · ${line.product.language || ''} · UPC ${line.product.barcode || '—'}`
    available = line.available
    qtyEditable = true
  } else if (line.kind === 'slab') {
    title = line.slab.item_name
    sub   = `${line.slab.grading_company} · cert #${line.slab.cert_number}`
    available = 1
    qtyEditable = false
  } else if (line.kind === 'single') {
    const setLine = line.single.set?.name ? ` · ${line.single.set.name}` : ''
    title = `${line.single.card_name}${line.single.card_number ? ` #${line.single.card_number}` : ''}`
    sub   = `${line.single.condition || 'raw'}${setLine} · TCG ${line.single.tcg_id}`
    available = line.available
    qtyEditable = true
  }

  const qty   = Number(line.quantity ?? 1) || 1
  const price = Number(line.price) || 0
  const subtotal = price * qty
  const priceMissing = line.price === '' || line.price == null

  return (
    <div className="grid grid-cols-12 gap-3 items-center p-3 bg-vault-darker/40 border border-vault-border rounded-lg">
      <div className={`col-span-5 flex items-center gap-3 min-w-0 ${meta.color}`}>
        <Icon size={20} className="flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-white font-medium truncate">{title}</div>
          <div className="text-xs text-gray-500 truncate">{sub}</div>
        </div>
      </div>

      <div className="col-span-2">
        <label className="block text-[10px] uppercase tracking-wider text-gray-500">
          Qty {available > 1 && <span className="text-gray-600 normal-case">/ {available}</span>}
        </label>
        {qtyEditable ? (
          <input
            type="number" min="1" max={available}
            value={qty}
            onChange={(e) => onUpdate(line.key, { quantity: Math.min(available, Math.max(1, parseInt(e.target.value) || 1)) })}
            disabled={disabled}
            className="w-full"
          />
        ) : (
          <div className="px-3 py-2 text-white">1</div>
        )}
      </div>

      <div className="col-span-2">
        <label className="block text-[10px] uppercase tracking-wider text-gray-500">Our price</label>
        <div className="px-2 py-2 text-sm text-gray-400 font-mono">
          {line.our_price != null ? `$${Number(line.our_price).toFixed(2)}` : '—'}
        </div>
      </div>

      <div className="col-span-2">
        <label className="block text-[10px] uppercase tracking-wider text-gray-500">
          Sold price <span className="text-red-400">*</span>
        </label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
          <input
            type="number" step="0.01" min="0"
            value={line.price}
            onChange={(e) => onUpdate(line.key, { price: e.target.value })}
            disabled={disabled}
            placeholder="0.00"
            className={`w-full pl-5 pr-2 py-2 text-right font-mono ${priceMissing ? 'border-red-500/50' : ''}`}
          />
        </div>
      </div>

      <div className="col-span-1 flex items-center justify-end gap-2">
        <span className="text-sm font-mono text-white whitespace-nowrap">{fmtUsd(subtotal)}</span>
        <button
          type="button"
          onClick={() => onRemove(line.key)}
          disabled={disabled}
          className="p-1 text-gray-400 hover:text-red-300"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// ManualEntrySection — 3-tab search-by-name (parallels StorefrontSale's)
// ============================================================================
function ManualEntrySection({ onPickSealed, onPickSingle, onPickSlab, disabled }) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('sealed')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  useEffect(() => { setQuery(''); setResults([]); setSearchError(null) }, [tab])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); setSearchError(null); return }
    setSearching(true); setSearchError(null)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        let rows = []
        if (tab === 'sealed')      rows = await searchProductsForStorefront(q)
        else if (tab === 'single') rows = await searchSinglesForStorefront(q)
        else if (tab === 'slab')   rows = await searchSlabsForStorefront(q)
        if (!cancelled) setResults(rows)
      } catch (err) {
        if (!cancelled) { setSearchError(err.message || 'Search failed'); setResults([]) }
      } finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, tab])

  const handlePick = (row) => {
    if (row.kind === 'sealed') onPickSealed(row)
    else if (row.kind === 'single') onPickSingle(row.single)
    else if (row.kind === 'slab')   onPickSlab(row.slab)
    setQuery(''); setResults([])
  }

  const placeholder = tab === 'sealed' ? 'Type a brand or product name…'
    : tab === 'single' ? 'Type card name, number, or TCG ID…'
    : 'Type slab name or cert#…'

  return (
    <div className="card mb-4">
      <button type="button" onClick={() => setExpanded(v => !v)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-vault-gold" />
          <span className="text-sm font-semibold text-white">Manual entry (no barcode)</span>
          <span className="text-xs text-gray-500">— search by name when scanner can't find it</span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-1 border-b border-vault-border/50 pb-2">
            <ManualTab active={tab === 'sealed'} onClick={() => setTab('sealed')} icon={Package} label="Sealed" color="text-amber-300" />
            <ManualTab active={tab === 'single'} onClick={() => setTab('single')} icon={Layers}  label="Single" color="text-blue-300" />
            <ManualTab active={tab === 'slab'}   onClick={() => setTab('slab')}   icon={Diamond} label="Slab"   color="text-emerald-300" />
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled}
              placeholder={placeholder} autoComplete="off" spellCheck={false}
              className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-sm focus:outline-none focus:border-vault-gold disabled:opacity-50"
            />
            {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />}
          </div>

          {searchError && <div className="text-xs text-red-400">{searchError}</div>}
          {!searchError && query.trim().length > 0 && query.trim().length < 2 && (
            <div className="text-xs text-gray-500">Type at least 2 characters…</div>
          )}
          {!searchError && query.trim().length >= 2 && !searching && results.length === 0 && (
            <div className="text-xs text-gray-500">No matches.</div>
          )}
          {results.length > 0 && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-vault-border/50 border border-vault-border rounded-md">
              {results.map((row, i) => (
                <li key={i}><ManualResultRow row={row} onPick={handlePick} disabled={disabled} /></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ManualTab({ active, onClick, icon: Icon, label, color }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active ? `bg-vault-darker/60 ${color}` : 'text-gray-400 hover:text-white'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

function ManualResultRow({ row, onPick, disabled }) {
  let Icon, color, title, sub, warning
  if (row.kind === 'sealed') {
    const totalQty = (row.inventory || []).reduce((s, r) => s + (r.quantity || 0), 0)
    Icon = Package; color = 'text-amber-300'
    title = `${row.product.brand} | ${row.product.name}`
    sub   = `${row.product.category || row.product.type || 'Sealed'} · ${row.product.language || '—'} · ${row.product.barcode ? 'UPC ' + row.product.barcode : 'no barcode'}`
    if (totalQty === 0) warning = 'No stock anywhere'
  } else if (row.kind === 'single') {
    Icon = Layers; color = 'text-blue-300'
    const num = row.single.card_number ? ` #${row.single.card_number}` : ''
    const setName = row.single.set?.name ? ` · ${row.single.set.name}` : ''
    title = `${row.single.card_name}${num}`
    sub   = `${row.single.condition || 'raw'}${setName} · TCG ${row.single.tcg_id} · qty ${row.single.quantity || 1}`
  } else if (row.kind === 'slab') {
    Icon = Diamond; color = 'text-emerald-300'
    title = row.slab.item_name
    sub   = `${row.slab.grading_company || '?'} · cert #${row.slab.cert_number}`
  } else return null

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-vault-darker/30 hover:bg-vault-darker/60 transition-colors">
      <Icon size={16} className={`${color} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{title}</div>
        <div className="text-xs text-gray-500 truncate">{sub}</div>
        {warning && <div className="text-[11px] text-amber-400 mt-0.5">⚠ {warning}</div>}
      </div>
      <button
        type="button" onClick={() => onPick(row)} disabled={disabled}
        className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md hover:bg-vault-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={12} /> Add
      </button>
    </div>
  )
}
