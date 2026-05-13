-- ============================================================================
-- Cleanup: TikTok RocketsHQ reconciliation row
-- ============================================================================
-- RocketsHQ was auto-reconciled by mistake before we tightened the gate to
-- only Packheads. The row in stream_reconciliations has TIKTOK=0/COUNT=23
-- because we tried to fetch RocketsHQ orders with the Packheads cookie —
-- not useful. Delete just that one reconciliation row so Audit History
-- only shows real Packheads runs.
--
-- Does NOT delete the underlying stream_count for RocketsHQ — that's real
-- count data the streamer entered. Only the recon row is being removed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Preview — should return exactly the RocketsHQ row(s)
-- ----------------------------------------------------------------------------

SELECT
  r.id,
  r.stream_count_id,
  l.name AS location_name,
  r.status,
  r.total_diff,
  r.flagged_count,
  sc.count_time
FROM stream_reconciliations r
JOIN stream_counts sc ON sc.id = r.stream_count_id
LEFT JOIN locations l ON l.id = sc.location_id
WHERE l.name ILIKE '%TikTok%'
  AND l.name NOT ILIKE '%Packheads%';

-- ----------------------------------------------------------------------------
-- STEP 2: Delete (uncomment BEGIN/COMMIT after STEP 1 looks right)
-- ----------------------------------------------------------------------------

-- BEGIN;

  DELETE FROM stream_reconciliations r
  USING stream_counts sc, locations l
  WHERE r.stream_count_id = sc.id
    AND sc.location_id = l.id
    AND l.name ILIKE '%TikTok%'
    AND l.name NOT ILIKE '%Packheads%';

  -- Verify: should return 0
  SELECT count(*) AS remaining_non_packheads_recons
  FROM stream_reconciliations r
  JOIN stream_counts sc ON sc.id = r.stream_count_id
  LEFT JOIN locations l ON l.id = sc.location_id
  WHERE l.name ILIKE '%TikTok%'
    AND l.name NOT ILIKE '%Packheads%';

-- COMMIT;
-- -- If the count is not 0: ROLLBACK; instead of COMMIT.
