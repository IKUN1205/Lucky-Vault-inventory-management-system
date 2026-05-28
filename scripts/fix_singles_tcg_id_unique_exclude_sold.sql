-- ============================================================================
-- Fix: scope idx_singles_tcg_id_unique to ACTIVE rows only (exclude 'sold')
-- ============================================================================
-- The original index (add_singles_tcg_id_column.sql) enforced uniqueness on
-- tcg_id across ALL non-deleted rows:
--     WHERE deleted = false AND tcg_id IS NOT NULL
--
-- That breaks two legitimate flows:
--   1. Partial storefront sale of a stacked raw single (qty 2, sell 1):
--      _sellSingleLine keeps the source row (in_inventory, qty 1) AND
--      inserts a 'sold' clone with the SAME tcg_id. Both deleted=false →
--      duplicate-key violation ("Line failed: duplicate key value violates
--      unique constraint idx_singles_tcg_id_unique").
--   2. Re-intaking a card whose previous copy was fully sold: the sold row
--      (deleted=false, same tcg_id) collides with the new in_inventory row.
--
-- The constraint we actually want is "at most ONE active (non-sold) row per
-- tcg_id" — sold rows are immutable history and may legitimately repeat as
-- the same card type sells over time. Excluding status='sold' fixes both
-- flows while still preventing two live in_inventory rows for one tcg_id
-- (the stacking-intake backstop).
--
-- Safe to run: we verified 0 collisions among non-deleted rows, and the new
-- predicate is strictly narrower (it covers fewer rows), so the unique index
-- can only build cleaner than the old one.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_singles_tcg_id_unique;

CREATE UNIQUE INDEX idx_singles_tcg_id_unique
  ON singles (tcg_id)
  WHERE deleted = false
    AND status <> 'sold'
    AND tcg_id IS NOT NULL;

COMMIT;
