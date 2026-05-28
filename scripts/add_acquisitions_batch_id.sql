-- ============================================================================
-- Add batch_id to acquisitions — groups items from one Purchased Items submit
-- ============================================================================
-- A single Purchased Items form submission creates one acquisition row per
-- line item. They share date/vendor/carrier/tracking but had no explicit
-- "these arrived together" key. batch_id (one UUID stamped per submission)
-- lets the Intake to Master page group a purchase order together so staff
-- can see at a glance whether the whole batch has arrived.
--
-- Nullable + additive: old rows stay NULL (rendered individually on Intake).
-- No backfill — historical purchases are mostly received already.
-- ============================================================================

ALTER TABLE acquisitions
  ADD COLUMN IF NOT EXISTS batch_id UUID;

-- Fast grouping/filtering on the Intake page.
CREATE INDEX IF NOT EXISTS idx_acquisitions_batch_id
  ON acquisitions (batch_id)
  WHERE batch_id IS NOT NULL;
