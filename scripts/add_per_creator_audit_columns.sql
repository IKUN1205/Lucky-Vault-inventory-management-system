-- ============================================================================
-- L1: per-creator audit aggregation
-- ============================================================================
-- Problem: a stream count submitted AFTER >1 LIVE session has happened in
-- the same room (e.g. Bob skipped counting before his stream, so Charlie's
-- count covers both Aldo's and Bob's sessions) was producing audits that
-- "passed" even though attribution to a specific streamer was meaningless.
-- The TikTok order data carries live_creator per order line, so we know
-- WHO sold what — we just weren't surfacing it.
--
-- This migration adds two columns to stream_reconciliations so the recon
-- function can record the breakdown alongside the existing totals:
--   merged_session_count    — how many distinct live_creators showed up
--   per_creator_breakdown   — array { creator, total_qty, line_count,
--                                     earliest_unix, latest_unix }
--
-- Both columns are additive and nullable / defaulted, so existing code
-- (Audit History page, etc.) keeps working untouched. Old rows have
-- merged_session_count = 1 by default which matches their reality
-- (we just didn't track this before).
--
-- Run this once in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================================

ALTER TABLE stream_reconciliations
  ADD COLUMN IF NOT EXISTS merged_session_count INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS per_creator_breakdown JSONB;

COMMENT ON COLUMN stream_reconciliations.merged_session_count IS
  'Distinct live_creator values seen in this reconcile window. >1 means
   this count covered multiple stream sessions and per-session attribution
   is ambiguous — the audit ran but cannot reliably blame a single streamer.';

COMMENT ON COLUMN stream_reconciliations.per_creator_breakdown IS
  'Array of { creator, total_qty, line_count, earliest_unix, latest_unix }
   so reports can show "Aldo: 100, Bob: 60" instead of just the combined total.
   Ordered by earliest_unix ASC.';

-- Verify
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'stream_reconciliations'
  AND column_name IN ('merged_session_count', 'per_creator_breakdown');
