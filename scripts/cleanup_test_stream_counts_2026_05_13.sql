-- ============================================================================
-- Cleanup test stream counts — 2026-05-13
-- ============================================================================
-- User manually entered ~5 stream counts at the TikTok Packheads room while
-- testing the auto-reconcile pipeline (4 × EB-03 Heroines Edition, etc.).
-- These are not real sales and need to be removed before next real stream.
--
-- This script is intentionally two-step:
--   1. Run the SELECTs first to confirm exactly which rows will be deleted.
--   2. Once the SELECT output looks right, run the DELETE block inside the
--      transaction. The BEGIN/SELECT/COMMIT pattern lets you verify counts
--      mid-transaction and ROLLBACK if anything looks off.
--
-- Run in Supabase → SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Preview what we're about to delete (run this on its own first)
-- ----------------------------------------------------------------------------

-- The 4-5 test stream counts at TikTok Packheads on 2026-05-12 to 2026-05-13.
-- Adjust the date range if needed.
SELECT
  sc.id,
  sc.count_time,
  sc.location_id,
  l.name AS location_name,
  streamer.name AS streamer_name,
  counter.name AS counted_by_name,
  (SELECT count(*) FROM stream_count_items WHERE stream_count_id = sc.id) AS item_count,
  (SELECT sum(GREATEST(expected_qty - actual_qty, 0)) FROM stream_count_items WHERE stream_count_id = sc.id) AS sold_units
FROM stream_counts sc
LEFT JOIN locations l ON l.id = sc.location_id
LEFT JOIN users streamer ON streamer.id = sc.streamer_id
LEFT JOIN users counter ON counter.id = sc.counted_by_id
WHERE l.name ILIKE '%TikTok%Packheads%'
  AND sc.count_time >= '2026-05-12 00:00:00'
  AND sc.count_time <  '2026-05-14 00:00:00'
  AND sc.deleted = false
ORDER BY sc.count_time;

-- The reconciliation row(s) that were generated from those counts.
SELECT
  r.id,
  r.stream_count_id,
  r.status,
  r.window_from,
  r.window_to,
  r.total_diff,
  r.flagged_count
FROM stream_reconciliations r
JOIN stream_counts sc ON sc.id = r.stream_count_id
LEFT JOIN locations l ON l.id = sc.location_id
WHERE l.name ILIKE '%TikTok%Packheads%'
  AND sc.count_time >= '2026-05-12 00:00:00'
  AND sc.count_time <  '2026-05-14 00:00:00';

-- ----------------------------------------------------------------------------
-- STEP 2: Delete (only run after SELECT output looks right)
-- ----------------------------------------------------------------------------
-- Wrap in a transaction so you can ROLLBACK if anything looks off.
-- IMPORTANT: uncomment the BEGIN/COMMIT lines to actually run the deletes.

-- BEGIN;

  -- stream_reconciliations cascades on stream_count_id (ON DELETE CASCADE),
  -- so deleting the stream_counts rows takes care of recon rows too. But
  -- being explicit avoids surprises.
  DELETE FROM stream_reconciliations r
  USING stream_counts sc, locations l
  WHERE r.stream_count_id = sc.id
    AND sc.location_id = l.id
    AND l.name ILIKE '%TikTok%Packheads%'
    AND sc.count_time >= '2026-05-12 00:00:00'
    AND sc.count_time <  '2026-05-14 00:00:00';

  -- stream_count_items has ON DELETE CASCADE from stream_counts, so deleting
  -- the parent stream_counts row removes its items automatically. Explicit
  -- here for clarity.
  DELETE FROM stream_count_items
  WHERE stream_count_id IN (
    SELECT sc.id
    FROM stream_counts sc
    LEFT JOIN locations l ON l.id = sc.location_id
    WHERE l.name ILIKE '%TikTok%Packheads%'
      AND sc.count_time >= '2026-05-12 00:00:00'
      AND sc.count_time <  '2026-05-14 00:00:00'
  );

  -- The stream_counts rows themselves.
  DELETE FROM stream_counts
  WHERE id IN (
    SELECT sc.id
    FROM stream_counts sc
    LEFT JOIN locations l ON l.id = sc.location_id
    WHERE l.name ILIKE '%TikTok%Packheads%'
      AND sc.count_time >= '2026-05-12 00:00:00'
      AND sc.count_time <  '2026-05-14 00:00:00'
  );

  -- Verify the deletes look right BEFORE COMMIT.
  -- This should return 0 rows.
  SELECT count(*) AS remaining_test_counts
  FROM stream_counts sc
  LEFT JOIN locations l ON l.id = sc.location_id
  WHERE l.name ILIKE '%TikTok%Packheads%'
    AND sc.count_time >= '2026-05-12 00:00:00'
    AND sc.count_time <  '2026-05-14 00:00:00';

-- COMMIT;
-- -- If the count looks wrong: ROLLBACK; (instead of COMMIT;) — nothing changes.

-- ----------------------------------------------------------------------------
-- Note: this script does NOT touch the inventory rows that those counts
-- may have updated. If the test counts moved inventory (which they
-- shouldn't have — stream counts mostly record "what was sold" rather
-- than mutating inventory), the inventory side would need a separate
-- audit. Ask before running anything that mutates inventory.
-- ----------------------------------------------------------------------------
