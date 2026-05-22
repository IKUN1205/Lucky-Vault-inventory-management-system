// One-shot import/sync of the singles sheet (gid=1153833478 by default).
//
// For each row in the sheet:
//   - If a singles row with the same TCG ID exists  → UPDATE
//       · current_market_price_usd ← sheet's Market $
//       · quantity                  ← sheet's Qty (only for in_inventory, raw)
//       · market_price_updated_at   ← today
//   - If no singles row exists                       → INSERT
//       · card_name, card_number, set_id (from card_sets lookup), variant,
//         tcg_id, quantity, current_market_price_usd, condition='NM',
//         form='raw', status='in_inventory', date_acquired, source_type='sheet_import'
//
// Run:
//   node scripts/_sync_singles_from_sheet_tab.mjs
//
// Reads anon key + url from src/lib/supabase.js (no separate env config).
import fs from 'fs'

const SHEET_ID = '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80'
const GID = '1153833478'
// Set DRY_RUN=1 to skip every PATCH/POST and just print what would happen.
const DRY_RUN = process.env.DRY_RUN === '1'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`
const TODAY = new Date().toISOString().slice(0, 10)
const BRAND = 'Pokemon'

// Pull anon key + url from src/lib/supabase.js so we don't have to
// duplicate config. Pattern: `const SUPABASE_URL = '...'` and the long
// JWT-looking anon key.
const supabaseSrc = fs.readFileSync('src/lib/supabase.js', 'utf8')
const SUPABASE_URL = supabaseSrc.match(/['"`](https:\/\/[a-z0-9]+\.supabase\.co)['"`]/)?.[1]
const ANON_KEY = supabaseSrc.match(/eyJ[A-Za-z0-9._-]+/)?.[0]
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Could not find SUPABASE_URL / anon key in src/lib/supabase.js')

const HEADERS = {
  'apikey': ANON_KEY,
  'Authorization': `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
}

// ----- CSV parser (handles quoted fields with commas/escaped quotes) -----
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
      cell += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
      continue
    }
    cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    if (row.some(c => c.trim() !== '')) rows.push(row)
  }
  return rows
}

// ----- card name parser -----
// Sheet col 0 examples:
//   "Surfer 293/217 SIR ASC"         → name="Surfer",          number="293/217", variant="SIR ASC"
//   "Jellicent ex 168/086 SIR WHT"   → name="Jellicent ex",    number="168/086", variant="SIR WHT"
//   "73/131 SM06"                    → name=null,              number="73/131",  variant="SM06"
//   "Oricorio ex 024 MEP"            → name="Oricorio ex",     number="024",     variant="MEP"  (promo)
function parseCardText(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean)
  // Cascade through number-shaped patterns in order of strictness so we
  // pick the most specific match. card_number is NOT NULL in the schema,
  // so the final fallback uses the whole raw text rather than nulling it.
  const patterns = [
    /^\d+\/\d+[a-zA-Z]?$/,            // 199/162, 199/162a — standard
    /^[A-Za-z]+\d+\/[A-Za-z]*\d+$/,   // RC23/RC25 — promo with letter prefix
    /^[A-Za-z]+\d+[a-zA-Z]?$/,        // SWSH262 — straight promo
    /^\d+$/,                          // 024 — bare numeric promo
  ]
  let numIdx = -1
  for (const re of patterns) {
    numIdx = tokens.findIndex(t => re.test(t))
    if (numIdx !== -1) break
  }
  if (numIdx === -1) {
    // No number-shaped token found. card_number is NOT NULL so we use
    // the original raw text as the number (better than failing the row).
    return {
      card_name: null,
      card_number: text.trim() || 'UNKNOWN',
      variant: null,
    }
  }
  const card_name = tokens.slice(0, numIdx).join(' ').trim() || null
  const card_number = tokens[numIdx]
  const variant = tokens.slice(numIdx + 1).join(' ').trim() || null
  return { card_name, card_number, variant }
}

function parseDollar(s) {
  if (!s) return null
  const m = String(s).match(/[\d.]+/)
  return m ? Number(m[0]) : null
}
function parseDate(s) {
  if (!s) return null
  // Sheet dates come as "2026-05-12" (ISO) — keep as-is. If we ever see
  // mm/dd/yyyy, parse + reformat.
  const trimmed = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

// ----- Supabase helpers -----
async function sb(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`${method} ${path} → ${r.status}: ${t}`)
  }
  // PATCH/POST with return=minimal returns empty body
  const txt = await r.text()
  return txt ? JSON.parse(txt) : null
}
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: { apikey: ANON_KEY } })
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`)
  return await r.json()
}

// ----- main -----
async function main() {
  console.log(`Fetching sheet ${GID}…`)
  const csv = await (await fetch(SHEET_URL)).text()
  const rows = parseCSV(csv)
  const dataRows = rows.slice(1)   // drop header
  console.log(`  ${dataRows.length} data rows in sheet`)

  // Build the parsed list. Skip rows with no TCG ID.
  const parsed = []
  const skipped = []
  for (const r of dataRows) {
    const tcg_id = (r[5] || '').trim()
    if (!tcg_id) { skipped.push({ reason: 'no TCG ID', row: r }); continue }
    const { card_name, card_number, variant } = parseCardText(r[0] || '')
    const set_name = (r[1] || '').trim() || null
    const market_price = parseDollar(r[2])
    const qty = Math.max(1, parseInt((r[4] || '').trim()) || 1)
    const date_acquired = parseDate(r[7]) || null
    parsed.push({
      tcg_id, card_name, card_number, variant, set_name,
      market_price, qty, date_acquired,
      raw_text: r[0] || '',
    })
  }

  // Dedupe by TCG ID — keep the LAST occurrence (later in sheet wins).
  const byTcg = new Map()
  for (const p of parsed) byTcg.set(p.tcg_id, p)
  const items = Array.from(byTcg.values())
  console.log(`  ${items.length} unique TCG IDs (after dedupe)`)
  console.log(`  ${skipped.length} rows skipped (no TCG ID)`)

  // Resolve Front Store id (all new singles default here per store policy).
  const frontStoreRow = await sbGet('/locations?select=id&name=eq.Front%20Store')
  const frontStoreId = frontStoreRow?.[0]?.id || null
  if (!frontStoreId) console.warn('  WARNING: Front Store location not found — inserts will have null location_id')

  // Fetch card_sets for name → id lookup.
  console.log('Fetching card_sets for set lookup…')
  let sets = await sbGet('/card_sets?select=id,name,brand,language&active=eq.true')
  let setByLowerName = new Map(sets.map(s => [s.name.toLowerCase(), s]))

  // Get-or-create a fallback "Unknown Set" entry — used for sheet rows
  // where col B (Set) is empty. ~24 rows in the current sheet stash the
  // set info inside col A (e.g. "Hoopa V - SWSH: Crown Zenith...") so we
  // can't extract it reliably. Put them under one bucket so they can be
  // recategorized later.
  const FALLBACK_NAME = 'Unknown Set (sheet import)'
  if (!setByLowerName.has(FALLBACK_NAME.toLowerCase())) {
    if (!DRY_RUN) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/card_sets`, {
        method: 'POST',
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify([{ brand: BRAND, name: FALLBACK_NAME, language: 'EN', active: true }]),
      })
      if (r.ok) {
        const [createdRow] = await r.json()
        setByLowerName.set(FALLBACK_NAME.toLowerCase(), createdRow)
        console.log(`Created fallback set "${FALLBACK_NAME}"`)
      } else {
        console.warn('Could not create fallback set:', await r.text())
      }
    }
  }

  // Auto-create card_sets entries for set names from the sheet that
  // don't exist yet. singles.set_id is NOT NULL so we can't import a
  // single without a set. Creating a placeholder is better than dropping
  // the row — the user can refine code/release_date later.
  const needed = new Set()
  for (const item of items) {
    const sn = (item.set_name || '').trim()
    if (sn && !setByLowerName.has(sn.toLowerCase())) needed.add(sn)
  }
  if (needed.size > 0) {
    console.log(`Auto-creating ${needed.size} missing card_sets entries:`)
    const newSets = Array.from(needed).map(n => ({
      brand: BRAND,
      name: n,
      // Try to guess language from the name. Default EN. Bare heuristic —
      // user can fix per-row later if needed.
      language: /Japanese|JP/i.test(n) ? 'JP' : 'EN',
      active: true,
    }))
    if (DRY_RUN) {
      newSets.forEach(s => console.log(`  [DRY] would create: ${s.name} (${s.language})`))
    } else {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/card_sets`, {
          method: 'POST',
          headers: { ...HEADERS, 'Prefer': 'return=representation' },
          body: JSON.stringify(newSets),
        })
        if (!r.ok) throw new Error(`card_sets POST → ${r.status}: ${await r.text()}`)
        const created = await r.json()
        for (const s of created) setByLowerName.set(s.name.toLowerCase(), s)
        console.log(`  created ${created.length} new sets`)
      } catch (err) {
        console.error('  failed to auto-create sets:', err.message)
      }
    }
  }

  // Fetch existing singles for these TCG IDs (in batches of 200 to stay
  // under URL length limits) so we can split into UPDATE vs INSERT lists.
  console.log('Checking which TCG IDs already exist in DB…')
  const existingByTcg = new Map()
  const allTcgIds = items.map(i => i.tcg_id)
  for (let i = 0; i < allTcgIds.length; i += 200) {
    const batch = allTcgIds.slice(i, i + 200)
    const rows = await sbGet(`/singles?select=id,tcg_id,status,form,quantity,card_name&tcg_id=in.(${batch.join(',')})&deleted=eq.false`)
    for (const r of rows) {
      // If multiple rows for same TCG ID, prefer the "still active" one
      // (in_inventory/listed) over sold/etc.
      const score = (r.status === 'in_inventory' ? 3 : r.status === 'listed' ? 2 : 1)
      const prev = existingByTcg.get(String(r.tcg_id))
      if (!prev || score > prev._score) {
        existingByTcg.set(String(r.tcg_id), { ...r, _score: score })
      }
    }
  }
  console.log(`  ${existingByTcg.size} TCG IDs already in DB`)
  console.log(`  ${items.length - existingByTcg.size} TCG IDs are new (need INSERT)`)

  // ----- Apply: UPDATE existing -----
  console.log('\nUpdating existing singles…')
  let updatedOk = 0, updatedSkipped = 0, updatedErr = 0
  for (const item of items) {
    const existing = existingByTcg.get(item.tcg_id)
    if (!existing) continue
    // Only update price; quantity update is risky (the sheet's qty may be
    // stale vs what the store actually has — only sync qty for raw,
    // in_inventory rows where the sheet is the source of truth).
    const patch = {}
    if (item.market_price != null) {
      patch.current_market_price_usd = item.market_price
      patch.market_price_source = 'sheet_sync'
      patch.market_price_updated_at = new Date().toISOString()
    }
    const safeForQtyUpdate = existing.status === 'in_inventory' && existing.form === 'raw'
    if (safeForQtyUpdate) patch.quantity = item.qty

    if (Object.keys(patch).length === 0) { updatedSkipped++; continue }
    try {
      if (DRY_RUN) {
        // skip the network call, just count it
      } else {
        await sb('PATCH', `/singles?id=eq.${existing.id}`, patch)
      }
      updatedOk++
    } catch (err) {
      console.error(`  UPDATE failed for tcg_id=${item.tcg_id}:`, err.message)
      updatedErr++
    }
  }
  console.log(`  updated: ${updatedOk} · skipped: ${updatedSkipped} · errors: ${updatedErr}`)

  // ----- Apply: INSERT missing -----
  console.log('\nInserting new singles…')
  let insertedOk = 0, insertedErr = 0
  const inserts = []
  for (const item of items) {
    if (existingByTcg.has(item.tcg_id)) continue
    // Set lookup: try the row's set name, else fall back to the
    // "Unknown Set" bucket. singles.set_id is NOT NULL so we always
    // need one — the fallback was created (or fetched) above.
    let set = item.set_name ? setByLowerName.get(item.set_name.toLowerCase()) : null
    if (!set) set = setByLowerName.get(FALLBACK_NAME.toLowerCase())
    inserts.push({
      card_name: item.card_name || item.raw_text || 'Unknown',
      card_number: item.card_number,
      set_id: set?.id || null,
      brand: BRAND,
      language: set?.language || 'EN',
      variant: item.variant,
      form: 'raw',
      condition: 'NM',
      quantity: item.qty,
      tcg_id: item.tcg_id,
      current_market_price_usd: item.market_price,
      market_price_source: item.market_price != null ? 'sheet_sync' : null,
      market_price_updated_at: item.market_price != null ? new Date().toISOString() : null,
      acquisition_cost_usd: null,
      // source_type is constrained to {box_break,purchase,trade_in,grading_return,other}.
      // 'other' is the closest fit for sheet-driven imports.
      source_type: 'other',
      status: 'in_inventory',
      location_id: frontStoreId,
      date_acquired: item.date_acquired || TODAY,
      notes: `Imported from singles sheet on ${TODAY}`,
      deleted: false,
    })
  }
  if (DRY_RUN) {
    console.log(`  [DRY RUN] would insert ${inserts.length} new singles. Sample of first 3:`)
    for (const sample of inserts.slice(0, 3)) {
      console.log('   ', JSON.stringify({
        card_name: sample.card_name, card_number: sample.card_number,
        tcg_id: sample.tcg_id, set: sample.set_id ? 'matched' : 'NO SET MATCH',
        price: sample.current_market_price_usd, qty: sample.quantity,
      }))
    }
    const noSet = inserts.filter(r => !r.set_id).length
    console.log(`  [DRY RUN] of the ${inserts.length} new rows, ${noSet} have NO matching card_sets entry (set_id will be null)`)
  } else {
    // Batch the inserts (200/req is safe).
    for (let i = 0; i < inserts.length; i += 200) {
      const batch = inserts.slice(i, i + 200)
      try {
        await sb('POST', '/singles', batch)
        insertedOk += batch.length
        process.stdout.write(`  inserted ${insertedOk}/${inserts.length}\r`)
      } catch (err) {
        console.error(`\n  INSERT batch ${i}-${i + batch.length} failed:`, err.message)
        insertedErr += batch.length
      }
    }
  }
  console.log(`\n  inserted: ${insertedOk} · errors: ${insertedErr}`)

  console.log('\n=== summary ===')
  console.log(`  rows in sheet:         ${dataRows.length}`)
  console.log(`  unique TCG IDs:        ${items.length}`)
  console.log(`  already existed (UPDATE): ${updatedOk + updatedSkipped + updatedErr}`)
  console.log(`    └ updated:           ${updatedOk}`)
  console.log(`    └ skipped (no-op):   ${updatedSkipped}`)
  console.log(`    └ errors:            ${updatedErr}`)
  console.log(`  new (INSERT):          ${inserts.length}`)
  console.log(`    └ inserted:          ${insertedOk}`)
  console.log(`    └ errors:            ${insertedErr}`)
  console.log(`  skipped (no TCG ID):   ${skipped.length}`)
}
main().catch(e => { console.error(e); process.exit(1) })
