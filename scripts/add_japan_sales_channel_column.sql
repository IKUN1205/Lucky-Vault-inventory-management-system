-- ============================================================================
-- Add `channel` column to japan_stream_sales
-- ============================================================================
-- Background: japan_stream_sales started life as "direct livestream sales out
-- of Japan Warehouse". We're broadening it to also cover 日本当地售卖 — local
-- in-store / off-platform sales — because they're the SAME inventory outflow
-- with the same minimal fields (product / qty / unit price / who / when),
-- just a different sales channel.
--
-- Decision (2026-05-27, with William): keep ONE table, distinguish with a
-- `channel` column. Existing rows = 'stream'; new local sales = 'local'.
-- Both are still hard-decrement outflows from Japan Warehouse with USD
-- conversion at sale time and the same undo / soft-delete behavior. The
-- only behavioral fork is Lark routing — local sales go ONLY to the
-- Inventory In&Out group (not the Japan group), since they're a US-side
-- audit concern more than a Japan-team announcement.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE japan_stream_sales
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'stream'
    CHECK (channel IN ('stream', 'local'));

-- Index for cheap channel-filtered fetches (the Log page and per-channel
-- views both filter by channel + ORDER BY sale_date DESC).
CREATE INDEX IF NOT EXISTS idx_japan_stream_sales_channel
  ON japan_stream_sales (channel, sale_date DESC);

COMMIT;

-- Verify:
--   SELECT channel, COUNT(*) FROM japan_stream_sales GROUP BY channel;
--   -- pre-rollout expectation: all rows are 'stream'.
