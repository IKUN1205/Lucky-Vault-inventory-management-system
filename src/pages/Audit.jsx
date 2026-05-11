import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  ShieldCheck,
  Upload,
  FileSpreadsheet,
  Link2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Calendar,
  RefreshCw,
  Search,
  X,
  Trash2,
} from 'lucide-react'

// ============================================================================
// Sales Reconciliation / Audit page
// ============================================================================
// Compares platform-reported sales (e.g. Packheads CSV) against inventory
// outflow recorded by the system, to detect shrinkage / theft / mis-entry.
//
// User flow:
//   1. Upload CSV → parse (with year inference) → load existing mappings.
//   2. If any products in CSV are unmapped → show mapping panel, user
//      maps each to a system product (or marks as "Ignore").
//   3. Import the parsed rows to platform_sales_records.
//   4. Run audit report — comparison between platform and system, by product
//      and by streamer. Rows with |diff| >= threshold are flagged.
//
// Platform support: currently 'packheads' (TikTok stream room). Schema is
// platform-agnostic so we can plug eBay, Whatnot, etc. later.

// ----- Constants --------------------------------------------------------
const PLATFORM = 'packheads'
const PACKHEADS_LOCATION = 'Stream Room - Packheads'

// ----- CSV parsing helpers ----------------------------------------------

// Minimal CSV parser that respects double-quoted fields containing commas.
// Returns array of arrays (rows of cells). Handles \r\n and \n line endings.
function parseCSV(text) {
  const rows = []
  let cur = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else { field += c }
    } else {
      if (c === '"') { inQuotes = true }
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else if (c === '\r') { /* swallow */ }
      else { field += c }
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur) }
  return rows
}

// Parse a money string like "$675.88", " $ 635.32 ", "$2,726.88" → 675.88.
// Returns 0 for empty / unparseable values.
function parseMoney(s) {
  if (s == null) return 0
  const clean = String(s).replace(/[$,\s]/g, '')
  const n = parseFloat(clean)
  return isFinite(n) ? n : 0
}

// Year inference. The CSV uses "m/d" with no year. User tells us the
// starting year+month of the data; rows with month >= startMonth get
// startYear, rows with month < startMonth get startYear + 1. This handles
// the year boundary cleanly for CSVs spanning up to 12 months.
function inferYear(month, startYear, startMonth) {
  return month >= startMonth ? startYear : startYear + 1
}

function toISODate(year, month, day) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

// Convert the Packheads CSV (already parsed to rows-of-cells) into a list
// of structured records ready for import. Skips:
//   - Auction lines (per user q3)
//   - Rows with quantity_ordered = 0 (refund-only / non-sale rows)
//   - Rows missing date or product title
function csvRowsToRecords(rows, startYear, startMonth) {
  // Column indexes — matches the Packheads sheet:
  //   0:Date 1:Product title 2:Qty ordered 3:Qty returned 4:Net sales
  //   5:Net Income 6:Cost of Good Sold 7:Gross profit 8:Gross margin
  //   9:Total returns 10:Orders 11:Time 12:Streamer 13:Stream Hr
  const out = []
  const skipped = { auction: 0, zeroQty: 0, badDate: 0, missingProduct: 0 }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const dateStr = (r[0] || '').trim()
    const product = (r[1] || '').trim()
    if (!dateStr || !/^\d{1,2}\/\d{1,2}$/.test(dateStr)) { skipped.badDate++; continue }
    if (!product) { skipped.missingProduct++; continue }
    if (/^auction/i.test(product)) { skipped.auction++; continue }

    const [m, d] = dateStr.split('/').map(Number)
    const year = inferYear(m, startYear, startMonth)
    const qty = parseInt(r[2] || '0', 10) || 0
    if (qty <= 0) { skipped.zeroQty++; continue }
    const qtyReturned = parseInt(r[3] || '0', 10) || 0
    const netSales = parseMoney(r[4])
    const cogs = parseMoney(r[6])
    const streamer = (r[12] || '').trim() || null

    out.push({
      sale_date: toISODate(year, m, d),
      external_name: product,
      quantity: qty,
      quantity_returned: qtyReturned,
      net_sales: netSales,
      cost: cogs,
      streamer,
    })
  }
  return { records: out, skipped }
}

// Lightweight fuzzy matcher for the mapping suggestions panel. Returns a
// similarity score in [0, 1] — we use word overlap (Jaccard on stemmed
// alphanumeric tokens). Not perfect, but cheap and good enough to put
// the most likely product at the top of the dropdown.
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

// ----- Main component ---------------------------------------------------

export default function Audit() {
  // Reference data — fetched once on mount
  const [products, setProducts] = useState([])
  const [existingMappings, setExistingMappings] = useState({}) // external_name → { product_id, ignore }
  const [packheadsLocationId, setPackheadsLocationId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)

  // Upload form
  const today = new Date()
  const [startYear, setStartYear] = useState(today.getFullYear() - 1)
  const [startMonth, setStartMonth] = useState(7)
  const [file, setFile] = useState(null)

  // Parsed CSV state
  const [parsedRecords, setParsedRecords] = useState([]) // all rows ready for import
  const [parseSkipped, setParseSkipped] = useState(null) // counts of skipped rows
  const [pendingMappings, setPendingMappings] = useState({}) // external_name → product_id | 'IGNORE'
  const [searchQuery, setSearchQuery] = useState('')
  const [parseError, setParseError] = useState(null)
  // Date filter for the mapping panel. The CSV often spans many months but
  // the user only wants to map "current era" products — anything that hasn't
  // sold since X is probably a discontinued SKU not in our system. Default
  // to the report start date so user sees only what they're about to audit.
  const [mapFilterStart, setMapFilterStart] = useState('2026-05-01')
  const [mapFilterEnd, setMapFilterEnd] = useState('')   // empty = no upper bound

  // Import state
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const [lastImportId, setLastImportId] = useState(null)

  // Report state
  const [reportStart, setReportStart] = useState('2026-05-01')
  const [reportEnd, setReportEnd] = useState('2026-05-07')
  const [threshold, setThreshold] = useState(5)
  const [report, setReport] = useState(null)
  const [runningReport, setRunningReport] = useState(false)

  // ---- Initial load ----
  useEffect(() => {
    loadReferenceData()
  }, [])

  const loadReferenceData = async () => {
    try {
      setLoading(true)
      setPageError(null)
      const [prodRes, mapRes, locRes] = await Promise.all([
        supabase.from('products').select('id, name, brand, language').order('name'),
        supabase.from('platform_product_mappings').select('external_name, product_id, ignore').eq('platform', PLATFORM),
        supabase.from('locations').select('id, name').eq('name', PACKHEADS_LOCATION).maybeSingle(),
      ])
      if (prodRes.error) throw prodRes.error
      if (mapRes.error) throw mapRes.error
      setProducts(prodRes.data || [])
      const mp = {}
      for (const m of mapRes.data || []) mp[m.external_name] = { product_id: m.product_id, ignore: m.ignore }
      setExistingMappings(mp)
      setPackheadsLocationId(locRes.data?.id || null)
    } catch (err) {
      console.error(err)
      setPageError(err.message || 'Failed to load reference data')
    } finally {
      setLoading(false)
    }
  }

  // ---- Step 1: parse CSV ----
  const handleParse = async () => {
    if (!file) { setParseError('Please choose a CSV file first.'); return }
    try {
      setParseError(null)
      const text = await file.text()
      const rows = parseCSV(text)
      // Skip the first two header-ish lines: the Packheads sheet has a
      // "Total Gross Profit" row on top and the real header underneath.
      // Detect by finding the row that starts with "Date".
      let dataStart = 0
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        if ((rows[i][0] || '').trim().toLowerCase() === 'date') { dataStart = i + 1; break }
      }
      const dataRows = rows.slice(dataStart)
      const { records, skipped } = csvRowsToRecords(dataRows, startYear, startMonth)
      if (!records.length) { setParseError('No usable rows found in CSV.'); return }
      setParsedRecords(records)
      setParseSkipped(skipped)

      // Initialize pendingMappings from existingMappings for known names.
      const init = {}
      const seen = new Set()
      for (const r of records) {
        if (seen.has(r.external_name)) continue
        seen.add(r.external_name)
        const existing = existingMappings[r.external_name]
        if (existing) {
          init[r.external_name] = existing.ignore ? 'IGNORE' : existing.product_id
        }
      }
      setPendingMappings(init)
    } catch (err) {
      console.error(err)
      setParseError(err.message || 'Failed to parse CSV')
    }
  }

  // ---- Step 2: mapping ----
  // Per-product stats so we can filter / sort by sale activity. Each product
  // gets { count, firstDate, lastDate } — the user uses this to decide what
  // to map (probably "things sold recently") vs. ignore (old SKUs).
  const productStats = useMemo(() => {
    const m = new Map() // external_name → { count, firstDate, lastDate }
    for (const r of parsedRecords) {
      const cur = m.get(r.external_name) || { count: 0, firstDate: r.sale_date, lastDate: r.sale_date }
      cur.count += 1
      if (r.sale_date < cur.firstDate) cur.firstDate = r.sale_date
      if (r.sale_date > cur.lastDate) cur.lastDate = r.sale_date
      m.set(r.external_name, cur)
    }
    return m
  }, [parsedRecords])

  const allUniqueNames = useMemo(() => {
    const set = new Set()
    for (const r of parsedRecords) set.add(r.external_name)
    return Array.from(set).sort()
  }, [parsedRecords])

  // Names that fall within the user's mapping-date filter. Only these are
  // shown for mapping; anything outside is treated as "not your problem".
  const uniqueNames = useMemo(() => {
    return allUniqueNames.filter(name => {
      const s = productStats.get(name)
      if (!s) return false
      if (mapFilterStart && s.lastDate < mapFilterStart) return false   // entire range is before filter
      if (mapFilterEnd && s.firstDate > mapFilterEnd) return false      // entire range is after filter
      return true
    })
  }, [allUniqueNames, productStats, mapFilterStart, mapFilterEnd])

  const unmappedNames = useMemo(() => uniqueNames.filter(n => !pendingMappings[n]), [uniqueNames, pendingMappings])

  const filteredNames = useMemo(() => {
    if (!searchQuery) return uniqueNames
    const q = searchQuery.toLowerCase()
    return uniqueNames.filter(n => n.toLowerCase().includes(q))
  }, [uniqueNames, searchQuery])

  // How many records will actually be imported, based on what's mapped.
  // Unmapped products → skipped entirely. Ignore'd → also skipped.
  const importPreviewCount = useMemo(() => {
    let n = 0
    for (const r of parsedRecords) {
      const v = pendingMappings[r.external_name]
      if (v && v !== 'IGNORE') n++
    }
    return n
  }, [parsedRecords, pendingMappings])

  // Auto-suggest: for each unmapped name, pick the product with the highest
  // word-overlap score (must be >= 0.3 to avoid garbage suggestions).
  const autoSuggest = () => {
    const next = { ...pendingMappings }
    for (const name of unmappedNames) {
      let best = { score: 0, product: null }
      for (const p of products) {
        const s = similarity(name, p.name)
        if (s > best.score) best = { score: s, product: p }
      }
      if (best.score >= 0.3) next[name] = best.product.id
    }
    setPendingMappings(next)
  }

  // ---- Step 3: save mappings + import records ----
  // Rules:
  //   - Only "visible" (in-filter) unmapped names block import — anything
  //     outside the date filter is silently skipped at import time.
  //   - We only upsert mappings for names that the user actually decided on
  //     (in pendingMappings). Untouched names stay unmapped in the DB so
  //     they can be mapped later when the user widens the date filter.
  const handleImport = async () => {
    if (unmappedNames.length > 0) {
      setParseError(`${unmappedNames.length} products in the current date filter still need mapping.`)
      return
    }
    setImporting(true)
    setParseError(null)
    try {
      // Save mappings — only those the user touched in this session
      const mappingRows = Object.keys(pendingMappings).map(name => {
        const val = pendingMappings[name]
        return {
          platform: PLATFORM,
          external_name: name,
          product_id: val === 'IGNORE' ? null : val,
          ignore: val === 'IGNORE',
        }
      })
      const { error: mapErr } = await supabase
        .from('platform_product_mappings')
        .upsert(mappingRows, { onConflict: 'platform,external_name' })
      if (mapErr) throw mapErr

      // Resolve product_id per record. Skip:
      //   - Ignored mappings (val === 'IGNORE')
      //   - Unmapped names (val undefined) — these are outside the filter so
      //     they aren't this audit's concern. User can re-import later.
      const uploadId = (crypto.randomUUID && crypto.randomUUID()) || `upload-${Date.now()}`
      const toImport = []
      for (const r of parsedRecords) {
        const val = pendingMappings[r.external_name]
        if (!val || val === 'IGNORE') continue
        toImport.push({
          platform: PLATFORM,
          sale_date: r.sale_date,
          streamer: r.streamer,
          external_name: r.external_name,
          product_id: val,
          quantity: r.quantity,
          quantity_returned: r.quantity_returned,
          net_sales: r.net_sales,
          cost: r.cost,
          source_upload_id: uploadId,
          source_filename: file?.name || null,
        })
      }
      // Batch insert in chunks of 500 to stay within PostgREST limits.
      const chunkSize = 500
      for (let i = 0; i < toImport.length; i += chunkSize) {
        const chunk = toImport.slice(i, i + chunkSize)
        const { error } = await supabase.from('platform_sales_records').insert(chunk)
        if (error) throw error
      }
      setImportedCount(toImport.length)
      setLastImportId(uploadId)
      // Refresh existingMappings so subsequent uploads pick up new entries.
      await loadReferenceData()
      // Auto-trigger the report for the user's chosen window.
      await runReport()
    } catch (err) {
      console.error(err)
      setParseError(err.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // ---- Step 4: run audit report ----
  const runReport = async () => {
    setRunningReport(true)
    setReport(null)
    try {
      // ---- Platform side (from platform_sales_records) ----
      const { data: platformRows, error: pErr } = await supabase
        .from('platform_sales_records')
        .select('product_id, streamer, quantity, cost')
        .eq('platform', PLATFORM)
        .gte('sale_date', reportStart)
        .lte('sale_date', reportEnd)
        .not('product_id', 'is', null)
      if (pErr) throw pErr

      const platformByProduct = new Map() // pid → { qty, cost, streamers: Map }
      const platformByStreamer = new Map() // streamer → { qty, cost }
      for (const r of platformRows || []) {
        const cur = platformByProduct.get(r.product_id) || { qty: 0, cost: 0, streamers: new Map() }
        cur.qty += r.quantity || 0
        cur.cost += parseFloat(r.cost) || 0
        const sName = r.streamer || '(unknown)'
        const s = cur.streamers.get(sName) || { qty: 0, cost: 0 }
        s.qty += r.quantity || 0
        s.cost += parseFloat(r.cost) || 0
        cur.streamers.set(sName, s)
        platformByProduct.set(r.product_id, cur)

        const ts = platformByStreamer.get(sName) || { qty: 0, cost: 0 }
        ts.qty += r.quantity || 0
        ts.cost += parseFloat(r.cost) || 0
        platformByStreamer.set(sName, ts)
      }

      // ---- System side (stream_count_items where location = Packheads) ----
      const systemByProduct = new Map()
      if (packheadsLocationId) {
        const startISO = new Date(`${reportStart}T00:00:00`).toISOString()
        const endISO = new Date(`${reportEnd}T23:59:59`).toISOString()
        const { data: streamCounts } = await supabase
          .from('stream_counts')
          .select('id')
          .eq('location_id', packheadsLocationId)
          .eq('deleted', false)
          .gte('count_time', startISO)
          .lte('count_time', endISO)
        if (streamCounts?.length) {
          const ids = streamCounts.map(c => c.id)
          const { data: items } = await supabase
            .from('stream_count_items')
            .select('product_id, expected_qty, actual_qty')
            .in('stream_count_id', ids)
          for (const item of items || []) {
            const sold = (item.expected_qty || 0) - (item.actual_qty || 0)
            if (sold <= 0) continue
            const cur = systemByProduct.get(item.product_id) || { qty: 0 }
            cur.qty += sold
            systemByProduct.set(item.product_id, cur)
          }
        }
      }

      // ---- Merge ----
      const productById = new Map(products.map(p => [p.id, p]))
      const allPids = new Set([...platformByProduct.keys(), ...systemByProduct.keys()])
      const rows = []
      for (const pid of allPids) {
        const p = platformByProduct.get(pid) || { qty: 0, cost: 0, streamers: new Map() }
        const s = systemByProduct.get(pid) || { qty: 0 }
        const diff = p.qty - s.qty
        rows.push({
          product_id: pid,
          product: productById.get(pid),
          platform_qty: p.qty,
          platform_cost: p.cost,
          system_qty: s.qty,
          diff,
          flagged: Math.abs(diff) >= threshold,
          streamers: Array.from(p.streamers.entries()).sort((a, b) => b[1].qty - a[1].qty),
        })
      }
      // Flagged rows on top, then by absolute diff
      rows.sort((a, b) => {
        if (a.flagged !== b.flagged) return a.flagged ? -1 : 1
        return Math.abs(b.diff) - Math.abs(a.diff)
      })

      const totals = {
        platformQty: rows.reduce((s, r) => s + r.platform_qty, 0),
        platformCost: rows.reduce((s, r) => s + r.platform_cost, 0),
        systemQty: rows.reduce((s, r) => s + r.system_qty, 0),
        diffQty: 0,
        flaggedCount: rows.filter(r => r.flagged).length,
      }
      totals.diffQty = totals.platformQty - totals.systemQty

      setReport({
        rows,
        totals,
        byStreamer: Array.from(platformByStreamer.entries())
          .map(([name, v]) => ({ name, qty: v.qty, cost: v.cost }))
          .sort((a, b) => b.qty - a.qty),
        range: { start: reportStart, end: reportEnd, threshold },
      })
    } catch (err) {
      console.error(err)
      setParseError(err.message || 'Report failed')
    } finally {
      setRunningReport(false)
    }
  }

  // Delete the most recent import — escape hatch in case the user
  // realizes they uploaded the wrong file or wrong year.
  const undoLastImport = async () => {
    if (!lastImportId) return
    if (!confirm(`Delete the ${importedCount} rows just imported? This cannot be undone.`)) return
    const { error } = await supabase.from('platform_sales_records').delete().eq('source_upload_id', lastImportId)
    if (error) { alert(error.message); return }
    setImportedCount(0)
    setLastImportId(null)
    setReport(null)
  }

  const resetParse = () => {
    setParsedRecords([])
    setParseSkipped(null)
    setPendingMappings({})
    setSearchQuery('')
    setFile(null)
    setParseError(null)
  }

  const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // ---- Render ----
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }
  if (pageError) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-red-300">
        Failed to load: {pageError}
      </div>
    )
  }

  return (
    <div className="fade-in space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShieldCheck className="text-vault-gold" />
          Sales Reconciliation
        </h1>
        <p className="text-gray-400 mt-1">
          Compare platform sales (Packheads CSV) against system inventory outflow to detect shrinkage.
        </p>
      </div>

      {!packheadsLocationId && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-yellow-200 text-sm flex items-start gap-2">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <div>
            <strong>Warning:</strong> No location named "{PACKHEADS_LOCATION}" exists in the system.
            Reports will show platform sales but the "system outflow" column will be 0 for every product.
            Make sure the Packheads stream room is registered as a location.
          </div>
        </div>
      )}

      {/* STEP 1 — Upload */}
      {parsedRecords.length === 0 && (
        <div className="bg-vault-surface border border-vault-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-sm">1</span>
            <h2 className="font-semibold text-white">Upload Packheads CSV</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">CSV file</label>
              <label className="flex items-center gap-2 px-4 py-2.5 bg-vault-darker border border-vault-border rounded-lg cursor-pointer hover:border-vault-gold transition-colors">
                <Upload size={16} className="text-vault-gold" />
                <span className="text-sm text-gray-300 truncate">{file?.name || 'Choose a CSV file...'}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setParseError(null) }}
                />
              </label>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                CSV's earliest month <span className="text-gray-600">(year/month)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number" min="2020" max="2100"
                  value={startYear}
                  onChange={(e) => setStartYear(parseInt(e.target.value || '0', 10))}
                  className="w-24 px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
                />
                <select
                  value={startMonth}
                  onChange={(e) => setStartMonth(parseInt(e.target.value, 10))}
                  className="flex-1 px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                e.g. CSV starts at 7/1/2025 → set to 2025 / 7月
              </p>
            </div>
          </div>

          <button
            onClick={handleParse}
            disabled={!file}
            className="px-5 py-2.5 bg-vault-gold text-vault-dark font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <FileSpreadsheet size={16} />
            Parse CSV
          </button>
          {parseError && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
              {parseError}
            </div>
          )}
        </div>
      )}

      {/* STEP 2 — Mapping */}
      {parsedRecords.length > 0 && !report && (
        <div className="bg-vault-surface border border-vault-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-sm">2</span>
              <h2 className="font-semibold text-white">Map products</h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={autoSuggest}
                className="px-3 py-1.5 bg-vault-darker border border-vault-border rounded-lg text-sm text-gray-300 hover:text-white hover:border-vault-gold flex items-center gap-1.5"
              >
                <RefreshCw size={14} /> Auto-suggest unmapped
              </button>
              <button
                onClick={resetParse}
                className="px-3 py-1.5 bg-vault-darker border border-vault-border rounded-lg text-sm text-gray-300 hover:text-red-400"
              >
                <X size={14} className="inline mr-1" /> Cancel
              </button>
            </div>
          </div>

          {/* Parse stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
            <div className="bg-vault-darker rounded-lg p-3">
              <div className="text-gray-400 text-xs">CSV rows</div>
              <div className="text-white font-bold text-lg">{parsedRecords.length.toLocaleString()}</div>
            </div>
            <div className="bg-vault-darker rounded-lg p-3">
              <div className="text-gray-400 text-xs">All products</div>
              <div className="text-white font-bold text-lg">{allUniqueNames.length}</div>
            </div>
            <div className="bg-vault-darker rounded-lg p-3">
              <div className="text-gray-400 text-xs">In date filter</div>
              <div className="text-vault-gold font-bold text-lg">{uniqueNames.length}</div>
            </div>
            <div className="bg-vault-darker rounded-lg p-3">
              <div className="text-gray-400 text-xs">Unmapped (filtered)</div>
              <div className={`font-bold text-lg ${unmappedNames.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                {unmappedNames.length}
              </div>
            </div>
            <div className="bg-vault-darker rounded-lg p-3">
              <div className="text-gray-400 text-xs">Will import</div>
              <div className="text-green-400 font-bold text-lg">{importPreviewCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">rows with mapping</div>
            </div>
          </div>

          {/* Date filter — restricts which products show up for mapping. The
              user only cares about products active in the period they're
              about to audit; older SKUs that left the catalog months ago
              are noise. */}
          <div className="bg-vault-darker/50 border border-vault-border rounded-lg p-3 mb-3 flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Calendar size={14} className="text-vault-gold" />
              Show only products sold:
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">from</label>
              <input
                type="date"
                value={mapFilterStart}
                onChange={(e) => setMapFilterStart(e.target.value)}
                className="px-2 py-1 bg-vault-surface border border-vault-border rounded text-white text-xs focus:outline-none focus:border-vault-gold"
              />
              <label className="text-xs text-gray-500">to</label>
              <input
                type="date"
                value={mapFilterEnd}
                onChange={(e) => setMapFilterEnd(e.target.value)}
                placeholder="(today)"
                className="px-2 py-1 bg-vault-surface border border-vault-border rounded text-white text-xs focus:outline-none focus:border-vault-gold"
              />
              <button
                onClick={() => { setMapFilterStart(''); setMapFilterEnd('') }}
                className="text-xs text-gray-500 hover:text-gray-300 underline"
                title="Show all products from the CSV"
              >
                clear
              </button>
            </div>
            <div className="text-xs text-gray-600 ml-auto">
              Tip: products outside this range stay unmapped — their rows are skipped on import.
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search product names..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>

          {/* Mapping rows */}
          <div className="max-h-[480px] overflow-y-auto space-y-1.5 pr-1 mb-4">
            {filteredNames.map(name => {
              const val = pendingMappings[name]
              const isIgnore = val === 'IGNORE'
              const isMapped = !!val
              const stats = productStats.get(name)
              return (
                <MappingRow
                  key={name}
                  name={name}
                  products={products}
                  value={val}
                  isIgnore={isIgnore}
                  isMapped={isMapped}
                  stats={stats}
                  onChange={(v) => setPendingMappings(prev => ({ ...prev, [name]: v }))}
                  onClear={() => setPendingMappings(prev => { const n = { ...prev }; delete n[name]; return n })}
                />
              )
            })}
            {filteredNames.length === 0 && (
              <p className="text-gray-500 text-sm py-4 text-center">
                {searchQuery ? `No products match "${searchQuery}"` : 'No products in the selected date range.'}
              </p>
            )}
          </div>

          {/* Import */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-vault-border">
            <p className="text-xs text-gray-500">
              {unmappedNames.length > 0
                ? `${unmappedNames.length} in current filter still need mapping`
                : `Ready — ${importPreviewCount.toLocaleString()} mapped rows will be imported`}
            </p>
            <button
              onClick={handleImport}
              disabled={importing || unmappedNames.length > 0 || importPreviewCount === 0}
              className="px-5 py-2.5 bg-vault-gold text-vault-dark font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {importing ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {importing ? 'Importing...' : 'Save mappings & import'}
            </button>
          </div>
          {parseError && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
              {parseError}
            </div>
          )}
        </div>
      )}

      {/* STEP 3 — Report controls (always visible once any data exists or report present) */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-sm">3</span>
            <h2 className="font-semibold text-white">Run audit report</h2>
          </div>
          {importedCount > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-300">
              <CheckCircle2 size={14} />
              Imported {importedCount.toLocaleString()} rows
              <button onClick={undoLastImport} className="ml-2 text-red-400 hover:text-red-300 text-xs flex items-center gap-1">
                <Trash2 size={12} /> Undo
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={reportStart}
              onChange={(e) => setReportStart(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={reportEnd}
              onChange={(e) => setReportEnd(e.target.value)}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Flag threshold (units)</label>
            <input
              type="number" min="0"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value || '0', 10))}
              className="w-full px-3 py-2 bg-vault-darker border border-vault-border rounded-lg text-white text-sm focus:outline-none focus:border-vault-gold"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={runReport}
              disabled={runningReport}
              className="w-full px-4 py-2 bg-vault-gold text-vault-dark font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {runningReport ? <RefreshCw size={16} className="animate-spin" /> : <ChevronRight size={16} />}
              Run audit
            </button>
          </div>
        </div>
      </div>

      {/* Report */}
      {report && (
        <ReportView report={report} fmt={fmt} />
      )}
    </div>
  )
}

// ---- Subcomponents -----------------------------------------------------

function MappingRow({ name, products, value, isIgnore, isMapped, stats, onChange, onClear }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const matched = useMemo(() => {
    const ranked = products
      .map(p => ({ p, score: similarity(name, p.name) }))
      .sort((a, b) => b.score - a.score)
    let list = ranked.map(r => r.p)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q))
    }
    return list.slice(0, 50)
  }, [products, name, search])

  const selectedProduct = !isIgnore && value ? products.find(p => p.id === value) : null

  return (
    <div className={`bg-vault-darker border rounded-lg p-3 ${isMapped ? 'border-vault-border' : 'border-yellow-500/30'}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">{name}</div>
          {stats && (
            <div className="text-[11px] text-gray-500 mt-0.5">
              {stats.count.toLocaleString()} sale{stats.count === 1 ? '' : 's'} · {stats.firstDate}
              {stats.firstDate !== stats.lastDate && ` → ${stats.lastDate}`}
            </div>
          )}
          {isMapped && (
            <div className="text-xs mt-0.5">
              {isIgnore ? (
                <span className="text-gray-500">⊘ Ignored</span>
              ) : (
                <span className="text-green-400">
                  → {selectedProduct?.name || 'Unknown product'}
                  {selectedProduct?.language && <span className="text-gray-500 ml-2">[{selectedProduct.language}]</span>}
                </span>
              )}
            </div>
          )}
          {!isMapped && (
            <div className="text-xs text-yellow-400 mt-0.5">Unmapped — pick a product or mark as Ignore</div>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={() => setOpen(o => !o)}
            className="px-3 py-1.5 bg-vault-surface border border-vault-border rounded-md text-xs text-gray-300 hover:text-white hover:border-vault-gold flex items-center gap-1"
          >
            <Link2 size={12} /> {isMapped && !isIgnore ? 'Change' : 'Map'}
          </button>
          <button
            onClick={() => onChange('IGNORE')}
            className={`px-3 py-1.5 border rounded-md text-xs flex items-center gap-1 ${
              isIgnore
                ? 'bg-gray-700 border-gray-600 text-gray-300'
                : 'bg-vault-surface border-vault-border text-gray-400 hover:text-gray-200'
            }`}
          >
            Ignore
          </button>
          {isMapped && (
            <button
              onClick={onClear}
              className="px-2 py-1.5 bg-vault-surface border border-vault-border rounded-md text-gray-500 hover:text-red-400"
              title="Clear"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-vault-border pt-3">
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full mb-2 px-3 py-1.5 bg-vault-surface border border-vault-border rounded text-white text-xs focus:outline-none focus:border-vault-gold"
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {matched.map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); setSearch('') }}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-vault-surface text-xs text-gray-300 hover:text-white"
              >
                {p.name}
                {p.language && <span className="text-gray-500 ml-2">[{p.language}]</span>}
                {p.brand && <span className="text-gray-600 ml-1">· {p.brand}</span>}
              </button>
            ))}
            {!matched.length && <p className="text-gray-500 text-xs p-2">No products match</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function ReportView({ report, fmt }) {
  const { rows, totals, byStreamer, range } = report
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
          <div className="text-xs text-gray-400">Platform units</div>
          <div className="text-2xl font-bold text-white">{totals.platformQty.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">{fmt(totals.platformCost)} at cost</div>
        </div>
        <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
          <div className="text-xs text-gray-400">System outflow</div>
          <div className="text-2xl font-bold text-white">{totals.systemQty.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">from {report.range ? 'Packheads stream room' : ''}</div>
        </div>
        <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
          <div className="text-xs text-gray-400">Net difference</div>
          <div className={`text-2xl font-bold ${totals.diffQty === 0 ? 'text-green-400' : totals.diffQty > 0 ? 'text-yellow-400' : 'text-blue-400'}`}>
            {totals.diffQty > 0 ? '+' : ''}{totals.diffQty.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 mt-1">platform − system</div>
        </div>
        <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
          <div className="text-xs text-gray-400">Flagged products</div>
          <div className={`text-2xl font-bold ${totals.flaggedCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {totals.flaggedCount}
          </div>
          <div className="text-xs text-gray-500 mt-1">|diff| ≥ {range.threshold}</div>
        </div>
      </div>

      {/* Product comparison */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <ShieldCheck size={18} className="text-vault-gold" />
          Product-level reconciliation
          <span className="text-xs text-gray-500 ml-1">({rows.length} products · {range.start} → {range.end})</span>
        </h3>
        {rows.length === 0 ? (
          <p className="text-gray-500 text-sm">No platform sales or system outflow in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Platform qty</th>
                  <th className="pb-2 font-medium text-right">System qty</th>
                  <th className="pb-2 font-medium text-right">Diff</th>
                  <th className="pb-2 font-medium">Streamers (platform side)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.product_id} className={`border-b border-vault-border/50 ${r.flagged ? 'bg-red-500/5' : ''}`}>
                    <td className="py-2.5 text-white">
                      {r.flagged && <AlertTriangle size={14} className="inline mr-1.5 -mt-0.5 text-red-400" />}
                      {r.product?.name || '(unknown product)'}
                      {r.product?.language && <span className="text-gray-500 ml-2 text-xs">[{r.product.language}]</span>}
                    </td>
                    <td className="py-2.5 text-right text-white font-medium">{r.platform_qty.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-white font-medium">{r.system_qty.toLocaleString()}</td>
                    <td className={`py-2.5 text-right font-bold ${
                      r.diff === 0 ? 'text-green-400'
                        : r.flagged ? 'text-red-400'
                          : r.diff > 0 ? 'text-yellow-400' : 'text-blue-400'
                    }`}>
                      {r.diff > 0 ? '+' : ''}{r.diff.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-xs text-gray-400">
                      {r.streamers.length === 0 ? '—' :
                        r.streamers.map(([name, v]) => `${name}: ${v.qty}`).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Streamer summary */}
      {byStreamer.length > 0 && (
        <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
          <h3 className="font-semibold text-white mb-3">Platform sales by streamer</h3>
          <div className="space-y-2">
            {byStreamer.map(s => (
              <div key={s.name} className="flex justify-between items-center text-sm border-b border-vault-border/50 last:border-b-0 pb-2 last:pb-0">
                <span className="text-white font-medium">{s.name}</span>
                <span className="text-gray-300">
                  <span className="text-white font-bold">{s.qty.toLocaleString()}</span> units
                  <span className="text-gray-500 ml-2">· {fmt(s.cost)} at cost</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
