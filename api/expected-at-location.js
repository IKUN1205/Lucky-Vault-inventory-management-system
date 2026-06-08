// api/expected-at-location.js
// Used by the Cards Audit page's Physical Count mode. Returns the list of
// cards (singles or slabs) that the app database expects to be at a given
// physical location — so staff can scan what's actually there and compare.
//
// Singles get aggregated by tcg_id (a card with qty=5 in one row appears
// once with expected_qty=5; if there are multiple rows at the same
// location for the same tcg_id, qty is summed across them).
// Slabs are unique items — one row per cert.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://dqreqevbjszercgackuc.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  const { kind, location } = req.query || req.body || {}
  if (!kind || !['single', 'slab'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be "single" or "slab"' })
  }
  if (!location) {
    return res.status(400).json({ error: 'location is required' })
  }
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Supabase key not configured' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  try {
    // 1. Resolve location name → id
    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .select('id, name')
      .eq('name', location)
      .maybeSingle()
    if (locErr) throw locErr
    if (!loc) return res.status(400).json({ error: `Unknown location: "${location}"` })

    if (kind === 'single') {
      // Pull all live (non-sold) singles at this location
      const { data, error } = await supabase
        .from('singles')
        .select('id, tcg_id, quantity, card_name, card_number, condition')
        .eq('location_id', loc.id)
        .neq('status', 'sold')
        .eq('deleted', false)
        .not('tcg_id', 'is', null)
      if (error) throw error
      // Aggregate by tcg_id — staff scans by TCG ID, and a card with
      // qty=5 in one row is the SAME identity as the same tcg_id in
      // another row. We sum qty across all rows.
      const byId = new Map()
      for (const r of data || []) {
        const id = String(r.tcg_id).trim()
        if (!id) continue
        const cur = byId.get(id) || {
          id, expected_qty: 0, db_row_ids: [],
          card_name: r.card_name || null,
          card_number: r.card_number || null,
          condition: r.condition || null,
        }
        cur.expected_qty += Number(r.quantity) || 0
        cur.db_row_ids.push(r.id)
        byId.set(id, cur)
      }
      const expected = [...byId.values()].sort((a, b) =>
        (a.card_name || '').localeCompare(b.card_name || '')
      )
      const totalUnits = expected.reduce((s, e) => s + e.expected_qty, 0)
      return res.status(200).json({
        ok: true, kind, location: loc,
        expected,
        summary: {
          unique_ids: expected.length,
          total_units: totalUnits,
        },
      })
    }

    // slabs — each row is its own item
    const { data, error } = await supabase
      .from('slabs')
      .select('id, cert_number, item_name, grading_company')
      .eq('location_id', loc.id)
      .neq('status', 'sold')
      .eq('deleted', false)
      .not('cert_number', 'is', null)
    if (error) throw error
    const expected = (data || [])
      .map(r => ({
        id: String(r.cert_number).trim(),
        expected_qty: 1,
        db_row_ids: [r.id],
        item_name: r.item_name || null,
        grading_company: r.grading_company || null,
      }))
      .filter(e => e.id)
      .sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''))
    return res.status(200).json({
      ok: true, kind, location: loc,
      expected,
      summary: { unique_ids: expected.length, total_units: expected.length },
    })
  } catch (err) {
    console.error('[expected-at-location]', kind, location, err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
