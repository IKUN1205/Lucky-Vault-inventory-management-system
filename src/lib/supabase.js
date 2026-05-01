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
export const deleteStreamCount       = makeDeleter('stream_counts')
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
      updateData.avg_cost_basis = newAvgCost
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

export const fetchStreamCounts = async (locationId = null, dateFrom = null, dateTo = null) => {
  let query = supabase
    .from('stream_counts')
    .select(`
      *,
      location:locations(name),
      streamer:users!stream_counts_streamer_id_fkey(name),
      counted_by:users!stream_counts_counted_by_id_fkey(name)
    `)
  
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
