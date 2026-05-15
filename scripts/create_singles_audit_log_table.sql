-- ============================================================================
-- Singles feature — audit log table
-- ============================================================================
-- Captures every meaningful state change on a single: created, sold,
-- soft-deleted, restored (future), and generic field updates. Each row
-- carries:
--   - WHICH single (single_id FK)
--   - WHAT happened (event_type, summary)
--   - WHO did it (acted_by_id FK to users)
--   - WHEN (acted_at, default now)
--   - DETAILS (payload jsonb, free-form)
--
-- Why app-level logging instead of Postgres triggers:
--   Lucky Vault uses anon-key auth (no Supabase Auth → no current_user
--   inside the DB), so triggers can't easily know "who did this".
--   Each helper in src/lib/supabase.js explicitly calls logSingleEvent()
--   with the acted_by_id derived from the operation (acquirer_id for
--   created, sold_by_id for sold, deleted_by_id for deleted).
--
-- Safety:
--   * NEW table only; touches nothing existing.
--   * Wrapped in BEGIN/COMMIT; CREATE TABLE IF NOT EXISTS = idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS singles_audit_log (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  single_id    uuid          NOT NULL REFERENCES singles(id) ON DELETE CASCADE,
  event_type   text          NOT NULL
                              CHECK (event_type IN ('created','sold','deleted','restored','updated')),
  summary      text          NOT NULL,
  payload      jsonb,
  acted_by_id  uuid          REFERENCES users(id) ON DELETE SET NULL,
  acted_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_singles_audit_log_single_id
  ON singles_audit_log (single_id);

CREATE INDEX IF NOT EXISTS idx_singles_audit_log_acted_at
  ON singles_audit_log (acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_singles_audit_log_event_type
  ON singles_audit_log (event_type, acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_singles_audit_log_acted_by
  ON singles_audit_log (acted_by_id, acted_at DESC)
  WHERE acted_by_id IS NOT NULL;

ALTER TABLE singles_audit_log DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- Verify:
--   SELECT count(*) FROM singles_audit_log;            -- expect 0
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'singles_audit_log' ORDER BY ordinal_position;
-- ============================================================================
