-- ============================================================================
-- Cards Transfer — Step 1: schema + backfill
-- ============================================================================
-- Adds slabs.location_id (singles already has it from creation) and backfills
-- every active row in both tables to the "Slab Room" location, so the
-- upcoming Transfer feature has a real starting point instead of NULL.
--
-- Per user direction 2026-05-18:
--   * Existing singles → all go to Slab Room
--   * Existing slabs   → all go to Slab Room (column being added now)
--
-- Re-runnable: IF NOT EXISTS on the column, WHERE location_id IS NULL on the
-- backfill, so running this twice does nothing the second time.
-- ============================================================================

BEGIN;

-- 1. slabs.location_id column + FK + partial index (matching singles' shape)
ALTER TABLE slabs
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_slabs_location
  ON slabs (location_id)
  WHERE deleted = false;

-- 2. Backfill — single lookup of Slab Room, applied to both tables.
--    DO block so we can fail loudly if the location name doesn't match.
DO $$
DECLARE
  v_loc_id uuid;
  v_slabs_updated   integer;
  v_singles_updated integer;
BEGIN
  SELECT id INTO v_loc_id FROM locations WHERE name = 'Slab Room';

  IF v_loc_id IS NULL THEN
    RAISE EXCEPTION 'Location "Slab Room" not found in locations table — fix the name in this script and re-run';
  END IF;

  UPDATE slabs
    SET location_id = v_loc_id
    WHERE location_id IS NULL
      AND (deleted IS NULL OR deleted = false);
  GET DIAGNOSTICS v_slabs_updated = ROW_COUNT;

  UPDATE singles
    SET location_id = v_loc_id
    WHERE location_id IS NULL
      AND (deleted IS NULL OR deleted = false);
  GET DIAGNOSTICS v_singles_updated = ROW_COUNT;

  RAISE NOTICE 'Backfilled % slab rows and % single rows to Slab Room (%)',
    v_slabs_updated, v_singles_updated, v_loc_id;
END;
$$;

COMMIT;

-- 3. Verify (run after the BEGIN/COMMIT block — should all be the same counts
--    on the left and the right, and the "missing" columns should be 0).
SELECT
  (SELECT COUNT(*) FROM slabs   WHERE location_id IS NULL AND (deleted IS NULL OR deleted = false))     AS slabs_missing_location,
  (SELECT COUNT(*) FROM singles WHERE location_id IS NULL AND (deleted IS NULL OR deleted = false))     AS singles_missing_location,
  (SELECT COUNT(*) FROM slabs   WHERE (deleted IS NULL OR deleted = false))                              AS active_slabs,
  (SELECT COUNT(*) FROM singles WHERE (deleted IS NULL OR deleted = false))                              AS active_singles,
  (SELECT id   FROM locations WHERE name = 'Slab Room')                                                  AS slab_room_id;
