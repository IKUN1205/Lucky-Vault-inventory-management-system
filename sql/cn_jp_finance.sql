-- ============================================================================
-- CN/JP finance — schema additions (NON-DESTRUCTIVE, additive only)
-- ============================================================================
-- Backs three flag-gated app features (VITE_ENABLE_CN_JP_FINANCE):
--
--   1. China Acquisitions (中国进货) — a mirror of the Japan offline-purchase
--      flow. Needs a 'China Warehouse' location, a 'China' value in the enum
--      that backs vendors.country / acquisitions.source_country, and 'cn_vendor'
--      (+ reserved 'cn_to_us_shipment') on the acquisitions.origin CHECK.
--
--   2. Slab cert quick-intake — adds price_check (a "needs pricing" to-do flag)
--      plus the local-currency amount captured at buy time, to the slabs table.
--
--   3. fx_transfers — shared CNY/USD cross-border ledger. lv-finance
--      auto-inserts the USD leg from US bank feeds; the app backfills the RMB
--      leg. china_recon.py queries these exact columns.
--
-- ⚠️ DO NOT auto-run. Review, then apply once in the Supabase SQL editor.
-- The ALTER TYPE ... ADD VALUE must be committed on its own (Postgres forbids
-- using a brand-new enum value in the same transaction that adds it), so it
-- sits OUTSIDE the BEGIN/COMMIT block below. Everything inside is idempotent
-- (IF NOT EXISTS / guarded) and wrapped so a partial failure rolls back.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Enum additions — MUST each run first, on their own (Postgres forbids using
--    a brand-new enum value in the same transaction that adds it).
-- ---------------------------------------------------------------------------
-- 0a. 'China' on the enum backing vendors.country / acquisitions.source_country.
--     JapanAcquisitions notes this enum is `region`, with 'Japan' already a
--     member ('JP'/'JPN' throw 22P02). If your enum type is not named `region`,
--     change it here. If acquisitions.source_country is backed by a DIFFERENT
--     enum type than vendors.country, repeat this ADD VALUE for that type too.
ALTER TYPE region ADD VALUE IF NOT EXISTS 'China';

-- 0b. 'RMB' on `currency_code`, the enum backing acquisitions.currency (verified
--     live to contain only JPY/USD — an RMB-valued insert throws 400 22P02
--     without this). createChinaAcquisition writes currency='RMB', so this is
--     required for the China page to work day-1.
ALTER TYPE currency_code ADD VALUE IF NOT EXISTS 'RMB';  -- backs acquisitions.currency


BEGIN;

-- ---------------------------------------------------------------------------
-- 1. China Warehouse location
-- ---------------------------------------------------------------------------
INSERT INTO locations (name, type, active)
VALUES ('China Warehouse', 'Physical', true)
ON CONFLICT (name) DO UPDATE SET active = true;

-- ---------------------------------------------------------------------------
-- 2. acquisitions.origin — widen the CHECK to allow China origins
-- ---------------------------------------------------------------------------
-- The origin column + its CHECK were created by add_japan_inventory_system.sql
-- with an auto-generated constraint name. Drop whichever CHECK references
-- `origin`, then re-add a named one that includes the China values. Idempotent:
-- re-running finds the named constraint and rebuilds it.
DO $$
DECLARE con text;
BEGIN
  SELECT conname INTO con
  FROM pg_constraint
  WHERE conrelid = 'acquisitions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%origin%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE acquisitions DROP CONSTRAINT %I', con);
  END IF;
END $$;

ALTER TABLE acquisitions
  ADD CONSTRAINT acquisitions_origin_check
  CHECK (
    origin IN ('us_vendor', 'jp_vendor', 'jp_to_us_shipment', 'cn_vendor', 'cn_to_us_shipment')
    OR origin IS NULL
  );

-- ---------------------------------------------------------------------------
-- 3. slabs — finance quick-intake columns
-- ---------------------------------------------------------------------------
-- price_check = 'pending' means "bought fast, still needs market price / proper
-- naming". Existing rows + the normal Scan intake default to 'done' so they are
-- NOT swept into the pending queue; only the finance quick-intake writes
-- 'pending'.
-- CHECK also allows the pricing-cron verdicts: slab-inventory/price_check_cron.py
-- runs every 2h and PATCHes 'ok'/'warn'/'over'/'nodata', so those must pass the
-- constraint alongside the intake states 'pending'/'done'.
ALTER TABLE slabs
  ADD COLUMN IF NOT EXISTS price_check text NOT NULL DEFAULT 'done'
    CHECK (price_check IN ('pending', 'done', 'ok', 'warn', 'over', 'nodata'));

-- Local-currency amount actually paid, kept next to the USD snapshot in
-- acquisition_cost_usd (which stays the reporting figure).
ALTER TABLE slabs
  ADD COLUMN IF NOT EXISTS acquisition_cost_local numeric(12,2);

ALTER TABLE slabs
  ADD COLUMN IF NOT EXISTS acquisition_currency text
    CHECK (acquisition_currency IN ('USD', 'JPY', 'RMB') OR acquisition_currency IS NULL);

CREATE INDEX IF NOT EXISTS idx_slabs_price_check
  ON slabs (price_check)
  WHERE price_check = 'pending';

-- ---------------------------------------------------------------------------
-- 4. fx_transfers — CNY/USD cross-border ledger (shared with lv-finance)
-- ---------------------------------------------------------------------------
-- Decided architecture: lv-finance AUTO-INSERTS the USD leg from US bank feeds;
-- the China team BACKFILLS the RMB leg via the app form. china_recon.py queries
-- these exact columns, so the schema is fixed. Rate = CNY per USD =
-- cny_amount / usd_amount. A row needs at least one of the two amounts (the
-- CHECK), so both auto-insert (usd only) and manual entry work. bank_txn_ref is
-- the US bank txn fingerprint used as a dupe guard (UNIQUE; NULL for app rows,
-- and Postgres allows many NULLs under a UNIQUE constraint).
CREATE TABLE IF NOT EXISTS fx_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  usd_amount numeric(14,2),          -- US bank outflow (auto-inserted by lv-finance)
  cny_amount numeric(14,2),          -- RMB received in China (backfilled via app form)
  rate numeric(12,6),                -- CNY per USD = cny_amount / usd_amount
  counterparty text,                 -- XIYIMEI / SHAODAN / ...
  bank_txn_ref text UNIQUE,          -- US bank txn fingerprint (dupe guard)
  purpose text,
  note text,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (usd_amount IS NOT NULL OR cny_amount IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_fx_transfers_date ON fx_transfers (date DESC) WHERE deleted = false;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (each should return rows / columns after applying):
-- ---------------------------------------------------------------------------
--   SELECT id, name FROM locations WHERE name = 'China Warehouse';
--   SELECT unnest(enum_range(NULL::region))::text;                 -- includes 'China'
--   SELECT unnest(enum_range(NULL::currency_code))::text;          -- includes 'RMB'
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'acquisitions_origin_check';                 -- includes cn_vendor
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'slabs'
--       AND column_name IN ('price_check','acquisition_cost_local','acquisition_currency');
--   SELECT count(*) FROM fx_transfers;
