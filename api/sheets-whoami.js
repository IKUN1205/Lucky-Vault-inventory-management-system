// api/sheets-whoami.js
// Returns ONLY the Google service account's client_email — the address you
// share a Google Sheet with so our sync/cron endpoints can write to it.
// The email is share-target info, not a secret; the private key is never
// exposed here. Added for the daily stream-plan writer setup (2026-09-24).

export const config = { maxDuration: 10 }

export default async function handler(req, res) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' })
  try {
    const { client_email } = JSON.parse(raw)
    return res.status(200).json({ client_email })
  } catch (e) {
    return res.status(500).json({ error: 'Credential JSON unparsable' })
  }
}
