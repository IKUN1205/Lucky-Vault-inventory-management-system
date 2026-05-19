// ============================================================================
// Singles reconcile — diff DB vs Will's latest Google Sheet (2026-05-18)
// ============================================================================
// Reads scripts/_singles_latest_2026_05_18.csv (current authoritative inventory)
// and compares it to the live `singles` table via Supabase. Generates:
//
//   scripts/_singles_reconcile_2026_05_18_report.md   ← human-readable diff
//   scripts/singles_reconcile_2026_05_18.sql           ← SQL to run
//
// Reconcile semantics (per Will 2026-05-18):
//   * Sheet row, NOT in DB        → INSERT (new card)
//   * DB row, NOT in sheet        → soft-delete with reason
//   * Both, qty differs           → UPDATE quantity
//   * Both, qty matches           → skip
//
// Run:
//   node scripts/_build_singles_reconcile_2026_05_18.mjs
// ============================================================================

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()
const CSV = 'scripts/_singles_latest_2026_05_18.csv'
const OUT_SQL = 'scripts/singles_reconcile_2026_05_18.sql'
const OUT_REPORT = 'scripts/_singles_reconcile_2026_05_18_report.md'
const TODAY = '2026-05-18'
const BRAND = 'Pokemon'
const LANGUAGE = 'EN'
const SLAB_ROOM_ID = '14d5db72-84de-4e49-901e-4d8230525691'

// Supabase anon client — read-only operations from the public anon key.
// Pulled from the same default the frontend uses in src/lib/supabase.js
// so this script doesn't depend on .env being populated.
const SUPABASE_URL = 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxcmVxZXZianN6ZXJjZ2Fja3VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzU4NzcsImV4cCI6MjA5MzA1MTg3N30.vDu1lA5SJLpA_mRhAF5JkVSreP_F4Q9g_Ta-9xm-UdU'
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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

const sqlStr = (v) => v === null || v === undefined
  ? 'NULL'
  : "'" + String(v).replace(/'/g, "''") + "'"

// Best-effort card_number extraction (same as _build_singles_import_sql.mjs)
function parseCardName(full) {
  let m = full.match(/^(.+?)\s+(\d{1,4}[a-z]?\/\d{1,4}[a-z]?)\s*(.*)$/i)
  if (m) return { card_name: m[1].trim(), card_number: m[2], rest: m[3].trim() }
  m = full.match(/^(.+?)\s+(SV\d+\/SV\d+|SWSH\d+|SV\d+|TG\d+\/TG\d+|GG\d+\/GG\d+)\s*(.*)$/i)
  if (m) return { card_name: m[1].trim(), card_number: m[2], rest: m[3].trim() }
  m = full.match(/^(.+?)\s+(\d{1,4})(?:\s+(.+))?$/)
  if (m) return { card_name: m[1].trim(), card_number: m[2], rest: (m[3] || '').trim() }
  return { card_name: full, card_number: '', rest: '' }
}

// ---- 1. Parse sheet ----
const sheetPath = path.join(ROOT, CSV)
if (!fs.existsSync(sheetPath)) {
  console.error(`CSV not found at ${sheetPath}`)
  process.exit(1)
}
const rows = parseCSV(fs.readFileSync(sheetPath, 'utf8'))
const header = rows.shift()
const sheetMap = new Map()  // tcg_id → { name, set, qty }
const sheetSets = new Set()
const sheetSkips = []

for (const r of rows) {
  const [name, setRaw, , , qtyRaw, tcgRaw] = r
  const cleanName = (name || '').trim()
  const cleanSet  = (setRaw || '').trim() || 'Unsorted / Promo'
  const cleanTcg  = (tcgRaw || '').replace(/[",]/g, '').trim()
  const cleanQty  = parseInt((qtyRaw || '').replace(/[",]/g, ''), 10)

  if (!cleanName || !cleanTcg || !cleanQty || cleanQty <= 0) {
    sheetSkips.push({ name: cleanName, tcg: cleanTcg, reason: 'missing required field' })
    continue
  }

  if (sheetMap.has(cleanTcg)) {
    // Dupe TCG ID in sheet — sum qty + flag
    const prev = sheetMap.get(cleanTcg)
    prev.qty += cleanQty
    prev.dupe = true
  } else {
    sheetMap.set(cleanTcg, { name: cleanName, set: cleanSet, qty: cleanQty })
  }
  sheetSets.add(cleanSet)
}

// ---- 2. Pull current DB state ----
console.error(`Sheet: ${sheetMap.size} unique tcg_ids parsed (${sheetSkips.length} skipped)`)
console.error('Fetching current singles from Supabase...')

const { data: dbRows, error: dbErr } = await sb
  .from('singles')
  .select('id, tcg_id, card_name, card_number, quantity, form, deleted, set:card_sets(name)')
  .or('deleted.is.null,deleted.eq.false')
  .eq('form', 'raw')
  .not('tcg_id', 'is', null)
  .order('tcg_id')
if (dbErr) {
  console.error('Supabase query failed:', dbErr)
  process.exit(1)
}
console.error(`DB: ${dbRows.length} active raw singles with tcg_id`)

const dbMap = new Map()  // tcg_id → row
for (const r of dbRows) {
  if (dbMap.has(r.tcg_id)) {
    // Multiple rows with same tcg_id — could happen post-Transfer (different locations)
    // For now, collapse by summing qty for diff purposes.
    const prev = dbMap.get(r.tcg_id)
    prev.quantity += r.quantity
    prev._ids = (prev._ids || [prev.id]).concat(r.id)
    prev._multi = true
  } else {
    dbMap.set(r.tcg_id, { ...r })
  }
}

// ---- 3. Diff ----
const toInsert = []  // sheet but not DB
const toUpdate = []  // both, qty differs
const noChange = []  // both, qty matches
const toDelete = []  // DB but not sheet

for (const [tcg, s] of sheetMap.entries()) {
  const d = dbMap.get(tcg)
  if (!d) {
    toInsert.push({ tcg, ...s })
  } else if (Number(d.quantity) !== Number(s.qty)) {
    toUpdate.push({ tcg, db: d, sheet: s })
  } else {
    noChange.push({ tcg, db: d })
  }
}
for (const [tcg, d] of dbMap.entries()) {
  if (!sheetMap.has(tcg)) {
    toDelete.push({ tcg, db: d })
  }
}

// ---- 4. Report ----
const report = []
report.push(`# Singles reconcile dry-run — ${TODAY}`)
report.push('')
report.push(`Source sheet: \`${CSV}\` (${sheetMap.size} unique tcg_ids)`)
report.push(`DB now: ${dbRows.length} active raw singles with tcg_id`)
report.push('')
report.push('## Summary')
report.push('')
report.push(`| Action | Count |`)
report.push(`|--------|-------|`)
report.push(`| Insert (sheet only)      | ${toInsert.length} |`)
report.push(`| Update qty (both differ) | ${toUpdate.length} |`)
report.push(`| Soft-delete (DB only)    | ${toDelete.length} |`)
report.push(`| No change (both match)   | ${noChange.length} |`)
report.push('')
if (sheetSkips.length) {
  report.push(`*Sheet skips: ${sheetSkips.length} rows ignored (missing name/tcg/qty).*`)
  report.push('')
}

if (toInsert.length) {
  report.push('## INSERT (sheet only — new cards to add)')
  report.push('')
  report.push('| TCG ID | Name | Set | Qty |')
  report.push('|--------|------|-----|-----|')
  toInsert.slice(0, 50).forEach(r => {
    report.push(`| ${r.tcg} | ${r.name.replace(/\|/g, '\\|')} | ${r.set.replace(/\|/g, '\\|')} | ${r.qty} |`)
  })
  if (toInsert.length > 50) report.push(`| ... | (${toInsert.length - 50} more) | | |`)
  report.push('')
}

if (toUpdate.length) {
  report.push('## UPDATE qty (both exist, quantity differs)')
  report.push('')
  report.push('| TCG ID | Name | Old qty | → New qty | Δ |')
  report.push('|--------|------|---------|-----------|---|')
  toUpdate.slice(0, 50).forEach(r => {
    const delta = r.sheet.qty - r.db.quantity
    const tag = r.db._multi ? ' ⚠ multi-location' : ''
    report.push(`| ${r.tcg} | ${r.db.card_name.replace(/\|/g, '\\|')}${tag} | ${r.db.quantity} | ${r.sheet.qty} | ${delta > 0 ? '+' : ''}${delta} |`)
  })
  if (toUpdate.length > 50) report.push(`| ... | (${toUpdate.length - 50} more) | | | |`)
  report.push('')
}

if (toDelete.length) {
  report.push('## SOFT-DELETE (DB only — not in 2026-05-18 sheet)')
  report.push('')
  report.push('| TCG ID | Name | Set | DB qty |')
  report.push('|--------|------|-----|--------|')
  toDelete.slice(0, 100).forEach(r => {
    const setName = r.db.set?.name || ''
    report.push(`| ${r.tcg} | ${r.db.card_name.replace(/\|/g, '\\|')} | ${setName.replace(/\|/g, '\\|')} | ${r.db.quantity} |`)
  })
  if (toDelete.length > 100) report.push(`| ... | (${toDelete.length - 100} more) | | |`)
  report.push('')
}

fs.writeFileSync(path.join(ROOT, OUT_REPORT), report.join('\n'))

// ---- 5. SQL ----
const out = []
out.push('-- ============================================================================')
out.push(`-- Singles reconcile — ${TODAY}`)
out.push('-- ============================================================================')
out.push(`-- Sheet source: ${CSV}`)
out.push(`-- Generated by: scripts/_build_singles_reconcile_2026_05_18.mjs`)
out.push(`--`)
out.push(`-- Counts: ${toInsert.length} insert · ${toUpdate.length} update · ${toDelete.length} soft-delete · ${noChange.length} no-change`)
out.push(`--`)
out.push(`-- Safety: wrapped in BEGIN/COMMIT. Review the report file first:`)
out.push(`--   scripts/_singles_reconcile_2026_05_18_report.md`)
out.push('-- ============================================================================')
out.push('')
out.push('BEGIN;')
out.push('')

// A. card_sets — auto-create any new set names referenced by INSERTs
if (toInsert.length) {
  const newSetNames = new Set(toInsert.map(r => r.set))
  out.push('-- A. Auto-create any missing card_sets')
  out.push('INSERT INTO card_sets (brand, language, name) VALUES')
  out.push([...newSetNames].sort().map(s =>
    `  (${sqlStr(BRAND)}, ${sqlStr(LANGUAGE)}, ${sqlStr(s)})`
  ).join(',\n'))
  out.push('ON CONFLICT (brand, language, name) DO NOTHING;')
  out.push('')
}

// B. INSERTs
if (toInsert.length) {
  out.push(`-- B. INSERT ${toInsert.length} new cards from sheet`)
  for (const r of toInsert.sort((a, b) => a.tcg.localeCompare(b.tcg))) {
    const parsed = parseCardName(r.name)
    out.push('INSERT INTO singles (')
    out.push('  card_name, card_number, variant, set_id, brand, language,')
    out.push('  form, condition, quantity, tcg_id, status, location_id, date_acquired')
    out.push(') SELECT')
    out.push(`  ${sqlStr(parsed.card_name)},`)
    out.push(`  ${sqlStr(parsed.card_number || '')},`)
    out.push(`  ${sqlStr(parsed.rest || null)},`)
    out.push(`  cs.id, ${sqlStr(BRAND)}, ${sqlStr(LANGUAGE)},`)
    out.push(`  'raw', 'NM', ${r.qty}, ${sqlStr(r.tcg)}, 'in_inventory',`)
    out.push(`  ${sqlStr(SLAB_ROOM_ID)}::uuid, ${sqlStr(TODAY)}::date`)
    out.push(`FROM card_sets cs`)
    out.push(`WHERE cs.brand = ${sqlStr(BRAND)} AND cs.language = ${sqlStr(LANGUAGE)} AND cs.name = ${sqlStr(r.set)}`)
    out.push(`ON CONFLICT DO NOTHING;`)
    out.push('')
  }
}

// C. UPDATEs
if (toUpdate.length) {
  out.push(`-- C. UPDATE quantity for ${toUpdate.length} cards where sheet ≠ DB`)
  for (const r of toUpdate.sort((a, b) => a.tcg.localeCompare(b.tcg))) {
    if (r.db._multi) {
      out.push(`-- ⚠ skip ${r.tcg} — multiple active rows in DB (${r.db._ids.length}). Resolve manually.`)
      continue
    }
    out.push(`UPDATE singles SET quantity = ${r.sheet.qty} WHERE id = ${sqlStr(r.db.id)}::uuid;`)
  }
  out.push('')
}

// D. Soft-deletes
if (toDelete.length) {
  out.push(`-- D. Soft-delete ${toDelete.length} cards in DB but not in 2026-05-18 sheet`)
  const ids = toDelete.flatMap(r => r.db._ids || [r.db.id])
  out.push(`UPDATE singles`)
  out.push(`SET deleted = true,`)
  out.push(`    deleted_at = now(),`)
  out.push(`    deleted_reason = 'Not in 2026-05-18 physical count'`)
  out.push(`WHERE id IN (`)
  out.push(ids.map(id => `  ${sqlStr(id)}::uuid`).join(',\n'))
  out.push(`);`)
  out.push('')
}

out.push('COMMIT;')
out.push('')
out.push('-- Verify')
out.push(`SELECT`)
out.push(`  COUNT(*) FILTER (WHERE deleted IS NULL OR deleted = false) AS active_total,`)
out.push(`  COUNT(*) FILTER (WHERE deleted = true AND deleted_reason = 'Not in 2026-05-18 physical count') AS soft_deleted_today`)
out.push(`FROM singles WHERE form = 'raw';`)

fs.writeFileSync(path.join(ROOT, OUT_SQL), out.join('\n'))

console.error('')
console.error(`Wrote ${OUT_REPORT}`)
console.error(`Wrote ${OUT_SQL}`)
console.error('')
console.error(`SUMMARY:  +${toInsert.length} insert · ~${toUpdate.length} update · −${toDelete.length} soft-delete · =${noChange.length} unchanged`)
