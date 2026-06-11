import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  fetchLocations, fetchInventory, createMovement, updateInventory, deleteMovement,
  fetchUsers, lookupScannedCode,
  moveSingleToLocation, moveSlabToLocation, markSlabAsSold,
  fetchSinglesAtLocation, fetchSlabsAtLocation,
  searchProductsForStorefront, searchSinglesForStorefront, searchSlabsForStorefront,
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { useAuth } from '../lib/AuthContext'
import {
  ArrowRightLeft, ArrowRight, Save, Plus, X, Trash2, ScanLine, Loader2,
  Package, Diamond, Layers, AlertTriangle, Search, ChevronDown, ChevronUp,
} from 'lucide-react'

// ============================================================================
// MovedInventory — unified scan + cart for moving sealed / singles / slabs
// ============================================================================
// Pick FROM + TO locations, then load the cart from any combination of:
//   1. Scan input (UPC → sealed, cert# → slab, TCG ID → single)
//   2. Manual search by name (three tabs)
// Each cart line carries its own kind; submit routes to the right backend:
//   sealed → existing createMovement + updateInventory flow (unchanged)
//   single → moveSingleToLocation (whole-row OR split if partial qty)
//   slab   → moveSlabToLocation
// One Lark message per batch — type='move' extended to render mixed kinds.
// ============================================================================

// All valid physical locations for inventory movement.
const ALLOWED_LOCATION_NAMES = [
  'Master Inventory',
  'Front Store',
  'Slab Room',
  'Stream Room - eBay LuckyVaultUS',
  'Stream Room - eBay SlabbiePatty',
  'Stream Room - TikTok RocketsHQ',
  'Stream Room - TikTok Packheads',
  'Stream Room - Whatnot',
  'Shows',
]

const KIND_META = {
  sealed: { icon: Package, color: 'text-amber-300',   label: 'Sealed' },
  single: { icon: Layers,  color: 'text-blue-300',    label: 'Single' },
  slab:   { icon: Diamond, color: 'text-emerald-300', label: 'Slab'   },
}

const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const re = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(re, '').trim() || fullName
}

export default function MovedInventory() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()

  const [locations, setLocations] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'))
  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [movedById, setMovedById] = useState('')
  const [notes, setNotes] = useState('')
  // Mystery Game mode — alternate flow for slab-blind-sales at the storefront
  // (directive 2026-06-02). Same scan-and-build-a-cart UX, but submit marks
  // each scanned slab as sold (markSlabAsSold) instead of moving it. Only
  // slabs are accepted in this mode — sealed / single scans get rejected.
  const [mysteryGame, setMysteryGame] = useState(false)
  // Bucket total for any slabs that don't have a reference price in
  // inventory. The cashier types ONE total at the bottom of the cart;
  // we equal-split it across the priceless slabs at submit time so each
  // gets a sensible sale_price_usd recorded.
  const [mysteryPricelessTotal, setMysteryPricelessTotal] = useState('')

  // Mixed-kind cart.
  //   sealed: { kind:'sealed', key, product_id, product, inventory_row, quantity }
  //   single: { kind:'single', key, single_id, single, available_qty, quantity }
  //   slab:   { kind:'slab',   key, slab_id, slab }
  const [cart, setCart] = useState([])

  // What's at the FROM location across all 3 kinds — used both for scan
  // validation ("is this item even in this room?") and to feed the
  // optional manual-search dropdown when there's no barcode.
  const [sealedAtFrom, setSealedAtFrom] = useState([])
  const [singlesAtFrom, setSinglesAtFrom] = useState([])
  const [slabsAtFrom, setSlabsAtFrom] = useState([])
  const [stockLoading, setStockLoading] = useState(false)

  const [scanValue, setScanValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [unknownCode, setUnknownCode] = useState(null)

  const scanRef = useRef(null)

  // ---------- load locations + users ----------
  useEffect(() => {
    (async () => {
      try {
        const [locData, userData] = await Promise.all([fetchLocations(), fetchUsers()])
        setLocations(locData)
        setUsers(userData)
        if (user?.id && userData.some(u => u.id === user.id)) {
          setMovedById(user.id)
        }
      } catch (err) {
        console.error('[MovedInventory] init load failed:', err)
        addToast('Failed to load data', 'error')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadStockAtFrom = useCallback(async (locationId) => {
    if (!locationId) {
      setSealedAtFrom([]); setSinglesAtFrom([]); setSlabsAtFrom([])
      return
    }
    setStockLoading(true)
    try {
      const [inv, singles, slabs] = await Promise.all([
        fetchInventory(locationId),
        fetchSinglesAtLocation(locationId),
        fetchSlabsAtLocation(locationId),
      ])
      // Sealed: filter to Sealed/Pack products only (other product types
      // shouldn't be moved through this UI).
      const sealedOnly = (inv || []).filter(r =>
        r.product?.type === 'Sealed' || r.product?.type === 'Pack'
      )
      setSealedAtFrom(sealedOnly)
      setSinglesAtFrom(singles)
      setSlabsAtFrom(slabs)
    } catch (err) {
      console.error('[MovedInventory] loadStockAtFrom failed:', err)
      addToast('Failed to load stock at source location', 'error')
    } finally {
      setStockLoading(false)
    }
  }, [addToast])

  // Reload stock when FROM changes. Also clear the cart since the source
  // changed (cart items are tied to the FROM location).
  useEffect(() => {
    loadStockAtFrom(fromLocationId)
    if (cart.length > 0) {
      setCart([])
      addToast?.('Cart cleared — source location changed', 'info')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLocationId])

  // ---------- derived ----------
  const allowedLocations = locations.filter(l => ALLOWED_LOCATION_NAMES.includes(l.name))
  const physicalLocations = allowedLocations.filter(l => l.type === 'Physical')
  const allDestinations = allowedLocations.filter(l => l.id !== fromLocationId)

  // How much of a sealed product is already reserved in cart
  const cartSealedQtyForProduct = (productId) =>
    cart.filter(c => c.kind === 'sealed' && c.product_id === productId)
        .reduce((s, c) => s + c.quantity, 0)
  const cartSingleQtyFor = (singleId) =>
    cart.filter(c => c.kind === 'single' && c.single_id === singleId)
        .reduce((s, c) => s + c.quantity, 0)
  const cartHasSlab = (slabId) =>
    cart.some(c => c.kind === 'slab' && c.slab_id === slabId)

  // ---------- cart line builders ----------
  const addSealedToCart = (productId, quantity) => {
    const invRow = sealedAtFrom.find(r => r.product_id === productId)
    if (!invRow) { addToast('Not in stock at source', 'error'); return }
    const inCart = cartSealedQtyForProduct(productId)
    const remaining = Math.max(0, (invRow.quantity || 0) - inCart)
    const qty = Math.max(1, Number(quantity) || 1)
    if (qty > remaining) {
      addToast(
        inCart > 0 ? `Only ${remaining} more available (${inCart} in cart)` : `Only ${remaining} available`,
        'error'
      )
      return
    }
    setCart(prev => {
      const idx = prev.findIndex(c => c.kind === 'sealed' && c.product_id === productId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty }
        return next
      }
      return [...prev, {
        kind: 'sealed',
        key: `sealed-${productId}`,
        product_id: productId,
        product: invRow.product,
        inventory_row: invRow,
        quantity: qty,
      }]
    })
    addToast(`Added: ${invRow.product?.name} × ${qty}`, 'success')
  }

  const addSingleToCart = (single, quantity = 1) => {
    if (!single) return
    const stockRow = singlesAtFrom.find(s => s.id === single.id)
    if (!stockRow) {
      addToast(`${single.card_name} is not at the source location`, 'error')
      return
    }
    const inCart = cartSingleQtyFor(single.id)
    const remaining = Math.max(0, (stockRow.quantity || 1) - inCart)
    const qty = Math.max(1, Number(quantity) || 1)
    if (remaining <= 0) {
      addToast('All units of this single are already in the cart', 'error')
      return
    }
    if (qty > remaining) {
      addToast(`Only ${remaining} more available`, 'error')
      return
    }
    setCart(prev => {
      const idx = prev.findIndex(c => c.kind === 'single' && c.single_id === single.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty }
        return next
      }
      return [...prev, {
        kind: 'single',
        key: `single-${single.id}`,
        single_id: single.id,
        single: stockRow,
        available_qty: stockRow.quantity || 1,
        quantity: qty,
      }]
    })
    addToast(`Added: ${single.card_name}`, 'success')
  }

  const addSlabToCart = (slab) => {
    if (!slab) return
    // Mystery Game mode doesn't need the slab to be at the FROM location —
    // it's being sold, not moved out of a particular shelf. Skip the
    // "is at source" check and use the slab as-is.
    let stockRow = slab
    if (!mysteryGame) {
      stockRow = slabsAtFrom.find(s => s.id === slab.id)
      if (!stockRow) {
        addToast(`${slab.item_name} is not at the source location`, 'error')
        return
      }
    }
    if (cartHasSlab(slab.id)) {
      addToast('Slab already in cart', 'info')
      return
    }
    // In Mystery mode, pre-fill the sold price from the slab's reference
    // (market / LV / list) so the cashier only types it in when overriding.
    const defaultPrice = mysteryGame
      ? (slab.market_price_usd != null ? Number(slab.market_price_usd)
         : slab.lv_price_usd != null ? Number(slab.lv_price_usd)
         : slab.list_price_usd != null ? Number(slab.list_price_usd)
         : '')
      : undefined
    setCart(prev => [...prev, {
      kind: 'slab',
      key: `slab-${slab.id}`,
      slab_id: slab.id,
      slab: stockRow,
      sale_price: mysteryGame ? String(defaultPrice ?? '') : undefined,
    }])
    addToast(`Added: ${slab.item_name}`, 'success')
  }

  // ---------- scan handler ----------
  const handleScan = async (e) => {
    e?.preventDefault?.()
    const code = scanValue.trim()
    if (!code) return
    // Mystery Game mode skips the FROM-location requirement (the slab is
    // being marked sold, not moved out of a specific shelf) and only
    // accepts slab scans. Sealed / single scans get rejected with a
    // clear toast so the cashier knows why the scan didn't add.
    if (!mysteryGame && !fromLocationId) {
      addToast('Pick FROM location first', 'error')
      setScanValue('')
      return
    }
    setScanning(true)
    setUnknownCode(null)
    try {
      const result = await lookupScannedCode(code)
      if (mysteryGame) {
        if (result.kind === 'unknown') {
          // Cert# doesn't exist in our slabs table at all — the cashier
          // needs to intake this slab via Cards Scan before it can be sold.
          addToast(`Slab cert #${code} not in inventory — add it via Cards Scan first, then scan again`, 'error')
          return
        }
        if (result.kind !== 'slab') {
          addToast('Mystery Game mode: slabs only. Sealed/single scans ignored.', 'info')
          return
        }
        // Reject non-sellable statuses with a specific reason so the cashier
        // knows exactly what to fix.
        const status = result.slab.status
        if (status === 'sold') {
          addToast(`Slab cert #${result.slab.cert_number} is already sold — can't resell`, 'error')
          return
        }
        if (status !== 'in_inventory' && status !== 'listed') {
          addToast(`Slab cert #${result.slab.cert_number} status is "${status}" — not available to sell`, 'error')
          return
        }
        // No-reference-price slabs are still allowed in Mystery Game — the
        // cashier enters one total at the bottom of the cart that we
        // equal-split across all priceless ones at submit time.
        addSlabToCart(result.slab)
      } else if (result.kind === 'sealed') {
        addSealedToCart(result.product.id, 1)
      } else if (result.kind === 'single') {
        addSingleToCart(result.single, 1)
      } else if (result.kind === 'slab') {
        addSlabToCart(result.slab)
      } else if (result.kind === 'unknown') {
        setUnknownCode(code)
      }
    } catch (err) {
      console.error('[MovedInventory] lookup failed:', err)
      addToast(`Lookup failed: ${err.message || err}`, 'error')
    } finally {
      setScanning(false)
      setScanValue('')
      setTimeout(() => scanRef.current?.focus(), 0)
    }
  }

  // ---------- cart editing ----------
  const updateLineQty = (key, qty) => {
    const newQty = Math.max(1, Number(qty) || 1)
    setCart(prev => prev.map(c => {
      if (c.key !== key) return c
      if (c.kind === 'slab') return c   // slabs always qty=1
      // Cap against available stock
      let maxQty = Infinity
      if (c.kind === 'sealed') {
        const invRow = sealedAtFrom.find(r => r.product_id === c.product_id)
        const otherInCart = cart
          .filter(o => o.kind === 'sealed' && o.product_id === c.product_id && o.key !== key)
          .reduce((s, o) => s + o.quantity, 0)
        maxQty = (invRow?.quantity || 0) - otherInCart
      } else if (c.kind === 'single') {
        maxQty = c.available_qty
      }
      const capped = Math.min(newQty, maxQty)
      if (capped !== newQty) addToast(`Capped to available: ${capped}`, 'info')
      return { ...c, quantity: capped }
    }))
  }

  const removeLine = (key) => setCart(prev => prev.filter(c => c.key !== key))
  const clearCart = () => {
    if (cart.length === 0) return
    if (!confirm('Clear cart?')) return
    setCart([])
  }

  // ---------- mystery game submit (mark each slab as sold) ----------
  const handleMysteryGameSubmit = async () => {
    const slabsOnly = cart.filter(c => c.kind === 'slab')
    if (slabsOnly.length === 0) {
      addToast('No slabs in cart to sell', 'error')
      return
    }
    // Split the priceless bucket equally across the slabs that didn't have
    // a reference price. Slabs with stored prices keep their own value.
    const priceless = slabsOnly.filter(c => c.sale_price === '' || c.sale_price == null)
    const pricelessTotal = Number(mysteryPricelessTotal) || 0
    if (priceless.length > 0 && pricelessTotal <= 0) {
      addToast(`Enter the total for ${priceless.length} priceless slab${priceless.length === 1 ? '' : 's'}`, 'error')
      return
    }
    const perPriceless = priceless.length > 0 ? pricelessTotal / priceless.length : 0
    // Build a key → effective price map for downstream use.
    const effectivePrice = (item) => {
      const p = Number(item.sale_price)
      if (!isNaN(p) && p >= 0 && item.sale_price !== '' && item.sale_price != null) return p
      return perPriceless
    }
    setSubmitting(true)
    // Shared transaction id so all slabs sold in one mystery game share a
    // grouping key downstream.
    const transactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `mg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const sold = []
    const failed = []
    try {
      for (const item of slabsOnly) {
        try {
          const price = effectivePrice(item)
          await markSlabAsSold(item.slab_id, {
            sale_price_usd: price,
            sale_channel: 'in_person',
            sale_date: date,
            sale_fees_usd: null,
            buyer_name: null,
            sale_notes: 'Mystery Game',
            sold_by_id: movedById || null,
            transaction_id: transactionId,
            transaction_type: 'sale',
          })
          sold.push({ ...item, price })
        } catch (err) {
          console.error('[MysteryGame] slab sell failed:', item, err)
          failed.push({ item, error: err.message || String(err) })
        }
      }
      // Drop the successfully-sold ones from the cart; keep failures so
      // the cashier can retry without losing context.
      const failedIds = new Set(failed.map(f => f.item.slab_id))
      setCart(prev => prev.filter(c => c.kind !== 'slab' || failedIds.has(c.slab_id)))
      // If nothing left in cart, clear the priceless total too.
      if (failed.length === 0) setMysteryPricelessTotal('')

      const totalPaid = sold.reduce((s, it) => s + it.price, 0)
      if (sold.length > 0) {
        addToast(
          `🎲 Mystery Game: sold ${sold.length} slab${sold.length === 1 ? '' : 's'} for $${totalPaid.toFixed(2)}${failed.length > 0 ? ` (${failed.length} failed)` : ''}`,
          failed.length > 0 ? 'info' : 'success',
        )
        // Lark — use the 'move' event type with a distinct prefix so the
        // inventory in/out group sees "mystery game" right at the top.
        try {
          const itemsForLark = sold.map(it => ({
            name: `${it.slab?.item_name || 'Slab'} cert#${it.slab?.cert_number}`,
            quantity: 1,
            kind: 'slab',
            price: it.price,
          }))
          fetch('/api/lark-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'move',
              fromLocation: '🎲 Mystery Game',
              toLocation: `Sold (${sold.length} slabs · $${totalPaid.toFixed(2)})`,
              items: itemsForLark,
              totalUnits: sold.length,
              user: users.find(u => u.id === movedById)?.name || 'Unknown',
            }),
          }).catch(() => {})
        } catch (_) {}
      }
      for (const f of failed) addToast(`Failed: cert#${f.item.slab?.cert_number} — ${f.error}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- submit ----------
  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (cart.length === 0) { addToast('Cart is empty', 'error'); return }
    if (mysteryGame) return handleMysteryGameSubmit()
    if (!fromLocationId || !toLocationId) { addToast('Pick FROM and TO locations', 'error'); return }
    if (fromLocationId === toLocationId) { addToast('FROM and TO must differ', 'error'); return }
    if (!movedById) { addToast('Pick who is moving the items', 'error'); return }

    setSubmitting(true)
    const completedSealed = []   // for undo
    const completedSingles = []  // {single_id, mode, ...} so we can reverse
    const completedSlabs = []    // {slab_id, prev_location_id}

    try {
      // ---- 1. Sealed: existing createMovement + updateInventory flow ----
      for (const item of cart.filter(c => c.kind === 'sealed')) {
        const inv = item.inventory_row
        const cost = (inv?.avg_cost_basis || 0) * item.quantity
        const movement = await createMovement({
          date,
          product_id: item.product_id,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          quantity: item.quantity,
          cost_basis: cost,
          movement_type: 'Transfer',
          notes,
          moved_by_id: movedById || null,
        })
        await updateInventory(item.product_id, fromLocationId, -item.quantity)
        await updateInventory(item.product_id, toLocationId, item.quantity, inv?.avg_cost_basis)
        completedSealed.push({
          movement_id: movement?.id,
          product_id: item.product_id,
          quantity: item.quantity,
          avg_cost_basis: inv?.avg_cost_basis,
        })
      }

      // ---- 2. Singles: per-row location flip (or split) ----
      for (const item of cart.filter(c => c.kind === 'single')) {
        const result = await moveSingleToLocation({
          singleId: item.single_id,
          fromLocationId,
          toLocationId,
          quantity: item.quantity,
          actorId: movedById || null,
        })
        completedSingles.push({
          single_id: item.single_id,
          quantity: item.quantity,
          ...result,   // {mode:'whole'|'split', clone?}
        })
      }

      // ---- 3. Slabs: per-row location flip ----
      for (const item of cart.filter(c => c.kind === 'slab')) {
        await moveSlabToLocation({
          slabId: item.slab_id,
          toLocationId,
          actorId: movedById || null,
        })
        completedSlabs.push({ slab_id: item.slab_id, prev_location_id: fromLocationId })
      }

      // ---- Lark (fire-and-forget) ----
      try {
        const fromLoc = locations.find(l => l.id === fromLocationId)
        const toLoc = locations.find(l => l.id === toLocationId)
        const movedByUser = users.find(u => u.id === movedById)
        const itemsForLark = cart.map(c => {
          if (c.kind === 'sealed') {
            return { name: c.product?.name || 'Unknown', quantity: c.quantity, kind: 'sealed' }
          }
          if (c.kind === 'single') {
            const num = c.single?.card_number ? ` #${c.single.card_number}` : ''
            return { name: `${c.single?.card_name || 'Single'}${num}`, quantity: c.quantity, kind: 'single' }
          }
          return { name: `${c.slab?.item_name || 'Slab'} cert#${c.slab?.cert_number}`, quantity: 1, kind: 'slab' }
        })
        const totalUnits = itemsForLark.reduce((s, it) => s + it.quantity, 0)
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'move',
            fromLocation: fromLoc?.name || 'Unknown',
            toLocation: toLoc?.name || 'Unknown',
            items: itemsForLark,
            user: movedByUser?.name || 'Unknown',
            totalUnits,
          }),
        }).catch(err => console.error('[lark-notify] move failed:', err))
      } catch (err) {
        console.error('[MovedInventory] build Lark payload failed:', err)
      }

      // ---- Undo callback ----
      const undo = async () => {
        try {
          for (const m of completedSealed) {
            await updateInventory(m.product_id, fromLocationId, m.quantity)
            await updateInventory(m.product_id, toLocationId, -m.quantity)
            if (m.movement_id) await deleteMovement(m.movement_id)
          }
          for (const m of completedSingles) {
            // Reverse via move back. moveSingleToLocation is idempotent
            // w.r.t. row identity for whole-row; for split moves we'd
            // ideally collapse the clone back into the source — for now
            // just move the clone (or whole row) back.
            const targetId = m.mode === 'split' ? m.clone?.id : m.single_id
            if (targetId) {
              try {
                await moveSingleToLocation({
                  singleId: targetId,
                  fromLocationId: toLocationId,
                  toLocationId: fromLocationId,
                  quantity: m.quantity,
                  actorId: movedById || null,
                })
              } catch (err) {
                console.warn('Undo single failed:', err)
              }
            }
          }
          for (const m of completedSlabs) {
            try {
              await moveSlabToLocation({
                slabId: m.slab_id,
                toLocationId: m.prev_location_id,
                actorId: movedById || null,
              })
            } catch (err) {
              console.warn('Undo slab failed:', err)
            }
          }
          addToast('Move undone', 'info')
          loadStockAtFrom(fromLocationId)
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }

      const totalUnits = cart.reduce((s, c) => s + (c.kind === 'slab' ? 1 : c.quantity), 0)
      addToast(
        `Moved ${cart.length} ${cart.length === 1 ? 'item' : 'items'} (${totalUnits} units)`,
        'success',
        { action: { label: 'Undo', onClick: undo } }
      )
      setCart([])
      setNotes('')
      loadStockAtFrom(fromLocationId)
    } catch (err) {
      console.error('[MovedInventory] submit failed:', err)
      addToast(`Failed: ${err.message || err}`, 'error')
      // Best-effort rollback of whatever already happened.
      try {
        for (const m of completedSealed) {
          await updateInventory(m.product_id, fromLocationId, m.quantity)
          await updateInventory(m.product_id, toLocationId, -m.quantity)
          if (m.movement_id) await deleteMovement(m.movement_id)
        }
        // Singles/slabs partial rollback is awkward (we'd need to know exact
        // source state). Log + warn rather than risk a broken state.
        if (completedSingles.length || completedSlabs.length) {
          addToast(`Singles/slabs partial-rollback may be needed — check audit log`, 'error')
        }
      } catch (rbErr) {
        console.error('[MovedInventory] rollback failed:', rbErr)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- render ----------
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }
  const totalCartUnits = cart.reduce((s, c) => s + (c.kind === 'slab' ? 1 : c.quantity), 0)
  // Mystery Game cart breakdown — used by the bottom summary + submit gate.
  const mgSlabs = mysteryGame ? cart.filter(c => c.kind === 'slab') : []
  const mgPriced = mgSlabs.filter(c => c.sale_price !== '' && c.sale_price != null)
  const mgPriceless = mgSlabs.filter(c => c.sale_price === '' || c.sale_price == null)
  const mgPricedSubtotal = mgPriced.reduce((s, c) => s + (Number(c.sale_price) || 0), 0)
  const mgPricelessTotalNum = Number(mysteryPricelessTotal) || 0
  const mgGrandTotal = mgPricedSubtotal + mgPricelessTotalNum
  const mgPricelessRequired = mgPriceless.length > 0
  const mgPricelessFilled = !mgPricelessRequired || mgPricelessTotalNum > 0

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ArrowRightLeft className="text-orange-400" />
          Move Inventory
        </h1>
        <p className="text-gray-400 mt-1">
          Transfer sealed products, singles, or slabs between locations — scan or search to add to the cart.
        </p>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p className="text-white font-medium">Three kinds of items, one flow:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>📦 Sealed (boxes/packs) → scan UPC barcode</li>
            <li>🎴 Single → scan/type TCG ID</li>
            <li>💎 Slab → scan/type cert#</li>
          </ul>
          <p className="text-xs text-gray-500">
            Scanning auto-detects which kind it is. No barcode? Use "Manual entry" below
            to search by name. Only items currently AT the FROM location can be added.
          </p>
        </div>
      </Instructions>

      {/* Switched from a wrapping <form onSubmit={handleSubmit}> to a plain
          <div> to fix a scanner-gun bug: some scanners send Enter via a
          path that bypasses input-level onKeyDown handlers, which then
          fell through to the form and triggered handleSubmit prematurely
          (looked like an auto-refresh / phantom save). The Submit button
          now calls handleSubmit directly via onClick. */}
      <div className="space-y-4">
        {/* Header — date / movedBy / from / to */}
        <div className={`card ${mysteryGame ? 'border-purple-500/40' : ''}`}>
          {/* Mode tabs — click 🎲 Mystery Game to flip the page from "move"
              semantics to "mark slabs as sold" semantics. Click 📦 Move to
              come back. Same tab styling as Storefront Sale's Sale/Trade/Buy
              so cashiers don't have to learn a new pattern. */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Mode:</span>
            <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
              <button
                type="button"
                onClick={() => { setMysteryGame(false) }}
                className={`px-3 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
                  !mysteryGame
                    ? 'bg-vault-gold text-vault-dark font-semibold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                📦 Move Inventory
              </button>
              <button
                type="button"
                onClick={() => { setMysteryGame(true); setToLocationId(''); setFromLocationId('') }}
                className={`px-3 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
                  mysteryGame
                    ? 'bg-purple-500/80 text-white font-semibold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                🎲 Mystery Game
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {mysteryGame ? 'Sold by *' : 'Moved By *'}
              </label>
              <select value={movedById} onChange={(e) => setMovedById(e.target.value)} required>
                <option value="">{mysteryGame ? 'Who is running the game...' : 'Who is moving these items...'}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          {!mysteryGame ? (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">From Location *</label>
                <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)} required>
                  <option value="">Select source...</option>
                  {physicalLocations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                </select>
              </div>
              <div className="flex justify-center">
                <ArrowRight className="text-vault-gold" size={24} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">To Location *</label>
                <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} required>
                  <option value="">Select destination...</option>
                  {allDestinations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="text-xs text-purple-200 bg-purple-500/10 border border-purple-500/30 rounded p-3">
              Mystery Game mode: just scan the slab cert# and the system will mark it sold at the price you enter. No FROM/TO needed.
            </div>
          )}
        </div>

        {/* Scan + manual entry — gated on FROM being picked OR Mystery Game on */}
        {(fromLocationId || mysteryGame) && (
          <>
            <div className="card">
              <div className="bg-vault-darker/40 border border-vault-border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <ScanLine size={20} className="text-vault-gold flex-shrink-0" />
                  <input
                    ref={scanRef}
                    type="text"
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(e) } }}
                    disabled={scanning || submitting}
                    placeholder="Scan UPC, slab cert#, or single TCG ID…"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="numeric"
                    className="flex-1 px-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-base focus:outline-none focus:border-vault-gold disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleScan}
                    disabled={scanning || submitting || !scanValue.trim()}
                    className="px-4 py-2 bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md text-sm hover:bg-vault-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {scanning ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
                  </button>
                </div>
                <div className="text-[11px] text-gray-500">
                  Auto-detects: UPC → sealed, cert# → slab, TCG ID → single. Item must be at the FROM location.
                </div>
              </div>

              {unknownCode && (
                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm">
                    <div className="text-amber-200">
                      <code className="bg-vault-darker px-1.5 py-0.5 rounded text-vault-gold">{unknownCode}</code> — not in system.
                    </div>
                    <div className="text-xs text-gray-300 mt-1">
                      📦 Sealed → register UPC on <a href="/product-barcodes" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">Product Barcodes</a>.
                      {' '}💎 Slab / 🎴 Single → ask the storefront team to intake it first.
                    </div>
                  </div>
                  <button onClick={() => setUnknownCode(null)} className="p-1 text-gray-400 hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <ManualEntrySection
              fromLocationId={fromLocationId}
              sealedAtFrom={sealedAtFrom}
              singlesAtFrom={singlesAtFrom}
              slabsAtFrom={slabsAtFrom}
              stockLoading={stockLoading}
              onPickSealed={(productId) => addSealedToCart(productId, 1)}
              onPickSingle={(single) => addSingleToCart(single, 1)}
              onPickSlab={(slab) => addSlabToCart(slab)}
              disabled={submitting}
            />
          </>
        )}

        {/* Cart */}
        {cart.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-display text-sm uppercase tracking-wide text-vault-gold">
                Cart — {cart.length} {cart.length === 1 ? 'item' : 'items'} · {totalCartUnits} units
              </h4>
              <button
                type="button"
                onClick={clearCart}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 size={14} /> Clear all
              </button>
            </div>
            <div className="space-y-2">
              {cart.map(item => (
                <CartRow
                  key={item.key}
                  item={item}
                  onQtyChange={(q) => updateLineQty(item.key, q)}
                  onSalePriceChange={(v) => setCart(prev => prev.map(c => c.key === item.key ? { ...c, sale_price: v } : c))}
                  onRemove={() => removeLine(item.key)}
                  mysteryGame={mysteryGame}
                  disabled={submitting}
                />
              ))}
            </div>
          </div>
        )}

        {/* Mystery Game cart summary — only shows the priceless bucket
            input when at least one slab in the cart has no reference price. */}
        {mysteryGame && cart.length > 0 && (
          <div className="card border-purple-500/30 space-y-3">
            {mgPriced.length > 0 && (
              <div className="flex justify-between items-center text-sm text-gray-300">
                <span>Priced slabs ({mgPriced.length}) — from inventory</span>
                <span className="font-mono text-vault-gold">${mgPricedSubtotal.toFixed(2)}</span>
              </div>
            )}
            {mgPricelessRequired && (
              <div className="flex justify-between items-center gap-3">
                <label className="flex flex-col text-sm text-gray-300">
                  <span>
                    Total for {mgPriceless.length} priceless slab{mgPriceless.length === 1 ? '' : 's'}
                    {' '}<span className="text-red-400">*</span>
                  </span>
                  <span className="text-[11px] text-gray-500 mt-0.5">
                    Split equally across them at submit
                  </span>
                </label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={mysteryPricelessTotal}
                    onChange={(e) => setMysteryPricelessTotal(e.target.value)}
                    placeholder="0.00"
                    disabled={submitting}
                    className={`w-32 text-right pl-5 font-mono ${
                      !mgPricelessFilled ? 'border-red-500/50' : ''
                    }`}
                  />
                </div>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-vault-border/50">
              <span className="text-sm text-gray-300">Grand total (Mystery Game)</span>
              <span className="text-xl font-bold text-purple-300 font-mono">${mgGrandTotal.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Notes + Submit */}
        <div className="card space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional, applied to all)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            className={`btn w-full ${mysteryGame ? 'btn-secondary border-purple-500/50 text-purple-200 hover:bg-purple-500/10' : 'btn-primary'}`}
            disabled={
              submitting || cart.length === 0
              || !movedById
              || (mysteryGame
                ? !mgPricelessFilled
                : (!fromLocationId || !toLocationId))
            }
          >
            {submitting
              ? <div className="spinner w-5 h-5 border-2"></div>
              : mysteryGame
                ? <><Save size={20} /> 🎲 Mark {cart.filter(c => c.kind === 'slab').length} slab{cart.filter(c => c.kind === 'slab').length === 1 ? '' : 's'} as sold</>
                : <><Save size={20} /> Move {cart.length || ''} {cart.length === 1 ? 'Item' : 'Items'}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// CartRow — kind-aware row in the cart
// ============================================================================
function CartRow({ item, onQtyChange, onRemove, onSalePriceChange, mysteryGame, disabled }) {
  const meta = KIND_META[item.kind]
  const Icon = meta.icon
  let title, sub, max, qtyEditable
  if (item.kind === 'sealed') {
    const inv = item.inventory_row
    const launchName = extractLaunchName(item.product?.name, item.product?.category)
    title = `${item.product?.brand} | ${launchName}`
    sub = `${item.product?.category || ''} · ${item.product?.language || ''} · ${inv?.quantity || 0} at source`
    max = inv?.quantity || 0
    qtyEditable = true
  } else if (item.kind === 'single') {
    const num = item.single?.card_number ? ` #${item.single.card_number}` : ''
    const setName = item.single?.set?.name ? ` · ${item.single.set.name}` : ''
    title = `${item.single?.card_name || 'Single'}${num}`
    sub = `${item.single?.condition || 'raw'}${setName} · TCG ${item.single?.tcg_id || '?'} · ${item.available_qty} at source`
    max = item.available_qty
    qtyEditable = true
  } else {
    title = item.slab?.item_name || 'Slab'
    sub = `${item.slab?.grading_company || ''} · cert #${item.slab?.cert_number}`
    if (item.slab?.sheet_note) sub += ` · 📝 ${item.slab.sheet_note}`
    max = 1
    qtyEditable = false
  }

  return (
    <div className="grid grid-cols-12 gap-3 items-center p-3 bg-vault-darker/40 border border-vault-border rounded-lg">
      <div className={`col-span-7 md:col-span-8 flex items-center gap-3 min-w-0 ${meta.color}`}>
        <Icon size={20} className="flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-white font-medium truncate">{title}</div>
          <div className="text-xs text-gray-500 truncate">{sub}</div>
        </div>
      </div>
      <div className="col-span-3 md:col-span-3">
        {mysteryGame && item.kind === 'slab' ? (
          <>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">
              Sold @ (from inventory)
            </label>
            <div className="text-right font-mono text-vault-gold pt-1">
              {item.sale_price != null && item.sale_price !== ''
                ? `$${Number(item.sale_price).toFixed(2)}`
                : '—'}
            </div>
          </>
        ) : (
          <>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">
              Qty {max > 1 && <span className="text-gray-600 normal-case">/ {max}</span>}
            </label>
            {qtyEditable ? (
              <input
                type="number"
                min="1"
                max={max}
                value={item.quantity}
                onChange={(e) => onQtyChange(e.target.value)}
                disabled={disabled}
                className="w-full"
              />
            ) : (
              <div className="text-white text-sm pt-1">1</div>
            )}
          </>
        )}
      </div>
      <div className="col-span-2 md:col-span-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-gray-400 hover:text-red-400 p-1"
          aria-label="Remove"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// ManualEntrySection — search by name when scanner can't find it
// ============================================================================
// Three tabs. Each searches the corresponding "at FROM location" list.
// We do this CLIENT-SIDE (no Supabase query per keystroke) because the
// FROM-location lists are already loaded, typically small (<500 rows), and
// always need to be filtered by "is at this location" anyway.
function ManualEntrySection({
  fromLocationId,
  sealedAtFrom, singlesAtFrom, slabsAtFrom,
  stockLoading,
  onPickSealed, onPickSingle, onPickSlab,
  disabled,
}) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('sealed')
  const [query, setQuery] = useState('')

  useEffect(() => { setQuery('') }, [tab, fromLocationId])

  const q = query.trim().toLowerCase()
  const filterByQ = (text) => !q || (text || '').toLowerCase().includes(q)

  const sealedResults = useMemo(() => {
    if (q.length < 1) return sealedAtFrom.slice(0, 20)
    return sealedAtFrom
      .filter(r => filterByQ(`${r.product?.brand} ${r.product?.name} ${r.product?.category}`))
      .slice(0, 20)
  }, [q, sealedAtFrom])
  const singleResults = useMemo(() => {
    if (q.length < 1) return singlesAtFrom.slice(0, 20)
    return singlesAtFrom
      .filter(r => filterByQ(`${r.card_name} ${r.card_number} ${r.tcg_id}`))
      .slice(0, 20)
  }, [q, singlesAtFrom])
  const slabResults = useMemo(() => {
    if (q.length < 1) return slabsAtFrom.slice(0, 20)
    return slabsAtFrom
      .filter(r => filterByQ(`${r.item_name} ${r.cert_number}`))
      .slice(0, 20)
  }, [q, slabsAtFrom])

  const placeholder = tab === 'sealed' ? 'Type brand or product name…'
    : tab === 'single' ? 'Type card name, number, or TCG ID…'
    : 'Type slab name or cert#…'
  const stockCount = tab === 'sealed' ? sealedAtFrom.length
    : tab === 'single' ? singlesAtFrom.length : slabsAtFrom.length

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Search size={16} className="text-vault-gold" />
          <span className="text-sm font-semibold text-white">Manual entry (no barcode)</span>
          <span className="text-xs text-gray-500">
            — search what's at the FROM location
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-1 border-b border-vault-border/50 pb-2">
            <ManualTab active={tab === 'sealed'} onClick={() => setTab('sealed')} icon={Package} label={`Sealed (${sealedAtFrom.length})`} color="text-amber-300" />
            <ManualTab active={tab === 'single'} onClick={() => setTab('single')} icon={Layers}  label={`Single (${singlesAtFrom.length})`} color="text-blue-300" />
            <ManualTab active={tab === 'slab'}   onClick={() => setTab('slab')}   icon={Diamond} label={`Slab (${slabsAtFrom.length})`}   color="text-emerald-300" />
            {stockLoading && <Loader2 size={12} className="text-gray-500 animate-spin ml-2" />}
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={disabled}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-md text-white text-sm focus:outline-none focus:border-vault-gold disabled:opacity-50"
            />
          </div>

          {stockCount === 0 && !stockLoading && (
            <div className="text-xs text-gray-500">Nothing of this kind is at the source location.</div>
          )}

          {tab === 'sealed' && sealedResults.length > 0 && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-vault-border/50 border border-vault-border rounded-md">
              {sealedResults.map(r => (
                <ResultRow
                  key={r.product_id}
                  icon={Package} color="text-amber-300"
                  title={`${r.product?.brand} | ${extractLaunchName(r.product?.name, r.product?.category)}`}
                  sub={`${r.product?.category || ''} · ${r.product?.language || ''} · ${r.quantity} in stock`}
                  onAdd={() => onPickSealed(r.product_id)}
                  disabled={disabled}
                />
              ))}
            </ul>
          )}
          {tab === 'single' && singleResults.length > 0 && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-vault-border/50 border border-vault-border rounded-md">
              {singleResults.map(r => {
                const num = r.card_number ? ` #${r.card_number}` : ''
                const setName = r.set?.name ? ` · ${r.set.name}` : ''
                return (
                  <ResultRow
                    key={r.id}
                    icon={Layers} color="text-blue-300"
                    title={`${r.card_name || 'Single'}${num}`}
                    sub={`${r.condition || 'raw'}${setName} · TCG ${r.tcg_id || '?'} · qty ${r.quantity}`}
                    onAdd={() => onPickSingle(r)}
                    disabled={disabled}
                  />
                )
              })}
            </ul>
          )}
          {tab === 'slab' && slabResults.length > 0 && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-vault-border/50 border border-vault-border rounded-md">
              {slabResults.map(r => (
                <ResultRow
                  key={r.id}
                  icon={Diamond} color="text-emerald-300"
                  title={r.item_name}
                  sub={`${r.grading_company || ''} · cert #${r.cert_number}`}
                  onAdd={() => onPickSlab(r)}
                  disabled={disabled}
                />
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
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active ? `bg-vault-darker/60 ${color}` : 'text-gray-400 hover:text-white'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

function ResultRow({ icon: Icon, color, title, sub, onAdd, disabled }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 bg-vault-darker/30 hover:bg-vault-darker/60 transition-colors">
      <Icon size={16} className={`${color} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{title}</div>
        <div className="text-xs text-gray-500 truncate">{sub}</div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-vault-gold/20 border border-vault-gold/40 text-vault-gold rounded-md hover:bg-vault-gold/30 disabled:opacity-50"
      >
        <Plus size={12} />
        Add
      </button>
    </li>
  )
}
