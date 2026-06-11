// api/audit-cron.js
// Vercel cron — hourly at :45, right after both sheet syncs finish
// (singles at :00, slabs at :30). Runs the SAME full audit the Cards
// Audit page runs (runFullAudit from api/audit-cards.js) for both kinds,
// so app-vs-sheet drift surfaces within the hour instead of waiting for
// someone to press "Run full audit".
//
// Alerting policy (boss directive 2026-06-10 "自动 full audit after every
// sync" — the 2026-06-09 wrong-name incident sat undetected until a sold
// listing was eyeballed):
//   - Only ACTIONABLE issues alert: severity=critical (the two sides
//     disagree about whether something is sold/exists) plus name_mismatch
//     (warning severity, but it's the wrong-name incident class). Codes
//     like missing_in_sheet are normal for in-app intakes and would be
//     hourly spam.
//   - Only NEW issues alert. Each run stores its actionable fingerprints
//     ("code:id") in the audit_runs table; the next run diffs against the
//     previous run and pings Lark only for fingerprints that weren't there
//     an hour ago. Resolved counts ride along for context.
//   - If audit_runs doesn't exist yet (scripts/add_audit_runs.sql not run),
//     we still audit and alert whenever anything actionable exists — just
//     without dedup, and the message says how to enable it.
//
// Routed to LARK_WEBHOOK_INVENTORY_IO (the inventory in/out audit channel)
// with LARK_WEBHOOK_URL fallback — same as the two sync crons.
//
// Vercel attaches Authorization: Bearer ${CRON_SECRET} when invoking.

import { createClient } from '@supabase/supabase-js'
import { runFullAudit } from './audit-cards.js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LARK_URL = process.env.LARK_WEBHOOK_INVENTORY_IO
  || process.env.LARK_WEBHOOK_URL

// 300, not 60: this runs TWO full audits (the page's single-audit endpoint
// already estimates 10-30s each) plus bookkeeping, and a platform timeout
// kill bypasses the catch block's loud-failure ping — the one failure mode
// this endpoint can't self-report. auto-reconcile.js uses the same budget.
export const config = { maxDuration: 300 }

const isActionable = (issue) =>
  issue.severity === 'critical' || issue.code === 'name_mismatch'
const fingerprint = (issue) => `${issue.code}:${issue.id}`

// Short labels for the Lark message — keep in sync with the actionable
// codes compareOne can emit (full label map lives in CardsAudit.jsx).
const CODE_LABELS = {
  missing_in_db:                          'In sheet but NOT in app',
  sold_but_sheet_shows_available:         'Sold in app, sheet still shows available',
  sheet_says_sold_but_inventory_remains:  'Sheet says sold, app still has stock',
  sheet_says_sold_but_app_says_available: 'Sheet says sold, app says available',
  name_mismatch:                          'Name mismatch (app vs sheet)',
}

// Returns true when the message was accepted — or when no webhook is
// configured at all (alerting is impossible then, so it shouldn't hold the
// dedup baseline hostage). Returns false on any send failure so the caller
// can skip committing the baseline and re-alert next run: duplicate pings
// are the correct failure direction for an alerting endpoint.
async function postLark(text) {
  if (!LARK_URL) return true
  try {
    const r = await fetch(LARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    })
    if (!r.ok) {
      console.error('[audit-cron] Lark non-OK:', r.status, await r.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.error('[audit-cron] Lark notify failed:', err)
    return false
  }
}

function nowPtStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} PT`
}

export default async function handler(req, res) {
  if (CRON_SECRET) {
    if ((req.headers.authorization || '') !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    await postLark('⚠️ Hourly auto-audit FAILED — GOOGLE_SERVICE_ACCOUNT_JSON not configured')
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const startedAt = Date.now()

  // History dedup degrades gracefully: if the audit_runs table is missing
  // (migration not run yet), we audit anyway and alert without dedup.
  let historyAvailable = true
  const report = {}
  // audit_runs rows are buffered here and committed ONLY after the Lark
  // alert lands (or when there's nothing to alert). Committing first would
  // make alerting at-most-once: a crash or failed send between insert and
  // ping would bake the fingerprints into the baseline and those issues
  // would never alert again.
  const pendingInserts = []

  try {
    // Both kinds audit concurrently — different spreadsheets, different
    // tables, so they don't contend; roughly halves wall time vs sequential.
    const audits = {}
    await Promise.all(['single', 'slab'].map(async (k) => {
      audits[k] = await runFullAudit(supabase, k)
    }))

    for (const kind of ['single', 'slab']) {
      const { summary, issues } = audits[kind]
      const actionable = issues.filter(isActionable)
      const prints = actionable.map(fingerprint)

      // Previous run's fingerprints — most recent stored run for this kind.
      // First-ever run has no prior row, so everything actionable counts as
      // new once (a useful baseline ping).
      let prevPrints = []
      if (historyAvailable) {
        const { data, error } = await supabase
          .from('audit_runs')
          .select('actionable')
          .eq('kind', kind)
          .order('created_at', { ascending: false })
          .limit(1)
        if (error) {
          historyAvailable = false
          console.error('[audit-cron] audit_runs read failed (table missing? run scripts/add_audit_runs.sql):', error.message)
        } else {
          prevPrints = Array.isArray(data?.[0]?.actionable) ? data[0].actionable : []
        }
      }

      const prevSet = new Set(prevPrints)
      const curSet = new Set(prints)
      const fresh = historyAvailable ? actionable.filter(i => !prevSet.has(fingerprint(i))) : actionable
      const resolvedCount = historyAvailable ? prevPrints.filter(p => !curSet.has(p)).length : 0

      if (historyAvailable) {
        pendingInserts.push({
          kind,
          total_db_ids: summary.total_db_ids,
          total_sheet_ids: summary.total_sheet_ids,
          total_issues: summary.total_issues,
          by_code: summary.by_code,
          actionable: prints,
          new_count: fresh.length,
          resolved_count: resolvedCount,
        })
      }

      report[kind] = {
        total_issues: summary.total_issues,
        actionable_count: actionable.length,
        new_issues: fresh,
        resolved_count: resolvedCount,
        total_db_ids: summary.total_db_ids,
        total_sheet_ids: summary.total_sheet_ids,
      }
    }

    const totalNew = report.single.new_issues.length + report.slab.new_issues.length
    let larkSent = true
    if (totalNew > 0) {
      const lines = []
      lines.push(`🔍 Hourly auto-audit — ${totalNew} new issue${totalNew === 1 ? '' : 's'}`)
      for (const [kind, label] of [['single', '🎴 Singles'], ['slab', '💎 Slabs']]) {
        const r = report[kind]
        if (r.new_issues.length === 0) {
          lines.push(`${label}: nothing new${r.resolved_count > 0 ? ` (${r.resolved_count} resolved)` : ''}`)
          continue
        }
        lines.push(`${label} — ${r.new_issues.length} new:`)
        // Group new issues by code, list a few ids per code.
        const ids = new Map()
        for (const i of r.new_issues) {
          if (!ids.has(i.code)) ids.set(i.code, [])
          ids.get(i.code).push(i.id)
        }
        for (const [code, list] of ids) {
          const shown = list.slice(0, 5).join(', ')
          const more = list.length > 5 ? ` +${list.length - 5} more` : ''
          lines.push(`  • ${CODE_LABELS[code] || code}: ${shown}${more}`)
        }
        if (r.resolved_count > 0) lines.push(`  (${r.resolved_count} resolved since last run)`)
      }
      lines.push('')
      lines.push('Details + one-click fixes: app → Cards Audit → Run full audit')
      if (!historyAvailable) {
        lines.push('ℹ️ Dedup is OFF (audit_runs table missing) — this list repeats hourly until fixed. Run scripts/add_audit_runs.sql in Supabase to only get pinged on NEW issues.')
      }
      lines.push(`Time: ${nowPtStamp()}`)
      larkSent = await postLark(lines.join('\n'))
    }

    // Commit the dedup baseline only now that the alert landed (or wasn't
    // needed). On a failed send we deliberately skip it — next run diffs
    // against the older baseline and re-alerts.
    if (historyAvailable && larkSent && pendingInserts.length > 0) {
      const { error: insErr } = await supabase.from('audit_runs').insert(pendingInserts)
      if (insErr) console.error('[audit-cron] audit_runs insert failed:', insErr.message)
    }

    return res.status(200).json({
      ok: true,
      took_ms: Date.now() - startedAt,
      history: historyAvailable,
      larked: totalNew > 0 && larkSent,
      baseline_committed: historyAvailable && larkSent,
      single: {
        total_issues: report.single.total_issues,
        actionable: report.single.actionable_count,
        new: report.single.new_issues.length,
        resolved: report.single.resolved_count,
      },
      slab: {
        total_issues: report.slab.total_issues,
        actionable: report.slab.actionable_count,
        new: report.slab.new_issues.length,
        resolved: report.slab.resolved_count,
      },
    })
  } catch (err) {
    console.error('[audit-cron]', err)
    // Loud failure — a silently dead audit cron is exactly the blind spot
    // this endpoint exists to remove.
    await postLark(`⚠️ Hourly auto-audit FAILED — ${err.message || err}\nTime: ${nowPtStamp()}`)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
