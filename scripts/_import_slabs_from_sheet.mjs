// One-shot import of the slabs Google Sheet into the slabs table.
//
// Policy (directive 2026-05-28):
//   - price = MP column → market_price_usd (blank if empty)
//   - all NEW slabs go to Master Inventory (staff will Move later)
//   - new slabs status = 'in_inventory'
//   - existing certs (already in DB): refresh market_price_usd only,
//     leave location/status alone (managed in-app now)
//
// Sheet columns (0-indexed):
//   0 Cert  1 Grade  2 Item Name  3 Pop  4 CL  5 MP  6 LS  7 List
//   8 LV  9 Note  10 Days  11 Status  12 Listed Date  13 Last Alert
//   14 Cost Basis  15 Location  16 Intake Date
//
// Run:
//   DRY_RUN=1 node scripts/_import_slabs_from_sheet.mjs   # preview
//   node scripts/_import_slabs_from_sheet.mjs             # apply
import fs from 'fs'

const SHEET_ID = '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI'
// Which tab to import. Tabs the user maintains:
//   "Pokemon Master"   — main Pokemon slab inventory (was "Pokemon Slabs")
//   "One Piece Master" — main OP slab inventory   (was "One Piece Slabs")
//   "New Slabs"        — staging zone for fresh arrivals (fewer columns,
//                        but the first 9 (Cert/Grade/Item Name/Pop/CL/
//                        MP/LS/List/LV) match, so the same parser works
//                        — Cost Basis / Intake Date come back null which
//                        falls through to defaults).
// Override with SHEET_TAB env var; defaults to Pokemon Master.
const SHEET_TAB = process.env.SHEET_TAB || 'Pokemon Master'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`
const TODAY = new Date().toISOString().slice(0, 10)
const DRY_RUN = process.env.DRY_RUN === '1'

const supabaseSrc = fs.readFileSync('src/lib/supabase.js', 'utf8')
const SUPABASE_URL = supabaseSrc.match(/['"`](https:\/\/[a-z0-9]+\.supabase\.co)['"`]/)?.[1]
const ANON_KEY = supabaseSrc.match(/eyJ[A-Za-z0-9._-]+/)?.[0]
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Could not find SUPABASE_URL / anon key')

const HEADERS = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
}

function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; continue }
      if (ch === '"') { q = false; continue }
      cell += ch; continue
    }
    if (ch === '"') { q = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []; continue
    }
    cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c.trim() !== '')) rows.push(row) }
  return rows
}
const money = (s) => { if (!s) return null; const m = String(s).replace(/,/g, '').match(/-?[\d.]+/); return m ? Number(m[0]) : null }
const dateOrNull = (s) => { const t = String(s || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null }

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: { apikey: ANON_KEY } })
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`)
  return r.json()
}
async function sb(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

async function main() {
  console.log(`Fetching slabs tab "${SHEET_TAB}"…`)
  const csv = await (await fetch(SHEET_URL)).text()
  const rows = parseCSV(csv)
  console.log(`  ${rows.length} rows (incl. header)`)

  // Parse + dedupe by cert (last occurrence wins). Skip header + rows with
  // no cert or no item name (both NOT NULL in the table).
  const byCert = new Map()
  let skipped = 0
  for (const r of rows) {
    const cert = (r[0] || '').trim()
    let itemName = (r[2] || '').trim()
    // Cert numbers are always digit strings. This skips the header row
    // (whatever it's labelled — "Cert", "Cert #", "CERT") and any junk /
    // empty rows in one robust check.
    if (!/^\d+$/.test(cert)) { skipped++; continue }
    // A cert with no name is still a real slab — import with a placeholder
    // name (item_name is NOT NULL) so it's scannable; staff fills the name
    // later. Don't drop it.
    if (!itemName) itemName = `(unnamed slab — cert ${cert})`
    byCert.set(cert, {
      cert_number: cert,
      grading_company: (r[1] || '').trim() || 'Other',
      item_name: itemName,
      market_price_usd: money(r[5]),   // MP
      last_sold_usd: money(r[6]),      // LS
      list_price_usd: money(r[7]),     // List
      lv_price_usd: money(r[8]),       // LV
      acquisition_cost_usd: money(r[14]), // Cost Basis
      date_acquired: dateOrNull(r[16]),   // Intake Date
    })
  }
  const items = [...byCert.values()]
  console.log(`  ${items.length} unique certs · ${skipped} skipped (header/empty)`)

  // Master Inventory location id — all new slabs land here per directive.
  const masterRow = await sbGet('/locations?select=id&name=eq.Master%20Inventory')
  const masterId = masterRow?.[0]?.id
  if (!masterId) throw new Error('Master Inventory location not found')

  // Which certs already exist?
  const existing = new Map()
  const certs = items.map(i => i.cert_number)
  for (let i = 0; i < certs.length; i += 150) {
    const inlist = certs.slice(i, i + 150).map(c => `"${c}"`).join(',')
    const data = await sbGet(`/slabs?select=id,cert_number,market_price_usd&cert_number=in.(${inlist})&deleted=eq.false`)
    for (const r of data) existing.set(String(r.cert_number), r)
  }
  console.log(`  ${existing.size} already in DB · ${items.length - existing.size} new`)

  // UPDATE existing: refresh market_price only when it changed.
  let upd = 0, updSkip = 0, updErr = 0
  for (const it of items) {
    const ex = existing.get(it.cert_number)
    if (!ex) continue
    if (it.market_price_usd == null) { updSkip++; continue }
    if (ex.market_price_usd != null && Math.abs(Number(ex.market_price_usd) - it.market_price_usd) < 0.005) { updSkip++; continue }
    if (DRY_RUN) { upd++; continue }
    try { await sb('PATCH', `/slabs?id=eq.${ex.id}`, { market_price_usd: it.market_price_usd }); upd++ }
    catch (e) { console.error('  PATCH fail', it.cert_number, e.message); updErr++ }
  }
  console.log(`  prices updated: ${upd} · skipped: ${updSkip} · errors: ${updErr}`)

  // INSERT new.
  const inserts = items.filter(it => !existing.has(it.cert_number)).map(it => ({
    cert_number: it.cert_number,
    grading_company: it.grading_company,
    item_name: it.item_name,
    status: 'in_inventory',
    location_id: masterId,
    market_price_usd: it.market_price_usd,
    last_sold_usd: it.last_sold_usd,
    list_price_usd: it.list_price_usd,
    lv_price_usd: it.lv_price_usd,
    acquisition_cost_usd: it.acquisition_cost_usd,
    date_acquired: it.date_acquired || TODAY,
    notes: `Imported from slabs sheet on ${TODAY}`,
    deleted: false,
  }))
  if (DRY_RUN) {
    console.log(`  [DRY] would insert ${inserts.length}. Sample:`)
    for (const s of inserts.slice(0, 3)) console.log('   ', JSON.stringify({ cert: s.cert_number, co: s.grading_company, mp: s.market_price_usd, name: s.item_name.slice(0, 40) }))
  } else {
    let ins = 0, insErr = 0
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100)
      try { await sb('POST', '/slabs', batch); ins += batch.length; process.stdout.write(`  inserted ${ins}/${inserts.length}\r`) }
      catch (e) { console.error('\n  INSERT batch fail:', e.message); insErr += batch.length }
    }
    console.log(`\n  inserted: ${ins} · errors: ${insErr}`)
  }

  console.log('\n=== summary ===')
  console.log(`  unique certs in sheet: ${items.length}`)
  console.log(`  existing (price refresh): ${existing.size}`)
  console.log(`  new (insert): ${inserts.length}`)
  console.log(`  skipped rows: ${skipped}`)
}
main().catch(e => { console.error(e); process.exit(1) })
