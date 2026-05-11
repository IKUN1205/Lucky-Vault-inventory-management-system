-- ============================================================================
-- Audit / Reconciliation feature — schema migration
-- ============================================================================
-- Purpose: enable comparing platform-reported sales (e.g. Packheads CSV
--          export) against the inventory outflow recorded in our system,
--          to detect shrinkage / theft / recording errors.
--
-- Two tables:
--   1. platform_product_mappings — maps a platform's product name string
--      to one of our products.id values. Built once per product, reused
--      forever after.
--   2. platform_sales_records — stores every imported sale line so reports
--      are reproducible and historical comparisons stay possible after the
--      original CSV is gone.
--
-- Run this once in the Supabase SQL editor (or via psql).
-- It is idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table 1: platform_product_mappings
-- ---------------------------------------------------------------------------
-- Each row teaches the system: "when this platform writes THIS string, it
-- means OUR product with id X". Composite uniqueness is (platform,
-- external_name) — the same external name can map differently across
-- platforms (Packheads's "OP-15" might differ from eBay's "OP-15").
--
-- product_id is nullable so the user can mark "ignore / not in our system"
-- mappings (e.g. Auction line items, products we don't carry).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_product_mappings (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        text          NOT NULL,            -- e.g. 'packheads'
  external_name   text          NOT NULL,            -- raw product name from CSV
  product_id      uuid          REFERENCES products(id) ON DELETE SET NULL,
  ignore          boolean       NOT NULL DEFAULT false,  -- true = skip in audits
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (platform, external_name)
);

CREATE INDEX IF NOT EXISTS idx_ppm_platform_name
  ON platform_product_mappings (platform, external_name);

-- ---------------------------------------------------------------------------
-- Table 2: platform_sales_records
-- ---------------------------------------------------------------------------
-- Every line item from every imported CSV. We snapshot the resolved
-- product_id at import time (not via JOIN at read time) so historical
-- reports stay stable even if mappings change later.
--
-- Money fields use numeric(12,2) — same precision used elsewhere in the
-- codebase. quantity may be 0 for refund-only rows; quantity_returned
-- captures returns separately (we ignore it for now but it's stored for
-- when we add return-aware audits later).
--
-- source_upload_id groups all rows from a single CSV upload, useful for
-- "undo this import" / "show me what was in the 5/1-5/7 upload".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_sales_records (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text          NOT NULL,        -- e.g. 'packheads'
  sale_date           date          NOT NULL,
  streamer            text,                          -- nullable for non-stream platforms
  external_name       text          NOT NULL,        -- raw product name as imported
  product_id          uuid          REFERENCES products(id) ON DELETE SET NULL,
  quantity            integer       NOT NULL DEFAULT 0,
  quantity_returned   integer       NOT NULL DEFAULT 0,
  net_sales           numeric(12,2) NOT NULL DEFAULT 0,    -- gross sales $
  cost                numeric(12,2) NOT NULL DEFAULT 0,    -- cost of goods sold $
  source_upload_id    uuid          NOT NULL,        -- groups rows from one CSV upload
  source_filename     text,
  imported_at         timestamptz   NOT NULL DEFAULT now()
);

-- Useful indexes for the audit query patterns:
CREATE INDEX IF NOT EXISTS idx_psr_platform_date
  ON platform_sales_records (platform, sale_date);

CREATE INDEX IF NOT EXISTS idx_psr_product_date
  ON platform_sales_records (product_id, sale_date);

CREATE INDEX IF NOT EXISTS idx_psr_upload
  ON platform_sales_records (source_upload_id);

-- ---------------------------------------------------------------------------
-- Trigger: keep platform_product_mappings.updated_at fresh on UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppm_touch ON platform_product_mappings;
CREATE TRIGGER trg_ppm_touch
  BEFORE UPDATE ON platform_product_mappings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Done. Verify with:
--   SELECT 'platform_product_mappings' AS t, count(*) FROM platform_product_mappings
--   UNION ALL
--   SELECT 'platform_sales_records', count(*) FROM platform_sales_records;
-- Both should return 0 rows the first time.
-- ---------------------------------------------------------------------------
