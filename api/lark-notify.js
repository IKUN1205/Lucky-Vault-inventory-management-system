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
//   LARK_WEBHOOK_STOREFRONT                → Storefront Chats group
//                                            (target for `storefront_transaction`
//                                             — sale / trade / buy)
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

// Cert-verification link for graded slabs. Clicking it in Lark opens the
// grader's official cert page — photos of the exact slab included — which is
// how sale messages "carry the image" (Gary 2026-07-13: 直接发 cert link,
// custom-bot webhooks can't attach real images but links are one tap).
// Only emit URL patterns we've verified; unknown graders get no link rather
// than a broken one.
function certUrl(gradingCompany, certNumber) {
  if (!certNumber) return null
  const c = encodeURIComponent(String(certNumber).trim())
  if (!c) return null
  switch (String(gradingCompany || '').toLowerCase()) {
    case 'psa': return `https://www.psacard.com/cert/${c}`
    case 'cgc': return `https://www.cgccards.com/certlookup/${c}/`
    default: return null
  }
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
  if (type === 'receive' || type === 'receive_digest') {
    return handleReceive(body, res)
  }

  // ----- Japan-side events ----------------------------------------------
  // Four flavors:
  //   jp_stream_sale  — direct livestream sale out of Japan Warehouse;
  //                     primarily a Japan-team event
  //   jp_local_sale   — in-store / off-platform sale (日本当地售卖);
  //                     routed ONLY to the Inventory In&Out group per
  //                     William's call (it's a US-side audit concern,
  //                     the Japan team already knows the stock left)
  //   jp_to_us_shipment — cross-border shipment; dual-target so US
  //                       Acquisitions team also gets a heads-up
  // (日本进货 reuses the existing 'purchased' type with sourceCountry='Japan'
  //  + currency='JPY' — buildMessage already handles those cases.)
  if (type === 'jp_stream_sale') {
    return handleJapanEvent(body, res, buildJpStreamSale, {})
  }
  if (type === 'jp_local_sale') {
    // Was Inventory In&Out only — a US group — on William's call. Gary
    // 2026-08-18: Japan's own alerts do not belong in US channels. A sale out
    // of the Japan warehouse to a Japanese customer is Japan's event.
    return handleJapanEvent(body, res, buildJpLocalSale, {})
  }
  if (type === 'jp_to_us_shipment') {
    // 3 stakeholders for cross-border shipments:
    //   japan group  — sender team's heads-up
    //   acquisitions — US receive team's "incoming, prep Intake" alert
    //   inventory_io — the company-wide inventory in/out audit channel,
    //                  same group that gets every move/intake notification
    return handleJapanEvent(body, res, buildJpToUSShipment, {
      alsoToAcquisitions: true,
      alsoToInventoryIo: true,
    })
  }
  if (type === 'jp_shipment_canceled') {
    // A pending shipment was canceled from the Japan page. Same 3 targets as
    // the original dispatch so the US Acquisitions team knows to STOP
    // expecting the package (otherwise they'd prep an Intake for a ghost).
    return handleJapanEvent(body, res, buildJpShipmentCanceled, {
      alsoToAcquisitions: true,
      alsoToInventoryIo: true,
    })
  }

  // ----- Singles in-and-out events --------------------------------------
  // All five route to the same "inventory in/out" Lark group, configured
  // via LARK_WEBHOOK_INVENTORY_IO (falls back to LARK_WEBHOOK_URL).
  if (type === 'single_intake')   return handleSinglesEvent(body, res, buildSingleIntake)
  if (type === 'bulk_intake')     return handleSinglesEvent(body, res, buildBulkIntake)
  if (type === 'single_sold')     return handleSinglesEvent(body, res, buildSingleSold)
  if (type === 'bulk_sold')       return handleSinglesEvent(body, res, buildBulkSold)
  if (type === 'single_deleted')  return handleSinglesEvent(body, res, buildSingleDeleted)

  // ----- Returns --------------------------------------------------------
  // Cancelled / returned goods scanned back into inventory. Same "inventory
  // in/out" group as moves + singles events. Single mode fires one per return;
  // the bulk session fires one batch message.
  if (type === 'return') {
    const url = process.env.LARK_WEBHOOK_INVENTORY_IO || process.env.LARK_WEBHOOK_URL
    if (!url) return res.status(500).json({ error: 'No inventory-io webhook configured' })
    let text
    try { text = buildMessage(body) }
    catch (err) { return res.status(400).json({ error: err.message || 'Invalid payload' }) }
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

  // ----- Storefront transactions ---------------------------------------
  // Sale / Trade / Buy notifications go to the Storefront Chats group via
  // LARK_WEBHOOK_STOREFRONT. Falls back to LARK_WEBHOOK_URL if the storefront
  // webhook isn't configured yet (so messages aren't silently dropped during
  // rollout). The fallback is just a safety net — once the env var is set,
  // every storefront txn lands directly in the storefront group.
  if (type === 'storefront_transaction') {
    return handleStorefrontTransaction(body, res)
  }

  // Cash-drawer threshold alert — fires from submitStorefrontTransaction
  // the moment today's net cash crosses a configured amount. Routes to
  // the Storefront group same as transactions.
  if (type === 'storefront_cash_alert') {
    return handleStorefrontTransaction(body, res)
  }

  // Smart-allocation suggestion (NOT a real move) — fires when the
  // intake-to-master Allocator modal is dismissed via "先不动 / Skip".
  // Goes to the same inventory in/out group as real moves so the
  // channel manager sees the advice + the eventual move side-by-side.
  if (type === 'allocation_suggestion') {
    const url = process.env.LARK_WEBHOOK_INVENTORY_IO || process.env.LARK_WEBHOOK_URL
    if (!url) return res.status(500).json({ error: 'No inventory-io webhook configured' })
    let text
    try { text = buildMessage(body) }
    catch (err) { return res.status(400).json({ error: err.message || 'Invalid payload' }) }
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

  // Platform sales fan out to the per-channel stream-room group: every
  // cart submit on Platform Sales fires one message into the matching
  // Lark room (SlabbiePatty / LuckyVaultUS / PackHeadsTCG / RocketsHQ /
  // Whatnot). Falls back to the main URL if the room webhook env isn't
  // configured yet so messages don't silently drop during rollout.
  if (type === 'platform_sale') {
    return handlePlatformSale(body, res)
  }

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
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  // Skip silently if there's nothing worth reporting (per user spec —
  // counts of zero with no discrepancies just clutter the channels). A
  // free-text note is itself worth reporting (its whole point is to flag
  // something the numbers can't show — e.g. "extra box in the room not on
  // the list"), so a note-only submission still goes out.
  if (totalSold === 0 && totalDiscrepancies === 0 && !note) {
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
// ---- storefront_transaction: route to Storefront Chats group ----
//
// Sale / Trade / Buy all land here. Prefers LARK_WEBHOOK_STOREFRONT and
// falls back to LARK_WEBHOOK_URL if not configured. The body shape is
// identical to what the previous default-path handler expected — just the
// destination is different.
async function handleStorefrontTransaction(body, res) {
  let text
  try { text = buildMessage(body) }
  catch (err) {
    console.error('[lark-notify] storefront_transaction: bad payload:', err)
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }
  const storefrontUrl = process.env.LARK_WEBHOOK_STOREFRONT
  const url = storefrontUrl || process.env.LARK_WEBHOOK_URL
  if (!url) {
    console.error('[lark-notify] storefront_transaction: no webhook configured')
    return res.status(500).json({ error: 'No webhook configured (LARK_WEBHOOK_STOREFRONT / LARK_WEBHOOK_URL)' })
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    const txt = await r.text()
    if (!r.ok) {
      console.error('[lark-notify] storefront_transaction: Lark non-OK:', r.status, txt)
      return res.status(502).json({ error: 'Lark webhook failed', status: r.status, details: txt })
    }
    return res.status(200).json({
      ok: true, lark: txt,
      target: storefrontUrl ? 'storefront' : 'main_fallback',
    })
  } catch (err) {
    console.error('[lark-notify] storefront_transaction: send failed:', err)
    return res.status(500).json({ error: 'Failed to call Lark webhook', message: String(err?.message || err) })
  }
}

// ---- platform_sale: route to per-channel stream-room group --------------
//
// Resolves the channel (SlabbiePatty / LuckyVaultUS / PackHeadsTCG /
// RocketsHQ / Whatnot) to its LARK_WEBHOOK_STREAM_* env var via getRoomWebhook.
// Falls back to LARK_WEBHOOK_URL if the room webhook isn't set so messages
// don't silently drop during rollout.
async function handlePlatformSale(body, res) {
  let text
  try { text = buildMessage(body) }
  catch (err) {
    console.error('[lark-notify] platform_sale: bad payload:', err)
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }
  const channel = body.channel || ''
  const roomUrl = getRoomWebhook(channel)
  const url = roomUrl || process.env.LARK_WEBHOOK_URL
  if (!url) {
    console.error('[lark-notify] platform_sale: no webhook configured for channel', channel)
    return res.status(500).json({ error: `No webhook configured (LARK_WEBHOOK_STREAM_* / LARK_WEBHOOK_URL) for channel ${channel}` })
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    const txt = await r.text()
    if (!r.ok) {
      console.error('[lark-notify] platform_sale: Lark non-OK:', r.status, txt)
      return res.status(502).json({ error: 'Lark webhook failed', status: r.status, details: txt })
    }
    return res.status(200).json({
      ok: true, lark: txt,
      target: roomUrl ? `room:${channel}` : 'main_fallback',
    })
  } catch (err) {
    console.error('[lark-notify] platform_sale: send failed:', err)
    return res.status(500).json({ error: 'Failed to call Lark webhook', message: String(err?.message || err) })
  }
}

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
  const room = shortRoom(roomName)
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
  // Lower-case once so we tolerate every casing the front-end might pass:
  // "Packheads" (from Stream Count), "PackHeadsTCG" (from Platform Sales),
  // "PACKHEADS" etc. all resolve the same way.
  const n = String(roomName).toLowerCase()
  if (n.includes('rocketshq') || n.includes('rockethq')) return process.env.LARK_WEBHOOK_STREAM_ROCKETSHQ    || null
  if (n.includes('packheads'))                            return process.env.LARK_WEBHOOK_STREAM_PACKHEADS    || null
  if (n.includes('luckyvault'))                           return process.env.LARK_WEBHOOK_STREAM_LUCKYVAULTUS || null
  if (n.includes('slabbiepatty') || n.includes('slabbypatty')) return process.env.LARK_WEBHOOK_STREAM_SLABBIEPATTY || null
  // pokecasino = renamed Whatnot room (2026-07-22); env var name unchanged
  if (n.includes('whatnot') || n.includes('pokecasino'))  return process.env.LARK_WEBHOOK_STREAM_WHATNOT     || null
  if (n.includes('pokeauction'))                          return process.env.LARK_WEBHOOK_STREAM_POKEAUCTIONHOUSE || null
  return null
}

// Shared trailing "note from counter" block, appended to BOTH the brief
// (main group) and detailed (room group) stream_count messages so the two
// variants can never drift. Rendered only when the counter left a note —
// free text for anomalies / extra items not on the count list.
// Free text is UNTRUSTED (Codex 2026-07-01): cap it so a giant paste can't
// flood/fail webhook delivery, and neutralize Lark mention markup (`<at ...>`)
// so a note can't fake an @-mention in the group. Other text passes verbatim.
const NOTE_LARK_MAX = 500
function appendCounterNote(lines, body) {
  let note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!note) return
  note = note.replace(/<at\b/gi, '‹at')          // defuse Lark mention tags
  if (note.length > NOTE_LARK_MAX) note = note.slice(0, NOTE_LARK_MAX) + ' …(truncated)'
  lines.push('')
  lines.push('📝 Note from counter:')
  lines.push(note)
}

// ---------------------------------------------------------------------------
// Stream-count product labels.
//
// The sender posts "brand | set | form | language", four columns of which three
// are mostly implied by the fourth. Brand repeats what the set name already
// says, and on 2026-08-19 it was outright wrong on a live line — an OP-15 set
// filed under Pokemon — so a reader who trusts it is worse off. Language is the
// same on every row but the odd one out, which is the only row worth marking.
//
// The FORM column has to survive. Box, pack and blister of one set are three
// products at three prices, and one SKU standing for two of them is exactly what
// made the Marvel Allegiance count swing between 3 and 27 across four counts.
const _FORM_WORDS = /\b(booster|box|boxes|pack|packs|blister|sleeved|case|bundle|etb|display|collection)\b/gi
function _core(s) {
  return String(s || '').toLowerCase().replace(_FORM_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export function splitProductLabel(raw) {
  const parts = String(raw || '').split('|').map(s => s.trim())
  // A set name may itself contain a pipe, so anchor on the ends, not on a count.
  if (parts.length < 4) return { name: String(raw || '').trim(), form: '', lang: '' }
  return {
    brand: parts[0],
    name: parts.slice(1, parts.length - 2).join(' | '),
    form: parts[parts.length - 2],
    lang: parts[parts.length - 1],
  }
}

// "The Time of Battle Booster Pack - The Time of Battle (OP16)" is one set
// written twice, once with its code. Keep the half carrying the code — dropping
// the code instead would merge two OP sets that only the code tells apart.
function _dedupeSet(name) {
  const halves = String(name).split(/\s+-\s+/)
  if (halves.length !== 2) return name
  const [a, b] = halves.map(h => h.trim())
  const ca = _core(a), cb = _core(b)
  if (!ca || !cb) return name
  if (ca === cb) return b.length >= a.length ? b : a
  if (cb.startsWith(ca)) return b
  if (ca.startsWith(cb)) return a
  return name          // two genuinely different halves — keep both
}

export function shortCountName(raw, dominant = null) {
  const { name, form, lang } = splitProductLabel(raw)
  let s = _dedupeSet(String(name || '').replace(/^\[(EN|JP|CN)\]\s*/i, '').trim())
  // Append the form only when the name is not already saying it. Plain
  // case-insensitive containment, so "…Booster Box" + form "Booster Box" prints
  // once while "…Premium Booster PRB2 Booster Packs" + form "Booster Box" keeps
  // both — there the two really do disagree, and that is worth seeing.
  if (form && form !== '?' && !s.toLowerCase().includes(form.toLowerCase())) {
    s = `${s} · ${form}`
  }
  // Tag the exception, never the norm. A Packheads count is nine EN rows and one
  // JP row; tagging all ten puts the marker everywhere and therefore nowhere,
  // which is how [JP] went unread on the Japan report.
  if (dominant && lang && lang !== '?' && lang.toUpperCase() !== dominant) s = `${s} [${lang}]`
  return s || 'Unknown'
}

// The language most rows share — the room's norm for this message. Returns null
// when every row agrees (nothing to contrast against) or when nothing says.
export function dominantLanguage(...groups) {
  const n = new Map()
  for (const g of groups) {
    for (const it of g || []) {
      const l = splitProductLabel(it && it.name).lang
      if (l && l !== '?') n.set(l.toUpperCase(), (n.get(l.toUpperCase()) || 0) + 1)
    }
  }
  if (n.size < 2) return null
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
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
  appendCounterNote(lines, body)
  return lines.join('\n')
}

function buildStreamCountDetailed(body) {
  const { roomName, streamerName, countedByName, soldItems = [], discrepancyItems = [], totalSold, totalDiscrepancies } = body
  const lines = []
  // This message goes to that room's own group, so the "Stream Room - " prefix
  // is telling people where they already are.
  lines.push(`📋 Stream Count — ${(roomName || 'Unknown room').replace(/^Stream Room\s*[-—]\s*/i, '')}`)
  const dominant = dominantLanguage(soldItems, discrepancyItems)
  // Three lines into one, and no Time: — Lark stamps every message itself.
  lines.push(`Sold by ${streamerName || '?'} (last session) · counted by ${countedByName || '?'} (now streaming)`)

  if (soldItems.length > 0) {
    lines.push('')
    const skuLabel = soldItems.length === 1 ? 'SKU' : 'SKUs'
    lines.push(`📤 Sold last session: ${Number(totalSold) || 0} units / ${soldItems.length} ${skuLabel}`)
    // Biggest movers first. The submitted order is the order of the count sheet,
    // which puts a 1-unit line above a 70-unit line for no reason a reader can use.
    const bySold = [...soldItems].sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0))
    for (const item of bySold) {
      // "at least" where the books were already short: sold = expected - actual,
      // and a wrong expected can only understate it. "?" where we could not
      // find out which of the two this is — that is not the same as exact.
      const qty = item.unverified ? `× ${item.quantity || 0} (unverified)`
        : item.atLeast ? `≥ ${item.quantity || 0}`
        : `× ${item.quantity || 0}`
      lines.push(`  • ${shortCountName(item.name, dominant)} ${qty}`)
    }
    // Both markers still have to be spelled out or a reader takes ≥ for =, but
    // one short line each rather than a sentence each.
    if (soldItems.some(i => i.atLeast)) lines.push(`   ≥ = books were short, real number can only be higher`)
    if (soldItems.some(i => i.unverified)) lines.push(`   unverified = books for this room could not be checked`)
  }

  appendSurplus(lines, discrepancyItems, totalDiscrepancies, dominant)
  appendCounterNote(lines, body)
  return lines.join('\n')
}

// How long an unresolved surplus has been open, in whole days.
function daysOpen(since) {
  if (!since) return null
  const t = Date.parse(since)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

const MAX_UNSOURCED_SHOWN = 4

/**
 * Surplus, split by whether anything can actually be done about it.
 *
 * The old block printed one list with the same instruction against every line
 * — "record a Move" — and repeated it verbatim every session. By 2026-08-12
 * one SKU had carried that same line for 11 counts running. An instruction
 * that has been ignored eleven times is not being ignored; it is impossible to
 * follow, because for most of these there is no room to move stock FROM. The
 * whole company held 2 units of the Prismatic Clash and all 2 were already in
 * the room being counted.
 *
 * So the two cases get separated. Where stock exists elsewhere, name the room
 * and the quantity, because that turns the instruction into something a person
 * can carry out in thirty seconds. Where it does not, say so plainly, stop
 * asking for a Move that cannot be made, and show age instead — these need a
 * physical recount or the people in the room, and age is what makes them
 * escalate instead of blend in.
 */
export function appendSurplus(lines, discrepancyItems = [], totalDiscrepancies, dominant = undefined) {
  if (!discrepancyItems.length) return lines
  // Default keeps standalone callers (and the tests) honest: decide from
  // whatever this block itself holds.
  const lang = dominant === undefined ? dominantLanguage(discrepancyItems) : dominant

  lines.push('')
  // Staff read "+N found" as cosmetic. What it means is that this SKU's sales
  // cannot be measured until the books are right, and goods keep leaving, so the
  // warning is compressed onto the number rather than dropped.
  lines.push(`⚠️ +${Number(totalDiscrepancies) || 0} units beyond system — not added; sales for these SKUs UNKNOWN, not zero`)

  const fixable = discrepancyItems.filter(i => i.fixable === true)
  const unsourced = discrepancyItems.filter(i => i.fixable === false)
  const unchecked = discrepancyItems.filter(i => i.fixable !== true && i.fixable !== false)

  if (fixable.length > 0) {
    lines.push('')
    lines.push(`✅ Fixable — record a Move in from below; company total unchanged:`)
    for (const item of fixable) {
      const from = (item.sources || [])
        .map(s => `${String(s.name || '').replace(/^Stream Room\s*[-—]\s*/i, '')} has ${s.qty}`)
        .join(', ')
      lines.push(`  • ${shortCountName(item.name, lang)} +${item.extra || 0}${from ? `  ← ${from}` : ''}`)
    }
  }

  if (unsourced.length > 0) {
    lines.push('')
    lines.push(`❓ No source anywhere — Do NOT adjust stock; needs a physical recount:`)
    // Oldest first: the point of showing these is that some have been open for
    // weeks, and sorting by size buries exactly those. But the cap must never
    // hide the biggest — on 2026-08-12 one SKU was +67 of the +97, and a list
    // that leaves it out to make room for a +1 is worse than no list.
    const byAge = (a, b) => (daysOpen(b.since) ?? -1) - (daysOpen(a.since) ?? -1)
    const sorted = [...unsourced].sort(byAge)
    const shown = sorted.slice(0, MAX_UNSOURCED_SHOWN)
    const biggest = unsourced.reduce((m, i) =>
      (Number(i.extra) || 0) > (Number(m.extra) || 0) ? i : m, unsourced[0])
    if (!shown.includes(biggest)) {
      shown[shown.length - 1] = biggest
      shown.sort(byAge)
    }
    const hidden = sorted.filter(i => !shown.includes(i))
    for (const item of shown) {
      const age = daysOpen(item.since)
      const streak = Number(item.streak) || 1
      const bits = []
      if (streak > 1) bits.push(`${streak} counts running`)
      if (age !== null && age > 0) bits.push(`open ${age}d`)
      if (Number.isFinite(item.elsewhere)) bits.push(`system holds ${item.elsewhere} elsewhere`)
      lines.push(`  • ${shortCountName(item.name, lang)} +${item.extra || 0}${bits.length ? `  (${bits.join(', ')})` : ''}`)
    }
    if (hidden.length > 0) {
      const restUnits = hidden.reduce((n, i) => n + (Number(i.extra) || 0), 0)
      // Never let the cap read as "that was all of them".
      lines.push(`  … and ${hidden.length} more, +${restUnits} units. Full list on the count report.`)
    }
  }

  if (unchecked.length > 0) {
    lines.push('')
    lines.push(`⚠️ Other rooms not checked for ${unchecked.length} SKU(s) — unresolved, not fixable:`)
    for (const item of unchecked) {
      lines.push(`  • ${shortCountName(item.name, lang)} +${item.extra || 0}`)
    }
  }
  return lines
}

function buildMessage(body) {
  // Default to "move" for backwards compat with existing callers that don't send `type`.
  const type = body.type || 'move'

  if (type === 'move') {
    const { fromLocation, toLocation, items, user, totalUnits } = body
    if (!fromLocation || !toLocation || !Array.isArray(items) || items.length === 0) {
      throw new Error('move: missing fromLocation/toLocation/items')
    }
    // Each item carries an optional kind (sealed / single / slab) so the
    // reader can tell what kind of stock moved at a glance. Legacy callers
    // that don't send kind default to sealed (matches prior behavior).
    const KIND_ICON = { sealed: '📦', single: '🎴', slab: '💎' }
    const lines = []
    lines.push('📦 Inventory Move')
    lines.push(`By: ${user || 'Unknown'}  ·  Route: ${shortRoom(fromLocation)} → ${shortRoom(toLocation)}`)
    for (const item of items) {
      const icon = KIND_ICON[item.kind] || KIND_ICON.sealed
      lines.push(`${icon} ${item.name || 'Unknown'} × ${item.quantity ?? 0}`)
    }
    const skuLabel = items.length === 1 ? 'item' : 'items'
    lines.push(`Total: ${items.length} ${skuLabel} / ${totalUnits ?? 0} units  ·  ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'return') {
    const { items, user, bulk } = body
    if (!Array.isArray(items) || items.length === 0) throw new Error('return: missing items')
    const KIND_ICON = { sealed: '📦', single: '🎴', slab: '💎' }
    const dests = [...new Set(items.map(i => i.to).filter(Boolean))]
    const lines = []
    lines.push(bulk ? `↩️ Returns (bulk) — ${items.length} item${items.length === 1 ? '' : 's'}` : '↩️ Return')
    lines.push(`By: ${user || 'Unknown'}`)
    if (dests.length === 1) lines.push(`Back to: ${dests[0]}`)
    lines.push('')
    for (const it of items) {
      const icon = KIND_ICON[it.kind] || '📦'
      const q = (Number(it.quantity) || 1) > 1 ? ` ×${it.quantity}` : ''
      const tags = [it.reason, it.room].filter(Boolean).join(' · ')
      const dest = dests.length > 1 && it.to ? ` → ${it.to}` : ''
      lines.push(`${icon} ${it.name || 'Item'}${q}${tags ? ` — ${tags}` : ''}${dest}`)
    }
    lines.push('')
    const units = items.reduce((a, i) => a + (Number(i.quantity) || 1), 0)
    lines.push(`Total: ${items.length} item${items.length === 1 ? '' : 's'} / ${units} units back in stock`)
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

  // One message for a whole intake session instead of one per acquisition row.
  //
  // Gary 2026-08-12: nine notifications landed from a single session, six lines
  // each. They were all correct — the density comes from a shipment being
  // recorded as several acquisition rows for the same product (tracking
  // 875535947181 was eight rows, two of them Mega Symphonia as 1 and as 6), and
  // the old message fired once per row.
  //
  // Grouped by tracking, because that is the unit a person can act on: a box
  // either has everything out of it or it does not. The lines that need someone
  // are pulled to the top — a fully-received shipment is one line, and what is
  // still owed is the part worth reading.
  if (type === 'receive_digest') {
    const { receipts = [], receiver, outstanding = [] } = body
    if (!Array.isArray(receipts) || receipts.length === 0) {
      throw new Error('receive_digest: missing receipts')
    }
    const byTracking = new Map()
    for (const r of receipts) {
      const k = (r.trackingNumber || '').trim() || 'no tracking'
      if (!byTracking.has(k)) byTracking.set(k, [])
      byTracking.get(k).push(r)
    }
    const totalUnits = receipts.reduce((s, r) => s + (Number(r.thisBatch) || 0), 0)
    const lines = []
    // Receiver folded into the header; as its own line it was always four words.
    lines.push(`📥 Intake — ${totalUnits} units across ${receipts.length} line${receipts.length === 1 ? '' : 's'}`
      + (receiver ? ` · by ${receiver}` : ''))

    for (const [tracking, rows] of byTracking) {
      const units = rows.reduce((s, r) => s + (Number(r.thisBatch) || 0), 0)
      lines.push('')
      lines.push(`${tracking} — ${units} units`)
      // Same set-name-only treatment as the dispatch report: on an intake list
      // the brand and category repeat on every line and the set is the part
      // that differs.
      for (const r of rows) {
        const owed = Math.max((Number(r.totalOrdered) || 0) - (Number(r.totalReceived) || 0), 0)
        lines.push(`  • ${shortSetName(r)} × ${r.thisBatch}`
          + (owed > 0 ? `  — ${owed} of ${r.totalOrdered} still owed` : ''))
      }
    }

    // What is still sitting undelivered-into-Master. This is the reason the
    // digest exists: on the day it was written, two Storm Emeralda shipments
    // delivered on 08-01 and 08-04 were still at zero received while newer
    // arrivals were being booked in around them.
    if (outstanding.length > 0) {
      lines.push('')
      lines.push(`⚠️ Still not taken in from earlier deliveries:`)
      for (const o of outstanding.slice(0, 8)) {
        // Built as parts rather than nested ternaries: the previous form
        // emitted a stray ')' whenever a delivery date arrived without a
        // tracking number.
        const meta = [o.trackingNumber, o.deliveredAt && `delivered ${String(o.deliveredAt).slice(0, 10)}`]
          .filter(Boolean).join(', ')
        lines.push(`  • ${shortSetName(o)} — ${o.remaining} of ${o.totalOrdered}`
          + (meta ? ` (${meta})` : ''))
      }
      if (outstanding.length > 8) lines.push(`  ... and ${outstanding.length - 8} more`)
    }
    // No Time: — Lark stamps every message with its own clock.
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
    let unpriced = 0
    for (const item of items) {
      const clause = marketClause(item)
      if (!clause) unpriced++
      lines.push(`• ${item.name || 'Unknown product'} × ${item.quantity ?? 0}${clause}`)
    }
    // Say how many lines nothing checked. Without this, a message where every
    // line happens to be unpriceable looks exactly like a message where every
    // line came back fine — and the reader has no way to tell which they got.
    if (unpriced) {
      lines.push(items.length === unpriced
        ? 'No market price on file for any of these — nothing was checked.'
        : `(${unpriced} of ${items.length} lines had no market price to check against.)`)
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

  if (type === 'cn_new_product') {
    // Fired when the China Acquisitions "+ 新货" quick-add creates a provisional
    // simplified-Chinese product (US side asleep). Heads-up so the US team can
    // normalize name→English + fix the category later. No dedicated handler —
    // falls through to the default (main) webhook, which is US-visible, same as
    // add_product.
    const { name, typeLabel, user } = body
    if (!name) throw new Error('cn_new_product: missing name')
    const lines = []
    lines.push(`🇨🇳 中国新建产品: ${name}${typeLabel ? ` (${typeLabel})` : ''} — 待补英文名/归类`)
    if (user) lines.push(`By: ${user}`)
    lines.push(`Time: ${nowUtcStamp()}`)
    return lines.join('\n')
  }

  if (type === 'jp_new_product') {
    // Japan Acquisitions "+ 新货" quick-add — same normalize-later convention
    // as cn_new_product (provisional Chinese name, US side fixes name/category).
    const { name, typeLabel, user } = body
    if (!name) throw new Error('jp_new_product: missing name')
    const lines = []
    lines.push(`🇯🇵 日本新建产品: ${name}${typeLabel ? ` (${typeLabel})` : ''} — 待补英文名/归类`)
    if (user) lines.push(`By: ${user}`)
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
    // One Lark message per cart submit (NOT per line). Kept tight —
    // header with the headline money + payment method, then one bullet
    // per item, then the timestamp. No internal transaction UUID (humans
    // don't read it; debug via the page if needed) and no redundant
    // "Items: X units · value $Y" footer when the bullets already say it.
    const {
      payment_method,
      payment_split,               // optional [{ method, amount }] — overrides payment_method when set
      items = [],
      total,
      transaction_type = 'sale',   // 'sale' | 'trade' | 'buy'
      trade_in_value,              // only for trade — value of items customer brought (USD)
      net_cash,                    // signed money flow
    } = body
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('storefront_transaction: missing items')
    }
    const KIND_ICON = {
      sealed: '📦', slab: '💎', single: '🎴',
      slab_manual: '💎', single_manual: '🎴',
    }

    // Format payment method(s) for the header. Single = "Cash". Split =
    // "Cash $30 + Store Credit $60" so the reader sees both amounts.
    const formatPaymentLabel = () => {
      if (Array.isArray(payment_split) && payment_split.length > 0) {
        return payment_split
          .map(p => `${p.method || 'Unknown'} $${(Number(p.amount) || 0).toFixed(2)}`)
          .join(' + ')
      }
      return payment_method || ''
    }
    const paymentLabel = formatPaymentLabel()

    // Headline number depends on the transaction type so the reader
    // doesn't have to compute it. Sale → cart total (cash in). Trade →
    // signed net (could be either direction). Buy → cash out.
    const pm = paymentLabel ? ` · ${paymentLabel}` : ''
    let headline
    if (transaction_type === 'trade') {
      const nc = Number(net_cash) || 0
      const sign = nc > 0 ? '+' : nc < 0 ? '-' : ''
      const abs = Math.abs(nc).toFixed(2)
      const direction =
        nc > 0 ? `Net +$${abs} (customer paid us)`
        : nc < 0 ? `Net -$${abs} (we paid customer)`
        : `Even trade`
      headline = `🔄 Trade · ${direction}${pm}`
    } else if (transaction_type === 'buy') {
      const nc = Number(net_cash) || 0
      headline = `🤝 Buy · We paid $${Math.abs(nc).toFixed(2)}${pm}`
    } else {
      const t = Number(total) || 0
      headline = `🛍️ Sale · $${t.toFixed(2)}${pm}`
    }

    const lines = [headline]

    // One bullet per item — concise: "📦 Pokemon | Gem Vol.5 Booster Box ×160 — $5040.00"
    // Group order stays stable across transactions regardless of scan order so
    // the feed reads consistently.
    const orderedKinds = ['sealed', 'slab', 'single', 'slab_manual', 'single_manual']
    const sortedItems = [...items].sort((a, b) => {
      const ai = orderedKinds.indexOf(a.kind)
      const bi = orderedKinds.indexOf(b.kind)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    for (const it of sortedItems) {
      const icon = KIND_ICON[it.kind] || '•'
      const qty = Number(it.quantity) || 1
      const sub = (Number(it.price) || 0) * qty
      const qtyStr = qty > 1 ? ` ×${qty}` : ''
      const name = it.name || it.description || 'Unknown'
      lines.push(`${icon} ${name}${qtyStr} — $${sub.toFixed(2)}`)
      const cu = certUrl(it.grading_company, it.cert_number)
      if (cu) lines.push(`   🔗 ${cu}`)
    }

    // Trade only: add a one-line context note for what the customer brought.
    // For sales the headline already says everything; for buys ditto.
    if (transaction_type === 'trade') {
      const ti = Number(trade_in_value) || 0
      lines.push(`Customer brought $${ti.toFixed(2)} in trade-in`)
    }

    lines.push(nowUtcStamp())
    return lines.join('\n')
  }

  if (type === 'allocation_suggestion') {
    // 💡 Smart restock suggestion fired by Intake to Master when the user
    // dismisses the Allocator modal with "Skip". The receive itself
    // already triggered its own 'receive' notification — this is a
    // separate advisory note for the channel team.
    const {
      productLabel,
      qtyReceived,
      windowDays = 7,
      totalSold,
      isDying,
      rows = [],   // [{ location_name, suggested_send, current_stock, daily_velocity }]
    } = body
    if (!productLabel) throw new Error('allocation_suggestion: missing productLabel')
    const sendRows = rows.filter(r => Number(r.suggested_send) > 0)
    const lines = []
    lines.push('💡 Smart restock suggestion (not yet moved)')
    lines.push(`Just received: ${productLabel} × ${qtyReceived} at Master`)
    lines.push('')
    if (isDying) {
      lines.push(`⚠ Slow seller — only ${totalSold ?? 0} sold in last ${windowDays}d. No restock recommended; staff can override via Move Inventory if needed.`)
    } else if (sendRows.length === 0) {
      lines.push(`All rooms already stocked. Keep at Master.`)
    } else {
      lines.push(`Suggested distribution (based on last ${windowDays}d sales):`)
      for (const r of sendRows) {
        const where = (r.location_name || '').replace(/^Stream Room\s*[-—]\s*/i, '')
        lines.push(`  • → ${where}: ${r.suggested_send}`)
      }
      lines.push('')
      lines.push(`⏳ Nothing moved yet — apply via Move Inventory when ready.`)
    }
    lines.push(nowUtcStamp())
    return lines.join('\n')
  }

  if (type === 'storefront_cash_alert') {
    // Fires once when today's running cash drawer crosses the threshold.
    // Intentionally short — the cashier needs to act, not read.
    const { cash_today, threshold, date } = body
    const amount = Number(cash_today) || 0
    const cutoff = Number(threshold) || 1000
    const lines = [
      `💰 Cash drawer over $${cutoff.toLocaleString()}`,
      `Today's cash: $${amount.toFixed(2)}${date ? ` (${date})` : ''}`,
      `@Mr. Vault — please come pick it up 🏃`,
      nowUtcStamp(),
    ]
    return lines.join('\n')
  }

  if (type === 'platform_sale') {
    // One message per cart submit on Platform Sales. Routed to the
    // matching stream room's group via getRoomWebhook(channel). Format
    // is intentionally tight — streamers read these on phone screens
    // between auctions.
    const {
      platform, channel, streamer,
      items = [], total, total_units,
    } = body
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('platform_sale: missing items')
    }
    const KIND_ICON = { sealed: '📦', slab: '💎', single: '🎴' }
    const tot = Number(total) || 0
    const units = Number(total_units) || items.length

    const lines = []
    lines.push(`🛍️ Sale on ${channel}${platform ? ` (${platform})` : ''} · $${tot.toFixed(2)}`)
    if (streamer) lines.push(`By ${streamer}`)
    lines.push('')
    for (const it of items) {
      const icon = KIND_ICON[it.kind] || '•'
      const qty = Number(it.quantity) || 1
      const sub = (Number(it.price) || 0) * qty
      const qtyStr = qty > 1 ? ` ×${qty}` : ''
      const name = it.name || 'Unknown'
      lines.push(`${icon} ${name}${qtyStr} — $${sub.toFixed(2)}`)
      const cu = certUrl(it.grading_company, it.cert_number)
      if (cu) lines.push(`   🔗 ${cu}`)
    }
    lines.push('')
    if (units !== items.length) {
      lines.push(`${items.length} line${items.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}`)
    } else {
      lines.push(`${items.length} item${items.length === 1 ? '' : 's'}`)
    }
    lines.push(nowUtcStamp())
    return lines.join('\n')
  }

  throw new Error(`Unknown notification type: ${type}`)
}

// The one extra fact on a purchase line: what we paid, against the market.
//
// Gary 2026-08-20, on this exact card: "这个消息我们再价格对比 market 的%可以吗"
// / "只是加一个信息 发 buy request 的时候".
//
// The judgement is made in the browser (src/lib/marketPct.js) because this
// function cannot reach TCGplayer, and the page already holds the price feed.
// Everything here is defensive about what arrives: a bad payload must produce
// NO clause, never a made-up one.
//
// Returns '' when there is nothing honest to say. The caller counts those and
// says so, because a line with no clause and a line that came back fine look
// identical otherwise.
//
// The market price travels with the percent on purpose — a percent alone is a
// number you have to trust, and a percent next to the price it came from is a
// number you can check.
function marketClause(item) {
  const state = item?.marketState
  if (state === 'unit_mismatch') {
    // Never print the ratio here. "3,750% of market" is arithmetically true
    // for a 30-pack bag against a single-pack price and tells the reader the
    // opposite of what happened. This week that shape of error hit five times.
    return ' — our unit and the market unit may not be the same thing, check what one unit is'
  }
  const pct = Number(item?.marketPct)
  const market = Number(item?.market)
  if (!Number.isFinite(pct) || !(pct > 0) || !Number.isFinite(market) || !(market > 0)) return ''
  const price = `$${market.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (state === 'above') return ` — ${Math.round(pct)}% of the ${price} market, ABOVE market`
  if (state === 'at') return ` — ${Math.round(pct)}% of the ${price} market, at market`
  return ` — ${Math.round(pct)}% of the ${price} market`
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
  const qty = Number(body.quantity) || 1
  const parts = [`💰 SOLD — ${fmtCardIdent(body)}${qty > 1 ? ` ×${qty}` : ''}`]
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
// Japan events route to LARK_WEBHOOK_JAPAN. They used to fall back to the main
// URL "so messages never silently drop" — but that main URL is a US group, and
// Gary 2026-08-18 ruled Japan's alerts out of US channels. The fallback is
// replaced rather than removed, because not dropping silently was the right
// half of that decision: Japan webhook → Hwa's Telegram → refuse loudly.
// jp_to_us_shipment ALSO fans out to LARK_WEBHOOK_ACQUISITIONS (US-side intake
// team) — that one is genuinely a US event. Duplicate target URLs are de-duped.
function getJapanWebhook() {
  return process.env.LARK_WEBHOOK_JAPAN || null
}

// Last resort for a Japan event when no Japan group is configured: DM the
// Japan buy lead. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_JAPAN_CHAT_ID in Vercel.
// Lark answers 200 even when it refuses the message — keyword filter, rate
// limit, revoked bot — and puts the verdict in the body ({"code":9499,...} or
// {"StatusCode":19001,...}). A body we cannot parse is NOT evidence of refusal,
// so that counts as sent.
function larkBodyAccepted(txt) {
  try {
    const j = JSON.parse(txt)
    const code = j?.code ?? j?.StatusCode ?? j?.status_code
    return code == null || Number(code) === 0
  } catch {
    return true
  }
}

async function postJapanTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_JAPAN_CHAT_ID
  if (!token || !chat) return { ok: false, reason: 'no TELEGRAM_BOT_TOKEN / TELEGRAM_JAPAN_CHAT_ID' }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    })
    const body = await r.text()
    return { ok: r.ok, status: r.status, response: body.slice(0, 200) }
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) }
  }
}

async function handleJapanEvent(body, res, builder, opts = {}) {
  // Back-compat: third positional bool (used by older call sites) still
  // works via opts = true → treat as { alsoToAcquisitions: true }.
  if (typeof opts === 'boolean') opts = { alsoToAcquisitions: opts }
  const { alsoToAcquisitions = false, alsoToInventoryIo = false } = opts

  let text
  try {
    text = builder(body)
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid payload' })
  }

  const jpUrl = getJapanWebhook()
  const acqUrl = alsoToAcquisitions ? process.env.LARK_WEBHOOK_ACQUISITIONS : null
  const ioUrl  = alsoToInventoryIo  ? process.env.LARK_WEBHOOK_INVENTORY_IO : null
  // De-dup by URL so a shared webhook doesn't get the message N times.
  const seen = new Set()
  const targets = []
  const pushTarget = (name, url) => {
    if (!url || seen.has(url)) return
    seen.add(url); targets.push({ name, url })
  }
  pushTarget('japan', jpUrl)
  pushTarget('acquisitions', acqUrl)
  pushTarget('inventory_io', ioUrl)

  // The Japan audience is not covered by the US fan-out targets. jp_to_us_shipment
  // also goes to LARK_WEBHOOK_ACQUISITIONS, so keying this on "no targets at all"
  // meant that with LARK_WEBHOOK_JAPAN unset the US team got the message, the
  // response said ok, and Japan silently got nothing. Key it on the Japan target
  // being missing instead.
  // Started, not awaited. Awaiting it here put a slow Telegram in front of the
  // US sends, so a jp_to_us_shipment could lose the arrival warning to a
  // platform timeout - the fallback killing the message it exists to protect.
  let jpFallback = null
  const jpFallbackPromise = jpUrl ? null : postJapanTelegram(text)
  if (targets.length === 0) {
    jpFallback = await jpFallbackPromise
    if (jpFallback && !jpFallback.ok) {
      console.error('[lark-notify] Japan copy undelivered:', jpFallback.reason || jpFallback.status)
    }
    if (jpFallback && jpFallback.ok) {
      return res.status(200).json({ ok: true, results: [{ target: 'telegram_japan', ok: true }] })
    }
    return res.status(502).json({
      error: 'Japan event not delivered — set LARK_WEBHOOK_JAPAN, or TELEGRAM_BOT_TOKEN + '
        + 'TELEGRAM_JAPAN_CHAT_ID. It is NOT posted to a US group.',
      telegram: jpFallback,
    })
  }

  const results = await Promise.all(targets.map(async t => {
    try {
      const r = await fetch(t.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      })
      const txt = await r.text()
      // Judging by r.ok alone counted a refused message as delivered, which then
      // suppressed the Telegram fallback and left a success toast on screen for
      // something nobody received.
      return { target: t.name, ok: r.ok && larkBodyAccepted(txt), status: r.status, response: txt }
    } catch (err) {
      console.error(`[lark-notify] Japan event ${t.name} send failed:`, err)
      return { target: t.name, ok: false, error: String(err?.message || err) }
    }
  }))

  // A configured-but-dead Japan webhook fails exactly the same way for the
  // reader as an unset one. Key the failover on what actually happened, not on
  // whether the env var exists - callers here are fire-and-forget and would
  // never notice the ok:false.
  if (jpFallbackPromise && !jpFallback) {
    jpFallback = await jpFallbackPromise
    if (!jpFallback.ok) {
      console.error('[lark-notify] Japan copy undelivered:', jpFallback.reason || jpFallback.status)
    }
  }
  const jpSend = results.find(r => r.name === 'japan' || r.target === 'japan')
  if (jpSend && !jpSend.ok && !jpFallback) {
    jpFallback = await postJapanTelegram(text)
    if (!jpFallback.ok) {
      console.error('[lark-notify] Japan webhook failed AND fallback failed:',
        jpFallback.reason || jpFallback.status)
    }
  }

  // An undelivered Japan copy has to appear in the response — reporting only the
  // US sends is how a channel comes to look like it works. But the Japan
  // AUDIENCE is one audience with two possible routes: if Lark refused and the
  // Telegram fallback landed, Hwa has the message, and telling the operator to
  // "go tell them directly" would be a false alarm. Alarms that cry wolf stop
  // being read. So a successful fallback REPLACES the failed Lark attempt
  // (keeping the failure detail for whoever fixes the webhook), while the US
  // targets keep reporting for themselves.
  let all = results
  if (jpFallback) {
    const larkTried = results.find(r => r.target === 'japan')
    const tgRow = {
      target: 'telegram_japan',
      ok: !!jpFallback.ok,
      reason: jpFallback.reason || null,
      afterLarkFailure: larkTried && !larkTried.ok ? (larkTried.response || larkTried.error || larkTried.status) : null,
    }
    all = jpFallback.ok
      ? [tgRow, ...results.filter(r => r.target !== 'japan')]
      : [tgRow, ...results]
  }
  return res.status(200).json({ ok: all.every(r => r.ok), results: all })
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
  const grouped = jpItemLines(items)
  if (grouped.tags) lines.push(`(${grouped.tags})`)
  for (const l of grouped.lines) lines.push(l)
  const totals = []
  if (totalUnits != null) totals.push(`${totalUnits} units`)
  if (totalJpy != null) totals.push(`¥${Number(totalJpy).toLocaleString()}`)
  if (totalUsd != null) totals.push(`≈ ${fmtUsd(totalUsd)}`)
  if (totals.length) lines.push(`Total: ${totals.join(' / ')}`)
  lines.push(`Time: ${nowUtcStamp()}`)
  return lines.join('\n')
}

// 🏪 Japan Local Sale Recorded
// Salesperson: Will
// Date: 2026-05-27
// • OP-13 Booster Box × 2  ¥20,000  (≈ $134 USD)
// Total: 2 units / ¥20,000 (≈ $134 USD)
// Time: 2026-05-27 14:32 PT
//
// Same shape as buildJpStreamSale, just different header and "Salesperson"
// label. Kept separate so the wording is unambiguous in the In&Out channel
// (the team needs to see at a glance whether a sale was a livestream or
// counter sale — same SKU, different attribution).
function buildJpLocalSale(body) {
  const {
    salesperson,               // who made the sale (reuses streamer_id field)
    recordedBy,                // who entered the form (optional)
    saleDate,
    items = [],
    totalUnits,
    totalJpy,
    totalUsd,
    notes,
  } = body
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('jp_local_sale: missing items')
  }
  const lines = []
  lines.push('🏪 Japan Local Sale Recorded')
  if (salesperson) lines.push(`Salesperson: ${salesperson}`)
  if (recordedBy && recordedBy !== salesperson) lines.push(`Recorded by: ${recordedBy}`)
  if (saleDate) lines.push(`Date: ${saleDate}`)
  if (notes) lines.push(`Notes: ${notes}`)
  const grouped = jpItemLines(items)
  if (grouped.tags) lines.push(`(${grouped.tags})`)
  for (const l of grouped.lines) lines.push(l)
  const totals = []
  if (totalUnits != null) totals.push(`${totalUnits} units`)
  if (totalJpy != null) totals.push(`¥${Number(totalJpy).toLocaleString()}`)
  if (totalUsd != null) totals.push(`≈ ${fmtUsd(totalUsd)}`)
  if (totals.length) lines.push(`Total: ${totals.join(' / ')}`)
  lines.push(`Time: ${nowUtcStamp()}`)
  return lines.join('\n')
}

// 🚫🇯🇵→🇺🇸 Japan→US Shipment CANCELED
// Canceled by: Will
// Originally shipped: 2026-06-12
// • OP-13 Booster Box × 10
// Tracking: EE123456789JP — do NOT receive
// Reason: entered wrong quantity
// Time: ...
function buildJpShipmentCanceled(body) {
  const {
    canceledBy,
    productName,
    quantity,
    carrier,
    trackingNumber,
    reason,
    shippedDate,
  } = body
  const lines = []
  lines.push('🚫🇯🇵→🇺🇸 Japan→US Shipment CANCELED')
  if (canceledBy) lines.push(`Canceled by: ${canceledBy}`)
  if (shippedDate) lines.push(`Originally shipped: ${shippedDate}`)
  lines.push('')
  lines.push(`• ${productName || 'Unknown'} × ${quantity ?? 0}`)
  if (trackingNumber) {
    const carrierStr = carrier ? `${carrier} ` : ''
    lines.push(`Tracking: ${carrierStr}${trackingNumber} — do NOT receive`)
  }
  if (reason) lines.push(`Reason: ${reason}`)
  lines.push('⚠️ US team — remove from Intake to Master expectations')
  lines.push(`Time: ${nowUtcStamp()}`)
  return lines.join('\n')
}

// Gary 2026-08-12: set name only, not the full product string. A dispatch
// list is read to answer "what is in the box" and every line already shares
// the brand, the category and the language, so repeating them four times per
// line buried the one word that differs. `(Case)` lives in the set name, so
// a case and a plain box are still told apart.
//
//   before  One Piece | [JP] THE AZURE SEA'S SEVEN (Case) | Booster Box | JP × 1
//   after   THE AZURE SEA'S SEVEN (Case) × 1
// "Stream Room - TikTok Packheads" reads as "TikTok Packheads" to everyone
// who works here; the prefix is on every room and carries nothing.
function shortRoom(name) {
  return String(name || 'Unknown').replace(/^Stream Room\s*[-\u2014]\s*/i, '')
}

// ---- Japan item lists -----------------------------------------------------
// Senders post `name` as "Brand | Set | Category | Language". On a Japan list
// the brand and the language are the same on every line, and a SKU can appear
// twice because it was entered as two rows. Both are noise; the variant
// ("(In Bag)", "(Open)", "(Unsealed)") is not, so it survives.
function splitJpName(raw) {
  const parts = String(raw || '').split('|').map(x => x.trim()).filter(Boolean)
  const label = (parts.length >= 2 ? parts[1] : (parts[0] || 'Unknown')).replace(/^\[JP\]\s*/i, '')
  const category = parts.length >= 3 ? parts[2] : ''
  // A 垃圾袋 / "(In Bag)" is a box's worth of loose packs with the box thrown
  // away - one unit is 30 packs, not one. It is filed under category "Booster
  // Pack", so without this it prints as "10 packs" when it is 300. Its own bag
  // is the honest unit. "(Open)" is the same thing under a second name: all
  // three products spelled that way carry variant=in_bag.
  const isBag = /\((in bag|open)\)/i.test(label)
  // A case holds several boxes. Its category is "Booster Box", so without this
  // one case sold prints as "1 box (case)" - which is what someone auditing a
  // count reads as one box.
  const isCase = /\(case\)/i.test(label)
  const form = isBag ? 'bag' : isCase ? 'case'
    : (/box/i.test(category) || /booster box/i.test(label) ? 'box' : 'pack')
  // The set is the label with the form words and any bracketed variant removed;
  // whatever is left in brackets IS the variant.
  const variant = (label.match(/\(([^)]+)\)/) || [, ''])[1].trim()
  // `ex` comes off wherever it falls, not only in front of a packaging word.
  // Stripping it in one position but not the other split one set over two lines:
  // "Terastal Festival ex Booster Box" became "Terastal Festival" while a row
  // sent as plain "Terastal Festival ex" stayed as itself.
  let set = label
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(ex\s+)?(booster box|booster pack|single pack)\b/gi, ' ')
    .replace(/\s+ex\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!set) set = label
  return { set, variant, form, brand: parts[0] || '', lang: parts[3] || '' }
}

function jpItemLines(items = []) {
  const bySet = new Map()
  const brands = new Set(), langs = new Set()
  let anyMoney = false
  for (const it of items) {
    const { set, variant, form, brand, lang } = splitJpName(it.name)
    if (brand) brands.add(brand)
    if (lang) langs.add(lang)
    // Case-insensitive: the catalogue holds both "Mega Dream Booster Box (Open)"
    // and "MEGA Dream ex Booster Box (Unsealed)". Keyed on the raw string those
    // land on two lines and read as two products - which is exactly what they
    // must NOT read as, because they are the same set and the point of the line
    // is to put (open) next to (unsealed) where someone can see the duplicate.
    // Brand and language are part of the key, not just the header tag. The
    // catalogue holds an [EN] and a [JP] SKU of the same set, splitJpName strips
    // the [JP] prefix, and a sale can contain both - keyed on the set name alone
    // they would merge into one line and overstate each SKU while the header
    // said only "Pokemon EN/JP".
    const skey = `${brand}|${lang}|${set}`.toLowerCase()
    if (!bySet.has(skey)) bySet.set(skey, { label: set, brand, lang, variants: new Map() })
    const key = `${variant}|${form}`
    const cur = bySet.get(skey).variants.get(key) || { variant, form, qty: 0, jpy: null, usd: null }
    cur.qty += Number(it.quantity) || 0
    // Money merges with the quantity or a merged line would show one row's yen
    // against two rows' units.
    if (it.lineJpy != null) { cur.jpy = (cur.jpy || 0) + Number(it.lineJpy); anyMoney = true }
    if (it.lineUsd != null) { cur.usd = (cur.usd || 0) + Number(it.lineUsd); anyMoney = true }
    bySet.get(skey).variants.set(key, cur)
  }
  // Tag a line only with the dimension that actually varies in THIS message.
  // Keeping two same-named SKUs on separate lines is worth nothing if both lines
  // read identically; tagging every line when nothing varies is just noise.
  const showLang = langs.size > 1
  const showBrand = brands.size > 1
  const lines = []
  for (const { label, brand: bLabel, lang: lLabel, variants } of bySet.values()) {
    // If a set holds more than one bag SKU - "(Open)" AND "(In Bag)", the exact
    // duplicate this message is meant to expose - the unit alone renders them as
    // "1 bag · 2 bags" and the reader cannot tell which is which. Keep the
    // suffix in that case; drop it when there is only one, where it just repeats
    // the word bag.
    const bagVariants = [...variants.values()].filter(v => v.form === 'bag').length
    const bits = []
    for (const v of variants.values()) {
      const unit = v.qty === 1 ? v.form
        : (v.form === 'box' ? 'boxes' : v.form === 'bag' ? 'bags'
          : v.form === 'case' ? 'cases' : 'packs')
      let bit = `${v.qty.toLocaleString()} ${unit}`
      // "(in bag)" after the word bags says the same thing twice; every other
      // variant still shows, because that is where a duplicate SKU is visible.
      const hideVariant = (v.form === 'bag' && bagVariants < 2) || v.form === 'case'
      if (v.variant && !hideVariant) bit += ` (${v.variant.toLowerCase()})`
      // Both, when both are sent. The reader does not have our FX rate, so the
      // USD is not something they can work out from the yen - dropping it loses
      // money detail rather than repetition.
      if (v.jpy != null) bit += ` ¥${Math.round(v.jpy).toLocaleString()}`
      if (v.usd != null) bit += ` (≈ ${fmtUsd(v.usd)})`
      bits.push(bit)
    }
    const shown = label
      + (showBrand && bLabel ? ` [${bLabel}]` : '')
      + (showLang && lLabel ? ` [${lLabel}]` : '')
    lines.push(`${shown} — ${bits.join(' · ')}`)
  }
  const tags = [[...brands].join('/'), [...langs].join('/')].filter(Boolean).join(' ')
  return { lines, tags, anyMoney }
}

function shortSetName(it) {
  const explicit = (it.setName || '').trim()
  // Fall back to the pipe-delimited product string a sender may still post:
  // "brand | launch | category | language" — the launch is the set.
  const parts = String(it.name || '').split('|').map(s => s.trim()).filter(Boolean)
  let s = explicit || (parts.length >= 2 ? parts[1] : (parts[0] || 'Unknown'))
  // Everything in a Japan→US shipment is Japanese; the [JP] tag is noise
  // here. Any other language tag is kept, because there it IS the surprise.
  s = s.replace(/^\[JP\]\s*/i, '').trim()
  return s || 'Unknown'
}

// 📦🇯🇵→🇺🇸 Japan→US Shipment Dispatched
// Shipper: Will
// Date: 2026-05-21
// • OP-13 (Case) × 30  cost basis ¥150,000  (≈ $1,005 USD)
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
    lines.push(`• ${shortSetName(it)} × ${it.quantity ?? 0}${costStr}`)
  }
  lines.push('')
  const totals = []
  if (totalUnits != null) totals.push(`${totalUnits} units`)
  if (totalJpy != null) totals.push(`cost basis ¥${Number(totalJpy).toLocaleString()}`)
  if (totalUsd != null) totals.push(`≈ ${fmtUsd(totalUsd)}`)
  if (totals.length) lines.push(`Total: ${totals.join(' / ')}`)
  lines.push('')
  if (trackingNumber) {
    lines.push(`Carrier: ${carrier || 'Unknown'}`)
    lines.push(`Tracking: ${trackingNumber}`)
    const url = buildTrackingUrl(carrier, trackingNumber)
    if (url) lines.push(`Track: ${url}`)
    lines.push('⏳ US team — pending receive in Intake to Master')
  } else {
    // Say it out loud. A dispatch with no tracking used to print nothing at
    // all here, which reads identically to a shipment that needs no tracking
    // — and the daily watcher can only chase a box it can see.
    lines.push('⚠️ Tracking: NOT PROVIDED — nobody can watch this box')
    lines.push('Add the tracking number in Japan Shipments so it gets tracked.')
  }
  lines.push(`Time: ${nowUtcStamp()}`)
  return lines.join('\n')
}
