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

export const createSingle = async (single) => {
  const { data, error } = await supabase
    .from('singles')
    .insert(single)
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
  const { data, error } = await supabase
    .from('singles')
    .insert(singles)
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
export const fetchSingleByIdentifier = async (idString) => {
  const trimmed = (idString || '').trim()
  if (!trimmed) return null
  // Supabase escapes special chars but quotes inside .or() need to be safe.
  // Strip anything that would confuse the parser. Our IDs are alphanumeric.
  const safe = trimmed.replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe) return null
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
    .maybeSingle()
  if (error) throw error
  return data
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
