// api/daily-stream-plan.js
// Daily 5 AM PT (12:00 UTC) cron: creates each on-shift streamer's EMPTY
// batch tab in the Mystery sheet, named exactly like the team's manual ones:
//   "M/D BATCH<n> <Streamer>"   e.g.  "9/25 BATCH25 LEXI"
//
// Format learned from the team's real tabs (2026-09-24 screenshot):
//   - one tab per streamer per day, created blank (no header row)
//   - BATCH number auto-continues: max BATCH<n> across all tab titles + 1;
//     every tab created in the same run shares that new number
//   - rows are added later, one ROW PER UNIT: col A = product name (William's
//     wording), col B = sell price (he sends it with the goods list),
//     col C = #number — left for the team to fill during prep/stream
//   - existing tabs are NEVER modified; a streamer who already has a tab for
//     the day is skipped
//
// Manual:
//   ?dry=1           — show which tabs would be created (nothing written)
//   ?date=YYYY-MM-DD — act on that date instead of today (PT)
//   POST ?fill=1 { date?, streamer, items: [{ name, price, qty }] }
//                    — expand the goods list into rows (one per unit) in that
//                      streamer's tab for the day. Refuses if the tab already
//                      has rows, unless ?force=1 (append anyway).

import { readRange, appendRows, getSheetIds, addSheetTab } from './_lib/google-sheets.js'

const CRON_SECRET = process.env.CRON_SECRET
const SHEET_ID = process.env.STREAM_PLAN_SHEET_ID
  || '14VritEQcTHAxg2VYybPsK9aC9tLKKwe_yqJxrf4rSl0'

export const config = { maxDuration: 60 }

// ---- roster + shifts (PT). getDay(): Sun=0 … Sat=6 ---------------------
// displayName matches the team's tab spelling exactly (LEXI is caps).
const ROSTER = [
  { displayName: 'Quynh', days: [1, 2, 4, 5] },
  { displayName: 'LEXI',  days: [1, 2, 4, 5, 6] },
  { displayName: 'Jacob', days: [1, 2, 3, 4, 5, 6] },
  { displayName: 'Jace',  days: [2, 3, 4, 5] },
]

function ptToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = t => parts.find(p => p.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
const dowOf = ymd => new Date(`${ymd}T12:00:00Z`).getUTCDay()
const mdOf = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`
// Tab names contain "/" — always quote them in A1 ranges.
const a1 = (tab, ref) => `'${tab}'!${ref}`

// Highest BATCH<n> across every tab title (manual or ours).
function maxBatchNumber(tabTitles) {
  let max = 0
  for (const t of tabTitles) {
    const m = /BATCH(\d+)/i.exec(t)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

// A streamer's existing tab for the day, regardless of batch number.
function findDayTab(tabTitles, md, name) {
  const re = new RegExp(`^${md.replace('/', '\\/')} BATCH\\d+ ${name}$`, 'i')
  return tabTitles.find(t => re.test(t)) || null
}

export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`
      && !req.query?.dry && !req.query?.date && !req.query?.fill) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const date = req.query?.date || body.date || ptToday()
  const md = mdOf(date)
  const dow = dowOf(date)

  // ---- fill: expand a goods list into one-row-per-unit -----------------
  if (req.query?.fill) {
    try {
      const { streamer, items } = body
      if (!streamer || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'POST JSON body needs { streamer, items: [{name, price, qty}] } (date optional)' })
      }
      const tabs = [...(await getSheetIds(SHEET_ID)).keys()]
      const tab = findDayTab(tabs, md, streamer)
      if (!tab) return res.status(404).json({ error: `no tab for ${streamer} on ${md} — create the day's tabs first` })
      if (!req.query?.force) {
        const existing = await readRange(SHEET_ID, a1(tab, 'A1:A3'))
        if (Array.isArray(existing) && existing.some(r => r?.length)) {
          return res.status(409).json({ error: `tab "${tab}" already has rows — use ?force=1 to append anyway` })
        }
      }
      const rows = []
      for (const it of items) {
        const qty = Math.max(1, parseInt(it.qty, 10) || 1)
        for (let i = 0; i < qty; i++) rows.push([it.name, it.price ?? ''])
      }
      await appendRows(SHEET_ID, a1(tab, 'A1'), rows)
      return res.status(200).json({ ok: true, tab, rows_written: rows.length,
        items: items.map(i => `${i.name} ×${i.qty}${i.price != null ? ` @${i.price}` : ''}`) })
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  // ---- daily: create today's empty tabs, one per on-shift streamer -----
  const onShift = ROSTER.filter(s => s.days.includes(dow))
  if (!onShift.length) {
    return res.status(200).json({ ok: true, date, message: '当天没人排班,不建 tab', created: [] })
  }

  try {
    const tabs = [...(await getSheetIds(SHEET_ID)).keys()]
    const todo = onShift.filter(s => !findDayTab(tabs, md, s.displayName))
    const batchNo = maxBatchNumber(tabs) + 1
    const names = todo.map(s => `${md} BATCH${batchNo} ${s.displayName}`)

    if (req.query?.dry) {
      return res.status(200).json({ ok: true, dry: true, date, batchNo,
        would_create: names,
        skipped: onShift.filter(s => findDayTab(tabs, md, s.displayName)).map(s => s.displayName) })
    }
    for (const n of names) await addSheetTab(SHEET_ID, n)   // created EMPTY
    return res.status(200).json({ ok: true, date, batchNo, created: names,
      skipped: onShift.filter(s => findDayTab(tabs, md, s.displayName)).map(s => s.displayName) })
  } catch (err) {
    console.error('[daily-stream-plan] failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
