// api/lark-notify.js
// Vercel serverless function: server-side proxy for the Lark group bot webhook.
// We keep the actual webhook URL in the LARK_WEBHOOK_URL env var so it never
// ships in the client bundle (otherwise anyone could spam the group).
//
// Supports multiple notification types via the `type` field:
//   - "move"         : triggered after a Move Inventory transfer
//   - "receive"      : triggered after Receive on Intake to Master
//                      DUAL TARGET: Acquisitions Squad + Backend Core groups
//   - "online_order" : triggered after Ship Order on Online Orders
//   - "purchased"    : triggered after Log Purchase on Purchased Items
//                      Routed to Acquisitions Squad group
//   - "stream_count" : triggered after Submit on Stream Counts (DUAL TARGET:
//                      brief to main group, detailed to per-room group)
//
// New types live in the buildMessage switch — keep formatting in one place
// so we never need to redeploy when wording changes.
//
// Per-room webhooks (Vercel env vars) — used by stream_count notifications:
//   LARK_WEBHOOK_URL                       → main group (brief summary)
//   LARK_WEBHOOK_STREAM_ROCKETSHQ          → TikTok RocketsHQ room group
//   LARK_WEBHOOK_STREAM_PACKHEADS          → TikTok Packheads room group
//   LARK_WEBHOOK_STREAM_LUCKYVAULTUS       → eBay LuckyVaultUS room group
//   LARK_WEBHOOK_STREAM_SLABBIEPATTY       → eBay SlabbiePatty room group
//
// Squad webhooks (Vercel env vars) — used by acquisition lifecycle notifications:
//   LARK_WEBHOOK_ACQUISITIONS              → Acquisitions Squad group
//                                            (target for `purchased` + `receive`)
//   LARK_WEBHOOK_BACKEND_CORE              → Backend Core group
//                                            (additional target for `receive`)
// Either env var falls back to LARK_WEBHOOK_URL if unset, so messages are
// never silently dropped. Duplicate targets are deduped before dispatch.

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

  const body = req.body || {}
  const type = body.type || 'move'

  // stream_count fans out to BOTH the main group (brief) and the per-room
  // group (detailed). Branch out so the dual-target logic doesn't pollute
  // the simpler single-message path used by every other type.
  if (type === 'stream_count') {
    return handleStreamCount(body, res)
  }

  // stream_count_undone follows the same dual-target dispatch but with a
  // shorter "void the previous message" payload. Used when a streamer hits
  // the Undo button on the Submit toast — by that point the original Lark
  // already went out, so the room group needs to know not to trust it.
  if (type === 'stream_count_undone') {
    return handleStreamCountUndone(body, res)
  }

  // Acquisition lifecycle types route to dedicated squad groups, NOT the main
  // "all activity" channel. The acquisitions squad owns purchase orders and
  // intake; the backend core group also needs visibility into intake (to
  // reconcile against accounting / system state).
  if (type === 'purchased') {
    return handlePurchased(body, res)
  }
  if (type === 'receive') {
    return handleReceive(body, res)
  }

  // ----- Japan-side events ----------------------------------------------
  // Three flavors:
  //   jp_stream_sale  — direct livestream sale out of Japan Warehouse
  //   jp_to_us_shipment — cross-border shipment; dual-target so US
  //                       Acquisitions team also gets a heads-up
  // (日本进货 reuses the existing 'purchased' type with sourceCountry='Japan'
  //  + currency='JPY' — buildMessage already handles those cases.)
  if (type === 'jp_stream_sale') {
    return handleJapanEvent(body, res, buildJpStreamSale, /*alsoToAcquisitions=*/false)
  }
  if (type === 'jp_to_us_shipment') {
    return handleJapanEvent(body, res, buildJpToUSShipment, /*alsoToAcquisitions=*/true)
  }

  // ----- Singles in-and-out events --------------------------------------
  // All five route to the same "inventory in/out" Lark group, configured
  // via LARK_WEBHOOK_INVENTORY_IO (falls back to LARK_WEBHOOK_URL).
  if (type === 'single_intake')   return handleSinglesEvent(body, res, buildSingleIntake)
  if (type === 'bulk_intake')     return handleSinglesEvent(body, res, buildBulkIntake)
  if (type === 'single_sold')     return handleSinglesEvent(body, res, buildSingleSold)
  if (type === 'bulk_sold')       return handleSinglesEvent(body, res, buildBulkSold)
  if (type === 'single_deleted')  return handleSinglesEvent(body, res, buildSingleDeleted)

  // Per-stream reconciliation should land in the room's own group, not the
  // main "all activity" channel. Fall back to main URL if no room webhook
  // is configured for the room (so messages aren't silently dropped).
  if (type === 'reconciliation') {
    const roomWebhook = getRoomWebhook(body.roomName)
    const webhookUrl = roomWebhook || process.env.LARK_WEBHOOK_URL
    if (!webhookUrl) {
      console.error('[lark-notify] reconciliation: no webhook configured', body.roomName)
      return res.status(500).json({ error: 'No webhook configured for this room' })
    }
    let messageText
    try { messageText = buildMessage(body) }
    catch (err) { return res.status(400).json({ error: err.message }) }
    try {
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: messageText } })
      })
      const txt = await r.text()
      if (!r.ok) return res.status(502).json({ error: 'Lark webhook failed', status: r.status, details: txt })
      return res.status(200).json({ ok: true, lark: txt, target: roomWebhook ? 'room' : 'main' })
    } catch (err) {
      return res.status(500).json({ error: 'Failed to call Lark webhook', message: String(err?.message || err) })
    }
  }

  const webhookUrl = process.env.LARK_WEBHOOK_URL
  if (!webhookUrl) {
    console.error('[lark-notify] LARK_WEBHOOK_URL is not set in Vercel env')
    return res.status(500).json({ error: 'Webhook URL not configured' })
  }

  let messageText
  try {
    messageText = buildMessage(body)
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

// ---- stream_count: dual-target dispatch ----

async function handleStreamCount(body, res) {
  const totalSold = Number(body.totalSold) || 0
  const totalDiscrepancies = Number(body.totalDiscrepancies) || 0

  // Skip silently if there's nothing worth reporting (per user spec —
  // counts of zero with no discrepancies just clutter the channels).
  if (totalSold === 0 && totalDiscrepancies === 0) {
    return res.status(200).json({ ok: true, skipped: 'no sales or discrepancies' })
  }

  const mainWebhook = process.env.LARK_WEBHOOK_URL
  const roomWebhook = getRoomWebhook(body.roomName)

  const sends = []
  if (mainWebhook) {
    sends.push({
      target: 'main',
      url: mainWebhook,
      text: buildStreamCountBrief(body)
    })
  }
  if (roomWebhook) {
    sends.push({
      target: 'room',
      url: roomWebhook,
      text: buildStreamCountDetailed(body)
    })
  }

  if (sends.length === 0) {
    console.error('[lark-notify] stream_count: no webhooks configured', body.roomName)
    return res.status(500).json({ error: 'No webhooks configured (main + room both missing)' })
  }

  const results = await Promise.all(sends.map(async s => {
    try {
      const r = await fetch(s.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: s.text } })
      })
      const text = await r.text()
      return { target: s.target, ok: r.ok, status: r.status, response: text }
    } catch (err) {
      console.error(`[lark-notify] stream_count ${s.target} send failed:`, err)
      return { target: s.target, ok: false, error: String(err?.message || err) }
    }
  }))

  return res.status(200).json({ ok: results.every(r => r.ok), results })
}

// ---- stream_count_undone: dual-target dispatch for cancellation ----
//
// Same fan-out as handleStreamCount (main group brief + room group). The
// streamer clicked Undo on the post-submit toast, so the count never
// landed in the audit history but the original Lark already went out.
// We send a short "ignore the previous message" follow-up.
async function handleStreamCountUndone(body, res) {
  const mainWebhook = process.env.LARK_WEBHOOK_URL
  const roomWebhook = getRoomWebhook(body.roomName)

  const text = buildStreamCountUndone(body)

  const sends = []
  if (mainWebhook) sends.push({ target: 'main', url: mainWebhook, text })
  if (roomWebhook) sends.push({ target: 'room', url: roomWebhook, text })

  if (sends.length === 0) {
    console.error('[lark-notify] stream_count_undone: no webhooks configured', body.roomName)
    return res.status(500).json({ error: 'No webhooks configured (main + room both missing)' })
  }

  const results = await Promise.all(sends.map(async s => {
    try {
      const r = await fetch(s.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: s.text } })
      })
      const txt = await r.text()
      return { target: s.target, ok: r.ok, status: r.status, response: txt }
    } catch (err) {
      console.error(`[lark-notify] stream_count_undone ${s.target} send failed:`, err)
      return { target: s.target, ok: false, error: String(err?.message || err) }
    }
  }))

  return res.status(200).json({ ok: results.every(r => r.ok), results })
}

// ---- purchased: single-target dispatch (Acquisitions Squad) ----
//
// "🛍️ New Purchase Logged" — fires when a user submits Purchased Items.
// Routed to LARK_WEBHOOK_ACQUISITIONS; falls back to LARK_WEBHOOK_URL if the
// squad webhook isn't configured so messages aren't silently dropped during
// rollout.
async function handlePurchased(body, res) {
  let text
  try { text = buildMessage(body) }
  catch (err) {
    console.error('[lark-notify] purchased: bad payload:', err)
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }

  // Dual-target routing:
  //   - All purchases → Acquisitions Squad (fallback: main URL)
  //   - Japan-sourced purchases ALSO → Japan group (if LARK_WEBHOOK_JAPAN
  //     is set). De-duped if the same URL is used for both.
  // Sending to acquisitions for Japan purchases too is intentional: gives
  // global visibility into spending and keeps the existing audit habit.
  const acqUrl = process.env.LARK_WEBHOOK_ACQUISITIONS || process.env.LARK_WEBHOOK_URL
  const jpUrl = (body.sourceCountry === 'Japan') ? process.env.LARK_WEBHOOK_JAPAN : null
  const targets = []
  if (acqUrl) targets.push({ name: 'acquisitions', url: acqUrl })
  if (jpUrl && jpUrl !== acqUrl) targets.push({ name: 'japan', url: jpUrl })
  if (targets.length === 0) {
    console.error('[lark-notify] purchased: no webhook configured (LARK_WEBHOOK_ACQUISITIONS / LARK_WEBHOOK_URL)')
    return res.status(500).json({ error: 'No webhook configured' })
  }

  const results = await Promise.all(targets.map(async t => {
    try {
      const r = await fetch(t.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } })
      })
      const txt = await r.text()
      if (!r.ok) {
        console.error(`[lark-notify] purchased ${t.name}: Lark non-OK:`, r.status, txt)
      }
      return { target: t.name, ok: r.ok, status: r.status, response: txt }
    } catch (err) {
      console.error(`[lark-notify] purchased ${t.name} send failed:`, err)
      return { target: t.name, ok: false, error: String(err?.message || err) }
    }
  }))
  return res.status(200).json({ ok: results.every(r => r.ok), results })
}

// ---- receive: dual-target dispatch (Acquisitions Squad + Backend Core) ----
//
// "📥 Inventory Received" — fires when a user clicks Receive on Intake to
// Master. Goes to BOTH the Acquisitions Squad (owns the intake workflow) and
// the Backend Core group (reconciles inventory against accounting / financial
// records). Each target falls back to LARK_WEBHOOK_URL if its dedicated env
// var isn't set; duplicate URLs are deduped so we never send the same message
// twice to the same channel.
async function handleReceive(body, res) {
  let text
  try { text = buildMessage(body) }
  catch (err) {
    console.error('[lark-notify] receive: bad payload:', err)
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }

  const acqUrl  = process.env.LARK_WEBHOOK_ACQUISITIONS
  const coreUrl = process.env.LARK_WEBHOOK_BACKEND_CORE
  const mainUrl = process.env.LARK_WEBHOOK_URL

  // Build target list. Each "slot" prefers its dedicated webhook, falls back
  // to main. Track the resolved URL + a label so the response payload is
  // useful for debugging "did acquisitions actually get it?".
  const slots = [
    { name: acqUrl  ? 'acquisitions'      : 'main_fallback_acq',  url: acqUrl  || mainUrl },
    { name: coreUrl ? 'backend_core'      : 'main_fallback_core', url: coreUrl || mainUrl },
  ]
  // Dedupe by URL — if both slots resolved to the same channel (e.g. both
  // fall back to LARK_WEBHOOK_URL), only send once. Keep the first label.
  const seen = new Set()
  const targets = []
  for (const s of slots) {
    if (!s.url || seen.has(s.url)) continue
    seen.add(s.url)
    targets.push(s)
  }

  if (targets.length === 0) {
    console.error('[lark-notify] receive: no webhooks configured')
    return res.status(500).json({ error: 'No webhooks configured (LARK_WEBHOOK_ACQUISITIONS / LARK_WEBHOOK_BACKEND_CORE / LARK_WEBHOOK_URL)' })
  }

  const results = await Promise.all(targets.map(async t => {
    try {
      const r = await fetch(t.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } })
      })
      const txt = await r.text()
      return { target: t.name, ok: r.ok, status: r.status, response: txt }
    } catch (err) {
      console.error(`[lark-notify] receive ${t.name} send failed:`, err)
      return { target: t.name, ok: false, error: String(err?.message || err) }
    }
  }))

  return res.status(200).json({ ok: results.every(r => r.ok), results })
}

function buildStreamCountUndone(body) {
  const { roomName, streamerName, countedByName } = body
  const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')
  const lines = []
  lines.push(`↩️ Stream Count UNDONE — ${room}`)
  lines.push(`Counter: ${countedByName || '?'} (was recording ${streamerName || '?'}'s session)`)
  lines.push(`Time: ${nowUtcStamp()}`)
  lines.push('')
  lines.push('⚠️ The previous Stream Count message above is VOID — please disregard those numbers. A new count will be submitted shortly.')
  return lines.join('\n')
}

// Match the room name (e.g. "Stream Room - TikTok RocketsHQ") to the right
// env var. Substring matching is intentional — robust to small label changes
// like "Stream Room — " (em dash) vs "Stream Room - " (hyphen).
function getRoomWebhook(roomName) {
  if (!roomName) return null
  const n = String(roomName)
  if (n.includes('RocketsHQ'))    return process.env.LARK_WEBHOOK_STREAM_ROCKETSHQ    || null
  if (n.includes('Packheads'))    return process.env.LARK_WEBHOOK_STREAM_PACKHEADS    || null
  if (n.includes('LuckyVaultUS')) return process.env.LARK_WEBHOOK_STREAM_LUCKYVAULTUS || null
  if (n.includes('SlabbiePatty')) return process.env.LARK_WEBHOOK_STREAM_SLABBIEPATTY || null
  return null
}

function buildStreamCountBrief(body) {
  const { roomName, streamerName, countedByName, totalSold, totalDiscrepancies } = body
  // Strip the "Stream Room - " prefix in the brief — main group already knows
  // the context, shorter is better.
  const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')
  const lines = []
  lines.push(`📋 Stream Count — ${room}`)
  // streamer_id = previous streamer (the one whose sales we're recording).
  // counted_by_id = current streamer taking over (also the one counting).
  lines.push(`Sold by ${streamerName || '?'} · Counted by ${countedByName || '?'} (now streaming)`)
  const sold = Number(totalSold) || 0
  const disc = Number(totalDiscrepancies) || 0
  let summary = `Sold last session: ${sold}`
  if (disc > 0) summary += ` · ⚠️ +${disc} discrepancies`
  lines.push(summary)
  return lines.join('\n')
}

function buildStreamCountDetailed(body) {
  const { roomName, streamerName, countedByName, soldItems = [], discrepancyItems = [], totalSold, totalDiscrepancies } = body
  const lines = []
  lines.push(`📋 Stream Count — ${roomName || 'Unknown room'}`)
  lines.push(`Sold by: ${streamerName || '?'} (previous session)`)
  lines.push(`Counted by: ${countedByName || '?'} (now streaming)`)
  lines.push(`Time: ${nowUtcStamp()}`)

  if (soldItems.length > 0) {
    lines.push('')
    const skuLabel = soldItems.length === 1 ? 'SKU' : 'SKUs'
    lines.push(`📤 Sold during previous session: ${Number(totalSold) || 0} units / ${soldItems.length} ${skuLabel}`)
    for (const item of soldItems) {
      lines.push(`  • ${item.name || 'Unknown'} × ${item.quantity || 0}`)
    }
  }

  if (discrepancyItems.length > 0) {
    lines.push('')
    lines.push(`⚠️ More than expected: +${Number(totalDiscrepancies) || 0} units (needs review)`)
    for (const item of discrepancyItems) {
      lines.push(`  • ${item.name || 'Unknown'} +${item.extra || 0}`)
    }
  }

  return lines.join('\n')
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

  if (type === 'add_product') {
    // Triggered after a new product is created via Add Product (single or
    // bulk mode). Visibility matters here because new SKUs are upstream of
    // everything — if a duplicate or mis-typed product slips in, it pollutes
    // every report afterwards. The notification gives the team a chance to
    // catch typos and dupes before they propagate.
    const { user, products: prods = [], mode } = body
    if (!Array.isArray(prods) || prods.length === 0) {
      throw new Error('add_product: missing products')
    }
    const lines = []
    lines.push('🆕 New Product Added')
    lines.push(`By: ${user || 'Unknown'}`)
    if (mode === 'bulk') lines.push(`Mode: Bulk (${prods.length})`)
    lines.push('')
    for (const p of prods) {
      // Each product line: "Brand | Name | [LANG] [Type]"
      const parts = []
      if (p.brand) parts.push(p.brand)
      parts.push(p.name || 'Unnamed')
      let suffix = ''
      if (p.language) suffix += ` [${p.language}]`
      if (p.type) suffix += ` ${p.type}`
      if (p.breakable && p.packs_per_box) suffix += ` (${p.packs_per_box} packs/box)`
      lines.push(`• ${parts.join(' | ')}${suffix}`)
    }
    lines.push('')
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'manual_inventory') {
    // Triggered after a successful Manual Inventory add (single or bulk).
    // Useful so the team knows "Aldo manually added 50 NIKKE to Master" —
    // catches accidental double-entries and gives an audit trail when
    // inventory appears without a Purchased Items / Intake record.
    const { user, locationName, items = [], totalUnits, mode } = body
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('manual_inventory: missing items')
    }
    const lines = []
    lines.push('🧮 Manual Inventory Added')
    lines.push(`By: ${user || 'Unknown'}`)
    lines.push(`Location: ${locationName || 'Unknown'}`)
    if (mode === 'bulk') lines.push('Mode: Bulk add')
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

  if (type === 'reconciliation') {
    // Per-stream reconciliation: compare stream-count outflow against TikTok
    // platform sales for the same LIVE session. Sent to the per-room group
    // (e.g. PACKHEADS group) so the streamer and manager see it immediately.
    //
    // NOTE: production runs of auto-reconcile call Lark DIRECTLY (inlined
    // builder in api/auto-reconcile.js) to bypass the Vercel-auth 401 on
    // inter-function loopback. This builder is kept here for parity in
    // case anything else POSTs type='reconciliation'.
    //
    // ⚠️ TODO 2026-05-13: the inline builder in api/auto-reconcile.js was
    // rewritten to a new template (3-way totals comparison, Analytics
    // LIVE session list with titles, gap-explanation, "Next step" line).
    // Nothing currently calls type='reconciliation' through this endpoint
    // so the old format below is dead code today. If anything starts
    // calling it, port the new format from auto-reconcile.js.
    const {
      roomName,
      streamerName,
      sessionLabel,
      windowFrom,
      windowTo,
      totalPlatform,
      totalSystem,
      totalDiff,
      flaggedRows = [],        // [{ product, platform, system, diff }]
      unmappedCount = 0,
      threshold = 5,
      mergedSessionCount = 1,
      perCreator = [],         // [{ creator, total_qty, line_count, earliest_unix, latest_unix }]
    } = body
    const lines = []
    const isMerged = (mergedSessionCount || 1) > 1
    const room = (roomName || 'Unknown').replace(/^Stream Room\s*[-—]\s*/i, '')

    if (isMerged) {
      lines.push(`🔀 MERGED Reconciliation — ${mergedSessionCount} sessions`)
      lines.push(`Room: ${room}`)
      if (sessionLabel) lines.push(`Session: ${sessionLabel}`)
      if (windowFrom || windowTo) lines.push(`Window: ${windowFrom || '?'} → ${windowTo || '?'}`)
      lines.push('')
      lines.push(`⚠️ This count covered multiple LIVE streams. Per-stream attribution is not reliable — investigate any discrepancy across ALL streamers below.`)
      lines.push('')
      lines.push('Per-creator TikTok sales:')
      for (const c of perCreator) {
        const span = c.earliest_unix && c.latest_unix && c.earliest_unix !== c.latest_unix
          ? ` (${formatUnixShortPT(c.earliest_unix)} → ${formatUnixShortPT(c.latest_unix)})`
          : c.earliest_unix
            ? ` (${formatUnixShortPT(c.earliest_unix)})`
            : ''
        lines.push(`  • ${c.creator}: ${c.total_qty} units${span}`)
      }
      lines.push('')
    } else {
      lines.push(`🔍 Stream Reconciliation — ${room}`)
      if (streamerName) lines.push(`Streamer: ${streamerName}`)
      if (sessionLabel) lines.push(`Session: ${sessionLabel}`)
      if (windowFrom || windowTo) lines.push(`Window: ${windowFrom || '?'} → ${windowTo || '?'}`)
      lines.push('')
    }

    lines.push(`Totals — TikTok ${totalPlatform ?? 0} · Count ${totalSystem ?? 0} · Diff ${(totalDiff ?? 0) > 0 ? '+' : ''}${totalDiff ?? 0}`)
    lines.push('')
    if (flaggedRows.length === 0) {
      lines.push(`✅ All products match within ±${threshold}`)
    } else {
      lines.push(`⚠️ ${flaggedRows.length} product${flaggedRows.length === 1 ? '' : 's'} off by ${threshold}+:`)
      // Cap at 15 lines so Lark messages stay readable
      for (const r of flaggedRows.slice(0, 15)) {
        const sign = r.diff > 0 ? '+' : ''
        lines.push(`  • ${r.product || 'Unknown'}: TikTok ${r.platform || 0} · Count ${r.system || 0} · ${sign}${r.diff || 0}`)
      }
      if (flaggedRows.length > 15) {
        lines.push(`  …and ${flaggedRows.length - 15} more`)
      }
    }
    if (unmappedCount > 0) {
      lines.push('')
      lines.push(`ℹ️ ${unmappedCount} TikTok product${unmappedCount === 1 ? '' : 's'} unmapped — open Sales Audit to map them.`)
    }
    lines.push('')
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'storefront_transaction') {
    // One Lark message per cart submit (NOT per line). Listed by category so
    // the team can spot at a glance "boxes vs slabs vs singles sold today".
    const {
      transaction_id, payment_method, date,
      items = [], total, total_units,
      transaction_type = 'sale',   // 'sale' | 'trade'
      trade_in_value,              // only for trade — what customer brought (USD)
      net_cash,                    // signed; for sale = total, for trade = total - trade_in_value
    } = body
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('storefront_transaction: missing items')
    }
    const KIND_ICON = { sealed: '📦', slab: '💎', single: '🎴' }
    const KIND_LABEL = { sealed: 'Sealed', slab: 'Slab', single: 'Single' }

    const headerEmoji = transaction_type === 'trade' ? '🔄' : '🛍️'
    const headerText = transaction_type === 'trade' ? 'Storefront Trade' : 'Storefront Sale'

    const lines = []
    lines.push(`${headerEmoji} ${headerText}`)
    if (payment_method) lines.push(`Payment: ${payment_method}`)
    if (date) lines.push(`Date: ${date}`)
    lines.push('')

    // Group by kind, render in fixed order so the message reads the same
    // across transactions regardless of scan order.
    const byKind = { sealed: [], slab: [], single: [] }
    for (const it of items) {
      const k = byKind[it.kind] ? it.kind : 'sealed'
      byKind[k].push(it)
    }
    for (const k of ['sealed', 'slab', 'single']) {
      const group = byKind[k]
      if (group.length === 0) continue
      lines.push(`${KIND_ICON[k]} ${KIND_LABEL[k]} (${group.length})`)
      for (const it of group) {
        const sub = (Number(it.price) || 0) * (Number(it.quantity) || 1)
        const qtyStr = (Number(it.quantity) || 1) > 1 ? ` × ${it.quantity}` : ''
        lines.push(`  • ${it.name || 'Unknown'}${qtyStr}  $${sub.toFixed(2)}`)
      }
      lines.push('')
    }

    lines.push(`Items: ${total_units ?? items.length} unit${total_units === 1 ? '' : 's'} · value $${(Number(total) || 0).toFixed(2)}`)

    // Trade math at the bottom so it's the last thing the reader sees.
    if (transaction_type === 'trade') {
      const ti = Number(trade_in_value) || 0
      const nc = Number(net_cash) || 0
      lines.push(`Trade-in: $${ti.toFixed(2)} (value of items customer brought)`)
      if (nc > 0)      lines.push(`💵 Net: customer paid us $${nc.toFixed(2)}`)
      else if (nc < 0) lines.push(`💸 Net: we paid customer $${Math.abs(nc).toFixed(2)}`)
      else             lines.push(`⚖️ Net: even trade`)
    }

    if (transaction_id) lines.push(`Txn: ${String(transaction_id).slice(0, 8)}…`)
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

// Format "now" in America/Los_Angeles (the business HQ timezone) so the Lark
// stamp matches what the streamer's local clock says. Using UTC here forced
// everyone to mentally subtract 7-8 hours every time they read a message —
// confusing enough that Will mistook a real submission timestamp for a
// missing record. PT is the LA tz abbreviation that's correct year-round
// (vs PDT/PST which flip with daylight saving).
function nowUtcStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} PT`
}

// Short LA-local format used in per-creator session breakdowns
// ("Mon 19:00 PT"). Kept in sync with auto-reconcile.js.
function formatUnixShortPT(unix) {
  if (!unix) return '?'
  const d = new Date(unix * 1000)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('weekday')} ${get('hour')}:${get('minute')} PT`
}

// ============================================================================
// Singles in-and-out event handlers
// ============================================================================
// Five terse one-line templates routed to the "inventory in/out" Lark group
// (LARK_WEBHOOK_INVENTORY_IO). Each handler is fire-and-forget from the
// frontend after a successful Supabase write — failures here MUST NOT block
// the main operation (which already succeeded by the time we get here).
// ============================================================================

function getInventoryIoWebhook() {
  return process.env.LARK_WEBHOOK_INVENTORY_IO || process.env.LARK_WEBHOOK_URL || null
}

// Shared dispatcher — runs a builder function and posts to the inventory
// in/out webhook. The builder is a pure (body → string).
async function handleSinglesEvent(body, res, builder) {
  const url = getInventoryIoWebhook()
  if (!url) {
    console.error('[lark-notify] singles event: no LARK_WEBHOOK_INVENTORY_IO configured')
    return res.status(500).json({ error: 'No webhook configured (set LARK_WEBHOOK_INVENTORY_IO)' })
  }
  let text
  try {
    text = builder(body)
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    const txt = await r.text()
    if (!r.ok) return res.status(502).json({ error: 'Lark webhook failed', status: r.status, details: txt })
    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to call Lark webhook', message: String(err?.message || err) })
  }
}

// Format USD currency, omitting cents when whole. "$50" not "$50.00".
function fmtUsd(n) {
  if (n == null || isNaN(Number(n))) return null
  const num = Number(n)
  return `$${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)}`
}

// Identify a card in one line: "Charizard ex 199/197 (Surging Sparks)"
function fmtCardIdent(body) {
  const name = (body.card_name || '').trim()
  const number = (body.card_number || '').trim()
  const setName = (body.set_name || '').trim()
  const idCore = `${name}${number ? ` ${number}` : ''}`.trim() || '(unknown)'
  return setName ? `${idCore} (${setName})` : idCore
}

// "Raw NM ×2" or "PSA 10 #12345678"
function fmtFormDescriptor(body) {
  if (body.form === 'graded') {
    const co = body.grading_company || '?'
    const grade = body.grade || '?'
    const cert = body.cert_number ? ` #${body.cert_number}` : ''
    return `${co} ${grade}${cert}`
  }
  const cond = body.condition || ''
  const qty = body.quantity > 1 ? ` ×${body.quantity}` : ''
  return `Raw ${cond}${qty}`.trim()
}

// 📥 INTAKE — Charizard ex 199/197 (Surging Sparks) · Raw NM ×1 · $50 · TCG 642242 · by Will
function buildSingleIntake(body) {
  if (!body.card_name) throw new Error('card_name is required')
  const parts = [`📥 INTAKE — ${fmtCardIdent(body)}`, fmtFormDescriptor(body)]
  const cost = fmtUsd(body.cost_usd)
  if (cost) parts.push(cost)
  // TCG ID only useful for raw (graded already shows #cert above)
  if (body.form !== 'graded' && body.tcg_id) parts.push(`TCG ${body.tcg_id}`)
  if (body.operator_name) parts.push(`by ${body.operator_name}`)
  return parts.join(' · ')
}

// 📦 BULK INTAKE — 5 cards added · $215 total · by Will
function buildBulkIntake(body) {
  const n = Number(body.count) || 0
  const parts = [`📦 BULK INTAKE — ${n} card${n === 1 ? '' : 's'} added`]
  const total = fmtUsd(body.total_cost_usd)
  if (total) parts.push(`${total} total`)
  if (body.operator_name) parts.push(`by ${body.operator_name}`)
  return parts.join(' · ')
}

// 💰 SOLD — Charizard ex 199/197 (Surging Sparks) · $80 via eBay → ebay_user_xyz · by Will
function buildSingleSold(body) {
  if (!body.card_name) throw new Error('card_name is required')
  const parts = [`💰 SOLD — ${fmtCardIdent(body)}`]
  const sale = fmtUsd(body.sale_price_usd)
  const channel = body.sale_channel || '?'
  let saleSeg = `${sale || 'unknown'} via ${channel}`
  if (body.buyer_name) saleSeg += ` → ${body.buyer_name}`
  parts.push(saleSeg)
  if (body.operator_name) parts.push(`by ${body.operator_name}`)
  return parts.join(' · ')
}

// 💰 BULK SOLD — 5 cards · $400 via eBay · P/L +$98 · by Will
// 💰 BULK SOLD — 5 cards · $400 via mixed channels · P/L +$98 · by Will
function buildBulkSold(body) {
  const n = Number(body.count) || 0
  const parts = [`💰 BULK SOLD — ${n} card${n === 1 ? '' : 's'}`]
  const total = fmtUsd(body.total_sale_usd)
  const channels = Array.isArray(body.channels) ? body.channels : []
  const channelStr = channels.length === 1 ? channels[0] : 'mixed channels'
  if (total) parts.push(`${total} via ${channelStr}`)
  else parts.push(`via ${channelStr}`)
  if (body.realized_pl_usd != null) {
    const pl = Number(body.realized_pl_usd)
    const sign = pl >= 0 ? '+' : '-'
    parts.push(`P/L ${sign}${fmtUsd(Math.abs(pl))}`)
  }
  if (body.operator_name) parts.push(`by ${body.operator_name}`)
  return parts.join(' · ')
}

// 🗑 DELETED — Charizard ex 199/197 · reason: "test data" · by Will
function buildSingleDeleted(body) {
  if (!body.card_name) throw new Error('card_name is required')
  const cardCore = `${body.card_name}${body.card_number ? ` ${body.card_number}` : ''}`
  const parts = [`🗑 DELETED — ${cardCore}`]
  if (body.reason && body.reason.trim()) {
    parts.push(`reason: "${body.reason.trim()}"`)
  }
  if (body.operator_name) parts.push(`by ${body.operator_name}`)
  return parts.join(' · ')
}

// ============================================================================
// Japan-side Lark dispatch
// ============================================================================
// Japan events route to LARK_WEBHOOK_JAPAN if it's set, otherwise fall
// through to the main URL so messages never silently drop. jp_to_us_shipment
// ALSO fans out to LARK_WEBHOOK_ACQUISITIONS (US-side intake team) so
// they know a package is on the way without having to refresh the
// pending-acquisitions list. Duplicate target URLs are de-duped.
function getJapanWebhook() {
  return process.env.LARK_WEBHOOK_JAPAN || process.env.LARK_WEBHOOK_URL || null
}

async function handleJapanEvent(body, res, builder, alsoToAcquisitions) {
  let text
  try {
    text = builder(body)
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }

  const jpUrl = getJapanWebhook()
  const acqUrl = alsoToAcquisitions ? process.env.LARK_WEBHOOK_ACQUISITIONS : null
  const targets = []
  if (jpUrl) targets.push({ name: 'japan', url: jpUrl })
  if (acqUrl && acqUrl !== jpUrl) targets.push({ name: 'acquisitions', url: acqUrl })
  if (targets.length === 0) {
    console.error('[lark-notify] Japan event: no webhook configured')
    return res.status(500).json({ error: 'No webhook configured (set LARK_WEBHOOK_JAPAN or LARK_WEBHOOK_URL)' })
  }

  const results = await Promise.all(targets.map(async t => {
    try {
      const r = await fetch(t.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      })
      const txt = await r.text()
      return { target: t.name, ok: r.ok, status: r.status, response: txt }
    } catch (err) {
      console.error(`[lark-notify] Japan event ${t.name} send failed:`, err)
      return { target: t.name, ok: false, error: String(err?.message || err) }
    }
  }))

  return res.status(200).json({ ok: results.every(r => r.ok), results })
}

// 🎌 Japan Live Sale Recorded
// Streamer: Will
// Date: 2026-05-21
// • OP-13 Booster Box × 5  ¥50,000  (≈ $335 USD)
// Total: 5 units / ¥50,000 (≈ $335 USD)
// Time: 2026-05-21 14:32 PT
function buildJpStreamSale(body) {
  const {
    streamer,                  // streamer name
    recordedBy,                // who entered the form (optional)
    saleDate,                  // YYYY-MM-DD
    items = [],                // [{ name, quantity, unitJpy, lineJpy, lineUsd }]
    totalUnits,
    totalJpy,
    totalUsd,
    notes,
  } = body
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('jp_stream_sale: missing items')
  }
  const lines = []
  lines.push('🎌 Japan Live Sale Recorded')
  if (streamer) lines.push(`Streamer: ${streamer}`)
  if (recordedBy && recordedBy !== streamer) lines.push(`Recorded by: ${recordedBy}`)
  if (saleDate) lines.push(`Date: ${saleDate}`)
  if (notes) lines.push(`Notes: ${notes}`)
  lines.push('')
  for (const it of items) {
    const jpyStr = it.lineJpy != null ? `  ¥${Number(it.lineJpy).toLocaleString()}` : ''
    const usdStr = it.lineUsd != null ? `  (≈ ${fmtUsd(it.lineUsd)})` : ''
    lines.push(`• ${it.name || 'Unknown'} × ${it.quantity ?? 0}${jpyStr}${usdStr}`)
  }
  lines.push('')
  const totals = []
  if (totalUnits != null) totals.push(`${totalUnits} units`)
  if (totalJpy != null) totals.push(`¥${Number(totalJpy).toLocaleString()}`)
  if (totalUsd != null) totals.push(`≈ ${fmtUsd(totalUsd)}`)
  if (totals.length) lines.push(`Total: ${totals.join(' / ')}`)
  lines.push(`Time: ${nowUtcStamp()}`)
  return lines.join('\n')
}

// 📦🇯🇵→🇺🇸 Japan→US Shipment Dispatched
// Shipper: Will
// Date: 2026-05-21
// • OP-13 Booster Box × 30  cost basis ¥150,000  (≈ $1,005 USD)
// Total: 30 units / cost basis ¥150,000 (≈ $1,005 USD)
// Carrier: Japan Post
// Tracking: EE123456789JP
// Track: https://...
// Time: ...
function buildJpToUSShipment(body) {
  const {
    shipper,
    shippedDate,
    items = [],
    totalUnits,
    totalJpy,
    totalUsd,
    carrier,
    trackingNumber,
    notes,
  } = body
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('jp_to_us_shipment: missing items')
  }
  const lines = []
  lines.push('📦🇯🇵→🇺🇸 Japan→US Shipment Dispatched')
  if (shipper) lines.push(`Shipper: ${shipper}`)
  if (shippedDate) lines.push(`Date: ${shippedDate}`)
  if (notes) lines.push(`Notes: ${notes}`)
  lines.push('')
  for (const it of items) {
    const costStr = it.lineJpy != null
      ? `  cost basis ¥${Number(it.lineJpy).toLocaleString()}${it.lineUsd != null ? `  (≈ ${fmtUsd(it.lineUsd)})` : ''}`
      : ''
    lines.push(`• ${it.name || 'Unknown'} × ${it.quantity ?? 0}${costStr}`)
  }
  lines.push('')
  const totals = []
  if (totalUnits != null) totals.push(`${totalUnits} units`)
  if (totalJpy != null) totals.push(`cost basis ¥${Number(totalJpy).toLocaleString()}`)
  if (totalUsd != null) totals.push(`≈ ${fmtUsd(totalUsd)}`)
  if (totals.length) lines.push(`Total: ${totals.join(' / ')}`)
  if (trackingNumber) {
    lines.push('')
    lines.push(`Carrier: ${carrier || 'Unknown'}`)
    lines.push(`Tracking: ${trackingNumber}`)
    const url = buildTrackingUrl(carrier, trackingNumber)
    if (url) lines.push(`Track: ${url}`)
    lines.push('⏳ US team — pending receive in Intake to Master')
  }
  lines.push(`Time: ${nowUtcStamp()}`)
  return lines.join('\n')
}
