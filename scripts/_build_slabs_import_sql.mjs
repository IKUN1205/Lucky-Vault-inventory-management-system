// Import the boss's AZ CAC INV tab into the slabs table.
// Per user directive 2026-05-15: only A (CERT) / B (GRADING COMPANY) /
// C (Item Name) / L (Status) columns matter for v1. Prices skipped.
//
// Skip rules (parallel to singles import):
//   - empty Item Name (rows that have only a cert# placeholder)
//   - missing cert# or grading_company
//
// Status mapping (from L column):
//   IN_STOCK     → 'in_inventory'
//   SOLD         → 'sold'
//   EBAY LISTED  → 'listed'   (and set listed_at from M column if present)
//
// Dedup by cert_number (in case the sheet has duplicates within the tab).
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SRC = 'scripts/_slabs_import_data.csv'
const OUT = 'scripts/import_slabs_from_sheet_2026_05_15.sql'

// ---- CSV parser (same one we used for singles) ----
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

// Normalise the grading_company column. If it's blank but Item Name starts
// with a known prefix, infer it.
function inferGradingCo(rawCo, itemName) {
  const co = (rawCo || '').trim().toUpperCase()
  if (co) return co
  const name = (itemName || '').trim().toUpperCase()
  if (name.startsWith('PSA ')) return 'PSA'
  if (name.startsWith('CGC ')) return 'CGC'
  if (name.startsWith('BGS ')) return 'BGS'
  if (name.startsWith('SGC ')) return 'SGC'
  return null
}

// Map sheet Status → DB enum
function mapStatus(sheetStatus) {
  const s = (sheetStatus || '').trim().toUpperCase()
  if (s === 'SOLD') return 'sold'
  if (s === 'EBAY LISTED' || s === 'LISTED') return 'listed'
  if (s === 'IN_STOCK' || s === 'IN STOCK' || s === '') return 'in_inventory'
  return 'in_inventory'    // default fallback
}

// ---- Main ----
const raw = fs.readFileSync(path.join(ROOT, SRC), 'utf8')
const rows = parseCSV(raw)
const header = rows.shift()
console.error(`Read ${rows.length} data rows from ${SRC}`)

const accumulator = new Map()   // cert → entry
const skips = []
const statusCounts = { in_inventory: 0, listed: 0, sold: 0 }

for (const r of rows) {
  // CERT,GRADING COMPANY,Item Name,Pop,CL,MP,LS,List,LV,Note,Days on Shelf,Status,Listed Date,Last Alert,Cost Basis,Location,Intake Date
  const [cert, coRaw, itemName, , , , , , , , , statusRaw, listedDate] = r
  const cleanCert = (cert || '').trim()
  const cleanCo = inferGradingCo(coRaw, itemName)
  const cleanName = (itemName || '').trim()
  const cleanStatus = mapStatus(statusRaw)
  const cleanListed = (listedDate || '').trim() || null

  if (!cleanCert) {
    skips.push({ reason: 'missing cert', cert: cleanCert, name: cleanName })
    continue
  }
  if (!cleanName) {
    skips.push({ reason: 'empty item name (sheet placeholder row)', cert: cleanCert, name: cleanName })
    continue
  }
  if (!cleanCo) {
    skips.push({ reason: 'missing grading company (could not infer)', cert: cleanCert, name: cleanName })
    continue
  }

  if (accumulator.has(cleanCert)) {
    skips.push({ reason: 'duplicate cert within this tab — skipped 2nd occurrence', cert: cleanCert, name: cleanName })
    continue
  }

  accumulator.set(cleanCert, {
    cert: cleanCert,
    co: cleanCo,
    name: cleanName,
    status: cleanStatus,
    listed_at: cleanStatus === 'listed' && cleanListed ? cleanListed : null,
    sale_date:   cleanStatus === 'sold'   && cleanListed ? cleanListed : null,
  })
  statusCounts[cleanStatus] = (statusCounts[cleanStatus] || 0) + 1
}

console.error(`Deduped + parsed: ${accumulator.size} slabs`)
console.error(`  in_inventory: ${statusCounts.in_inventory}`)
console.error(`  listed:       ${statusCounts.listed}`)
console.error(`  sold:         ${statusCounts.sold}`)
console.error(`Skipped: ${skips.length}`)

// ---- Build SQL ----
const out = []
out.push('-- ============================================================================')
out.push('-- Slabs import from boss\'s Google Sheet AZ CAC INV tab — 2026-05-15')
out.push('-- ============================================================================')
out.push('-- Source: scripts/_slabs_import_data.csv')
out.push(`-- Deduped slabs to insert: ${accumulator.size}`)
out.push(`--   IN_INVENTORY: ${statusCounts.in_inventory}`)
out.push(`--   LISTED:       ${statusCounts.listed}`)
out.push(`--   SOLD:         ${statusCounts.sold}`)
out.push(`-- Skipped rows: ${skips.length} (see stderr from the generator)`)
out.push('--')
out.push('-- Pre-req: scripts/create_slabs_table.sql must have run.')
out.push('-- Per user directive: only A/B/C/L cols imported. Prices/Notes intentionally skipped.')
out.push('-- Re-run safe via ON CONFLICT DO NOTHING on the partial cert_number UNIQUE index.')
out.push('-- ============================================================================')
out.push('')
out.push('BEGIN;')
out.push('')

for (const [cert, c] of accumulator) {
  out.push(`INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired${c.listed_at ? ', listed_at' : ''}${c.sale_date ? ', sale_date' : ''})`)
  out.push(`VALUES (`)
  out.push(`  ${sqlStr(c.cert)}, ${sqlStr(c.co)}, ${sqlStr(c.name)},`)
  out.push(`  ${sqlStr(c.status)}, CURRENT_DATE`)
  if (c.listed_at) out.push(`  , ${sqlStr(c.listed_at)}::date`)
  if (c.sale_date) out.push(`  , ${sqlStr(c.sale_date)}::date`)
  out.push(`)`)
  out.push(`ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;`)
  out.push('')
}

out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('-- Verify:')
out.push('--   SELECT count(*) AS total_slabs FROM slabs WHERE deleted = false;')
out.push(`--   -- expected: ${accumulator.size}`)
out.push('--')
out.push('--   SELECT status, count(*) FROM slabs WHERE deleted = false GROUP BY status;')
out.push(`--   -- expected: in_inventory=${statusCounts.in_inventory}, listed=${statusCounts.listed}, sold=${statusCounts.sold}`)
out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('')
out.push('COMMIT;')
out.push('-- ROLLBACK;     -- ← if numbers look wrong, run this instead')

fs.writeFileSync(path.join(ROOT, OUT), out.join('\n'))
console.error(`\nWrote ${OUT}`)
if (skips.length > 0) {
  console.error('\nSkipped rows:')
  for (const s of skips) {
    console.error(`  [${s.reason}] cert=${s.cert || '—'} name=${JSON.stringify(s.name)}`)
  }
}
