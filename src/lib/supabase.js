import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://dqreqevbjszercgackuc.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxcmVxZXZianN6ZXJjZ2Fja3VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzU4NzcsImV4cCI6MjA5MzA1MTg3N30.vDu1lA5SJLpA_mRhAF5JkVSreP_F4Q9g_Ta-9xm-UdU'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Static exchange rates (no external API calls)
const exchangeRates = {
  USD: 1,
  JPY: 0.0067,  // 1 JPY = ~0.0067 USD
  RMB: 0.14     // 1 RMB = ~0.14 USD
}

export const getExchangeRates = () => exchangeRates

export const convertToUSD = (amount, currency) => {
  return amount * (exchangeRates[currency] || 1)
}

// Data fetching helpers
export const fetchProducts = async (filters = {}) => {
  let query = supabase.from('products').select('*').eq('active', true)
  
  if (filters.brand) query = query.eq('brand', filters.brand)
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.language) query = query.eq('language', filters.language)
  if (filters.breakable !== undefined) query = query.eq('breakable', filters.breakable)
  
  const { data, error } = await query.order('brand').order('type').order('name')
  if (error) throw error
  return data || []
}

export const fetchLocations = async (type = null) => {
  let query = supabase.from('locations').select('*').eq('active', true)
  if (type) query = query.eq('type', type)
  const { data, error } = await query.order('name')
  if (error) throw error
  return data || []
}

export const fetchUsers = async (canLogin = null) => {
  let query = supabase.from('users').select('*').eq('active', true)
  if (canLogin !== null) query = query.eq('can_login', canLogin)
  const { data, error } = await query.order('name')
  if (error) throw error
  return data || []
}

export const fetchVendors = async () => {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data || []
}

export const fetchPaymentMethods = async () => {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data || []
}

export const fetchInventory = async (locationId = null) => {
  let query = supabase
    .from('inventory')
    .select(`
      *,
      product:products(*),
      location:locations(*)
    `)
    .gt('quantity', 0)
    .or('deleted.is.null,deleted.eq.false')
  
  if (locationId) query = query.eq('location_id', locationId)
  
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export const fetchAcquisitions = async (status = null, dateFrom = null, dateTo = null) => {
  let query = supabase
    .from('acquisitions')
    .select(`
      *,
      acquirer:users!acquirer_id(name),
      vendor:vendors(name),
      payment_method:payment_methods(name),
      product:products(*)
    `)
  
  if (status) query = query.eq('status', status)
  if (dateFrom) query = query.gte('date_purchased', dateFrom)
  if (dateTo) query = query.lte('date_purchased', dateTo)
  
  const { data, error } = await query.order('date_purchased', { ascending: false })
  if (error) throw error
  return data || []
}

export const fetchHighValueItems = async (status = null) => {
  let query = supabase
    .from('high_value_items')
    .select(`
      *,
      location:locations(name),
      acquirer:users!high_value_items_acquirer_id_fkey(name),
      vendor:vendors(name)
    `)
    .or('deleted.is.null,deleted.eq.false')
  
  if (status) query = query.eq('status', status)
  
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Create/Insert helpers
export const createAcquisition = async (acquisition) => {
  const { data, error } = await supabase
    .from('acquisitions')
    .insert(acquisition)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createReceipt = async (receipt) => {
  const { data, error } = await supabase
    .from('receipts')
    .insert(receipt)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createMovement = async (movement) => {
  const { data, error } = await supabase
    .from('movements')
    .insert(movement)
    .select()
    .single()
  if (error) throw error
  return data
}

// Hard-delete a movement row. Used by Undo to reverse a transfer.
// The caller is responsible for separately reversing the inventory deltas.
export const deleteMovement = async (movementId) => {
  const { error } = await supabase
    .from('movements')
    .delete()
    .eq('id', movementId)
  if (error) throw error
}

// ----- Generic delete helpers used by Undo flows -----
// Each one hard-deletes the given row by id. Inventory deltas (if any)
// must be reversed separately by the caller.
const makeDeleter = (table) => async (id) => {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

export const deleteAcquisition       = makeDeleter('acquisitions')
export const deleteReceipt           = makeDeleter('receipts')
export const deleteBoxBreak          = makeDeleter('box_breaks')
export const deleteShipment          = makeDeleter('shipments')
export const deleteGradingSubmission = makeDeleter('grading_submissions')
export const deleteStorefrontSale    = makeDeleter('storefront_sales')
export const deletePlatformSale      = makeDeleter('platform_sales')
export const deleteBusinessExpense   = makeDeleter('business_expenses')
export const deleteHighValueItem     = makeDeleter('high_value_items')
export const deleteHighValueMovement = makeDeleter('high_value_movements')
// NOTE: stream_counts uses soft-delete exclusively (see softDeleteStreamCount
// below). Hard-deleting orphans the linked stream_reconciliation (ON DELETE
// CASCADE), drops the Lark audit trail, and is unrecoverable — so we no
// longer expose a hard-delete helper for this table.
export const deleteOnlineOrder       = makeDeleter('online_orders')

// ----- Online Orders (outbound shipment tracker) -----
// Header + line items live in two tables; the page calls these in sequence
// inside its own try/catch so partial failures can be undone.

export const createOnlineOrder = async (order) => {
  const { data, error } = await supabase
    .from('online_orders')
    .insert(order)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createOnlineOrderItem = async (item) => {
  const { data, error } = await supabase
    .from('online_order_items')
    .insert(item)
    .select()
    .single()
  if (error) throw error
  return data
}

export const fetchRecentOnlineOrders = async (limit = 20) => {
  const { data, error } = await supabase
    .from('online_orders')
    .select(`
      *,
      handled_by:users!handled_by_id(name),
      source_location:locations!source_location_id(name),
      items:online_order_items(*, product:products(id, brand, name, language, category))
    `)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// Stream count items are joined by stream_count_id, not by their own id —
// delete them with a ranged delete. Used to undo a stream count submission.
export const deleteStreamCountItemsByCountId = async (streamCountId) => {
  const { error } = await supabase
    .from('stream_count_items')
    .delete()
    .eq('stream_count_id', streamCountId)
  if (error) throw error
}

export const createBoxBreak = async (boxBreak) => {
  const { data, error } = await supabase
    .from('box_breaks')
    .insert(boxBreak)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createShipment = async (shipment) => {
  const { data, error } = await supabase
    .from('shipments')
    .insert(shipment)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createGradingSubmission = async (submission) => {
  const { data, error } = await supabase
    .from('grading_submissions')
    .insert(submission)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createStorefrontSale = async (sale) => {
  const { data, error } = await supabase
    .from('storefront_sales')
    .insert(sale)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createHighValueItem = async (item) => {
  const { data, error } = await supabase
    .from('high_value_items')
    .insert(item)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createVendor = async (vendor) => {
  const { data, error } = await supabase
    .from('vendors')
    .insert(vendor)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createProduct = async (product) => {
  const { data, error } = await supabase
    .from('products')
    .insert(product)
    .select()
    .single()
  if (error) throw error
  return data
}

// Associate a scanned barcode with an existing product. Called from the
// BarcodeScanner's "unknown barcode" modal after the user picks the SKU
// to associate. DB has a partial unique index on barcode, so a duplicate
// barcode will throw — caller toasts the error.
export const updateProductBarcode = async (productId, barcode) => {
  const clean = (barcode || '').trim()
  if (!clean) throw new Error('barcode is empty')
  const { data, error } = await supabase
    .from('products')
    .update({ barcode: clean })
    .eq('id', productId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ============================================================================
// Smart allocation suggestions for Intake to Master
// ============================================================================
// When a shipment lands at Master Inventory and is "big enough" per category
// thresholds below, the receive flow opens an Allocator modal that recommends
// how the new units should split across Stream Rooms + Front Store based on
// last 7 days of sales at each. Logic per directive 2026-06-02:
//   - Velocity per room = (last 7 days sold at that room) / 7
//   - Target stock per room = velocity × daysCoverage (default 4 days)
//   - Suggested send = max(0, target − current stock at that room)
//   - "Dying" SKU = total daily velocity across all rooms < 1/day → suggest 0
//     (don't push out from Master if nothing's moving)
//   - If sum of suggestions > qty received → scale down proportionally;
//     leftover goes to the room with the highest velocity.
// ============================================================================

// Per-category trigger thresholds (qty received ≥ threshold → auto-open
// modal; below threshold → toast with optional "Allocate?" link override).
// Anything not in the map falls back to DEFAULT.
export const ALLOCATION_THRESHOLDS = {
  'Booster Pack':              100,
  'Booster Box':                30,
  'ETB':                        10,
  'Collection Box':             10,
  'Premium Collection':         10,
  'Ultra-Premium Collection':   10,
}
export const DEFAULT_ALLOCATION_THRESHOLD = 10
export const shouldAutoAllocate = (category, qty) => {
  const t = ALLOCATION_THRESHOLDS[category] ?? DEFAULT_ALLOCATION_THRESHOLD
  return (Number(qty) || 0) >= t
}

// Channel string (in platform_sales.channel) → physical Stream Room name
// (matches CHANNELS array in PlatformSales.jsx). Front Store is handled
// separately via storefront_sales below.
const CHANNEL_TO_STREAM_ROOM = {
  'SlabbiePatty':  'Stream Room - eBay SlabbiePatty',
  'LuckyVaultUS':  'Stream Room - eBay LuckyVaultUS',
  'PackHeadsTCG':  'Stream Room - TikTok Packheads',
  'RocketsHQ':     'Stream Room - TikTok RocketsHQ',
  'Whatnot':       'Stream Room - Whatnot',
}

export const computeAllocationSuggestion = async ({
  productId,
  qtyAvailable,
  daysCoverage = 4,
  windowDays = 7,
  dyingThreshold = 1,   // < 1 unit/day total = "dying"
}) => {
  if (!productId) throw new Error('productId required')
  const today = new Date().toLocaleDateString('en-CA')
  const from = new Date()
  from.setDate(from.getDate() - windowDays + 1)
  const fromStr = from.toLocaleDateString('en-CA')

  const [locsRes, invRes, sfRes, psRes] = await Promise.all([
    supabase.from('locations').select('id, name, type').eq('active', true),
    supabase.from('inventory').select('quantity, location_id').eq('product_id', productId),
    supabase.from('storefront_sales')
      .select('quantity, transaction_type')
      .eq('product_id', productId).eq('deleted', false)
      .gte('date', fromStr).lte('date', today),
    supabase.from('platform_sales')
      .select('quantity, channel')
      .eq('product_id', productId)
      .gte('date', fromStr).lte('date', today),
  ])
  if (locsRes.error) throw locsRes.error
  if (invRes.error)  throw invRes.error
  if (sfRes.error)   throw sfRes.error
  if (psRes.error)   throw psRes.error

  // Storefront sales count only forward sales (sale | trade), not buys/refunds
  const sfSold = (sfRes.data || [])
    .filter(r => r.transaction_type === 'sale' || r.transaction_type === 'trade' || r.transaction_type == null)
    .reduce((s, r) => s + (Number(r.quantity) || 0), 0)
  const psByChannel = {}
  for (const r of psRes.data || []) {
    psByChannel[r.channel] = (psByChannel[r.channel] || 0) + (Number(r.quantity) || 0)
  }
  const totalSold7d = sfSold + Object.values(psByChannel).reduce((s, v) => s + v, 0)
  const totalVelocity = totalSold7d / windowDays
  const isDying = totalVelocity < dyingThreshold

  // Current stock per location id (sum across rows in case of duplicates)
  const stockByLocId = {}
  for (const r of invRes.data || []) {
    stockByLocId[r.location_id] = (stockByLocId[r.location_id] || 0) + (Number(r.quantity) || 0)
  }
  const allLocs = locsRes.data || []
  const locByName = new Map(allLocs.map(l => [l.name, l]))

  // Build a row per Stream Room + one for Front Store. Skip rooms whose
  // location isn't configured (handles dev/test environments).
  const rows = []
  for (const [channel, roomName] of Object.entries(CHANNEL_TO_STREAM_ROOM)) {
    const loc = locByName.get(roomName)
    if (!loc) continue
    const sold = psByChannel[channel] || 0
    const daily = sold / windowDays
    const current = stockByLocId[loc.id] || 0
    const target = Math.ceil(daily * daysCoverage)
    const suggested = isDying ? 0 : Math.max(0, target - current)
    rows.push({
      location_id: loc.id, location_name: roomName, channel,
      sold_in_window: sold, daily_velocity: +daily.toFixed(2),
      current_stock: current, target, suggested_send: suggested,
    })
  }
  const fs = locByName.get('Front Store')
  if (fs) {
    const daily = sfSold / windowDays
    const current = stockByLocId[fs.id] || 0
    const target = Math.ceil(daily * daysCoverage)
    const suggested = isDying ? 0 : Math.max(0, target - current)
    rows.push({
      location_id: fs.id, location_name: 'Front Store', channel: 'Storefront',
      sold_in_window: sfSold, daily_velocity: +daily.toFixed(2),
      current_stock: current, target, suggested_send: suggested,
    })
  }

  // Scale down if our suggestions overshoot the qty we actually have.
  let totalSuggested = rows.reduce((s, r) => s + r.suggested_send, 0)
  if (totalSuggested > qtyAvailable && totalSuggested > 0) {
    const factor = qtyAvailable / totalSuggested
    let allocated = 0
    for (const r of rows) {
      r.suggested_send = Math.floor(r.suggested_send * factor)
      allocated += r.suggested_send
    }
    const leftover = qtyAvailable - allocated
    if (leftover > 0) {
      const top = [...rows].sort((a, b) => b.daily_velocity - a.daily_velocity)[0]
      if (top) top.suggested_send += leftover
    }
    totalSuggested = qtyAvailable
  }

  const baseline = {
    is_dying: isDying,
    total_sold_in_window: totalSold7d,
    total_daily_velocity: +totalVelocity.toFixed(2),
    qty_available: qtyAvailable,
    days_coverage: daysCoverage,
    window_days: windowDays,
    total_suggested: totalSuggested,
    rows,
  }
  // Refinement hook — no-op today; will use accumulated allocation_decisions
  // history (and eventually LLM) to nudge the per-row suggested_send when
  // there's enough history to learn from.
  return await enrichSuggestionWithHistory(baseline, productId, { daysCoverage })
}

// Log a single decision from the BatchAllocatorModal. Fire-and-forget by
// design — the user's action (Apply / Skip) already succeeded before we
// reach this point, so a failed log doesn't roll anything back.
//   action: 'apply_suggested' | 'apply_adjusted' | 'skip' | 'batch_apply_all'
//   suggestion: the full suggestion object returned by
//               computeAllocationSuggestion() — we pull params off it
//   finalRows: [{ location_id, location_name, send }] — what actually
//              committed (for skip, the user's last edit numbers if any)
export const logAllocationDecision = async ({
  productId, product, qtyReceived,
  suggestion, finalRows, action, decidedById = null, notes = null,
}) => {
  if (!productId || !suggestion) return  // best-effort; never throw
  try {
    const { error } = await supabase
      .from('allocation_decisions')
      .insert({
        product_id: productId,
        product_category: product?.category || null,
        product_brand: product?.brand || null,
        qty_received: qtyReceived,
        suggested_split: (suggestion.rows || []).map(r => ({
          location_id: r.location_id,
          location_name: r.location_name,
          daily_velocity: r.daily_velocity,
          current_stock: r.current_stock,
          target: r.target,
          suggested_send: r.suggested_send,
        })),
        final_split: (finalRows || []).map(r => ({
          location_id: r.location_id,
          location_name: r.location_name,
          actual_send: Number(r.send) || 0,
        })),
        action,
        days_coverage: suggestion.days_coverage,
        is_dying_flag: !!suggestion.is_dying,
        total_sold_7d_at_decision: suggestion.total_sold_in_window,
        decided_by_id: decidedById,
        notes,
      })
    if (error) console.warn('[logAllocationDecision] insert failed:', error.message)
  } catch (err) {
    console.warn('[logAllocationDecision] threw:', err)
  }
}

// Hook reserved for a future LLM/learned-rule refinement layer. Today it
// just returns the baseline unchanged. The signature is stable so when we
// wire up Claude or a heuristic refinement later, all upstream code paths
// stay unchanged — see computeAllocationSuggestion() below.
async function enrichSuggestionWithHistory(baseline /*, productId, options */) {
  // TODO when we have ~20+ decisions per product: pull
  //   allocation_decisions + post-decision sales for this productId
  //   (or its category), feed Claude with the context, apply LLM
  //   adjustments to baseline.rows[].suggested_send.
  return baseline
}

export const createHighValueMovement = async (movement) => {
  const { data, error } = await supabase
    .from('high_value_movements')
    .insert(movement)
    .select()
    .single()
  if (error) throw error
  return data
}

// Update helpers
export const updateInventory = async (productId, locationId, quantityChange, newAvgCost = null) => {
  // First try to get existing inventory record
  // Use maybeSingle() so that 0 rows returns null instead of throwing 406
  const { data: existing } = await supabase
    .from('inventory')
    .select('*')
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle()
  
  if (existing) {
    const newQuantity = existing.quantity + quantityChange
    const updateData = {
      quantity: newQuantity,
      last_updated: new Date().toISOString()
    }
    if (newAvgCost !== null) {
      // Weighted-average cost basis.
      //
      //  - quantityChange > 0  (we're ADDING stock at newAvgCost):
      //      new cost = (oldQty * oldCost + addedQty * newAvgCost) / newQty
      //    This preserves the historical cost of stock already in the bin
      //    instead of clobbering it with the latest batch's price.
      //  - quantityChange <= 0 (we're REMOVING stock — sale, transfer-out,
      //    break, etc.): the cost basis of what's left doesn't change.
      //    Cost basis tracks what we *paid* for the remaining units; an
      //    outflow event doesn't repurchase them.
      //  - oldQty <= 0 (edge case: bin was empty / negative): no history
      //    to weight against — just adopt the incoming cost.
      //
      // Prior behaviour was a hard overwrite, which silently corrupted
      // avg_cost_basis on every intake / move / break and made downstream
      // cost-of-goods and inventory-value figures unreliable.
      if (quantityChange > 0 && newQuantity > 0) {
        const oldQty = existing.quantity || 0
        const oldCost = parseFloat(existing.avg_cost_basis || 0)
        updateData.avg_cost_basis = oldQty > 0
          ? (oldQty * oldCost + quantityChange * newAvgCost) / newQuantity
          : newAvgCost
      }
    }

    const { data, error } = await supabase
      .from('inventory')
      .update(updateData)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data
  } else {
    // Create new inventory record
    const { data, error } = await supabase
      .from('inventory')
      .insert({
        product_id: productId,
        location_id: locationId,
        quantity: quantityChange,
        avg_cost_basis: newAvgCost || 0
      })
      .select()
      .single()
    if (error) throw error
    return data
  }
}

// Manual inventory update - handles null cost basis properly (doesn't affect averages)
// Also supports additional metadata like grading_company, grade, current_market_price
export const updateInventoryManual = async (productId, locationId, quantityChange, costBasis = null, metadata = {}) => {
  // First try to get existing inventory record
  // Use maybeSingle() so that 0 rows returns null instead of throwing 406
  const { data: existing } = await supabase
    .from('inventory')
    .select('*')
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle()
  
  if (existing) {
    const newQuantity = existing.quantity + quantityChange
    const updateData = { 
      quantity: newQuantity,
      last_updated: new Date().toISOString()
    }
    
    // Only update cost basis if provided AND existing has cost basis
    // This prevents items with unknown cost from affecting the average
    if (costBasis !== null) {
      // Calculate weighted average cost only if both have cost basis
      if (existing.avg_cost_basis && existing.avg_cost_basis > 0) {
        const existingValue = existing.quantity * existing.avg_cost_basis
        const newValue = quantityChange * costBasis
        updateData.avg_cost_basis = (existingValue + newValue) / newQuantity
      } else {
        // No existing cost basis, just use the new one
        updateData.avg_cost_basis = costBasis
      }
    }
    // If costBasis is null, we intentionally don't update avg_cost_basis
    // This means items with unknown cost don't affect the average
    
    // Add metadata fields if provided
    if (metadata.current_market_price !== undefined) {
      updateData.current_market_price = metadata.current_market_price
    }
    if (metadata.grading_company) {
      updateData.grading_company = metadata.grading_company
    }
    if (metadata.grade) {
      updateData.grade = metadata.grade
    }
    if (metadata.is_high_value !== undefined) {
      updateData.is_high_value = metadata.is_high_value
    }
    
    const { data, error } = await supabase
      .from('inventory')
      .update(updateData)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data
  } else {
    // Create new inventory record
    const insertData = {
      product_id: productId,
      location_id: locationId,
      quantity: quantityChange,
      // Keep avg_cost_basis as null if not provided - important for not affecting averages
      avg_cost_basis: costBasis
    }
    
    // Add metadata fields if provided
    if (metadata.current_market_price !== undefined) {
      insertData.current_market_price = metadata.current_market_price
    }
    if (metadata.grading_company) {
      insertData.grading_company = metadata.grading_company
    }
    if (metadata.grade) {
      insertData.grade = metadata.grade
    }
    if (metadata.is_high_value !== undefined) {
      insertData.is_high_value = metadata.is_high_value
    }
    
    const { data, error } = await supabase
      .from('inventory')
      .insert(insertData)
      .select()
      .single()
    if (error) throw error
    return data
  }
}

export const updateAcquisitionStatus = async (id, status, quantityReceived = null) => {
  const updateData = { status, updated_at: new Date().toISOString() }
  if (quantityReceived !== null) {
    updateData.quantity_received = quantityReceived
  }
  
  const { data, error } = await supabase
    .from('acquisitions')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export const updateHighValueItem = async (id, updates) => {
  const { data, error } = await supabase
    .from('high_value_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export const updateHighValueItemLocation = async (id, locationId) => {
  const { data, error } = await supabase
    .from('high_value_items')
    .update({ location_id: locationId })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ============================================
// STREAM COUNTS FUNCTIONS
// ============================================

export const createStreamCount = async (streamCount) => {
  const { data, error } = await supabase
    .from('stream_counts')
    .insert(streamCount)
    .select()
    .single()
  if (error) throw error
  return data
}

export const createStreamCountItems = async (items) => {
  const { data, error } = await supabase
    .from('stream_count_items')
    .insert(items)
    .select()
  if (error) throw error
  return data
}

// Soft-delete: mark a stream_count as deleted instead of removing the row.
//
// Two callers:
//   1. Post-submit Undo flow (StreamCounts.jsx) — passes no opts. The row
//      gets deleted=true + deleted_at=now() so we know WHEN, but
//      deleted_by_id, deleted_reason, and delete_mode stay null (the
//      submitter undoing their own immediate submission isn't a forensic
//      event worth tagging).
//   2. Admin retroactive delete via /api/delete-stream-count — passes
//      { deletedById, reason, mode } so we have a full audit trail of who
//      retracted what, why, and which flavor of delete (retract = reversed
//      inventory; hide = inventory unchanged). NOTE: the server endpoint
//      writes these fields itself rather than calling this helper, so this
//      branch is forward-compat scaffolding only.
//
// fetchStreamCounts + Reports + Turnover + auto-reconcile + AuditHistory all
// filter on `deleted=false` (or the join equivalent) so the row vanishes
// from every downstream view — exactly as if it had never been entered.
export const softDeleteStreamCount = async (id, opts = {}) => {
  const patch = { deleted: true, deleted_at: new Date().toISOString() }
  if (opts.deletedById) patch.deleted_by_id = opts.deletedById
  if (opts.reason) patch.deleted_reason = opts.reason
  if (opts.mode === 'retract' || opts.mode === 'hide') patch.delete_mode = opts.mode
  const { error } = await supabase
    .from('stream_counts')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export const fetchStreamCounts = async (locationId = null, dateFrom = null, dateTo = null) => {
  let query = supabase
    .from('stream_counts')
    .select(`
      *,
      location:locations(name),
      streamer:users!stream_counts_streamer_id_fkey(name),
      counted_by:users!stream_counts_counted_by_id_fkey(name)
    `)
    // Hide soft-deleted counts (treat NULL deleted as not-deleted for
    // backwards compatibility with rows that pre-date the column).
    .or('deleted.is.null,deleted.eq.false')

  if (locationId) query = query.eq('location_id', locationId)
  if (dateFrom) query = query.gte('count_time', dateFrom)
  if (dateTo) query = query.lte('count_time', dateTo)

  const { data, error } = await query.order('count_time', { ascending: false })
  if (error) throw error
  return data || []
}

export const fetchStreamCountItems = async (streamCountId) => {
  const { data, error } = await supabase
    .from('stream_count_items')
    .select(`
      *,
      product:products(*)
    `)
    .eq('stream_count_id', streamCountId)
    .order('product(brand)', { ascending: true })
    .order('product(name)', { ascending: true })
  if (error) throw error
  return data || []
}

export const createUser = async (name) => {
  const { data, error } = await supabase
    .from('users')
    .insert({ name, active: true, can_login: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export const fetchInventoryForRoom = async (locationId) => {
  const { data, error } = await supabase
    .from('inventory')
    .select(`
      *,
      product:products(*)
    `)
    .eq('location_id', locationId)
    .gt('quantity', 0)
  if (error) throw error
  
  // Sort by brand then name
  return (data || []).sort((a, b) => {
    const brandCompare = (a.product?.brand || '').localeCompare(b.product?.brand || '')
    if (brandCompare !== 0) return brandCompare
    return (a.product?.name || '').localeCompare(b.product?.name || '')
  })
}

// ADD THIS FUNCTION TO YOUR src/lib/supabase.js FILE

export const createPaymentMethod = async (name) => {
  const { data, error } = await supabase
    .from('payment_methods')
    .insert([{ name, active: true }])
    .select()
    .single()
  if (error) throw error
  return data
}

// ============================================
// SINGLES (card_sets + singles) — v1: inventory only
// ============================================

// Fire-and-forget Lark notification for singles events. Must NOT throw or
// reject — singles inventory writes already succeeded by the time we call
// this, so a Lark failure should be invisible to the user. We just log
// the error in console and move on.
//
// Each event type's payload shape is documented in api/lark-notify.js
// (buildSingleIntake / buildBulkIntake / etc.).
export const notifySinglesLark = (payload) => {
  try {
    fetch('/api/lark-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,  // survives page unload (e.g. user navigates away after save)
    }).catch(err => {
      console.warn('[notifySinglesLark] failed (non-fatal):', err)
    })
  } catch (err) {
    console.warn('[notifySinglesLark] threw synchronously (non-fatal):', err)
  }
}
// All helpers below are additive; nothing above this banner is modified.
// Sales / box-break-pull tracing / Lark notifications are intentionally absent
// (v2 scope). When those are added, append new helpers below — do not edit
// existing ones in place.

export const fetchCardSets = async (filters = {}) => {
  let query = supabase.from('card_sets').select('*').eq('active', true)
  if (filters.brand) query = query.eq('brand', filters.brand)
  if (filters.language) query = query.eq('language', filters.language)
  const { data, error } = await query
    .order('brand')
    .order('language')
    .order('release_date', { ascending: false, nullsFirst: false })
    .order('name')
  if (error) throw error
  return data || []
}

export const createCardSet = async (cardSet) => {
  const { data, error } = await supabase
    .from('card_sets')
    .insert(cardSet)
    .select()
    .single()
  if (error) throw error
  return data
}

// Fetch singles with joined set / location / acquirer / vendor for the
// inventory page. Soft-deleted rows are filtered out by default.
export const fetchSingles = async (filters = {}) => {
  let query = supabase
    .from('singles')
    .select(`
      *,
      set:card_sets(id, brand, name, code, language),
      location:locations(id, name),
      acquirer:users!singles_acquirer_id_fkey(id, name),
      vendor:vendors(id, name)
    `)
    .or('deleted.is.null,deleted.eq.false')

  if (filters.brand) query = query.eq('brand', filters.brand)
  if (filters.language) query = query.eq('language', filters.language)
  if (filters.form) query = query.eq('form', filters.form)
  if (filters.set_id) query = query.eq('set_id', filters.set_id)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.grading_company) query = query.eq('grading_company', filters.grading_company)
  if (filters.location_id) query = query.eq('location_id', filters.location_id)
  if (filters.min_market_price != null) query = query.gte('current_market_price_usd', filters.min_market_price)
  if (filters.max_market_price != null) query = query.lte('current_market_price_usd', filters.max_market_price)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ----- audit log helpers -----
//
// Each user-facing mutation on `singles` writes a row into
// singles_audit_log so we can show an Activity Log page later. The log
// call is fire-and-forget: a logging failure must NOT abort the main
// operation (caller already succeeded by the time we reach this).
//
// `acted_by_id` is whatever user.id was passed in by the caller —
// derived from acquirer_id (create), sold_by_id (sell), or deleted_by_id
// (delete). Because we don't use Supabase Auth, Postgres has no idea
// who is acting; the client tells us.
async function logSingleEvent({ single_id, event_type, summary, payload, acted_by_id }) {
  if (!single_id || !event_type || !summary) return
  try {
    await supabase.from('singles_audit_log').insert({
      single_id,
      event_type,
      summary,
      payload: payload || null,
      acted_by_id: acted_by_id || null
    })
  } catch (err) {
    console.warn('[logSingleEvent] failed (non-fatal):', err)
  }
}

// Public fetch for the Activity Log page.
// filters: { event_type?, date_from?, date_to?, acted_by_id?, limit? }
export const fetchSinglesAuditLog = async (filters = {}) => {
  let q = supabase
    .from('singles_audit_log')
    .select(`
      *,
      acted_by:users!singles_audit_log_acted_by_id_fkey(id, name),
      single:singles!singles_audit_log_single_id_fkey(
        id, card_name, card_number, brand, language, form,
        grading_company, grade, cert_number, deleted,
        set:card_sets(id, name, code)
      )
    `)
  if (filters.event_type) q = q.eq('event_type', filters.event_type)
  if (filters.acted_by_id) q = q.eq('acted_by_id', filters.acted_by_id)
  if (filters.date_from) q = q.gte('acted_at', filters.date_from)
  if (filters.date_to) q = q.lte('acted_at', filters.date_to)
  q = q.order('acted_at', { ascending: false }).limit(filters.limit || 200)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Friendly summary string for a created/sold/deleted event.
const summarizeCard = (s) => {
  if (!s) return ''
  const setName = s.set?.name ? ` (${s.set.name})` : ''
  if (s.form === 'graded') {
    return `${s.grading_company || '?'} ${s.grade || '?'} ${s.card_name} ${s.card_number || ''}${setName}`
  }
  return `${s.condition || 'Raw'} ${s.card_name} ${s.card_number || ''}${setName}`
}

// Lazily resolved Front Store location id. Singles intake (whether
// QuickIntakeModal scan, manual Add Single, or Bulk Add) defaults to
// Front Store when the caller doesn't pass an explicit location_id —
// store policy 2026-05-21 is that all newly-tracked singles live in
// Storefront Inventory until they're physically moved elsewhere.
// Cached for the lifetime of the page so we don't re-hit locations
// on every intake.
let _frontStoreLocIdCache = null
export const getFrontStoreLocationId = async () => {
  if (_frontStoreLocIdCache) return _frontStoreLocIdCache
  const { data, error } = await supabase
    .from('locations')
    .select('id')
    .eq('name', 'Front Store')
    .maybeSingle()
  if (error) throw error
  _frontStoreLocIdCache = data?.id || null
  return _frontStoreLocIdCache
}

export const createSingle = async (single) => {
  // Default to Front Store unless caller explicitly set location_id.
  // Treat empty string as "unset" (the form modal sends '' for null).
  const payload = { ...single }
  if (!payload.location_id) {
    payload.location_id = await getFrontStoreLocationId()
  }
  const { data, error } = await supabase
    .from('singles')
    .insert(payload)
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
    .single()
  if (error) throw error
  logSingleEvent({
    single_id: data.id,
    event_type: 'created',
    summary: `Added ${summarizeCard(data)}`,
    payload: { card: data },
    acted_by_id: data.acquirer_id
  })
  return data
}

// Bulk insert N singles in one round-trip. Used by the Bulk Add page and the
// Scan page's Batch Intake mode. Supabase passes the array straight to the
// underlying INSERT, so either every row lands or none do (single statement
// atomicity). A failed UNIQUE constraint on cert_number (graded dupes) will
// abort the entire batch — caller should surface the error so the user can
// remove the offending row before retrying.
export const createSinglesBatch = async (singles) => {
  if (!Array.isArray(singles) || singles.length === 0) return []
  // Same Front Store default as createSingle. Looked up once per batch.
  const frontStoreId = await getFrontStoreLocationId()
  const payload = singles.map(s => ({
    ...s,
    location_id: s.location_id || frontStoreId,
  }))
  const { data, error } = await supabase
    .from('singles')
    .insert(payload)
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
  if (error) throw error
  // One audit log row per created card. Tagged batch=true in payload so
  // a future UI can group them.
  if (data && data.length > 0) {
    for (const s of data) {
      logSingleEvent({
        single_id: s.id,
        event_type: 'created',
        summary: `Added ${summarizeCard(s)} (bulk)`,
        payload: { card: s, batch: true, batch_size: data.length },
        acted_by_id: s.acquirer_id
      })
    }
  }
  return data || []
}

export const updateSingle = async (id, updates) => {
  const { data, error } = await supabase
    .from('singles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Soft-delete a single. Matches the LV convention used elsewhere
// (deleted_at + deleted_by_id + deleted_reason on the same row).
export const softDeleteSingle = async (id, deletedById, reason = null) => {
  const { data, error } = await supabase
    .from('singles')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
      deleted_reason: reason
    })
    .eq('id', id)
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
    .single()
  if (error) throw error
  logSingleEvent({
    single_id: data.id,
    event_type: 'deleted',
    summary: `Deleted ${summarizeCard(data)}${reason ? ` — ${reason}` : ''}`,
    payload: { reason, card: data },
    acted_by_id: deletedById
  })
  return data
}

// Look up a single by either its graded-slab cert# OR its raw-card
// TCG ID — whichever matches first. Used by the Scan page to route an
// incoming barcode to the right next step (intake / sell / dupe warn).
//
// The two identifier columns are UNIQUE among non-deleted rows:
//   - cert_number  → graded slabs (PSA / CGC / BGS / SGC)
//   - tcg_id       → raw cards (TCGplayer product ID, used by Gary's sheet)
//
// So a single OR query is enough; at most one row matches.
//
// Returns: the matching row with joined set/location/acquirer/sold_by, or
// null if no match.
// Returns ALL matching rows (raw singles can have the same tcg_id in
// multiple locations after a Transfer splits a stack). Sorted by qty desc
// then by created_at asc so the "fullest stack" / oldest row sorts first
// — that's a reasonable default for "which copy to sell" disambiguation.
export const fetchSinglesByIdentifier = async (idString) => {
  const trimmed = (idString || '').trim()
  if (!trimmed) return []
  const safe = trimmed.replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe) return []
  const { data, error } = await supabase
    .from('singles')
    .select(`
      *,
      set:card_sets(id, brand, name, code, language),
      location:locations(id, name),
      acquirer:users!singles_acquirer_id_fkey(id, name),
      sold_by:users!singles_sold_by_id_fkey(id, name)
    `)
    .or(`cert_number.eq.${safe},tcg_id.eq.${safe}`)
    .or('deleted.is.null,deleted.eq.false')
    .order('quantity', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export const fetchSingleByIdentifier = async (idString) => {
  // Defensive: post-Transfer, the same TCG ID may exist in multiple
  // locations. maybeSingle() would throw. Return the first match — callers
  // that need to disambiguate should use fetchSinglesByIdentifier directly.
  const rows = await fetchSinglesByIdentifier(idString)
  return rows[0] || null
}

// Backward-compat alias — old call sites keep working. New code should
// prefer fetchSingleByIdentifier.
export const fetchSingleByCert = fetchSingleByIdentifier

// Mark a single as sold — records the sale price + channel + date + fees +
// buyer (all optional except sale_price_usd, enforced in the caller form)
// and flips status to 'sold'. Backed by the sale_* columns added by
// scripts/add_singles_sale_columns.sql.
//
// `saleData` shape:
//   {
//     sale_price_usd:   number,             // required
//     sale_channel:     string,             // 'ebay'|'whatnot'|'comc'|'tcgplayer'|'in_person'|'trade_out'|'other'
//     sale_date:        'YYYY-MM-DD',       // required
//     sale_fees_usd?:   number,
//     sale_price_native?: number,
//     sale_currency?:   string,             // defaults to 'USD'
//     buyer_name?:      string,
//     sale_notes?:      string,
//     sold_by_id?:      uuid                // caller's user.id
//   }
//
// Note for v2: raw stacks with quantity > 1 are currently sold as a single
// transaction (the whole row flips to status=sold). Splitting a stack into
// "sold N" + "remaining (qty - N)" needs a follow-up — see TODO in
// SellSingleModal.jsx.
// Bulk-sell helper used by the Scan page's Batch Sell mode. Takes an
// array of { id, saleData } pairs and marks each as sold, one UPDATE per
// row. Not atomic at the DB level (Supabase has no batch UPDATE with
// per-row payload) but written as a Promise.all so the round-trips
// parallelise — much faster than awaiting each one.
//
// Returns: { ok: [...updated rows], failed: [{ id, error }, ...] }
//
// Each row's audit log entry is written by markSingleAsSold which we call
// internally, so the Activity Log gets per-card events for free.
export const markSinglesAsSoldBatch = async (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: [], failed: [] }
  const results = await Promise.all(entries.map(async (e) => {
    try {
      const updated = await markSingleAsSold(e.id, e.saleData)
      return { kind: 'ok', row: updated }
    } catch (err) {
      return { kind: 'failed', id: e.id, error: err.message || String(err) }
    }
  }))
  return {
    ok: results.filter(r => r.kind === 'ok').map(r => r.row),
    failed: results.filter(r => r.kind === 'failed').map(r => ({ id: r.id, error: r.error })),
  }
}

export const markSingleAsSold = async (id, saleData) => {
  const patch = {
    status: 'sold',
    sale_price_usd: saleData.sale_price_usd,
    sale_channel: saleData.sale_channel || null,
    sale_date: saleData.sale_date,
    sale_fees_usd: saleData.sale_fees_usd ?? null,
    sale_price_native: saleData.sale_price_native ?? null,
    sale_currency: saleData.sale_currency || 'USD',
    buyer_name: saleData.buyer_name || null,
    sale_notes: saleData.sale_notes || null,
    sold_by_id: saleData.sold_by_id || null,
    // New columns from the unified storefront checkout (Phase 1+2). Existing
    // callers don't pass these — left null so non-store flows are unchanged.
    payment_method_id: saleData.payment_method_id || null,
    transaction_id: saleData.transaction_id || null,
    transaction_type: saleData.transaction_type || null,
    trade_in_value_usd: saleData.trade_in_value_usd ?? null,
    net_cash_usd: saleData.net_cash_usd ?? null,
  }
  const { data, error } = await supabase
    .from('singles')
    .update(patch)
    .eq('id', id)
    .select(`
      *,
      set:card_sets(id, brand, name, code, language),
      location:locations(id, name)
    `)
    .single()
  if (error) throw error
  const priceStr = saleData.sale_price_usd != null
    ? `$${Number(saleData.sale_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : 'unknown'
  const buyerStr = saleData.buyer_name ? ` to ${saleData.buyer_name}` : ''
  logSingleEvent({
    single_id: data.id,
    event_type: 'sold',
    summary: `Sold ${summarizeCard(data)} for ${priceStr} via ${saleData.sale_channel || 'unknown'}${buyerStr}`,
    payload: { sale: saleData, card: data },
    acted_by_id: saleData.sold_by_id
  })
  return data
}

// ============================================
// CARD TRANSFERS — shared helpers (singles + slabs)
// ============================================
// Slab + graded-single + whole-row raw-single moves are simple location_id
// updates. Raw-single PARTIAL moves (e.g. scanner moves 1 of a 10-stack)
// split the source row: source.qty -= n, and at the destination location
// we either increment an existing same-SKU row's qty, or insert a new
// clone of the source row with qty=n.
//
// Every move writes ONE audit-log entry against the source row (event_type
// = 'moved'). The payload carries from/to location IDs and the qty for
// downstream tooling (Lark, Reports).

// Tiny in-memory cache so a batch of N moves doesn't trigger N location
// fetches for the same source/dest pair.
const _locationNameCache = new Map()
const _locationName = async (id) => {
  if (!id) return '(no location)'
  if (_locationNameCache.has(id)) return _locationNameCache.get(id)
  const { data } = await supabase
    .from('locations')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  const name = data?.name || `(unknown:${String(id).slice(0, 6)})`
  _locationNameCache.set(id, name)
  return name
}

// Compact summary string for a card row in move log entries.
const _summarizeSingleForMove = (s) => {
  if (!s) return ''
  const set = s.set?.name ? ` (${s.set.name})` : ''
  if (s.form === 'graded') {
    return `${s.grading_company || '?'} ${s.grade || '?'} ${s.card_name || ''} ${s.card_number || ''}${set}`.trim()
  }
  return `${s.condition || 'Raw'} ${s.card_name || ''} ${s.card_number || ''}${set}`.trim()
}

// Move an ENTIRE single row to a new location. Used by:
//   * Inventory page bulk-select Move (entire stack)
//   * Graded singles (qty constraint = 1, so whole = the one card)
//   * moveSingleUnit when qty === source.quantity (delegated)
export const moveSingleRow = async (id, toLocationId, currentUserId) => {
  const { data: current, error: fetchErr } = await supabase
    .from('singles')
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr
  if (current.location_id === toLocationId) return current  // no-op

  const fromName = await _locationName(current.location_id)
  const toName   = await _locationName(toLocationId)

  const { data, error } = await supabase
    .from('singles')
    .update({ location_id: toLocationId })
    .eq('id', id)
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
    .single()
  if (error) throw error

  logSingleEvent({
    single_id: data.id,
    event_type: 'moved',
    summary: `Moved ${data.quantity}× ${_summarizeSingleForMove(data)} from ${fromName} → ${toName}`,
    payload: {
      from_location_id: current.location_id,
      to_location_id: toLocationId,
      qty: data.quantity,
      mode: 'row'
    },
    acted_by_id: currentUserId || null
  })
  return data
}

// Move N units of a raw single from source row to a destination location.
// If a same-SKU row already exists at the destination, increment its qty;
// otherwise insert a clone of the source row at the new location with qty=n.
// Graded source rows delegate to moveSingleRow (qty=1 always).
//
// NB: not transactional across the two rows — destination is written FIRST
// so a mid-flight failure leaves a duplicate (recoverable by manual decrement)
// rather than losing quantity (irrecoverable).
export const moveSingleUnit = async ({
  fromSingleId,
  toLocationId,
  qty = 1,
  currentUserId
}) => {
  if (!fromSingleId) throw new Error('fromSingleId required')
  if (!toLocationId) throw new Error('toLocationId required')
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be a positive number')

  const { data: source, error: srcErr } = await supabase
    .from('singles')
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
    .eq('id', fromSingleId)
    .single()
  if (srcErr) throw srcErr

  if (source.form === 'graded' || source.quantity === qty) {
    // No split needed — moving the whole row is identical to updating
    // location_id. Reuse the single-row helper for consistent log shape.
    return { source: await moveSingleRow(fromSingleId, toLocationId, currentUserId), dest: null }
  }
  if (source.quantity < qty) {
    throw new Error(`Source only has ${source.quantity} copies, can't move ${qty}`)
  }
  if (source.location_id === toLocationId) return { source, dest: null }  // no-op

  // Look for an existing same-SKU row at the destination. Match on tcg_id +
  // form + condition since those are what define "same SKU" for raw cards.
  let destRow = null
  if (source.tcg_id) {
    let q = supabase
      .from('singles')
      .select('*')
      .eq('tcg_id', source.tcg_id)
      .eq('form', source.form)
      .eq('location_id', toLocationId)
      .or('deleted.is.null,deleted.eq.false')
    if (source.condition) q = q.eq('condition', source.condition)
    else q = q.is('condition', null)
    const { data: maybe, error: destErr } = await q.maybeSingle()
    if (destErr) throw destErr
    destRow = maybe
  }

  const fromName = await _locationName(source.location_id)
  const toName   = await _locationName(toLocationId)

  // 1) Dest first (less destructive failure mode)
  let updatedDest
  if (destRow) {
    const { data, error } = await supabase
      .from('singles')
      .update({ quantity: destRow.quantity + qty })
      .eq('id', destRow.id)
      .select(`
        *,
        set:card_sets(id, name, code)
      `)
      .single()
    if (error) throw error
    updatedDest = data
  } else {
    // Clone source minus PK / timestamps / joined relations.
    const clone = { ...source }
    delete clone.id
    delete clone.created_at
    delete clone.updated_at
    delete clone.set
    clone.location_id = toLocationId
    clone.quantity = qty
    const { data, error } = await supabase
      .from('singles')
      .insert(clone)
      .select(`
        *,
        set:card_sets(id, name, code)
      `)
      .single()
    if (error) throw error
    updatedDest = data
  }

  // 2) Decrement source
  const newSourceQty = source.quantity - qty
  const { data: updatedSource, error: srcUpErr } = await supabase
    .from('singles')
    .update({ quantity: newSourceQty })
    .eq('id', source.id)
    .select(`
      *,
      set:card_sets(id, name, code)
    `)
    .single()
  if (srcUpErr) throw srcUpErr

  logSingleEvent({
    single_id: source.id,
    event_type: 'moved',
    summary: `Moved ${qty}× ${_summarizeSingleForMove(source)} from ${fromName} → ${toName}`,
    payload: {
      from_location_id: source.location_id,
      to_location_id: toLocationId,
      qty,
      dest_single_id: updatedDest?.id || null,
      mode: 'unit'
    },
    acted_by_id: currentUserId || null
  })

  return { source: updatedSource, dest: updatedDest }
}

// Batch wrapper around moveSingleUnit — Scan-page batch transfer.
// entries: [{ fromSingleId, toLocationId, qty }, ...]
export const moveSingleUnitsBatch = async (entries, currentUserId) => {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: [], failed: [] }
  const results = await Promise.all(entries.map(async (e) => {
    try {
      const r = await moveSingleUnit({ ...e, currentUserId })
      return { kind: 'ok', row: r }
    } catch (err) {
      return { kind: 'failed', entry: e, error: err.message || String(err) }
    }
  }))
  return {
    ok: results.filter(r => r.kind === 'ok').map(r => r.row),
    failed: results.filter(r => r.kind === 'failed').map(r => ({ entry: r.entry, error: r.error })),
  }
}

// Batch wrapper around moveSingleRow — Inventory bulk-select Move.
// entries: [{ id, toLocationId }, ...]
export const moveSingleRowsBatch = async (entries, currentUserId) => {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: [], failed: [] }
  const results = await Promise.all(entries.map(async (e) => {
    try { return { kind: 'ok', row: await moveSingleRow(e.id, e.toLocationId, currentUserId) } }
    catch (err) { return { kind: 'failed', id: e.id, error: err.message || String(err) } }
  }))
  return {
    ok: results.filter(r => r.kind === 'ok').map(r => r.row),
    failed: results.filter(r => r.kind === 'failed').map(r => ({ id: r.id, error: r.error })),
  }
}

// ============================================
// SLABS (graded TCG cards) — v1: inventory + lifecycle
// ============================================
// Separate from singles per user directive 2026-05-15. Slabs are graded
// cards (PSA/CGC/BGS/SGC) identified by cert# only — the sheet's data
// model (cert + grading_company + free-text item_name) is structurally
// different from the singles SKU model.

// Fire-and-forget audit log writer for slabs. Mirrors logSingleEvent.
async function logSlabEvent({ slab_id, event_type, summary, payload, acted_by_id }) {
  if (!slab_id || !event_type || !summary) return
  try {
    await supabase.from('slabs_audit_log').insert({
      slab_id, event_type, summary,
      payload: payload || null,
      acted_by_id: acted_by_id || null
    })
  } catch (err) {
    console.warn('[logSlabEvent] failed (non-fatal):', err)
  }
}

// Activity Log fetcher — parallel to fetchSinglesAuditLog.
export const fetchSlabsAuditLog = async (filters = {}) => {
  let q = supabase
    .from('slabs_audit_log')
    .select(`
      *,
      acted_by:users!slabs_audit_log_acted_by_id_fkey(id, name),
      slab:slabs!slabs_audit_log_slab_id_fkey(
        id, cert_number, grading_company, item_name, status, deleted
      )
    `)
  if (filters.event_type)  q = q.eq('event_type', filters.event_type)
  if (filters.acted_by_id) q = q.eq('acted_by_id', filters.acted_by_id)
  if (filters.date_from)   q = q.gte('acted_at', filters.date_from)
  if (filters.date_to)     q = q.lte('acted_at', filters.date_to)
  q = q.order('acted_at', { ascending: false }).limit(filters.limit || 200)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Inventory query — joined with users for acquirer/sold_by display.
// Soft-deleted rows excluded by default.
//
// filters: { status?, grading_company?, search?, deleted? }
export const fetchSlabs = async (filters = {}) => {
  let q = supabase
    .from('slabs')
    .select(`
      *,
      acquirer:users!slabs_acquirer_id_fkey(id, name),
      sold_by:users!slabs_sold_by_id_fkey(id, name)
    `)

  if (filters.deleted !== true) {
    q = q.or('deleted.is.null,deleted.eq.false')
  }
  if (filters.status)          q = q.eq('status', filters.status)
  if (filters.grading_company) q = q.eq('grading_company', filters.grading_company)

  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Cert# lookup (the barcode-scanner flow). Returns null when not found.
export const fetchSlabByCert = async (certNumber) => {
  const trimmed = (certNumber || '').trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('slabs')
    .select(`
      *,
      acquirer:users!slabs_acquirer_id_fkey(id, name),
      sold_by:users!slabs_sold_by_id_fkey(id, name)
    `)
    .eq('cert_number', trimmed)
    .or('deleted.is.null,deleted.eq.false')
    .maybeSingle()
  if (error) throw error
  return data
}

export const createSlab = async (slab) => {
  const { data, error } = await supabase
    .from('slabs')
    .insert(slab)
    .select()
    .single()
  if (error) throw error
  logSlabEvent({
    slab_id: data.id,
    event_type: 'created',
    summary: `Added ${data.grading_company} slab #${data.cert_number} — ${data.item_name}`,
    payload: { slab: data },
    acted_by_id: data.acquirer_id
  })
  return data
}

// Bulk-insert N slabs in one round-trip (for the Bulk Add / batch intake path)
export const createSlabsBatch = async (slabs) => {
  if (!Array.isArray(slabs) || slabs.length === 0) return []
  const { data, error } = await supabase
    .from('slabs')
    .insert(slabs)
    .select()
  if (error) throw error
  if (data && data.length > 0) {
    for (const s of data) {
      logSlabEvent({
        slab_id: s.id,
        event_type: 'created',
        summary: `Added ${s.grading_company} slab #${s.cert_number} — ${s.item_name} (bulk)`,
        payload: { slab: s, batch: true, batch_size: data.length },
        acted_by_id: s.acquirer_id
      })
    }
  }
  return data || []
}

export const updateSlab = async (id, updates) => {
  const { data, error } = await supabase
    .from('slabs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Mark a slab as sold — mirrors markSingleAsSold. saleData expects the
// same fields (sale_price_usd, sale_channel, sale_date, sale_fees_usd,
// buyer_name, sold_by_id, sale_notes).
export const markSlabAsSold = async (id, saleData) => {
  const patch = {
    status: 'sold',
    sold_at: new Date().toISOString(),
    sale_price_usd: saleData.sale_price_usd,
    sale_channel: saleData.sale_channel || null,
    sale_date: saleData.sale_date,
    sale_fees_usd: saleData.sale_fees_usd ?? null,
    buyer_name: saleData.buyer_name || null,
    notes: saleData.sale_notes || null,        // free-form notes column
    sold_by_id: saleData.sold_by_id || null,
    // New columns from the unified storefront checkout (Phase 1). Existing
    // callers (SellSlabModal etc.) don't pass these — left null so behaviour
    // for the non-store flows is unchanged.
    payment_method_id: saleData.payment_method_id || null,
    transaction_id: saleData.transaction_id || null,
    transaction_type: saleData.transaction_type || null,
    trade_in_value_usd: saleData.trade_in_value_usd ?? null,
    net_cash_usd: saleData.net_cash_usd ?? null,
  }
  const { data, error } = await supabase
    .from('slabs')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  const priceStr = saleData.sale_price_usd != null
    ? `$${Number(saleData.sale_price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : 'unknown'
  const buyerStr = saleData.buyer_name ? ` to ${saleData.buyer_name}` : ''
  logSlabEvent({
    slab_id: data.id,
    event_type: 'sold',
    summary: `Sold ${data.grading_company} slab #${data.cert_number} for ${priceStr} via ${saleData.sale_channel || 'unknown'}${buyerStr}`,
    payload: { sale: saleData, slab: data },
    acted_by_id: saleData.sold_by_id
  })
  return data
}

export const markSlabsAsSoldBatch = async (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: [], failed: [] }
  const results = await Promise.all(entries.map(async (e) => {
    try { return { kind: 'ok', row: await markSlabAsSold(e.id, e.saleData) } }
    catch (err) { return { kind: 'failed', id: e.id, error: err.message || String(err) } }
  }))
  return {
    ok: results.filter(r => r.kind === 'ok').map(r => r.row),
    failed: results.filter(r => r.kind === 'failed').map(r => ({ id: r.id, error: r.error })),
  }
}

// Soft-delete with audit metadata. Matches singles convention.
export const softDeleteSlab = async (id, deletedById, reason = null) => {
  const { data, error } = await supabase
    .from('slabs')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
      deleted_reason: reason
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  logSlabEvent({
    slab_id: data.id,
    event_type: 'deleted',
    summary: `Deleted ${data.grading_company} slab #${data.cert_number}${reason ? ` — ${reason}` : ''}`,
    payload: { reason, slab: data },
    acted_by_id: deletedById
  })
  return data
}

// Move a slab to a new location. Slabs are always per-card (no qty), so
// this is just an UPDATE + audit log.
export const moveSlab = async (id, toLocationId, currentUserId) => {
  const { data: current, error: fetchErr } = await supabase
    .from('slabs')
    .select('id, cert_number, grading_company, item_name, location_id, deleted')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr
  if (current.location_id === toLocationId) return current  // no-op

  const fromName = await _locationName(current.location_id)
  const toName   = await _locationName(toLocationId)

  const { data, error } = await supabase
    .from('slabs')
    .update({ location_id: toLocationId })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  logSlabEvent({
    slab_id: data.id,
    event_type: 'moved',
    summary: `Moved ${data.grading_company} slab #${data.cert_number} from ${fromName} → ${toName}`,
    payload: {
      from_location_id: current.location_id,
      to_location_id: toLocationId
    },
    acted_by_id: currentUserId || null
  })
  return data
}

// Batch wrapper — used by both Scan-page batch transfer and Inventory bulk-select.
// entries: [{ id, toLocationId }, ...]
export const moveSlabsBatch = async (entries, currentUserId) => {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: [], failed: [] }
  const results = await Promise.all(entries.map(async (e) => {
    try { return { kind: 'ok', row: await moveSlab(e.id, e.toLocationId, currentUserId) } }
    catch (err) { return { kind: 'failed', id: e.id, error: err.message || String(err) } }
  }))
  return {
    ok: results.filter(r => r.kind === 'ok').map(r => r.row),
    failed: results.filter(r => r.kind === 'failed').map(r => ({ id: r.id, error: r.error })),
  }
}

// Unified identifier lookup — checks slabs.cert_number then singles
// (singles already checks both cert_number and tcg_id via
// fetchSingleByIdentifier). Used by the Scan page so one scan input
// can route a barcode to either system.
export const fetchAnyByIdentifier = async (idString) => {
  const trimmed = (idString || '').trim()
  if (!trimmed) return null
  // Try slabs first (cert# is graded-only)
  const slab = await fetchSlabByCert(trimmed)
  if (slab) return { kind: 'slab', row: slab }
  // Fallback to singles (raw tcg_id OR graded cert_number — historical)
  const single = await fetchSingleByIdentifier(trimmed)
  if (single) return { kind: 'single', row: single }
  return null
}

// Fire-and-forget Lark notification for slab events. Mirrors
// notifySinglesLark; routes to LARK_WEBHOOK_INVENTORY_IO via
// /api/lark-notify with new type values (slab_intake / slab_sold / etc.).
export const notifySlabsLark = (payload) => {
  try {
    fetch('/api/lark-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(err => console.warn('[notifySlabsLark] failed (non-fatal):', err))
  } catch (err) {
    console.warn('[notifySlabsLark] threw synchronously (non-fatal):', err)
  }
}

// ============================================================================
// JAPAN inventory system — helpers
// ============================================================================
// All Japan-side data ops route through here so pages stay thin. Japan reuses
// the existing acquisitions / inventory / vendors / users tables, distinguished
// by:
//   - locations.name = 'Japan Warehouse'
//   - acquisitions.origin = 'jp_vendor' | 'jp_to_us_shipment'
//   - the synthetic "Japan Warehouse (Internal Transfer)" vendor flags
//     cross-border shipment acquisitions
// See scripts/add_japan_inventory_system.sql for the schema additions.
// ============================================================================

// Cached lookups so we don't re-query for these singletons on every action.
// Reset on page reload (per-tab cache via module scope is fine for these).
let _cachedJapanLocationId = null
let _cachedJapanInternalVendorId = null

export const fetchJapanWarehouseLocation = async () => {
  if (_cachedJapanLocationId) return _cachedJapanLocationId
  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .eq('name', 'Japan Warehouse')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Location 'Japan Warehouse' not found — run scripts/add_japan_inventory_system.sql first")
  _cachedJapanLocationId = data.id
  return data.id
}

export const fetchJapanInternalVendor = async () => {
  if (_cachedJapanInternalVendorId) return _cachedJapanInternalVendorId
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name')
    .eq('name', 'Japan Warehouse (Internal Transfer)')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Vendor 'Japan Warehouse (Internal Transfer)' not found — run scripts/add_japan_inventory_system.sql first")
  _cachedJapanInternalVendorId = data.id
  return data.id
}

// View what's currently at Japan Warehouse. Same shape as fetchInventory but
// pre-filtered to the JP location so the page doesn't have to know the
// location id.
export const fetchJapanInventory = async () => {
  const locId = await fetchJapanWarehouseLocation()
  const { data, error } = await supabase
    .from('inventory')
    .select(`
      *,
      product:products(*),
      location:locations(*)
    `)
    .eq('location_id', locId)
    .or('deleted.is.null,deleted.eq.false')
  if (error) throw error
  return data || []
}

// JP-side vendors (for the Japan Acquisitions vendor dropdown). Returns
// vendors marked country='Japan' (the enum's canonical Japan value — JP /
// JPN are not in the region enum, only "Japan") plus any vendors without a
// country (legacy). Excludes the synthetic internal-transfer vendor —
// that's only used by the Japan→US shipment page.
export const fetchJapanVendors = async () => {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('active', true)
    .or('country.eq.Japan,country.is.null')
    .neq('name', 'Japan Warehouse (Internal Transfer)')
    .order('name')
  if (error) throw error
  return data || []
}

// Recent Japan offline purchases (jp_vendor origin only), for the
// Acquisitions page's "recent" list and as source candidates for the
// Japan→US Shipment page's optional `source_acquisition_id` linkage.
export const fetchJapanAcquisitions = async (limit = 50) => {
  const { data, error } = await supabase
    .from('acquisitions')
    .select(`
      *,
      vendor:vendors(name),
      payment_method:payment_methods(name),
      acquirer:users!acquirer_id(name),
      product:products(*)
    `)
    .eq('origin', 'jp_vendor')
    .or('deleted.is.null,deleted.eq.false')
    .order('date_purchased', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Japan offline purchase = instant receive (no separate Intake step).
// Atomic-ish (best effort): create acquisition row with status='Received',
// then bump Japan inventory by the qty. If inventory write fails we leave
// the acquisition row in place so the user can manually reconcile rather
// than silently swallow it (matches the US Intake to Master semantics).
export const createJapanAcquisition = async ({
  product_id, quantity, unit_cost_jpy, vendor_id, payment_method_id,
  acquirer_id, date_purchased, notes,
}) => {
  const locId = await fetchJapanWarehouseLocation()
  const qty = parseInt(quantity, 10)
  const costJpy = parseFloat(unit_cost_jpy) || 0
  const totalCostJpy = costJpy * qty
  const totalCostUsd = convertToUSD(totalCostJpy, 'JPY')
  const unitCostUsd = qty > 0 ? totalCostUsd / qty : 0

  const acqRow = {
    date_purchased: date_purchased || new Date().toLocaleDateString('en-CA'),
    acquirer_id: acquirer_id || null,
    source_country: 'Japan',  // region enum accepts 'Japan', not 'JP' (verified live)
    vendor_id: vendor_id || null,
    payment_method_id: payment_method_id || null,
    product_id,
    quantity_purchased: qty,
    quantity_received: qty,                  // instant-receive
    cost: totalCostJpy,
    currency: 'JPY',
    cost_usd: totalCostUsd,
    status: 'Received',                       // instant-receive
    origin: 'jp_vendor',
    notes: notes || null,
  }

  const { data: acq, error: acqErr } = await supabase
    .from('acquisitions')
    .insert(acqRow)
    .select()
    .single()
  if (acqErr) throw acqErr

  // Bump Japan inventory using the existing weighted-avg helper. Cost basis
  // arg = per-unit USD so it averages correctly with any existing stock of
  // the same SKU.
  await updateInventory(product_id, locId, qty, unitCostUsd)
  return acq
}

// Record a sale out of Japan Warehouse. Decrements inventory + inserts into
// japan_stream_sales (audit log). USD snapshot uses the static exchange rate
// at sale time.
//
// `channel`: 'stream' (default — direct livestream sale) | 'local' (日本当地售卖
// — in-store / off-platform sale). Both behave identically at the DB level;
// the only difference is downstream Lark routing + how the Log timeline
// renders them. `streamer_id` doubles as "salesperson" for local sales so we
// don't need a separate column for the same semantic field.
export const createJapanStreamSale = async ({
  product_id, quantity, unit_price_jpy, sale_date,
  streamer_id, recorded_by_id, notes, channel,
}) => {
  const locId = await fetchJapanWarehouseLocation()
  const qty = parseInt(quantity, 10)
  const unitJpy = parseFloat(unit_price_jpy) || 0
  const revenueJpy = unitJpy * qty
  const revenueUsd = convertToUSD(revenueJpy, 'JPY')

  const row = {
    product_id,
    quantity: qty,
    unit_price_jpy: unitJpy || null,
    revenue_jpy: revenueJpy,
    revenue_usd: revenueUsd,
    sale_date: sale_date || new Date().toLocaleDateString('en-CA'),
    streamer_id: streamer_id || null,
    recorded_by_id: recorded_by_id || null,
    notes: notes || null,
    channel: channel === 'local' ? 'local' : 'stream',
  }
  const { data: sale, error: saleErr } = await supabase
    .from('japan_stream_sales')
    .insert(row)
    .select()
    .single()
  if (saleErr) throw saleErr

  // Decrement Japan inventory (negative delta — cost basis unchanged on outflow)
  await updateInventory(product_id, locId, -qty)
  return sale
}

// Fetch recent Japan sales. `channel` (optional) narrows to 'stream' or
// 'local'; omitting it returns both (Activity Log uses that).
export const fetchJapanStreamSales = async (limit = 50, opts = {}) => {
  const { channel } = opts
  let query = supabase
    .from('japan_stream_sales')
    .select(`
      *,
      product:products(name, brand, language, type, category, short_code, aliases, variant),
      streamer:users!streamer_id(name),
      recorded_by:users!recorded_by_id(name)
    `)
    .eq('deleted', false)
    .order('sale_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (channel === 'stream' || channel === 'local') {
    query = query.eq('channel', channel)
  }
  const { data, error } = await query
  if (error) throw error
  return data || []
}

// Soft-delete a Japan stream sale and refund the inventory. Mirrors the
// US stream_count Undo flow's atomicity convention — reverse inventory
// FIRST, then mark the row deleted, so a mid-flow crash leaves the row
// visible (recoverable) rather than missing-but-stock-adjusted.
export const undoJapanStreamSale = async (saleId, deletedById = null) => {
  const { data: sale, error: getErr } = await supabase
    .from('japan_stream_sales')
    .select('id, product_id, quantity, deleted')
    .eq('id', saleId)
    .maybeSingle()
  if (getErr) throw getErr
  if (!sale) throw new Error('Sale not found')
  if (sale.deleted) throw new Error('Sale already deleted')

  const locId = await fetchJapanWarehouseLocation()
  await updateInventory(sale.product_id, locId, sale.quantity)  // refund (positive delta)
  const { error: delErr } = await supabase
    .from('japan_stream_sales')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
    })
    .eq('id', saleId)
  if (delErr) throw delErr
}

// Japan→US cross-border shipment. Creates a 'jp_to_us_shipment' acquisition
// row owned by the synthetic Internal Transfer vendor — this makes it pop
// up in Intake to Master automatically once it reaches the US side. Japan
// inventory is decremented immediately (items have physically left).
// Optional source_acquisition_id links back to the original Japan buy for
// cost-trace down the road.
export const createJapanToUSShipment = async ({
  product_id, quantity, unit_cost_jpy, source_acquisition_id,
  carrier, tracking_number, shipped_date, shipper_id, notes,
}) => {
  const locId = await fetchJapanWarehouseLocation()
  const vendorId = await fetchJapanInternalVendor()
  const qty = parseInt(quantity, 10)
  const costJpy = parseFloat(unit_cost_jpy) || 0
  const totalCostJpy = costJpy * qty
  const totalCostUsd = convertToUSD(totalCostJpy, 'JPY')

  const acqRow = {
    date_purchased: shipped_date || new Date().toLocaleDateString('en-CA'),
    acquirer_id: shipper_id || null,
    source_country: 'Japan',  // region enum accepts 'Japan', not 'JP' (verified live)
    vendor_id: vendorId,
    payment_method_id: null,
    product_id,
    quantity_purchased: qty,
    quantity_received: 0,                     // arrives at US later
    cost: totalCostJpy,
    currency: 'JPY',
    cost_usd: totalCostUsd,
    status: 'Purchased',                      // pending US Intake
    origin: 'jp_to_us_shipment',
    source_acquisition_id: source_acquisition_id || null,
    carrier: carrier || null,
    tracking_number: tracking_number?.trim() || null,
    notes: notes || null,
  }

  const { data: acq, error: acqErr } = await supabase
    .from('acquisitions')
    .insert(acqRow)
    .select()
    .single()
  if (acqErr) throw acqErr

  await updateInventory(product_id, locId, -qty)  // items physically gone
  return acq
}

// Batch-create / upsert Japan SKUs for a single set. Used by the Japan
// Add Product page when the user fills out (series, short_code,
// english_name, variants[]) — the page resolves all the metadata via
// helpers in japanVariants.js and hands us an array of complete product
// rows. We use upsert so re-running for a set that partially exists is a
// no-op for existing rows + creates the missing ones.
//
// Returns: { created, updated } counts so the caller can tell the user
// whether they just added 4 new SKUs or 3 already existed.
export const upsertProducts = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { created: 0, updated: 0, data: [] }
  }
  // Find the existing rows so we can split into created vs updated for the
  // user-facing toast. The composite unique key is
  // (brand, type, category, name, language).
  const keys = rows.map(r => ({
    brand: r.brand, type: r.type, category: r.category,
    name: r.name, language: r.language,
  }))
  // Pull existing matches by name (cheap filter — name is the most
  // distinctive field). Cross-check the other key fields client-side.
  const names = [...new Set(rows.map(r => r.name))]
  const { data: preexisting } = await supabase
    .from('products')
    .select('id, name, brand, type, category, language')
    .in('name', names)
  const existing = new Set(
    (preexisting || []).map(p => `${p.brand}|${p.type}|${p.category}|${p.name}|${p.language}`)
  )
  const inputKeys = rows.map(r => `${r.brand}|${r.type}|${r.category}|${r.name}|${r.language}`)

  const { data, error } = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'brand,type,category,name,language' })
    .select()
  if (error) throw error

  const created = inputKeys.filter(k => !existing.has(k)).length
  const updated = inputKeys.length - created
  return { created, updated, data: data || [] }
}

// All active Japan→US shipments (for the shipment page's recent list +
// in-transit visibility). Filters out delivered/canceled by default;
// pass { includeAll: true } to see everything.
export const fetchJapanToUSShipments = async ({ limit = 50, includeAll = false } = {}) => {
  let q = supabase
    .from('acquisitions')
    .select(`
      *,
      acquirer:users!acquirer_id(name),
      vendor:vendors(name),
      product:products(*),
      source_acquisition:acquisitions!source_acquisition_id(id, date_purchased, vendor:vendors(name))
    `)
    .eq('origin', 'jp_to_us_shipment')
    .or('deleted.is.null,deleted.eq.false')
    .order('date_purchased', { ascending: false })
    .limit(limit)
  if (!includeAll) {
    q = q.in('status', ['Purchased', 'Partially Received'])
  }
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ============================================
// STOREFRONT — UNIFIED CHECKOUT (Phase 1)
// ============================================
// Lets the cashier scan ANY of three product identities at the storefront:
//   - UPC barcode     → products.barcode  → sealed box / pack
//   - Slab cert#      → slabs.cert_number → graded card
//   - Single TCG ID   → singles.tcg_id    → raw single card
// The scanned code is routed to the right lookup, the cashier confirms
// qty + price + payment method, and one submit-cart action fans out
// writes across three tables (storefront_sales / slabs / singles) tagged
// with the same transaction_id so the checkout can be reconstructed as
// one unit later.
//
// Design notes:
//   * Best-effort submit: lines that fail (e.g. somebody else just sold
//     that slab from another tab) come back in `failed[]`, lines that
//     succeed in `ok[]`. The caller leaves failed lines in the cart so
//     the cashier can retry, fix, or remove them.
//   * Auto-Move: if a scanned sealed SKU is in stock at Master but not
//     at Front Store, the submit silently logs a movement Master→Front
//     Store before deducting from Front Store. The cashier doesn't have
//     to interrupt the customer to "fix" inventory routing.
//   * Fungible single split: if a raw single row has quantity 5 and the
//     cashier sells 2, we DON'T flip the whole row to sold. Instead we
//     decrement the source row to 3 and INSERT a clone (qty=2, status=
//     'sold', sale fields filled). The clone keeps the same set_id /
//     cost basis / etc. so per-card analytics still work.

// Location names this checkout cares about. Resolved once per submit via a
// .in() query on `locations` so a rename in the DB stops us at the door
// instead of silently misrouting inventory. (These were accidentally
// dropped during a merge with the Japan-system branch — restored here.)
const FRONT_STORE_NAME = 'Front Store'
const MASTER_NAME = 'Master Inventory'

// ----- code lookup -----

// Identify what kind of inventory a scanned code matches. UPC first (most
// scans), then slab cert, then single TCG ID. Caller decides what to do
// with each kind. Returns one of:
//   { kind: 'sealed',  product, inventory: [{location_id, location_name, quantity, avg_cost_basis}, ...] }
//   { kind: 'slab',    slab }    // current row, status checked downstream
//   { kind: 'single',  single }  // current row, status checked downstream
//   { kind: 'unknown', code }
//   { kind: 'empty' }
export const lookupScannedCode = async (code) => {
  const trimmed = String(code || '').trim()
  if (!trimmed) return { kind: 'empty' }

  // 1. UPC → products.barcode. We try both the scanned form AND the
  //    UPC-A↔EAN-13 alternate (12-digit ↔ 13-digit-with-leading-0), since
  //    the DB has rows in both formats and scanner mode varies. .in()
  //    over the candidate set is a single round-trip.
  {
    const candidates = [trimmed]
    if (trimmed.length === 12)                          candidates.push('0' + trimmed)
    if (trimmed.length === 13 && trimmed.startsWith('0')) candidates.push(trimmed.slice(1))
    const { data: matches, error } = await supabase
      .from('products')
      .select('id, brand, name, category, language, type, barcode, active')
      .in('barcode', candidates)
      .limit(2)
    if (error) throw error
    const product = matches?.[0] || null
    if (product) {
      const { data: inv, error: invErr } = await supabase
        .from('inventory')
        .select(`
          quantity, avg_cost_basis, location_id,
          location:locations(id, name)
        `)
        .eq('product_id', product.id)
        .gt('quantity', 0)
      if (invErr) throw invErr
      const rows = (inv || []).map(r => ({
        location_id: r.location_id,
        location_name: r.location?.name,
        quantity: r.quantity,
        avg_cost_basis: r.avg_cost_basis ?? 0,
      }))
      return { kind: 'sealed', product, inventory: rows }
    }
  }

  // 2. Slab cert# → slabs.cert_number (no unique constraint but should be unique).
  //    Join location so Platform Sales can show a "not at this stream room"
  //    warning without an extra round-trip.
  {
    const { data: slab, error } = await supabase
      .from('slabs')
      .select('*, location:locations(id, name)')
      .eq('cert_number', trimmed)
      .eq('deleted', false)
      .maybeSingle()
    if (error) throw error
    if (slab) return { kind: 'slab', slab }
  }

  // 3. Single TCG ID → singles.tcg_id. Multiple rows can share a tcg_id
  //    after a partial/fungible sale (we split a qty=2 row into a qty=1
  //    in_inventory row + a qty=1 sold clone, both non-deleted). Don't
  //    use maybeSingle() — it would 406 on those. Instead order so the
  //    sellable row wins (in_inventory > listed > sold), then return
  //    the first match.
  {
    const { data: rows, error } = await supabase
      .from('singles')
      .select(`
        *,
        set:card_sets(id, brand, name, code, language),
        location:locations(id, name)
      `)
      .eq('tcg_id', trimmed)
      .eq('deleted', false)
      .limit(5)
    if (error) throw error
    if (rows && rows.length > 0) {
      const rank = (s) => s === 'in_inventory' ? 0 : s === 'listed' ? 1 : 2
      const sorted = [...rows].sort((a, b) => rank(a.status) - rank(b.status))
      return { kind: 'single', single: sorted[0] }
    }
  }

  return { kind: 'unknown', code: trimmed }
}

// ----- Move singles/slabs between locations -----
//
// Sealed-product moves stay in the existing createMovement + updateInventory
// flow (see MovedInventory.jsx). Singles and slabs don't ride that table —
// their location is a column on the row itself. These two helpers handle
// the row-level location flip plus the audit log entry.

// Move N units of a single from its current location to a different one.
// Mirrors the sale-split logic in _sellSingleLine: if the source row has
// more units than we're moving, we don't migrate the whole row — we
// decrement the source and INSERT a clone at the new location. That keeps
// per-card cost basis + acquisition history intact on the source row.
// Slab semantics are simpler since slabs are always qty=1 (see moveSlabToLocation).
export const moveSingleToLocation = async ({
  singleId,
  fromLocationId,    // used for audit / sanity check (current value of single.location_id)
  toLocationId,
  quantity,
  actorId,           // logs as acted_by_id; can be null
}) => {
  const moveQty = Math.max(1, Number(quantity) || 1)
  // Fetch fresh: someone else may have sold/moved this between scan and submit.
  const { data: source, error: fetchErr } = await supabase
    .from('singles')
    .select('*, set:card_sets(id, brand, name, code, language)')
    .eq('id', singleId)
    .single()
  if (fetchErr) throw fetchErr
  if (source.deleted) throw new Error(`Single is deleted — cannot move`)
  if (source.status !== 'in_inventory' && source.status !== 'listed') {
    throw new Error(`Status "${source.status}" — only in_inventory / listed can be moved`)
  }
  const sourceQty = Number(source.quantity) || 1
  if (moveQty > sourceQty) {
    throw new Error(`Only ${sourceQty} available — cannot move ${moveQty}`)
  }
  if (source.location_id === toLocationId) {
    throw new Error('Already at destination location')
  }

  const auditCommon = {
    summary: `Moved ${moveQty} × ${source.card_name || 'single'} (${source.card_number || '?'})`,
    payload: {
      single_id: singleId,
      from_location_id: source.location_id,
      to_location_id: toLocationId,
      quantity: moveQty,
      source_quantity_before: sourceQty,
    },
  }

  // Whole-row move: just flip location_id, no row split needed.
  if (moveQty === sourceQty) {
    const { data: updated, error: updErr } = await supabase
      .from('singles')
      .update({ location_id: toLocationId })
      .eq('id', singleId)
      .select('*, set:card_sets(id, brand, name, code, language), location:locations(id, name)')
      .single()
    if (updErr) throw updErr
    logSingleEvent({ single_id: singleId, event_type: 'moved', acted_by_id: actorId, ...auditCommon })
    return { mode: 'whole', single: updated }
  }

  // Partial move: decrement source qty, insert a clone at the new location.
  // Clone keeps all cost / acquisition fields so per-card analytics aren't
  // distorted by the move.
  const { error: decErr } = await supabase
    .from('singles')
    .update({ quantity: sourceQty - moveQty })
    .eq('id', singleId)
  if (decErr) throw decErr
  const clone = {
    card_name: source.card_name,
    card_number: source.card_number,
    set_id: source.set_id,
    brand: source.brand,
    language: source.language,
    variant: source.variant,
    form: source.form,
    condition: source.condition,
    quantity: moveQty,
    tcg_id: source.tcg_id,
    cert_number: source.cert_number,
    grading_company: source.grading_company,
    grade: source.grade,
    acquisition_cost_usd: source.acquisition_cost_usd,
    acquisition_cost_native: source.acquisition_cost_native,
    acquisition_currency: source.acquisition_currency,
    current_market_price_usd: source.current_market_price_usd,
    market_price_source: source.market_price_source,
    market_price_updated_at: source.market_price_updated_at,
    source_type: source.source_type,
    source_box_break_id: source.source_box_break_id,
    source_acquisition_id: source.source_acquisition_id,
    location_id: toLocationId,
    acquirer_id: source.acquirer_id,
    vendor_id: source.vendor_id,
    date_acquired: source.date_acquired,
    status: 'in_inventory',
    parent_single_id: singleId,
    notes: `Split from ${singleId} via Move Inventory (${moveQty} of ${sourceQty})`,
  }
  const { data: inserted, error: insErr } = await supabase
    .from('singles')
    .insert(clone)
    .select('*, set:card_sets(id, brand, name, code, language), location:locations(id, name)')
    .single()
  if (insErr) {
    // Best-effort revert of the qty decrement so we don't lose units
    // if the INSERT fails for any reason.
    await supabase.from('singles').update({ quantity: sourceQty }).eq('id', singleId)
    throw insErr
  }
  logSingleEvent({ single_id: singleId,         event_type: 'moved', acted_by_id: actorId, ...auditCommon })
  logSingleEvent({ single_id: inserted.id,      event_type: 'moved', acted_by_id: actorId,
                   summary: `Created via move from ${source.card_name || 'single'} (${moveQty} units)`,
                   payload: { ...auditCommon.payload, clone_of: singleId } })
  return { mode: 'split', source_id: singleId, clone: inserted }
}

// Move a slab. Always qty=1 so it's just a location_id flip + audit row.
export const moveSlabToLocation = async ({
  slabId,
  toLocationId,
  actorId,
}) => {
  const { data: source, error: fetchErr } = await supabase
    .from('slabs')
    .select('id, item_name, cert_number, status, location_id, deleted')
    .eq('id', slabId)
    .single()
  if (fetchErr) throw fetchErr
  if (source.deleted) throw new Error('Slab is deleted — cannot move')
  if (source.status !== 'in_inventory' && source.status !== 'listed') {
    throw new Error(`Status "${source.status}" — only in_inventory / listed can be moved`)
  }
  if (source.location_id === toLocationId) {
    throw new Error('Already at destination location')
  }
  const { data: updated, error: updErr } = await supabase
    .from('slabs')
    .update({ location_id: toLocationId })
    .eq('id', slabId)
    .select('*, location:locations(id, name)')
    .single()
  if (updErr) throw updErr
  logSlabEvent({
    slab_id: slabId,
    event_type: 'moved',
    summary: `Moved slab "${source.item_name}" cert #${source.cert_number}`,
    payload: { from_location_id: source.location_id, to_location_id: toLocationId },
    acted_by_id: actorId,
  })
  return updated
}

// Fetch singles + slabs currently at a given location — used by Move
// Inventory to populate the manual-search "what's in this room" view.
// Mirrors the constraints used by the storefront search (sellable rows
// only: in_inventory / listed, qty > 0 for singles).
export const fetchSinglesAtLocation = async (locationId) => {
  if (!locationId) return []
  const { data, error } = await supabase
    .from('singles')
    .select(`
      id, card_name, card_number, condition, quantity, tcg_id, status, form,
      set:card_sets(id, name)
    `)
    .eq('location_id', locationId)
    .eq('deleted', false)
    .in('status', ['in_inventory', 'listed'])
    .gt('quantity', 0)
    .order('card_name')
  if (error) throw error
  return data || []
}
export const fetchSlabsAtLocation = async (locationId) => {
  if (!locationId) return []
  const { data, error } = await supabase
    .from('slabs')
    .select('id, item_name, cert_number, grading_company, status, location_id')
    .eq('location_id', locationId)
    .eq('deleted', false)
    .in('status', ['in_inventory', 'listed'])
    .order('item_name')
  if (error) throw error
  return data || []
}

// ----- Manual search for Storefront POS (no-barcode fallback) -----
// These three helpers back the "Manual entry" panel under the scan box:
// cashier types a partial name / TCG ID / cert#, gets a short result list,
// clicks one to add it to the cart. Same downstream code path as scanning
// (each helper returns the shape lookupScannedCode would have for that kind).
// Limit caps at 20 to keep the dropdown sane on mobile.

// Sealed products by partial brand/name/type. Returns an array of
// { kind: 'sealed', product, inventory } so the click-handler can feed it
// straight into addOrIncrementSealed (which expects that shape).
export const searchProductsForStorefront = async (q, limit = 20) => {
  const term = String(q || '').trim()
  if (term.length < 2) return []
  const pattern = `%${term}%`
  // ILIKE only works on text columns. products.type is an enum
  // (product_type) so we can't include it in the OR — searching by
  // brand + name covers what cashiers actually type ("Pokemon",
  // "Charizard", "Mega…") and skips the enum problem.
  const { data: products, error } = await supabase
    .from('products')
    .select('id, brand, name, category, language, type, barcode, active')
    .eq('active', true)
    .or(`name.ilike.${pattern},brand.ilike.${pattern}`)
    .order('brand').order('name')
    .limit(limit)
  if (error) throw error
  if (!products || products.length === 0) return []

  // Fetch inventory rows for these products in one query so we don't N+1.
  const ids = products.map(p => p.id)
  const { data: invRows, error: invErr } = await supabase
    .from('inventory')
    .select(`
      quantity, avg_cost_basis, location_id, product_id,
      location:locations(id, name)
    `)
    .in('product_id', ids)
    .gt('quantity', 0)
  if (invErr) throw invErr
  const invByProduct = new Map()
  for (const r of invRows || []) {
    if (!invByProduct.has(r.product_id)) invByProduct.set(r.product_id, [])
    invByProduct.get(r.product_id).push({
      location_id: r.location_id,
      location_name: r.location?.name,
      quantity: r.quantity,
      avg_cost_basis: r.avg_cost_basis ?? 0,
    })
  }
  return products.map(p => ({
    kind: 'sealed',
    product: p,
    inventory: invByProduct.get(p.id) || [],
  }))
}

// Singles by partial card name / card_number / tcg_id. Only returns rows
// currently sellable (in_inventory or listed, not deleted, qty > 0).
export const searchSinglesForStorefront = async (q, limit = 20) => {
  const term = String(q || '').trim()
  if (term.length < 2) return []
  const pattern = `%${term}%`
  const { data, error } = await supabase
    .from('singles')
    .select(`
      *,
      set:card_sets(id, brand, name, code, language),
      location:locations(id, name)
    `)
    .eq('deleted', false)
    .in('status', ['in_inventory', 'listed'])
    .gt('quantity', 0)
    .or(`card_name.ilike.${pattern},card_number.ilike.${pattern},tcg_id.ilike.${pattern}`)
    .order('card_name')
    .limit(limit)
  if (error) throw error
  return (data || []).map(single => ({ kind: 'single', single }))
}

// Slabs by partial item_name / cert_number. Only returns currently
// sellable rows. Slabs are unique (qty=1) so no qty filter needed.
export const searchSlabsForStorefront = async (q, limit = 20) => {
  const term = String(q || '').trim()
  if (term.length < 2) return []
  const pattern = `%${term}%`
  const { data, error } = await supabase
    .from('slabs')
    .select('*, location:locations(id, name)')
    .eq('deleted', false)
    .in('status', ['in_inventory', 'listed'])
    .or(`item_name.ilike.${pattern},cert_number.ilike.${pattern}`)
    .order('item_name')
    .limit(limit)
  if (error) throw error
  return (data || []).map(slab => ({ kind: 'slab', slab }))
}

// ----- storefront transaction submit -----

// Sell a sealed product line at the storefront. Handles auto-Move from
// Master → Front Store if the SKU isn't already at Front Store.
//
// Returns { ok: true, sale } on success, throws on failure (caller catches
// and routes to `failed[]`).
const _sellSealedLine = async ({
  product,
  quantity,
  salePrice,
  paymentMethodId,
  cashierId,
  transactionId,
  sourceCandidates,   // [{location_id, location_name, quantity, avg_cost_basis}, ...]
  locationIds,        // { frontStore: uuid, master: uuid }
  saleDate,
  txMeta = {},        // { transactionType, tradeInValue, tradeInNotes, netCash }
}) => {
  const frontStoreId = locationIds.frontStore
  const masterId = locationIds.master

  // Step 1: figure out where the units come from. Prefer Front Store; fall
  // back to Master with an auto-Move; if even Master is short, error out.
  const frontStock = sourceCandidates.find(s => s.location_id === frontStoreId)?.quantity || 0
  const masterStock = sourceCandidates.find(s => s.location_id === masterId)?.quantity || 0
  const needFromMaster = Math.max(0, quantity - frontStock)

  if (frontStock + masterStock < quantity) {
    throw new Error(
      `Not enough stock: need ${quantity}, have ${frontStock} at Front Store + ${masterStock} at Master`
    )
  }

  // Step 2: if we need to pull from Master, do the Move first so the
  // Front Store deduction below is clean. The Move row records the
  // automatic transfer so it's auditable later.
  if (needFromMaster > 0) {
    const frontEntry = sourceCandidates.find(s => s.location_id === frontStoreId)
    const masterEntry = sourceCandidates.find(s => s.location_id === masterId)
    const newAvgCost = masterEntry?.avg_cost_basis ?? null

    await createMovement({
      product_id: product.id,
      source_location_id: masterId,
      dest_location_id: frontStoreId,
      quantity: needFromMaster,
      moved_by_id: cashierId || null,
      // Tag in the notes column so it's clear in audits this wasn't a
      // human-initiated Move — it was the storefront's just-in-time fetch.
      notes: `Auto-Move: storefront sale (transaction ${transactionId.slice(0, 8)}…)`,
    }).catch(() => { /* notes column may not exist; ignore */ })
    await updateInventory(product.id, masterId, -needFromMaster)
    await updateInventory(product.id, frontStoreId, +needFromMaster, newAvgCost)
  }

  // Step 3: deduct from Front Store and record the storefront sale.
  // For cost basis: use the avg at Front Store AFTER any incoming move.
  const { data: frontInv } = await supabase
    .from('inventory')
    .select('avg_cost_basis')
    .eq('product_id', product.id)
    .eq('location_id', frontStoreId)
    .maybeSingle()
  const unitCost = frontInv?.avg_cost_basis ?? 0
  // storefront_sales.sale_price is the LINE TOTAL (price × qty) by
  // convention — matches legacy rows and the daily summary calculation.
  // cost_basis matches: also line total. profit = lineTotal − costBasis.
  const linePrice = (Number(salePrice) || 0) * quantity
  const costBasis = unitCost * quantity
  const profit = linePrice - costBasis

  const sale = await createStorefrontSale({
    date: saleDate,
    sale_type: 'Itemized',
    product_id: product.id,
    location_id: frontStoreId,
    quantity,
    sale_price: linePrice,
    cost_basis: costBasis,
    profit,
    payment_method_id: paymentMethodId || null,
    cashier_id: cashierId || null,
    transaction_id: transactionId,
    transaction_type: txMeta.transactionType || 'sale',
    trade_in_value_usd: txMeta.tradeInValue ?? null,
    net_cash_usd: txMeta.netCash ?? null,
    trade_in_notes: txMeta.tradeInNotes || null,
  })

  await updateInventory(product.id, frontStoreId, -quantity)

  return { sale }
}

// Sell a slab at the storefront. Slab is unique (qty=1) so no quantity arg.
const _sellSlabLine = async ({ slab, salePrice, paymentMethodId, cashierId, transactionId, saleDate, txMeta = {} }) => {
  // Defensive re-check: somebody might have sold this slab between the
  // scan and the cart-submit (multi-cashier scenario).
  const { data: fresh, error: fetchErr } = await supabase
    .from('slabs')
    .select('id, status')
    .eq('id', slab.id)
    .single()
  if (fetchErr) throw fetchErr
  if (fresh.status !== 'in_inventory' && fresh.status !== 'listed') {
    throw new Error(`Slab status is "${fresh.status}" — can only sell from in_inventory or listed`)
  }

  return await markSlabAsSold(slab.id, {
    sale_price_usd: Number(salePrice) || 0,
    sale_channel: 'in_person',
    sale_date: saleDate,
    sale_fees_usd: null,
    buyer_name: null,
    sale_notes: null,
    sold_by_id: cashierId || null,
    payment_method_id: paymentMethodId || null,
    transaction_id: transactionId,
    transaction_type: txMeta.transactionType || 'sale',
    trade_in_value_usd: txMeta.tradeInValue ?? null,
    net_cash_usd: txMeta.netCash ?? null,
  })
}

// Sell N units of a raw single. Handles the fungible-split case where
// the source row has more units than we're selling — we don't flip the
// whole row to sold, we decrement the source and insert a sold clone.
const _sellSingleLine = async ({ single, quantity, salePrice, paymentMethodId, cashierId, transactionId, saleDate, txMeta = {} }) => {
  const isFungibleRaw = single.form === 'raw' && (single.quantity || 1) > 1
  const sourceQty = single.quantity || 1
  const sellQty = Math.max(1, Number(quantity) || 1)

  if (sellQty > sourceQty) {
    throw new Error(`Only ${sourceQty} available — cannot sell ${sellQty}`)
  }

  // Whole-row sale: just flip status. Existing markSingleAsSold handles it.
  if (!isFungibleRaw || sellQty === sourceQty) {
    return await markSingleAsSold(single.id, {
      sale_price_usd: Number(salePrice) || 0,
      sale_channel: 'in_person',
      sale_date: saleDate,
      sale_fees_usd: null,
      buyer_name: null,
      sale_notes: null,
      sold_by_id: cashierId || null,
      payment_method_id: paymentMethodId || null,
      transaction_id: transactionId,
      transaction_type: txMeta.transactionType || 'sale',
      trade_in_value_usd: txMeta.tradeInValue ?? null,
      net_cash_usd: txMeta.netCash ?? null,
    })
  }

  // Partial sale: split the row. Source row qty drops by sellQty, and we
  // INSERT a clone with qty=sellQty + status='sold' + sale_* filled. The
  // clone keeps the same set / cost / acquisition fields so per-card
  // analytics line up.
  const remainingQty = sourceQty - sellQty
  const { error: updErr } = await supabase
    .from('singles')
    .update({ quantity: remainingQty })
    .eq('id', single.id)
  if (updErr) throw updErr

  const clone = {
    card_name: single.card_name,
    card_number: single.card_number,
    set_id: single.set_id,
    brand: single.brand,
    language: single.language,
    variant: single.variant,
    form: single.form,
    condition: single.condition,
    quantity: sellQty,
    tcg_id: single.tcg_id,
    acquisition_cost_usd: single.acquisition_cost_usd,
    acquisition_cost_native: single.acquisition_cost_native,
    acquisition_currency: single.acquisition_currency,
    source_type: single.source_type,
    source_box_break_id: single.source_box_break_id,
    source_acquisition_id: single.source_acquisition_id,
    location_id: single.location_id,
    acquirer_id: single.acquirer_id,
    vendor_id: single.vendor_id,
    date_acquired: single.date_acquired,
    notes: `Split from ${single.id} (storefront sale of ${sellQty} of ${sourceQty})`,
    // Sale fields
    status: 'sold',
    sale_price_usd: Number(salePrice) || 0,
    sale_channel: 'in_person',
    sale_date: saleDate,
    sold_by_id: cashierId || null,
    payment_method_id: paymentMethodId || null,
    transaction_id: transactionId,
    transaction_type: txMeta.transactionType || 'sale',
    trade_in_value_usd: txMeta.tradeInValue ?? null,
    net_cash_usd: txMeta.netCash ?? null,
    parent_single_id: single.id,
  }
  const { data: inserted, error: insErr } = await supabase
    .from('singles')
    .insert(clone)
    .select(`*, set:card_sets(id, brand, name, code, language), location:locations(id, name)`)
    .single()
  if (insErr) throw insErr
  return inserted
}

// ----- BUY: store buys items from a customer (cash flows OUT to customer) -----

// Buy a sealed product line: INCREASE Front Store inventory by qty, weight-
// average avg_cost_basis with the price we just paid. Record the buy in
// storefront_sales (product_id filled, sale_price stores the LINE total
// we paid, net_cash_usd is negative because cash left our drawer).
const _buySealedLine = async ({
  product,
  quantity,
  unitPrice,
  paymentMethodId,
  cashierId,
  transactionId,
  locationIds,   // { frontStore: uuid }
  saleDate,
  txMeta = {},
}) => {
  const frontStoreId = locationIds.frontStore
  const qty = Number(quantity) || 1
  const price = Number(unitPrice) || 0
  const lineTotal = price * qty

  // updateInventory handles weighted-average cost basis when quantity
  // change is positive AND newAvgCost is provided. Existing avg blends
  // with the new cost we just paid.
  await updateInventory(product.id, frontStoreId, qty, price)

  // Record the money out. We deliberately set cost_basis = NULL and
  // profit = NULL here — both are inherent to SELL semantics; on buys
  // they don't apply. transaction_type='buy' plus the negative net_cash
  // is the discriminator downstream queries should look at.
  const sale = await createStorefrontSale({
    date: saleDate,
    sale_type: 'Itemized',
    product_id: product.id,
    location_id: frontStoreId,
    quantity: qty,
    sale_price: lineTotal,   // line total paid (per-unit × qty)
    cost_basis: null,
    profit: null,
    payment_method_id: paymentMethodId || null,
    cashier_id: cashierId || null,
    transaction_id: transactionId,
    transaction_type: 'buy',
    trade_in_value_usd: null,
    net_cash_usd: -lineTotal,   // signed negative: cash out
    trade_in_notes: null,
    notes: 'BUY: sealed inventory acquired from customer',
  })

  return { sale, inventory_delta: +qty }
}

// Buy a slab or single MANUALLY: the cashier types the description because
// the item isn't yet in our card systems. We DO NOT insert into slabs/
// singles here — that intake is a deliberate separate step (Cards Scan)
// where the store staff captures cert#, condition, grading info etc.
// We just record the money out in storefront_sales with product_id=null
// and the description in notes (prefixed by kind for easy filtering).
const _buyManualLine = async ({
  subKind,        // 'slab' | 'single'
  description,
  quantity,
  unitPrice,
  paymentMethodId,
  cashierId,
  transactionId,
  locationIds,    // { frontStore }
  saleDate,
  txMeta = {},
}) => {
  const qty = Number(quantity) || 1
  const price = Number(unitPrice) || 0
  const lineTotal = price * qty
  const desc = (description || '').trim() || '(no description)'

  const sale = await createStorefrontSale({
    date: saleDate,
    sale_type: 'Itemized',
    product_id: null,
    location_id: locationIds.frontStore || null,
    quantity: qty,
    sale_price: lineTotal,
    cost_basis: null,
    profit: null,
    payment_method_id: paymentMethodId || null,
    cashier_id: cashierId || null,
    transaction_id: transactionId,
    transaction_type: 'buy',
    trade_in_value_usd: null,
    net_cash_usd: -lineTotal,
    trade_in_notes: null,
    notes: `BUY: ${subKind} — ${desc}`,
  })

  return { sale, note: 'Recorded only — cards inventory NOT updated (intake separately via Cards Scan).' }
}

// Public: submit one storefront cart as a single transaction. Returns
// { transaction_id, ok: [...], failed: [...] }. Caller (the page) uses the
// failed[] to keep those lines visible for retry.
//
// Args new in v2 (Trade support):
//   - transactionType: 'sale' | 'trade'  (default 'sale')
//   - tradeInValue:    USD value the cashier estimated for items the
//                      customer brought in (only meaningful for 'trade').
//                      Ignored for sales.
// The net cash for the transaction is computed here as gross − tradeIn:
//   - sale  → net cash = sum of (price × qty)  (positive)
//   - trade → net cash = sum of (price × qty) − tradeInValue  (signed)
// Each row written carries the same transaction_type / trade_in_value_usd /
// net_cash_usd values for query consistency (so any one row from the
// transaction tells the full story).
export const submitStorefrontTransaction = async ({
  cart,             // [{ kind, productId|slabId|singleId, scanned_code, quantity, price, ...meta }, ...]
  paymentMethodId,  // legacy single-method input (back-compat). Either this OR `payments`.
  payments,         // NEW: [{ payment_method_id, amount }] for split payments. 1 or 2 entries.
  cashierId,
  saleDate,         // 'YYYY-MM-DD'
  transactionType = 'sale',
  tradeInValue = null,
  tradeInNotes = null,
}) => {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('Cart is empty')
  }

  // Normalize payments. Two valid input shapes:
  //   A) Legacy: paymentMethodId is set, payments is empty → single-method.
  //   B) New:    payments = [{ payment_method_id, amount }, ...] with 1 or 2 rows.
  // Internally we always work with an array of {method_id, amount} so the
  // line writers + ledger insert + Lark builder all use one shape.
  let normalizedPayments
  if (Array.isArray(payments) && payments.length > 0) {
    normalizedPayments = payments
      .filter(p => p && p.payment_method_id)
      .map(p => ({
        payment_method_id: p.payment_method_id,
        amount: Number(p.amount) || 0,
      }))
      .filter(p => p.amount > 0)
    if (normalizedPayments.length === 0) {
      throw new Error('No valid payment entries (each needs method + amount > 0)')
    }
    if (normalizedPayments.length > 2) {
      throw new Error('At most 2 payment methods per transaction')
    }
  } else if (paymentMethodId) {
    normalizedPayments = [{ payment_method_id: paymentMethodId, amount: null }]
    // amount=null → "use the transaction's full net cash" (filled below after we know netCash)
  } else {
    normalizedPayments = []   // no payment recorded — only valid for "we pay customer" flows
  }

  // Compute gross + net cash up-front so each line write gets the same value.
  // grossValue is the absolute total value of items in the cart, regardless
  // of direction (we receive or we pay).
  const grossValue = cart.reduce((s, l) => {
    const qty = Number(l.quantity ?? 1) || 0
    const price = Number(l.price) || 0
    return s + qty * price
  }, 0)
  const tradeIn = transactionType === 'trade' && tradeInValue != null
    ? Number(tradeInValue) || 0
    : null
  // Net cash direction by transaction type:
  //   sale  → customer pays us the gross. net = +gross
  //   trade → net = gross − tradeIn (signed; can be negative if we pay them)
  //   buy   → WE pay the customer the gross. net = -gross (always negative)
  let netCash
  if (transactionType === 'buy') netCash = -grossValue
  else if (transactionType === 'trade') netCash = grossValue - (tradeIn || 0)
  else netCash = grossValue
  const txMeta = {
    transactionType,
    tradeInValue: tradeIn,
    tradeInNotes: transactionType === 'trade' ? (tradeInNotes || null) : null,
    netCash,
  }

  // Now we know netCash → fill in the legacy single-method amount (it
  // covers the full transaction). For split payments validate the sum
  // matches the amount the customer is paying.
  //
  // "Amount paid by customer" = absolute(netCash) when money flows IN
  // (sale, or trade w/ positive net). For "we pay customer" flows the
  // split UI is disabled upstream, so we don't have to validate sums.
  const customerPaysIn =
    transactionType === 'sale' ||
    (transactionType === 'trade' && netCash > 0)
  if (normalizedPayments.length === 1 && normalizedPayments[0].amount == null) {
    // Legacy single-method path — amount is the absolute value of netCash.
    normalizedPayments[0].amount = Math.abs(netCash)
  }
  if (normalizedPayments.length === 2) {
    if (!customerPaysIn) {
      throw new Error('Split payment only supported for sale or trade-with-positive-net')
    }
    const sum = normalizedPayments.reduce((s, p) => s + p.amount, 0)
    // Tolerate $0.01 rounding noise from floating-point math.
    if (Math.abs(sum - Math.abs(netCash)) > 0.01) {
      throw new Error(`Payment split ($${sum.toFixed(2)}) doesn't match amount due ($${Math.abs(netCash).toFixed(2)})`)
    }
    if (normalizedPayments[0].payment_method_id === normalizedPayments[1].payment_method_id) {
      throw new Error('Two payment entries must use different methods')
    }
  }

  // Pick the "primary" payment method to stamp on the legacy
  // payment_method_id columns in storefront_sales / singles / slabs.
  // For single-method this is just that method. For split it's the
  // method with the larger amount (so existing reports that only read
  // the single-method column attribute the txn to its dominant method).
  // The authoritative split lives in storefront_payments.
  const primaryPaymentMethodId = normalizedPayments.length > 0
    ? [...normalizedPayments].sort((a, b) => b.amount - a.amount)[0].payment_method_id
    : null

  // Resolve key location IDs once
  const { data: locs, error: locsErr } = await supabase
    .from('locations')
    .select('id, name')
    .in('name', [FRONT_STORE_NAME, MASTER_NAME])
  if (locsErr) throw locsErr
  const frontStoreId = locs.find(l => l.name === FRONT_STORE_NAME)?.id
  const masterId = locs.find(l => l.name === MASTER_NAME)?.id
  if (!frontStoreId) throw new Error(`Location "${FRONT_STORE_NAME}" not configured`)

  // crypto.randomUUID is available in browsers and modern Node; fall back
  // to a less-perfect string if missing (the DB column accepts any UUID).
  const transactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  const ok = []
  const failed = []

  // Route each line by (transactionType, kind). Sale + trade send to the
  // sell-side helpers; buy sends to the buy-side helpers (which differ in
  // direction and, for slab/single, skip touching the cards inventory).
  const isBuy = transactionType === 'buy'

  // Existing line writers take a single `paymentMethodId`. We pass the
  // "primary" (largest-amount) method so legacy reports that read the
  // per-row payment_method_id still see a sensible attribution. The full
  // split is recorded after the loop in storefront_payments.
  const rowPaymentMethodId = primaryPaymentMethodId

  for (const line of cart) {
    try {
      if (line.kind === 'sealed') {
        const result = isBuy
          ? await _buySealedLine({
              product: line.product,
              quantity: Number(line.quantity) || 1,
              unitPrice: line.price,
              paymentMethodId: rowPaymentMethodId, cashierId, transactionId,
              locationIds: { frontStore: frontStoreId, master: masterId },
              saleDate,
              txMeta,
            })
          : await _sellSealedLine({
              product: line.product,
              quantity: Number(line.quantity) || 1,
              salePrice: line.price,
              paymentMethodId: rowPaymentMethodId, cashierId, transactionId,
              sourceCandidates: line.inventory || [],
              locationIds: { frontStore: frontStoreId, master: masterId },
              saleDate,
              txMeta,
            })
        ok.push({ line, result })
      } else if (line.kind === 'slab') {
        // Sale/trade only — a buy of a slab takes the manual path below.
        const result = await _sellSlabLine({
          slab: line.slab,
          salePrice: line.price,
          paymentMethodId: rowPaymentMethodId, cashierId, transactionId,
          saleDate,
          txMeta,
        })
        ok.push({ line, result })
      } else if (line.kind === 'single') {
        // Same as slab — buy goes through manual.
        const result = await _sellSingleLine({
          single: line.single,
          quantity: Number(line.quantity) || 1,
          salePrice: line.price,
          paymentMethodId: rowPaymentMethodId, cashierId, transactionId,
          saleDate,
          txMeta,
        })
        ok.push({ line, result })
      } else if (line.kind === 'slab_manual' || line.kind === 'single_manual') {
        // BUY-only path: customer is selling us a slab/single. We record
        // the money out but DO NOT auto-create a row in slabs/singles —
        // the store staff intakes those separately via Cards Scan once
        // they've gathered cert#/TCG ID/condition/etc.
        if (!isBuy) {
          throw new Error(`${line.kind} can only be used in Buy transactions`)
        }
        const result = await _buyManualLine({
          subKind: line.kind === 'slab_manual' ? 'slab' : 'single',
          description: line.description || '',
          quantity: Number(line.quantity) || 1,
          unitPrice: line.price,
          paymentMethodId: rowPaymentMethodId, cashierId, transactionId,
          locationIds: { frontStore: frontStoreId },
          saleDate,
          txMeta,
        })
        ok.push({ line, result })
      } else {
        throw new Error(`Unknown line kind: ${line.kind}`)
      }
    } catch (err) {
      console.error('[submitStorefrontTransaction] line failed:', line, err)
      failed.push({ line, error: err.message || String(err) })
    }
  }

  // Write the payment-split ledger AFTER at least one line succeeded.
  // We don't want orphan storefront_payments rows pointing at a txn
  // where every line failed. Failures here are non-fatal — the txn
  // itself is already on disk via the line writes; we just lose split
  // attribution. Log loudly so the issue gets noticed.
  if (ok.length > 0 && normalizedPayments.length > 0) {
    try {
      const ledgerRows = normalizedPayments.map(p => ({
        transaction_id: transactionId,
        payment_method_id: p.payment_method_id,
        amount_usd: p.amount,
      }))
      const { error: payErr } = await supabase
        .from('storefront_payments')
        .insert(ledgerRows)
      if (payErr) {
        console.error('[submitStorefrontTransaction] storefront_payments insert failed:', payErr)
      }
    } catch (err) {
      console.error('[submitStorefrontTransaction] storefront_payments insert threw:', err)
    }
  }

  // Cash-drawer alert is no longer fired per-transaction — moved to a
  // 7 PM PT cron at /api/cash-alert-eod (directive 2026-05-29 revision)
  // so oscillating cash totals don't ping the group multiple times.

  return {
    transaction_id: transactionId,
    transaction_type: txMeta.transactionType,
    gross_value: grossValue,
    trade_in_value: txMeta.tradeInValue,
    net_cash: txMeta.netCash,
    payments: normalizedPayments,
    ok, failed,
  }
}

// (cash-drawer alert helper removed — moved to /api/cash-alert-eod cron)

// Fetch a daily storefront summary across all 3 sale tables. Dedupes by
// transaction_id (each transaction may span sealed + single + slab rows,
// but they all share the same header values). Returns:
//   {
//     date,
//     transactions: [{ transaction_id, type, net_cash, payment_method_id, gross_value }, ...],
//     totals: { sale_count, sale_net_cash, trade_count, trade_net_cash, total_net_cash },
//     by_payment: { [payment_method_name]: { count, total_net_cash } }
//   }
// The page widget at top of StorefrontSale renders this so the cashier sees
// daily numbers without leaving the page they're working in.
export const fetchStorefrontDailySummary = async (date) => {
  const dayStr = date || new Date().toLocaleDateString('en-CA')

  // Pull header-relevant fields from each table for this date.
  // singles / slabs are filtered by sale_date + transaction_id IS NOT NULL
  // so we don't pick up Cards-Scan-Sell rows (those have null transaction_id).
  const [salesRes, singlesRes, slabsRes, pmRes, paymentsRes] = await Promise.all([
    supabase
      .from('storefront_sales')
      .select(`
        id, created_at, transaction_id, transaction_type, net_cash_usd,
        payment_method_id, sale_price, quantity, trade_in_value_usd, notes,
        product:products(name, brand, category)
      `)
      .eq('date', dayStr)
      .eq('deleted', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('singles')
      .select(`
        id, updated_at, transaction_id, transaction_type, net_cash_usd,
        payment_method_id, sale_price_usd, quantity, trade_in_value_usd,
        status, card_name, card_number, condition
      `)
      .eq('sale_date', dayStr)
      .not('transaction_id', 'is', null)
      .eq('status', 'sold')
      .order('updated_at', { ascending: false }),
    supabase
      .from('slabs')
      .select(`
        id, updated_at, transaction_id, transaction_type, net_cash_usd,
        payment_method_id, sale_price_usd, trade_in_value_usd, status,
        item_name, cert_number, grading_company
      `)
      .eq('sale_date', dayStr)
      .not('transaction_id', 'is', null)
      .eq('status', 'sold')
      .order('updated_at', { ascending: false }),
    supabase
      .from('payment_methods')
      .select('id, name'),
    // storefront_payments holds the per-transaction split. Bounded by
    // created_at on the same day to keep the fetch small. We don't
    // throw if this fails (table may not exist yet during rollout) —
    // we fall back to legacy single-method attribution.
    supabase
      .from('storefront_payments')
      .select('transaction_id, payment_method_id, amount_usd')
      .gte('created_at', `${dayStr}T00:00:00`)
      .lt('created_at', `${dayStr}T23:59:59.999`),
  ])
  if (salesRes.error) throw salesRes.error
  if (singlesRes.error) throw singlesRes.error
  if (slabsRes.error) throw slabsRes.error
  if (pmRes.error) throw pmRes.error
  // paymentsRes intentionally non-throwing — see the .from('storefront_payments')
  // call above. Log it if it errored, then move on with no split data.
  if (paymentsRes.error) {
    console.warn('[fetchStorefrontDailySummary] storefront_payments fetch failed:', paymentsRes.error)
  }

  // Dedupe by transaction_id. We track first-seen header values, AND
  // accumulate gross_value across all rows of the same transaction (each
  // table contributes line subtotals). Each row also appends to `items[]`
  // on the transaction so the collapsible Details view can show
  // exactly what was sold/traded/bought without a second fetch.
  const txMap = new Map()
  const addRow = (r, lineGross, itemDetail, timestamp) => {
    if (!r.transaction_id) return
    const existing = txMap.get(r.transaction_id)
    if (existing) {
      existing.gross_value += lineGross
      if (itemDetail) existing.items.push(itemDetail)
      // Keep the EARLIEST timestamp as the transaction time — feels more
      // intuitive than "last row written" when a cart had multiple lines.
      if (timestamp && (!existing.timestamp || timestamp < existing.timestamp)) {
        existing.timestamp = timestamp
      }
    } else {
      txMap.set(r.transaction_id, {
        transaction_id: r.transaction_id,
        type: r.transaction_type || 'sale',
        net_cash: r.net_cash_usd != null ? Number(r.net_cash_usd) : null,
        trade_in_value: r.trade_in_value_usd != null ? Number(r.trade_in_value_usd) : null,
        payment_method_id: r.payment_method_id,
        gross_value: lineGross,
        timestamp: timestamp || null,
        items: itemDetail ? [itemDetail] : [],
      })
    }
  }

  // ---- storefront_sales rows: sealed products + manual buy lines ----
  for (const r of salesRes.data || []) {
    const lineGross = Number(r.sale_price) || 0   // already a LINE total
    const qty = Number(r.quantity) || 1
    let kind = 'sealed', name = 'Unknown'
    if (r.product?.name) {
      const brand = r.product.brand ? `${r.product.brand} | ` : ''
      name = `${brand}${r.product.name}`
      kind = 'sealed'
    } else if (r.notes) {
      // Manual buy line — notes starts with "BUY: slab — ..." or "BUY: single — ..."
      const n = String(r.notes)
      if (/^BUY:\s*slab/i.test(n)) {
        kind = 'slab_manual'
        name = n.replace(/^BUY:\s*slab\s*[—-]\s*/i, '') || '(manual slab buy)'
      } else if (/^BUY:\s*single/i.test(n)) {
        kind = 'single_manual'
        name = n.replace(/^BUY:\s*single\s*[—-]\s*/i, '') || '(manual single buy)'
      } else {
        name = n
      }
    }
    // Per-unit price for display in the bullet (gross/qty)
    const perUnit = qty > 0 ? lineGross / qty : lineGross
    addRow(r, lineGross, {
      kind,
      name,
      quantity: qty,
      price: perUnit,
      subtotal: lineGross,
    }, r.created_at || null)
  }

  // ---- singles rows: card_name + card_number + condition ----
  for (const r of singlesRes.data || []) {
    const qty = Number(r.quantity) || 1
    const perUnit = Number(r.sale_price_usd) || 0
    const lineGross = perUnit * qty
    const num = r.card_number ? ` #${r.card_number}` : ''
    const cond = r.condition ? ` (${r.condition})` : ''
    addRow(r, lineGross, {
      kind: 'single',
      name: `${r.card_name || 'Unknown card'}${num}${cond}`,
      quantity: qty,
      price: perUnit,
      subtotal: lineGross,
    }, r.updated_at || null)
  }

  // ---- slabs rows: item_name already includes grade text; just append cert# ----
  // (slabs table has no separate `grade` column — the grade is part of
  // item_name like "Charizard PSA 10". grading_company is a short tag.)
  for (const r of slabsRes.data || []) {
    const lineGross = Number(r.sale_price_usd) || 0
    const co = r.grading_company ? ` ${r.grading_company}` : ''
    const cert = r.cert_number ? ` #${r.cert_number}` : ''
    addRow(r, lineGross, {
      kind: 'slab',
      name: `${r.item_name || 'Unknown slab'}${co}${cert}`,
      quantity: 1,
      price: lineGross,
      subtotal: lineGross,
    }, r.updated_at || null)
  }

  const pmById = new Map((pmRes.data || []).map(p => [p.id, p.name]))

  // Group split-payment rows by transaction so we can attach the
  // per-transaction breakdown without an N+1 lookup later.
  const splitByTxn = new Map()
  for (const p of paymentsRes?.data || []) {
    if (!p.transaction_id) continue
    if (!splitByTxn.has(p.transaction_id)) splitByTxn.set(p.transaction_id, [])
    splitByTxn.get(p.transaction_id).push({
      method_id: p.payment_method_id,
      method_name: pmById.get(p.payment_method_id) || 'Unknown',
      amount: Number(p.amount_usd) || 0,
    })
  }

  // Attach payment-method name + split breakdown to each transaction so
  // the details panel doesn't have to do its own lookup, and sort
  // most-recent first.
  const transactions = Array.from(txMap.values())
    .map(t => ({
      ...t,
      payment_method: pmById.get(t.payment_method_id) || 'Unknown',
      payments: splitByTxn.get(t.transaction_id) || null,   // null = no split data (legacy/missing)
    }))
    .sort((a, b) => {
      // Sort by timestamp descending; nulls last.
      if (!a.timestamp && !b.timestamp) return 0
      if (!a.timestamp) return 1
      if (!b.timestamp) return -1
      return b.timestamp.localeCompare(a.timestamp)
    })

  // Aggregate by transaction type. Buys contribute NEGATIVE cash (we paid
  // the customer) which pulls down the daily net. The per-payment-method
  // breakdown sums signed net_cash too, so "Cash: -$120" can show up when
  // the day's buys outweigh the day's cash sales.
  let saleCount = 0, saleNetCash = 0
  let tradeCount = 0, tradeNetCash = 0
  let buyCount = 0, buyNetCash = 0
  const byPayment = {}
  for (const t of transactions) {
    const cash = Number(t.net_cash || 0)
    if (t.type === 'trade') {
      tradeCount++; tradeNetCash += cash
    } else if (t.type === 'buy') {
      buyCount++; buyNetCash += cash
    } else {
      saleCount++; saleNetCash += cash
    }

    // Per-payment-method attribution. When we have ledger rows, distribute
    // by amount with the sign of net_cash so direction is preserved. When
    // we don't, fall back to the legacy single-method attribution where
    // the whole net_cash hits one method.
    if (t.payments && t.payments.length > 0) {
      const sign = cash >= 0 ? 1 : -1
      for (const p of t.payments) {
        const name = p.method_name
        if (!byPayment[name]) byPayment[name] = { count: 0, total_net_cash: 0 }
        byPayment[name].total_net_cash += sign * p.amount
      }
      // For "count" we credit the dominant method only — counting both
      // would inflate every split transaction into "2 transactions".
      const dom = [...t.payments].sort((a, b) => b.amount - a.amount)[0]
      if (!byPayment[dom.method_name]) byPayment[dom.method_name] = { count: 0, total_net_cash: 0 }
      byPayment[dom.method_name].count++
    } else {
      const pmName = pmById.get(t.payment_method_id) || 'Unknown'
      if (!byPayment[pmName]) byPayment[pmName] = { count: 0, total_net_cash: 0 }
      byPayment[pmName].count++
      byPayment[pmName].total_net_cash += cash
    }
  }

  return {
    date: dayStr,
    transactions,
    totals: {
      sale_count: saleCount,
      sale_net_cash: saleNetCash,
      trade_count: tradeCount,
      trade_net_cash: tradeNetCash,
      buy_count: buyCount,
      buy_net_cash: buyNetCash,
      total_net_cash: saleNetCash + tradeNetCash + buyNetCash,
    },
    by_payment: byPayment,
  }
}

// ============================================================================
// PLATFORM SALES — scan/cart checkout for online channels
// ============================================================================
// Mirrors submitStorefrontTransaction but writes to platform_sales instead of
// storefront_sales and uses sale_channel = platform (lower-cased) instead of
// 'in_person'. One transaction_id stamps every line so a cart submit is
// reassembleable. Inventory effects per kind:
//   sealed → deduct from Front Store (auto-Move from Master if needed),
//            same logic as the Storefront sealed path so the cost-basis
//            accounting stays consistent.
//   single → markSingleAsSold full-row OR fungible-split (decrement source
//            qty + clone a sold row), tagged with the platform channel.
//   slab   → markSlabAsSold (status flip + sale fields).
//
// Caller passes cart lines shaped the same as Storefront's, except no
// payment_method / trade-in:
//   { kind: 'sealed', product, inventory, quantity, price, our_price? }
//   { kind: 'single', single,  quantity, price, our_price? }
//   { kind: 'slab',   slab,    price, our_price? }
// `price` is what the customer actually paid (streamer-entered); `our_price`
// is the reference market price we showed, stored for analytics.
// ============================================================================

export const submitPlatformTransaction = async ({
  cart,
  platform,         // 'eBay' | 'TikTok' | 'Whatnot'
  channel,          // e.g. 'SlabbiePatty', 'LuckyVaultUS', 'PackHeadsTCG', 'RocketsHQ', 'Whatnot'
  streamRoomName,   // e.g. 'Stream Room - eBay SlabbiePatty' — sealed must
                    // already be at this location (no auto-Move per
                    // directive 2026-05-29). Required for sealed lines.
  streamerId,
  saleDate,         // 'YYYY-MM-DD'
}) => {
  if (!Array.isArray(cart) || cart.length === 0) throw new Error('Cart is empty')
  if (!platform) throw new Error('Platform is required')
  if (!channel)  throw new Error('Channel is required')

  // Resolve the channel's Stream Room location id (sealed deducts directly
  // from here — no auto-Move). Singles/slabs don't need a location id since
  // their sale is just a status flip.
  let streamRoomId = null
  if (streamRoomName) {
    const { data: roomRow } = await supabase
      .from('locations').select('id').eq('name', streamRoomName).maybeSingle()
    streamRoomId = roomRow?.id || null
    if (!streamRoomId) {
      throw new Error(`Stream room location "${streamRoomName}" not found`)
    }
  }

  const transactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `ptx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  // sale_channel value stored on singles/slabs rows. Use lowercase platform
  // so existing reports (which already key off 'ebay'/'tiktok'/'whatnot')
  // keep working. Tweak per channel later if anyone wants finer granularity.
  const saleChannel = String(platform).toLowerCase()

  const ok = []
  const failed = []

  for (const line of cart) {
    try {
      if (line.kind === 'sealed') {
        if (!streamRoomId) {
          throw new Error('Sealed sales require streamRoomName — Stream Room must be configured for this channel')
        }
        const result = await _sellSealedLinePlatform({
          product: line.product,
          quantity: Number(line.quantity) || 1,
          salePrice: line.price,
          ourPrice: line.our_price,
          sourceCandidates: line.inventory || [],
          platform, channel, streamerId, transactionId,
          streamRoomId, streamRoomName,
          saleDate,
        })
        ok.push({ line, result })
      } else if (line.kind === 'slab') {
        const result = await _sellSlabLinePlatform({
          slab: line.slab,
          salePrice: line.price,
          ourPrice: line.our_price,
          platform, channel, streamerId, transactionId, saleDate,
          saleChannel,
        })
        ok.push({ line, result })
      } else if (line.kind === 'single') {
        const result = await _sellSingleLinePlatform({
          single: line.single,
          quantity: Number(line.quantity) || 1,
          salePrice: line.price,
          ourPrice: line.our_price,
          platform, channel, streamerId, transactionId, saleDate,
          saleChannel,
        })
        ok.push({ line, result })
      } else {
        throw new Error(`Unknown line kind: ${line.kind}`)
      }
    } catch (err) {
      console.error('[submitPlatformTransaction] line failed:', line, err)
      failed.push({ line, error: err.message || String(err) })
    }
  }

  return { transaction_id: transactionId, ok, failed }
}

// ---- sealed: deduct + write platform_sales row -----------------------------

const _sellSealedLinePlatform = async ({
  product, quantity, salePrice, ourPrice,
  sourceCandidates, platform, channel, streamerId, transactionId,
  streamRoomId, streamRoomName, saleDate,
}) => {
  // HARD enforcement (directive 2026-05-29): sealed must already be at the
  // channel's Stream Room. No auto-Move. If the stream room is short, fail
  // with a clear message telling staff to use Move Inventory first.
  const roomSrc = (sourceCandidates || []).find(s => s.location_id === streamRoomId)
  const roomQty = roomSrc?.quantity || 0
  if (roomQty < quantity) {
    throw new Error(
      `Not enough at ${streamRoomName} — have ${roomQty}, need ${quantity}. ` +
      `Move ${quantity - roomQty} more there before selling.`
    )
  }

  // Cost basis: prefer the stream room's own avg_cost_basis (reflects what
  // was paid for the units that were Moved there). Fetched directly from
  // inventory in case sourceCandidates is stale.
  const { data: roomInv } = await supabase
    .from('inventory')
    .select('avg_cost_basis')
    .eq('product_id', product.id)
    .eq('location_id', streamRoomId)
    .maybeSingle()
  const unitCost = roomInv?.avg_cost_basis ?? roomSrc?.avg_cost_basis ?? 0
  const lineNet = (Number(salePrice) || 0) * quantity
  const cost    = unitCost * quantity
  const profit  = lineNet - cost

  const { data: inserted, error } = await supabase
    .from('platform_sales')
    .insert({
      kind: 'sealed',
      platform, channel,
      date: saleDate,
      streamer_id: streamerId || null,
      product_id: product.id,
      quantity,
      gross_sales: lineNet,
      net_sales:   lineNet,
      cost,
      profit,
      margin_percent: lineNet > 0 ? +((profit / lineNet) * 100).toFixed(2) : null,
      our_price_usd: ourPrice ?? null,
      transaction_id: transactionId,
    })
    .select()
    .single()
  if (error) throw error

  await updateInventory(product.id, streamRoomId, -quantity)
  return { sale: inserted }
}

// ---- slab: flip status to sold + write platform_sales row ------------------

const _sellSlabLinePlatform = async ({
  slab, salePrice, ourPrice,
  platform, channel, streamerId, transactionId, saleDate, saleChannel,
}) => {
  const { data: fresh, error: fetchErr } = await supabase
    .from('slabs').select('id, status').eq('id', slab.id).single()
  if (fetchErr) throw fetchErr
  if (fresh.status !== 'in_inventory' && fresh.status !== 'listed') {
    throw new Error(`Slab status is "${fresh.status}" — can only sell from in_inventory or listed`)
  }

  const updatedSlab = await markSlabAsSold(slab.id, {
    sale_price_usd: Number(salePrice) || 0,
    sale_channel: saleChannel,
    sale_date: saleDate,
    sale_fees_usd: null,
    buyer_name: null,
    sale_notes: `Platform sale via ${channel}`,
    sold_by_id: streamerId || null,
    payment_method_id: null,
    transaction_id: transactionId,
    transaction_type: 'sale',
  })

  const lineNet = Number(salePrice) || 0
  const cost = slab.acquisition_cost_usd != null ? Number(slab.acquisition_cost_usd) : null
  const profit = cost != null ? lineNet - cost : null
  const { error } = await supabase.from('platform_sales').insert({
    kind: 'slab',
    platform, channel,
    date: saleDate,
    streamer_id: streamerId || null,
    slab_id: slab.id,
    external_product_name: slab.item_name || null,
    quantity: 1,
    gross_sales: lineNet,
    net_sales:   lineNet,
    cost,
    profit,
    margin_percent: (lineNet > 0 && profit != null) ? +((profit / lineNet) * 100).toFixed(2) : null,
    our_price_usd: ourPrice ?? null,
    transaction_id: transactionId,
  })
  if (error) throw error
  return { slab: updatedSlab }
}

// ---- single: full-row sold OR fungible split, then platform_sales row ------

const _sellSingleLinePlatform = async ({
  single, quantity, salePrice, ourPrice,
  platform, channel, streamerId, transactionId, saleDate, saleChannel,
}) => {
  const isFungibleRaw = single.form === 'raw' && (single.quantity || 1) > 1
  const sourceQty = single.quantity || 1
  const sellQty   = Math.max(1, Number(quantity) || 1)
  if (sellQty > sourceQty) throw new Error(`Only ${sourceQty} available — cannot sell ${sellQty}`)

  const lineNet = (Number(salePrice) || 0) * sellQty
  const cost    = single.acquisition_cost_usd != null
    ? Number(single.acquisition_cost_usd) * sellQty / sourceQty   // proportional share
    : null
  const profit  = cost != null ? lineNet - cost : null
  const saleData = {
    sale_price_usd: Number(salePrice) || 0,
    sale_channel: saleChannel,
    sale_date: saleDate,
    sale_fees_usd: null,
    buyer_name: null,
    sale_notes: `Platform sale via ${channel}`,
    sold_by_id: streamerId || null,
    payment_method_id: null,
    transaction_id: transactionId,
    transaction_type: 'sale',
  }

  let soldRow
  if (!isFungibleRaw || sellQty === sourceQty) {
    soldRow = await markSingleAsSold(single.id, saleData)
  } else {
    // Fungible split — decrement source qty + insert a sold clone.
    const remainingQty = sourceQty - sellQty
    const { error: updErr } = await supabase
      .from('singles').update({ quantity: remainingQty }).eq('id', single.id)
    if (updErr) throw updErr
    const clone = {
      card_name: single.card_name, card_number: single.card_number,
      set_id: single.set_id, brand: single.brand, language: single.language,
      variant: single.variant, form: single.form, condition: single.condition,
      quantity: sellQty, tcg_id: single.tcg_id,
      acquisition_cost_usd: single.acquisition_cost_usd,
      acquisition_cost_native: single.acquisition_cost_native,
      acquisition_currency: single.acquisition_currency,
      source_type: single.source_type,
      source_box_break_id: single.source_box_break_id,
      source_acquisition_id: single.source_acquisition_id,
      location_id: single.location_id,
      acquirer_id: single.acquirer_id, vendor_id: single.vendor_id,
      date_acquired: single.date_acquired,
      notes: `Split from ${single.id} (platform sale of ${sellQty} of ${sourceQty})`,
      status: 'sold',
      parent_single_id: single.id,
      ...saleData,
    }
    const { data: inserted, error: insErr } = await supabase
      .from('singles').insert(clone).select().single()
    if (insErr) throw insErr
    soldRow = inserted
  }

  const { error } = await supabase.from('platform_sales').insert({
    kind: 'single',
    platform, channel,
    date: saleDate,
    streamer_id: streamerId || null,
    single_id: soldRow.id,
    external_product_name: `${single.card_name || ''}${single.card_number ? ` ${single.card_number}` : ''}`.trim() || null,
    quantity: sellQty,
    gross_sales: lineNet,
    net_sales:   lineNet,
    cost,
    profit,
    margin_percent: (lineNet > 0 && profit != null) ? +((profit / lineNet) * 100).toFixed(2) : null,
    our_price_usd: ourPrice ?? null,
    transaction_id: transactionId,
  })
  if (error) throw error
  return { single: soldRow }
}
