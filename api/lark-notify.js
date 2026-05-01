// api/lark-notify.js
// Vercel serverless function: server-side proxy for the Lark group bot webhook.
// We keep the actual webhook URL in the LARK_WEBHOOK_URL env var so it never
// ships in the client bundle (otherwise anyone could spam the group).
//
// Supports multiple notification types via the `type` field:
//   - "move"         : triggered after a Move Inventory transfer
//   - "receive"      : triggered after Receive on Intake to Master
//   - "online_order" : triggered after Ship Order on Online Orders
//   - "purchased"    : triggered after Log Purchase on Purchased Items
//
// New types live in the buildMessage switch — keep formatting in one place
// so we never need to redeploy when wording changes.

// Carrier → tracking URL template. Keep keys in sync with the dropdown in
// PurchasedItems.jsx. "Other" / unknown carriers fall back to 17track which
// auto-detects most carriers.
const CARRIER_TRACKING_URLS = {
  'USPS':        n => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
  'UPS':         n => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  'FedEx':       n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  'DHL':         n => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}`,
  'Japan Post':  n => `https://trackings.post.japanpost.jp/services/srv/search/?requestNo1=${encodeURIComponent(n)}&locale=en`,
  'EMS':         n => `https://www.17track.net/en/track?nums=${encodeURIComponent(n)}`,
  'Yamato':      n => `https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?init=yes&number00=1&number01=${encodeURIComponent(n)}`,
  'SF Express':  n => `https://www.sf-express.com/we/ow/chn/sc/waybill/waybillNew/waybillQuery?nos=${encodeURIComponent(n)}`,
  'China Post':  n => `https://www.17track.net/en/track?nums=${encodeURIComponent(n)}`,
  'Other':       n => `https://www.17track.net/en/track?nums=${encodeURIComponent(n)}`
}

function buildTrackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) return null
  const fn = CARRIER_TRACKING_URLS[carrier] || CARRIER_TRACKING_URLS['Other']
  return fn(trackingNumber)
}

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

  let messageText
  try {
    messageText = buildMessage(req.body || {})
  } catch (err) {
    console.error('[lark-notify] bad payload:', err)
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }

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

function buildMessage(body) {
  // Default to "move" for backwards compat with existing callers that don't send `type`.
  const type = body.type || 'move'

  if (type === 'move') {
    const { fromLocation, toLocation, items, user, totalUnits } = body
    if (!fromLocation || !toLocation || !Array.isArray(items) || items.length === 0) {
      throw new Error('move: missing fromLocation/toLocation/items')
    }
    const lines = []
    lines.push('📦 Inventory Move')
    lines.push(`By: ${user || 'Unknown'}`)
    lines.push(`Route: ${fromLocation} → ${toLocation}`)
    lines.push('')
    for (const item of items) {
      lines.push(`• ${item.name || 'Unknown product'} × ${item.quantity ?? 0}`)
    }
    lines.push('')
    const skuLabel = items.length === 1 ? 'SKU' : 'SKUs'
    lines.push(`Total: ${items.length} ${skuLabel} / ${totalUnits ?? 0} units`)
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'online_order') {
    const { handledBy, platform, channel, orderNumber, customerName, sourceLocation, items, totalUnits, trackingNumber } = body
    if (!platform || !channel || !sourceLocation || !Array.isArray(items) || items.length === 0) {
      throw new Error('online_order: missing platform/channel/sourceLocation/items')
    }
    const lines = []
    lines.push('🛒 Online Order Shipped')
    lines.push(`By: ${handledBy || 'Unknown'}`)
    lines.push(`Platform: ${platform} @ ${channel}`)
    if (orderNumber) lines.push(`Order #: ${orderNumber}`)
    if (customerName) lines.push(`Customer: ${customerName}`)
    lines.push(`From: ${sourceLocation}`)
    lines.push('')
    for (const item of items) {
      lines.push(`• ${item.name || 'Unknown product'} × ${item.quantity ?? 0}`)
    }
    lines.push('')
    const skuLabel = items.length === 1 ? 'SKU' : 'SKUs'
    lines.push(`Total: ${items.length} ${skuLabel} / ${totalUnits ?? 0} units`)
    if (trackingNumber) lines.push(`Tracking: ${trackingNumber}`)
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'receive') {
    const {
      productLabel,    // e.g. "Pokemon | Gem Vol.5 | Booster Box (CN)"
      acquirer,        // original purchaser (string, optional)
      thisBatch,       // qty received this click
      totalReceived,   // running total (prevReceived + thisBatch)
      totalOrdered,    // quantity_purchased
      status,          // e.g. "Partially Received"
      unit             // optional: "boxes" / "packs" — defaults to "units"
    } = body
    if (!productLabel || thisBatch == null || totalReceived == null || totalOrdered == null) {
      throw new Error('receive: missing productLabel/thisBatch/totalReceived/totalOrdered')
    }
    const remaining = Math.max(totalOrdered - totalReceived, 0)
    const unitLabel = unit || 'units'
    const lines = []
    lines.push('📥 Inventory Received')
    lines.push(productLabel)
    if (acquirer) lines.push(`Originally ordered by: ${acquirer}`)
    lines.push('')
    lines.push(`This batch: ${thisBatch} ${unitLabel}`)
    if (remaining > 0) {
      lines.push(`Total received: ${totalReceived} / ${totalOrdered}  (${remaining} still incoming)`)
    } else {
      lines.push(`Total received: ${totalReceived} / ${totalOrdered}  ✅ complete`)
    }
    if (status) lines.push(`Status: ${status}`)
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'purchased') {
    const {
      acquirer,        // who bought it (acquirer field, e.g. "Eric")
      vendor,          // optional vendor name (e.g. "TCGPlayer")
      sourceCountry,   // "USA" / "Japan" / "China"
      currency,        // "USD" / "JPY" / "RMB"
      totalCost,       // sum of cost in original currency (number)
      totalCostUSD,    // sum of cost converted to USD (number, optional)
      items,           // [{ name, quantity, cost }]
      totalUnits,
      carrier,         // optional ("USPS" / "FedEx" / etc.)
      trackingNumber   // optional
    } = body
    if (!acquirer || !Array.isArray(items) || items.length === 0) {
      throw new Error('purchased: missing acquirer/items')
    }
    const lines = []
    lines.push('🛍️ New Purchase Logged')
    lines.push(`By: ${acquirer}`)
    if (vendor) lines.push(`Vendor: ${vendor}${sourceCountry ? ` (${sourceCountry})` : ''}`)
    lines.push('')
    for (const item of items) {
      lines.push(`• ${item.name || 'Unknown product'} × ${item.quantity ?? 0}`)
    }
    lines.push('')
    const skuLabel = items.length === 1 ? 'SKU' : 'SKUs'
    const costStr = totalCost != null
      ? formatCost(totalCost, currency) + (currency !== 'USD' && totalCostUSD != null ? `  (≈ $${totalCostUSD.toFixed(2)} USD)` : '')
      : null
    lines.push(`Total: ${items.length} ${skuLabel} / ${totalUnits ?? 0} units${costStr ? ` / ${costStr}` : ''}`)
    if (trackingNumber) {
      lines.push('')
      lines.push(`Carrier: ${carrier || 'Unknown'}`)
      lines.push(`Tracking: ${trackingNumber}`)
      const url = buildTrackingUrl(carrier, trackingNumber)
      if (url) lines.push(`Track: ${url}`)
    }
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  throw new Error(`Unknown notification type: ${type}`)
}

function formatCost(amount, currency) {
  if (amount == null) return ''
  const symbol = currency === 'USD' ? '$' : (currency === 'JPY' ? '¥' : (currency === 'RMB' ? '¥' : ''))
  // Show 0 decimals for JPY (yen has no fractional unit), 2 for others
  const decimals = currency === 'JPY' ? 0 : 2
  return `${symbol}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency}`
}

function nowUtcStamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}
