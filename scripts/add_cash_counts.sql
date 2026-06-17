-- cash_counts — twice-daily physical cash-drawer audit (boss directive
-- 2026-06-16). Staff count the drawer each morning & evening; the system
-- compares against the expected balance (previous count − cash removed +
-- cash net of transactions since) and Larks the Storefront group whether
-- it matches. Self-anchoring: every count re-baselines reality, so a
-- one-off discrepancy doesn't poison future expectations.
--
-- Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS cash_counts (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pt_date DATE NOT NULL,                 -- PT calendar date of the count
  period TEXT NOT NULL,                  -- 'morning' | 'evening' | 'custom'
  counted_amount NUMERIC NOT NULL,       -- physical cash counted
  expected_amount NUMERIC,               -- system expectation at count time
  difference NUMERIC,                    -- counted - expected (over/short)
  cash_net_since NUMERIC,                -- cash flow since the prior count
  cash_removed_usd NUMERIC NOT NULL DEFAULT 0,  -- handed to owner / deposited at this count
  counted_by_id UUID,                    -- users.id (nullable)
  counted_by_name TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS cash_counts_created ON cash_counts (created_at DESC);
CREATE INDEX IF NOT EXISTS cash_counts_date ON cash_counts (pt_date DESC);
