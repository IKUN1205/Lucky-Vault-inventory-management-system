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

export const createSingle = async (single) => {
  const { data, error } = await supabase
    .from('singles')
    .insert(single)
    .select()
    .single()
  if (error) throw error
  return data
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
    .select()
    .single()
  if (error) throw error
  return data
}

// Look up a single by its graded-slab cert#. Used by the Scan page to
// route an incoming barcode to the right next step (intake / sell / dupe
// warning). We match against the UNIQUE partial index on cert_number
// (graded, non-deleted), so this returns at most one row.
//
// Returns: the matching single row WITH joined set/location/acquirer/sold_by
// for the Sell modal context, or null if no match.
export const fetchSingleByCert = async (certNumber) => {
  const trimmed = (certNumber || '').trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('singles')
    .select(`
      *,
      set:card_sets(id, brand, name, code, language),
      location:locations(id, name),
      acquirer:users!singles_acquirer_id_fkey(id, name),
      sold_by:users!singles_sold_by_id_fkey(id, name)
    `)
    .eq('cert_number', trimmed)
    .or('deleted.is.null,deleted.eq.false')
    .maybeSingle()
  if (error) throw error
  return data
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
    sold_by_id: saleData.sold_by_id || null
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
  return data
}
