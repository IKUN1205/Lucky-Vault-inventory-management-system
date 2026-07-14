// api/_lib/google-sheets.js
// Lightweight Google Sheets API client. Pure stdlib (node:crypto + fetch) —
// no `googleapis` package because we only need two endpoints:
//   1. POST /token  (exchange a self-signed JWT for an access token)
//   2. spreadsheets.values endpoints  (read sheets / batch update cells)
//
// The service account JSON lives in env GOOGLE_SERVICE_ACCOUNT_JSON.
// Created and shared with both sheets (Singles + Slabs) as Editor per the
// 2026-06-04 directive enabling system→sheet back-sync.

import { createSign } from 'crypto'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

let _credsCache = null
function getCreds() {
  if (_credsCache) return _credsCache
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set')
  let json
  try { json = JSON.parse(raw) }
  catch (e) { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message) }
  if (!json.client_email || !json.private_key) {
    throw new Error('Service account JSON missing client_email or private_key')
  }
  _credsCache = json
  return json
}

// base64url encoder (no `=` padding, `+`→`-`, `/`→`_`) — JWT spec.
const b64url = (buf) =>
  Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

// fetch() with exponential-backoff retry on TRANSIENT failures only. Google's
// Sheets backend returns 429 (rate) / 500 / 502 / 503 / 504 on momentary
// overload — e.g. the 503 UNAVAILABLE that failed the 2026-07-01 04:48 audit.
// Google's own guidance is to retry these with backoff. 4xx (bad range, auth)
// are NOT retried (they won't self-heal) — we hand the response back so the
// caller throws with the real status + body as before. Network errors retry too.
// Bounded (default 4 tries, ~0.4+0.8+1.6s ≈ 2.8s worst case) so it stays well
// within the Vercel cron function budget.
const _RETRYABLE = new Set([429, 500, 502, 503, 504])
async function fetchRetry(url, options = {}, { tries = 4, label = 'sheets' } = {}) {
  let lastResp = null
  let lastErr = null
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(4000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200)
      await new Promise((r) => setTimeout(r, backoff))
    }
    try {
      const resp = await fetch(url, options)
      if (resp.ok || !_RETRYABLE.has(resp.status)) return resp // success or non-transient → caller handles
      if (lastResp) { try { await lastResp.body?.cancel() } catch { /* ignore */ } } // free the prior held body
      lastResp = resp // transient status → remember the last one and retry
    } catch (e) {
      lastErr = e // network/DNS blip → retry
    }
  }
  if (lastResp) return lastResp // exhausted retries → let the caller throw with the real status + body
  throw lastErr || new Error(`${label} failed after ${tries} attempts`)
}

// In-memory cached access token. Google tokens last 3600s; we refresh at
// 3000s to leave a comfortable margin and avoid clock-skew failures.
let _tokenCache = null
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  if (_tokenCache && _tokenCache.expiresAt - 60 > now) return _tokenCache.token

  const creds = getCreds()
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: creds.client_email,
    scope: SCOPE,
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const signature = b64url(signer.sign(creds.private_key))
  const jwt = `${header}.${claim}.${signature}`

  const resp = await fetchRetry(creds.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  }, { label: 'token' })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Google token exchange failed: ${resp.status} ${text}`)
  }
  const data = await resp.json()
  if (!data.access_token) throw new Error('Google token response missing access_token')
  _tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  }
  return _tokenCache.token
}

/**
 * Read a range from a sheet. Returns the raw `values` 2D array (or [] if
 * the range is empty). Used to FIND the row index of a cert/tcg before
 * writing. Range = standard A1 notation, e.g. "Master Singles!F2:F1000".
 */
export async function readRange(spreadsheetId, range) {
  const token = await getAccessToken()
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`
    + `?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
  const resp = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } }, { label: 'readRange' })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`readRange failed (${resp.status}): ${text}`)
  }
  const data = await resp.json()
  return data.values || []
}

/**
 * Read a range INCLUDING text formatting — specifically strikethrough,
 * which the gviz CSV export can't carry. Used by the slabs sync: boss's
 * convention is that a crossed-out row = sold, so the sync must see the
 * strikethrough to know which rows to skip.
 *
 * Returns an array of { cells: string[], struck: boolean[] } — one entry
 * per sheet row, index-aligned with A1 row numbers (rows[0] = sheet row 1).
 */
export async function readGridWithFormat(spreadsheetId, rangeA1) {
  const token = await getAccessToken()
  const fields = 'sheets(data(rowData(values(formattedValue,effectiveFormat.textFormat.strikethrough))))'
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
    + `?ranges=${encodeURIComponent(rangeA1)}&includeGridData=true`
    + `&fields=${encodeURIComponent(fields)}`
  const resp = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } }, { label: 'readGridWithFormat' })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`readGridWithFormat failed (${resp.status}): ${text}`)
  }
  const data = await resp.json()
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || []
  return rowData.map(r => ({
    cells: (r.values || []).map(v => v?.formattedValue ?? ''),
    struck: (r.values || []).map(v => !!v?.effectiveFormat?.textFormat?.strikethrough),
  }))
}

/**
 * Update multiple ranges in one call. `updates` = [{ range, values }],
 * where `values` is a 2D array. Uses USER_ENTERED so a string "sold"
 * stays a string rather than being parsed as anything weird.
 *
 * Returns the API response (mostly for logging).
 */
export async function batchUpdateValues(spreadsheetId, updates) {
  if (!updates || updates.length === 0) return { updatedCells: 0 }
  const token = await getAccessToken()
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`
  const resp = await fetchRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates,
    }),
  }, { label: 'batchUpdateValues' })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`batchUpdateValues failed (${resp.status}): ${text}`)
  }
  return await resp.json()
}

/**
 * Atomically append rows to the END of a tab's data table. Uses the Sheets
 * values:append API with INSERT_ROWS, so Google finds the last row itself —
 * no read-then-write race (two concurrent callers can't overwrite each other,
 * unlike computing nextRow client-side). `range` is any A1 range inside the
 * target tab, e.g. "SEALED AUDIT!A1".
 */
export async function appendRows(spreadsheetId, range, rows) {
  if (!rows || rows.length === 0) return { updates: { updatedRows: 0 } }
  const token = await getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/`
    + `${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  const resp = await fetchRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  }, { label: 'appendRows' })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`appendRows failed (${resp.status}): ${text}`)
  }
  return await resp.json()
}

/**
 * Hourly back-sync helper used by sync-singles-sheet + sync-slabs-sheet.
 *
 * MODE A (slabs — no qtyColumn): for each sheet row whose id is in
 *   soldIdsInDb, write 'sold' to the Status column if it isn't there yet.
 *   Slabs are unique items (qty always 1), so a sold slab is just sold.
 *
 * MODE B (singles — qtyColumn provided): for each sheet row whose id has
 *   any sold row in DB, look up the REMAINING (non-sold) qty for that id:
 *     - remaining > 0 → write that number to the qty column if it differs
 *       (don't touch status — there are still units in inventory).
 *     - remaining == 0 → write 'sold' to status (and 0 to qty) if needed.
 *   This avoids prematurely marking a qty=5 card as "sold" when only 1
 *   was sold — staff would lose track of the other 4.
 *
 * Returns { written, perTab[], message }. message is a one-line human
 * summary that gets echoed to Vercel cron logs.
 *
 * Args:
 *   spreadsheetId    : Google Sheet id
 *   tabs             : array of tab names to scan
 *   idColumn         : 0-based column where the cert/tcg lives
 *   statusColumn     : 0-based column where Status lives (target of write)
 *   qtyColumn        : OPTIONAL. 0-based column where qty lives (singles only)
 *   soldIdsInDb      : Set<string> of cert/tcg numbers that have any sold row in DB
 *   remainingByTcg   : OPTIONAL. Map<string, number> of tcg → live non-sold qty
 *                      sum. Required when qtyColumn is set.
 *   strikeRows       : OPTIONAL. When true, every row that gets 'sold'
 *                      written ALSO gets the whole row crossed out
 *                      (strikethrough) — the slabs sheet's visual sold
 *                      convention per boss directive 2026-06-08.
 */
export async function backsyncSoldStatus({
  spreadsheetId, tabs, idColumn, statusColumn,
  qtyColumn, soldIdsInDb, remainingByTcg, strikeRows = false,
}) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { skipped: 'GOOGLE_SERVICE_ACCOUNT_JSON not set', written: 0,
             message: 'Skipped — GOOGLE_SERVICE_ACCOUNT_JSON env var not set.' }
  }
  const updates = []
  const strikes = []   // [{ tab, rowIndex }] rows to cross out (strikeRows mode)
  const perTab = []
  for (const tab of tabs) {
    const widestCol = Math.max(idColumn, statusColumn, qtyColumn ?? 0)
    const range = `${tab}!A1:${colToA1(widestCol)}5000`
    let rows
    try {
      rows = await readRange(spreadsheetId, range)
    } catch (e) {
      if (String(e.message).includes('Unable to parse range')) {
        perTab.push({ tab, skipped: 'missing tab' })
        continue
      }
      throw e
    }
    let scanned = 0
    let queuedStatus = 0, queuedQty = 0
    for (let r = 0; r < rows.length; r++) {
      const idCell = rows[r][idColumn]
      if (idCell == null || idCell === '') continue
      const idStr = String(idCell).trim()
      // Skip header rows + junk — both cert and tcg are pure digit strings.
      if (!/^\d+$/.test(idStr)) continue
      scanned++
      if (!soldIdsInDb.has(idStr)) continue
      const currentStatus = String(rows[r][statusColumn] || '').trim().toLowerCase()

      // ─── Singles: decide qty vs status based on remaining ────────────
      if (qtyColumn != null) {
        const remaining = remainingByTcg?.get(idStr) ?? 0
        const sheetQty = Number(rows[r][qtyColumn]) || 0
        if (remaining > 0) {
          // Some units left — sync qty cell, and CLEAR a stale "sold"
          // status (card sold out once, later re-added/found — the app
          // is live again so the old sold marker must go).
          if (sheetQty !== remaining) {
            updates.push({ range: cellA1(tab, r, qtyColumn), values: [[remaining]] })
            queuedQty++
          }
          if (currentStatus === 'sold') {
            updates.push({ range: cellA1(tab, r, statusColumn), values: [['']] })
            queuedStatus++
          }
        } else {
          // All sold — write 'sold' to status (and zero qty if needed).
          if (currentStatus !== 'sold') {
            updates.push({ range: cellA1(tab, r, statusColumn), values: [['sold']] })
            queuedStatus++
          }
          if (sheetQty !== 0) {
            updates.push({ range: cellA1(tab, r, qtyColumn), values: [[0]] })
            queuedQty++
          }
        }
        continue
      }

      // ─── Slabs: always mark sold ────────────────────────────────────
      if (currentStatus === 'sold') continue
      updates.push({ range: cellA1(tab, r, statusColumn), values: [['sold']] })
      if (strikeRows) strikes.push({ tab, rowIndex: r })
      queuedStatus++
    }
    perTab.push({ tab, scanned, status_writes: queuedStatus, qty_writes: queuedQty,
                  queued: queuedStatus + queuedQty })
  }
  if (updates.length === 0) {
    return {
      written: 0,
      perTab,
      message: 'Every sold item is already marked sold in the sheet — nothing to write.',
    }
  }
  // Chunk to keep the request well under the 100 MB limit (we won't hit
  // it but a sanity cap means a future 10,000-row sheet doesn't blow up).
  let totalWritten = 0
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500)
    const r = await batchUpdateValues(spreadsheetId, chunk)
    totalWritten += r.totalUpdatedCells ?? chunk.length
  }
  // Cross out the same rows when the caller asked for it (slabs). Failures
  // here are non-fatal — the status text already landed, the cross is the
  // visual layer; the next hourly run re-tries idempotently.
  let totalStruck = 0
  if (strikeRows && strikes.length > 0) {
    try {
      const sheetIds = await getSheetIds(spreadsheetId)
      const entries = strikes
        .map(s => ({ sheetId: sheetIds.get(s.tab), rowIndex: s.rowIndex }))
        .filter(e => e.sheetId != null)
      for (let i = 0; i < entries.length; i += 500) {
        const r = await applyRowStrikethrough(spreadsheetId, entries.slice(i, i + 500))
        totalStruck += r.struck
      }
    } catch (e) {
      console.warn('[backsyncSoldStatus] strikethrough failed (non-fatal):', e.message)
    }
  }
  const tabSummary = perTab
    .filter(t => t.queued > 0)
    .map(t => `${t.queued} in "${t.tab}"`)
    .join(', ')
  return {
    written: totalWritten,
    struck: totalStruck,
    perTab,
    message: `Marked ${totalWritten} row${totalWritten === 1 ? '' : 's'} as sold` +
             (totalStruck ? `, crossed out ${totalStruck}` : '') +
             (tabSummary ? ` (${tabSummary}).` : '.'),
  }
}

/**
 * Resolve tab titles → numeric sheetIds (needed for formatting requests,
 * which address tabs by sheetId rather than title).
 */
export async function getSheetIds(spreadsheetId) {
  const token = await getAccessToken()
  const resp = await fetchRetry(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`,
    { headers: { Authorization: `Bearer ${token}` } },
    { label: 'getSheetIds' }
  )
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`getSheetIds failed (${resp.status}): ${text}`)
  }
  const data = await resp.json()
  const map = new Map()
  for (const s of data.sheets || []) map.set(s.properties.title, s.properties.sheetId)
  return map
}

/**
 * Cross out (strikethrough) whole rows — the boss's visual convention for
 * "sold" on the slabs sheet (directive 2026-06-08: when the app feeds a
 * sale back to the sheet, mark it by crossing the row out).
 *
 * rows = [{ sheetId, rowIndex }] with 0-based row indexes. One
 * spreadsheets.batchUpdate call covers all rows. Re-striking an
 * already-struck row is harmless (idempotent).
 */
export async function applyRowStrikethrough(spreadsheetId, rows) {
  if (!rows || rows.length === 0) return { struck: 0 }
  const token = await getAccessToken()
  const requests = rows.map(r => ({
    repeatCell: {
      range: { sheetId: r.sheetId, startRowIndex: r.rowIndex, endRowIndex: r.rowIndex + 1 },
      cell: { userEnteredFormat: { textFormat: { strikethrough: true } } },
      fields: 'userEnteredFormat.textFormat.strikethrough',
    },
  }))
  const resp = await fetchRetry(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    },
    { label: 'applyRowStrikethrough' }
  )
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`applyRowStrikethrough failed (${resp.status}): ${text}`)
  }
  return { struck: rows.length }
}

/**
 * Insert `count` blank rows at 0-based `startIndex` (rows at/after that
 * index shift down). Used by the sold-ledger appender to open space ABOVE
 * the TOTAL row before writing values. inheritFromBefore keeps the new
 * rows formatted like the data rows above them, not like TOTAL.
 */
export async function insertRows(spreadsheetId, sheetId, startIndex, count) {
  if (!count || count <= 0) return
  const token = await getAccessToken()
  // NOT routed through fetchRetry (Codex 2026-07-01): insertDimension is a RELATIVE mutation —
  // inserting `count` rows. If Google applied it but returned/lost a transient response, a retry
  // would insert DUPLICATE rows and shift the sheet again. A rare transient here just fails this
  // append; the caller / next hourly run handles it. (Reads + deterministic-value writes retry;
  // this relative row-insert must not.)
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + count },
            inheritFromBefore: true,
          },
        }],
      }),
    }
  )
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`insertRows failed (${resp.status}): ${text}`)
  }
}

// Column index → A1 letter ("A", "B", …, "Z", "AA", "AB", …). Inputs are
// zero-based. Lets the caller think in terms of "Status is column 11"
// instead of having to spell out "L" themselves.
export function colToA1(col) {
  let n = col + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Convenience: "Tab Name" + 0-based row + 0-based col → "Tab Name!B5".
// Sheet ranges are 1-indexed in A1 notation, so we +1 the row.
export function cellA1(tabName, row, col) {
  return `${tabName}!${colToA1(col)}${row + 1}`
}
