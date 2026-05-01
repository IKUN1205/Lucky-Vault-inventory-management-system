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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dqreqevbjszercgackuc.supabase.co'
// Prefer service role key (bypasses RLS) but fall back to anon key if not set.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
const AFTERSHIP_KEY = process.env.AFTERSHIP_API_KEY
const LARK_INTERNAL_URL = process.env.LARK_WEBHOOK_URL  // re-use direct call rather than self-fetch
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
  'SF Express':  'sf-express',
  'China Post':  'china-post-ems-ept',  // China Post EMS — most common
  'Other':       null  // let AfterShip auto-detect
}

const AFTERSHIP_BASE = 'https://api.aftership.com/v4'

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
        delivered_notified, product_id,
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
        const slug = row.aftership_slug || AFTERSHIP_SLUGS[row.carrier] || null

        // 2. Register with AfterShip if we haven't yet.
        if (!row.aftership_registered) {
          const reg = await registerTracking(row.tracking_number, slug, row.id)
          if (reg.ok) {
            await supabase.from('acquisitions').update({
              aftership_registered: true,
              aftership_slug: reg.slug || slug
            }).eq('id', row.id)
          } else if (reg.alreadyExists) {
            // Already registered by a previous run that crashed before saving — fine.
            await supabase.from('acquisitions').update({
              aftership_registered: true,
              aftership_slug: reg.slug || slug
            }).eq('id', row.id)
          } else {
            errors.push({ id: row.id, step: 'register', error: reg.error })
            continue  // skip the GET this run; will retry tomorrow
          }
        }

        // 3. GET latest status from AfterShip.
        const status = await getTracking(row.tracking_number, row.aftership_slug || slug)
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

    return res.status(200).json({
      ok: true,
      checked: rows.length,
      arrivingToday: arrivingToday.length,
      arrivingTomorrow: arrivingTomorrow.length,
      justDelivered: justDelivered.length,
      errors: errors.length,
      digestSent
    })
  } catch (err) {
    console.error('[aftership-sync] fatal:', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}

// --- AfterShip helpers ---

async function registerTracking(trackingNumber, slug, rowId) {
  const body = { tracking: { tracking_number: trackingNumber } }
  if (slug) body.tracking.slug = slug

  const r = await fetch(`${AFTERSHIP_BASE}/trackings`, {
    method: 'POST',
    headers: {
      'aftership-api-key': AFTERSHIP_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const json = await r.json().catch(() => ({}))

  if (r.ok) {
    return { ok: true, slug: json?.data?.tracking?.slug || slug }
  }
  // 4003 = "Tracking already exists" — treat as success.
  if (json?.meta?.code === 4003) {
    return { ok: false, alreadyExists: true, slug: slug }
  }
  return { ok: false, error: `${json?.meta?.code || r.status}: ${json?.meta?.message || 'Unknown'}` }
}

async function getTracking(trackingNumber, slug) {
  // If we have a slug, use the indexed lookup; otherwise search by number.
  let url
  if (slug) {
    url = `${AFTERSHIP_BASE}/trackings/${slug}/${encodeURIComponent(trackingNumber)}`
  } else {
    url = `${AFTERSHIP_BASE}/trackings?tracking_numbers=${encodeURIComponent(trackingNumber)}`
  }
  const r = await fetch(url, {
    headers: { 'aftership-api-key': AFTERSHIP_KEY }
  })
  const json = await r.json().catch(() => ({}))

  if (!r.ok) {
    return { ok: false, error: `${json?.meta?.code || r.status}: ${json?.meta?.message || 'Unknown'}` }
  }

  // Single-fetch returns data.tracking; list returns data.trackings[]
  const t = json?.data?.tracking || json?.data?.trackings?.[0]
  if (!t) return { ok: false, error: 'Empty AfterShip response' }

  return {
    ok: true,
    tag: t.tag || null,
    subtag: t.subtag || null,
    // expected_delivery may be ISO date or full datetime; normalize to YYYY-MM-DD
    expected_delivery: t.expected_delivery ? String(t.expected_delivery).slice(0, 10) : null,
    delivered_at: t.tag === 'Delivered'
      ? (t.checkpoints?.find?.(c => c.tag === 'Delivered')?.checkpoint_time || new Date().toISOString())
      : null
  }
}

// --- Lark digest ---

async function maybeSendDigest({ arrivingToday, arrivingTomorrow, justDelivered }) {
  if (arrivingToday.length === 0 && arrivingTomorrow.length === 0 && justDelivered.length === 0) {
    return false  // nothing to say
  }
  if (!LARK_INTERNAL_URL) {
    console.warn('[aftership-sync] LARK_WEBHOOK_URL not set — skipping digest')
    return false
  }

  const lines = ['📦 Tracking Update']
  lines.push(`Time: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  lines.push('')

  if (justDelivered.length > 0) {
    lines.push(`✅ Delivered (${justDelivered.length})`)
    for (const item of justDelivered) {
      lines.push(`  • ${item.name}`)
      lines.push(`    ${item.carrier || '?'}: ${item.tracking}${item.acquirer ? `  (by ${item.acquirer})` : ''}`)
    }
    lines.push('')
  }

  if (arrivingToday.length > 0) {
    lines.push(`🚨 Arriving TODAY (${arrivingToday.length})`)
    for (const item of arrivingToday) {
      lines.push(`  • ${item.name}`)
      lines.push(`    ${item.carrier || '?'}: ${item.tracking}${item.acquirer ? `  (by ${item.acquirer})` : ''}`)
    }
    lines.push('')
  }

  if (arrivingTomorrow.length > 0) {
    lines.push(`⏰ Arriving tomorrow (${arrivingTomorrow.length})`)
    for (const item of arrivingTomorrow) {
      lines.push(`  • ${item.name}`)
      lines.push(`    ${item.carrier || '?'}: ${item.tracking}${item.acquirer ? `  (by ${item.acquirer})` : ''}`)
    }
  }

  const text = lines.join('\n')
  const r = await fetch(LARK_INTERNAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } })
  })
  if (!r.ok) {
    console.error('[aftership-sync] Lark digest failed:', r.status, await r.text())
    return false
  }
  return true
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
