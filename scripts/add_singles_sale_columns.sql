-- ============================================================================
-- Singles feature — add sale-tracking columns (v1.5: out-flow / sold)
-- ============================================================================
-- Context: v1 only handled inflow (Add Single). v1.5 adds outflow — when a
-- card is sold, we record the sale price, channel (eBay / Whatnot / COMC /
-- TCGplayer / in-person / trade-out / other), fees, and date alongside the
-- existing card row. We keep this on the same `singles` row (not a separate
-- table) because the relationship is 1-card → 1-sale for graded slabs, and
-- the form on the SinglesInventory page already needs to display "what we
-- paid + what we sold for + realized P/L" on the same line.
--
-- Status convention: when a card is marked sold via the UI, status flips to
-- 'sold' (the CHECK constraint on singles.status already allows it). The
-- sale columns below stay NULL until that happens.
--
-- For partial sales of raw stacks (quantity > 1, sell some but not all),
-- v1.5 only supports selling the whole row. Splitting raw stacks into
-- "sold portion" + "remaining" comes in v2 — flagged in code with a TODO.
--
-- Safety:
--   * Pure ADD COLUMN with IF NOT EXISTS — idempotent
--   * Touches no other table
--   * Wrapped in BEGIN/COMMIT
-- ============================================================================

BEGIN;

ALTER TABLE singles
  ADD COLUMN IF NOT EXISTS sale_price_usd      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS sale_price_native   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS sale_currency       TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS sale_fees_usd       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS sale_channel        TEXT,
  ADD COLUMN IF NOT EXISTS sale_date           DATE,
  ADD COLUMN IF NOT EXISTS sold_by_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_name          TEXT,
  ADD COLUMN IF NOT EXISTS sale_notes          TEXT;

-- CHECK on sale_channel (rebuild idempotently)
ALTER TABLE singles DROP CONSTRAINT IF EXISTS singles_sale_channel_check;
ALTER TABLE singles ADD CONSTRAINT singles_sale_channel_check
  CHECK (
    sale_channel IS NULL
    OR sale_channel IN ('ebay','whatnot','comc','tcgplayer','in_person','trade_out','other')
  );

-- Useful index for "sold this month / quarter" report queries down the road.
CREATE INDEX IF NOT EXISTS idx_singles_sold_date
  ON singles (sale_date DESC)
  WHERE status = 'sold' AND deleted = false;

COMMIT;

-- ============================================================================
-- Verify:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'singles' AND column_name LIKE 'sale_%' OR column_name = 'buyer_name';
-- ============================================================================
