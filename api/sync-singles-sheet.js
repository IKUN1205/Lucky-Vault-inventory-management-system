// api/sync-singles-sheet.js
// Vercel cron — pulls the boss's singles Google Sheet (gid 1153833478) and
// keeps the singles table in sync. Runs twice a day (see vercel.json crons).
//
// Policy (per directive 2026-05-21):
//   - PRICES are sync'd every run (current_market_price_usd).
//   - QUANTITIES are NOT auto-updated on existing rows — the store's
//     point-of-sale is the source of truth for qty (sales decrement
//     it). Overwriting qty from a sheet that may be stale would
//     resurrect already-sold cards.
//   - NEW rows (TCG IDs not yet in DB) ARE inserted, including qty
//     from the sheet — there's no other source for them on creation.
//   - Missing card_sets entries are auto-created (one bucket per new
//     set name + a fallback "Unknown Set (sheet import)" for rows
//     where col B is empty).
//
// Vercel attaches Authorization: Bearer ${CRON_SECRET} when invoking via
// the crons schedule. We verify it so random callers can't trigger the
// sync (which would be embarrassing but not destructive — the worst they
// could do is replay prices, no destructive side effects).

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LARK_INVENTORY_IO = process.env.LARK_WEBHOOK_INVENTORY_IO
  || process.env.LARK_WEBHOOK_URL

const SHEET_ID = '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80'
// Two tabs in the sheet, both with the same schema:
//   - "Master Singles": consolidated/main list (459 rows as of 2026-05-25)
//   - "New Singles ":   landing zone for fresh arrivals (boss adds here
//                       first, eventually moves to Master). Trailing
//                       space in the name is intentional — it's part of
//                       the actual tab name in Google Sheets.
// We fetch by name (?sheet=) instead of gid so adding/renaming tabs
// later is a one-line change. If a TCG ID appears in BOTH tabs we
// keep Master's values (it's the canonical source).
const SHEET_TABS = [
  { name: 'Master Singles', label: 'master' },
  { name: 'New Singles ',   label: 'new'    },
]
const buildSheetUrl = (sheetName) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
const BRAND = 'Pokemon'
const FALLBACK_SET_NAME = 'Unknown Set (sheet import)'

// Sheet fetch + ~500 row scan + small batches of upserts. 30s is plenty
// at current sheet size; bump to 60 if it ever feels tight.
export const config = { maxDuration: 60 }

// ----- CSV parser (handles quoted fields with commas + escaped quotes) -----
function parseCSV(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; continue }
      if (ch === '"') { inQuotes = false; continue }
      cell += ch; continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []; continue
    }
    cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    if (row.some(c => c.trim() !== '')) rows.push(row)
  }
  return rows
}

// Mirror of the script's parser. Cascades through number-shaped tokens
// in decreasing specificity. card_number is NOT NULL so we always
// produce a non-empty value (raw text as last resort).
function parseCardText(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean)
  const patterns = [
    /^\d+\/\d+[a-zA-Z]?$/,
    /^[A-Za-z]+\d+\/[A-Za-z]*\d+$/,
    /^[A-Za-z]+\d+[a-zA-Z]?$/,
    /^\d+$/,
  ]
  let numIdx = -1
  for (const re of patterns) {
    numIdx = tokens.findIndex(t => re.test(t))
    if (numIdx !== -1) break
  }
  if (numIdx === -1) {
    return { card_name: null, card_number: text.trim() || 'UNKNOWN', variant: null }
  }
  return {
    card_name: tokens.slice(0, numIdx).join(' ').trim() || null,
    card_number: tokens[numIdx],
    variant: tokens.slice(numIdx + 1).join(' ').trim() || null,
  }
}

function parseDollar(s) {
  if (!s) return null
  const m = String(s).match(/[\d.]+/)
  return m ? Number(m[0]) : null
}
function parseDate(s) {
  if (!s) return null
  const trimmed = String(s).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

async function postLark(text) {
  if (!LARK_INVENTORY_IO) return
  try {
    await fetch(LARK_INVENTORY_IO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
  } catch (err) {
    console.error('[sync-singles-sheet] Lark notify failed:', err)
  }
}

export default async function handler(req, res) {
  // Auth gate. Vercel cron sends Bearer ${CRON_SECRET}; manual ad-hoc
  // calls can pass the same header (e.g. for retry/debug).
  if (CRON_SECRET) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase key not configured' })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  })
  const today = new Date().toISOString().slice(0, 10)
  const startedAt = Date.now()

  try {
    // 1. Pull both tabs. Iterate so adding/removing tabs is just a
    //    SHEET_TABS array change. Process order matters for the dedupe
    //    below — see comment on `parsed` map.
    const tabFetchSummary = []
    const allRows = []   // { tab, row[] }
    for (const tab of SHEET_TABS) {
      const url = buildSheetUrl(tab.name)
      const csvResp = await fetch(url)
      if (!csvResp.ok) {
        const msg = `Sheet fetch failed for "${tab.name}": HTTP ${csvResp.status}`
        console.error('[sync-singles-sheet]', msg)
        await postLark(`⚠️ Singles sheet sync FAILED — ${msg}`)
        return res.status(502).json({ error: msg })
      }
      const csv = await csvResp.text()
      // gviz CSV is inconsistent about including the header row — sometimes
      // present, sometimes Google strips it via auto-type detection. Don't
      // blindly slice(1); instead validate every row by checking col 5 is
      // a digit string. This caught a 2026-05-22 bug where the literal
      // "TCG ID" header was imported as a card row.
      const rows = parseCSV(csv)
      for (const r of rows) allRows.push({ tab: tab.label, row: r })
      tabFetchSummary.push({ tab: tab.label, rows: rows.length })
    }

    // 2. Parse + dedupe by TCG ID. If a TCG ID appears in BOTH tabs we
    //    prefer Master's values (Master is the canonical source; the
    //    "New" tab is meant as a staging area before the boss moves
    //    cards into Master). Because we iterate SHEET_TABS in order
    //    (master then new), and `Map.set` is last-write-wins, we need
    //    a small trick: skip the SET when an entry already exists for
    //    this TCG ID and we're processing a non-master tab.
    const parsed = new Map()
    let skipped = 0
    for (const { tab, row: r } of allRows) {
      const tcg_id = (r[5] || '').trim()
      if (!tcg_id || !/^\d+$/.test(tcg_id)) { skipped++; continue }
      if (parsed.has(tcg_id) && tab !== 'master') continue   // master wins on conflict
      const { card_name, card_number, variant } = parseCardText(r[0] || '')
      parsed.set(tcg_id, {
        tcg_id,
        card_name, card_number, variant,
        set_name: (r[1] || '').trim() || null,
        market_price: parseDollar(r[2]),
        qty: Math.max(1, parseInt((r[4] || '').trim()) || 1),
        date_acquired: parseDate(r[7]) || null,
        raw_text: r[0] || '',
        source_tab: tab,   // for logging only
      })
    }
    const items = Array.from(parsed.values())
    console.log('[sync-singles-sheet] tab fetch:', tabFetchSummary, '→ unique TCG IDs:', items.length)

    // 3. Existing singles in DB, by TCG ID. Pull current_market_price_usd
    //    too so we can skip rows that haven't actually changed (the typical
    //    case — only a handful of prices move day to day).
    const existingByTcg = new Map()
    const ids = items.map(i => i.tcg_id)
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      const { data, error } = await supabase
        .from('singles')
        .select('id, tcg_id, status, form, quantity, current_market_price_usd')
        .in('tcg_id', batch)
        .eq('deleted', false)
      if (error) throw error
      for (const r of data || []) {
        const score = r.status === 'in_inventory' ? 3 : r.status === 'listed' ? 2 : 1
        const prev = existingByTcg.get(String(r.tcg_id))
        if (!prev || score > prev._score) existingByTcg.set(String(r.tcg_id), { ...r, _score: score })
      }
    }

    // 4. Update prices on existing rows — but only when the price ACTUALLY
    //    changed. Previously every row PATCHed every run (432 sequential
    //    HTTPs ≈ 58s, risking the 60s function timeout). Now we PATCH only
    //    the deltas, which is typically a single-digit count.
    //    NEVER touches quantity — see policy comment at top of file.
    let updatedOk = 0, updatedErr = 0, updatedSkipped = 0
    const PRICE_EPSILON = 0.005   // tolerate sub-cent float-rounding noise
    for (const item of items) {
      const existing = existingByTcg.get(item.tcg_id)
      if (!existing) continue
      if (item.market_price == null) { updatedSkipped++; continue }
      const dbPrice = existing.current_market_price_usd
      if (dbPrice != null && Math.abs(Number(dbPrice) - item.market_price) < PRICE_EPSILON) {
        updatedSkipped++
        continue
      }
      const { error } = await supabase
        .from('singles')
        .update({
          current_market_price_usd: item.market_price,
          market_price_source: 'sheet_sync',
          market_price_updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) {
        console.error('[sync-singles-sheet] PATCH failed:', item.tcg_id, error.message)
        updatedErr++
      } else {
        updatedOk++
      }
    }

    // 5. Insert genuinely new rows. Sets that don't exist yet are
    //    auto-created. Empty set_name routes through the fallback bucket.
    const newRows = items.filter(it => !existingByTcg.has(it.tcg_id))

    // 5a. Build set lookup (fetch + auto-create + add fallback). Also
    //     resolve Front Store id once so every new insert lands there
    //     (storage policy 2026-05-21: all new singles default to
    //     Storefront Inventory until physically moved).
    const { data: frontStoreRow } = await supabase
      .from('locations')
      .select('id')
      .eq('name', 'Front Store')
      .maybeSingle()
    const frontStoreId = frontStoreRow?.id || null
    const { data: sets } = await supabase
      .from('card_sets')
      .select('id, name, language')
      .eq('active', true)
    const setByLowerName = new Map((sets || []).map(s => [s.name.toLowerCase(), s]))
    if (!setByLowerName.has(FALLBACK_SET_NAME.toLowerCase())) {
      const { data: created } = await supabase
        .from('card_sets')
        .insert([{ brand: BRAND, name: FALLBACK_SET_NAME, language: 'EN', active: true }])
        .select()
      if (created?.[0]) setByLowerName.set(FALLBACK_SET_NAME.toLowerCase(), created[0])
    }
    const needed = new Set()
    for (const it of newRows) {
      const sn = (it.set_name || '').trim()
      if (sn && !setByLowerName.has(sn.toLowerCase())) needed.add(sn)
    }
    let setsCreated = 0
    if (needed.size > 0) {
      const newSets = Array.from(needed).map(n => ({
        brand: BRAND, name: n, active: true,
        language: /Japanese|JP/i.test(n) ? 'JP' : 'EN',
      }))
      const { data: created } = await supabase
        .from('card_sets')
        .insert(newSets)
        .select()
      for (const s of created || []) setByLowerName.set(s.name.toLowerCase(), s)
      setsCreated = (created || []).length
    }

    // 5b. Build insert payloads + send in batches of 100.
    const fallbackSet = setByLowerName.get(FALLBACK_SET_NAME.toLowerCase())
    const inserts = newRows.map(it => {
      let set = it.set_name ? setByLowerName.get(it.set_name.toLowerCase()) : null
      if (!set) set = fallbackSet
      return {
        card_name: it.card_name || it.raw_text || 'Unknown',
        card_number: it.card_number,
        set_id: set?.id || null,
        brand: BRAND,
        language: set?.language || 'EN',
        variant: it.variant,
        form: 'raw',
        condition: 'NM',
        quantity: it.qty,
        tcg_id: it.tcg_id,
        current_market_price_usd: it.market_price,
        market_price_source: it.market_price != null ? 'sheet_sync' : null,
        market_price_updated_at: it.market_price != null ? new Date().toISOString() : null,
        acquisition_cost_usd: null,
        source_type: 'other',
        status: 'in_inventory',
        location_id: frontStoreId,
        date_acquired: it.date_acquired || today,
        notes: `Imported from singles sheet on ${today} (auto-sync)`,
        deleted: false,
      }
    })
    let insertedOk = 0, insertedErr = 0
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100)
      const { error } = await supabase.from('singles').insert(batch)
      if (error) {
        console.error('[sync-singles-sheet] INSERT batch failed:', error.message)
        insertedErr += batch.length
      } else {
        insertedOk += batch.length
      }
    }

    const durationMs = Date.now() - startedAt
    const summary = {
      ok: true,
      sheet_rows: rows.length,
      unique_tcg_ids: items.length,
      skipped_no_tcg_id: skipped,
      existing_in_db: existingByTcg.size,
      prices_changed: updatedOk,
      prices_unchanged: updatedSkipped,
      prices_update_errors: updatedErr,
      new_rows_inserted: insertedOk,
      new_row_errors: insertedErr,
      sets_auto_created: setsCreated,
      duration_ms: durationMs,
    }
    console.log('[sync-singles-sheet] OK', summary)

    // Lark digest. Skip when truly nothing changed (boring "sync ran and
    // did nothing" messages clutter the channel). Send when there's at
    // least one new row, any errors, any new sets, or one+ price actually
    // moved. The unchanged-prices count is implied by silence.
    const meaningful =
      insertedOk > 0 || insertedErr > 0 || updatedErr > 0
      || setsCreated > 0 || updatedOk > 0
    if (meaningful) {
      const lines = ['🔄 Singles sheet sync']
      if (insertedOk > 0) lines.push(`✅ ${insertedOk} new singles imported`)
      if (updatedOk > 0)  lines.push(`💲 ${updatedOk} price${updatedOk === 1 ? '' : 's'} changed`)
      if (setsCreated > 0) lines.push(`🏷️ ${setsCreated} new card_sets entries auto-created`)
      if (insertedErr + updatedErr > 0) lines.push(`⚠️ ${insertedErr + updatedErr} errors — check logs`)
      lines.push(`Took ${Math.round(durationMs / 100) / 10}s · ${today}`)
      await postLark(lines.join('\n'))
    }

    return res.status(200).json(summary)
  } catch (err) {
    console.error('[sync-singles-sheet] threw:', err)
    await postLark(`⚠️ Singles sheet sync threw: ${err.message || err}`)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
