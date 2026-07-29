// api/singles-price-detail.js
// GET /api/singles-price-detail?tcg_id=NNN
//
// Returns the boss's singles Google Sheet row for one TCG ID — most
// importantly column D "Prices" (the recent-sales text the daily
// refresh writes: "NM $61 (last sold 57, 57, 70) · eBay $54 (…)").
// That text lives ONLY on the sheet (no DB column — DDL is DBA-gated),
// so the Sell modal fetches it here at open time. Reads the same two
// link-readable gviz CSV tabs as sync-singles-sheet.js; Master wins
// when a TCG ID appears in both. Edge-cached 10 minutes.
//
// Response: { found, name, market, detail } (all null when not found).

const SHEET_ID = '14nuc6ckt5iPRAFkm7P6NAupbn_uXLwGyUsuVzQGFw80'
const SHEET_TABS = ['Master Singles', 'New Singles ']   // trailing space intentional
const buildSheetUrl = (sheetName) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`

// Same CSV parser as sync-singles-sheet.js (quoted fields, escaped quotes).
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
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c.trim() !== '')) rows.push(row) }
  return rows
}

export default async function handler(req, res) {
  const tcgId = String(req.query?.tcg_id || '').trim()
  if (!tcgId) return res.status(400).json({ error: 'tcg_id required' })

  try {
    // Sheet schema (verified 2026-07-29): A=Name B=Set C=Market$ D=Prices
    // E=Qty F=TCG ID G=Location H=Last Updated. Tabs checked in order, so
    // Master Singles wins over the New Singles landing tab.
    // Scan ALL rows — gviz CSV sometimes omits the header row (see
    // sync-singles-sheet.js), and an exact tcg_id match can never hit the
    // header cell ("TCG ID") anyway. Keep the LAST match within a tab to
    // mirror the sync route's later-row-wins Map semantics.
    for (const tab of SHEET_TABS) {
      const resp = await fetch(buildSheetUrl(tab))
      if (!resp.ok) continue
      const rows = parseCSV(await resp.text())
      let match = null
      for (const r of rows) {
        if ((r[5] || '').trim() === tcgId) match = r
      }
      if (match) {
        res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800')
        return res.status(200).json({
          found: true,
          name: (match[0] || '').trim() || null,
          market: (match[2] || '').trim() || null,
          detail: (match[3] || '').trim() || null,
        })
      }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800')
    return res.status(200).json({ found: false, name: null, market: null, detail: null })
  } catch (err) {
    console.error('[singles-price-detail] failed:', err)
    return res.status(502).json({ error: 'sheet fetch failed' })
  }
}
