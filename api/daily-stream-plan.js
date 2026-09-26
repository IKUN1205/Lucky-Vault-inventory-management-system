// api/daily-stream-plan.js
// Daily 2 PM PT (21:00 UTC) cron: creates one EMPTY batch tab per streamer
// on shift TOMORROW in the Mystery sheet, pinned to the front of the tab
// bar. Prep happens the day before (William 2026-09-26): tabs exist by the
// evening so he can send the goods lists for the next day.
//
// Tab names are just "BATCH<n>" (William 2026-09-26: no streamer name or
// date in the title anymore). Every tab gets its own number — max BATCH<n>
// across ALL tab titles (old "M/D BATCH<n> <Streamer>" ones included) + 1.
//
// Who each BATCH belongs to lives in the "_LOG" tab at the far END of the
// tab bar: one row per created tab — date | batch | streamer. The cron uses
// it to stay idempotent (a re-run skips already-logged streamers), and
// fill/clear use it to resolve "streamer + date" → tab. The date is written
// with a leading apostrophe so Sheets keeps it as text (no serial-number
// round-trip surprises).
//
// Rows are added later, one ROW PER UNIT: col A = product name (William's
// wording), col B = sell price (he sends it with the goods list),
// col C = #number — left for the team to fill during prep/stream.
// Existing tabs are NEVER modified; pre-2026-09-26 tabs keep their old names.
//
// Manual:
//   ?dry=1           — show which tabs would be created (nothing written)
//   ?date=YYYY-MM-DD — act on that date instead of the default (PT). The
//                      create mode defaults to TOMORROW; fill/clear to today.
//   POST ?fill=1  { batch } or { streamer, date? }, plus items:[{name,price,qty}]
//                    — expand the goods list into rows (one per unit).
//                      Refuses if the tab already has rows, unless ?force=1.
//   POST ?clear=1 { batch } or { streamer, date? }
//                    — wipe the goods rows so the batch can be refilled
//                      (William reassigns a batch). Tabs from past days are
//                      refused — a streamed batch tab is the sales record.
//   POST ?price=1 { batch | streamer+date?, name, price }
//                    — write the sell price (col B) on every row whose col A
//                      matches `name`. For goods William listed without a
//                      price: rows go in with B blank, price patched later.

import { readRange, appendRows, clearRange, batchUpdateValues, getSheetIds, addSheetTab, moveSheetTab } from './_lib/google-sheets.js'

const CRON_SECRET = process.env.CRON_SECRET
const SHEET_ID = process.env.STREAM_PLAN_SHEET_ID
  || '14VritEQcTHAxg2VYybPsK9aC9tLKKwe_yqJxrf4rSl0'
const LOG_TAB = '_LOG'

export const config = { maxDuration: 60 }

// ---- roster + shifts (PT). getDay(): Sun=0 … Sat=6 ---------------------
// displayName matches how William refers to each streamer (LEXI is caps).
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
function ptPlusDays(n) {
  const d = new Date(`${ptToday()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const mdOf = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`
// Tab names may contain "/" — always quote them in A1 ranges.
const a1 = (tab, ref) => `'${tab}'!${ref}`

// Highest BATCH<n> across every tab title (old format, new format, manual).
function maxBatchNumber(tabTitles) {
  let max = 0
  for (const t of tabTitles) {
    const m = /BATCH(\d+)/i.exec(t)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

// Old-format tab ("M/D BATCH<n> <Streamer>") for a streamer on a day.
function findDayTab(tabTitles, md, name) {
  const re = new RegExp(`^${md.replace('/', '\\/')} BATCH\\d+ ${name}$`, 'i')
  return tabTitles.find(t => re.test(t)) || null
}

// _LOG rows ([date, batch, streamer]), optionally only for one date.
// Missing tab (first run) reads as empty.
async function logRows(dateFilter) {
  const rows = await readRange(SHEET_ID, a1(LOG_TAB, 'A:C')).catch(() => [])
  const list = (Array.isArray(rows) ? rows : []).filter(r => r?.length >= 2)
  return dateFilter ? list.filter(r => String(r[0]).trim() === dateFilter) : list
}

// fill/clear tab resolution: by batch number, or by streamer (+date).
async function resolveTab({ batch, streamer, date, md, tabs }) {
  if (batch != null) {
    const exact = tabs.find(t => t === `BATCH${Number(batch)}`)
    if (exact) return exact
    // old-format tabs also carry a batch number (may be shared by several
    // streamers on the same day — need the streamer to disambiguate)
    const re = new RegExp(`^\\d+\\/\\d+ BATCH${Number(batch)} `, 'i')
    const matches = tabs.filter(t => re.test(t))
    if (streamer) {
      const hit = matches.find(t => t.toLowerCase().endsWith(` ${String(streamer).toLowerCase()}`))
      if (hit) return hit
    }
    return matches.length === 1 ? matches[0] : null
  }
  if (streamer) {
    const log = await logRows(date)
    const hit = [...log].reverse()
      .find(r => String(r[2] || '').toLowerCase() === String(streamer).toLowerCase())
    if (hit) {
      const t = tabs.find(x => x === `BATCH${Number(hit[1])}`)
      if (t) return t
    }
    return findDayTab(tabs, md, streamer)
  }
  return null
}

// The PT date a tab belongs to, for the clear guard: old-format tabs carry
// M/D in the title; new-format ones are looked up in _LOG. Unknown → null.
async function tabDate(tab, year) {
  const old = /^(\d+)\/(\d+) BATCH\d+ /.exec(tab)
  if (old) return `${year}-${String(old[1]).padStart(2, '0')}-${String(old[2]).padStart(2, '0')}`
  const m = /^BATCH(\d+)$/.exec(tab)
  if (m) {
    const hit = (await logRows()).find(r => Number(r[1]) === Number(m[1]))
    if (hit) return String(hit[0]).trim()
  }
  return null
}

export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`
      && !req.query?.dry && !req.query?.date && !req.query?.fill && !req.query?.clear
      && !req.query?.price) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = (typeof req.body === 'object' && req.body) ? req.body : {}
  const explicitDate = req.query?.date || body.date || null
  // fill/clear/movefront default to today; the daily CREATE mode defaults
  // to TOMORROW (prep runs the afternoon before).
  const date = explicitDate || ptToday()
  const md = mdOf(date)

  // ---- fill: expand a goods list into one-row-per-unit -----------------
  if (req.query?.fill) {
    try {
      const { batch, streamer, items } = body
      if ((batch == null && !streamer) || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'POST JSON body needs { batch } or { streamer, date? }, plus items: [{name, price, qty}]' })
      }
      const tabs = [...(await getSheetIds(SHEET_ID)).keys()]
      let tab = await resolveTab({ batch, streamer, date, md, tabs })
      // "batch 33 is ..." for a tab that doesn't exist yet: create it at the
      // front and fill it in one go.
      if (!tab && batch != null) {
        tab = `BATCH${Number(batch)}`
        await addSheetTab(SHEET_ID, tab, 0)
      }
      if (!tab) return res.status(404).json({ error: `no tab found for ${streamer} on ${md}` })
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

  // ---- clear: wipe a day tab's rows so the batch can be redone ---------
  if (req.query?.clear) {
    try {
      const { batch, streamer } = body
      if (batch == null && !streamer) {
        return res.status(400).json({ error: 'POST JSON body needs { batch } or { streamer, date? }' })
      }
      const tabs = [...(await getSheetIds(SHEET_ID)).keys()]
      const tab = await resolveTab({ batch, streamer, date, md, tabs })
      if (!tab) return res.status(404).json({ error: `no tab found for ${batch != null ? `BATCH${batch}` : `${streamer} on ${md}`}` })
      // Past tabs are the team's sales record — never wipe them.
      const today = ptToday()
      const belongs = await tabDate(tab, today.slice(0, 4))
      if (belongs && belongs < today) {
        return res.status(400).json({ error: `refusing to clear "${tab}" (${belongs}) — batch tabs are history once the stream ran` })
      }
      const before = await readRange(SHEET_ID, a1(tab, 'A:A'))
      const rowsBefore = Array.isArray(before) ? before.filter(r => r?.length).length : 0
      await clearRange(SHEET_ID, a1(tab, 'A:C'))
      return res.status(200).json({ ok: true, tab, rows_cleared: rowsBefore })
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  // ---- price: patch col B on every row whose col A matches `name` ------
  if (req.query?.price) {
    try {
      const { batch, streamer, name, price } = body
      if ((batch == null && !streamer) || !name || price == null) {
        return res.status(400).json({ error: 'POST JSON body needs { batch } or { streamer, date? }, plus name + price' })
      }
      const tabs = [...(await getSheetIds(SHEET_ID)).keys()]
      const tab = await resolveTab({ batch, streamer, date, md, tabs })
      if (!tab) return res.status(404).json({ error: `no tab found for ${batch != null ? `BATCH${batch}` : `${streamer} on ${md}`}` })
      const colA = await readRange(SHEET_ID, a1(tab, 'A:A'))
      const want = String(name).trim().toLowerCase()
      const hits = []
      ;(Array.isArray(colA) ? colA : []).forEach((r, i) => {
        if (String(r?.[0] ?? '').trim().toLowerCase() === want) hits.push(i + 1) // 1-based row
      })
      if (!hits.length) return res.status(404).json({ error: `no rows in "${tab}" match "${name}"` })
      // group consecutive rows into one range each
      const updates = []
      let start = hits[0], prev = hits[0]
      for (const row of hits.slice(1).concat([-1])) {
        if (row === prev + 1) { prev = row; continue }
        updates.push({ range: a1(tab, `B${start}:B${prev}`),
          values: Array.from({ length: prev - start + 1 }, () => [price]) })
        start = prev = row
      }
      await batchUpdateValues(SHEET_ID, updates)
      return res.status(200).json({ ok: true, tab, name, price, rows_priced: hits.length })
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  // ---- movefront: pin a date's batch tabs to the front, roster order ---
  if (req.query?.movefront) {
    try {
      const tabMap = await getSheetIds(SHEET_ID)
      const titles = [...tabMap.keys()]
      const log = await logRows(date)
      const dayTabs = ROSTER
        .map(s => {
          const hit = [...log].reverse()
            .find(r => String(r[2] || '').toLowerCase() === s.displayName.toLowerCase())
          return (hit && titles.find(t => t === `BATCH${Number(hit[1])}`))
            || findDayTab(titles, md, s.displayName)
        })
        .filter(Boolean)
      for (let i = 0; i < dayTabs.length; i++) {
        await moveSheetTab(SHEET_ID, tabMap.get(dayTabs[i]), i)
      }
      const after = [...(await getSheetIds(SHEET_ID)).keys()].slice(0, dayTabs.length + 2)
      return res.status(200).json({ ok: true, moved: dayTabs, tab_bar_now_starts_with: after })
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) })
    }
  }

  // ---- daily: create TOMORROW's empty tabs, one per on-shift streamer --
  const target = explicitDate || ptPlusDays(1)
  const targetMd = mdOf(target)
  const onShift = ROSTER.filter(s => s.days.includes(dowOf(target)))
  if (!onShift.length) {
    return res.status(200).json({ ok: true, date: target, message: '当天没人排班,不建 tab', created: [] })
  }

  try {
    const tabMap = await getSheetIds(SHEET_ID)
    const tabs = [...tabMap.keys()]
    const logged = new Set((await logRows(target)).map(r => String(r[2] || '').toLowerCase()))
    const todo = onShift.filter(s => !logged.has(s.displayName.toLowerCase())
      && !findDayTab(tabs, targetMd, s.displayName))
    const skipped = onShift.filter(s => !todo.includes(s)).map(s => s.displayName)
    const batchNo = maxBatchNumber(tabs) + 1
    const plan = todo.map((s, i) => ({ tab: `BATCH${batchNo + i}`, streamer: s.displayName }))

    if (req.query?.dry) {
      return res.status(200).json({ ok: true, dry: true, date: target, would_create: plan, skipped })
    }
    // _LOG lives at the far end of the tab bar; create it on first use.
    if (!tabMap.has(LOG_TAB)) await addSheetTab(SHEET_ID, LOG_TAB)
    // Created EMPTY and pinned to the FRONT of the tab bar (William 2026-09-24:
    // today's tabs first so he sees them without scrolling), in roster order.
    for (let i = 0; i < plan.length; i++) await addSheetTab(SHEET_ID, plan[i].tab, i)
    if (plan.length) {
      await appendRows(SHEET_ID, a1(LOG_TAB, 'A1'),
        plan.map(p => [`'${target}`, Number(p.tab.replace('BATCH', '')), p.streamer]))
    }
    return res.status(200).json({ ok: true, date: target, created: plan, skipped })
  } catch (err) {
    console.error('[daily-stream-plan] failed:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
