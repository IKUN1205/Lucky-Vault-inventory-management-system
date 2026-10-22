// Staff session token from /api/auth (D-20261021-04 step 1). Kept in localStorage and sent as X-LV-Session on
// every same-origin /api/ request, so the server knows who is calling (api/_lib/session.js).

const KEY = 'luckyvault_session'

export const getSessionToken = () => {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}

export const setSessionToken = (t) => {
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch { /* private mode */ }
}

const isOwnApi = (url) => {
  try {
    const u = new URL(url, window.location.origin)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch { return false }
}

// Wrap window.fetch once: add the header to our own /api/ calls only (never to Supabase or third parties).
export function installApiSession() {
  if (window.__lvApiSession) return
  window.__lvApiSession = true
  const orig = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    const token = getSessionToken()
    if (!token || !url || !isOwnApi(url)) return orig(input, init)
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
    if (!headers.has('X-LV-Session')) headers.set('X-LV-Session', token)
    return orig(input, { ...init, headers })
  }
}

export async function postJson(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  let data = {}
  try { data = await r.json() } catch { /* non-JSON error page */ }
  return { status: r.status, data }
}
