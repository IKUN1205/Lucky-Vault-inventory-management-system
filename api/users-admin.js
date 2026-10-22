// api/users-admin.js
//
// Writes to the users table, done on the server (D-20261021-04 step 1). The browser can no longer insert or update
// users with the public key, so Team Management and the Stream Counts "new person" box come through here.
//
// POST /api/users-admin?action=...   header X-LV-Session (see _lib/session.js)
//   create        admin  { name, allowed_pages, pin? }            -> { ok, user, pin }   pin shown once
//   update        admin  { id, name, allowed_pages, can_login, pin? }  -> { ok, user }
//   reset-pin     admin  { id }                                   -> { ok, pin }        pin shown once
//   set-active    admin  { id, active }                           -> { ok, user }
//   create-basic  any signed-in user { name }  (a name for counts; can_login=false, no PIN) -> { ok, user }
//
// PINs are stored only as pin_hash (HMAC with PIN_PEPPER); the plain pin column is cleared on every PIN write.
// A PIN must be unique among active users. New PINs are PIN_LENGTH digits (env, default 4).

import crypto from 'node:crypto'
import { serviceClient, requireSession, pinHash, validPinShape, USER_PUBLIC_COLUMNS } from './_lib/session.js'

const pinLength = () => {
  const n = parseInt(process.env.PIN_LENGTH || '4', 10)
  return n >= 4 && n <= 8 ? n : 4
}

function newPin() {
  const n = pinLength()
  return String(crypto.randomInt(10 ** (n - 1), 10 ** n))
}

async function pinTaken(supabase, pin, excludeId) {
  let q = supabase.from('users').select('id').eq('active', true)
    .or(`pin_hash.eq.${pinHash(pin)},and(pin_hash.is.null,pin.eq.${pin})`)
  if (excludeId) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) throw new Error('PIN check failed')
  return (data || []).length > 0
}

async function freshPin(supabase, excludeId) {
  for (let i = 0; i < 50; i++) {
    const p = newPin()
    if (!(await pinTaken(supabase, p, excludeId))) return p
  }
  throw new Error('Could not find a free PIN')
}

const cleanPages = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.startsWith('/')).slice(0, 200) : null
const cleanName = (v) => (typeof v === 'string' ? v.trim() : '').slice(0, 120)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Use POST' })
  }
  const action = req.query?.action
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  const who = await requireSession(req, res, { admin: action !== 'create-basic' })
  if (!who) return
  const supabase = serviceClient()

  try {
    if (action === 'create-basic') {
      const name = cleanName(body.name)
      if (!name) return res.status(400).json({ ok: false, error: 'Name is required' })
      const { data, error } = await supabase.from('users')
        .insert({ name, active: true, can_login: false }).select(USER_PUBLIC_COLUMNS).single()
      if (error) return res.status(409).json({ ok: false, error: error.message })
      return res.status(200).json({ ok: true, user: data })
    }

    if (action === 'create') {
      const name = cleanName(body.name)
      if (!name) return res.status(400).json({ ok: false, error: 'Please enter a name' })
      let pin = body.pin ? String(body.pin) : ''
      if (pin) {
        if (!validPinShape(pin)) return res.status(400).json({ ok: false, error: 'PIN must be 4–8 digits' })
        if (await pinTaken(supabase, pin)) return res.status(409).json({ ok: false, error: 'This PIN is already in use' })
      } else {
        pin = await freshPin(supabase)
      }
      const { data, error } = await supabase.from('users').insert({
        name, pin: null, pin_hash: pinHash(pin), active: true, can_login: true,
        allowed_pages: cleanPages(body.allowed_pages) || ['/'],
      }).select(USER_PUBLIC_COLUMNS).single()
      if (error) return res.status(409).json({ ok: false, error: error.message })
      return res.status(200).json({ ok: true, user: data, pin })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return res.status(400).json({ ok: false, error: 'id is required' })

    if (action === 'update') {
      const name = cleanName(body.name)
      if (!name) return res.status(400).json({ ok: false, error: 'Name cannot be empty' })
      const patch = {
        name,
        allowed_pages: cleanPages(body.allowed_pages) || ['/'],
        can_login: body.can_login !== false,
      }
      if (body.pin) {
        const pin = String(body.pin)
        if (!validPinShape(pin)) return res.status(400).json({ ok: false, error: 'PIN must be 4–8 digits' })
        if (await pinTaken(supabase, pin, id)) return res.status(409).json({ ok: false, error: 'This PIN is already in use' })
        patch.pin = null
        patch.pin_hash = pinHash(pin)
      }
      const { data, error } = await supabase.from('users').update(patch).eq('id', id).select(USER_PUBLIC_COLUMNS).maybeSingle()
      if (error) return res.status(409).json({ ok: false, error: error.message })
      if (!data) return res.status(404).json({ ok: false, error: 'User not found' })
      return res.status(200).json({ ok: true, user: data })
    }

    if (action === 'reset-pin') {
      const pin = await freshPin(supabase, id)
      const { data, error } = await supabase.from('users').update({ pin: null, pin_hash: pinHash(pin) })
        .eq('id', id).select('id').maybeSingle()
      if (error) return res.status(409).json({ ok: false, error: error.message })
      if (!data) return res.status(404).json({ ok: false, error: 'User not found' })
      return res.status(200).json({ ok: true, pin })
    }

    if (action === 'set-active') {
      const { data, error } = await supabase.from('users').update({ active: body.active === true })
        .eq('id', id).select(USER_PUBLIC_COLUMNS).maybeSingle()
      if (error) return res.status(409).json({ ok: false, error: error.message })
      if (!data) return res.status(404).json({ ok: false, error: 'User not found' })
      return res.status(200).json({ ok: true, user: data })
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' })
  } catch (e) {
    console.error('users-admin error', e?.message)
    return res.status(500).json({ ok: false, error: 'Could not save — try again' })
  }
}
