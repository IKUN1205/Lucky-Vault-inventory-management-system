// api/sync-slabs-sheet.js
// Vercel cron — pulls the slabs Google Sheet (Pokemon Slabs + One Piece
// Slabs tabs) and keeps the slabs table in sync. Twice a day, mirrors
// api/sync-singles-sheet.js.
//
// Policy (directive 2026-05-28):
//   - price = MP column → market_price_usd (refreshed only when changed)
//   - NEW certs are inserted at Master Inventory, status='in_inventory'
//     (staff Move them out later). List/LV/LS/Cost Basis carried over.
//   - existing certs: refresh market_price_usd only; location + status
//     are managed in-app and never overwritten.
//   - a cert with no Item Name imports with a placeholder name so it's
//     still scannable; staff fills the real name later.
//
// Both tabs share the same column layout:
//   0 Cert  1 Grade  2 Item Name  3 Pop  4 CL  5 MP  6 LS  7 List
//   8 LV  9 Note  10 Days  11 Status  12 Listed  13 Last Alert
//   14 Cost Basis  15 Location  16 Intake Date
//
// Vercel attaches Authorization: Bearer ${CRON_SECRET} when invoking.

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

const SHEET_ID = '1yaJ7MjUt8_iXTNU-Ss2WKYZYoXux0qjZjlRzNrePTuI'
// Tab names per directive 2026-05-29 — boss renamed them:
//   "Pokemon Master" / "One Piece Master" = main inventory (was "* Slabs")
//   "New Slabs" = staging zone for fresh arrivals (smaller column set; the
//                 parser tolerates missing trailing cols via index lookups
//                 that return undefined → null/default).
const SHEET_TABS = ['Pokemon Master', 'One Piece Master', 'New Slabs']
const buildSheetUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`

export const config = { maxDuration: 60 }

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

async function postLark(text) {
  if (!LARK_INVENTORY_IO) return
  try {
    await fetch(LARK_INVENTORY_IO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
  } catch (err) { console.error('[sync-slabs-sheet] Lark notify failed:', err) }
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const today = new Date().toISOString().slice(0, 10)
  const startedAt = Date.now()

  try {
    // 1. Pull both tabs.
    const tabSummary = []
    const allRows = []
    for (const tab of SHEET_TABS) {
      const r = await fetch(buildSheetUrl(tab))
      if (!r.ok) {
        const msg = `Sheet fetch failed for "${tab}": HTTP ${r.status}`
        console.error('[sync-slabs-sheet]', msg)
        await postLark(`⚠️ Slabs sheet sync FAILED — ${msg}`)
        return res.status(502).json({ error: msg })
      }
      const rows = parseCSV(await r.text())
      for (const row of rows) allRows.push(row)
      tabSummary.push({ tab, rows: rows.length })
    }

    // 2. Parse + dedupe by cert (cert is always a digit string; that skips
    //    every header variant — "Cert", "Cert #", "CERT" — plus junk rows).
    const byCert = new Map()
    let skipped = 0
    for (const r of allRows) {
      const cert = (r[0] || '').trim()
      if (!/^\d+$/.test(cert)) { skipped++; continue }
      let itemName = (r[2] || '').trim()
      if (!itemName) itemName = `(unnamed slab — cert ${cert})`
      byCert.set(cert, {
        cert_number: cert,
        grading_company: (r[1] || '').trim() || 'Other',
        item_name: itemName,
        market_price_usd: money(r[5]),
        last_sold_usd: money(r[6]),
        list_price_usd: money(r[7]),
        lv_price_usd: money(r[8]),
        acquisition_cost_usd: money(r[14]),
        date_acquired: dateOrNull(r[16]),
      })
    }
    const items = [...byCert.values()]
    console.log('[sync-slabs-sheet] tabs:', tabSummary, '→ unique certs:', items.length)

    // 3. Master Inventory id (all new slabs land here).
    const { data: masterRow } = await supabase
      .from('locations').select('id').eq('name', 'Master Inventory').maybeSingle()
    const masterId = masterRow?.id || null

    // 4. Which certs exist? Pull current MP too so we only PATCH deltas.
    const existing = new Map()
    const certs = items.map(i => i.cert_number)
    for (let i = 0; i < certs.length; i += 150) {
      const { data, error } = await supabase
        .from('slabs')
        .select('id, cert_number, market_price_usd')
        .in('cert_number', certs.slice(i, i + 150))
        .eq('deleted', false)
      if (error) throw error
      for (const r of data || []) existing.set(String(r.cert_number), r)
    }

    // 5. Update existing prices (changed only).
    let upd = 0, updErr = 0, updSkip = 0
    for (const it of items) {
      const ex = existing.get(it.cert_number)
      if (!ex) continue
      if (it.market_price_usd == null) { updSkip++; continue }
      if (ex.market_price_usd != null && Math.abs(Number(ex.market_price_usd) - it.market_price_usd) < 0.005) { updSkip++; continue }
      const { error } = await supabase.from('slabs')
        .update({ market_price_usd: it.market_price_usd })
        .eq('id', ex.id)
      if (error) { console.error('[sync-slabs-sheet] PATCH fail', it.cert_number, error.message); updErr++ }
      else upd++
    }

    // 6. Insert new certs at Master.
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
      date_acquired: it.date_acquired || today,
      notes: `Imported from slabs sheet on ${today} (auto-sync)`,
      deleted: false,
    }))
    let ins = 0, insErr = 0
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100)
      const { error } = await supabase.from('slabs').insert(batch)
      if (error) { console.error('[sync-slabs-sheet] INSERT batch fail:', error.message); insErr += batch.length }
      else ins += batch.length
    }

    const durationMs = Date.now() - startedAt
    const summary = {
      ok: true, tabs: tabSummary, unique_certs: items.length, skipped,
      existing_in_db: existing.size, prices_changed: upd, prices_unchanged: updSkip,
      price_errors: updErr, new_inserted: ins, insert_errors: insErr, duration_ms: durationMs,
    }
    console.log('[sync-slabs-sheet] OK', summary)

    const meaningful = ins > 0 || insErr > 0 || updErr > 0 || upd > 0
    if (meaningful) {
      const lines = ['🔄 Slabs sheet sync']
      if (ins > 0) lines.push(`✅ ${ins} new slab${ins === 1 ? '' : 's'} imported`)
      if (upd > 0) lines.push(`💲 ${upd} price${upd === 1 ? '' : 's'} changed`)
      if (insErr + updErr > 0) lines.push(`⚠️ ${insErr + updErr} errors — check logs`)
      lines.push(`Took ${Math.round(durationMs / 100) / 10}s · ${today}`)
      await postLark(lines.join('\n'))
    }
    return res.status(200).json(summary)
  } catch (err) {
    console.error('[sync-slabs-sheet] threw:', err)
    await postLark(`⚠️ Slabs sheet sync threw: ${err.message || err}`)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
