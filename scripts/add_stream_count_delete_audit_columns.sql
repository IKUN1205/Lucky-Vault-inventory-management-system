-- ============================================================================
-- Soft-delete metadata for stream_counts + needs_recompute flag on
-- stream_reconciliations
-- ============================================================================
-- Context: stream_counts.deleted (boolean) already exists in prod and is used
-- by the post-submit Undo flow. This migration adds richer audit metadata so
-- admin-initiated deletions (e.g. Will retroactively retracting a test count)
-- can be traced: who deleted, when, why.
--
-- We also add needs_recompute on stream_reconciliations so that when a count
-- is deleted, the NEXT count's audit (whose window was anchored to the
-- now-deleted count's count_time) can be flagged for re-running — its
-- window_from is stale.
--
-- Run once in Supabase SQL Editor. Idempotent — every statement uses
-- IF NOT EXISTS so re-running is a no-op.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- stream_counts: deletion audit trail
-- ---------------------------------------------------------------------------
ALTER TABLE stream_counts
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason  TEXT;

-- Index for "show me everything deleted recently" admin views
CREATE INDEX IF NOT EXISTS idx_stream_counts_deleted_at
  ON stream_counts (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- stream_reconciliations: flag for "upstream count was deleted, my window
-- is now stale, please re-run me"
-- ---------------------------------------------------------------------------
ALTER TABLE stream_reconciliations
  ADD COLUMN IF NOT EXISTS needs_recompute   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recompute_reason  TEXT;

CREATE INDEX IF NOT EXISTS idx_stream_reconciliations_needs_recompute
  ON stream_reconciliations (created_at DESC)
  WHERE needs_recompute = true;

-- ---------------------------------------------------------------------------
-- Verify (each should return 0 rows initially, columns visible in
-- information_schema):
-- ---------------------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'stream_counts'
--     AND column_name IN ('deleted_at','deleted_by_id','deleted_reason');
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'stream_reconciliations'
--     AND column_name IN ('needs_recompute','recompute_reason');
