-- ============================================================================
-- Japan Warehouse — initial inventory baseline import (2026-05-22)
-- ============================================================================
-- Source: 在库.xlsx (sent by Will, 2026-05-22). 12 SKUs / 237 units total.
--
-- Idempotent: products + vendor are guarded by name lookups (NOT EXISTS),
-- inventory uses ON CONFLICT (product_id, location_id) DO UPDATE with
-- weighted-avg cost basis math. Re-running won't double-add — quantity stays
-- the same, avg_cost_basis recomputes correctly.
--
-- Acquisitions are written as origin='jp_vendor', status='Received' (instant
-- receive — same shape Japan Acquisitions page produces). Vendor = synthetic
-- "Japan Initial Inventory Baseline" so reports can filter out / treat it
-- as opening-balance noise.
--
-- WARNING: M5 Abyss Eye qty 79 has no known cost ("还没结账，价格不知道").
-- We import with cost=0 — once the real ¥ price is known, UPDATE the
-- acquisition row's `cost` + `cost_usd` AND inventory.avg_cost_basis for
-- this product manually (see the verify section at the bottom).
--
-- Run once in Supabase SQL Editor.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_japan_loc UUID;
  v_vendor    UUID;
  v_today     DATE := '2026-05-22';
  v_jpy_to_usd NUMERIC := 0.0067;  -- matches src/lib/supabase.js exchangeRates

  -- Existing product ids (looked up from products table once, then reused)
  v_op14      UUID := '1edcb956-9117-405c-bd9f-0a142ca10a4b'; -- OP-14 Booster Box
  v_op15      UUID := 'e0a1363a-52a0-417c-a5d0-6e81e6e59dbe'; -- OP-15 Booster Box
  v_mdream    UUID := '07c5e011-d0a4-475e-b7ea-249c3f14ae04'; -- Mega Dream Booster Box (sealed)
  v_infx      UUID := '2fe1ebf8-7a26-495e-8a0a-6048b0d79f24'; -- Mega Evolution Inferno X Booster Box
  v_ninja_open UUID := 'fe010f28-ddfd-43bc-aea7-ae95e22438ec'; -- Ninja Spinner Booster Box (Open)
  v_mbrave_pk UUID := 'de24b3ca-dcce-405c-ba2a-7112e2fecbe8'; -- Mega Brave Booster Pack
  v_msymph_pk UUID := 'b8ebe30e-fba7-4fdd-b9a8-5a481006526a'; -- Mega Symphonia Booster Pack
  v_ninja_pk  UUID := '894192f9-dd3e-4d74-bbf5-7a185779a0de'; -- Ninja Spinner Booster Pack

  -- New product ids (resolved or created below)
  v_glory_id      UUID;
  v_abyss_id      UUID;
  v_mdream_open   UUID;
  v_terastal_open UUID;
BEGIN
  -- ------------------------------------------------------------------------
  -- 0. Sanity: Japan Warehouse must exist
  -- ------------------------------------------------------------------------
  SELECT id INTO v_japan_loc FROM locations WHERE name = 'Japan Warehouse';
  IF v_japan_loc IS NULL THEN
    RAISE EXCEPTION 'Japan Warehouse location not found — run scripts/add_japan_inventory_system.sql first';
  END IF;

  -- ------------------------------------------------------------------------
  -- 1. Synthetic baseline vendor
  -- ------------------------------------------------------------------------
  SELECT id INTO v_vendor FROM vendors WHERE name = 'Japan Initial Inventory Baseline';
  IF v_vendor IS NULL THEN
    INSERT INTO vendors (name, country, active, notes)
    VALUES ('Japan Initial Inventory Baseline', 'Japan', true,
      'Opening-balance vendor for the 2026-05-22 Japan Warehouse import. Not a real purchase source.')
    RETURNING id INTO v_vendor;
  END IF;

  -- ------------------------------------------------------------------------
  -- 2. Create 4 missing products (idempotent via name lookup first)
  -- ------------------------------------------------------------------------
  SELECT id INTO v_glory_id FROM products WHERE name = 'Glory of Team Rocket Booster Box';
  IF v_glory_id IS NULL THEN
    INSERT INTO products (name, brand, language, type, category, active, breakable, packs_per_box)
    VALUES ('Glory of Team Rocket Booster Box', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, true, 30)
    RETURNING id INTO v_glory_id;
  END IF;

  SELECT id INTO v_abyss_id FROM products WHERE name = 'Abyss Eye Booster Box';
  IF v_abyss_id IS NULL THEN
    INSERT INTO products (name, brand, language, type, category, active, breakable, packs_per_box)
    VALUES ('Abyss Eye Booster Box', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, true, 30)
    RETURNING id INTO v_abyss_id;
  END IF;

  SELECT id INTO v_mdream_open FROM products WHERE name = 'Mega Dream Booster Box (Open)';
  IF v_mdream_open IS NULL THEN
    INSERT INTO products (name, brand, language, type, category, active, breakable, packs_per_box)
    VALUES ('Mega Dream Booster Box (Open)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, true, 30)
    RETURNING id INTO v_mdream_open;
  END IF;

  SELECT id INTO v_terastal_open FROM products WHERE name = 'Terastal Festival ex Booster Box (Open)';
  IF v_terastal_open IS NULL THEN
    INSERT INTO products (name, brand, language, type, category, active, breakable, packs_per_box)
    VALUES ('Terastal Festival ex Booster Box (Open)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, true, 30)
    RETURNING id INTO v_terastal_open;
  END IF;

  -- ------------------------------------------------------------------------
  -- 3. Insert 12 acquisition rows (one per SKU). source_country='Japan',
  --    origin='jp_vendor', status='Received', currency='JPY'. cost is the
  --    LINE total (qty × unit) — matches how createJapanAcquisition does it.
  --    cost_usd snapshotted at JPY→USD = 0.0067.
  -- ------------------------------------------------------------------------
  INSERT INTO acquisitions (
    date_purchased, source_country, vendor_id, product_id,
    quantity_purchased, quantity_received,
    cost, currency, cost_usd,
    status, origin, notes
  ) VALUES
    (v_today, 'Japan', v_vendor, v_op14,           1,  1,  11000,    'JPY',  11000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: OP-14 sealed'),
    (v_today, 'Japan', v_vendor, v_op15,           1,  1,  11000,    'JPY',  11000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: OP-15 sealed'),
    (v_today, 'Japan', v_vendor, v_mdream,        10, 10, 166500,    'JPY', 166500     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M2a Mega Dream sealed'),
    (v_today, 'Japan', v_vendor, v_infx,          15, 15, 390000,    'JPY', 390000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M2 Inferno X sealed'),
    (v_today, 'Japan', v_vendor, v_glory_id,       1,  1,  30000,    'JPY',  30000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: SV10 Glory of Team Rocket sealed'),
    (v_today, 'Japan', v_vendor, v_abyss_id,      79, 79,      0,    'JPY',      0,                   'Received', 'jp_vendor', 'Initial baseline: M5 Abyss Eye sealed — COST TBD ("还没结账，价格不知道")'),
    (v_today, 'Japan', v_vendor, v_mdream_open,    4,  4,  56000,    'JPY',  56000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M2a Mega Dream open / 垃圾袋'),
    (v_today, 'Japan', v_vendor, v_terastal_open, 16, 16, 304000,    'JPY', 304000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: SV8a Terastal Festival ex open / 垃圾袋'),
    (v_today, 'Japan', v_vendor, v_ninja_open,     4,  4,  34000,    'JPY',  34000     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M4 Ninja Spinner open / 垃圾袋'),
    (v_today, 'Japan', v_vendor, v_mbrave_pk,     16, 16,   3520,    'JPY',   3520     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M1L Mega Brave single pack'),
    (v_today, 'Japan', v_vendor, v_msymph_pk,     44, 44,  11440,    'JPY',  11440     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M1S Mega Symphonia single pack'),
    (v_today, 'Japan', v_vendor, v_ninja_pk,      46, 46,  12880,    'JPY',  12880     * v_jpy_to_usd, 'Received', 'jp_vendor', 'Initial baseline: M4 Ninja Spinner single pack');

  -- ------------------------------------------------------------------------
  -- 4. Inventory bump — UPSERT against the (product_id, location_id) unique
  --    index. If a Japan row already exists for this SKU (e.g. someone
  --    pre-loaded a row), the UPDATE branch adds quantity + does a proper
  --    weighted-average cost basis recompute. Same math the updateInventory
  --    helper uses on the client.
  --
  --    avg_cost_basis stored in USD (matches existing inventory rows). The
  --    pack-level cost is small (single-digit USD/pack) — no precision loss.
  -- ------------------------------------------------------------------------
  INSERT INTO inventory (product_id, location_id, quantity, avg_cost_basis, last_updated)
  VALUES
    (v_op14,           v_japan_loc,  1, 11000.00    * v_jpy_to_usd, NOW()),
    (v_op15,           v_japan_loc,  1, 11000.00    * v_jpy_to_usd, NOW()),
    (v_mdream,         v_japan_loc, 10, 16650.00    * v_jpy_to_usd, NOW()),
    (v_infx,           v_japan_loc, 15, 26000.00    * v_jpy_to_usd, NOW()),
    (v_glory_id,       v_japan_loc,  1, 30000.00    * v_jpy_to_usd, NOW()),
    (v_abyss_id,       v_japan_loc, 79,     0,                       NOW()),
    (v_mdream_open,    v_japan_loc,  4, 14000.00    * v_jpy_to_usd, NOW()),
    (v_terastal_open,  v_japan_loc, 16, 19000.00    * v_jpy_to_usd, NOW()),
    (v_ninja_open,     v_japan_loc,  4,  8500.00    * v_jpy_to_usd, NOW()),
    (v_mbrave_pk,      v_japan_loc, 16,   220.00    * v_jpy_to_usd, NOW()),
    (v_msymph_pk,      v_japan_loc, 44,   260.00    * v_jpy_to_usd, NOW()),
    (v_ninja_pk,       v_japan_loc, 46,   280.00    * v_jpy_to_usd, NOW())
  ON CONFLICT (product_id, location_id) DO UPDATE
    SET quantity = inventory.quantity + EXCLUDED.quantity,
        avg_cost_basis = CASE
          WHEN inventory.quantity + EXCLUDED.quantity > 0
            THEN (inventory.quantity * inventory.avg_cost_basis + EXCLUDED.quantity * EXCLUDED.avg_cost_basis)
                 / (inventory.quantity + EXCLUDED.quantity)
          ELSE inventory.avg_cost_basis
        END,
        last_updated = NOW();

  RAISE NOTICE 'Japan baseline import complete: 12 acquisitions written, 12 inventory rows upserted.';
END $$;

COMMIT;

-- ============================================================================
-- Verify (run after COMMIT):
-- ============================================================================
--
-- Total Japan inventory should equal 237 units, ¥1,030,340 cost basis
-- (excluding the 79 Abyss Eye at ¥0 — to be backfilled):
--
--   SELECT
--     COUNT(*) AS sku_count,
--     SUM(quantity) AS total_units,
--     ROUND(SUM(quantity * avg_cost_basis)::numeric, 2) AS total_value_usd
--   FROM inventory i
--   WHERE i.location_id = (SELECT id FROM locations WHERE name = 'Japan Warehouse')
--     AND i.quantity > 0;
--   -- Expected: 12 / 237 / ~6,903 USD (assuming Abyss Eye = 0)
--
-- ============================================================================
-- M5 Abyss Eye backfill (when the real price is known):
-- ============================================================================
--   -- 1. Update the acquisition's cost fields
--   UPDATE acquisitions
--   SET cost = 79 * <unit_price_jpy>,
--       cost_usd = 79 * <unit_price_jpy> * 0.0067,
--       notes = notes || ' — backfilled cost <date>'
--   WHERE origin = 'jp_vendor'
--     AND product_id = (SELECT id FROM products WHERE name = 'Abyss Eye Booster Box')
--     AND cost = 0;
--
--   -- 2. Update the inventory avg_cost_basis
--   UPDATE inventory
--   SET avg_cost_basis = <unit_price_jpy> * 0.0067,
--       last_updated = NOW()
--   WHERE product_id = (SELECT id FROM products WHERE name = 'Abyss Eye Booster Box')
--     AND location_id = (SELECT id FROM locations WHERE name = 'Japan Warehouse');
