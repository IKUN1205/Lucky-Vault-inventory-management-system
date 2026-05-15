-- ============================================================================
-- Singles feature — singles table (NEW, append-only migration)
-- ============================================================================
-- Purpose: per-card row for tracking individual cards (graded slabs as
--          quantity=1 rows with cert#; raw cards stackable via `quantity`).
--          This is the v1 foundation — sales / box-break-pull tracing /
--          Lark notifications come in later phases.
--
-- Safety guarantees:
--   * This migration ONLY creates the new `singles` table + indexes. It does
--     NOT alter, drop, rename, or read any existing table.
--   * Foreign keys reference existing tables (card_sets, locations, users,
--     vendors, box_breaks, acquisitions). If any FK target column type
--     doesn't match (e.g. acquisitions.id is not uuid), Postgres will reject
--     the whole CREATE TABLE — nothing partial gets created.
--   * The whole thing is wrapped in BEGIN / COMMIT. Any failure rolls back.
--   * Idempotent: re-running this is a no-op (CREATE TABLE IF NOT EXISTS).
--
-- Pre-req: create_card_sets_table.sql must have been run first.
--
-- Run in the Supabase SQL editor (or psql). Verify at the bottom.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Table: singles
-- ----------------------------------------------------------------------------
-- One row per physical card for graded (form='graded', quantity=1, cert# unique).
-- One row per (set, card#, condition, variant) stack for raw (form='raw',
-- quantity >= 1).
--
-- Cost basis is per-row, NOT averaged — single cards span $1 to $50k+, the
-- weighted-average approach used by the `inventory` table for sealed product
-- would destroy precision.
--
-- Provenance / source linkage (source_box_break_id, source_acquisition_id,
-- parent_single_id) is kept in the schema as nullable so v1 forms can leave
-- them blank; v2 features (box-break cost-basis tracing, raw→graded transition)
-- will fill them in without a schema change.
--
-- High_value_items is left untouched. Any future migration of HV rows into
-- this table will be handled by a separate, explicitly-named script.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS singles (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity ----------------------------------------------------------------
  card_name                   text          NOT NULL,
  card_number                 text          NOT NULL,         -- "4/102", "001", "P-001" (promos)
  set_id                      uuid          NOT NULL REFERENCES card_sets(id) ON DELETE RESTRICT,
  brand                       text          NOT NULL,         -- denormalized for fast filtering
  language                    text          NOT NULL,         -- denormalized
  variant                     text,                            -- 'holo', 'reverse holo', '1st edition', 'shadowless', 'promo stamp'

  -- Form ---------------------------------------------------------------------
  form                        text          NOT NULL CHECK (form IN ('raw','graded')),

  -- Raw-only -----------------------------------------------------------------
  condition                   text          CHECK (condition IS NULL OR condition IN ('NM','LP','MP','HP','DM')),
  quantity                    integer       NOT NULL DEFAULT 1 CHECK (quantity >= 0),

  -- Graded-only --------------------------------------------------------------
  grading_company             text,                            -- 'PSA','BGS','CGC','SGC'
  grade                       text,                            -- '10', '9.5', 'Pristine 10', 'Black Label 10'
  subgrades                   jsonb,                           -- {centering, corners, edges, surface} for BGS
  cert_number                 text,                            -- grading_company cert#, unique per physical card

  -- Cost ---------------------------------------------------------------------
  acquisition_cost_usd        numeric(12,2),                   -- per card (raw: per unit; graded: total)
  acquisition_cost_native     numeric(12,2),
  acquisition_currency        text          DEFAULT 'USD',

  -- Market value (manual entry in v1; market_price_source reserved for v2 API) -
  current_market_price_usd    numeric(12,2),
  market_price_source         text          DEFAULT 'manual',  -- 'manual' / future: 'tcgplayer' / 'ebay_sold' / 'pricecharting'
  market_price_updated_at     timestamptz,

  -- Provenance (nullable in v1, filled by v2 features) -----------------------
  source_type                 text          CHECK (source_type IS NULL OR source_type IN ('box_break','purchase','trade_in','grading_return','other')),
  source_box_break_id         uuid          REFERENCES box_breaks(id) ON DELETE SET NULL,
  source_acquisition_id       uuid          REFERENCES acquisitions(id) ON DELETE SET NULL,
  parent_single_id            uuid          REFERENCES singles(id) ON DELETE SET NULL,  -- raw row that became this graded row

  -- Location & ownership -----------------------------------------------------
  location_id                 uuid          REFERENCES locations(id) ON DELETE SET NULL,
  acquirer_id                 uuid          REFERENCES users(id) ON DELETE SET NULL,
  vendor_id                   uuid          REFERENCES vendors(id) ON DELETE SET NULL,

  -- Lifecycle ----------------------------------------------------------------
  status                      text          NOT NULL DEFAULT 'in_inventory'
                              CHECK (status IN ('in_inventory','sent_to_grading','listed','sold','lost')),
  date_acquired               date          NOT NULL,
  photo_url                   text,                            -- nullable; v1 doesn't expose upload UI
  notes                       text,

  -- Soft-delete (LV convention) ---------------------------------------------
  deleted                     boolean       NOT NULL DEFAULT false,
  deleted_at                  timestamptz,
  deleted_by_id               uuid          REFERENCES users(id) ON DELETE SET NULL,
  deleted_reason              text,

  -- Audit --------------------------------------------------------------------
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now(),

  -- Cross-field invariants ---------------------------------------------------
  -- Graded cards must have at least company + grade; raw must have condition.
  -- These are loose (not strict NOT NULL) so partial data entry stays possible
  -- but bad combinations get rejected.
  CONSTRAINT singles_graded_has_grade
    CHECK (form <> 'graded' OR (grading_company IS NOT NULL AND grade IS NOT NULL)),
  CONSTRAINT singles_graded_quantity_one
    CHECK (form <> 'graded' OR quantity = 1),
  CONSTRAINT singles_raw_has_condition
    CHECK (form <> 'raw' OR condition IS NOT NULL)
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
-- cert# must be unique among non-deleted graded cards. Partial unique index
-- so soft-deleted rows with stale cert#s don't block new entries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_singles_cert_unique
  ON singles (cert_number)
  WHERE form = 'graded' AND deleted = false AND cert_number IS NOT NULL;

-- List / filter / search patterns:
CREATE INDEX IF NOT EXISTS idx_singles_status_active
  ON singles (status, deleted);

CREATE INDEX IF NOT EXISTS idx_singles_set_card
  ON singles (set_id, card_number);

CREATE INDEX IF NOT EXISTS idx_singles_brand_lang
  ON singles (brand, language);

CREATE INDEX IF NOT EXISTS idx_singles_location
  ON singles (location_id) WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_singles_form
  ON singles (form) WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_singles_box_break
  ON singles (source_box_break_id) WHERE source_box_break_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_singles_parent
  ON singles (parent_single_id) WHERE parent_single_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_singles_created
  ON singles (created_at DESC) WHERE deleted = false;

-- ----------------------------------------------------------------------------
-- RLS + updated_at trigger (matches LV convention)
-- ----------------------------------------------------------------------------
ALTER TABLE singles DISABLE ROW LEVEL SECURITY;

-- Reuse the shared touch_updated_at() function (created by
-- create_card_sets_table.sql or create_audit_tables.sql).
DROP TRIGGER IF EXISTS trg_singles_touch ON singles;
CREATE TRIGGER trg_singles_touch
  BEFORE UPDATE ON singles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;

-- ============================================================================
-- Verify (run separately, outside the transaction):
--
--   -- Should return 0 the first time:
--   SELECT count(*) AS singles_count FROM singles;
--
--   -- Constraint check (these SHOULD fail when uncommented and tried):
--   -- INSERT INTO singles (card_name, card_number, set_id, brand, language, form, date_acquired)
--   --   VALUES ('test', '1', (SELECT id FROM card_sets LIMIT 1), 'Pokemon', 'EN', 'graded', now())
--   -- ;  -- expected fail: singles_graded_has_grade
--
--   -- INSERT INTO singles (card_name, card_number, set_id, brand, language, form, condition, date_acquired)
--   --   VALUES ('test', '1', (SELECT id FROM card_sets LIMIT 1), 'Pokemon', 'EN', 'raw', NULL, now())
--   -- ;  -- expected fail: singles_raw_has_condition
-- ============================================================================
