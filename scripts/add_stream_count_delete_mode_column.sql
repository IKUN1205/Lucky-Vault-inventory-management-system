-- ============================================================================
-- delete_mode column on stream_counts — distinguishes two soft-delete flavors
-- ============================================================================
-- Context: admin-initiated soft delete now has two modes:
--
--   1. 'retract' — operator made an input error and missed the in-app
--      Undo window. The system should behave as if the count never
--      happened: reverse the inventory deltas AND hide the row everywhere.
--      Only valid when NO subsequent count exists at the same location
--      (otherwise reversing the delta would double-correct, since the
--      subsequent count already adjusted inventory based on the now-wrong
--      starting state). Server enforces this gate.
--
--   2. 'hide'    — test data / cleanup. Inventory is already correct
--      (typically because a subsequent count fixed any drift). We only
--      want the row out of reports + audit history. Always allowed.
--
-- Both modes still go through soft-delete in the DB layer (deleted=true +
-- deleted_at + deleted_by + reason) so we keep a full audit trail and
-- can recover from misclicks. delete_mode tells us which kind it was.
--
-- Run once in Supabase SQL Editor. Idempotent.
-- ============================================================================

ALTER TABLE stream_counts
  ADD COLUMN IF NOT EXISTS delete_mode TEXT
    CHECK (delete_mode IN ('retract', 'hide') OR delete_mode IS NULL);

-- Verify:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'stream_counts' AND column_name = 'delete_mode';
