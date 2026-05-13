-- ============================================================================
-- L2: missing_count_alerts dedup table
-- ============================================================================
-- The cron at /api/detect-missing-counts runs every 2h. Each run might
-- detect the same "session ended without a count" condition multiple times
-- (because nothing about the session has changed yet). Without dedup, the
-- Lark group would get spammed every 2h until someone finally counts.
--
-- Pattern: before sending Lark, INSERT a row keyed on
--   (room_location_id, creator, session_end_unix)
-- with ON CONFLICT DO NOTHING. Only send Lark when the insert returns a
-- new row (i.e. RETURNING id finds one). The UNIQUE constraint guarantees
-- at-most-once delivery per detected session.
--
-- Once someone counts, future cron runs will no longer detect the session
-- as "missing" (the stream_counts JOIN matches), so the table just accrues
-- historical alert records — kept for audit, never deleted automatically.
--
-- Run this once in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS missing_count_alerts (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  room_location_id     uuid          NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  creator              text          NOT NULL,
  session_end_unix     bigint        NOT NULL,

  -- Denormalised so a quick SELECT * gives the story without joining
  -- back to TikTok data we no longer have in memory.
  session_start_unix   bigint,
  total_qty            int           NOT NULL DEFAULT 0,
  line_count           int           NOT NULL DEFAULT 0,

  -- Lark delivery result for debugging — both targets are recorded
  -- because the cron sends to main + room webhooks.
  lark_main_ok         boolean,
  lark_room_ok         boolean,
  lark_error           text,

  alerted_at           timestamptz   NOT NULL DEFAULT now(),

  -- One alert per (room, creator, session-end) — the INSERT in the cron
  -- relies on ON CONFLICT DO NOTHING against this constraint to dedupe.
  UNIQUE (room_location_id, creator, session_end_unix)
);

CREATE INDEX IF NOT EXISTS idx_mca_alerted_at
  ON missing_count_alerts (alerted_at DESC);

-- RLS off — the cron writes via the service-role key, and no end-user
-- path reads from this table yet.
ALTER TABLE missing_count_alerts DISABLE ROW LEVEL SECURITY;

-- Verify
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'missing_count_alerts'
ORDER BY ordinal_position;
