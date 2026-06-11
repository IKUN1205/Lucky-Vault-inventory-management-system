-- audit_runs — history for the hourly auto-audit cron (api/audit-cron.js).
-- Each run (hourly at :45, per kind) stores its issue counts plus the
-- fingerprints ("code:id") of actionable issues. The next run diffs against
-- the previous row so Lark only pings on NEW issues instead of repeating
-- the same list every hour. The Cards Audit page also reads the latest row
-- per kind for its "last auto-audit" banner.
--
-- Run this in the Supabase SQL Editor (same place as the other scripts/*.sql).
-- The cron works without it — it just can't dedup alerts until this exists.

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
