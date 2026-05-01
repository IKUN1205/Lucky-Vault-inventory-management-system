// api/lark-notify.js
// Vercel serverless function: server-side proxy for the Lark group bot webhook.
// We keep the actual webhook URL in the LARK_WEBHOOK_URL env var so it never
// ships in the client bundle (otherwise anyone could spam the group).
//
// Triggered by MovedInventory.jsx after a successful inventory transfer.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const webhookUrl = process.env.LARK_WEBHOOK_URL
  if (!webhookUrl) {
    console.error('[lark-notify] LARK_WEBHOOK_URL is not set in Vercel env')
    return res.status(500).json({ error: 'Webhook URL not configured' })
  }

  const { fromLocation, toLocation, items, user, totalUnits } = req.body || {}

  if (!fromLocation || !toLocation || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // Build the Lark message text. Plain text is the simplest msg_type.
  // Format matches user spec: English, merged, no cost, no @.
  const lines = []
  lines.push('📦 Inventory Move')
  lines.push(`By: ${user || 'Unknown'}`)
  lines.push(`Route: ${fromLocation} → ${toLocation}`)
  lines.push('')
  for (const item of items) {
    const name = item.name || 'Unknown product'
    const qty = item.quantity ?? 0
    lines.push(`• ${name} × ${qty}`)
  }
  lines.push('')
  const skuLabel = items.length === 1 ? 'SKU' : 'SKUs'
  lines.push(`Total: ${items.length} ${skuLabel} / ${totalUnits ?? 0} units`)
  lines.push(`Time: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`)

  const messageText = lines.join('\n')

  try {
    const larkRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: messageText }
      })
    })

    const responseText = await larkRes.text()
    if (!larkRes.ok) {
      console.error('[lark-notify] Lark webhook non-OK:', larkRes.status, responseText)
      return res.status(502).json({ error: 'Lark webhook failed', status: larkRes.status, details: responseText })
    }

    // Lark returns 200 even when the payload is malformed — surface their response.
    return res.status(200).json({ ok: true, lark: responseText })
  } catch (err) {
    console.error('[lark-notify] Failed to call Lark webhook:', err)
    return res.status(500).json({ error: 'Failed to call Lark webhook', message: String(err?.message || err) })
  }
}
