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

  const resp = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  })
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
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`readRange failed (${resp.status}): ${text}`)
  }
  const data = await resp.json()
  return data.values || []
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
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`batchUpdateValues failed (${resp.status}): ${text}`)
  }
  return await resp.json()
}

/**
 * Hourly back-sync helper used by sync-singles-sheet + sync-slabs-sheet.
 * Reads every tab's id+status columns, finds rows whose id matches a
 * Supabase row with status='sold' but whose sheet status isn't 'sold'
 * yet, and writes 'sold' in one batched call.
 *
 * Returns { scanned, alreadySold, written, perTab[] }. Used in the sync
 * handler's response payload so the cron log shows what happened.
 *
 * Args:
 *   spreadsheetId    : the Google Sheet id
 *   tabs             : array of tab names to scan
 *   idColumn         : 0-based column where the cert/tcg lives
 *   statusColumn     : 0-based column where Status lives (target of write)
 *   soldIdsInDb      : Set<string> of cert/tcg numbers that are sold in DB
 */
export async function backsyncSoldStatus({
  spreadsheetId, tabs, idColumn, statusColumn, soldIdsInDb,
}) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { skipped: 'GOOGLE_SERVICE_ACCOUNT_JSON not set', written: 0 }
  }
  const updates = []
  const perTab = []
  for (const tab of tabs) {
    const maxColLetter = colToA1(Math.max(idColumn, statusColumn))
    const range = `${tab}!A1:${maxColLetter}5000`
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
    let scanned = 0, written = 0
    for (let r = 0; r < rows.length; r++) {
      const idCell = rows[r][idColumn]
      if (idCell == null || idCell === '') continue
      const idStr = String(idCell).trim()
      // Sheet header row will be in here too — skip non-numeric singles
      // tcg / cert ids. Cert numbers are always digit strings; tcg ids
      // same. This double-purposes as a header-row filter.
      if (!/^\d+$/.test(idStr)) continue
      scanned++
      if (!soldIdsInDb.has(idStr)) continue
      const currentStatus = String(rows[r][statusColumn] || '').trim().toLowerCase()
      if (currentStatus === 'sold') continue
      updates.push({ range: cellA1(tab, r, statusColumn), values: [['sold']] })
      written++
    }
    perTab.push({ tab, scanned, queued: written })
  }
  if (updates.length === 0) return { written: 0, perTab }
  // Chunk to keep the request well under the 100 MB limit (we won't hit
  // it but a sanity cap means a future 10,000-row sheet doesn't blow up).
  let totalWritten = 0
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500)
    const r = await batchUpdateValues(spreadsheetId, chunk)
    totalWritten += r.totalUpdatedCells ?? chunk.length
  }
  return { written: totalWritten, perTab }
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
