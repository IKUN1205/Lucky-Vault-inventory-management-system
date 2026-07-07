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

// Fire the back-sync to the Google Sheet AND parse the response so the
// browser console shows a human-readable line instead of a silent 404
// or a cryptic "noop:true" payload. Truly fire-and-forget — we never
// await (caller doesn't block on the sheet write) and a network error
// just becomes a console warning.
//
// The Vercel function logs the same human message server-side (see
// api/sheet-mark-sold.js → respond() helper) so DevTools and Vercel
// dashboard tell the same story. Use the response's `trace.sheet_url`
// (when present) to jump straight to the affected cell.
async function reportSheetSyncResult(kind, dbId) {
  try {
    const r = await fetch('/api/sheet-mark-sold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id: dbId }),
    })
    let body
    try { body = await r.json() }
    catch { body = { outcome: 'unparseable', message: `HTTP ${r.status} with non-JSON body` } }
    const prefix = `[sheet sync · ${kind}]`
    const OK_OUTCOMES = new Set(['marked_sold', 'sheet_updated', 'qty_decremented'])
    const NOOP_OUTCOMES = new Set(['already_sold', 'qty_already_correct'])
    if (r.ok && OK_OUTCOMES.has(body.outcome)) {
      console.log(`${prefix} ✓ ${body.message}`, body.trace?.sheet_url || '')
    } else if (r.ok && NOOP_OUTCOMES.has(body.outcome)) {
      console.log(`${prefix} (no change needed) ${body.message}`)
    } else if (r.ok && body.outcome === 'not_in_sheet') {
      console.info(`${prefix} (not in sheet — fine) ${body.message}`)
    } else {
      console.warn(`${prefix} ⚠ ${body.outcome || `HTTP ${r.status}`}: ${body.message || '(no message)'}`, body.trace || '')
    }
  } catch (netErr) {
    console.warn(`[sheet sync · ${kind}] network error reaching /api/sheet-mark-sold:`, netErr.message)
  }
}

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
  // Fire-and-forget back-sync to the Singles Google Sheet — push
  // Status = "sold" so the sheet reflects reality. Failures are
  // swallowed; the hourly safety-net sync (sync-singles-sheet) will
  // catch any item that didn't make it. Response shape is documented
  // in api/sheet-mark-sold.js — we forward the human `message` to the
  // browser console so staff or anyone debugging can see what happened.
  reportSheetSyncResult('single', data.id)
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
  // Fire-and-forget back-sync to the Slabs Google Sheet — same shape as
  // singles: push Status = "sold" + hourly safety-net catches any miss.
  reportSheetSyncResult('slab', data.id)
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

// Current Japan Warehouse stock for one product (0 if no row). Used by the
// acquisition undo/edit guards to make sure we never drive inventory negative
// by reversing a buy whose units have already been sold/shipped.
const fetchJapanProductStock = async (productId) => {
  const locId = await fetchJapanWarehouseLocation()
  const { data } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('product_id', productId)
    .eq('location_id', locId)
    .maybeSingle()
  return data?.quantity || 0
}

// Undo (撤销) a Japan acquisition. These are instant-receive, so the buy
// already added qty (at weighted-avg cost) to Japan Warehouse. Undo removes
// that qty and soft-deletes the row. Guarded: if current stock is below the
// buy's qty, some of it has already been sold/shipped — block and tell the
// user to adjust manually rather than silently driving stock negative.
// Removing stock leaves avg_cost_basis unchanged (the outflow rule in
// updateInventory), so no cost-basis surgery here.
export const undoJapanAcquisition = async (acqId, { deletedById = null, reason = null } = {}) => {
  const { data: acq, error: getErr } = await supabase
    .from('acquisitions')
    .select('id, product_id, quantity_purchased, origin, deleted')
    .eq('id', acqId)
    .maybeSingle()
  if (getErr) throw getErr
  if (!acq) throw new Error('Acquisition not found')
  if (acq.origin !== 'jp_vendor') throw new Error('Not a Japan acquisition')
  if (acq.deleted) throw new Error('This acquisition was already undone')

  const qty = acq.quantity_purchased || 0
  const stock = await fetchJapanProductStock(acq.product_id)
  if (qty > stock) {
    throw new Error(`Only ${stock} in Japan stock now, but this buy was ${qty} — some was already sold/shipped. Undo the sale/shipment first, or fix the count in 日本库存.`)
  }

  const locId = await fetchJapanWarehouseLocation()
  await updateInventory(acq.product_id, locId, -qty)  // remove (avg unchanged)
  const { error: delErr } = await supabase
    .from('acquisitions')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
      deleted_reason: reason || 'Japan acquisition undone from Japan acquisitions page',
    })
    .eq('id', acqId)
  if (delErr) throw delErr
  return acq
}

// Edit (修改) a Japan acquisition. Reconciles Japan Warehouse stock for any
// product / qty / unit-cost change by reversing the old buy's contribution
// and re-applying the corrected one, then rewrites the acquisition record.
// Metadata-only edits (vendor / payment / date / notes) skip the inventory
// math. Guarded the same way as undo: we must have enough current stock of
// the OLD product to reverse it.
//
// Cost-basis note: reversing an inflow can't perfectly un-weight the average
// when the same SKU also holds stock from other batches — the remaining
// units keep the current average. For a low-volume correction tool this is
// acceptable, and the live average is always adjustable on the 日本库存 page.
export const updateJapanAcquisition = async (acqId, {
  product_id, quantity, unit_cost_jpy, vendor_id, payment_method_id,
  date_purchased, notes,
}) => {
  const { data: old, error: getErr } = await supabase
    .from('acquisitions')
    .select('id, product_id, quantity_purchased, cost, origin, deleted, date_purchased')
    .eq('id', acqId)
    .maybeSingle()
  if (getErr) throw getErr
  if (!old) throw new Error('Acquisition not found')
  if (old.origin !== 'jp_vendor') throw new Error('Not a Japan acquisition')
  if (old.deleted) throw new Error('This acquisition was undone')

  if (!product_id) throw new Error('Product is required')
  const newQty = parseInt(quantity, 10)
  if (!Number.isFinite(newQty) || newQty <= 0) throw new Error('Quantity must be at least 1')

  const locId = await fetchJapanWarehouseLocation()
  const oldQty = old.quantity_purchased || 0
  const oldProduct = old.product_id
  const oldUnitJpy = oldQty > 0 ? (Number(old.cost) || 0) / oldQty : 0
  const newUnitJpy = parseFloat(unit_cost_jpy) || 0

  const productChanged = product_id !== oldProduct
  const qtyChanged = newQty !== oldQty
  const costChanged = Math.abs(newUnitJpy - oldUnitJpy) > 0.5
  const invChanged = productChanged || qtyChanged || costChanged

  if (invChanged) {
    // Reverse needs enough of the OLD product on hand.
    const oldStock = await fetchJapanProductStock(oldProduct)
    if (oldQty > oldStock) {
      throw new Error(`Only ${oldStock} of the original product in stock now, but this buy was ${oldQty} — some was already sold/shipped. Fix the sale/shipment first, or adjust in 日本库存.`)
    }
    const newTotalUsd = convertToUSD(newUnitJpy * newQty, 'JPY')
    const newUnitUsd = newQty > 0 ? newTotalUsd / newQty : 0
    await updateInventory(oldProduct, locId, -oldQty)             // reverse old (avg unchanged)
    await updateInventory(product_id, locId, newQty, newUnitUsd)  // re-apply new (weighted avg)
  }

  const totalCostJpy = newUnitJpy * newQty
  const totalCostUsd = convertToUSD(totalCostJpy, 'JPY')
  const { data: updated, error: upErr } = await supabase
    .from('acquisitions')
    .update({
      product_id,
      quantity_purchased: newQty,
      quantity_received: newQty,   // instant-receive stays in sync
      cost: totalCostJpy,
      cost_usd: totalCostUsd,
      currency: 'JPY',
      vendor_id: vendor_id || null,
      payment_method_id: payment_method_id || null,
      date_purchased: date_purchased || old.date_purchased,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', acqId)
    .select()
    .single()
  if (upErr) throw upErr
  return updated
}

// ============================================================================
// China (中国进货) — offline acquisitions. Direct mirror of the Japan flow.
// ============================================================================
// Same instant-receive model as Japan (buy = receive into China Warehouse in
// one step). currency = RMB (¥), source_country = 'China', origin = 'cn_vendor'.
// Requires the schema in sql/cn_jp_finance.sql (China Warehouse location, the
// 'China' region-enum value, and 'cn_vendor' on the acquisitions.origin CHECK).
// ============================================================================

let _cachedChinaLocationId = null

export const fetchChinaWarehouseLocation = async () => {
  if (_cachedChinaLocationId) return _cachedChinaLocationId
  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .eq('name', 'China Warehouse')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Location 'China Warehouse' not found — run sql/cn_jp_finance.sql first")
  _cachedChinaLocationId = data.id
  return data.id
}

// CN-side vendors (for the China Acquisitions vendor dropdown). STRICTLY
// country='China' — deliberately NOT null-country legacy vendors, which would
// pull US/legacy sellers into the China list. If a vendor is missing, set its
// country to 'China' on the Vendors page (or use "+ New" on the form).
export const fetchChinaVendors = async () => {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('active', true)
    .eq('country', 'China')
    .order('name')
  if (error) throw error
  return data || []
}

// Recent China offline purchases (cn_vendor origin only), for the Acquisitions
// page's "recent" list.
export const fetchChinaAcquisitions = async (limit = 50) => {
  const { data, error } = await supabase
    .from('acquisitions')
    .select(`
      *,
      vendor:vendors(name),
      payment_method:payment_methods(name),
      acquirer:users!acquirer_id(name),
      product:products(*)
    `)
    .eq('origin', 'cn_vendor')
    .or('deleted.is.null,deleted.eq.false')
    .order('date_purchased', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// China offline purchase = instant receive (no separate Intake step). Mirrors
// createJapanAcquisition: create acquisition row with status='Received', then
// bump China inventory by qty at weighted-avg USD cost basis.
export const createChinaAcquisition = async ({
  product_id, quantity, unit_cost_rmb, vendor_id, payment_method_id,
  acquirer_id, date_purchased, notes, carrier, tracking_number,
}) => {
  const locId = await fetchChinaWarehouseLocation()
  const qty = parseInt(quantity, 10)
  const costRmb = parseFloat(unit_cost_rmb) || 0
  const totalCostRmb = costRmb * qty
  const totalCostUsd = convertToUSD(totalCostRmb, 'RMB')
  const unitCostUsd = qty > 0 ? totalCostUsd / qty : 0

  const acqRow = {
    date_purchased: date_purchased || new Date().toLocaleDateString('en-CA'),
    acquirer_id: acquirer_id || null,
    source_country: 'China',  // region enum accepts 'China', not 'CN'
    vendor_id: vendor_id || null,
    payment_method_id: payment_method_id || null,
    product_id,
    quantity_purchased: qty,
    quantity_received: qty,                  // instant-receive
    cost: totalCostRmb,
    currency: 'RMB',
    cost_usd: totalCostUsd,
    status: 'Received',                       // instant-receive
    origin: 'cn_vendor',
    notes: notes || null,
    // Optional shipment info (online CN buys shipped to China Warehouse).
    // Rows with a tracking_number are picked up by the daily AfterShip cron
    // (api/aftership-sync.js) for arrival alerts — stock semantics unchanged.
    carrier: carrier?.trim() || null,
    tracking_number: tracking_number?.trim() || null,
  }

  const { data: acq, error: acqErr } = await supabase
    .from('acquisitions')
    .insert(acqRow)
    .select()
    .single()
  if (acqErr) throw acqErr

  await updateInventory(product_id, locId, qty, unitCostUsd)
  return acq
}

// Current China Warehouse stock for one product (0 if no row). Guards undo/edit
// so we never drive inventory negative by reversing a buy whose units were
// already sold/shipped.
const fetchChinaProductStock = async (productId) => {
  const locId = await fetchChinaWarehouseLocation()
  const { data } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('product_id', productId)
    .eq('location_id', locId)
    .maybeSingle()
  return data?.quantity || 0
}

// Undo (撤销) a China acquisition — removes the instant-received qty and
// soft-deletes the row. Guarded like the Japan version.
export const undoChinaAcquisition = async (acqId, { deletedById = null, reason = null } = {}) => {
  const { data: acq, error: getErr } = await supabase
    .from('acquisitions')
    .select('id, product_id, quantity_purchased, origin, deleted')
    .eq('id', acqId)
    .maybeSingle()
  if (getErr) throw getErr
  if (!acq) throw new Error('Acquisition not found')
  if (acq.origin !== 'cn_vendor') throw new Error('Not a China acquisition')
  if (acq.deleted) throw new Error('This acquisition was already undone')

  const qty = acq.quantity_purchased || 0
  const stock = await fetchChinaProductStock(acq.product_id)
  if (qty > stock) {
    throw new Error(`Only ${stock} in China stock now, but this buy was ${qty} — some was already sold/shipped. Undo the sale/shipment first, or fix the count in 中国库存.`)
  }

  const locId = await fetchChinaWarehouseLocation()
  await updateInventory(acq.product_id, locId, -qty)  // remove (avg unchanged)
  const { error: delErr } = await supabase
    .from('acquisitions')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
      deleted_reason: reason || 'China acquisition undone from China acquisitions page',
    })
    .eq('id', acqId)
  if (delErr) throw delErr
  return acq
}

// Edit (修改) a China acquisition — reconciles China Warehouse stock for any
// product/qty/unit-cost change, then rewrites the row. Mirrors the Japan
// version's reverse-old + re-apply-new inventory math and stock guard.
export const updateChinaAcquisition = async (acqId, {
  product_id, quantity, unit_cost_rmb, vendor_id, payment_method_id,
  date_purchased, notes,
}) => {
  const { data: old, error: getErr } = await supabase
    .from('acquisitions')
    .select('id, product_id, quantity_purchased, cost, origin, deleted, date_purchased')
    .eq('id', acqId)
    .maybeSingle()
  if (getErr) throw getErr
  if (!old) throw new Error('Acquisition not found')
  if (old.origin !== 'cn_vendor') throw new Error('Not a China acquisition')
  if (old.deleted) throw new Error('This acquisition was undone')

  if (!product_id) throw new Error('Product is required')
  const newQty = parseInt(quantity, 10)
  if (!Number.isFinite(newQty) || newQty <= 0) throw new Error('Quantity must be at least 1')

  const locId = await fetchChinaWarehouseLocation()
  const oldQty = old.quantity_purchased || 0
  const oldProduct = old.product_id
  const oldUnitRmb = oldQty > 0 ? (Number(old.cost) || 0) / oldQty : 0
  const newUnitRmb = parseFloat(unit_cost_rmb) || 0

  const productChanged = product_id !== oldProduct
  const qtyChanged = newQty !== oldQty
  const costChanged = Math.abs(newUnitRmb - oldUnitRmb) > 0.5
  const invChanged = productChanged || qtyChanged || costChanged

  if (invChanged) {
    const oldStock = await fetchChinaProductStock(oldProduct)
    if (oldQty > oldStock) {
      throw new Error(`Only ${oldStock} of the original product in stock now, but this buy was ${oldQty} — some was already sold/shipped. Fix the sale/shipment first, or adjust in 中国库存.`)
    }
    const newTotalUsd = convertToUSD(newUnitRmb * newQty, 'RMB')
    const newUnitUsd = newQty > 0 ? newTotalUsd / newQty : 0
    await updateInventory(oldProduct, locId, -oldQty)             // reverse old (avg unchanged)
    await updateInventory(product_id, locId, newQty, newUnitUsd)  // re-apply new (weighted avg)
  }

  const totalCostRmb = newUnitRmb * newQty
  const totalCostUsd = convertToUSD(totalCostRmb, 'RMB')
  const { data: updated, error: upErr } = await supabase
    .from('acquisitions')
    .update({
      product_id,
      quantity_purchased: newQty,
      quantity_received: newQty,   // instant-receive stays in sync
      cost: totalCostRmb,
      cost_usd: totalCostUsd,
      currency: 'RMB',
      vendor_id: vendor_id || null,
      payment_method_id: payment_method_id || null,
      date_purchased: date_purchased || old.date_purchased,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', acqId)
    .select()
    .single()
  if (upErr) throw upErr
  return updated
}

// ============================================================================
// FX transfers (fx_transfers) — CNY/USD cross-border ledger (shared w/ lv-finance).
// ============================================================================
// lv-finance auto-inserts the USD leg from US bank feeds; the China team
// backfills the RMB leg via the app. Rate = CNY per USD = cny_amount /
// usd_amount. A row needs at least one of the two amounts. Backed by
// sql/cn_jp_finance.sql (china_recon.py reads these exact columns).
// ============================================================================

const fxRate = (cny, usd) =>
  (cny != null && usd != null && Number(usd) !== 0) ? Number(cny) / Number(usd) : null

// Newest first. `pendingBackfill: true` → auto-inserted USD rows still missing
// the RMB leg (cny_amount IS NULL) — the China team's primary work queue.
export const fetchFxTransfers = async ({ limit = 50, pendingBackfill = false } = {}) => {
  let q = supabase
    .from('fx_transfers')
    .select('*, created_by:users!fx_transfers_created_by_id_fkey(id, name)')
    .or('deleted.is.null,deleted.eq.false')
  if (pendingBackfill) q = q.is('cny_amount', null)
  const { data, error } = await q
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Backfill the RMB leg on an auto-inserted USD row: set cny_amount + the derived
// rate (CNY per USD) from the row's existing usd_amount.
export const backfillFxTransfer = async (id, { cny_amount } = {}) => {
  const cny = parseFloat(cny_amount)
  if (!Number.isFinite(cny) || cny <= 0) throw new Error('Enter the RMB amount received')
  const { data: row, error: getErr } = await supabase
    .from('fx_transfers')
    .select('id, usd_amount')
    .eq('id', id)
    .maybeSingle()
  if (getErr) throw getErr
  if (!row) throw new Error('Transfer not found')
  const usd = row.usd_amount != null ? Number(row.usd_amount) : null
  // .is('cny_amount', null) makes a stale tab / double submit a no-op instead of
  // silently overwriting an already-backfilled RMB leg (Codex review 2026-07-05)
  const { data, error } = await supabase
    .from('fx_transfers')
    .update({ cny_amount: cny, rate: fxRate(cny, usd) })
    .eq('id', id)
    .is('cny_amount', null)
    .select()
  if (error) throw error
  if (!data || data.length === 0) throw new Error('该笔已被回填过(可能在别的页签)— 刷新列表确认')
  return data[0]
}

// Manual full-row insert for transfers the automation missed. At least one of
// usd_amount / cny_amount is required; rate is auto-computed when both present.
export const createFxTransfer = async ({
  date, usd_amount, cny_amount, counterparty, bank_txn_ref, purpose, note, created_by_id,
}) => {
  const usd = usd_amount === '' || usd_amount == null ? null : parseFloat(usd_amount)
  const cny = cny_amount === '' || cny_amount == null ? null : parseFloat(cny_amount)
  if (usd == null && cny == null) throw new Error('Enter at least a USD or a CNY amount')
  const row = {
    date: date || new Date().toLocaleDateString('en-CA'),
    usd_amount: usd,
    cny_amount: cny,
    rate: fxRate(cny, usd),
    counterparty: counterparty || null,
    bank_txn_ref: bank_txn_ref || null,
    purpose: purpose || null,
    note: note || null,
    created_by_id: created_by_id || null,
  }
  const { data, error } = await supabase
    .from('fx_transfers')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export const undoFxTransfer = async (id, { deletedById = null, reason = null } = {}) => {
  const { data, error } = await supabase
    .from('fx_transfers')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
      deleted_reason: reason || 'FX transfer voided',
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
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

// Guard shared by the edit + undo flows: a Japan→US shipment can only be
// touched from the Japan side while it's still purely pending — status
// 'Purchased' AND nothing received yet on the US side. Once the US team
// starts receiving (Partially / Received, or quantity_received > 0) the row
// is co-owned with US Master inventory and editing/canceling here would
// desync the two. Throws a user-facing message in that case.
const assertShipmentEditable = (ship) => {
  if (!ship) throw new Error('Shipment not found')
  if (ship.origin !== 'jp_to_us_shipment') throw new Error('Not a Japan→US shipment')
  if (ship.deleted) throw new Error('This shipment was already canceled')
  if (ship.status !== 'Purchased' || (ship.quantity_received || 0) > 0) {
    throw new Error('Already arriving in the US — edit/cancel must be handled by the US team (Intake to Master)')
  }
}

// Cancel (撤销) a still-pending Japan→US shipment. Refunds Japan Warehouse
// inventory, then soft-deletes the acquisition row (so it also drops out of
// the US Intake to Master pending list). Inventory is refunded FIRST so a
// mid-flow crash leaves the row visible-but-refunded (recoverable), matching
// the undoJapanStreamSale ordering convention.
export const undoJapanToUSShipment = async (shipmentId, { deletedById = null, reason = null } = {}) => {
  const { data: ship, error: getErr } = await supabase
    .from('acquisitions')
    .select('id, product_id, quantity_purchased, quantity_received, status, origin, deleted, carrier, tracking_number, date_purchased')
    .eq('id', shipmentId)
    .maybeSingle()
  if (getErr) throw getErr
  assertShipmentEditable(ship)

  const locId = await fetchJapanWarehouseLocation()
  await updateInventory(ship.product_id, locId, ship.quantity_purchased)  // refund
  const { error: delErr } = await supabase
    .from('acquisitions')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_id: deletedById || null,
      deleted_reason: reason || 'Japan→US shipment canceled from Japan shipments page',
    })
    .eq('id', shipmentId)
  if (delErr) throw delErr
  return ship
}

// Edit (修改) a still-pending Japan→US shipment. Re-points Japan Warehouse
// stock to reflect the corrected (product, qty) before updating the row:
//   - same product, qty changed → adjust the delta (refund or take more,
//     with a stock check when taking more)
//   - product changed → refund the old product fully, take the new one out
//     (stock-checked)
// Metadata-only edits (carrier / tracking / cost / date / notes) skip the
// inventory math. Returns the updated row.
export const updateJapanToUSShipment = async (shipmentId, {
  product_id, quantity, unit_cost_jpy, source_acquisition_id,
  carrier, tracking_number, shipped_date, notes,
}) => {
  const { data: old, error: getErr } = await supabase
    .from('acquisitions')
    .select('id, product_id, quantity_purchased, quantity_received, status, origin, deleted, date_purchased')
    .eq('id', shipmentId)
    .maybeSingle()
  if (getErr) throw getErr
  assertShipmentEditable(old)

  if (!product_id) throw new Error('Product is required')
  const newQty = parseInt(quantity, 10)
  if (!Number.isFinite(newQty) || newQty <= 0) throw new Error('Quantity must be at least 1')

  const locId = await fetchJapanWarehouseLocation()
  const oldQty = old.quantity_purchased || 0
  const oldProduct = old.product_id

  const availFor = async (pid) => {
    const { data } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('product_id', pid)
      .eq('location_id', locId)
      .maybeSingle()
    return data?.quantity || 0
  }

  if (product_id === oldProduct) {
    const diff = newQty - oldQty  // >0 take more out of Japan, <0 refund
    if (diff > 0) {
      const avail = await availFor(product_id)
      if (diff > avail) throw new Error(`Not enough Japan stock — need ${diff} more, only ${avail} available`)
    }
    if (diff !== 0) await updateInventory(product_id, locId, -diff)
  } else {
    const availNew = await availFor(product_id)
    if (newQty > availNew) throw new Error(`Not enough Japan stock for the new product — need ${newQty}, only ${availNew} available`)
    await updateInventory(oldProduct, locId, oldQty)   // refund old fully
    await updateInventory(product_id, locId, -newQty)  // take new out
  }

  const costJpy = parseFloat(unit_cost_jpy) || 0
  const totalCostJpy = costJpy * newQty
  const totalCostUsd = convertToUSD(totalCostJpy, 'JPY')

  const { data: updated, error: upErr } = await supabase
    .from('acquisitions')
    .update({
      product_id,
      quantity_purchased: newQty,
      cost: totalCostJpy,
      cost_usd: totalCostUsd,
      currency: 'JPY',
      source_acquisition_id: source_acquisition_id || null,
      carrier: carrier || null,
      tracking_number: tracking_number?.trim() || null,
      date_purchased: shipped_date || old.date_purchased,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shipmentId)
    .select()
    .single()
  if (upErr) throw upErr
  return updated
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

// ============================================================================
// WEEKLY USAGE — units that left inventory to customers, by channel
// ============================================================================
// "Usage" = goods sold to customers (real outflows), NOT internal moves.
// Source of truth per channel (chosen after auditing the live tables):
//   门店 storefront → storefront_sales.quantity
//   直播 livestream → stream_counts.total_sold (the post-stream count — this
//                     is where live sales actually live; platform_sales is a
//                     newer scan-cart that's barely used, excluded on purpose)
//   线上 online     → online_order_items.quantity for orders in the window
//   日本 Japan      → japan_stream_sales.quantity (separate warehouse, both
//                     stream + local channels; reported separately)
// Deliberately EXCLUDED (internal flows, would double-count): movements
// (transfers), box_breaks (a box becomes packs — counted when those sell),
// jp_to_us_shipment (warehouse-to-warehouse transfer), platform_sales (legacy).
//
// `start` / `end` are inclusive 'YYYY-MM-DD' calendar dates. Returns channel
// totals + a US subtotal + a PER-PRODUCT breakdown (which goods, sold from
// which channel). Only 货物 (sealed boxes/packs) — singles & slabs live in
// their own tables and never reach these sources, so they're excluded by
// construction (the `products` table is sealed-only).
//
// Stream per-product sold = expected_qty − actual_qty per stream_count_item
// (difference = actual − expected, so sold rows have difference < 0). Filtering
// to difference < 0 also keeps the row count tiny. Weekly volumes are small so
// a single fetch per source is enough.
export const fetchWeeklyUsage = async (start, end) => {
  // Day after `end`, for the timestamp upper-bound on stream_counts.count_time
  // (the only source on a timestamptz column rather than a plain date).
  const endNextDate = new Date(`${end}T00:00:00`)
  endNextDate.setDate(endNextDate.getDate() + 1)
  const endNext = endNextDate.toISOString().slice(0, 10)
  const PROD = 'product:products(name,short_code,language,category)'

  const [sfRes, scRes, ooRes, jpRes] = await Promise.all([
    supabase.from('storefront_sales')
      .select(`quantity, product_id, ${PROD}`)
      .eq('deleted', false)
      .gte('date', start).lte('date', end),
    supabase.from('stream_counts')
      .select('id, total_sold, location_id, location:locations(name)')
      .eq('deleted', false)
      .gte('count_time', start).lt('count_time', endNext),
    supabase.from('online_orders')
      .select('id')
      .eq('deleted', false)
      .gte('date', start).lte('date', end),
    supabase.from('japan_stream_sales')
      .select(`quantity, channel, product_id, ${PROD}`)
      .eq('deleted', false)
      .gte('sale_date', start).lte('sale_date', end),
  ])
  for (const r of [sfRes, scRes, ooRes, jpRes]) if (r.error) throw r.error

  // Stream line items (sold rows only) for the sessions in window.
  const scIds = (scRes.data || []).map(s => s.id)
  let sciData = []
  if (scIds.length) {
    const { data, error } = await supabase
      .from('stream_count_items')
      .select(`stream_count_id, expected_qty, actual_qty, product_id, ${PROD}`)
      .in('stream_count_id', scIds)
      .lt('difference', 0)        // difference = actual − expected; <0 means sold
      .limit(5000)
    if (error) throw error
    sciData = data || []
  }

  // Online line items for the orders in window.
  const orderIds = (ooRes.data || []).map(o => o.id)
  let ooiData = []
  if (orderIds.length) {
    const { data, error } = await supabase
      .from('online_order_items')
      .select(`quantity, product_id, ${PROD}`)
      .in('order_id', orderIds)
      .limit(5000)
    if (error) throw error
    ooiData = data || []
  }

  // ---- Merge into a per-product map (US channels) ----
  const usMap = new Map()
  const touch = (pid, prod) => {
    if (!usMap.has(pid)) {
      usMap.set(pid, {
        product_id: pid,
        name: prod?.name || '(unknown)',
        short_code: prod?.short_code || null,
        language: prod?.language || null,
        category: prod?.category || null,
        storefront: 0, stream: 0, online: 0, total: 0,
      })
    }
    return usMap.get(pid)
  }
  for (const r of sfRes.data || []) {
    const row = touch(r.product_id, r.product); const q = Number(r.quantity) || 0
    row.storefront += q; row.total += q
  }

  // ---- Per stream-room breakdown (直播间) ----
  // Map each stream_count session to its room, count sessions per room, then
  // attribute each sold line item to that room (units + per-product list).
  const scMap = new Map()
  const roomMap = new Map()
  const touchRoom = (locId, name) => {
    const key = locId || name || 'unknown'
    if (!roomMap.has(key)) {
      roomMap.set(key, { location_id: locId || null, name: name || '(no room)', units: 0, sessions: 0, productMap: new Map() })
    }
    return roomMap.get(key)
  }
  for (const s of scRes.data || []) {
    const name = s.location?.name || '(no room)'
    scMap.set(s.id, { location_id: s.location_id, name })
    touchRoom(s.location_id, name).sessions += 1
  }

  for (const r of sciData) {
    const sold = (Number(r.expected_qty) || 0) - (Number(r.actual_qty) || 0)
    if (sold <= 0) continue
    const row = touch(r.product_id, r.product)
    row.stream += sold; row.total += sold
    // attribute to the room this session belonged to
    const sc = scMap.get(r.stream_count_id)
    if (sc) {
      const room = touchRoom(sc.location_id, sc.name)
      room.units += sold
      const pm = room.productMap
      if (!pm.has(r.product_id)) {
        pm.set(r.product_id, {
          product_id: r.product_id,
          name: r.product?.name || '(unknown)',
          short_code: r.product?.short_code || null,
          language: r.product?.language || null,
          category: r.product?.category || null,
          units: 0,
        })
      }
      pm.get(r.product_id).units += sold
    }
  }
  const rooms = [...roomMap.values()]
    .map(rm => ({
      location_id: rm.location_id,
      name: rm.name,
      units: rm.units,
      sessions: rm.sessions,
      products: [...rm.productMap.values()].sort((a, b) => b.units - a.units),
    }))
    .sort((a, b) => b.units - a.units)
  for (const r of ooiData) {
    const row = touch(r.product_id, r.product); const q = Number(r.quantity) || 0
    row.online += q; row.total += q
  }
  const products = [...usMap.values()].sort((a, b) => b.total - a.total)

  // ---- Japan per-product (separate warehouse) ----
  const jpMap = new Map()
  for (const r of jpRes.data || []) {
    const pid = r.product_id
    if (!jpMap.has(pid)) {
      jpMap.set(pid, {
        product_id: pid,
        name: r.product?.name || '(unknown)',
        short_code: r.product?.short_code || null,
        language: r.product?.language || null,
        category: r.product?.category || null,
        stream: 0, local: 0, total: 0,
      })
    }
    const row = jpMap.get(pid); const q = Number(r.quantity) || 0
    if (r.channel === 'local') row.local += q; else row.stream += q
    row.total += q
  }
  const japanProducts = [...jpMap.values()].sort((a, b) => b.total - a.total)

  const storefrontUnits = products.reduce((s, p) => s + p.storefront, 0)
  const streamUnits = products.reduce((s, p) => s + p.stream, 0)
  const onlineUnits = products.reduce((s, p) => s + p.online, 0)
  const japanUnits = japanProducts.reduce((s, p) => s + p.total, 0)

  return {
    start, end,
    storefront: { units: storefrontUnits, txns: (sfRes.data || []).length },
    stream:     { units: streamUnits, sessions: (scRes.data || []).length, rooms },
    online:     { units: onlineUnits, orders: orderIds.length, lines: ooiData.length },
    usSubtotal: storefrontUnits + streamUnits + onlineUnits,
    products,
    japan: {
      units: japanUnits,
      stream: japanProducts.reduce((s, p) => s + p.stream, 0),
      local: japanProducts.reduce((s, p) => s + p.local, 0),
      sales: (jpRes.data || []).length,
      products: japanProducts,
    },
  }
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

// ====================== Returns ======================
// Scan a returned/cancelled item back into Master Inventory + log it. Policy
// (boss 2026-06-25): the ORIGINAL sale record is NOT touched — we just put the
// goods back and keep a returns-log row. The one unavoidable exception is
// slabs: a slab is a unique item whose sold row is its only copy, so returning
// one flips that row back to in_inventory (there's nothing else to restore).

export const getMasterLocationId = async () => {
  const { data, error } = await supabase
    .from('locations').select('id').eq('name', MASTER_NAME).maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error(`Location "${MASTER_NAME}" not found`)
  return data.id
}

// Most recent SOLD single row for a tcg_id — copies identity + shows the
// original sale on the return log. Null when none.
const latestSoldSingle = async (tcgId) => {
  const { data } = await supabase
    .from('singles')
    .select('card_name, card_number, set_id, brand, language, variant, form, condition, grading_company, grade, cert_number, current_market_price_usd, sale_channel, sale_date, sale_price_usd')
    .eq('tcg_id', tcgId).eq('status', 'sold').eq('deleted', false)
    .order('sale_date', { ascending: false, nullsFirst: false })
    .limit(1)
  return data?.[0] || null
}

// True when a card_name is the synthetic "(unknown — TCG …)" placeholder that
// physical-count re-adds / returns mint when they can't find a real identity.
const isPlaceholderName = (n) => !n || /^\(unknown/i.test(n.trim())

// Best REAL identity for a tcg_id across ALL rows — including soft-deleted ones.
// The original card often lives in a deleted row (it was sold/moved, the row
// soft-deleted), so resolvers that filter `deleted=false` miss it and fall back
// to "(unknown — TCG x)". Prefer a row with a real card_name (newest wins); only
// return null when no row for the tcg_id exists at all.
export const fetchBestSingleIdentity = async (tcgId) => {
  if (!tcgId) return null
  const { data } = await supabase
    .from('singles')
    .select('card_name, card_number, set_id, brand, language, variant, form, condition, grading_company, grade, cert_number, current_market_price_usd, date_acquired')
    .eq('tcg_id', tcgId)
  if (!data?.length) return null
  const real = data.filter(r => !isPlaceholderName(r.card_name))
  const pool = real.length ? real : data
  pool.sort((a, b) => String(b.date_acquired || '').localeCompare(String(a.date_acquired || '')))
  return pool[0] || null
}

// Insert a returns-log row. The log is SECONDARY to putting goods back, so
// this NEVER throws — the inventory action has already happened by the time
// we get here, and we must not turn a successful return into a hard error.
// Returns { logged:false } (with a hint when the table simply isn't migrated)
// so the page can surface a banner instead.
const insertReturnLog = async (row) => {
  try {
    const { error } = await supabase.from('returns').insert(row)
    if (error) {
      const missing = /returns.*does not exist|could not find the table|schema cache/i.test(error.message || '')
      return { logged: false, note: missing
        ? 'returns table not migrated — run scripts/add_returns_table.sql'
        : `return log failed: ${error.message}` }
    }
    return { logged: true }
  } catch (e) {
    return { logged: false, note: `return log failed: ${e.message}` }
  }
}

export const processReturn = async ({ code, found: providedFound = null, reason = 'return', notes = null, returnedById = null, sourceStreamRoom = null, destinationLocationId = null, destinationName = null, quantity = 1 } = {}) => {
  // `found` can be passed directly (from the manual name-search, whose result
  // rows are already {kind, single|slab|product} shaped) — else resolve a code.
  const found = providedFound || await lookupScannedCode(code)
  if (!found || found.kind === 'empty') throw new Error('Nothing scanned')
  if (found.kind === 'unknown') throw new Error(`"${found.code}" isn't a known sealed UPC, slab cert#, or single TCG ID`)
  // Destination defaults to Master Inventory, but can be any physical location
  // (e.g. a stream room) so cancelled stream sales go back where they belong.
  const destId = destinationLocationId || await getMasterLocationId()
  const destName = destinationName || 'Master Inventory'
  const today = new Date().toLocaleDateString('en-CA')
  const qty = Math.max(1, Math.floor(Number(quantity) || 1))   // sealed/single can return >1; slab is always 1
  const base = { reason, source_stream_room: sourceStreamRoom || null, notes, returned_to_location_id: destId, returned_by_id: returnedById, quantity: qty }

  // ---- sealed: +1 back to Master inventory, sale untouched ----
  if (found.kind === 'sealed') {
    const p = found.product
    await updateInventory(p.id, destId, qty)
    const name = [p.brand, p.name].filter(Boolean).join(' ')
    const log = await insertReturnLog({ ...base, kind: 'sealed', item_ref: p.id, item_name: name })
    return { kind: 'sealed', name, action: `+${qty} → ${destName}`, logged: log.logged, note: log.note }
  }

  // ---- single: add back to Master (increment or insert), sale untouched ----
  if (found.kind === 'single') {
    const s = found.single
    const sold = await latestSoldSingle(s.tcg_id)
    // Identity template: prefer a REAL name found anywhere (incl. soft-deleted
    // rows) over the scanned/sold row, which may itself be an "(unknown)"
    // placeholder. Falls back to the sold row, then the scanned row.
    const best = await fetchBestSingleIdentity(s.tcg_id)
    const tpl = best || sold || s
    const name = [tpl.card_name, tpl.card_number].filter(Boolean).join(' ') || `(unknown — TCG ${s.tcg_id})`
    // singles has a PARTIAL unique index on tcg_id (WHERE deleted=false AND
    // status<>'sold') → at most ONE non-sold row per tcg_id across ALL
    // locations. So if a live (in_inventory/listed) row exists ANYWHERE, bump
    // it and bring it home to Master; only INSERT when the tcg_id has no live
    // row at all. (Inserting blindly 409s when a live row exists elsewhere —
    // e.g. the in-stock half of a partial sale at a stream room.)
    const { data: liveRows } = await supabase
      .from('singles').select('id, quantity')
      .eq('tcg_id', s.tcg_id).eq('deleted', false).neq('status', 'sold').limit(1)
    const live = liveRows?.[0] || null
    if (live) {
      const { error } = await supabase.from('singles')
        .update({ quantity: (live.quantity || 0) + qty, location_id: destId, status: 'in_inventory' })
        .eq('id', live.id)
      if (error) throw error
    } else {
      let setId = tpl.set_id ?? null
      if (!setId) {
        const { data: fb } = await supabase.from('card_sets').select('id')
          .eq('name', 'Unknown Set (sheet import)').maybeSingle()
        setId = fb?.id ?? null
      }
      const { error } = await supabase.from('singles').insert({
        card_name: tpl.card_name || `(unknown — TCG ${s.tcg_id})`,
        card_number: tpl.card_number || '',
        set_id: setId, brand: tpl.brand || 'Pokemon', language: tpl.language || 'EN',
        variant: tpl.variant ?? null, form: tpl.form || 'raw', condition: tpl.condition || 'NM',
        grading_company: tpl.grading_company ?? null, grade: tpl.grade ?? null,
        cert_number: tpl.cert_number ?? null, tcg_id: s.tcg_id,
        current_market_price_usd: tpl.current_market_price_usd ?? null,
        quantity: qty, status: 'in_inventory', location_id: destId, source_type: 'other',
        date_acquired: today, deleted: false,
        notes: `Returned via Returns ${today} → ${destName} (original sale kept)`,
      })
      if (error) throw error
    }
    const log = await insertReturnLog({ ...base, kind: 'single', item_ref: s.tcg_id, item_name: name,
      original_sale_channel: sold?.sale_channel || null, original_sale_date: sold?.sale_date || null,
      original_sale_price_usd: sold?.sale_price_usd ?? null })
    return { kind: 'single', name, action: `added ${qty > 1 ? qty + ' ' : ''}→ ${destName}`, logged: log.logged, note: log.note,
      original: sold ? { channel: sold.sale_channel, date: sold.sale_date, price: sold.sale_price_usd } : null }
  }

  // ---- slab: unique item → flip its (sold) row back to in_inventory @ Master ----
  if (found.kind === 'slab') {
    const sl = found.slab
    const wasSold = sl.status === 'sold'
    const { error } = await supabase.from('slabs').update({
      status: 'in_inventory', location_id: destId,
      sale_price_usd: null, sale_channel: null, sale_date: null, sale_fees_usd: null,
      sold_at: null, sold_by_id: null, buyer_name: null,
    }).eq('id', sl.id)
    if (error) throw error
    const log = await insertReturnLog({ ...base, quantity: 1, kind: 'slab', item_ref: sl.cert_number, item_name: sl.item_name,
      original_sale_channel: sl.sale_channel || null, original_sale_date: sl.sale_date || null,
      original_sale_price_usd: sl.sale_price_usd ?? null })
    return { kind: 'slab', name: sl.item_name, logged: log.logged, note: log.note,
      action: wasSold ? `un-sold → ${destName} (slab is a unique item)` : `moved → ${destName}`,
      // Slab sold-status + location are sheet-owned; the DB flip doesn't clear
      // the sheet's strikethrough, so flag it for a quick manual fix.
      warn: wasSold ? 'Sheet still shows this slab SOLD — un-strike its row + clear Status + set its Location, or the hourly audit will flag it.' : null,
      original: wasSold ? { channel: sl.sale_channel, date: sl.sale_date, price: sl.sale_price_usd } : null }
  }
}

// Recent returns for the Returns page log.
export const fetchRecentReturns = async (limit = 50) => {
  const { data, error } = await supabase
    .from('returns')
    .select('*, returned_by:users(name), location:locations(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (/returns.*does not exist|could not find the table|schema cache/i.test(error.message || '')) return []
    throw error
  }
  return data || []
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

// Report an in-app slab move to the slabs sheet so the hourly sheet→app
// location sync (sheet is the base for slab locations, boss directive
// 2026-06-11) doesn't undo it an hour later.
//
// ⚠️ Consequence of a failed write-back: the next hourly sync moves the
// slab BACK to wherever the sheet still says, and once that happens the
// two sides agree again — the lost move leaves no audit trace except
// this console line and the slabs_audit_log 'sheet-sync' row. Callers
// that can show a toast should await the returned outcome and tell the
// user to fix the sheet cell by hand when it isn't 'updated'.
export const reportSlabLocationToSheet = (certNumber, locationName) => {
  if (!certNumber || !locationName) return Promise.resolve({ outcome: 'skipped' })
  return fetch('/api/sheet-update-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cert_number: certNumber, location_name: locationName }),
  })
    .then(r => r.json())
    .then(d => {
      if (d?.outcome === 'updated') console.log('[sheet-location]', certNumber, '→', locationName, ': updated')
      else console.warn('[sheet-location] write-back NOT applied', certNumber, '→', locationName, ':', d?.outcome, '— fix the sheet Location cell or the hourly sync will undo this move')
      return d
    })
    .catch(e => {
      console.warn('[sheet-location] write-back failed', certNumber, e)
      return { outcome: 'network_error' }
    })
}

// Move a slab. Always qty=1 so it's just a location_id flip + audit row.
export const moveSlabToLocation = async ({
  slabId,
  toLocationId,
  actorId,
}) => {
  const { data: source, error: fetchErr } = await supabase
    .from('slabs')
    .select('id, item_name, cert_number, status, location_id, deleted, sheet_bin')
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
  // Remember the current shelf bin (digit-prefixed like "2V-01") the
  // moment we move — so a card leaving for a show is captured even if no
  // hourly sync ran while it sat in the bin. Restored on the return move.
  const patch = { location_id: toLocationId }
  if (/^\d/.test(String(source.sheet_bin || '').trim())) patch.last_slab_bin = source.sheet_bin
  const runUpdate = (body) => supabase
    .from('slabs').update(body).eq('id', slabId)
    .select('*, location:locations(id, name)').single()
  let { data: updated, error: updErr } = await runUpdate(patch)
  // last_slab_bin column not migrated yet → retry the move without it so
  // the move never breaks (bin memory just doesn't kick in until the SQL runs).
  if (updErr && /last_slab_bin/.test(updErr.message || '')) {
    ;({ data: updated, error: updErr } = await runUpdate({ location_id: toLocationId }))
  }
  if (updErr) throw updErr
  logSlabEvent({
    slab_id: slabId,
    event_type: 'moved',
    summary: `Moved slab "${source.item_name}" cert #${source.cert_number}`,
    payload: { from_location_id: source.location_id, to_location_id: toLocationId },
    acted_by_id: actorId,
  })
  // Push the new room into the sheet's Location cell — without this the
  // hourly sheet→app location sync would move the slab back.
  reportSlabLocationToSheet(source.cert_number, updated?.location?.name)
  return updated
}

// Fetch singles + slabs currently at a given location — used by Move
// Inventory to populate the manual-search "what's in this room" view.
// Mirrors the constraints used by the storefront search (sellable rows
// only: in_inventory / listed, qty > 0 for singles).
// PostgREST caps a single response at ~1000 rows (Supabase default). A
// location like Front Store can hold more singles than that (1100+), so a
// single SELECT silently truncates — and since we order by card_name, the
// tail of the alphabet (e.g. "Venusaur") just vanishes. That made Move
// Inventory wrongly report "X is not at the source location" for any card
// past row 1000. Page through with .range() until a short page comes back
// so we always get the FULL stock at a location.
const PAGE = 1000
async function _fetchAllPages(buildQuery) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw error
    const batch = data || []
    out.push(...batch)
    if (batch.length < PAGE) break
  }
  return out
}

export const fetchSinglesAtLocation = async (locationId) => {
  if (!locationId) return []
  return _fetchAllPages(() => supabase
    .from('singles')
    .select(`
      id, card_name, card_number, condition, quantity, tcg_id, status, form,
      set:card_sets(id, name)
    `)
    .eq('location_id', locationId)
    .eq('deleted', false)
    .in('status', ['in_inventory', 'listed'])
    .gt('quantity', 0)
    .order('card_name'))
}
export const fetchSlabsAtLocation = async (locationId) => {
  if (!locationId) return []
  return _fetchAllPages(() => supabase
    .from('slabs')
    .select('id, item_name, cert_number, grading_company, status, location_id')
    .eq('location_id', locationId)
    .eq('deleted', false)
    .in('status', ['in_inventory', 'listed'])
    .order('item_name'))
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
const _sellSingleLine = async ({ single, quantity, salePrice, paymentMethodId, cashierId, transactionId, saleDate, txMeta = {}, allowStockAdjust = false }) => {
  let sourceQty = single.quantity || 1
  const sellQty = Math.max(1, Number(quantity) || 1)

  if (sellQty > sourceQty) {
    if (!allowStockAdjust) {
      throw new Error(`Only ${sourceQty} available — cannot sell ${sellQty}`)
    }
    // Cashier confirmed over-scan at the register: they're holding more
    // physical copies than the app recorded (directive 2026-06-09 — the
    // physical copy wins). Correct the row's quantity UP first so the
    // normal sell math below stays whole; inventory ends at the right
    // remaining count and the sold clone carries the true sold qty.
    const { error: bumpErr } = await supabase
      .from('singles')
      .update({ quantity: sellQty })
      .eq('id', single.id)
    if (bumpErr) throw bumpErr
    console.log(`[sell-single] stock auto-corrected: ${single.tcg_id} qty ${sourceQty} → ${sellQty} (cashier-confirmed physical count)`)
    sourceQty = sellQty
  }
  const isFungibleRaw = single.form === 'raw' && sourceQty > 1

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

// SALE/TRADE counterpart of _buyManualLine — the "bulk" SKU (boss
// directive 2026-06-11): many singles sold as one stack with one price.
// Records the money in; the singles inventory table is NOT touched —
// bulk commons were never tracked per-card there, and scanning a 50-card
// stack at the counter is unrealistic.
const _sellManualLine = async ({
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
  const lineTotal = (Number(unitPrice) || 0) * qty
  const desc = (description || '').trim() || '(no description)'

  const sale = await createStorefrontSale({
    date: saleDate,
    sale_type: 'Itemized',
    product_id: null,
    location_id: locationIds.frontStore || null,
    quantity: qty,
    sale_price: lineTotal,
    cost_basis: null,    // untracked bulk — no per-card cost basis
    profit: null,
    payment_method_id: paymentMethodId || null,
    cashier_id: cashierId || null,
    transaction_id: transactionId,
    transaction_type: txMeta.transactionType || 'sale',
    trade_in_value_usd: txMeta.tradeInValue ?? null,
    net_cash_usd: txMeta.netCash ?? null,
    trade_in_notes: txMeta.tradeInNotes || null,
    notes: `SALE (manual): ${subKind} — ${desc}`,
  })

  return { sale, note: 'Recorded only — cards inventory NOT updated.' }
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

  // Compute gross + net cash up-front (independent of payments) so each line
  // write gets the same value AND the payment normalization below can tell an
  // EVEN trade (net = 0, no cash to record) apart from a genuinely-missing
  // payment. grossValue is the absolute total value of items in the cart,
  // regardless of direction (we receive or we pay).
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
  //   trade → net = gross − tradeIn (signed; negative if we pay, 0 if even)
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
  // "Amount paid by customer" = absolute(netCash) when money flows IN (sale,
  // or trade w/ positive net). For "we pay customer" flows the split UI is
  // disabled upstream, so we don't validate sums.
  const customerPaysIn =
    transactionType === 'sale' ||
    (transactionType === 'trade' && netCash > 0)

  // Normalize payments into [{ method_id, amount }] (1–2 rows) so the line
  // writers + ledger insert + Lark builder all use one shape. An EVEN trade
  // (net cash = 0) moves no money, so it legitimately records NO payment —
  // empty payments is allowed when netCash is 0 (and for we-pay flows that
  // pass no method). A missing payment when cash SHOULD move is still an error.
  let normalizedPayments
  if (Array.isArray(payments) && payments.length > 0) {
    normalizedPayments = payments
      .filter(p => p && p.payment_method_id)
      .map(p => ({
        payment_method_id: p.payment_method_id,
        amount: Number(p.amount) || 0,
      }))
      .filter(p => p.amount > 0)
    if (normalizedPayments.length === 0 && netCash !== 0) {
      throw new Error('No valid payment entries (each needs method + amount > 0)')
    }
    if (normalizedPayments.length > 2) {
      throw new Error('At most 2 payment methods per transaction')
    }
  } else if (paymentMethodId && netCash !== 0) {
    // Legacy single-method path — the one method covers the whole net cash.
    normalizedPayments = [{ payment_method_id: paymentMethodId, amount: Math.abs(netCash) }]
  } else {
    normalizedPayments = []   // no cash recorded (even trade, or we-pay flow w/ no method)
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
          // Cashier confirmed an over-scan in the cart (physical copies
          // beyond app stock) — lets the writer bump qty before selling.
          allowStockAdjust: !!line.stock_adjust,
        })
        ok.push({ line, result })
      } else if (line.kind === 'slab_manual' || line.kind === 'single_manual') {
        // Manual lines: cashier-typed description, NO inventory writes.
        // Buy → money out (customer selling us cards; staff intakes them
        // separately via Cards Scan). Sale/trade → money in (the "bulk"
        // SKU — many commons sold as one stack; never tracked per-card).
        const manualArgs = {
          subKind: line.kind === 'slab_manual' ? 'slab' : 'single',
          description: line.description || '',
          quantity: Number(line.quantity) || 1,
          unitPrice: line.price,
          paymentMethodId: rowPaymentMethodId, cashierId, transactionId,
          locationIds: { frontStore: frontStoreId },
          saleDate,
          txMeta,
        }
        const result = isBuy
          ? await _buyManualLine(manualArgs)
          : await _sellManualLine(manualArgs)
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

// Edit a logged storefront transaction. Used by the DailySummary's
// "Edit" button when the cashier picked the wrong payment method
// (Cash vs Zelle is the most common bug), got the total wrong, or
// needs to fix the trade-in value. Walks the same three tables that
// submitStorefrontTransaction wrote to (storefront_sales / singles /
// slabs) PLUS the split-ledger (storefront_payments) and rewrites the
// metadata fields for every row carrying this transaction_id.
//
// Patch fields (all optional):
//   payment_method_id  — flips the legacy single-method column on
//                        every row AND wipes+reinserts a single-row
//                        storefront_payments ledger (split-payment
//                        editing isn't supported yet — the modal only
//                        shows one method dropdown).
//   total              — new absolute cart total. Each line's
//                        sale_price is scaled proportionally so the
//                        sum equals the new total. net_cash_usd
//                        recomputes based on the transaction_type:
//                        sale = +total, buy = -total, trade = total
//                        - trade_in_value.
//   trade_in_value     — only meaningful for trade transactions.
//                        Updates trade_in_value_usd and recomputes
//                        net_cash_usd as gross − trade_in.
//   notes              — replaces the notes column on every row.
//
// Returns { transaction_id, affected_rows: N, new_net_cash }.
export const updateStorefrontTransaction = async (transactionId, patch = {}) => {
  if (!transactionId) throw new Error('transactionId required')

  // 1. Pull every row sharing this transaction_id from all three tables
  //    so we know the current gross + line prices + type. We need the
  //    cart-line breakdown to scale prices when total changes.
  const [ssRes, singlesRes, slabsRes] = await Promise.all([
    supabase.from('storefront_sales')
      .select('id, sale_price, quantity, transaction_type, trade_in_value_usd')
      .eq('transaction_id', transactionId),
    supabase.from('singles')
      .select('id, sale_price_usd, transaction_type, trade_in_value_usd')
      .eq('transaction_id', transactionId),
    supabase.from('slabs')
      .select('id, sale_price_usd, transaction_type, trade_in_value_usd')
      .eq('transaction_id', transactionId),
  ])
  if (ssRes.error) throw ssRes.error
  if (singlesRes.error) throw singlesRes.error
  if (slabsRes.error) throw slabsRes.error
  const ssRows = ssRes.data || []
  const singlesRows = singlesRes.data || []
  const slabsRows = slabsRes.data || []
  const totalRows = ssRows.length + singlesRows.length + slabsRows.length
  if (totalRows === 0) throw new Error('Transaction not found')

  // Read the type + trade-in off any row (they're all the same).
  const sampleRow = ssRows[0] || singlesRows[0] || slabsRows[0]
  const txType = sampleRow.transaction_type || 'sale'
  const currentTradeIn = Number(sampleRow.trade_in_value_usd ?? 0)

  // 2. Compute current gross (line totals sum). storefront_sales.sale_price
  //    is per-line subtotal; singles/slabs.sale_price_usd is per-unit but
  //    for those rows quantity is always 1.
  const currentGross =
    ssRows.reduce((s, r) => s + (Number(r.sale_price) || 0), 0) +
    singlesRows.reduce((s, r) => s + (Number(r.sale_price_usd) || 0), 0) +
    slabsRows.reduce((s, r) => s + (Number(r.sale_price_usd) || 0), 0)

  // 3. Decide new gross + scale factor. If `total` wasn't in the patch,
  //    leave prices alone.
  const newGross = patch.total != null ? Math.abs(Number(patch.total) || 0) : currentGross
  const scale = currentGross > 0 && newGross !== currentGross
    ? newGross / currentGross
    : 1

  // 4. Resolve new trade-in + net cash.
  const newTradeIn = patch.trade_in_value != null
    ? Number(patch.trade_in_value) || 0
    : currentTradeIn
  let newNetCash
  if (txType === 'buy') newNetCash = -newGross
  else if (txType === 'trade') newNetCash = newGross - newTradeIn
  else newNetCash = newGross

  // 5. Build common patch (applied to every row).
  const commonPatch = {}
  if ('payment_method_id' in patch) commonPatch.payment_method_id = patch.payment_method_id || null
  if ('notes' in patch) commonPatch.notes = patch.notes || null
  if (newNetCash !== sampleRow.net_cash_usd) commonPatch.net_cash_usd = newNetCash
  if (txType === 'trade' && newTradeIn !== currentTradeIn) {
    commonPatch.trade_in_value_usd = newTradeIn
  }

  // 6. Apply per-row updates. We scale prices PER ROW so each line's
  //    proportion of the cart is preserved. R2 to keep cents clean.
  const R2 = (n) => Math.round(n * 100) / 100
  let affected = 0

  if (ssRows.length > 0) {
    for (const r of ssRows) {
      const rowPatch = { ...commonPatch }
      if (scale !== 1) rowPatch.sale_price = R2((Number(r.sale_price) || 0) * scale)
      const { error } = await supabase
        .from('storefront_sales').update(rowPatch).eq('id', r.id)
      if (error) throw error
      affected++
    }
  }
  if (singlesRows.length > 0) {
    for (const r of singlesRows) {
      const rowPatch = { ...commonPatch }
      if (scale !== 1) rowPatch.sale_price_usd = R2((Number(r.sale_price_usd) || 0) * scale)
      const { error } = await supabase
        .from('singles').update(rowPatch).eq('id', r.id)
      if (error) throw error
      affected++
    }
  }
  if (slabsRows.length > 0) {
    for (const r of slabsRows) {
      const rowPatch = { ...commonPatch }
      if (scale !== 1) rowPatch.sale_price_usd = R2((Number(r.sale_price_usd) || 0) * scale)
      const { error } = await supabase
        .from('slabs').update(rowPatch).eq('id', r.id)
      if (error) throw error
      affected++
    }
  }

  // 7. Rewrite the storefront_payments ledger. The Edit modal only
  //    exposes a single payment method, so split-payment txns lose
  //    their split when edited — we warn the user before they save.
  //    Always delete-then-insert so we don't end up with stale rows.
  if ('payment_method_id' in patch || patch.total != null) {
    await supabase.from('storefront_payments').delete().eq('transaction_id', transactionId)
    const methodForLedger = ('payment_method_id' in patch)
      ? patch.payment_method_id
      : null
    if (methodForLedger) {
      const ledgerAmount = txType === 'sale' ? newGross
                       : txType === 'trade' ? Math.max(0, newNetCash)
                       : 0   // buy doesn't get a customer-paid ledger row
      if (ledgerAmount > 0) {
        const { error: payErr } = await supabase
          .from('storefront_payments')
          .insert([{
            transaction_id: transactionId,
            payment_method_id: methodForLedger,
            amount_usd: ledgerAmount,
          }])
        if (payErr) console.warn('[updateStorefrontTransaction] payments insert failed:', payErr.message)
      }
    }
  }

  return {
    transaction_id: transactionId,
    affected_rows: affected,
    new_net_cash: newNetCash,
    new_gross: newGross,
  }
}

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
export const fetchStorefrontDailySummary = async (from, to) => {
  // Accepts a single day (pass `from` only) or a range (`from`..`to`).
  // Back-compatible: existing single-arg callers get to === from.
  const fromStr = from || new Date().toLocaleDateString('en-CA')
  const toStr = to || fromStr

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
      .gte('date', fromStr).lte('date', toStr)
      .eq('deleted', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('singles')
      .select(`
        id, updated_at, transaction_id, transaction_type, net_cash_usd,
        payment_method_id, sale_price_usd, quantity, trade_in_value_usd,
        status, card_name, card_number, condition
      `)
      .gte('sale_date', fromStr).lte('sale_date', toStr)
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
      .gte('sale_date', fromStr).lte('sale_date', toStr)
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
      .gte('created_at', `${fromStr}T00:00:00`)
      .lt('created_at', `${toStr}T23:59:59.999`),
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
  let saleCount = 0, saleNetCash = 0, saleValue = 0
  let tradeCount = 0, tradeNetCash = 0, tradeValue = 0
  let buyCount = 0, buyNetCash = 0
  const byPayment = {}
  for (const t of transactions) {
    const cash = Number(t.net_cash || 0)
    const gross = Number(t.gross_value || 0)   // retail value of goods that left the store
    if (t.type === 'trade') {
      // Trade NET VALUE = goods moved out (gross, always ≥0). The signed
      // cash is tracked separately so a trade where we pay cash out isn't
      // read as a loss — value brought in − cash given out = this gross
      // (boss 2026-06-24).
      tradeCount++; tradeNetCash += cash; tradeValue += gross
    } else if (t.type === 'buy') {
      buyCount++; buyNetCash += cash
    } else {
      saleCount++; saleNetCash += cash; saleValue += gross
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
    date: fromStr === toStr ? fromStr : null,
    from: fromStr,
    to: toStr,
    range_label: fromStr === toStr ? fromStr : `${fromStr} → ${toStr}`,
    transactions,
    totals: {
      sale_count: saleCount,
      sale_net_cash: saleNetCash,
      sale_value: saleValue,
      trade_count: tradeCount,
      trade_net_cash: tradeNetCash,
      trade_value: tradeValue,
      buy_count: buyCount,
      buy_net_cash: buyNetCash,
      // total_value_sold = retail value of everything that left the store
      // (sales + trades), always ≥ 0. total_net_cash = signed cash flow.
      total_value_sold: saleValue + tradeValue,
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
          allowStockAdjust: !!line.stock_adjust,
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

  try {
    await updateInventory(product.id, streamRoomId, -quantity)
  } catch (invErr) {
    // Deduction failed after the sale row was written — remove the orphan
    // platform_sales row so we don't record a sale that never left stock.
    try { await supabase.from('platform_sales').delete().eq('id', inserted.id) } catch (rb) { console.error('[sell-sealed-platform] rollback failed:', rb) }
    throw invErr
  }
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
  if (error) {
    // Roll back the sold-flip so a failed platform_sales insert can't leave
    // the slab marked sold with no sale record (orphan).
    try {
      await supabase.from('slabs').update({
        status: fresh.status,
        sale_price_usd: null, sale_channel: null, sale_date: null, sale_fees_usd: null,
        sold_at: null, sold_by_id: null, buyer_name: null,
        transaction_id: null, transaction_type: null,
      }).eq('id', slab.id)
    } catch (rb) { console.error('[sell-slab-platform] rollback failed:', rb) }
    throw error
  }
  return { slab: updatedSlab }
}

// ---- single: full-row sold OR fungible split, then platform_sales row ------

const _sellSingleLinePlatform = async ({
  single, quantity, salePrice, ourPrice,
  platform, channel, streamerId, transactionId, saleDate, saleChannel,
  allowStockAdjust = false,
}) => {
  let sourceQty = single.quantity || 1
  const sellQty   = Math.max(1, Number(quantity) || 1)
  if (sellQty > sourceQty) {
    if (!allowStockAdjust) throw new Error(`Only ${sourceQty} available — cannot sell ${sellQty}`)
    // Streamer confirmed an over-scan: physical copies in hand beyond app
    // stock (directive 2026-06-09 — physical wins). Bump the row's qty
    // first so the sell math below stays whole.
    const { error: bumpErr } = await supabase
      .from('singles').update({ quantity: sellQty }).eq('id', single.id)
    if (bumpErr) throw bumpErr
    console.log(`[sell-single-platform] stock auto-corrected: ${single.tcg_id} qty ${sourceQty} → ${sellQty}`)
    sourceQty = sellQty
  }
  const isFungibleRaw = single.form === 'raw' && sourceQty > 1

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

  let soldRow, rollback
  if (!isFungibleRaw || sellQty === sourceQty) {
    soldRow = await markSingleAsSold(single.id, saleData)
    rollback = () => supabase.from('singles').update({
      status: 'in_inventory',
      sale_price_usd: null, sale_price_native: null, sale_fees_usd: null,
      sale_channel: null, sale_date: null, sold_by_id: null, buyer_name: null,
      sale_notes: null, payment_method_id: null, transaction_id: null, transaction_type: null,
    }).eq('id', single.id)
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
    rollback = async () => {
      await supabase.from('singles').delete().eq('id', soldRow.id)             // remove the just-created clone
      await supabase.from('singles').update({ quantity: sourceQty }).eq('id', single.id)  // restore source qty
    }
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
  if (error) {
    // Undo the inventory mutation so a failed platform_sales insert can't
    // leave the single marked sold with no sale record (orphan).
    try { await rollback() } catch (rb) { console.error('[sell-single-platform] rollback failed:', rb) }
    throw error
  }
  return { single: soldRow }
}
