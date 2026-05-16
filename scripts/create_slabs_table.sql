-- ============================================================================
-- Slabs table — separate from singles per user directive
-- ============================================================================
-- Slabs = graded TCG cards (PSA / CGC / BGS / SGC). They differ from singles
-- in three structural ways that justify a separate table:
--   1. Identifier is cert# only (no TCG ID); 1 physical card = 1 cert
--   2. Lifecycle has an explicit "listed" state for sale-tracking and a
--      Days-on-Shelf concept the user's Google sheet already encodes
--   3. Identity is a single free-text "item name" string (column C of the
--      AZ CAC INV sheet — e.g. "CGC Pristine 10 Charizard #4/102 Holo"),
--      not split into card_name + card_number + set_id like singles
--
-- v1 scope: only the 3 critical columns (cert#, grading_company, item_name)
-- are required. Status, dates, cost, sale fields, and price-tracking
-- columns are all nullable so the schema is forward-compat without
-- requiring future migrations.
--
-- Safety: BEGIN/COMMIT wrapped. CREATE TABLE IF NOT EXISTS = idempotent.
-- Does not touch singles, card_sets, or any other table.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS slabs (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The 3 critical columns from the sheet (A / B / C) -----------------
  cert_number           text          NOT NULL,
  grading_company       text          NOT NULL,    -- CGC / PSA / BGS / SGC / Other
  item_name             text          NOT NULL,    -- free-text descriptor

  -- Status lifecycle ---------------------------------------------------
  -- in_inventory: physically in our possession, not listed
  -- listed:       up for sale on a platform (use listed_at for "days on shelf")
  -- sold:         sale recorded (sold_at + sale_* fields populated)
  -- sent_out:     shipped to grading / consignment / etc.
  -- lost:         can't find it / damaged beyond use
  status                text          NOT NULL DEFAULT 'in_inventory'
                                       CHECK (status IN ('in_inventory','listed','sold','sent_out','lost')),

  -- Acquisition --------------------------------------------------------
  date_acquired         date          NOT NULL DEFAULT CURRENT_DATE,
  acquirer_id           uuid          REFERENCES users(id) ON DELETE SET NULL,
  acquisition_cost_usd  numeric(12,2),

  -- Listing -------------------------------------------------------------
  listed_at             timestamptz,                -- set when status flips to 'listed'
  list_price_usd        numeric(12,2),

  -- Internal pricing reference (from sheet's H/I/F/G columns) ----------
  -- We store but don't enforce these. The Inventory page can show them
  -- when populated; the sell modal can prefill from here.
  lv_price_usd          numeric(12,2),              -- "LV" — internal target
  market_price_usd      numeric(12,2),              -- "MP" — market reference
  last_sold_usd         numeric(12,2),              -- "LS" — last comparable sale

  -- Sale ---------------------------------------------------------------
  sold_at               timestamptz,
  sale_price_usd        numeric(12,2),
  sale_fees_usd         numeric(12,2),
  sale_channel          text          CHECK (
                          sale_channel IS NULL
                          OR sale_channel IN ('ebay','whatnot','comc','tcgplayer','in_person','trade_out','other')
                        ),
  sale_date             date,
  buyer_name            text,
  sold_by_id            uuid          REFERENCES users(id) ON DELETE SET NULL,

  notes                 text,

  -- Soft-delete (LV convention) ----------------------------------------
  deleted               boolean       NOT NULL DEFAULT false,
  deleted_at            timestamptz,
  deleted_by_id         uuid          REFERENCES users(id) ON DELETE SET NULL,
  deleted_reason        text,

  -- Audit --------------------------------------------------------------
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Cert# is the barcode the scanner reads. UNIQUE among non-deleted slabs so
-- duplicate intake gets caught at the DB layer. Partial so soft-deleted
-- rows can be replaced if needed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_slabs_cert_unique
  ON slabs (cert_number)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_slabs_status
  ON slabs (status, deleted);

CREATE INDEX IF NOT EXISTS idx_slabs_grading_company
  ON slabs (grading_company);

CREATE INDEX IF NOT EXISTS idx_slabs_created
  ON slabs (created_at DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_slabs_listed_at
  ON slabs (listed_at DESC)
  WHERE status = 'listed' AND deleted = false;

CREATE INDEX IF NOT EXISTS idx_slabs_sold_date
  ON slabs (sale_date DESC)
  WHERE status = 'sold' AND deleted = false;

-- ---------------------------------------------------------------------------
-- RLS + updated_at trigger (matches LV convention)
-- ---------------------------------------------------------------------------
ALTER TABLE slabs DISABLE ROW LEVEL SECURITY;

-- Reuses the shared touch_updated_at() function created by
-- create_card_sets_table.sql (or create_audit_tables.sql).
DROP TRIGGER IF EXISTS trg_slabs_touch ON slabs;
CREATE TRIGGER trg_slabs_touch
  BEFORE UPDATE ON slabs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;

-- ============================================================================
-- Verify (run separately):
--   SELECT count(*) FROM slabs;
--   -- expect 0 first time
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'slabs'
--   ORDER BY ordinal_position;
-- ============================================================================
