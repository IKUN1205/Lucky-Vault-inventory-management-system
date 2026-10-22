// api/auth.js
//
// Staff sign-in, checked on the server (D-20261021-04 step 1; helpers in _lib/session.js).
//
// POST /api/auth?action=login         { pin }            -> { ok, user, token } | { ok:false, needsPicker, candidates, picker }
// POST /api/auth?action=login-as      { picker, user_id } -> { ok, user, token }      (after the shared-PIN picker)
// POST /api/auth?action=session       header X-LV-Session -> { ok, user, token }      (restore + slide the expiry)
// POST /api/auth?action=verify-admin  { pin }            -> { ok, valid }             (the Access Denied page)
//
// Wrong PINs, through the auth_attempts table (service key only). Every PIN attempt first writes its row (as a
// failure) and then counts, so a burst of parallel requests from one address sees itself and is refused together:
//   - an address with more than IP_LIMIT failures in IP_WINDOW_MIN minutes is refused (429) until the window passes.
//     Only failures FROM that address count, so outsiders can't lock the store out; the store itself would need
//     IP_LIMIT typos in 10 minutes.
//   - before that, each attempt waits 1 s more per failure past IP_FREE (max MAX_DELAY_MS);
//   - while failures across all addresses in GLOBAL_WINDOW_MIN minutes exceed GLOBAL_FREE (many addresses guessing),
//     everyone waits GLOBAL_DELAY_MS but nobody is refused, so a distributed guesser can't lock the store out.
// A PIN is never locked. If the limiter itself fails (table unreachable), sign-in still works and the error is logged.
// A 4-digit PIN has 10,000 values; the limits slow guessing, they don't make 4 digits strong. Longer PINs: PIN_LENGTH.

import {
  serviceClient, pinHash, validPinShape, issueSession, issuePicker, readPicker, sessionUserV,
  canSignIn, hasPin, isAdminRow, clientIp, credVersion, publicRow, USER_PUBLIC_COLUMNS,
} from './_lib/session.js'

export const config = { maxDuration: 20 }

const IP_WINDOW_MIN = 10
const IP_LIMIT = 30
const IP_FREE = 5
const MAX_DELAY_MS = 8000
const GLOBAL_WINDOW_MIN = 60
const GLOBAL_FREE = 100
const GLOBAL_DELAY_MS = 4000

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Write this attempt (as a failure), then count. -> { id, block, delayMs }
async function beginAttempt(supabase, ip, kind) {
  const since = (min) => new Date(Date.now() - min * 60000).toISOString()
  const ins = await supabase.from('auth_attempts').insert({ ip, ok: false, kind }).select('id').single()
  if (ins.error) {
    console.error('auth attempt not recorded', ins.error.message)
    return { id: null, block: false, delayMs: 0 }
  }
  const [byIp, all] = await Promise.all([
    supabase.from('auth_attempts').select('id', { count: 'exact', head: true })
      .eq('ok', false).eq('ip', ip).gte('at', since(IP_WINDOW_MIN)),
    supabase.from('auth_attempts').select('id', { count: 'exact', head: true })
      .eq('ok', false).gte('at', since(GLOBAL_WINDOW_MIN)),
  ])
  if (byIp.error || all.error) {
    console.error('auth rate limit check failed', byIp.error?.message || all.error?.message)
    return { id: ins.data.id, block: false, delayMs: 0 }
  }
  const ipFails = byIp.count || 0                 // includes this attempt
  const allFails = all.count || 0
  const ipDelay = ipFails > IP_FREE ? Math.min(MAX_DELAY_MS, (ipFails - IP_FREE) * 1000) : 0
  const globalDelay = allFails > GLOBAL_FREE ? GLOBAL_DELAY_MS : 0
  return { id: ins.data.id, block: ipFails > IP_LIMIT, delayMs: Math.max(ipDelay, globalDelay) }
}

async function markOk(supabase, id) {
  if (!id) return
  const { error } = await supabase.from('auth_attempts').update({ ok: true }).eq('id', id)
  if (error) console.error('auth attempt not marked ok', error.message)
}

// Active users whose PIN is this one. pin_hash first; plain pin only for rows not yet hashed.
// -> rows without the PIN columns, each with _v = credVersion (for the session token)
async function matchPin(supabase, pin) {
  const h = pinHash(pin)
  const { data, error } = await supabase
    .from('users')
    .select(USER_PUBLIC_COLUMNS + ',pin,pin_hash')
    .eq('active', true)
    .or(`pin_hash.eq.${h},and(pin_hash.is.null,pin.eq.${pin})`)
  if (error) throw new Error('user lookup failed')
  return (data || []).map(r => ({ ...publicRow(r), _v: credVersion(r) }))
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Use POST' })
  }
  const action = req.query?.action
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  let supabase
  try {
    supabase = serviceClient()
    pinHash('0000')                       // fail closed now if PIN_PEPPER is missing
    issueSession('probe', 'probe')        // ... or SESSION_SECRET
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Sign-in is not configured on the server' })
  }

  try {
    if (action === 'session') {
      const s = await sessionUserV(req, supabase)
      if (!s) return res.status(401).json({ ok: false, error: 'Session expired — please sign in again', code: 'no_session' })
      return res.status(200).json({ ok: true, user: s.user, token: issueSession(s.user.id, s.v) })
    }

    if (action === 'login-as') {
      const offered = readPicker(body.picker)            // [{ uid, v }] from the login that matched the PIN
      const uid = typeof body.user_id === 'string' ? body.user_id : ''
      const pick = offered && offered.find(c => c && c.uid === uid)
      if (!pick) return res.status(401).json({ ok: false, error: 'Please enter your PIN again' })
      const { data: row, error } = await supabase.from('users').select(USER_PUBLIC_COLUMNS + ',pin,pin_hash')
        .eq('id', uid).maybeSingle()
      if (error) throw error
      if (!canSignIn(row) || !hasPin(row)) return res.status(403).json({ ok: false, error: 'Account is disabled — contact your admin.' })
      // The PIN must be the same one the picker was issued for (it may have been changed in the 5 minutes since).
      if (credVersion(row) !== pick.v) return res.status(401).json({ ok: false, error: 'Please enter your PIN again' })
      return res.status(200).json({ ok: true, user: publicRow(row), token: issueSession(row.id, pick.v) })
    }

    if (action === 'login' || action === 'verify-admin') {
      const pin = String(body.pin ?? '')
      const ip = clientIp(req)
      const att = await beginAttempt(supabase, ip, action === 'verify-admin' ? 'admin' : 'login')
      if (att.block) {
        return res.status(429).json({ ok: false, error: 'Too many wrong PINs from this network — wait 10 minutes and try again' })
      }
      if (att.delayMs) await sleep(att.delayMs)
      const matches = validPinShape(pin) ? await matchPin(supabase, pin) : []
      const usable = matches.filter(canSignIn)

      if (action === 'verify-admin') {
        const valid = usable.some(isAdminRow)
        if (valid) await markOk(supabase, att.id)
        return res.status(200).json({ ok: true, valid })
      }

      if (usable.length > 0) await markOk(supabase, att.id)
      if (usable.length === 0) {
        return res.status(200).json({
          ok: false,
          error: matches.length ? 'Account is disabled — contact your admin.' : 'Invalid PIN',
        })
      }
      if (usable.length === 1) {
        const { _v, ...u } = usable[0]
        return res.status(200).json({ ok: true, user: u, token: issueSession(u.id, _v) })
      }
      return res.status(200).json({
        ok: false,
        needsPicker: true,
        candidates: usable.map(u => ({ id: u.id, name: u.name, role: u.role })),
        picker: issuePicker(usable.map(u => ({ uid: u.id, v: u._v }))),
      })
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' })
  } catch (e) {
    console.error('auth error', e?.message)
    return res.status(500).json({ ok: false, error: 'Sign-in failed — try again' })
  }
}
