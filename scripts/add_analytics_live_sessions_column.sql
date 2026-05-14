-- ============================================================================
-- P2 slice 2: store TikTok Analytics LIVE per-session data per reconciliation
-- ============================================================================
-- auto-reconcile already harvests the order list and clusters LIVE-tagged
-- orders into sessions. That works for SKU-level breakdown but misses any
-- units NOT carrying the LIVE tag — TikTok marks orders LIVE only when the
-- buyer clicks the LIVE feed itself; if they go to the shop tab during
-- the stream and buy, no LIVE tag, even though the sale is functionally
-- attributable to the stream.
--
-- TikTok's own Content Analytics → LIVE page surfaces the authoritative
-- per-session totals (GMV, items sold, customers) that include both LIVE
-- and shop-tab attribution. This column stores a snapshot of that data
-- per reconciliation run so audit-history can compare:
--   "Order-list says 31 LIVE units, Analytics LIVE says 124 total
--    attributed — the 93 gap is non-LIVE-tagged shop traffic during
--    the stream window."
--
-- Each element of the array is one session that overlaps the recon
-- window. Shape:
--   {
--     live_id: string,           // TikTok's session UUID
--     title: string,             // e.g. "Wednesday Rips W/Yazi"
--     start_unix: integer,       // session start (UTC seconds)
--     end_unix: integer,
--     duration_minutes: integer,
--     gmv_usd: number,
--     items_sold: integer,       // TikTok's attribute count
--     sku_orders: integer,
--     customers: integer,
--     ctor_pct, live_ctr_pct, views, avg_price_usd
--   }
--
-- Run once in Supabase SQL Editor. Idempotent.
-- ============================================================================

ALTER TABLE stream_reconciliations
  ADD COLUMN IF NOT EXISTS analytics_live_sessions JSONB;

COMMENT ON COLUMN stream_reconciliations.analytics_live_sessions IS
  'Snapshot of TikTok seller-center "Content Analytics → LIVE" data for
   sessions that overlap this reconciliation window. Provides TikTok-
   official items_sold per session (which counts BOTH LIVE-tagged and
   shop-tab attribution) — more accurate than the order-list LIVE-tag
   aggregation we do separately. Array of session objects (live_id,
   title, start/end_unix, items_sold, gmv_usd, etc.).';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'stream_reconciliations'
  AND column_name = 'analytics_live_sessions';
