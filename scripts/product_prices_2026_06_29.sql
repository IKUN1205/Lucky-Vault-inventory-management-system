-- product_prices — TCGplayer market + recommended selling price per product.
-- Created 2026-06-29. Run MANUALLY in Supabase SQL Editor. IDEMPOTENT, ADDITIVE ONLY
-- (creates one new table; touches no existing table/column/row).
--
-- recommended_sell_usd convention (Gary 2026-06-29): tcg_market_usd * 1.05, rounded UP
-- to the next $0.50 (e.g. 17.06 -> 17.91 -> 18.00; 5.40 -> 5.67 -> 6.00; 208.4 -> 218.4 -> 218.50).
-- Populated/refreshed by inventory-sync/push_product_prices.py (browserless TCGplayer API).
--
-- Used by:
--   * Inventory views  -> show "Rec. Sell" guidance (display only; never auto-applies a price).
--   * Cost-entry guard  -> compare implied per-unit cost vs tcg_market_usd to catch the
--                          "per-unit price typed into the line-total field" mistake.

BEGIN;

CREATE TABLE IF NOT EXISTS product_prices (
  product_id           uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  tcg_market_usd       numeric(12,2),
  recommended_sell_usd numeric(12,2),
  currency             text NOT NULL DEFAULT 'USD',
  source               text,                         -- e.g. 'tcg:id:672434' / 'tcg:strict' / 'jp:snkr'
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_prices_updated ON product_prices (updated_at);

COMMIT;
