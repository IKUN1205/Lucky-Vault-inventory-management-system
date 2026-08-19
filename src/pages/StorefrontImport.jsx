import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { confirmNoDuplicates } from '../lib/duplicateGuard'
import {
  Package,
  Upload,
  FileSpreadsheet,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Plus,
  ArrowLeft,
  Trash2,
} from 'lucide-react'

// ============================================================================
// Storefront Inventory Import
// ============================================================================
// Bulk-imports a physical-count spreadsheet (xlsx) into the Front Store
// location's inventory. Every Excel row is shown for manual mapping — even
// auto-suggested rows — so the user has eyes on every decision before any
// inventory is touched.
//
// Flow:
//   1. Upload .xlsx → parse → dedupe by product name (SUM quantities)
//   2. Auto-load existing mappings from platform_product_mappings(platform='storefront')
//   3. User maps each row to an existing product OR creates a new product inline
//   4. Apply:
//        - INSERT any new products
//        - UPSERT inventory.quantity at Front Store for every mapped product
//        - ZERO OUT any product currently in Front Store inventory NOT in this import
//        - Save mappings to platform_product_mappings so next month's count
//          doesn't require re-mapping
// ============================================================================

const PLATFORM = 'storefront'
const TARGET_LOCATION_NAME = 'Front Store'

// Excel header column names — match what we expect from the count sheet.
// If the user's file headers drift, we try several reasonable variants before
// giving up.
const COL_PRODUCT_ALIASES   = ['product', 'product name', 'name', 'item']
const COL_TYPE_ALIASES      = ['type']
const COL_NEW_QTY_ALIASES   = ['quantity 5/12', 'qty 5/12', 'new quantity', 'new qty', 'count', 'quantity']

// ----- Helpers --------------------------------------------------------------

// Lowercase header lookup — case + whitespace insensitive
function findColumn(headerRow, aliases) {
  if (!Array.isArray(headerRow)) return -1
  const normalized = headerRow.map(h => (h ?? '').toString().trim().toLowerCase())
  // Try exact match first, then "contains" fall-back so headers like
  // "QUANTITY 5/12" still find "quantity 5/12".
  for (const a of aliases) {
    const i = normalized.indexOf(a)
    if (i >= 0) return i
  }
  for (const a of aliases) {
    const i = normalized.findIndex(h => h.includes(a))
    if (i >= 0) return i
  }
  return -1
}

// Lightweight tokeniser + Jaccard for fuzzy auto-suggest. Same approach as
// the Audit page so the experience is consistent.
function tokenize(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length > 1)
}
function similarity(a, b) {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

// ----- Main component -------------------------------------------------------

export default function StorefrontImport() {
  // Reference data
  const [products, setProducts] = useState([])
  const [existingMappings, setExistingMappings] = useState({}) // external_name -> product_id
  const [targetLocationId, setTargetLocationId] = useState(null)
  const [currentInventory, setCurrentInventory] = useState(new Map()) // product_id -> qty at Front Store
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)

  // Parse state
  const [file, setFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([]) // [{ external_name, type, new_qty }]
  const [parseError, setParseError] = useState(null)

  // Mapping state
  //   pendingMappings[external_name] = product_id | 'NEW:<temp_id>' | 'IGNORE'
  const [pendingMappings, setPendingMappings] = useState({})
  //   newProducts[temp_id] = { name, brand, type, language, category }
  const [newProducts, setNewProducts] = useState({})
  const [searchQuery, setSearchQuery] = useState('')

  // Apply state
  const [showConfirm, setShowConfirm] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)

  // Create-new-product modal state
  const [createModal, setCreateModal] = useState(null) // { external_name, defaults }

  useEffect(() => { loadReferenceData() }, [])

  const loadReferenceData = async () => {
    try {
      setLoading(true)
      setPageError(null)
      const [prodRes, mapRes, locRes] = await Promise.all([
        supabase.from('products').select('id, name, brand, language, type, category').order('name'),
        supabase.from('platform_product_mappings').select('external_name, product_id, ignore').eq('platform', PLATFORM),
        supabase.from('locations').select('id, name').eq('name', TARGET_LOCATION_NAME).maybeSingle(),
      ])
      if (prodRes.error) throw prodRes.error
      if (mapRes.error) throw mapRes.error
      if (locRes.error) throw locRes.error

      setProducts(prodRes.data || [])
      const mp = {}
      for (const m of mapRes.data || []) {
        if (m.ignore) mp[m.external_name] = 'IGNORE'
        else if (m.product_id) mp[m.external_name] = m.product_id
      }
      setExistingMappings(mp)

      if (locRes.data?.id) {
        setTargetLocationId(locRes.data.id)
        // Load current Front Store inventory so the preview can show "will
        // zero out N existing products not in the upload"
        const { data: invRows } = await supabase
          .from('inventory')
          .select('product_id, quantity')
          .eq('location_id', locRes.data.id)
        const m = new Map()
        for (const r of invRows || []) m.set(r.product_id, r.quantity || 0)
        setCurrentInventory(m)
      } else {
        setPageError(`Location "${TARGET_LOCATION_NAME}" not found in locations table.`)
      }
    } catch (err) {
      console.error(err)
      setPageError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  // ---- Step 1: parse xlsx ----
  const handleFile = async (f) => {
    setFile(f)
    setParseError(null)
    setParsedRows([])
    setPendingMappings({})
    setNewProducts({})
    if (!f) return
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      // Take the first sheet by default — the user's sheet had only one.
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) throw new Error('No sheets found in workbook')
      // Read as array-of-arrays so we can find columns by header text.
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
      if (rows.length < 2) throw new Error('Spreadsheet is empty.')

      const header = rows[0]
      const nameIdx = findColumn(header, COL_PRODUCT_ALIASES)
      const typeIdx = findColumn(header, COL_TYPE_ALIASES)
      const qtyIdx = findColumn(header, COL_NEW_QTY_ALIASES)
      if (nameIdx < 0) throw new Error('Could not find a "Product" column.')
      if (qtyIdx < 0) throw new Error('Could not find a quantity column (looked for "Quantity 5/12", "Quantity", etc.)')

      // Dedupe by trimmed product name — the user's sheet had Surging Sparks
      // Booster Box appearing twice (rows 36 and 60). SUM the qty so we
      // collapse them safely; user can still adjust if they disagree.
      const byName = new Map()
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        const raw = r[nameIdx]
        if (raw == null) continue
        const name = String(raw).trim()
        if (!name) continue
        const type = typeIdx >= 0 ? String(r[typeIdx] ?? '').trim() : ''
        // None/blank cells → 0 (user's Q2: blank means "sold out")
        const qtyRaw = r[qtyIdx]
        const qty = qtyRaw == null || qtyRaw === '' ? 0 : Number(qtyRaw)
        if (!isFinite(qty)) continue
        const prev = byName.get(name)
        if (prev) {
          prev.new_qty += qty
        } else {
          byName.set(name, { external_name: name, type, new_qty: qty })
        }
      }
      const out = Array.from(byName.values()).sort((a, b) => a.external_name.localeCompare(b.external_name))
      setParsedRows(out)

      // Apply existing mappings so the user only sees what's NEW to map.
      const pending = {}
      for (const row of out) {
        if (existingMappings[row.external_name]) {
          pending[row.external_name] = existingMappings[row.external_name]
        }
      }
      setPendingMappings(pending)
    } catch (err) {
      console.error(err)
      setParseError(err.message || 'Failed to parse spreadsheet')
    }
  }

  // ---- Auto-suggest: fill unmapped rows with fuzzy best-match ----
  const autoSuggest = () => {
    const updates = { ...pendingMappings }
    let suggested = 0
    for (const row of parsedRows) {
      if (updates[row.external_name]) continue // already decided
      let best = null
      let bestScore = 0
      for (const p of products) {
        const s = similarity(p.name, row.external_name)
        if (s > bestScore) { bestScore = s; best = p }
      }
      // Only auto-suggest if the score is meaningful — anything below 0.35
      // is more likely to mislead the user than help.
      if (best && bestScore >= 0.35) {
        updates[row.external_name] = best.id
        suggested++
      }
    }
    setPendingMappings(updates)
    return suggested
  }

  // ---- Derived: mapping summary ----
  const stats = useMemo(() => {
    const total = parsedRows.length
    let mapped = 0, ignored = 0, willCreate = 0
    for (const row of parsedRows) {
      const v = pendingMappings[row.external_name]
      if (!v) continue
      if (v === 'IGNORE') ignored++
      else if (typeof v === 'string' && v.startsWith('NEW:')) willCreate++
      else mapped++
    }
    const unmapped = total - mapped - ignored - willCreate
    // Count current Front Store inventory products not in this upload — they
    // will be zeroed out on apply.
    const mappedPids = new Set()
    for (const row of parsedRows) {
      const v = pendingMappings[row.external_name]
      if (typeof v === 'string' && !v.startsWith('NEW:') && v !== 'IGNORE') {
        mappedPids.add(v)
      }
    }
    let willZero = 0
    for (const [pid, qty] of currentInventory) {
      if (qty > 0 && !mappedPids.has(pid)) willZero++
    }
    return { total, mapped, ignored, willCreate, unmapped, willZero }
  }, [parsedRows, pendingMappings, currentInventory])

  const filteredRows = useMemo(() => {
    if (!searchQuery) return parsedRows
    const q = searchQuery.toLowerCase()
    return parsedRows.filter(r => r.external_name.toLowerCase().includes(q))
  }, [parsedRows, searchQuery])

  // ---- Open create-new-product modal ----
  const openCreateModal = (externalName) => {
    // Pre-fill defaults from the Excel row + heuristics
    const row = parsedRows.find(r => r.external_name === externalName)
    if (!row) return
    setCreateModal({
      external_name: externalName,
      defaults: {
        name: externalName,
        brand: guessBrand(externalName),
        type: guessProductType(externalName, row.type),
        language: guessLanguage(externalName, row.type),
        category: '',
      },
    })
  }

  const finalizeNewProduct = (data) => {
    // Stash a "temp" placeholder mapping (NEW:<temp_id>) so we know which
    // rows correspond to to-be-created products at apply time.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setNewProducts(prev => ({ ...prev, [tempId]: data }))
    setPendingMappings(prev => ({ ...prev, [createModal.external_name]: `NEW:${tempId}` }))
    setCreateModal(null)
  }

  const cancelNewProduct = (externalName) => {
    // Removes the NEW mapping + drops the staged product
    const cur = pendingMappings[externalName]
    if (typeof cur === 'string' && cur.startsWith('NEW:')) {
      const tempId = cur.slice(4)
      setNewProducts(prev => { const n = { ...prev }; delete n[tempId]; return n })
    }
    setPendingMappings(prev => { const n = { ...prev }; delete n[externalName]; return n })
  }

  // ---- Apply ----
  const handleApply = async () => {
    if (!targetLocationId) { setApplyResult({ ok: false, error: 'Front Store location not loaded.' }); return }
    if (stats.unmapped > 0) {
      setApplyResult({ ok: false, error: `${stats.unmapped} row(s) still unmapped. Map them or mark as Ignore first.` })
      return
    }
    setApplying(true)
    setApplyResult(null)
    try {
      // ---- Phase 1: insert new products ----
      const tempIdsInOrder = []
      const newProductRows = []
      for (const [tempId, p] of Object.entries(newProducts)) {
        // Only insert ones that are actually referenced by a current mapping
        // (in case the user staged a new product then removed it)
        const inUse = Object.values(pendingMappings).some(v => v === `NEW:${tempId}`)
        if (!inUse) continue
        tempIdsInOrder.push(tempId)
        newProductRows.push({
          name: p.name,
          brand: p.brand || null,
          language: p.language || 'EN',
          type: p.type || null,
          category: p.category || null,
        })
      }
      const tempToReal = {} // temp_id -> real product_id
      if (newProductRows.length > 0) {
        // Every door into `products` asks the same question first. This one
        // inserts directly (it needs the ids back in insertion order), so the
        // guard is called rather than wrapped around the write.
        await confirmNoDuplicates(newProductRows)
        const { data: inserted, error: insErr } = await supabase
          .from('products').insert(newProductRows).select('id, name')
        if (insErr) throw insErr
        // Match inserted rows back to their temp_ids by ORDER (Supabase
        // preserves insertion order in the returned data).
        inserted.forEach((row, i) => {
          tempToReal[tempIdsInOrder[i]] = row.id
        })
      }

      // ---- Phase 2: build the final (product_id, qty) list ----
      const updates = []  // for the inventory upsert
      for (const row of parsedRows) {
        const v = pendingMappings[row.external_name]
        if (!v || v === 'IGNORE') continue
        let pid
        if (typeof v === 'string' && v.startsWith('NEW:')) {
          pid = tempToReal[v.slice(4)]
          if (!pid) continue // safety — shouldn't happen
        } else {
          pid = v
        }
        updates.push({ product_id: pid, quantity: row.new_qty, location_id: targetLocationId })
      }

      // ---- Phase 3: upsert inventory rows for mapped products ----
      // Strategy: for each row, check if inventory exists for (product_id,
      // location_id); UPDATE if so, INSERT otherwise. We do it one-by-one
      // because Supabase's upsert needs a unique constraint on the
      // composite key which we can't assume exists.
      let updatedCount = 0, insertedInvCount = 0
      for (const u of updates) {
        const { data: existing } = await supabase
          .from('inventory')
          .select('id')
          .eq('product_id', u.product_id)
          .eq('location_id', u.location_id)
          .maybeSingle()
        if (existing) {
          // Only touch quantity — leave avg_cost_basis alone (preserves
          // historical cost; physical count doesn't tell us cost).
          const { error } = await supabase
            .from('inventory')
            .update({ quantity: u.quantity, last_updated: new Date().toISOString() })
            .eq('id', existing.id)
          if (error) throw error
          updatedCount++
        } else {
          const { error } = await supabase
            .from('inventory')
            .insert({ product_id: u.product_id, location_id: u.location_id, quantity: u.quantity, avg_cost_basis: 0 })
          if (error) throw error
          insertedInvCount++
        }
      }

      // ---- Phase 4: zero out everything in Front Store NOT in the upload ----
      const mappedPids = new Set(updates.map(u => u.product_id))
      const toZero = []
      for (const [pid, qty] of currentInventory) {
        if (qty > 0 && !mappedPids.has(pid)) toZero.push(pid)
      }
      let zeroedCount = 0
      if (toZero.length > 0) {
        const { error } = await supabase
          .from('inventory')
          .update({ quantity: 0, last_updated: new Date().toISOString() })
          .eq('location_id', targetLocationId)
          .in('product_id', toZero)
        if (error) throw error
        zeroedCount = toZero.length
      }

      // ---- Phase 5: save mappings for next time ----
      const mappingRows = []
      for (const row of parsedRows) {
        const v = pendingMappings[row.external_name]
        if (!v) continue
        let pid = null
        let ignore = false
        if (v === 'IGNORE') ignore = true
        else if (typeof v === 'string' && v.startsWith('NEW:')) pid = tempToReal[v.slice(4)]
        else pid = v
        if (!pid && !ignore) continue
        mappingRows.push({ platform: PLATFORM, external_name: row.external_name, product_id: pid, ignore })
      }
      if (mappingRows.length > 0) {
        const { error } = await supabase
          .from('platform_product_mappings')
          .upsert(mappingRows, { onConflict: 'platform,external_name' })
        if (error) throw error
      }

      setApplyResult({
        ok: true,
        summary: {
          newProducts: Object.keys(tempToReal).length,
          inventoryUpdated: updatedCount,
          inventoryInserted: insertedInvCount,
          inventoryZeroed: zeroedCount,
          mappingsSaved: mappingRows.length,
        }
      })
      // Refresh reference data so the page reflects new state
      await loadReferenceData()
      setShowConfirm(false)
    } catch (err) {
      if (err?.code === 'DUPLICATE_CANCELLED') {
        // A decision, not a failure. Reporting it as an error is how people
        // learn to press OK on the next prompt without reading it.
        console.info('[StorefrontImport] duplicate prompt cancelled')
        setApplyResult({ ok: false, cancelled: true,
          error: 'Nothing imported. Map those rows to the existing SKUs and run it again.' })
      } else {
        console.error(err)
        setApplyResult({ ok: false, error: err.message || String(err) })
      }
    } finally {
      setApplying(false)
    }
  }

  // ---- Render ----
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }

  return (
    <div className="fade-in space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Package className="text-vault-gold" />
          Storefront Inventory Import
        </h1>
        <p className="text-gray-400 mt-1">
          Bulk-update <strong>{TARGET_LOCATION_NAME}</strong> from a physical-count spreadsheet. Anything in the spreadsheet replaces the current quantity; anything NOT in the spreadsheet is zeroed out.
        </p>
      </div>

      {pageError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
          {pageError}
        </div>
      )}

      {/* STEP 1 — Upload */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-7 h-7 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-sm">1</span>
          <h2 className="font-semibold text-white">Upload xlsx file</h2>
        </div>

        <div className="bg-vault-darker/50 border border-vault-border rounded-lg p-3 mb-4 text-xs text-gray-400">
          Expected columns: <strong>Product</strong>, <strong>Type</strong>, <strong>Quantity (or Quantity 5/12)</strong>. Blank quantity cells are treated as 0 (sold out). Duplicate product names are summed.
        </div>

        <label className="flex items-center gap-2 px-4 py-2.5 bg-vault-darker border border-vault-border rounded-lg cursor-pointer hover:border-vault-gold transition-colors">
          <Upload size={16} className="text-vault-gold" />
          <span className="text-sm text-gray-300 truncate">{file?.name || 'Choose an .xlsx file...'}</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </label>

        {parseError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
            {parseError}
          </div>
        )}
      </div>

      {/* STEP 2 — Mapping */}
      {parsedRows.length > 0 && (
        <div className="bg-vault-surface border border-vault-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-sm">2</span>
              <h2 className="font-semibold text-white">Map products</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const n = autoSuggest(); /* user feedback via stats below */ }}
                className="px-3 py-2 bg-vault-darker border border-vault-gold/40 hover:border-vault-gold text-vault-gold text-sm rounded-lg flex items-center gap-2"
              >
                <RefreshCw size={14} /> Auto-suggest unmapped
              </button>
              <button
                onClick={() => { setFile(null); setParsedRows([]); setPendingMappings({}); setNewProducts({}); }}
                className="px-3 py-2 bg-vault-darker border border-vault-border hover:border-vault-border/80 text-gray-400 text-sm rounded-lg flex items-center gap-2"
              >
                <X size={14} /> Cancel
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
            <StatCard label="Rows in file" value={stats.total} />
            <StatCard label="Mapped" value={stats.mapped} colorClass="text-green-400" />
            <StatCard label="Will create" value={stats.willCreate} colorClass={stats.willCreate > 0 ? 'text-blue-400' : 'text-gray-300'} />
            <StatCard label="Unmapped" value={stats.unmapped} colorClass={stats.unmapped > 0 ? 'text-yellow-400' : 'text-green-400'} />
            <StatCard label="Will zero out" value={stats.willZero} colorClass="text-orange-400" subtext="not in upload" />
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search Excel product names..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>

          {/* Mapping list */}
          <div className="max-h-[600px] overflow-y-auto space-y-1.5 pr-1 mb-4">
            {filteredRows.map(row => (
              <MappingRow
                key={row.external_name}
                row={row}
                products={products}
                value={pendingMappings[row.external_name]}
                newProductData={
                  typeof pendingMappings[row.external_name] === 'string' &&
                  pendingMappings[row.external_name].startsWith('NEW:')
                    ? newProducts[pendingMappings[row.external_name].slice(4)]
                    : null
                }
                onMapToExisting={(pid) => setPendingMappings(prev => ({ ...prev, [row.external_name]: pid }))}
                onIgnore={() => setPendingMappings(prev => ({ ...prev, [row.external_name]: 'IGNORE' }))}
                onCreateNew={() => openCreateModal(row.external_name)}
                onClear={() => cancelNewProduct(row.external_name)}
              />
            ))}
            {filteredRows.length === 0 && (
              <p className="text-gray-500 text-sm py-4 text-center">
                {searchQuery ? `No rows match "${searchQuery}"` : 'No rows'}
              </p>
            )}
          </div>

          {/* Apply */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-vault-border">
            <p className="text-xs text-gray-500">
              {stats.unmapped > 0
                ? `${stats.unmapped} row${stats.unmapped === 1 ? '' : 's'} still need mapping`
                : `Ready — ${stats.mapped + stats.willCreate} product${stats.mapped + stats.willCreate === 1 ? '' : 's'} will be saved to ${TARGET_LOCATION_NAME}, ${stats.willZero} will be zeroed`}
            </p>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={applying || stats.unmapped > 0 || (stats.mapped + stats.willCreate === 0)}
              className="px-5 py-2.5 bg-vault-gold text-vault-dark font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {applying ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {applying ? 'Applying...' : 'Apply to Front Store'}
            </button>
          </div>
          {applyResult && !applyResult.ok && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
              {applyResult.error}
            </div>
          )}
        </div>
      )}

      {/* Success result */}
      {applyResult?.ok && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-5 text-green-200 space-y-1">
          <div className="font-semibold text-green-300 flex items-center gap-2">
            <CheckCircle2 size={18} /> Import complete
          </div>
          <ul className="text-sm space-y-0.5 list-disc pl-5">
            <li>{applyResult.summary.newProducts} new products created</li>
            <li>{applyResult.summary.inventoryUpdated} inventory rows updated</li>
            <li>{applyResult.summary.inventoryInserted} new inventory rows inserted</li>
            <li>{applyResult.summary.inventoryZeroed} products zeroed out (not in upload)</li>
            <li>{applyResult.summary.mappingsSaved} mappings saved for next time</li>
          </ul>
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <ConfirmModal
          stats={stats}
          locationName={TARGET_LOCATION_NAME}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleApply}
          applying={applying}
        />
      )}

      {/* Create-new-product modal */}
      {createModal && (
        <CreateProductModal
          defaults={createModal.defaults}
          onCancel={() => setCreateModal(null)}
          onSave={finalizeNewProduct}
        />
      )}
    </div>
  )
}

// ----- Sub-components -------------------------------------------------------

function StatCard({ label, value, colorClass = 'text-white', subtext }) {
  return (
    <div className="bg-vault-darker rounded-lg p-3">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`font-bold text-lg ${colorClass}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}

function MappingRow({ row, products, value, newProductData, onMapToExisting, onIgnore, onCreateNew, onClear }) {
  const isMapped = !!value
  const isIgnore = value === 'IGNORE'
  const isNew = typeof value === 'string' && value.startsWith('NEW:')
  const selectedProduct = !isIgnore && !isNew && typeof value === 'string'
    ? products.find(p => p.id === value)
    : null

  return (
    <div className={`bg-vault-darker rounded-lg p-3 border ${
      isMapped ? 'border-vault-border/50' : 'border-yellow-500/30'
    }`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">
            {row.external_name}
            <span className="text-gray-500 text-xs ml-2">qty: {row.new_qty}</span>
            {row.type && <span className="text-gray-600 text-xs ml-2">[{row.type}]</span>}
          </div>
          {isMapped && (
            <div className="text-xs mt-0.5">
              {isIgnore && <span className="text-gray-500">⊘ Ignored</span>}
              {isNew && newProductData && (
                <span className="text-blue-300">
                  ➕ Will create: {newProductData.name} [{newProductData.brand} · {newProductData.language} · {newProductData.type}]
                </span>
              )}
              {selectedProduct && (
                <span className="text-green-400">
                  → {selectedProduct.name}
                  {selectedProduct.language && <span className="text-gray-500 ml-2">[{selectedProduct.language}]</span>}
                </span>
              )}
            </div>
          )}
          {!isMapped && (
            <div className="text-xs text-yellow-400 mt-0.5">Unmapped — pick a product, create new, or ignore</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ProductPicker
            products={products}
            value={!isIgnore && !isNew ? value : ''}
            onChange={onMapToExisting}
          />
          {!isMapped && (
            <button
              onClick={onCreateNew}
              className="px-2 py-1 text-xs text-blue-300 hover:text-blue-200 border border-blue-500/30 rounded flex items-center gap-1"
            >
              <Plus size={12} /> New
            </button>
          )}
          {!isIgnore && (
            <button
              onClick={onIgnore}
              className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 border border-vault-border rounded"
            >
              Ignore
            </button>
          )}
          {isMapped && (
            <button
              onClick={onClear}
              title="Clear"
              className="text-gray-500 hover:text-red-400"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProductPicker({ products, value, onChange }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="px-2 py-1 bg-vault-surface border border-vault-border rounded text-xs text-white focus:outline-none focus:border-vault-gold max-w-[240px]"
    >
      <option value="">— pick existing —</option>
      {products.map(p => (
        <option key={p.id} value={p.id}>
          {p.name}{p.language ? ` [${p.language}]` : ''}
        </option>
      ))}
    </select>
  )
}

function ConfirmModal({ stats, locationName, onCancel, onConfirm, applying }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-vault-surface border border-vault-border rounded-lg max-w-md w-full p-6 space-y-3">
        <h3 className="font-semibold text-white text-lg flex items-center gap-2">
          <AlertTriangle size={18} className="text-yellow-400" /> Confirm Front Store import
        </h3>
        <div className="text-sm text-gray-300 space-y-1">
          <div>• Create <strong className="text-blue-300">{stats.willCreate}</strong> new products</div>
          <div>• Set quantity for <strong className="text-green-300">{stats.mapped + stats.willCreate}</strong> products at {locationName}</div>
          <div>• Zero out <strong className="text-orange-300">{stats.willZero}</strong> products currently in {locationName} but not in this upload</div>
        </div>
        <p className="text-xs text-gray-500">
          avg_cost_basis is preserved for products already in inventory. New products start with cost 0 — set them when you next intake stock.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={applying}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={applying}
            className="px-4 py-2 bg-vault-gold text-vault-dark text-sm font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 flex items-center gap-2"
          >
            {applying ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {applying ? 'Applying...' : 'Confirm & apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateProductModal({ defaults, onCancel, onSave }) {
  const [name, setName] = useState(defaults.name)
  const [brand, setBrand] = useState(defaults.brand)
  const [type, setType] = useState(defaults.type)
  const [language, setLanguage] = useState(defaults.language)
  const [category, setCategory] = useState(defaults.category)

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-vault-surface border border-vault-border rounded-lg max-w-md w-full p-6 space-y-3">
        <h3 className="font-semibold text-white text-lg flex items-center gap-2">
          <Plus size={18} className="text-blue-400" /> Create new product
        </h3>
        <div className="space-y-3">
          <Field label="Name (required)">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded text-white text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand">
              <select value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded text-white text-sm">
                <option value="">—</option>
                <option value="Pokemon">Pokemon</option>
                <option value="One Piece">One Piece</option>
                <option value="Magic">Magic</option>
                <option value="Lorcana">Lorcana</option>
                <option value="Yu-Gi-Oh!">Yu-Gi-Oh!</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="Language">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded text-white text-sm">
                <option value="EN">EN</option>
                <option value="JP">JP</option>
                <option value="CN">CN</option>
                <option value="KR">KR</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded text-white text-sm">
                <option value="">—</option>
                <option value="Sealed">Sealed</option>
                <option value="Pack">Pack</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="Category">
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Booster Box, ETB" className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded text-white text-sm" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={() => name.trim() && onSave({ name: name.trim(), brand, type, language, category })}
            disabled={!name.trim()}
            className="px-4 py-2 bg-vault-gold text-vault-dark text-sm font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

// ----- Heuristics for the create-new modal ----------------------------------

function guessBrand(name) {
  const n = (name || '').toLowerCase()
  if (/\b(pokemon|pikachu|charizard|eevee|paldean|prismatic|surging|fates|crown|stellar|forces of nature|brilliant|fusion strike|chilling reign|guardians rising|crimson invasion|burning shadows|xy|sun ?& ?moon|sword ?& ?shield|destined|journey|astral|mega|ascended|phantasmal)\b/.test(n)) return 'Pokemon'
  if (/\b(one piece|op-?\d+|eb-?\d+|prb-?\d+|romance dawn|paramount)\b/.test(n)) return 'One Piece'
  if (/\b(magic|mtg|commander|standard|modern|final fantasy|ravnica)\b/.test(n)) return 'Magic'
  if (/\b(lorcana|disney)\b/.test(n)) return 'Lorcana'
  if (/\b(yu-?gi-?oh|ygo|duel monsters)\b/.test(n)) return 'Yu-Gi-Oh!'
  if (/\b(labubu|labubus)\b/.test(n)) return 'Other'
  return 'Pokemon' // default — bulk of inventory
}

function guessLanguage(name, excelType) {
  const n = (name || '').toLowerCase()
  if (/\b(jp|japanese|japan)\b/.test(n)) return 'JP'
  if (/\b(cn|chinese|china|gem vol)\b/.test(n)) return 'CN'
  if (/\b(kr|korean)\b/.test(n)) return 'KR'
  return 'EN'
}

function guessProductType(name, excelType) {
  const t = (excelType || '').toLowerCase()
  const n = (name || '').toLowerCase()
  if (t.includes('pack') && !t.includes('packs')) return 'Pack'
  if (t.includes('packs')) return 'Pack'
  return 'Sealed' // box, ETB, bundle, tin, etc. — all "sealed" in our schema
}
