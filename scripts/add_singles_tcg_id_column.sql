-- ============================================================================
-- Singles feature — add tcg_id column for raw card barcode workflow
-- ============================================================================
-- Boss's real workflow is RAW card inventory keyed by TCGplayer product ID
-- (the numeric code that the barcode scanner reads off the storage sleeve).
-- This is different from the graded-slab path which uses cert_number.
--
-- Add an indexed text column `tcg_id` on singles. Partial UNIQUE so:
--   - Only enforced on non-deleted rows (so we can soft-delete and re-add)
--   - NULL allowed (graded slabs don't have one; cert_number is their UNIQUE)
-- ============================================================================

BEGIN;

ALTER TABLE singles
  ADD COLUMN IF NOT EXISTS tcg_id TEXT;

-- Unique among active rows where tcg_id is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_singles_tcg_id_unique
  ON singles (tcg_id)
  WHERE deleted = false AND tcg_id IS NOT NULL;

-- Fast lookup for scan workflow
CREATE INDEX IF NOT EXISTS idx_singles_tcg_id
  ON singles (tcg_id)
  WHERE tcg_id IS NOT NULL;

COMMIT;
