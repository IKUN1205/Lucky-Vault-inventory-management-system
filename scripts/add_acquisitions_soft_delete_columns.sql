-- ============================================================================
-- Add soft-delete audit columns to acquisitions
-- ============================================================================
-- `acquisitions.deleted` (boolean) already exists in production — the Japan
-- shipment fetch already filters on it. But the audit-trail companions
-- (deleted_at / deleted_by_id / deleted_reason) were only ever added to
-- japan_stream_sales, not to acquisitions. The Japan→US shipment "撤销"
-- (cancel) flow soft-deletes the acquisition row and wants to record WHO
-- canceled it, WHEN, and WHY — same convention as stream_counts /
-- japan_stream_sales.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE acquisitions
  ADD COLUMN IF NOT EXISTS deleted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'acquisitions'
--     AND column_name IN ('deleted','deleted_at','deleted_by_id','deleted_reason');
