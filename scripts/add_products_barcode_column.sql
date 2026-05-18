-- ============================================================================
-- products.barcode — UPC / EAN / generic 1D barcode on sealed product packaging
-- ============================================================================
-- Lets warehouse staff scan the box's printed barcode with a USB scanner
-- gun (sends "digits + Enter") on Intake, Manual Inventory, Move Inventory
-- and Add Product. The scanned value goes through a server-side lookup —
-- match found → SKU autopicks; no match → frontend prompts "associate this
-- barcode with which product?" and the answer writes back here. Over time
-- the column fills in for every SKU we receive.
--
-- One-to-one for now (a single SKU = a single barcode). If we ever hit the
-- "same SKU printed with different UPCs across batches" case, the upgrade
-- path is a new product_barcodes table — the column here can stay, point
-- to the primary/preferred barcode, and the table covers aliases.
--
-- Nullable so existing rows aren't required to backfill before scan starts
-- being useful. A unique partial index prevents two different SKUs from
-- accidentally claiming the same UPC (would silently break lookups).
--
-- Run once in Supabase SQL Editor. Idempotent.
-- ============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode TEXT;

-- Lookups by barcode are the hot path on every scan. Partial index covers
-- only non-null rows so the index stays small (most products won't have
-- a barcode until staff scans them or a bulk import lands).
CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode)
  WHERE barcode IS NOT NULL;

-- Stop two products from sharing the same barcode. Conditional on non-null
-- because Postgres treats NULLs as distinct in unique constraints — we
-- want lots of NULLs to coexist but no two real barcodes to collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON products (barcode)
  WHERE barcode IS NOT NULL;

-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='products' AND column_name='barcode';
