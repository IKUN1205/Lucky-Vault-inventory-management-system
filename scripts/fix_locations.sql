-- ============================================
-- Location cleanup: rename + hide unused
-- ============================================
-- Final desired set of active locations (8):
--   Front Store
--   Master Inventory
--   Slab Room
--   Stream Room - eBay LuckyVaultUS
--   Stream Room - eBay SlabbiePatty
--   Stream Room - TikTok RocketsHQ
--   Stream Room - TikTok Packheads      (renamed from "TikTok Whatnot")
--   Stream Room - Whatnot                (renamed from "Whatnot Rockets")
--
-- Hidden (active=false), kept for FK integrity:
--   Office Safe
--   Other/Out

-- 1. Snapshot BEFORE
SELECT 'BEFORE' AS state, name, type, active FROM locations ORDER BY active DESC, name;

-- 2. Rename "Stream Room - TikTok Whatnot" → "Stream Room - TikTok Packheads"
UPDATE locations
SET name = 'Stream Room - TikTok Packheads'
WHERE name = 'Stream Room - TikTok Whatnot';

-- 3. Rename "Stream Room - Whatnot Rockets" → "Stream Room - Whatnot"
UPDATE locations
SET name = 'Stream Room - Whatnot'
WHERE name = 'Stream Room - Whatnot Rockets';

-- 4. Hide unused locations (don't delete — preserves FK references in inventory / movements / stream_counts)
UPDATE locations
SET active = false
WHERE name IN ('Office Safe', 'Other/Out');

-- 5. Snapshot AFTER (only active = true rows)
SELECT 'AFTER (active only)' AS state, name, type, active
FROM locations
WHERE active = true
ORDER BY name;
