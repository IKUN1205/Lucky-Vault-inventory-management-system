-- ============================================================================
-- Platform sales — scan/cart redesign columns
-- ============================================================================
-- The PlatformSales page is being rebuilt to mirror Storefront Sale: scan a
-- UPC / cert# / TCG ID (or use Manual Entry to search by name), build a cart,
-- streamer enters the sold price next to "our price" (market). Each cart
-- submit decrements inventory and writes one platform_sales row per item.
--
-- For that the table needs:
--   - kind            ('sealed'|'single'|'slab') — disambiguates which of
--                     product_id / single_id / slab_id is meaningful
--   - single_id, slab_id — FKs paralleling the existing product_id
--   - transaction_id  — UUID grouping all rows from one cart submit
--   - our_price_usd   — snapshot of the reference price we showed the
--                     streamer (market price), separate from net_sales
--                     which is what the buyer actually paid
--
-- All additive + nullable so existing rows + old form-mode entries keep
-- working with no migration of data.
-- ============================================================================

ALTER TABLE platform_sales
  ADD COLUMN IF NOT EXISTS kind            text,
  ADD COLUMN IF NOT EXISTS single_id       uuid REFERENCES singles(id),
  ADD COLUMN IF NOT EXISTS slab_id         uuid REFERENCES slabs(id),
  ADD COLUMN IF NOT EXISTS transaction_id  uuid,
  ADD COLUMN IF NOT EXISTS our_price_usd   numeric(12,2);

-- kind check added separately so re-running the migration is safe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_sales_kind_check'
  ) THEN
    ALTER TABLE platform_sales
      ADD CONSTRAINT platform_sales_kind_check
      CHECK (kind IS NULL OR kind IN ('sealed','single','slab'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_platform_sales_transaction_id
  ON platform_sales (transaction_id)
  WHERE transaction_id IS NOT NULL;
