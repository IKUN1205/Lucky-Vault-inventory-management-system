-- ============================================================================
-- Japan inventory system — schema additions (NON-DESTRUCTIVE, additive only)
-- ============================================================================
-- Adds the foundation for a lightweight Japan-side workflow that lives inside
-- the existing Lucky Vault DB:
--
--   1. New location 'Japan Warehouse' — where everything sourced in Japan sits
--      until it gets sold via stream or shipped to the US Master Inventory.
--
--   2. New vendor 'Japan Warehouse (Internal Transfer)' — synthetic vendor
--      used when an acquisition row represents a Japan→US shipment rather
--      than a real outside purchase. Reusing the acquisitions table for
--      cross-border transfers means US Intake to Master picks them up
--      automatically + AfterShip tracking just works.
--
--   3. acquisitions.origin (TEXT, nullable, CHECK-constrained) — explicit
--      flavor of each acquisition row:
--        * NULL              = legacy row (treat as us_vendor for back-compat)
--        * 'us_vendor'       = US offline purchase (current default workflow)
--        * 'jp_vendor'       = Japan offline purchase, instant-receive
--        * 'jp_to_us_shipment' = Japan→US cross-border shipment, awaits
--                                Intake to Master receive in the US
--
--   4. acquisitions.source_acquisition_id — optional weak linkage for
--      Japan→US shipments back to the original Japan purchase, so we can
--      trace which JP buy a shipped batch came from (cost-basis audit
--      down the road).
--
--   5. New table 'japan_stream_sales' — records direct livestream sales out
--      of Japan Warehouse. Simpler than the US stream_counts flow (no
--      multi-streamer reconciliation, no platform-tag auditing) because the
--      Japan team isn't doing TikTok reconcile right now.
--
-- All statements are idempotent — safe to re-run. Wrapped in BEGIN/COMMIT
-- so a partial failure rolls everything back.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Japan Warehouse location
-- ---------------------------------------------------------------------------
INSERT INTO locations (name, type, active)
VALUES ('Japan Warehouse', 'Physical', true)
ON CONFLICT (name) DO UPDATE SET active = true;

-- ---------------------------------------------------------------------------
-- 2. Internal-transfer vendor for Japan→US shipments
-- ---------------------------------------------------------------------------
-- This vendor never represents a real outside seller; it just flags
-- acquisition rows that originated from our own Japan inventory rather
-- than a third party. Display layer can show "Internal Transfer (Japan)"
-- instead of a vendor name when it sees this id.
--
-- vendors.name has no unique constraint (verified live), so we use a
-- guarded INSERT instead of ON CONFLICT — fully idempotent either way.
INSERT INTO vendors (name, country, active, notes)
SELECT
  'Japan Warehouse (Internal Transfer)',
  'Japan',
  true,
  'Synthetic vendor for Japan→US cross-border shipments. Do not use for real purchases.'
WHERE NOT EXISTS (
  SELECT 1 FROM vendors WHERE name = 'Japan Warehouse (Internal Transfer)'
);

-- ---------------------------------------------------------------------------
-- 3. acquisitions.origin
-- ---------------------------------------------------------------------------
ALTER TABLE acquisitions
  ADD COLUMN IF NOT EXISTS origin TEXT
    CHECK (origin IN ('us_vendor', 'jp_vendor', 'jp_to_us_shipment') OR origin IS NULL);

-- Index because the Intake to Master page now filters by it ("show me
-- pending Japan shipments separately") and the Japan pages all start
-- their queries with WHERE origin = 'jp_*'.
CREATE INDEX IF NOT EXISTS idx_acquisitions_origin
  ON acquisitions (origin)
  WHERE origin IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. acquisitions.source_acquisition_id (weak linkage)
-- ---------------------------------------------------------------------------
ALTER TABLE acquisitions
  ADD COLUMN IF NOT EXISTS source_acquisition_id UUID
    REFERENCES acquisitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_acquisitions_source
  ON acquisitions (source_acquisition_id)
  WHERE source_acquisition_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. japan_stream_sales — minimalist sale log
-- ---------------------------------------------------------------------------
-- One row per SKU per sale event. Aggregate-level event (e.g. "tonight's
-- 30-minute live"): users may submit multiple rows in one form submission.
-- No reconciliation against TikTok orders for v1 — the Japan team will
-- self-report numbers honestly + this is just the audit trail.
--
-- revenue_jpy is the source of truth; revenue_usd is snapshotted at the
-- moment of sale using the static exchange rate (same convention as
-- acquisitions.cost_usd). Future rate changes don't retroactively rewrite
-- historical USD numbers.
--
-- Soft-deletable so accidental submissions can be undone the same way
-- we already do for stream_counts.
CREATE TABLE IF NOT EXISTS japan_stream_sales (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid          NOT NULL REFERENCES products(id),
  quantity        integer       NOT NULL CHECK (quantity > 0),
  unit_price_jpy  numeric(12,2),                              -- nullable, per-unit price
  revenue_jpy     numeric(12,2) NOT NULL DEFAULT 0,           -- total = qty * unit_price
  revenue_usd     numeric(12,2) NOT NULL DEFAULT 0,           -- snapshotted
  sale_date       date          NOT NULL,
  streamer_id     uuid          REFERENCES users(id) ON DELETE SET NULL,
  recorded_by_id  uuid          REFERENCES users(id) ON DELETE SET NULL,
  notes           text,
  deleted         boolean       NOT NULL DEFAULT false,
  deleted_at      timestamptz,
  deleted_by_id   uuid          REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jss_sale_date
  ON japan_stream_sales (sale_date DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_jss_product
  ON japan_stream_sales (product_id);

CREATE INDEX IF NOT EXISTS idx_jss_streamer
  ON japan_stream_sales (streamer_id)
  WHERE deleted = false;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (each should return rows after running this once):
-- ---------------------------------------------------------------------------
--   SELECT id, name, type FROM locations WHERE name = 'Japan Warehouse';
--   SELECT id, name, country FROM vendors WHERE name LIKE '%Internal Transfer%';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='acquisitions' AND column_name IN ('origin','source_acquisition_id');
--   SELECT count(*) FROM japan_stream_sales;
