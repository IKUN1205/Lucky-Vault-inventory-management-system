// Roll back the "new singles" tab portion of the 2026-05-15 import.
// Boss said the NEW tab is "to-be-approved manually" — should not have
// landed in the DB. The HE (high end) tab IS approved → keep those rows.
//
// Logic:
//   - Parse both CSVs the same way the import script did.
//   - Classify every TCG ID as one of:
//       'he_only'    — soft-delete? NO, keep (this is approved inventory)
//       'new_only'   — SOFT-DELETE entirely
//       'both'       — DECREMENT qty by the NEW tab's contribution
//   - Emit cleanup SQL.
//
// Generates: scripts/rollback_singles_new_tab_2026_05_15.sql
//
// Run with:
//   node scripts/_build_singles_rollback_new_tab.mjs
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const FILES = [
  { tag: 'HE',  path: 'scripts/_singles_import_data_he.csv' },
  { tag: 'NEW', path: 'scripts/_singles_import_data_new.csv' },
]
const OUT = 'scripts/rollback_singles_new_tab_2026_05_15.sql'
const REASON = 'Boss directive — new tab not yet approved (2026-05-15)'

// ---- CSV parser (matches the original import script's parser) ----
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

// ---- Same row-filtering rules as the import script ----
function shouldKeep(name, set, tcg, qty) {
  if (/^Batch\s+\d+/i.test(name)) return false              // batch header
  if (!name || !tcg) return false                            // missing fields
  if (!qty || qty <= 0 || Number.isNaN(qty)) return false    // bad qty
  // Original script also skipped "incomplete entry (no set, name is just
  // number+abbrev)" — those weren't imported, so they don't need rolling back
  if (!set && /^\d+\/\d+\s+[A-Z]+$/.test(name)) return false
  return true
}

// ---- Build per-tab qty map: { tcg_id → qty in that tab } ----
function loadTab(filePath, tag) {
  const raw = fs.readFileSync(path.join(ROOT, filePath), 'utf8')
  const rows = parseCSV(raw)
  rows.shift() // header
  const map = new Map()
  for (const r of rows) {
    const [name, setRaw, , , qtyRaw, tcgRaw] = r
    const cleanName = (name || '').trim()
    const cleanSet = (setRaw || '').trim()
    const cleanTcg = (tcgRaw || '').replace(/[",]/g, '').trim()
    const cleanQty = parseInt((qtyRaw || '').replace(/[",]/g, ''), 10)
    if (!shouldKeep(cleanName, cleanSet, cleanTcg, cleanQty)) continue
    map.set(cleanTcg, (map.get(cleanTcg) || 0) + cleanQty)
  }
  console.error(`  ${tag}: ${map.size} unique TCG IDs`)
  return map
}

console.error('Parsing CSVs...')
const heMap = loadTab(FILES[0].path, FILES[0].tag)
const newMap = loadTab(FILES[1].path, FILES[1].tag)
console.error('')

// ---- Classify each TCG ID ----
const newOnly = []        // [tcgId, ...] → soft-delete entirely
const bothTabs = []       // [{ tcgId, newQty }, ...] → decrement qty
const heOnly = []         // just for the counter

for (const [tcg] of heMap) {
  if (!newMap.has(tcg)) heOnly.push(tcg)
}
for (const [tcg, newQty] of newMap) {
  if (heMap.has(tcg)) {
    bothTabs.push({ tcgId: tcg, newQty })
  } else {
    newOnly.push(tcg)
  }
}

console.error(`Classification:`)
console.error(`  HE-only (KEEP as is):           ${heOnly.length}`)
console.error(`  Both tabs (decrement qty):      ${bothTabs.length}`)
console.error(`  NEW-only (soft-delete):         ${newOnly.length}`)
console.error('')

// ---- Build the rollback SQL ----
const out = []
out.push('-- ============================================================================')
out.push('-- Singles inventory — roll back the 2026-05-15 import of the NEW tab')
out.push('-- ============================================================================')
out.push('-- Boss said the NEW tab should NOT have been imported (it is pending his')
out.push('-- manual approval, not yet live inventory). HE tab stays as-is.')
out.push('--')
out.push(`-- NEW-only TCG IDs to soft-delete: ${newOnly.length}`)
out.push(`-- Both-tab TCG IDs to decrement qty: ${bothTabs.length}`)
out.push(`-- HE-only TCG IDs (unchanged): ${heOnly.length}`)
out.push('--')
out.push('-- Wrapped in BEGIN/COMMIT. ROLLBACK if numbers look off after verify.')
out.push('-- ============================================================================')
out.push('')
out.push('BEGIN;')
out.push('')

// Section A: soft-delete NEW-only TCG IDs
if (newOnly.length > 0) {
  out.push('-- ───────────────────────────────────────────────────────────────────────────')
  out.push(`-- A. Soft-delete ${newOnly.length} NEW-only cards`)
  out.push('-- ───────────────────────────────────────────────────────────────────────────')
  // Use a single UPDATE with WHERE tcg_id IN (...) for efficiency
  out.push('UPDATE singles')
  out.push('   SET deleted = true,')
  out.push(`       deleted_at = now(),`)
  out.push(`       deleted_reason = ${sqlStr(REASON)}`)
  out.push(' WHERE deleted = false')
  out.push('   AND tcg_id IN (')
  // 8 per line for readability
  for (let i = 0; i < newOnly.length; i += 8) {
    const chunk = newOnly.slice(i, i + 8).map(sqlStr).join(', ')
    out.push(`     ${chunk}${i + 8 < newOnly.length ? ',' : ''}`)
  }
  out.push('   );')
  out.push('')
}

// Section B: decrement qty on both-tabs cards
if (bothTabs.length > 0) {
  out.push('-- ───────────────────────────────────────────────────────────────────────────')
  out.push(`-- B. Decrement qty for ${bothTabs.length} cards in BOTH tabs`)
  out.push('--    (we summed both tabs at import time → revert to HE-only count)')
  out.push('-- ───────────────────────────────────────────────────────────────────────────')
  for (const { tcgId, newQty } of bothTabs) {
    out.push(`UPDATE singles SET quantity = GREATEST(quantity - ${newQty}, 0)`)
    out.push(`  WHERE tcg_id = ${sqlStr(tcgId)} AND deleted = false;`)
  }
  out.push('')
}

out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('-- Verify BEFORE committing:')
out.push('--   -- Active cards should now equal HE-only count')
out.push('--   SELECT count(*) AS active_singles, sum(quantity) AS total_qty')
out.push("--   FROM singles WHERE form='raw' AND tcg_id IS NOT NULL AND deleted=false;")
out.push(`--   -- expected: ${heOnly.length + bothTabs.length} active singles`)
out.push('--')
out.push('--   -- Soft-deleted by this rollback')
out.push('--   SELECT count(*) AS soft_deleted_by_rollback FROM singles')
out.push(`--   WHERE deleted_reason = ${sqlStr(REASON)};`)
out.push(`--   -- expected: ${newOnly.length}`)
out.push('-- ───────────────────────────────────────────────────────────────────────────')
out.push('')
out.push('COMMIT;')
out.push('-- ROLLBACK;     -- ← if numbers look wrong, run this instead')

fs.writeFileSync(path.join(ROOT, OUT), out.join('\n'))
console.error(`Wrote ${OUT} (${out.length} lines)`)
console.error('')
console.error(`After rollback, expected active singles count: ${heOnly.length + bothTabs.length}`)
