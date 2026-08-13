import React, { useState, useEffect } from 'react'
import {
  fetchLocations,
  fetchUsers,
  fetchInventoryForRoom,
  createStreamCount,
  createStreamCountItems,
  softDeleteStreamCount,
  createUser,
  updateInventory,
  fetchStreamCounts,
  fetchStreamCountItems,
  fetchOpenSurplus,
  fetchStockElsewhere
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { BrandChip, LangChip } from '../components/ProductChips'
import ProductThumb from '../components/ProductThumb'
import { 
  ClipboardList, 
  Play, 
  Save, 
  AlertTriangle, 
  CheckCircle, 
  Package,
  Clock,
  User,
  ChevronDown,
  ChevronUp,
  History
} from 'lucide-react'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// BrandChip + LangChip now live in ../components/ProductChips (shared with ViewInventory
// so the inventory list and the counting UI distinguish EN/JP/CN identically).

// `total_sold` is expected − actual, which is only a sales figure when
// `expected` was right. The report says so on screen and in Lark, but that
// qualifier used to live nowhere else: reopen the count tomorrow, or read
// `total_sold` from any report, and it is a bare number again that reads as
// measured fact.
//
// stream_count_items has no column to hold it (product_id, expected, actual,
// difference — that is the whole table) and there is no DDL path right now, so
// it goes into stream_counts.notes as a greppable marker, the same way
// RECOVERED_AT_COUNTER and COST_FLAGGED carry state the schema has no room
// for. Anything reading total_sold can find out what it is made of.
//
//   SOLD_MEASURE=unverified              — the surplus lookup failed outright
//   SOLD_MEASURE=at_least:<pid>,<pid>    — those SKUs' sold figures are floors
export const MAX_COUNT_NOTES = 1000
// A product_id is a 36-char uuid plus a comma, so the list has to be capped by
// COUNT and not by a trailing slice: slicing the whole string at 1000 cuts the
// 27th id in half and turns a machine-readable marker into a corrupt one.
const MAX_MARKED_IDS = 20

export const buildCountNotes = (freeText, items, carried, unknown) => {
  const marks = []
  if (unknown) {
    marks.push('SOLD_MEASURE=unverified (open-surplus lookup failed — sold figures not confirmed)')
  } else {
    const floors = items
      .filter(i => i.difference < 0 && carried?.[i.product_id])
      .map(i => i.product_id)
    if (floors.length) {
      const shown = floors.slice(0, MAX_MARKED_IDS)
      marks.push(`SOLD_MEASURE=at_least:${shown.join(',')}`
        + (floors.length > shown.length ? ` +${floors.length - shown.length}_more` : ''))
    }
  }
  const user = (freeText || '').trim()
  if (!marks.length) return user.slice(0, MAX_COUNT_NOTES) || null
  // Truncate the free text, never the marker: the marker is the part something
  // else has to parse.
  const marker = marks.join(' · ')
  const room = MAX_COUNT_NOTES - marker.length - 1
  const tail = room > 0 ? user.slice(0, room) : ''
  return [marker, tail].filter(Boolean).join('\n')
}

// Blind-count "is this box actually counted?" — the ONE predicate shared by the
// M/N progress display and the blank-row list in handleSubmitCount's confirm,
// so they can never disagree. Counts are stored as RAW input strings (see
// handleCountChange): a value counts only if it trims to a non-empty, finite,
// NON-NEGATIVE number. Blank/garbage boxes are ALLOWED (they record as 0 after
// the bilingual confirm — Gary 2026-07-03 incident decision); this predicate
// just decides what shows as "counted" vs "blank".
const isCounted = (v) => {
  if (v === null || v === undefined) return false
  const s = String(v).trim()
  if (s === '') return false
  const n = Number(s)
  return Number.isFinite(n) && n >= 0
}

// Stream room locations (filter for only these)
const STREAM_ROOM_NAMES = [
  'Stream Room - eBay LuckyVaultUS',
  'Stream Room - eBay SlabbiePatty',
  'Stream Room - TikTok RocketsHQ',
  'Stream Room - TikTok Packheads',
  'Stream Room - PokeCasino',
  'Stream Room - PokeAuctionHouse'
]

export default function StreamCounts() {
  const { toasts, addToast, removeToast } = useToast()
  
  // Data
  const [locations, setLocations] = useState([])
  const [users, setUsers] = useState([])
  const [inventory, setInventory] = useState([])
  const [recentCounts, setRecentCounts] = useState([])
  // Surplus this room was already carrying BEFORE this count, keyed by product.
  // Loaded with the room's inventory and deliberately never rendered on the
  // counting screen — the count is blind, and showing it would leak how far off
  // the books are. It is used only to qualify the sold figures afterwards.
  const [carriedSurplus, setCarriedSurplus] = useState({})
  // Set when the surplus lookup failed. Kept separate from an empty map:
  // "this room was carrying nothing" and "we could not find out" produce the
  // same {} and must not produce the same report.
  const [surplusUnknown, setSurplusUnknown] = useState(false)
  
  // UI State
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1) // 1 = select, 2 = count, 3 = report
  const [showHistory, setShowHistory] = useState(false)
  const [expandedReport, setExpandedReport] = useState(null)
  const [expandedReportItems, setExpandedReportItems] = useState([])
  
  // Form State.
  // count_date defaults to TODAY in the user's local timezone — using
  // toISOString() here would silently roll over to tomorrow once the
  // user is past UTC midnight (e.g. 5pm PDT = midnight UTC), and the
  // count_time below would be combined with the wrong date. We saw this
  // surface as "future-dated" counts in Audit History.
  const [form, setForm] = useState({
    location_id: '',
    streamer_id: '',
    counted_by_id: '',
    count_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    count_date: new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local time
  })
  
  // Count data - maps product_id to actual count
  const [counts, setCounts] = useState({})

  // Optional free-text notes from the counter — anomalies / extra items
  // physically in the room but NOT on the count list. Persisted on the
  // stream_count row for later LLM processing. Purely optional — never
  // affects whether a count can be submitted.
  const [countNotes, setCountNotes] = useState('')

  // For "Other" user option
  const [showNewStreamer, setShowNewStreamer] = useState(false)
  const [showNewCounter, setShowNewCounter] = useState(false)
  const [newStreamerName, setNewStreamerName] = useState('')
  const [newCounterName, setNewCounterName] = useState('')
  
  // Report data
  const [report, setReport] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [locData, userData, countsData] = await Promise.all([
        fetchLocations('Physical'),
        fetchUsers(),
        fetchStreamCounts(null, null, null)
      ])
      
      // Filter to only stream rooms
      const streamRooms = locData.filter(l => 
        STREAM_ROOM_NAMES.some(name => 
          l.name.toLowerCase() === name.toLowerCase()
        )
      )
      setLocations(streamRooms)
      setUsers(userData)
      setRecentCounts(countsData.slice(0, 10)) // Last 10 counts
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryForLocation = async (locationId) => {
    try {
      const invData = await fetchInventoryForRoom(locationId)
      // Count-sheet ordering (Gary 2026-07-05, streamer feedback): rooms like TikTok carry a
      // long tail of inventory that hasn't moved in weeks, and re-counting it top-of-list every
      // session is painful. Put RECENTLY ACTIVE rows first (last_updated within 7 days = fresh
      // restocks + items that sold recently), then everything by inventory VALUE descending
      // (qty x market/cost) so the money sits at the top of each group. This exposes no system
      // quantities — the count stays blind; it only changes ROW ORDER.
      const FRESH_MS = 7 * 24 * 3600 * 1000
      const decorated = invData.map(inv => ({
        ...inv,
        _fresh: Boolean(inv.last_updated && (Date.now() - new Date(inv.last_updated).getTime()) < FRESH_MS),
        _value: (Number(inv.quantity) || 0) *
                (Number(inv.current_market_price) || Number(inv.avg_cost_basis) || 0),
      })).sort((a, b) =>
        (Number(b._fresh) - Number(a._fresh)) ||
        (b._value - a._value) ||
        (a.product?.name || '').localeCompare(b.product?.name || ''))
      setInventory(decorated)
      
      // Blind count: initialize every product's count to blank ('') so the
      // streamer never sees the system's expected quantity — they must type
      // what they physically count. Do NOT pre-fill with inv.quantity.
      const initialCounts = {}
      invData.forEach(inv => {
        initialCounts[inv.product_id] = ''
      })
      setCounts(initialCounts)
      setCountNotes('') // fresh notes for each new count session

      // What this room was already counting above the books. Best-effort: a
      // failure here must never block a count, it only costs us the qualifier
      // on the sold numbers.
      try {
        const open = await fetchOpenSurplus(locationId)
        const map = {}
        open.forEach(o => { map[o.product_id] = o })
        setCarriedSurplus(map)
        setSurplusUnknown(false)
      } catch (surplusErr) {
        // Never blocks the count — but it must not be silently downgraded to
        // "no surplus" either. Falling back to {} marked every sold figure
        // `exact`, i.e. a failed lookup manufactured certainty about numbers
        // it knew nothing about. Unknown is its own answer.
        console.warn('[open-surplus] lookup failed — sold figures will be reported as unverified:', surplusErr)
        setCarriedSurplus({})
        setSurplusUnknown(true)
      }
    } catch (error) {
      console.error('Error loading inventory:', error)
      addToast('Failed to load inventory', 'error')
    }
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    
    // Handle "other" selection
    if (name === 'streamer_id' && value === 'other') {
      setShowNewStreamer(true)
    } else if (name === 'streamer_id') {
      setShowNewStreamer(false)
    }
    
    if (name === 'counted_by_id' && value === 'other') {
      setShowNewCounter(true)
    } else if (name === 'counted_by_id') {
      setShowNewCounter(false)
    }
  }

  const handleCountChange = (productId, value) => {
    // Store the RAW input string — no parseInt here. The old `parseInt(value)
    // || 0` silently turned any unparsable input into a 0 count, which on a
    // blind count records a fake "sold out". Validation lives in isCounted()
    // (gate + progress); the submit path coerces with Number() at write time.
    setCounts(c => ({
      ...c,
      [productId]: value
    }))
  }

  const handleStartCount = async () => {
    // Validate form
    if (!form.location_id) {
      addToast('Please select a stream room', 'error')
      return
    }
    
    // Handle new streamer
    let streamerId = form.streamer_id
    if (showNewStreamer && newStreamerName.trim()) {
      try {
        const newUser = await createUser(newStreamerName.trim())
        streamerId = newUser.id
        setUsers(u => [...u, newUser])
      } catch (error) {
        addToast('Failed to create new user', 'error')
        return
      }
    }
    
    if (!streamerId || streamerId === 'other') {
      addToast('Please select or enter a streamer name', 'error')
      return
    }
    
    // Handle new counter
    let counterId = form.counted_by_id
    if (showNewCounter && newCounterName.trim()) {
      try {
        const existing = users.find(u => u.name.toLowerCase() === newCounterName.trim().toLowerCase())
        if (existing) {
          counterId = existing.id
        } else {
          const newUser = await createUser(newCounterName.trim())
          counterId = newUser.id
          setUsers(u => [...u, newUser])
        }
      } catch (error) {
        addToast('Failed to create new user', 'error')
        return
      }
    }
    
    if (!counterId || counterId === 'other') {
      addToast('Please select or enter who is counting', 'error')
      return
    }
    
    // Update form with resolved IDs
    setForm(f => ({ ...f, streamer_id: streamerId, counted_by_id: counterId }))
    
    // Load inventory for the selected room
    await loadInventoryForLocation(form.location_id)
    
    setStep(2)
  }

  const handleSubmitCount = async () => {
    // ---- Blank = 0 (Gary 2026-07-03, incident decision) ----
    // The original hard gate (every box mandatory) locked streamers out —
    // 25-box rooms + old muscle memory of the prefilled flow meant nobody
    // could submit ("tried 3 times and it doesn't record"). New rule per
    // Gary: a blank box means 0 (sold out). Still blind — no expected values
    // are revealed — but before writing, list the blank rows in a bilingual
    // confirm so an OVERLOOKED row (still on the shelf, just missed) doesn't
    // silently zero its inventory and inflate the streamer's sales.
    const blanks = inventory.filter(inv => !isCounted(counts[inv.product_id]))
    // ---- All-blank hard stop (2026-07-06 incident) ----
    // A sheet with EVERY box blank is never a real count — it's a failed
    // input session (William's browser dropped all keystrokes; the blank=0
    // confirm then recorded the whole room as sold out and zeroed its
    // inventory, which had to be retracted). blank=0 stays for partial
    // sheets; a 100%-blank submit is refused outright.
    if (inventory.length > 0 && blanks.length === inventory.length) {
      addToast('一格都没填 — 无法提交。如果输入框打不进字,刷新页面或重启浏览器再试。 / Every box is blank — nothing to submit. If typing does nothing, refresh the page or restart the browser and try again.', 'error')
      return
    }
    if (blanks.length > 0) {
      const names = blanks.slice(0, 8)
        .map(inv => extractLaunchName(inv.product?.name, inv.product?.category) || 'Unknown')
        .join('\n  · ')
      const more = blanks.length > 8 ? `\n  · …+${blanks.length - 8} more` : ''
      const proceed = confirm(
        `${blanks.length} 个产品没填数，提交后按 0（全部卖完）记录：\n  · ${names}${more}\n\n` +
        `${blanks.length} product(s) left blank — they will be recorded as 0 (sold out).\n\n` +
        `没货 → 按 OK 提交；架上还有 → 按 Cancel 返回补数。\n` +
        `Gone? press OK. Still on the shelf? press Cancel and count them.`
      )
      if (!proceed) return
    }

    // ---- Stale-room guard (L3) ----
    // If this room hasn't been counted in a long time, ANOTHER streamer
    // may have gone live in the gap and skipped counting. This count
    // would silently absorb that prior session — combined totals can
    // still pass audit but per-streamer attribution is meaningless.
    // L1 detects this server-side (merged_session_count), L2 alerts
    // proactively via cron — L3 is the last-line soft signal at submit
    // time. NEVER block; just confirm. Threshold tuned to typical
    // overnight gap (sessions are usually 12-18h apart) — 18h means
    // most legit counts skip the dialog entirely, only suspiciously
    // long gaps trigger it.
    const STALE_THRESHOLD_HOURS = 18
    try {
      const lastAtRoom = recentCounts
        .filter(c => c.location_id === form.location_id)
        .sort((a, b) => new Date(b.count_time) - new Date(a.count_time))[0]
      if (lastAtRoom?.count_time) {
        const hoursAgo = (Date.now() - new Date(lastAtRoom.count_time).getTime()) / 3600000
        if (hoursAgo > STALE_THRESHOLD_HOURS) {
          const proceed = confirm(
            `⚠️ This room hasn't been counted in ${Math.round(hoursAgo)} hours.\n\n` +
            `If another streamer went live during this window without counting, this submission will merge multiple stream sessions and the audit won't be able to tell sales apart by streamer.\n\n` +
            `Click OK to submit anyway, or Cancel to double-check with the team first.`
          )
          if (!proceed) return  // user cancelled — don't even setSubmitting
        }
      }
    } catch (err) {
      // Guard is best-effort; never let it block a submit on its own bug.
      console.warn('[stale-room guard] failed, proceeding without prompt:', err)
    }

    setSubmitting(true)

    try {
      // Build count time from date and time inputs
      // Get local timezone offset and append it so Postgres doesn't convert to UTC
      const localDate = new Date(`${form.count_date}T${form.count_time}:00`)
      const tzOffset = -localDate.getTimezoneOffset()
      const tzHours = Math.floor(Math.abs(tzOffset) / 60).toString().padStart(2, '0')
      const tzMins = (Math.abs(tzOffset) % 60).toString().padStart(2, '0')
      const tzSign = tzOffset >= 0 ? '+' : '-'
      const countTimeString = `${form.count_date}T${form.count_time}:00${tzSign}${tzHours}:${tzMins}`
      
      // Calculate totals and build items
      let totalSold = 0
      let totalDiscrepancies = 0
      const items = []
      
      inventory.forEach(inv => {
        const expected = Math.floor(Number(inv.quantity)) || 0
        // Blank = 0 (Gary 2026-07-03): an empty / non-numeric box records 0 —
        // sold out. The bilingual confirm above already listed every blank row
        // and the streamer OK'd it, so this is deliberate, not an accident.
        // (History: blank used to coerce to `expected` as a crash guard against
        // writing '' into the integer actual_qty column — that would silently
        // count a missed row as "unchanged", the lazy path the blind count
        // exists to kill. 0 keeps the column integer-safe AND honest.)
        const raw = counts[inv.product_id]
        const n = Number(String(raw ?? '').trim())
        // Clamp to a sane physical ceiling (Codex: Number('1e20') is finite and
        // would overflow the Postgres integer actual_qty). A fat-fingered huge
        // value becomes 100000 -> shows up as a giant +discrepancy the manager
        // reviews, instead of a DB error or a silent zero.
        const actual = (raw === '' || raw === null || raw === undefined || !Number.isFinite(n))
          ? 0
          : Math.min(Math.max(0, Math.floor(n)), 100000)
        const diff = actual - expected

        if (diff < 0) {
          totalSold += Math.abs(diff)
        } else if (diff > 0) {
          totalDiscrepancies += diff
        }

        items.push({
          product_id: inv.product_id,
          expected_qty: expected,
          actual_qty: actual,
          difference: diff
        })
      })
      
      // Create stream count record
      const streamCount = await createStreamCount({
        location_id: form.location_id,
        streamer_id: form.streamer_id,
        counted_by_id: form.counted_by_id,
        count_time: countTimeString,
        status: totalDiscrepancies > 0 ? 'has_discrepancies' : 'complete',
        total_sold: totalSold,
        total_discrepancies: totalDiscrepancies,
        // Optional free-text anomaly notes (extra items in the room, damage,
        // etc.) for later LLM processing. The `notes` column already exists on
        // stream_counts; createStreamCount inserts the object as-is. Capped at
        // 1000 chars (matches the textarea maxLength) so a stray giant paste
        // can't bloat rows or the Lark webhook (Codex 2026-07-01).
        notes: buildCountNotes(countNotes, items, carriedSurplus, surplusUnknown)
      })
      
      // Add stream_count_id to items and insert. If the items insert fails, roll
      // back the header we just created so we don't leave an ORPHAN stream_count
      // (a header with 0 items + no inventory change that still inflates report
      // totals). 2026-06-30: 6 such orphans were created by a blank-count retry.
      const itemsWithId = items.map(item => ({
        ...item,
        stream_count_id: streamCount.id
      }))
      try {
        await createStreamCountItems(itemsWithId)
      } catch (itemsErr) {
        try { await softDeleteStreamCount(streamCount.id) } catch (cleanupErr) {
          console.error('[stream-count] orphan cleanup failed:', cleanupErr)
        }
        throw itemsErr
      }
      
      // Update inventory for each changed item.
      //
      // POLICY (Gary 2026-07-14 "先转库才可以有库存"): a stream count may only
      // DECREMENT room inventory (sales / shrink). It must NOT create inventory
      // upward. Stock only enters a room via a recorded transfer (Move
      // Inventory), which decrements the source location. Silently absorbing a
      // "+extra" here was the ROOT CAUSE of the dual-location double-count: the
      // room quantity went up but the source (e.g. Master) was never
      // decremented, so the same units were counted twice and the total
      // inflated over time. Positive diffs are still recorded in
      // stream_count_items (audit) + surfaced in the report/Lark as
      // "needs transfer-in", but they no longer touch inventory.
      const appliedDeltas = []  // for undo (only downward deltas are applied)
      for (const item of items) {
        if (item.difference < 0) {
          await updateInventory(
            item.product_id,
            form.location_id,
            item.difference // sale / shrink — decrement only
          )
          appliedDeltas.push({ product_id: item.product_id, delta: item.difference })
        }
        // item.difference > 0 (found beyond system): intentionally NOT applied.
        // A count cannot conjure inventory — these must be transferred in via
        // Move Inventory (source → this room). Surfaced as a TODO below.
      }

      // Build report
      // Qualify every sold figure by how trustworthy the expected it came from
      // was. `sold` is expected - actual, so it is only a fact when expected was
      // a fact. A SKU the room was ALREADY counting above the books had a wrong
      // expected, and the surplus can hide an arbitrary amount of real selling
      // underneath it — reporting a bare number there is how 42 OP-13 blisters
      // left Packheads booked as zero sales (2026-08-05).
      const soldItems = items
        .filter(i => i.difference < 0)
        .map(i => {
          const inv = inventory.find(inv => inv.product_id === i.product_id)
          return {
            product: inv?.product,
            expected: i.expected_qty,
            actual: i.actual_qty,
            sold: Math.abs(i.difference),
            // 'at_least': the books were already short, so this is a floor.
            // 'unverified': the lookup that decides between the two failed, so
            // we do not know which this is. Calling it 'exact' would be an
            // assertion made out of an outage.
            measure: surplusUnknown
              ? 'unverified'
              : (carriedSurplus[i.product_id] ? 'at_least' : 'exact')
          }
        })

      // Still above the books after this count. Sales for these SKUs are not
      // zero — they are UNKNOWN, and stay unknown until a Move accounts for the
      // surplus. `streak` says how many counts in a row have reported it, which
      // is what turns "new discrepancy" into "nobody has fixed this since X".
      // Where else the company holds these SKUs. A surplus the rest of the
      // system can cover is a filing error — a Move closes it and the total
      // never changes. One it cannot cover has no source at all, and no amount
      // of moving stock will produce it. Looked up here rather than at load
      // time because it is only needed for the handful that came up over, and
      // a SKU can go surplus for the first time in this very count.
      let elsewhereMap = null
      try {
        elsewhereMap = await fetchStockElsewhere(
          items.filter(i => i.difference > 0).map(i => i.product_id),
          form.location_id
        )
      } catch (elsewhereErr) {
        // Leave it null. Reporting "no source anywhere" because a query failed
        // would send people to recount a room over an outage.
        console.warn('[open-surplus] elsewhere lookup failed — surplus will be reported unclassified:', elsewhereErr)
      }

      const discrepancyItems = items
        .filter(i => i.difference > 0)
        .map(i => {
          const inv = inventory.find(inv => inv.product_id === i.product_id)
          const carried = carriedSurplus[i.product_id]
          const other = elsewhereMap ? (elsewhereMap.get(i.product_id) || { units: 0, sources: [] }) : null
          return {
            product: inv?.product,
            expected: i.expected_qty,
            actual: i.actual_qty,
            extra: i.difference,
            streak: (carried?.streak || 0) + 1,
            since: carried?.since || null,
            // null = we could not check, which is neither "fixable" nor "no source"
            elsewhere: other ? other.units : null,
            sources: other ? other.sources.slice(0, 3) : [],
            fixable: other ? other.units >= i.difference : null
          }
        })
      
      setReport({
        stream_count_id: streamCount.id,   // surface the saved ID so the
                                           // success screen can deep-link
                                           // into per-stream reconciliation
        location: locations.find(l => l.id === form.location_id)?.name,
        location_name: locations.find(l => l.id === form.location_id)?.name,
        streamer: users.find(u => u.id === form.streamer_id)?.name,
        counted_by: users.find(u => u.id === form.counted_by_id)?.name,
        count_time: localDate,
        total_sold: totalSold,
        total_discrepancies: totalDiscrepancies,
        sold_items: soldItems,
        discrepancy_items: discrepancyItems,
        note: countNotes.trim() || null,
        status: totalDiscrepancies > 0 ? 'has_discrepancies' : 'complete'
      })
      
      // Refresh recent counts
      const countsData = await fetchStreamCounts(null, null, null)
      setRecentCounts(countsData.slice(0, 10))
      
      const streamCountId = streamCount?.id
      const undoLocationId = form.location_id
      const undoRoomName = locations.find(l => l.id === form.location_id)?.name || 'Unknown room'
      const undoStreamerName = users.find(u => u.id === form.streamer_id)?.name || 'Unknown'
      const undoCountedByName = users.find(u => u.id === form.counted_by_id)?.name || 'Unknown'
      const undo = async () => {
        try {
          // Reverse every inventory delta we applied
          for (const d of appliedDeltas) {
            await updateInventory(d.product_id, undoLocationId, -d.delta)
          }
          // Soft-delete the count (set deleted=true). Hard-deleting was
          // the original cause of "Lark says X but DB has no row" — we
          // keep the row now so the audit trail matches the Lark
          // notification that already fired. fetchStreamCounts hides
          // deleted rows so Session History stays clean.
          if (streamCountId) {
            await softDeleteStreamCount(streamCountId)
          }
          addToast('Undone — stream count reverted, inventory restored', 'info')
          // Refresh recent counts list
          const data = await fetchStreamCounts(null, null, null)
          setRecentCounts(data.slice(0, 10))
          // Send user back to step 1 so they can redo
          setStep(1)

          // Fire-and-forget Lark "undone" follow-up. The original
          // stream_count Lark already went out by the time the Undo
          // toast appears — Lark doesn't support recall, so we send a
          // second message so the room group knows the prior numbers
          // are void. Same dual-target dispatch as the original.
          try {
            fetch('/api/lark-notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'stream_count_undone',
                roomName: undoRoomName,
                streamerName: undoStreamerName,
                countedByName: undoCountedByName,
              }),
            }).catch(err => console.error('[lark-notify] stream_count_undone request failed:', err))
          } catch (err) {
            console.error('[lark-notify] failed to build stream_count_undone payload:', err)
          }
        } catch (err) {
          console.error('Undo failed:', err)
          addToast('Undo failed — check console', 'error')
        }
      }

      addToast(
        `Count submitted! ${totalSold} items sold.`,
        'success',
        streamCountId ? { action: { label: 'Undo', onClick: undo } } : undefined
      )

      // Fire-and-forget Lark notification: brief to main group, detailed to
      // the room's group. Never block the UI on this; failures are logged but
      // never roll back the count.
      try {
        const roomName = locations.find(l => l.id === form.location_id)?.name || 'Unknown room'
        const streamerName = users.find(u => u.id === form.streamer_id)?.name || 'Unknown'
        const countedByName = users.find(u => u.id === form.counted_by_id)?.name || 'Unknown'

        const formatProductName = (p) => {
          if (!p) return 'Unknown product'
          // Strip the trailing category from the product name to get the launch
          // (matches the convention used in the rest of the app)
          const launch = p.category && p.name
            ? p.name.replace(new RegExp(`\\s*${p.category}\\s*$`, 'i'), '').trim() || p.name
            : p.name || ''
          return `${p.brand || '?'} | ${launch} | ${p.category || '?'} | ${p.language || '?'}`
        }

        const soldForLark = soldItems.map(i => ({
          name: formatProductName(i.product),
          quantity: i.sold,
          atLeast: i.measure === 'at_least',
          unverified: i.measure === 'unverified'
        }))
        const discrepancyForLark = discrepancyItems.map(i => ({
          name: formatProductName(i.product),
          extra: i.extra,
          streak: i.streak,
          since: i.since,
          fixable: i.fixable,
          elsewhere: i.elsewhere,
          sources: i.sources
        }))

        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'stream_count',
            roomName,
            streamerName,
            countedByName,
            totalSold,
            totalDiscrepancies,
            soldItems: soldForLark,
            discrepancyItems: discrepancyForLark,
            note: countNotes.trim().slice(0, 1000) || undefined
          })
        }).catch(err => console.error('[lark-notify] stream_count request failed:', err))
      } catch (err) {
        console.error('[lark-notify] failed to build stream_count payload:', err)
      }

      // Auto-reconcile — fire-and-forget. Only TikTok Packheads is wired
      // to the TikTok seller-center cookie + product mappings, so we gate
      // strictly on that one room. Other TikTok rooms (RocketsHQ, etc.)
      // would each need their own auth + mapping before they can be
      // reconciled, so don't even fire the request for them. The function
      // takes ~30s server-side; result shows up in /audit-history when
      // done, with failures persisted there as well.
      // Use sendBeacon when available so the request survives the user
      // closing the tab / navigating away immediately after submit. We saw
      // Yazi's 5/13 count never trigger reconciliation because the plain
      // fetch was cancelled by the browser before it reached Vercel.
      // sendBeacon is fire-and-forget by design and the browser guarantees
      // delivery even during unload — but it only supports POST + a Blob
      // body, so we don't get to inspect the response. The server still
      // writes a "running" row immediately so we can see the run started.
      // Fallback to fetch on older browsers (older Safari before iOS 13).
      try {
        const locName = locations.find(l => l.id === form.location_id)?.name || ''
        if (/TikTok\s*Packheads/i.test(locName)) {
          const url = '/api/auto-reconcile'
          const payload = JSON.stringify({
            count_id: streamCount.id,
            trigger: 'auto_after_count',
          })
          let sent = false
          if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            // Blob with explicit JSON mimetype so the API route's
            // express-style body parser still sees req.body as JSON.
            const blob = new Blob([payload], { type: 'application/json' })
            sent = navigator.sendBeacon(url, blob)
          }
          if (!sent) {
            // Best-effort fallback. keepalive: true asks the browser to
            // continue the request through page unload — same intent as
            // sendBeacon but on the fetch API.
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              keepalive: true,
            }).catch(err => console.error('[auto-reconcile] request failed:', err))
          }
          addToast('Auto-reconcile started — check Audit History in ~30 seconds.', 'info')
        }
      } catch (err) {
        console.error('[auto-reconcile] failed to fire:', err)
      }

      setStep(3)
    } catch (error) {
      console.error('Error submitting count:', error)
      addToast('Failed to submit count', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleNewCount = () => {
    setStep(1)
    setForm({
      location_id: '',
      streamer_id: '',
      counted_by_id: '',
      count_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      count_date: new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD
    })
    setCounts({})
    setCountNotes('')
    setReport(null)
    setShowNewStreamer(false)
    setShowNewCounter(false)
    setNewStreamerName('')
    setNewCounterName('')
  }

  const toggleReportExpand = async (countId) => {
    if (expandedReport === countId) {
      setExpandedReport(null)
      setExpandedReportItems([])
    } else {
      setExpandedReport(countId)
      try {
        const items = await fetchStreamCountItems(countId)
        setExpandedReportItems(items)
      } catch (error) {
        console.error('Error loading report items:', error)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    )
  }

  // Blind-count progress / submit gate.
  //   N (totalProducts)   = products in the selected room
  //   M (countedProducts) = products whose count box passes isCounted()
  //                         (trimmed, finite, >= 0 — an explicit 0 counts)
  // Submit stays disabled until M === N so no product is left blank and then
  // silently coerced to its expected quantity (which would hide a loss).
  const totalProducts = inventory.length
  const countedProducts = inventory.reduce(
    (n, inv) => n + (isCounted(counts[inv.product_id]) ? 1 : 0), 0)
  // (blank boxes are allowed — they record as 0 after a bilingual confirm; see
  // handleSubmitCount. Submit is no longer gated on countedProducts.)

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <ClipboardList className="text-vault-gold" />
            Stream Counts
          </h1>
          <p className="text-gray-400 mt-1">Count inventory before each stream to record what the previous session sold</p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Before you start streaming, count what's left in the room from the previous session:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select your <span className="text-vault-gold">Stream Room</span> from the dropdown</li>
            <li>Select <span className="text-vault-gold">Streamer</span> — <em className="text-gray-400 not-italic">the person who ran the PREVIOUS session (whose sales we're recording)</em></li>
            <li>Select <span className="text-vault-gold">Counted By</span> (you — the one doing the count right now)</li>
            <li>Click <span className="text-vault-gold">Start Count</span></li>
            <li>Physically count <span className="text-vault-gold">every product</span> in the room and type the quantity you see（数一下房间里每个产品，填看到的数量）</li>
            <li>Sold out = enter <span className="text-vault-gold">0</span> or leave it blank（卖完的填 0 或留空 — 空格按 0 记）</li>
            <li>Click <span className="text-vault-gold">Submit Count</span> — it will list any blank boxes and ask you to confirm（提交时会列出空格让你确认）</li>
          </ol>
          <div className="mt-4 p-3 bg-vault-surface rounded border border-vault-border">
            <p className="font-medium text-white mb-2">This is a blind count / 盲数：</p>
            <ul className="space-y-1">
              <li>You will <span className="text-white">not</span> see the system's expected numbers while counting — just enter what you physically count.（看不到系统数字，数到多少填多少）</li>
              <li>A <span className="text-vault-gold">blank</span> box is recorded as <span className="text-vault-gold">0 — sold out</span>. If the product is still on the shelf, you must count it.（空格=卖完；架上还有的必须填数）</li>
              <li>After you submit, the <span className="text-vault-gold">report</span> shows what sold and flags any discrepancies for the manager to review.（提交后报告显示卖了什么）</li>
            </ul>
          </div>
          <p className="text-amber-400 text-xs mt-3">⚠️ Count BEFORE your stream starts — do it as soon as you arrive at the room.</p>
        </div>
      </Instructions>

      {step !== 1 && (
        <div className="mb-4">
          <button onClick={handleNewCount} className="btn btn-secondary">
            New Count
          </button>
        </div>
      )}

      {/* Step 1: Select Room & People */}
      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-white mb-6">Start New Count</h2>
              
              {/* Stream Room */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Stream Room *
                </label>
                <select
                  name="location_id"
                  value={form.location_id}
                  onChange={handleFormChange}
                  required
                >
                  <option value="">Select stream room...</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Streamer (sales attributed to) */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Streamer (sales go to) *
                </label>
                <select
                  name="streamer_id"
                  value={showNewStreamer ? 'other' : form.streamer_id}
                  onChange={handleFormChange}
                  required
                >
                  <option value="">Select streamer...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                  <option value="other">+ Add New Streamer</option>
                </select>
                
                {showNewStreamer && (
                  <input
                    type="text"
                    value={newStreamerName}
                    onChange={(e) => setNewStreamerName(e.target.value)}
                    placeholder="Enter new streamer name..."
                    className="mt-2"
                    autoFocus
                  />
                )}
              </div>
              
              {/* Counted By */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Counted By *
                </label>
                <select
                  name="counted_by_id"
                  value={showNewCounter ? 'other' : form.counted_by_id}
                  onChange={handleFormChange}
                  required
                >
                  <option value="">Who is counting...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                  <option value="other">+ Add New Person</option>
                </select>
                
                {showNewCounter && (
                  <input
                    type="text"
                    value={newCounterName}
                    onChange={(e) => setNewCounterName(e.target.value)}
                    placeholder="Enter name..."
                    className="mt-2"
                    autoFocus
                  />
                )}
              </div>
              
              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Date *
                  </label>
                  <input
                    type="date"
                    name="count_date"
                    value={form.count_date}
                    onChange={handleFormChange}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Time *
                  </label>
                  <input
                    type="time"
                    name="count_time"
                    value={form.count_time}
                    onChange={handleFormChange}
                    required
                  />
                </div>
              </div>
              
              <button 
                onClick={handleStartCount}
                className="btn btn-primary w-full"
              >
                <Play size={20} />
                Start Count
              </button>
            </div>
          </div>
          
          {/* Recent Counts Sidebar */}
          <div>
            <div className="card">
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between text-left"
              >
                <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                  <History size={20} className="text-gray-400" />
                  Recent Counts
                </h3>
                {showHistory ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              
              {showHistory && (
                <div className="mt-4 space-y-3">
                  {recentCounts.length === 0 ? (
                    <p className="text-gray-500 text-sm">No counts yet</p>
                  ) : (
                    recentCounts.map(count => (
                      <div 
                        key={count.id} 
                        className="p-3 bg-vault-dark rounded-lg border border-vault-border cursor-pointer hover:border-vault-gold/30 transition-colors"
                        onClick={() => toggleReportExpand(count.id)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-medium text-white">
                              {count.location?.name?.replace('Stream Room - ', '')}
                            </p>
                            <p className="text-xs text-gray-400">
                              {count.streamer?.name} • {new Date(count.count_time).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-vault-gold">
                              {count.total_sold} sold
                            </p>
                            {count.total_discrepancies > 0 && (
                              <p className="text-xs text-amber-400">
                                +{count.total_discrepancies} discrepancy
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {expandedReport === count.id && (
                          <div className="mt-3 pt-3 border-t border-vault-border">
                            <p className="text-xs text-gray-400 mb-2">
                              Counted by: {count.counted_by?.name}
                            </p>
                            {expandedReportItems.filter(i => i.difference !== 0).length === 0 ? (
                              <p className="text-xs text-gray-500">No changes recorded</p>
                            ) : (
                              <div className="space-y-1">
                                {expandedReportItems
                                  .filter(i => i.difference !== 0)
                                  .map(item => (
                                    <div key={item.id} className="flex justify-between text-xs">
                                      <span className="text-gray-300 truncate mr-2">
                                        {item.product?.name}
                                      </span>
                                      <span className={item.difference < 0 ? 'text-green-400' : 'text-amber-400'}>
                                        {item.difference < 0 ? `${Math.abs(item.difference)} sold` : `+${item.difference}`}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Count Sheet */}
      {step === 2 && (
        <div className="card">
          <div className="mb-6 flex justify-between items-center">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                {locations.find(l => l.id === form.location_id)?.name}
              </h2>
              <p className="text-sm text-gray-400">
                Streamer: {users.find(u => u.id === form.streamer_id)?.name} • 
                Counting: {users.find(u => u.id === form.counted_by_id)?.name} • 
                {form.count_date} @ {form.count_time}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-400">{inventory.length} products</p>
            </div>
          </div>
          
          {/* Count-process note pinned above the sheet (Gary 2026-07-05: streamers panic when
              they see 0s / items they don't have — say loudly that blank/0 is normal). */}
          <div className="mb-4 p-3 rounded border border-amber-500/40 bg-amber-500/10 text-sm text-amber-200">
            <p className="font-semibold text-amber-300 mb-1">
              Seeing items you don't have? That's normal — don't panic. / 单子上有、房间里没有？正常现象，不用慌。
            </p>
            <p>
              Count what you physically see. If a listed item is <span className="font-semibold">not in your room</span> (sold
              out / moved), just <span className="font-semibold">leave it blank or type 0</span> — the system expects that.
              / 数到多少填多少；房间里没有的产品<span className="font-semibold">留空或填 0</span> 即可（卖完或移走了），系统就是这么设计的。
            </p>
            <p className="mt-1 text-amber-200/80">
              List order: recently restocked / recently sold items first, then by inventory value.
              / 排序：最近补货或有动销的在最上面，其余按库存价值从高到低。
            </p>
          </div>

          {inventory.length === 0 ? (
            <div className="text-center py-12">
              <Package className="mx-auto text-gray-600 mb-4" size={48} />
              <p className="text-gray-400">No inventory in this room</p>
              <button onClick={handleNewCount} className="btn btn-secondary mt-4">
                Select Different Room
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th className="w-12 text-center" aria-label="Image">📷</th>
                      <th>Product</th>
                      <th>Product Type</th>
                      <th className="text-right w-32">Actual Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((inv, idx) => {
                      // Blind count: no expected / diff is computed or rendered
                      // here so the streamer cannot see or derive the system's
                      // quantity. The only editable value is their own count.
                      // (_fresh/_value drive ROW ORDER + the NEW badge only.)
                      const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
                      const prev = inventory[idx - 1]
                      const groupBreak = idx === 0 || Boolean(prev?._fresh) !== Boolean(inv._fresh)

                      return (
                        <React.Fragment key={inv.id}>
                          {groupBreak && (
                            <tr className="bg-vault-surface/60">
                              <td colSpan={4} className="py-1.5 text-xs font-semibold tracking-wide uppercase text-gray-400">
                                {inv._fresh
                                  ? '🆕 Recently restocked / sold — count these first · 最近补货/有动销 — 先数这些'
                                  : 'Older stock (by value) · 其余库存（按价值排序）'}
                              </td>
                            </tr>
                          )}
                          <tr>
                            {/* Display-only thumbnail so counters can identify the
                                box by sight. Does NOT touch the blind-count logic. */}
                            <td className="w-12"><ProductThumb productId={inv.product_id} /></td>
                            <td className="font-medium text-white">
                              <span className="inline-flex items-center gap-2">
                                <BrandChip brand={inv.product?.brand} />
                                <span>{launchName}<LangChip lang={inv.product?.language} /></span>
                              </span>
                            </td>
                            <td className="text-gray-400">{inv.product?.category}</td>
                            <td className="text-right">
                              <input
                                type="number"
                                min="0"
                                value={counts[inv.product_id] ?? ''}
                                onChange={(e) => handleCountChange(inv.product_id, e.target.value)}
                                placeholder="0"
                                className="w-24 text-right"
                              />
                            </td>
                          </tr>
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Extra items / Notes (optional) — free text for anomalies,
                  especially products physically in the room that are NOT on
                  this count list. One item per line; stored for later LLM
                  processing. Purely optional — never blocks a submit. */}
              <div className="mt-6">
                <label htmlFor="count-notes" className="block text-sm font-medium text-gray-300 mb-2">
                  Extra items / Notes (optional)
                </label>
                <textarea
                  id="count-notes"
                  rows={4}
                  maxLength={1000}
                  value={countNotes}
                  onChange={(e) => setCountNotes(e.target.value)}
                  placeholder={"XXX product in the room but NOT on this list / XXX产品在房间里 但不在这个清单上\nOne item per line · 一行写一条\ne.g. 1 box Gem Vol.5 not on list / 有一箱Gem Vol.5不在清单上 · damaged box 外盒破损"}
                />
              </div>

              {/* Summary — blind count shows ONLY progress, never sold /
                  discrepancy totals (those are computed against expected and
                  would leak the system numbers we're hiding). */}
              <div className="mt-6 pt-6 border-t border-vault-border">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-400">Progress</p>
                    <p className="font-display text-xl font-bold text-white">
                      Counted: {countedProducts} / {totalProducts} products
                    </p>
                    {countedProducts < totalProducts && (
                      <p className="text-xs text-amber-400 mt-1">
                        空格提交时按 0（卖完）记 · blank boxes will be recorded as 0 (sold out)
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleSubmitCount}
                    className="btn btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <div className="spinner w-5 h-5 border-2"></div>
                    ) : (
                      <>
                        <Save size={20} />
                        Submit Count
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Report */}
      {step === 3 && report && (
        <div className="max-w-2xl mx-auto">
          <div className="card">
            <div className="text-center mb-6">
              {report.status === 'complete' ? (
                <CheckCircle className="mx-auto text-green-400 mb-3" size={48} />
              ) : (
                <AlertTriangle className="mx-auto text-amber-400 mb-3" size={48} />
              )}
              <h2 className="font-display text-xl font-bold text-white">
                Count Submitted
              </h2>
            </div>
            
            {/* Report Header */}
            <div className="bg-vault-dark rounded-lg p-4 mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Stream Room</p>
                  <p className="text-white font-medium">{report.location}</p>
                </div>
                <div>
                  <p className="text-gray-400">Streamer</p>
                  <p className="text-white font-medium">{report.streamer}</p>
                </div>
                <div>
                  <p className="text-gray-400">Counted By</p>
                  <p className="text-white font-medium">{report.counted_by}</p>
                </div>
                <div>
                  <p className="text-gray-400">Time</p>
                  <p className="text-white font-medium">
                    {report.count_time.toLocaleDateString()} @ {report.count_time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>

            {/* Notes from the counter — anomalies / extra items reported at
                count time. whitespace-pre-wrap keeps one-per-line entries on
                their own lines. */}
            {report.note && (
              <div className="bg-vault-dark rounded-lg p-4 mb-6">
                <p className="text-gray-400 text-sm mb-1">Notes</p>
                <p className="text-white whitespace-pre-wrap">{report.note}</p>
              </div>
            )}

            {/* Items Sold */}
            {report.sold_items.length > 0 && (
              <div className="mb-6">
                <h3 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-400" />
                  Items Sold ({report.total_sold} total)
                </h3>
                <div className="bg-green-400/10 rounded-lg border border-green-400/30 overflow-hidden">
                  <table>
                    <thead>
                      <tr className="border-b border-green-400/30">
                        <th className="text-green-400">Product</th>
                        <th className="text-right text-green-400">Was</th>
                        <th className="text-right text-green-400">Now</th>
                        <th className="text-right text-green-400">Sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sold_items.map((item, idx) => (
                        <tr key={idx} className="border-b border-green-400/10 last:border-0">
                          <td className="text-white">{item.product?.name}</td>
                          <td className="text-right text-gray-400">{item.expected}</td>
                          <td className="text-right text-gray-400">{item.actual}</td>
                          <td className="text-right text-green-400 font-medium">
                            {item.measure === 'at_least' ? `≥ ${item.sold}`
                              : item.measure === 'unverified' ? `${item.sold} ?` : item.sold}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.sold_items.some(i => i.measure === 'at_least') && (
                  <p className="text-xs text-green-400/80 mt-2">
                    <b>≥</b> — this room was already counting that SKU above the books, so
                    "Was" understates what was on the shelf and the real number sold can only
                    be higher.
                  </p>
                )}
                {report.sold_items.some(i => i.measure === 'unverified') && (
                  <p className="text-xs text-amber-400/80 mt-2">
                    <b>?</b> — we could not check whether this room was already above the
                    books, so none of these figures are confirmed. Treat them as unverified,
                    not exact.
                  </p>
                )}
              </div>
            )}
            
            {/* Discrepancies */}
            {report.discrepancy_items.length > 0 && (
              <div className="mb-6">
                <h3 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <AlertTriangle size={20} className="text-amber-400" />
                  Found beyond system
                </h3>
                <div className="bg-amber-400/10 rounded-lg border border-amber-400/30 overflow-hidden">
                  <table>
                    <thead>
                      <tr className="border-b border-amber-400/30">
                        <th className="text-amber-400">Product</th>
                        <th className="text-right text-amber-400">Expected</th>
                        <th className="text-right text-amber-400">Counted</th>
                        <th className="text-right text-amber-400">Extra</th>
                        <th className="text-amber-400">What to do</th>
                        <th className="text-right text-amber-400">Unresolved for</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.discrepancy_items.map((item, idx) => (
                        <tr key={idx} className="border-b border-amber-400/10 last:border-0">
                          <td className="text-white">{item.product?.name}</td>
                          <td className="text-right text-gray-400">{item.expected}</td>
                          <td className="text-right text-gray-400">{item.actual}</td>
                          <td className="text-right text-amber-400 font-medium">+{item.extra}</td>
                          {/* "Record a Move" is only an instruction where there is
                              somewhere to move stock FROM. Printing it against a SKU
                              the company holds nowhere else is why one of these has
                              now been reported eleven counts running. */}
                          <td className="text-xs">
                            {item.fixable === true ? (
                              <span className="text-emerald-300">
                                Move in from {(item.sources || []).map(s => `${s.name} (${s.qty})`).join(', ') || 'another room'}
                              </span>
                            ) : item.fixable === false ? (
                              <span className="text-amber-300">
                                No source anywhere — needs a physical recount, do not adjust stock
                              </span>
                            ) : (
                              <span className="text-gray-400">
                                Could not check other rooms — unresolved
                              </span>
                            )}
                          </td>
                          <td className="text-right text-amber-400/80">
                            {item.streak > 1
                              ? `${item.streak} counts in a row`
                              : 'first time'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-amber-400/80 mt-2">
                  ⚠️ These were <b>NOT</b> added to inventory — a count can't add stock.
                  Where the goods exist in another room, recording a <b>Move</b> into{' '}
                  {report.location_name || 'this room'} fixes the books and the company total
                  doesn't change. Where they don't, no Move can source them — that needs a
                  physical recount or the people in the room.
                </p>
                <p className="text-xs text-amber-400/80 mt-1">
                  Until then, <b>sales for these SKUs are unknown, not zero</b>. A count measures
                  sales as expected − counted, which only works when expected is right — so stock
                  can keep leaving these SKUs and every session will report 0 sold.
                </p>
              </div>
            )}
            
            {/* No Changes */}
            {report.sold_items.length === 0 && report.discrepancy_items.length === 0 && (
              <div className="text-center py-6">
                <p className="text-gray-400">No changes from expected inventory</p>
              </div>
            )}
            
            {/* Actions */}
            <div className="mt-6 pt-6 border-t border-vault-border space-y-2">
              {/* TikTok Packheads gets reconciled automatically by
                  /api/auto-reconcile in the background. Surface a hint so
                  the streamer knows where to look for the result. Other
                  TikTok rooms aren't wired up yet, so don't show the hint
                  for them. */}
              {report.stream_count_id && /TikTok\s*Packheads/i.test(report.location_name || '') && (
                <div className="text-center text-xs text-gray-500 py-2 px-3 bg-vault-darker/40 rounded border border-vault-border/50">
                  Auto-reconcile running — check <span className="text-vault-gold">Audit History</span> in ~30 seconds.
                </div>
              )}
              <button onClick={handleNewCount} className="btn btn-primary w-full">
                <ClipboardList size={20} />
                Start New Count
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
