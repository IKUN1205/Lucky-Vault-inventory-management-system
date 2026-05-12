import { useState, useEffect, useMemo } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ShieldCheck,
  ExternalLink,
  Upload,
  FileSpreadsheet,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Calendar,
  ChevronRight,
} from 'lucide-react'

// ============================================================================
// Per-Stream Reconcile page
// ============================================================================
// Lightweight, single-stream version of /audit. Triggered right after a
// stream count is submitted at a stream-room location. The user uploads
// the TikTok LIVE-session orders CSV (or skips), we compute the diff
// against the count, and optionally push a summary to the per-room Lark
// group so the streamer + manager see it immediately.
//
// URL: /reconcile?count_id=<stream_counts.id>

const PLATFORM = 'packheads'
const THRESHOLD = 5  // products with |diff| ≥ THRESHOLD show up in Lark

// TikTok column indexes (same as Audit.jsx — keep in sync if TikTok export changes)
const COL_ORDER_ID = 0
const COL_STATUS   = 1
const COL_PRODUCT  = 7
const COL_QTY      = 10
const COL_CREATED  = 27

// ----- CSV parsing -------------------------------------------------------

function parseCSV(text) {
  const rows = []; let cur = []; let field = ''; let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++ } else { inQuotes = false } }
      else { field += c }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else if (c === '\r') {}
      else field += c
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur) }
  return rows
}

// Parse "05/07/2026 9:07:33 PM" into a Date in browser-local time. Returns
// null if unparseable. Used to filter CSV rows by the stream's time window.
function parseTikTokDateTime(s) {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)/i)
  if (!m) return null
  let hour = parseInt(m[4], 10)
  if (m[7].toUpperCase() === 'PM' && hour < 12) hour += 12
  if (m[7].toUpperCase() === 'AM' && hour === 12) hour = 0
  return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10),
    hour, parseInt(m[5], 10), parseInt(m[6], 10))
}

// ----- Main component ----------------------------------------------------

export default function Reconcile() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const countId = params.get('count_id')

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)
  const [streamCount, setStreamCount] = useState(null)  // the just-saved count row
  const [roomLocation, setRoomLocation] = useState(null) // its location row
  const [streamerName, setStreamerName] = useState(null)
  const [prevCount, setPrevCount] = useState(null)       // previous count at same room (start of window)
  const [countItems, setCountItems] = useState([])       // [{product_id, product_name, expected, actual, diff}]
  const [mappings, setMappings] = useState({})           // external_name -> product_id

  // CSV state
  const [file, setFile] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [tiktokRows, setTiktokRows] = useState([])       // [{external_name, qty, created, dt}]
  const [tiktokSource, setTiktokSource] = useState(null) // 'csv' | 'auto' — how rows were obtained
  // Auto-fetch (Vercel + Chromium harvester) state
  const [autoFetching, setAutoFetching] = useState(false)
  const [autoFetchResult, setAutoFetchResult] = useState(null) // { ok, message, ordersObserved, dataCoversFromDate, totalMs }
  const [filterByWindow, setFilterByWindow] = useState(true)  // if true, drop rows outside [prevTime, countTime]

  // Lark state
  const [sendingLark, setSendingLark] = useState(false)
  const [larkResult, setLarkResult] = useState(null)

  useEffect(() => {
    if (!countId) {
      setPageError('Missing count_id in URL.')
      setLoading(false)
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countId])

  const load = async () => {
    try {
      setLoading(true)
      setPageError(null)

      // 1. Fetch the stream count and its items
      const { data: sc, error: scErr } = await supabase
        .from('stream_counts')
        .select('id, location_id, streamer_id, counted_by_id, count_time, total_sold, total_discrepancies, status')
        .eq('id', countId)
        .single()
      if (scErr) throw scErr
      setStreamCount(sc)

      const [locRes, itemsRes, streamerRes] = await Promise.all([
        supabase.from('locations').select('id, name').eq('id', sc.location_id).single(),
        supabase.from('stream_count_items')
          .select('product_id, expected_qty, actual_qty, product:products(name, language)')
          .eq('stream_count_id', sc.id),
        sc.streamer_id
          ? supabase.from('users').select('id, name').eq('id', sc.streamer_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (locRes.error) throw locRes.error
      if (itemsRes.error) throw itemsRes.error
      setRoomLocation(locRes.data)
      setStreamerName(streamerRes.data?.name || null)
      setCountItems(itemsRes.data || [])

      // 2. Previous count at same location — defines the time-window start
      const { data: prev } = await supabase
        .from('stream_counts')
        .select('id, count_time')
        .eq('location_id', sc.location_id)
        .eq('deleted', false)
        .lt('count_time', sc.count_time)
        .order('count_time', { ascending: false })
        .limit(1)
        .maybeSingle()
      setPrevCount(prev || null)

      // 3. Existing TikTok product mappings (so we don't re-prompt user)
      const { data: maps } = await supabase
        .from('platform_product_mappings')
        .select('external_name, product_id, ignore')
        .eq('platform', PLATFORM)
      const mp = {}
      for (const m of maps || []) {
        if (!m.ignore && m.product_id) mp[m.external_name] = m.product_id
      }
      setMappings(mp)
    } catch (err) {
      console.error(err)
      setPageError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  // Parse the dropped CSV. Optionally filter by time window between prev and
  // this count, so a CSV containing the full day still yields just this
  // session's orders.
  const handleCsvUpload = async (f) => {
    setFile(f)
    setParseError(null)
    setAutoFetchResult(null)  // clear any prior auto-fetch state — user pivoting to CSV
    if (!f) { setTiktokRows([]); setTiktokSource(null); return }
    try {
      const text = await f.text()
      const rows = parseCSV(text)
      const headerCell0 = (rows[0]?.[0] || '').replace(/﻿/g, '').trim().toLowerCase()
      if (!headerCell0.startsWith('order id')) {
        setParseError(`Doesn't look like a TikTok orders CSV (column 1 of row 1 = "${headerCell0}").`)
        return
      }
      const dataRows = rows.slice(1)
      const out = []
      const skipped = { canceled: 0, badDate: 0, outOfWindow: 0 }
      const windowStart = prevCount ? new Date(prevCount.count_time) : null
      const windowEnd = streamCount ? new Date(streamCount.count_time) : null
      for (const r of dataRows) {
        const status = (r[COL_STATUS] || '').trim()
        const product = (r[COL_PRODUCT] || '').trim()
        const qty = parseInt((r[COL_QTY] || '0').trim(), 10) || 0
        const createdStr = (r[COL_CREATED] || '').trim()
        if (!product) continue
        if (status === 'Canceled') { skipped.canceled++; continue }
        if (qty <= 0) continue
        const dt = parseTikTokDateTime(createdStr)
        if (!dt) { skipped.badDate++; continue }
        if (filterByWindow && windowStart && dt < windowStart) { skipped.outOfWindow++; continue }
        if (filterByWindow && windowEnd && dt > windowEnd) { skipped.outOfWindow++; continue }
        out.push({ external_name: product, qty, created: createdStr, dt })
      }
      setTiktokRows(out)
      setTiktokSource('csv')
    } catch (err) {
      console.error(err)
      setParseError(err.message || 'Failed to parse CSV')
    }
  }

  // ---- Build the reconciliation rows ----
  const reconciliation = useMemo(() => {
    if (!countItems.length) return null
    // Aggregate TikTok side by mapped product_id
    const tiktokByProduct = new Map()      // product_id -> qty
    const unmappedTiktok = new Map()       // external_name -> qty
    for (const r of tiktokRows) {
      const pid = mappings[r.external_name]
      if (pid) {
        tiktokByProduct.set(pid, (tiktokByProduct.get(pid) || 0) + r.qty)
      } else {
        unmappedTiktok.set(r.external_name, (unmappedTiktok.get(r.external_name) || 0) + r.qty)
      }
    }

    // Aggregate count side
    const countByProduct = new Map()       // product_id -> { name, language, count_net }
    for (const it of countItems) {
      const delta = (it.expected_qty || 0) - (it.actual_qty || 0)
      countByProduct.set(it.product_id, {
        name: it.product?.name || 'Unknown',
        language: it.product?.language || '',
        count_net: delta,  // positive = sold/missing, negative = found extra
      })
    }

    // Merge — any product that's on either side
    const allPids = new Set([...countByProduct.keys(), ...tiktokByProduct.keys()])
    const rows = []
    let totalPlatform = 0
    let totalSystem = 0
    for (const pid of allPids) {
      const c = countByProduct.get(pid) || { name: '(not in count)', language: '', count_net: 0 }
      const platform = tiktokByProduct.get(pid) || 0
      const system = c.count_net
      const diff = platform - system
      totalPlatform += platform
      totalSystem += system
      rows.push({
        product_id: pid,
        product: c.name,
        language: c.language,
        platform,
        system,
        diff,
        flagged: Math.abs(diff) >= THRESHOLD,
        inCount: countByProduct.has(pid),
      })
    }
    // Sort: flagged + negative diff first (theft signal), then flagged + positive,
    // then unflagged by abs(diff).
    rows.sort((a, b) => {
      const bucket = (r) => !r.flagged ? 2 : (r.diff < 0 ? 0 : 1)
      const ba = bucket(a), bb = bucket(b)
      if (ba !== bb) return ba - bb
      return Math.abs(b.diff) - Math.abs(a.diff)
    })
    return {
      rows,
      totalPlatform,
      totalSystem,
      totalDiff: totalPlatform - totalSystem,
      flaggedCount: rows.filter(r => r.flagged).length,
      unmappedTiktok: Array.from(unmappedTiktok.entries()).map(([name, qty]) => ({ name, qty })),
    }
  }, [countItems, tiktokRows, mappings])

  // ---- Send to Lark ----
  const sendToLark = async () => {
    if (!reconciliation || !roomLocation) return
    setSendingLark(true)
    setLarkResult(null)
    try {
      const flaggedRows = reconciliation.rows
        .filter(r => r.flagged)
        .map(r => ({ product: r.product, platform: r.platform, system: r.system, diff: r.diff }))
      const fromStr = prevCount ? new Date(prevCount.count_time).toLocaleString() : 'first count of period'
      const toStr = streamCount ? new Date(streamCount.count_time).toLocaleString() : '?'
      const res = await fetch('/api/lark-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reconciliation',
          roomName: roomLocation.name,
          streamerName,
          sessionLabel: file?.name || null,
          windowFrom: fromStr,
          windowTo: toStr,
          totalPlatform: reconciliation.totalPlatform,
          totalSystem: reconciliation.totalSystem,
          totalDiff: reconciliation.totalDiff,
          flaggedRows,
          unmappedCount: reconciliation.unmappedTiktok.length,
          threshold: THRESHOLD,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Lark send failed')
      setLarkResult({ ok: true, target: data.target })
    } catch (err) {
      console.error(err)
      setLarkResult({ ok: false, error: err.message || String(err) })
    } finally {
      setSendingLark(false)
    }
  }

  const openTikTok = () => {
    // TikTok Seller Center order page. User filters by LIVE session inside
    // TikTok's UI — we don't try to deep-link a specific session since the
    // URL params aren't publicly documented and would break easily.
    window.open('https://seller-us.tiktok.com/order?selected_sort=6&tab=all', '_blank')
  }

  // Auto-fetch path: call our /api/tiktok-fetch-orders endpoint which
  // launches headless Chromium server-side, navigates to TikTok's order
  // page, harvests the orders TikTok's own JS fetches, and returns
  // pre-normalised SKU lines. The user doesn't have to touch TikTok at all.
  //
  // Reuses the same time window the page already computed from the
  // previous + current stream count. live_only=true so we only pull
  // orders tagged "LIVE: <creator>" — those are the ones that came
  // through the actual stream session.
  const handleAutoFetch = async () => {
    if (!streamCount) return
    setAutoFetching(true)
    setAutoFetchResult(null)
    setParseError(null)
    try {
      // Convert the window to YYYY-MM-DD for the API. Use the same date
      // range as the count's session window — the API also filters
      // server-side, but using the date bounds keeps the response small.
      const fromDate = prevCount?.count_time
        ? new Date(prevCount.count_time)
        : new Date(new Date(streamCount.count_time).getTime() - 36 * 60 * 60 * 1000) // 36h fallback
      const toDate = new Date(streamCount.count_time)
      const fmt = (d) => d.toISOString().slice(0, 10)
      const params = new URLSearchParams({
        from: fmt(fromDate),
        to: fmt(toDate),
        live_only: 'true',
      })
      const res = await fetch(`/api/tiktok-fetch-orders?${params.toString()}`)
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }

      // Transform API lines → tiktokRows shape (matches the CSV parser).
      // Then re-apply the per-second time-window filter so we only keep
      // rows that fell inside [prevCount.count_time, streamCount.count_time]
      // — the API filters by DATE which is coarser.
      const windowStart = prevCount ? new Date(prevCount.count_time) : null
      const windowEnd = new Date(streamCount.count_time)
      const rows = (data.lines || [])
        .map(l => ({
          external_name: l.product_name,
          qty: l.quantity,
          created: l.create_time,
          dt: l.create_unix ? new Date(l.create_unix * 1000) : null,
        }))
        .filter(r => {
          if (!filterByWindow) return true
          if (!r.dt) return false
          if (windowStart && r.dt < windowStart) return false
          if (windowEnd && r.dt > windowEnd) return false
          return true
        })

      setTiktokRows(rows)
      setTiktokSource('auto')
      setFile(null) // clear any prior CSV state so the UI is clean
      setAutoFetchResult({
        ok: true,
        message: `Fetched ${rows.length} LIVE order line${rows.length === 1 ? '' : 's'} from TikTok.`,
        ordersObserved: data.orders_observed,
        dataCoversFromDate: data.data_covers_from_date,
        totalMs: data.total_ms,
      })
    } catch (err) {
      console.error(err)
      setAutoFetchResult({ ok: false, error: err.message || String(err) })
    } finally {
      setAutoFetching(false)
    }
  }

  // ---- Render ----
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"></div></div>
  }
  if (pageError) {
    return (
      <div className="space-y-4">
        <Link to="/stream-counts" className="text-vault-gold text-sm flex items-center gap-1 hover:underline">
          <ArrowLeft size={14} /> Back to Stream Counts
        </Link>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-red-300">
          {pageError}
        </div>
      </div>
    )
  }

  const windowFromStr = prevCount ? new Date(prevCount.count_time).toLocaleString() : '(no previous count)'
  const windowToStr = streamCount ? new Date(streamCount.count_time).toLocaleString() : '?'

  return (
    <div className="fade-in space-y-6">
      <Link to="/stream-counts" className="text-vault-gold text-sm flex items-center gap-1 hover:underline">
        <ArrowLeft size={14} /> Back to Stream Counts
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <ShieldCheck className="text-vault-gold" />
          Reconcile Last Stream
        </h1>
        <p className="text-gray-400 mt-1">
          Compare this count's outflow against TikTok LIVE-session orders, then push the diff to the room group.
        </p>
      </div>

      {/* Session context */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-vault-gold" />
          <h2 className="font-semibold text-white">Session context</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-gray-500 text-xs">Room</div>
            <div className="text-white">{roomLocation?.name || 'Unknown'}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Streamer (previous session)</div>
            <div className="text-white">{streamerName || '—'}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Window from (previous count)</div>
            <div className="text-white">{windowFromStr}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Window to (this count)</div>
            <div className="text-white">{windowToStr}</div>
          </div>
        </div>
      </div>

      {/* Step 1: Auto-fetch from TikTok (preferred) */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-xs">1</span>
            <h2 className="font-semibold text-white">Fetch TikTok orders</h2>
          </div>
          <span className="text-xs text-gray-500">{prevCount ? `Window: ${windowFromStr} → ${windowToStr}` : 'No previous count — using ~36h window'}</span>
        </div>
        <p className="text-gray-400 text-sm mb-3">
          One click — Lucky Vault opens TikTok Seller Center in the background, pulls the LIVE-tagged orders in this session's time window, and drops them right into the reconcile table. Takes ~25-35 seconds.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleAutoFetch}
            disabled={autoFetching}
            className="px-5 py-2.5 bg-vault-gold text-vault-dark font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {autoFetching ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {autoFetching ? 'Fetching from TikTok... (~30s)' : 'Auto-fetch from TikTok'}
          </button>
          <span className="text-xs text-gray-600">
            or <button onClick={openTikTok} className="text-vault-gold hover:underline">open TikTok manually</button> to export a CSV
          </span>
        </div>
        {autoFetchResult && (
          <div
            className={`mt-3 rounded-lg p-3 text-sm ${
              autoFetchResult.ok
                ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                : 'bg-red-500/10 border border-red-500/30 text-red-300'
            }`}
          >
            {autoFetchResult.ok ? (
              <>
                ✓ {autoFetchResult.message}
                {' '}<span className="text-gray-400 text-xs">
                  (observed {autoFetchResult.ordersObserved} order{autoFetchResult.ordersObserved === 1 ? '' : 's'} in {Math.round((autoFetchResult.totalMs || 0) / 1000)}s)
                </span>
                {autoFetchResult.dataCoversFromDate === false && (
                  <div className="text-yellow-300 text-xs mt-1">
                    ⚠️ TikTok only auto-loaded the most recent ~20 orders. If your session had more, drop the CSV instead.
                  </div>
                )}
              </>
            ) : (
              <>❌ {autoFetchResult.error}</>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Manual CSV fallback */}
      <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-xs">2</span>
          <h2 className="font-semibold text-white">Or: drop CSV manually</h2>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Fallback if auto-fetch failed or you need orders beyond the most-recent ~20: export the CSV from TikTok yourself (Filter → LIVE session → ⬇️) and drop it here.
        </p>
        <label className="flex items-center gap-2 px-4 py-3 bg-vault-darker border border-vault-border rounded-lg cursor-pointer hover:border-vault-gold transition-colors">
          <Upload size={16} className="text-vault-gold" />
          <span className="text-sm text-gray-300 truncate">{file?.name || 'Click to choose or drag a CSV file...'}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleCsvUpload(e.target.files?.[0] || null)}
          />
        </label>
        <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={filterByWindow}
            onChange={(e) => {
              setFilterByWindow(e.target.checked)
              if (file) handleCsvUpload(file)
            }}
            className="accent-vault-gold"
          />
          <span>
            Only include orders between previous count and this count
            ({prevCount ? '✓ time-window filter on' : 'no previous count — filter off'})
          </span>
        </div>
        {parseError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
            {parseError}
          </div>
        )}
        {tiktokSource === 'csv' && file && tiktokRows.length > 0 && (
          <div className="mt-3 text-sm text-green-300">
            ✓ Parsed {tiktokRows.length} orders from CSV
          </div>
        )}
        {tiktokSource === 'auto' && tiktokRows.length > 0 && (
          <div className="mt-3 text-xs text-gray-500">
            Using {tiktokRows.length} orders from Auto-fetch above. Drop a CSV here to override.
          </div>
        )}
      </div>

      {/* Reconciliation result */}
      {reconciliation && tiktokRows.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SummaryCard label="TikTok units" value={reconciliation.totalPlatform} />
            <SummaryCard label="Count outflow" value={reconciliation.totalSystem} subtext="signed net" />
            <SummaryCard
              label="Diff"
              value={(reconciliation.totalDiff > 0 ? '+' : '') + reconciliation.totalDiff}
              colorClass={
                reconciliation.totalDiff === 0 ? 'text-green-400'
                  : Math.abs(reconciliation.totalDiff) >= THRESHOLD
                    ? (reconciliation.totalDiff > 0 ? 'text-yellow-400' : 'text-red-400')
                    : 'text-gray-200'
              }
              subtext="TikTok − count"
            />
            <SummaryCard
              label="Flagged products"
              value={reconciliation.flaggedCount}
              colorClass={reconciliation.flaggedCount > 0 ? 'text-red-400' : 'text-green-400'}
              subtext={`|diff| ≥ ${THRESHOLD}`}
            />
          </div>

          <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <ShieldCheck size={18} className="text-vault-gold" />
              Product-level diff
              <span className="text-xs text-gray-500 ml-1">({reconciliation.rows.length})</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs border-b border-vault-border">
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">TikTok qty</th>
                    <th className="pb-2 text-right">Count net</th>
                    <th className="pb-2 text-right">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.rows.map(r => {
                    const rowClass = !r.flagged ? ''
                      : r.diff < 0 ? 'bg-red-500/10'
                      : 'bg-yellow-500/5'
                    return (
                      <tr key={r.product_id} className={`border-b border-vault-border/50 ${rowClass}`}>
                        <td className="py-2 text-white">
                          {r.flagged && <AlertTriangle size={14} className={`inline mr-1.5 -mt-0.5 ${r.diff < 0 ? 'text-red-400' : 'text-yellow-400'}`} />}
                          {r.product}
                          {r.language && <span className="text-gray-500 ml-2 text-xs">[{r.language}]</span>}
                        </td>
                        <td className="py-2 text-right text-white">{r.platform.toLocaleString()}</td>
                        <td className="py-2 text-right text-white">{r.system > 0 ? '+' : ''}{r.system.toLocaleString()}</td>
                        <td className={`py-2 text-right font-bold ${
                          r.diff === 0 ? 'text-green-400'
                            : r.flagged && r.diff < 0 ? 'text-red-400'
                              : r.flagged ? 'text-yellow-400' : 'text-gray-300'
                        }`}>
                          {r.diff > 0 ? '+' : ''}{r.diff.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {reconciliation.unmappedTiktok.length > 0 && (
              <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-xs text-yellow-200">
                <div className="font-medium mb-1">
                  ⚠️ {reconciliation.unmappedTiktok.length} TikTok product{reconciliation.unmappedTiktok.length === 1 ? '' : 's'} not mapped to a system product:
                </div>
                <ul className="space-y-0.5 pl-4 list-disc">
                  {reconciliation.unmappedTiktok.slice(0, 5).map(u => (
                    <li key={u.name}>{u.name} ({u.qty})</li>
                  ))}
                  {reconciliation.unmappedTiktok.length > 5 && (
                    <li className="text-gray-500">...and {reconciliation.unmappedTiktok.length - 5} more</li>
                  )}
                </ul>
                <div className="mt-2 text-gray-400">
                  These don't count toward the diff. <Link to="/audit" className="text-vault-gold hover:underline">Open Sales Audit</Link> to map them.
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Send to Lark */}
          <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-vault-gold/20 text-vault-gold font-bold flex items-center justify-center text-xs">3</span>
                  Send to Lark
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Pushes the diff to the room group ({roomLocation?.name?.replace(/^Stream Room\s*-\s*/, '') || 'main'}).
                </p>
              </div>
              <button
                onClick={sendToLark}
                disabled={sendingLark || larkResult?.ok}
                className="px-5 py-2.5 bg-vault-gold text-vault-dark font-semibold rounded-lg hover:bg-vault-gold/90 disabled:opacity-50 transition-all flex items-center gap-2"
              >
                {sendingLark ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                {larkResult?.ok ? 'Sent ✓' : sendingLark ? 'Sending...' : 'Send to Lark'}
              </button>
            </div>
            {larkResult && (
              <div className={`mt-3 rounded-lg p-3 text-sm ${
                larkResult.ok ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                              : 'bg-red-500/10 border border-red-500/30 text-red-300'
              }`}>
                {larkResult.ok
                  ? `✓ Sent to ${larkResult.target === 'room' ? 'the room group' : 'main group'}`
                  : `❌ ${larkResult.error}`}
              </div>
            )}
          </div>
        </>
      )}

      {/* Skip / done button */}
      <div className="flex justify-end">
        <button
          onClick={() => navigate('/stream-counts')}
          className="px-4 py-2 text-gray-400 hover:text-white text-sm flex items-center gap-1"
        >
          Done <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, subtext, colorClass = 'text-white' }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtext && <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>}
    </div>
  )
}
