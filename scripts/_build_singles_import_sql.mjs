// Build an import SQL script that seeds the singles table from the two
// CSV exports of the boss's google sheet (HE = high end singles, NEW = new
// singles). Each row → one INSERT into singles (raw form, NM condition,
// brand=Pokemon, language=EN). Quantities are summed when the same
// TCG ID appears in both tabs (dedup key).
//
// Generates two artefacts:
//   scripts/import_singles_from_sheet_2026_05_15.sql   ← the actual import
//   stderr report                                         ← summary + skips
//
// Run with:
//   node scripts/_build_singles_import_sql.mjs
import fs from 'fs'
import path from 'path'

// Use process.cwd() so the script works regardless of how Node resolves
// the import URL (the trailing " 4" in the parent dir name confuses URL
// → path conversion which encodes the space as %20).
const ROOT = process.cwd()
const FILES = [
  { tag: 'HE',  path: 'scripts/_singles_import_data_he.csv' },
  { tag: 'NEW', path: 'scripts/_singles_import_data_new.csv' },
]
const OUT = 'scripts/import_singles_from_sheet_2026_05_15.sql'
const TODAY = '2026-05-15'
const BRAND = 'Pokemon'    // all rows in the sheet are Pokemon
const LANGUAGE = 'EN'      // all rows are EN

// ---- CSV parser (handles quoted fields with commas + escaped quotes) ----
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
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim() !== '')) rows.push(row) }
  return rows
}

// ---- SQL string escape ----
const sqlStr = (v) => v === null || v === undefined
  ? 'NULL'
  : "'" + String(v).replace(/'/g, "''") + "'"

// ---- Main ----
const accumulator = new Map()   // tcg_id → { name, set, qty, sources: [tag], dates: [] }
const skips = []                // rows we couldn't import + reason
const setNamesUsed = new Set()  // for the card_sets upsert section

for (const file of FILES) {
  const full = path.join(ROOT, file.path)
  const raw = fs.readFileSync(full, 'utf8')
  const rows = parseCSV(raw)
  const header = rows.shift()
  // Expected columns: Name, Set, Market $, Prices, Qty, TCG ID, Location, Date
  for (const r of rows) {
    const [name, setRaw, , , qtyRaw, tcgRaw, , dateRaw] = r
    // Clean cells
    const cleanName = (name || '').trim()
    const cleanSet = (setRaw || '').trim()
    const cleanTcg = (tcgRaw || '').replace(/[",]/g, '').trim()
    const cleanQty = parseInt((qtyRaw || '').replace(/[",]/g, ''), 10)
    const cleanDate = (dateRaw || '').trim() || TODAY

    // Skip batch headers like "Batch 4 — 2026-05-12 — 193 cards"
    if (/^Batch\s+\d+/i.test(cleanName)) {
      skips.push({ tag: file.tag, reason: 'batch header', name: cleanName })
      continue
    }
    // Skip rows missing crucial fields
    if (!cleanName || !cleanTcg) {
      skips.push({ tag: file.tag, reason: 'missing name or tcg_id', name: cleanName, tcg: cleanTcg })
      continue
    }
    if (!cleanQty || cleanQty <= 0 || Number.isNaN(cleanQty)) {
      skips.push({ tag: file.tag, reason: 'missing/zero qty', name: cleanName, tcg: cleanTcg })
      continue
    }
    // Skip rows where set is empty AND name doesn't look like a real card
    // (some incomplete entries in the sheet have just "257/217 ASC" as name)
    if (!cleanSet && /^\d+\/\d+\s+[A-Z]+$/.test(cleanName)) {
      skips.push({ tag: file.tag, reason: 'incomplete entry (no set, name is just number+abbrev)', name: cleanName, tcg: cleanTcg })
      continue
    }

    // Dedup + accumulate quantities
    const prev = accumulator.get(cleanTcg)
    if (prev) {
      prev.qty += cleanQty
      if (!prev.sources.includes(file.tag)) prev.sources.push(file.tag)
      if (cleanDate < prev.date) prev.date = cleanDate
    } else {
      // Some rows have no Set value — they're typically promo / oddball cards.
      // Use a generic catch-all so they still import. The set name is searchable
      // in card_sets and can be cleaned up later.
      const setName = cleanSet || 'Unsorted / Promo'
      setNamesUsed.add(setName)
      accumulator.set(cleanTcg, {
        name: cleanName,
        set: setName,
        qty: cleanQty,
        sources: [file.tag],
        date: cleanDate,
      })
    }
  }
}

// ---- Best-effort card_number extraction from "Name" column ----
// Patterns: "Charizard 4/102 ..." or "Pikachu 005/025 ..." or
//           "Riolu 010 MEP" or "Dragonite (Pokemon TCG Game Boy Game) - Unnumbered..."
// Returns { card_name, card_number, variant_hint } — we don't really need to
// split; just trying to surface a card_number for searchability.
function parseCardName(full) {
  // Try `NNN/NNN` pattern first (most common)
  let m = full.match(/^(.+?)\s+(\d{1,4}[a-z]?\/\d{1,4}[a-z]?)\s*(.*)$/i)
  if (m) return { card_name: m[1].trim(), card_number: m[2], rest: m[3].trim() }
  // Try `Name NNN/NNN` with prefixes like SV073/SV122
  m = full.match(/^(.+?)\s+(SV\d+\/SV\d+|SWSH\d+|SV\d+|TG\d+\/TG\d+|GG\d+\/GG\d+)\s*(.*)$/i)
  if (m) return { card_name: m[1].trim(), card_number: m[2], rest: m[3].trim() }
  // Try `Name NNN [variant]` where NNN is a 1-4 digit number
  m = full.match(/^(.+?)\s+(\d{1,4})(?:\s+(.+))?$/)
  if (m) return { card_name: m[1].trim(), card_number: m[2], rest: (m[3] || '').trim() }
  // Fallback: whole thing as name, blank number
  return { card_name: full, card_number: '', rest: '' }
}

// ---- Build SQL ----
const out = []
out.push('-- ============================================================================')
out.push(`-- Singles inventory import from boss's Google Sheet — ${TODAY}`)
out.push('-- ============================================================================')
out.push('-- Source: scripts/_singles_import_data_he.csv + _singles_import_data_new.csv')
out.push(`-- Total deduped rows: ${accumulator.size}`)
out.push(`-- Skipped: ${skips.length} (see stderr from the generator)`)
out.push('--')
out.push('-- Pre-req: scripts/add_singles_tcg_id_column.sql must have run.')
out.push('--')
out.push('-- All cards imported as form=raw, condition=NM, brand=Pokemon, language=EN.')
out.push('-- Quantity is the sum across both tabs of the source sheet.')
out.push('-- Prices intentionally skipped per user request — "建立库存先".')
out.push('--')
out.push('-- Safety: wrapped in BEGIN/COMMIT. If anything errors mid-batch, the')
out.push('-- whole import rolls back. Idempotent guard: ON CONFLICT (tcg_id) DO NOTHING')
out.push('-- via the partial unique index — re-running this is a no-op.')
out.push('-- ============================================================================')
out.push('')
out.push('BEGIN;')
out.push('')

// Section A: Card sets (idempotent — auto-create missing ones)
out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('-- A. Card sets — auto-create any set names referenced below')
out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('INSERT INTO card_sets (brand, language, name) VALUES')
const setRows = [...setNamesUsed].sort().map(s =>
  `  (${sqlStr(BRAND)}, ${sqlStr(LANGUAGE)}, ${sqlStr(s)})`
)
out.push(setRows.join(',\n'))
out.push('ON CONFLICT (brand, language, name) DO NOTHING;')
out.push('')

// Section B: Singles inserts. For each card, do
// INSERT ... SELECT id FROM card_sets WHERE name=...  to look up set_id
// inline. We use ON CONFLICT DO NOTHING on the partial UNIQUE on tcg_id so
// re-running is idempotent (no duplicates).
out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('-- B. Singles rows — one per (deduped) tcg_id')
out.push('-- ───────────────────────────────────────────────────────────────────────────')

// Note: we can't bulk-INSERT with subqueries cleanly, so emit one statement per row.
// 525 inserts is fine — Supabase SQL Editor can handle it.
const sortedRows = [...accumulator.entries()].sort(([a],[b]) => a.localeCompare(b))
for (const [tcg, c] of sortedRows) {
  const parsed = parseCardName(c.name)
  // card_number is NOT NULL — fall back to empty string if extraction failed
  const cardNumber = parsed.card_number || ''
  const variant = parsed.rest || null
  // Use c.name as the canonical "Card name" (it's already descriptive)
  // and store the extracted parts as card_number + variant. This keeps the
  // boss's mental model intact while populating our schema.
  out.push(`INSERT INTO singles (`)
  out.push(`  card_name, card_number, variant, set_id, brand, language,`)
  out.push(`  form, condition, quantity, tcg_id, status, date_acquired`)
  out.push(`) SELECT`)
  out.push(`  ${sqlStr(parsed.card_name)},`)
  out.push(`  ${sqlStr(cardNumber)},`)
  out.push(`  ${sqlStr(variant)},`)
  out.push(`  cs.id, ${sqlStr(BRAND)}, ${sqlStr(LANGUAGE)},`)
  out.push(`  'raw', 'NM', ${c.qty}, ${sqlStr(tcg)}, 'in_inventory', ${sqlStr(c.date)}`)
  out.push(`FROM card_sets cs`)
  out.push(`WHERE cs.brand = ${sqlStr(BRAND)} AND cs.language = ${sqlStr(LANGUAGE)} AND cs.name = ${sqlStr(c.set)}`)
  out.push(`ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;`)
  out.push('')
}

out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('-- Verify before committing:')
out.push(`--   SELECT count(*) AS imported FROM singles WHERE form='raw' AND tcg_id IS NOT NULL;`)
out.push(`--   -- expect ~${accumulator.size}`)
out.push(`--   SELECT count(*) AS sets_used FROM card_sets WHERE brand='Pokemon' AND language='EN';`)
out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('')
out.push('COMMIT;')
out.push('-- ROLLBACK;     -- ← if numbers look wrong, run this instead of leaving COMMIT')

fs.writeFileSync(path.join(ROOT, OUT), out.join('\n'))

// ---- Report to stderr ----
console.error(`Wrote ${OUT}`)
console.error(`  Deduped cards:    ${accumulator.size}`)
console.error(`  Unique sets:      ${setNamesUsed.size}`)
console.error(`  Skipped rows:     ${skips.length}`)
console.error('')
console.error('Sets that will be auto-created:')
for (const s of [...setNamesUsed].sort()) console.error(`  - ${s}`)
console.error('')
if (skips.length > 0) {
  console.error('Skipped rows (need manual cleanup if these matter to you):')
  for (const s of skips) console.error(`  [${s.tag}] ${s.reason}: name=${JSON.stringify(s.name)} tcg=${s.tcg || '—'}`)
}
console.error('')
const totalQty = [...accumulator.values()].reduce((s, c) => s + c.qty, 0)
console.error(`Total physical card count after import: ${totalQty}`)
console.error('')
const dupesAcrossTabs = [...accumulator.values()].filter(c => c.sources.length > 1)
console.error(`Cards appearing in BOTH tabs (qty summed): ${dupesAcrossTabs.length}`)
