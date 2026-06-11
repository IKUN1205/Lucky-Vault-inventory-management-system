-- ============================================================
-- ALL pending migrations in one paste (safe to re-run — every
-- statement is IF NOT EXISTS). Run this once in the Supabase SQL
-- Editor and the three pending features fully activate:
--   1. sheet_note  — slab Note column visible in the app
--   2. audit_runs  — hourly auto-audit dedup (alert only on NEW issues)
--   3. sheet_bin   — slab shelf bin (raw sheet Location cell) in the app
-- ============================================================

-- 1. scripts/add_slabs_sheet_note.sql
ALTER TABLE slabs ADD COLUMN IF NOT EXISTS sheet_note TEXT;

-- 2. scripts/add_audit_runs.sql
CREATE TABLE IF NOT EXISTS audit_runs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,                            -- 'single' | 'slab'
  total_db_ids INT,
  total_sheet_ids INT,
  total_issues INT NOT NULL DEFAULT 0,           -- everything, incl. info-level
  by_code JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { issue_code: count }
  actionable JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["code:id", ...] fingerprints
  new_count INT NOT NULL DEFAULT 0,              -- actionable not in previous run
  resolved_count INT NOT NULL DEFAULT 0          -- previous actionable now gone
);
CREATE INDEX IF NOT EXISTS audit_runs_kind_created
  ON audit_runs (kind, created_at DESC);

-- 3. scripts/add_slabs_sheet_bin.sql
ALTER TABLE slabs ADD COLUMN IF NOT EXISTS sheet_bin TEXT;
