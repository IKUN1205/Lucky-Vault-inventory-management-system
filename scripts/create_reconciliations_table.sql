-- ============================================================================
-- Stream Reconciliations table
-- ============================================================================
-- Persists every per-stream reconciliation run (whether auto-triggered after
-- a stream count submit, or kicked off manually from the Reconcile page).
-- Lets the new /audit-history page show "every count + the audit result"
-- without recomputing anything.
--
-- One row per stream_count.id at most. If the same count gets reconciled
-- again (re-run after fixing mappings, e.g.), we UPSERT — keeping the
-- most recent result.
--
-- Run this once in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stream_reconciliations (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_count_id          uuid          NOT NULL REFERENCES stream_counts(id) ON DELETE CASCADE,

  -- Provenance
  triggered_by             text          NOT NULL,  -- 'auto_after_count' | 'manual_reconcile'
  triggered_by_user_id     uuid          REFERENCES users(id) ON DELETE SET NULL,
  source                   text          NOT NULL,  -- 'tiktok_api' | 'csv_upload'

  -- Time window we reconciled over
  window_from              timestamptz   NOT NULL,
  window_to                timestamptz   NOT NULL,

  -- Top-line numbers (denormalised so the history page doesn't have to
  -- re-aggregate JSON for each list-view row)
  total_platform_units     integer       NOT NULL DEFAULT 0,
  total_system_units       integer       NOT NULL DEFAULT 0,
  total_diff               integer       NOT NULL DEFAULT 0,
  flagged_count            integer       NOT NULL DEFAULT 0,
  unmapped_count           integer       NOT NULL DEFAULT 0,
  threshold                integer       NOT NULL DEFAULT 5,

  -- Detailed per-product comparison rows. Each element looks like:
  --   { product_id, product_name, language, platform_qty,
  --     system_qty, diff, flagged }
  -- We keep the snapshot rather than recomputing so historical reports
  -- stay stable even if mappings / inventory change later.
  rows                     jsonb         NOT NULL DEFAULT '[]'::jsonb,

  -- TikTok product names that didn't map to a system product. The user
  -- should clean these up in Sales Audit so they don't drop out of
  -- future reconciliations.
  unmapped                 jsonb         NOT NULL DEFAULT '[]'::jsonb,

  -- Lark notification status (for the audit-history page to show
  -- whether the room group got pinged)
  lark_sent_at             timestamptz,
  lark_target              text,   -- 'room' | 'main' | null

  -- Run status. Auto-trigger can fail (cookie expired, TikTok timeout,
  -- etc.) — we record what happened so the history view can flag it.
  status                   text          NOT NULL DEFAULT 'success',  -- 'success' | 'failed' | 'no_data'
  error_message            text,
  duration_ms              integer,

  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),

  -- Only one reconciliation per stream count. Subsequent runs UPSERT.
  UNIQUE (stream_count_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_reconciliations_count_id
  ON stream_reconciliations (stream_count_id);

CREATE INDEX IF NOT EXISTS idx_stream_reconciliations_created_at
  ON stream_reconciliations (created_at DESC);

-- Touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION touch_reconciliation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recon_touch ON stream_reconciliations;
CREATE TRIGGER trg_recon_touch
  BEFORE UPDATE ON stream_reconciliations
  FOR EACH ROW EXECUTE FUNCTION touch_reconciliation_updated_at();

-- Verify with:
--   SELECT count(*) FROM stream_reconciliations;
-- Should return 0 the first time.
