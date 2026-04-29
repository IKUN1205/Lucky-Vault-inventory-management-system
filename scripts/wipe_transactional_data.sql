-- ============================================
-- Wipe transactional / experimental data
-- Keeps: users, locations, products, payment_methods, vendors
-- Wipes: inventory, movements, stream_counts/items, box_breaks,
--        acquisitions, receipts, shipments, storefront_sales,
--        platform_sales, business_expenses, grading_submissions,
--        high_value_items, high_value_movements
-- ============================================

-- ============================================
-- STEP 1: AUDIT — see what you're about to wipe
-- Run this part FIRST, paste the result back to confirm before TRUNCATE.
-- ============================================
SELECT 'inventory'             AS tbl, COUNT(*) AS rows FROM inventory
UNION ALL SELECT 'movements',              COUNT(*) FROM movements
UNION ALL SELECT 'stream_counts',          COUNT(*) FROM stream_counts
UNION ALL SELECT 'stream_count_items',     COUNT(*) FROM stream_count_items
UNION ALL SELECT 'box_breaks',             COUNT(*) FROM box_breaks
UNION ALL SELECT 'acquisitions',           COUNT(*) FROM acquisitions
UNION ALL SELECT 'receipts',               COUNT(*) FROM receipts
UNION ALL SELECT 'shipments',              COUNT(*) FROM shipments
UNION ALL SELECT 'storefront_sales',       COUNT(*) FROM storefront_sales
UNION ALL SELECT 'platform_sales',         COUNT(*) FROM platform_sales
UNION ALL SELECT 'business_expenses',      COUNT(*) FROM business_expenses
UNION ALL SELECT 'grading_submissions',    COUNT(*) FROM grading_submissions
UNION ALL SELECT 'high_value_items',       COUNT(*) FROM high_value_items
UNION ALL SELECT 'high_value_movements',   COUNT(*) FROM high_value_movements
ORDER BY tbl;

-- ============================================
-- STEP 2: WIPE — only run AFTER you confirmed Step 1 looked right
-- TRUNCATE ... CASCADE handles FK dependencies automatically.
-- RESTART IDENTITY resets any auto-increment sequences (we use UUIDs but harmless).
-- DO NOT RUN this section together with Step 1. Run separately.
-- ============================================

-- (Uncomment when ready to wipe)
/*
TRUNCATE TABLE
  inventory,
  movements,
  stream_counts,
  stream_count_items,
  box_breaks,
  acquisitions,
  receipts,
  shipments,
  storefront_sales,
  platform_sales,
  business_expenses,
  grading_submissions,
  high_value_items,
  high_value_movements
RESTART IDENTITY CASCADE;
*/

-- ============================================
-- STEP 3: VERIFY — re-run audit after wipe (all should be 0)
-- ============================================
-- Just re-run STEP 1 query above.
