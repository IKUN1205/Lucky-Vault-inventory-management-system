// api/_lib/session.js
//
// Server-side staff sign-in (D-20261021-04, lockdown step 1).
//
// Before this, the browser read the users table with the public anon key and compared the 4-digit PIN itself, so
// every PIN was readable by anyone holding the page, and a session was just a user id in localStorage (anyone could
// paste another id and become that person). Now:
//   - the PIN is checked here, against users.pin_hash = HMAC-SHA256(PIN_PEPPER, pin). The pepper lives only in the
//     Vercel env, never in the database, so a leaked pin_hash column is not a list of PINs. Until a row has a
//     pin_hash (backfill / rotation), the plain users.pin column is still accepted, read with the service key.
//   - a successful sign-in returns a session token: base64url(JSON {uid, iat, exp}) + "." + HMAC(SESSION_SECRET).
//     The browser sends it as the X-LV-Session header on every /api/ call (src/lib/apiSession.js).
//   - requireSession() re-reads the user row on every call, so deactivating someone or taking away a page takes
//     effect at once; nothing about permissions is trusted from the token itself.
//   - the token also carries v = a fingerprint of the user's current PIN (credVersion). Changing or resetting a PIN,
//     or the bulk rotation, changes it, so every session signed in with the old PIN stops working.
//
// Env (Vercel): SUPABASE_SERVICE_ROLE_KEY, PIN_PEPPER, SESSION_SECRET. Without them these helpers fail closed.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const SESSION_HEADER = 'x-lv-session'
const SESSION_DAYS = 14
const PICKER_SECONDS = 300

// Columns a browser may see. Never pin / pin_hash.
export const USER_PUBLIC_COLUMNS =
  'id,email,name,role,primary_region,can_login,high_value_access,active,created_at,updated_at,allowed_pages'

export function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

function secret(name) {
  const v = process.env[name]
  if (!v || v.length < 32) throw new Error(`${name} is not configured`)
  return v
}

export function pinHash(pin) {
  return crypto.createHmac('sha256', secret('PIN_PEPPER')).update(String(pin)).digest('hex')
}

export function validPinShape(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin)
}

const b64 = (s) => Buffer.from(s).toString('base64url')

function sign(payload) {
  const body = b64(JSON.stringify(payload))
  const mac = crypto.createHmac('sha256', secret('SESSION_SECRET')).update(body).digest('base64url')
  return `${body}.${mac}`
}

function unsign(token) {
  if (typeof token !== 'string' || token.length > 2000) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const mac = Buffer.from(token.slice(dot + 1))
  const want = Buffer.from(crypto.createHmac('sha256', secret('SESSION_SECRET')).update(body).digest('base64url'))
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null
  let p
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  if (!p || typeof p !== 'object' || typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return null
  return p
}

// Fingerprint of the credential a session was opened with. Needs the row's pin / pin_hash (service key only).
export function credVersion(row) {
  const cred = row?.pin_hash ? 'h:' + row.pin_hash : 'p:' + (row?.pin || '')
  return crypto.createHmac('sha256', secret('SESSION_SECRET')).update('cred-v1|' + cred).digest('base64url').slice(0, 22)
}

export function issueSession(uid, v) {
  const now = Math.floor(Date.now() / 1000)
  return sign({ k: 's', uid, v, iat: now, exp: now + SESSION_DAYS * 86400 })
}

// Shared-PIN picker: the people the PIN matched, each with the credVersion it matched, so login-as can only pick
// one of them and only while that PIN is still theirs.  cands = [{ uid, v }]
export function issuePicker(cands) {
  const now = Math.floor(Date.now() / 1000)
  return sign({ k: 'p', cands, iat: now, exp: now + PICKER_SECONDS })
}

export function readPicker(token) {
  const p = unsign(token)
  return p && p.k === 'p' && Array.isArray(p.cands) ? p.cands : null
}

export function readSession(token) {
  const p = unsign(token)
  return p && p.k === 's' && typeof p.uid === 'string' && typeof p.v === 'string' ? { uid: p.uid, v: p.v } : null
}

// A user row with the PIN columns removed (what may leave the server), plus its credVersion.
export function publicRow(row) {
  if (!row) return null
  const { pin: _p, pin_hash: _h, ...u } = row
  return u
}

// Active, login not switched off. (Rows read with the PIN columns must also have a PIN: see hasPin.)
export function canSignIn(u) {
  return !!u && u.active === true && u.can_login !== false
}

export function hasPin(row) {
  return !!(row && (row.pin_hash || row.pin))
}

export function isAdminRow(u) {
  return Array.isArray(u?.allowed_pages) && u.allowed_pages.includes('/users')
}

// The signed-in user for this request, re-read from the database, or null. -> { user, v }
export async function sessionUserV(req, supabase = serviceClient()) {
  const s = readSession(req.headers?.[SESSION_HEADER])
  if (!s) return null
  const { data, error } = await supabase.from('users').select(USER_PUBLIC_COLUMNS + ',pin,pin_hash')
    .eq('id', s.uid).maybeSingle()
  if (error || !canSignIn(data) || !hasPin(data)) return null
  const v = credVersion(data)
  if (v !== s.v) return null                  // PIN changed since this session was opened
  return { user: publicRow(data), v }
}

export async function sessionUser(req, supabase = serviceClient()) {
  const r = await sessionUserV(req, supabase)
  return r ? r.user : null
}

function isCron(req) {
  const s = process.env.CRON_SECRET
  return !!s && (req.headers?.authorization || '') === `Bearer ${s}`
}

// Gate for a route. Returns the user (or {cron: true}) when allowed; otherwise answers 401 / 403 / 500 and returns
// null, so a route does:   const who = await requireSession(req, res); if (!who) return
export async function requireSession(req, res, { admin = false, allowCron = false } = {}) {
  if (allowCron && isCron(req)) return { cron: true }
  let user
  try {
    user = await sessionUser(req)
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Sign-in is not configured on the server' })
    return null
  }
  if (!user) {
    res.status(401).json({ ok: false, error: 'Not signed in — please sign in again', code: 'no_session' })
    return null
  }
  if (admin && !isAdminRow(user)) {
    res.status(403).json({ ok: false, error: 'Admin access (Team Management) is required' })
    return null
  }
  return user
}

export function clientIp(req) {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return xf || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown'
}
