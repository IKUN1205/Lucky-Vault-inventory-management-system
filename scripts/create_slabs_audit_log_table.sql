-- ============================================================================
-- Slabs feature — audit log table (parallel to singles_audit_log)
-- ============================================================================
-- Same shape and conventions as singles_audit_log — every meaningful state
-- change on a slab (created, listed, sold, deleted, restored, updated) gets
-- a row here with human-readable summary + raw payload jsonb.
--
-- The shared Activity Log UI will UNION this table with singles_audit_log
-- and let the user filter by entity type.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS slabs_audit_log (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slab_id      uuid          NOT NULL REFERENCES slabs(id) ON DELETE CASCADE,
  event_type   text          NOT NULL
                              CHECK (event_type IN ('created','listed','sold','deleted','restored','updated')),
  summary      text          NOT NULL,
  payload      jsonb,
  acted_by_id  uuid          REFERENCES users(id) ON DELETE SET NULL,
  acted_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slabs_audit_log_slab_id
  ON slabs_audit_log (slab_id);

CREATE INDEX IF NOT EXISTS idx_slabs_audit_log_acted_at
  ON slabs_audit_log (acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_slabs_audit_log_event_type
  ON slabs_audit_log (event_type, acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_slabs_audit_log_acted_by
  ON slabs_audit_log (acted_by_id, acted_at DESC)
  WHERE acted_by_id IS NOT NULL;

ALTER TABLE slabs_audit_log DISABLE ROW LEVEL SECURITY;

COMMIT;
