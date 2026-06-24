-- ============================================================================
-- Fix singles UNIQUE constraint to allow same-SKU-different-location rows
-- ============================================================================
-- Context: 2026-05-15 we added idx_singles_tcg_id_unique ON (tcg_id) WHERE
-- deleted = false AND tcg_id IS NOT NULL. That was correct when "one row per
-- SKU" was the model. After moveSingleToLocation (Move Inventory page) ships
-- partial-quantity splits, the SAME tcg_id legitimately exists at multiple
-- location_ids — each row is a different physical lot, linked via
-- parent_single_id.
--
-- 2026-06-24: Will hit the bug:
--   "Failed: duplicate key value violates unique constraint
--    'idx_singles_tcg_id_unique'"
-- when moving 1× Shining Magikarp #66/64 (TCG 250327, qty 2 at source).
--
-- First attempt at the fix (just swap the index) failed because DB already
-- had ~100 dupe groups (same tcg_id+location_id, mostly Front Store) —
-- legacy of an intake path that inserted instead of incrementing existing
-- rows. So this migration does two things in one transaction:
--
--   1. Dedupe — for each (tcg_id, location_id) with >1 active rows: pick
--      the keeper (highest qty, ties → oldest), sum all quantities into
--      the keeper, soft-delete the rest with deleted_reason marking them
--      as merged.
--   2. Swap the index — drop the old single-column UNIQUE, add the new
--      composite (tcg_id, location_id) partial UNIQUE.
--
-- Verified outcome: 124 rows soft-deleted as merged, 0 dupe groups remain.
-- ============================================================================

BEGIN;

-- 1) Build the dedupe plan in a temp table — for each (tcg_id, location_id)
--    with > 1 active rows, pick a keeper (highest qty, ties broken by
--    earliest created_at) and compute the summed quantity that keeper
--    should hold once the merge is done.
CREATE TEMP TABLE _dedupe_plan AS
WITH groups AS (
  SELECT tcg_id, location_id
  FROM singles
  WHERE deleted = false
    AND tcg_id IS NOT NULL
    AND location_id IS NOT NULL
  GROUP BY tcg_id, location_id
  HAVING COUNT(*) > 1
),
keepers AS (
  SELECT DISTINCT ON (s.tcg_id, s.location_id)
    s.id AS keeper_id,
    s.tcg_id,
    s.location_id
  FROM singles s
  INNER JOIN groups g USING (tcg_id, location_id)
  WHERE s.deleted = false
  ORDER BY s.tcg_id, s.location_id, s.quantity DESC, s.created_at ASC
),
totals AS (
  SELECT s.tcg_id, s.location_id, SUM(s.quantity) AS total_qty
  FROM singles s
  INNER JOIN groups g USING (tcg_id, location_id)
  WHERE s.deleted = false
  GROUP BY s.tcg_id, s.location_id
)
SELECT k.keeper_id, k.tcg_id, k.location_id, t.total_qty
FROM keepers k
JOIN totals t USING (tcg_id, location_id);

-- 2) Roll all sibling quantities into the keeper row.
UPDATE singles s
SET quantity = p.total_qty
FROM _dedupe_plan p
WHERE s.id = p.keeper_id;

-- 3) Soft-delete every non-keeper in each dupe group, with a deleted_reason
--    that names the keeper so the merge is traceable in the audit log.
UPDATE singles s
SET deleted = true,
    deleted_at = now(),
    deleted_reason = 'Merged into ' || p.keeper_id::text ||
                     ' during 2026-06-24 same-location dedupe (qty rolled into keeper)'
FROM _dedupe_plan p
WHERE s.tcg_id = p.tcg_id
  AND s.location_id = p.location_id
  AND s.id <> p.keeper_id
  AND s.deleted = false;

-- 4) Data is clean — flip the index.
DROP INDEX IF EXISTS idx_singles_tcg_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_singles_tcg_id_location_unique
  ON singles (tcg_id, location_id)
  WHERE deleted = false
    AND tcg_id IS NOT NULL
    AND location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_singles_tcg_id
  ON singles (tcg_id)
  WHERE deleted = false AND tcg_id IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM (
    SELECT tcg_id, location_id FROM singles
    WHERE deleted = false AND tcg_id IS NOT NULL AND location_id IS NOT NULL
    GROUP BY tcg_id, location_id HAVING COUNT(*) > 1
  ) x) AS dupe_groups_remaining,
  (SELECT COUNT(*) FROM singles WHERE deleted_reason LIKE '%2026-06-24 same-location dedupe%') AS rows_merged_today;
