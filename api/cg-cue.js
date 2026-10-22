// api/cg-cue.js
// ============================================================================
// Stream CG trigger endpoint — fire a livestream overlay animation via a
// plain HTTP request. This is what a physical button board (Elgato Stream
// Deck) hits: each key is configured to GET a URL like
//   https://<domain>/api/cg-cue?room=main&anim=hype
// and that makes the OBS overlay (cg-overlay.html, subscribed to the
// Supabase Realtime channel lv-cg-<room>) play that animation.
//
// How it works: we forward the cue to Supabase's Realtime BROADCAST REST
// endpoint, which injects a `cue` event into the channel. Any subscriber
// (the overlay) receives it instantly. No persistent socket needed here —
// the serverless function does one fetch and returns. Verified working with
// the anon key (HTTP 202 → overlay receives payload).
//
// Query params (GET) or JSON body (POST):
//   anim   — required: sold | welcome | hype | countdown | auction | clear
//   room   — channel name, default 'main' (must match the OBS overlay URL)
//   text   — hype: custom big text (optional)
//   item   — sold: product name (optional)
//   price  — sold: price string e.g. "$120" (optional)
//   name   — welcome: buyer name (optional)
//   from   — countdown: starting number (optional, default 3)
//   step   — auction: once | twice | sold (optional, default 'once')
//   token  — only required if env CG_CUE_TOKEN is set (anti-abuse)
//
// Stream Deck can't type, so physical keys are best for the no-text cues
// (hype / countdown / auction / sold-without-price). The phone control
// panel (cg-control.html) stays for the ones that need a typed name/price.
// ============================================================================

export const config = { maxDuration: 30 }

// Current project only, public anon key: broadcast needs nothing more, and this route is open to the Stream Deck,
// so it must never act with the service key (D-20261021-04). No fallback to the retired project.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY

const VALID_ANIMS = new Set(['sold', 'welcome', 'hype', 'countdown', 'auction', 'clear'])

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Accept params from either query string (Stream Deck GET) or JSON body.
  const src = req.method === 'POST' && req.body && typeof req.body === 'object'
    ? { ...req.query, ...req.body }
    : (req.query || {})

  // Optional shared secret. Only enforced if CG_CUE_TOKEN is configured in
  // Vercel env — otherwise the endpoint is open (simplest to set up).
  const requiredToken = process.env.CG_CUE_TOKEN
  if (requiredToken && String(src.token || '') !== requiredToken) {
    return res.status(401).json({ ok: false, error: 'bad or missing token' })
  }

  const anim = String(src.anim || '').trim()
  if (!VALID_ANIMS.has(anim)) {
    return res.status(400).json({ ok: false, error: 'anim must be one of: ' + [...VALID_ANIMS].join(', ') })
  }

  const room = String(src.room || 'main').trim() || 'main'
  const topic = 'lv-cg-' + room

  // Build the same payload shape the web control panel sends, so the overlay
  // handles Stream Deck cues and phone cues identically.
  const payload = { anim }
  if (anim === 'sold') {
    if (src.item) payload.item = String(src.item)
    if (src.price) payload.price = String(src.price)
  } else if (anim === 'welcome') {
    if (src.name) payload.name = String(src.name)
  } else if (anim === 'hype') {
    if (src.text) payload.text = String(src.text)
  } else if (anim === 'countdown') {
    payload.from = parseInt(src.from, 10) || 3
  } else if (anim === 'auction') {
    payload.step = ['once', 'twice', 'sold'].includes(src.step) ? src.step : 'once'
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
      },
      body: JSON.stringify({
        messages: [{ topic, event: 'cue', payload, private: false }],
      }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return res.status(502).json({ ok: false, error: 'broadcast failed', status: r.status, detail })
    }
    // Tiny success body. Stream Deck's HTTP-request plugins ignore it; if a
    // human opens the URL in a browser they see a clear confirmation.
    return res.status(200).json({ ok: true, sent: { topic, ...payload } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
}
