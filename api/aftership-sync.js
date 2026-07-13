// api/aftership-sync.js
// Daily Vercel cron — scans every acquisition with a tracking_number that
// isn't yet "Delivered", asks AfterShip for status, and posts a single Lark
// digest of items arriving today / tomorrow / just delivered.
//
// Triggered by vercel.json's `crons` block. Vercel automatically attaches
// `Authorization: Bearer ${CRON_SECRET}` if CRON_SECRET is set in Vercel env.
// We optionally check it here so random people can't trigger the sync.
//
// AfterShip API docs: https://www.aftership.com/docs/tracking/quickstart/api-quick-start
// Free plan: 50 shipments / month, ~10 req/sec rate limit.

import { createClient } from '@supabase/supabase-js'

// Vite client env vars use the VITE_ prefix (required for client bundle exposure)
// — for the serverless function we accept both prefixed and unprefixed forms so
// the cron works without the user having to add new env vars in Vercel.
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
// Prefer service role key (bypasses RLS) but fall back to the anon key if not
// set. The anon key is already shipped to the browser, so using it server-side
// adds no new exposure.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const AFTERSHIP_KEY = process.env.AFTERSHIP_API_KEY
const LARK_INTERNAL_URL = process.env.LARK_WEBHOOK_URL  // re-use direct call rather than self-fetch
// The Inventory In&Out group lives behind this env var (same one used by
// Singles event Lark routing). If set, the daily digest goes there in
// addition to the main group so the inventory team sees package
// arrivals + day-before previews alongside their other in/out events.
const LARK_INVENTORY_IO_URL = process.env.LARK_WEBHOOK_INVENTORY_IO
const CRON_SECRET = process.env.CRON_SECRET

// Map our friendly carrier names → AfterShip slugs.
// Reference: https://docs.aftership.com/api/4/couriers
const AFTERSHIP_SLUGS = {
  'USPS':        'usps',
  'UPS':         'ups',
  'FedEx':       'fedex',
  'DHL':         'dhl',
  'Japan Post':  'japan-post',
  'EMS':         'ems',
  'Yamato':      'yamato',
  'Sagawa':      'sagawa',              // 佐川急便 (JapanAcquisitions tracking)
  'SF Express':  'sf-express',
  'China Post':  'china-post-ems-ept',  // China Post EMS — most common
  // CN domestic couriers (ChinaAcquisitions tracking, Gary 2026-07-06)
  'ZTO':         'zto',                 // 中通
  'YTO':         'yto',                 // 圆通
  'STO':         'sto',                 // 申通
  'Yunda':       'yunda',               // 韵达
  'Other':       null  // let AfterShip auto-detect
}

// Date-versioned API (2026-07). The legacy /v4 endpoints + aftership-api-key
// header were retired — every call 404'd, which is why the tracking bot never
// worked from day one (diagnosed 2026-07-13: checked 111 / errors 111).
const AFTERSHIP_BASE = 'https://api.aftership.com/tracking/2026-07'

// Allow up to 60s — default 10s isn't enough when there are 30+ trackings to
// register + GET (each AfterShip call is ~500ms).
export const config = {
  maxDuration: 60
}

export default async function handler(req, res) {
  // Verify cron auth (Vercel sends Bearer ${CRON_SECRET})
  if (CRON_SECRET) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  if (!AFTERSHIP_KEY) {
    console.error('[aftership-sync] AFTERSHIP_API_KEY not set')
    return res.status(500).json({ error: 'AFTERSHIP_API_KEY not configured' })
  }
  if (!SUPABASE_KEY) {
    console.error('[aftership-sync] No Supabase key available')
    return res.status(500).json({ error: 'Supabase key not configured' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  })

  try {
    // 1. Pull all acquisitions with tracking that aren't already finished.
    //    "Finished" = delivered_notified=true (we've already pinged Lark).
    const { data: rows, error: fetchErr } = await supabase
      .from('acquisitions')
      .select(`
        id, carrier, tracking_number, aftership_registered, aftership_slug,
        tracking_status, tracking_expected_delivery, tracking_delivered_at,
        delivered_notified, product_id, quantity_purchased,
        product:products(name, brand, category, language),
        acquirer:users!acquisitions_acquirer_id_fkey(name)
      `)
      .not('tracking_number', 'is', null)
      .or('delivered_notified.is.null,delivered_notified.eq.false')

    if (fetchErr) throw fetchErr
    if (!rows || rows.length === 0) {
      return res.status(200).json({ ok: true, message: 'No tracking rows to sync', checked: 0 })
    }

    const arrivingToday = []
    const arrivingTomorrow = []
    const justDelivered = []
    const errors = []

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const todayStr = today.toISOString().slice(0, 10)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)

    for (const row of rows) {
      try {
        // effectiveSlug follows the freshest knowledge: sheet value → carrier
        // map → whatever AfterShip auto-detected at registration (Codex: the
        // GET right after a fresh register must use the detected slug, or an
        // ambiguous tracking number could match another courier's shipment).
        let effectiveSlug = row.aftership_slug || AFTERSHIP_SLUGS[row.carrier] || null

        // 2. Register with AfterShip if we haven't yet.
        if (!row.aftership_registered) {
          const reg = await registerTracking(row.tracking_number, effectiveSlug, row.id)
          if (reg.ok || reg.alreadyExists) {
            effectiveSlug = reg.slug || effectiveSlug
            await supabase.from('acquisitions').update({
              aftership_registered: true,
              aftership_slug: effectiveSlug
            }).eq('id', row.id)
          } else {
            errors.push({ id: row.id, step: 'register', error: reg.error })
            continue  // skip the GET this run; will retry tomorrow
          }
        }

        // 3. GET latest status from AfterShip.
        const status = await getTracking(row.tracking_number, effectiveSlug)
        if (!status.ok) {
          errors.push({ id: row.id, step: 'get', error: status.error })
          continue
        }

        const { tag, subtag, expected_delivery, delivered_at } = status

        // 4. Persist to DB.
        const updates = {
          tracking_status: tag,
          tracking_subtag: subtag,
          tracking_expected_delivery: expected_delivery || null,
          tracking_last_checked_at: new Date().toISOString()
        }
        if (delivered_at) updates.tracking_delivered_at = delivered_at

        // 5. Bucket for Lark digest.
        const productLabel = formatProductLabel(row.product)
        const trackInfo = {
          name: productLabel,
          qty: row.quantity_purchased || null,
          tracking: row.tracking_number,
          carrier: row.carrier,
          acquirer: row.acquirer?.name || null
        }

        const wasDelivered = row.delivered_notified
        const isDelivered = tag === 'Delivered'

        if (isDelivered && !wasDelivered) {
          justDelivered.push(trackInfo)
          updates.delivered_notified = true
        } else if (expected_delivery === todayStr && !isDelivered) {
          arrivingToday.push(trackInfo)
        } else if (expected_delivery === tomorrowStr && !isDelivered) {
          arrivingTomorrow.push(trackInfo)
        }

        await supabase.from('acquisitions').update(updates).eq('id', row.id)

        // Be polite to AfterShip — small delay between calls (rate limit ~10/sec)
        await sleep(150)
      } catch (err) {
        console.error('[aftership-sync] error processing row', row.id, err)
        errors.push({ id: row.id, error: String(err?.message || err) })
      }
    }

    // 6. Send Lark digest if anything noteworthy happened.
    const digestSent = await maybeSendDigest({
      arrivingToday, arrivingTomorrow, justDelivered
    })

    // A run where EVERY row errored is a failure, not a success — for weeks
    // this returned ok:true with errors:111 and nobody could tell the tracking
    // bot was dead (2026-07-13). Surface error samples so the cause is
    // diagnosable from the response without Vercel log access.
    const allFailed = rows.length > 0 && errors.length >= rows.length
    return res.status(200).json({
      ok: !allFailed,
      checked: rows.length,
      arrivingToday: arrivingToday.length,
      arrivingTomorrow: arrivingTomorrow.length,
      justDelivered: justDelivered.length,
      errors: errors.length,
      errorSamples: errors.slice(0, 3),
      digestSent
    })
  } catch (err) {
    console.error('[aftership-sync] fatal:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}

// --- AfterShip helpers ---

async function registerTracking(trackingNumber, slug, rowId) {
  // 2026-07 API: FLAT body (v4's nested {tracking:{...}} is gone) and the
  // as-api-key header (aftership-api-key stopped being accepted in 2023-10).
  const body = { tracking_number: trackingNumber }
  if (slug) body.slug = slug

  const r = await fetch(`${AFTERSHIP_BASE}/trackings`, {
    method: 'POST',
    headers: {
      'as-api-key': AFTERSHIP_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const json = await r.json().catch(() => ({}))

  if (r.ok) {
    // 2026-07 create returns the Tracking object directly under data.
    return { ok: true, slug: json?.data?.slug || json?.data?.tracking?.slug || slug }
  }
  // "Tracking already exists" — 4003 was the v4 code; the newer API says it in
  // the message. A bare 409 is NOT enough (Codex: could be another conflict
  // shape and would falsely mark the row registered).
  const msg = json?.meta?.message || ''
  if (json?.meta?.code === 4003 || /already exist/i.test(msg)) {
    return { ok: false, alreadyExists: true, slug: slug }
  }
  return { ok: false, error: `${json?.meta?.code || r.status}: ${msg || 'Unknown'}` }
}

async function getTracking(trackingNumber, slug) {
  // 2026-07 API dropped the /:slug/:number path — filter the list endpoint by
  // number (+ slug when known: the same number can exist on two couriers).
  let url = `${AFTERSHIP_BASE}/trackings?tracking_numbers=${encodeURIComponent(trackingNumber)}`
  if (slug) url += `&slug=${encodeURIComponent(slug)}`
  const r = await fetch(url, {
    headers: { 'as-api-key': AFTERSHIP_KEY }
  })
  const json = await r.json().catch(() => ({}))

  if (!r.ok) {
    return { ok: false, error: `${json?.meta?.code || r.status}: ${json?.meta?.message || 'Unknown'}` }
  }

  const t = json?.data?.trackings?.[0] || json?.data?.tracking
  if (!t) return { ok: false, error: 'Tracking not found in AfterShip response' }

  // ETA moved into nested estimate objects; prefer the freshest one. The old
  // flat expected_delivery stays as a harmless last fallback.
  const eta = t.latest_estimated_delivery?.datetime
    || t.latest_estimated_delivery?.datetime_min
    || t.aftership_estimated_delivery_date?.estimated_delivery_date
    || t.courier_estimated_delivery_date?.estimated_delivery_date
    || t.expected_delivery
  return {
    ok: true,
    tag: t.tag || null,
    subtag: t.subtag || null,
    expected_delivery: eta ? String(eta).slice(0, 10) : null,
    delivered_at: t.tag === 'Delivered'
      ? (t.shipment_delivery_date
         || t.checkpoints?.find?.(c => c.tag === 'Delivered')?.checkpoint_time
         || new Date().toISOString())
      : null
  }
}

// --- Lark digest ---

async function maybeSendDigest({ arrivingToday, arrivingTomorrow, justDelivered }) {
  // Gary 2026-07-13 "这个不用daily": no daily Lark digest — the cron just
  // keeps tracking_status fresh in the DB (visible in the app, e.g. Japan
  // Shipments). Set TRACKING_DIGEST=on in Vercel env to re-enable.
  if (process.env.TRACKING_DIGEST !== 'on') {
    return false
  }
  if (arrivingToday.length === 0 && arrivingTomorrow.length === 0 && justDelivered.length === 0) {
    return false  // nothing to say
  }

  // Targets: main URL (legacy) + Inventory In&Out (if configured). De-duped
  // by URL so a shared webhook doesn't double-post. At least one must be
  // set, otherwise we skip with a warning.
  const seen = new Set()
  const targets = []
  for (const [name, url] of [['main', LARK_INTERNAL_URL], ['inventory_io', LARK_INVENTORY_IO_URL]]) {
    if (url && !seen.has(url)) { seen.add(url); targets.push({ name, url }) }
  }
  if (targets.length === 0) {
    console.warn('[aftership-sync] No Lark webhook configured (LARK_WEBHOOK_URL / LARK_WEBHOOK_INVENTORY_IO) — skipping digest')
    return false
  }

  // Tracking-only digest (Gary 2026-07-06): product ×qty + carrier/tracking,
  // no costs/vendors, and an explicit ask to confirm receipt in the group chat.
  const itemLines = (item) => [
    `  • ${item.name}${item.qty ? ` ×${item.qty}` : ''}`,
    `    ${item.carrier || '?'}: ${item.tracking}${item.acquirer ? `  (by ${item.acquirer})` : ''}`
  ]

  const lines = ['📦 Tracking Update']
  lines.push('')

  if (justDelivered.length > 0) {
    lines.push(`✅ Delivered (${justDelivered.length})`)
    for (const item of justDelivered) lines.push(...itemLines(item))
    lines.push('')
  }

  if (arrivingToday.length > 0) {
    lines.push(`🚨 Arriving TODAY (${arrivingToday.length})`)
    for (const item of arrivingToday) lines.push(...itemLines(item))
    lines.push('')
  }

  if (arrivingTomorrow.length > 0) {
    lines.push(`⏰ Arriving tomorrow (${arrivingTomorrow.length})`)
    for (const item of arrivingTomorrow) lines.push(...itemLines(item))
    lines.push('')
  }

  lines.push('👉 Please confirm in this group chat when you receive it.')

  const text = lines.join('\n')
  // Fan out concurrently. We log per-target failures but consider the
  // digest sent if AT LEAST one target succeeded.
  const results = await Promise.all(targets.map(async t => {
    try {
      const r = await fetch(t.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } })
      })
      if (!r.ok) {
        console.error(`[aftership-sync] Lark digest (${t.name}) failed:`, r.status, await r.text())
        return false
      }
      return true
    } catch (err) {
      console.error(`[aftership-sync] Lark digest (${t.name}) threw:`, err)
      return false
    }
  }))
  return results.some(Boolean)
}

// --- utils ---

function formatProductLabel(product) {
  if (!product) return 'Unknown product'
  const launchName = product.category && product.name
    ? product.name.replace(new RegExp(`\\s*${product.category}\\s*$`, 'i'), '').trim() || product.name
    : (product.name || '')
  return `${product.brand || '?'} | ${launchName} | ${product.category || '?'} | ${product.language || '?'}`
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}
