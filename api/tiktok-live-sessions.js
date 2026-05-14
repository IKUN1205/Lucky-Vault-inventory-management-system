// api/tiktok-live-sessions.js
// Diagnostic + simple read endpoint over harvestLiveSessionsFromAnalytics.
// Returns the most recent ~10 LIVE sessions (whatever the Content Analytics
// page is showing) with TikTok's own GMV / items_sold / customers per
// session. Used to spot-check the DOM-scrape parser and (eventually) feed
// into the auto-reconcile pipeline.
//
// Hit manually:
//   curl https://lucky-vault-inventory-management-sy.vercel.app/api/tiktok-live-sessions

import { harvestLiveSessionsFromAnalytics } from './_lib/tiktok.js'

export const config = {
  maxDuration: 90,
}

export default async function handler(req, res) {
  const rawCookie = process.env.TIKTOK_COOKIE
  if (!rawCookie) {
    return res.status(500).json({ ok: false, error: 'TIKTOK_COOKIE env var not set' })
  }

  const started = Date.now()
  try {
    const { sessions, pageInfo, rawRowCount } = await harvestLiveSessionsFromAnalytics({ rawCookie })
    return res.status(200).json({
      ok: true,
      duration_ms: Date.now() - started,
      page_info: { ...pageInfo, raw_row_count: rawRowCount },
      session_count: sessions.length,
      sessions: sessions.map(s => ({
        ...s,
        // Format unix back to readable PT for human inspection
        start_iso: s.start_unix ? new Date(s.start_unix * 1000).toISOString() : null,
        end_iso: s.end_unix ? new Date(s.end_unix * 1000).toISOString() : null,
        // Drop raw_row from the response to keep it short — only return
        // raw_row when explicitly requested
        raw_row: req.query.raw === '1' ? s.raw_row : undefined,
      })),
    })
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      duration_ms: Date.now() - started,
    })
  }
}
