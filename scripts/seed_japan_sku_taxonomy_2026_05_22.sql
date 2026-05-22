-- ============================================================================
-- Japan SKU taxonomy seed — generated from db.xlsx
-- ============================================================================
-- Generated: 2026-05-22T03:45:18.762Z
-- Source xlsx: db.xlsx (97 rows; 98 valid after cleanup)
-- 26 UPDATEs (existing products) + 64 INSERTs (new SKUs)
--
-- Run AFTER scripts/add_product_taxonomy_columns.sql.
-- Wrapped in BEGIN/COMMIT — ROLLBACK on any failure leaves the DB unchanged.
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- A. UPDATE existing products (no rename — per user directive)
-- ───────────────────────────────────────────────────────────────────────────
-- OP-15 有膜 → "OP-15 Adventure on Kami's Island Booster Box"
UPDATE products SET aliases = ARRAY['OP-15', '海贼王', 'Adventure on KAMI’s Island', 'Adventure on KAMI’s Island--Box']::text[], short_code = 'OP-15', variant = 'sealed' WHERE id = 'e0a1363a-52a0-417c-a5d0-6e81e6e59dbe';
-- M2a 有膜 → "Mega Dream Booster Box"
UPDATE products SET aliases = ARRAY['M2a', '宝可梦', 'MEGA Dream ex', 'MEGA Dream ex--Booster Box']::text[], short_code = 'M2a', variant = 'sealed' WHERE id = '07c5e011-d0a4-475e-b7ea-249c3f14ae04';
-- M2 有膜 → "Mega Evolution Inferno X Booster Box"
UPDATE products SET aliases = ARRAY['M2', '宝可梦', 'Inferno X', 'Inferno X--Booster Box']::text[], short_code = 'M2', variant = 'sealed' WHERE id = '2fe1ebf8-7a26-495e-8a0a-6048b0d79f24';
-- OP-13 有膜 → "OP-13 Carrying On His Will Booster Box"
UPDATE products SET aliases = ARRAY['OP-13', '海贼王', 'CARRYING ON HIS WILL', 'CARRYING ON HIS WILL--Box']::text[], short_code = 'OP-13', variant = 'sealed' WHERE id = 'b8174d2a-4c56-4b64-882c-16e4693c0dae';
-- OP-09 有膜 → "OP-09 Emperors In The New World Booster Box"
UPDATE products SET aliases = ARRAY['OP-09', '海贼王', 'Emperors In The New World', 'Emperors In The New World--Box']::text[], short_code = 'OP-09', variant = 'sealed' WHERE id = '23615c5d-e9da-4b12-a1d2-82bbe7953487';
-- OP-14 有膜 → "OP-14 The Azure Seas Seven Booster Box"
UPDATE products SET aliases = ARRAY['OP-14', '海贼王', 'THE AZURE SEA''S SEVEN', 'THE AZURE SEA''S SEVEN--Box']::text[], short_code = 'OP-14', variant = 'sealed' WHERE id = '8a03ebcc-3b57-436f-8e5c-20fe44b6c517';
-- OP-05 有膜 → "OP-05 Awakening of the New Era Booster Box"
UPDATE products SET aliases = ARRAY['OP-05', '海贼王', 'Awakening Of The New Era', 'Awakening Of The New Era--Box']::text[], short_code = 'OP-05', variant = 'sealed' WHERE id = '75d93da5-37b9-4086-9bf0-df2b87ff1ea9';
-- OP-11 有膜 → "OP-11 A Fist of Divine Speed Booster Box"
UPDATE products SET aliases = ARRAY['OP-11', '海贼王', 'A Fist of Divine Speed', 'A Fist of Divine Speed--Box']::text[], short_code = 'OP-11', variant = 'sealed' WHERE id = 'b59651a1-8b05-4537-b479-3b47c73611a9';
-- M2a 垃圾袋 → "Mega Dream Booster Box (Open)"
UPDATE products SET aliases = ARRAY['M2a', '宝可梦', 'MEGA Dream ex', 'MEGA Dream ex--in bag']::text[], short_code = 'M2a', variant = 'in_bag' WHERE id = '9bf60477-a1e2-4616-a325-38fc35396b1d';
-- SV10 有膜 → "Glory of Team Rocket Booster Box"
UPDATE products SET aliases = ARRAY['SV10', '宝可梦', 'Glory of Team Rocket', 'Glory of Team Rocket--Booster Box']::text[], short_code = 'SV10', variant = 'sealed' WHERE id = 'b519fdd7-2f08-42e7-8226-392a2d797280';
-- M1L 有膜 → "Mega Brave Booster Box"
UPDATE products SET aliases = ARRAY['M1L', '宝可梦', 'Mega Brave', 'Mega Brave--Booster Box']::text[], short_code = 'M1L', variant = 'sealed' WHERE id = 'f397783e-46b0-4883-9b1f-ca2b858ca290';
-- M1S 有膜 → "Mega Symphonia Booster Box"
UPDATE products SET aliases = ARRAY['M1S', '宝可梦', 'Mega Symphonia', 'Mega Symphonia--Booster Box']::text[], short_code = 'M1S', variant = 'sealed' WHERE id = 'dcb7e9c1-28d0-4682-ab41-ba8eef3d1fc1';
-- M2 散包 → "Mega Evolution Inferno X Booster Pack"
UPDATE products SET aliases = ARRAY['M2', '宝可梦', 'Inferno X', 'Inferno X--Single Pack']::text[], short_code = 'M2', variant = 'single_pack' WHERE id = '1cbce0ef-0049-4804-9fa1-243b5532b2aa';
-- M1L 散包 → "Mega Brave Booster Pack"
UPDATE products SET aliases = ARRAY['M1L', '宝可梦', 'Mega Brave', 'Mega Brave--Single Pack']::text[], short_code = 'M1L', variant = 'single_pack' WHERE id = 'de24b3ca-dcce-405c-ba2a-7112e2fecbe8';
-- M1S 散包 → "Mega Symphonia Booster Pack"
UPDATE products SET aliases = ARRAY['M1S', '宝可梦', 'Mega Symphonia', 'Mega Symphonia--Single Pack']::text[], short_code = 'M1S', variant = 'single_pack' WHERE id = 'b8ebe30e-fba7-4fdd-b9a8-5a481006526a';
-- SV11W 散包 → "White Flare Booster Pack"
UPDATE products SET aliases = ARRAY['SV11W', '宝可梦', 'White Flare', 'White Flare--Single Pack']::text[], short_code = 'SV11W', variant = 'single_pack' WHERE id = 'b8a67072-a8f7-4e64-975c-ce16017ef220';
-- SV11B 散包 → "Black Bolt Booster Pack"
UPDATE products SET aliases = ARRAY['SV11B', '宝可梦', 'Black Bolt', 'Black Bolt--Single Pack']::text[], short_code = 'SV11B', variant = 'single_pack' WHERE id = '6088d502-53e0-4751-b99f-f2e99c087001';
-- M4 散包 → "Ninja Spinner Booster Pack"
UPDATE products SET aliases = ARRAY['M4', '宝可梦', 'Ninja Spinner', 'Ninja Spinner--Single Pack']::text[], short_code = 'M4', variant = 'single_pack' WHERE id = '894192f9-dd3e-4d74-bbf5-7a185779a0de';
-- M4 有膜 → "Ninja Spinner Booster Box"
UPDATE products SET aliases = ARRAY['M4', '宝可梦', 'Ninja Spinner', 'Ninja Spinner--Booster Box']::text[], short_code = 'M4', variant = 'sealed' WHERE id = 'a77b79fb-2715-4d8d-8ede-3fcfa4c4aef6';
-- SV8a 垃圾袋 → "Terastal Festival ex Booster Box (Open)"
UPDATE products SET aliases = ARRAY['SV8a', '宝可梦', 'Terastal Festival ex', 'Terastal Festival ex--in bag']::text[], short_code = 'SV8a', variant = 'in_bag' WHERE id = 'e0faeb4d-9e34-49ae-b90b-3186dd8c88e3';
-- M4 垃圾袋 → "Ninja Spinner Booster Box (Open)"
UPDATE products SET aliases = ARRAY['M4', '宝可梦', 'Ninja Spinner', 'Ninja Spinner--in bag']::text[], short_code = 'M4', variant = 'in_bag' WHERE id = 'fe010f28-ddfd-43bc-aea7-ae95e22438ec';
-- THE RIVALS 有膜 → "Limit Over Collection The Rivals Booster Box"
UPDATE products SET aliases = ARRAY['THE RIVALS', '游戏王', 'THE RIVALS--Booster Box']::text[], short_code = 'THE RIVALS', variant = 'sealed' WHERE id = 'a1a257ac-821b-465f-af0c-175c227a1abd';
-- OP-12 有膜 → "OP-12 Legacy of the Master Booster Box"
UPDATE products SET aliases = ARRAY['OP-12', '海贼王', 'Legacy of the Master', 'Legacy of the Master--Box']::text[], short_code = 'OP-12', variant = 'sealed' WHERE id = '718499ad-c4f3-47ff-9ea3-8ea5459a24dd';
-- SV9 有膜 → "Battle Partners Booster Box"
UPDATE products SET aliases = ARRAY['SV9', '宝可梦', 'Battle Partners', 'Battle Partners--Booster Box']::text[], short_code = 'SV9', variant = 'sealed' WHERE id = 'a9b8bcc9-a0e5-4e65-ac41-bf5cc55740a0';
-- promo 散包 → "vol 8 OP promo pack Booster Pack"
UPDATE products SET aliases = ARRAY['promo', '海贼王']::text[], short_code = 'promo', variant = 'single_pack' WHERE id = '068627c6-8666-49df-9bfc-fe22b791e348';
-- M5 有膜 → "Abyss Eye Booster Box"
UPDATE products SET aliases = ARRAY['M5', '宝可梦', 'Abyss Eye', 'Abyss Eye--Booster Box']::text[], short_code = 'M5', variant = 'sealed' WHERE id = '748116b5-d399-4aaf-b355-28cecce91ace';

-- ───────────────────────────────────────────────────────────────────────────
-- B. INSERT new SKUs (one row per xlsx entry without a DB match)
-- ───────────────────────────────────────────────────────────────────────────
-- SV8a 有膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Terastal Festival ex Booster Box', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV8a', '宝可梦', 'Terastal Festival ex', 'Terastal Festival ex--Booster Box']::text[], 'SV8a', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- EB-04 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('EGGHEAD CRISIS Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['EB-04', '海贼王', 'EGGHEAD CRISIS', 'EGGHEAD CRISIS--Box']::text[], 'EB-04', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- EB-03 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('ONE PIECE Heroines edition Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['EB-03', '海贼王', 'ONE PIECE Heroines edition', 'ONE PIECE Heroines edition--Box']::text[], 'EB-03', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- PRB-02 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('ONE PIECE CARD THE BEST vol.2 Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['PRB-02', '海贼王', 'ONE PIECE CARD THE BEST vol.2', 'ONE PIECE CARD THE BEST vol.2--Box']::text[], 'PRB-02', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE HEROES 有膜 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE HEROES Booster Box', 'Yu-Gi-Oh', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['THE HEROES', '游戏王', 'THE HEROES--Booster Box']::text[], 'THE HEROES', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV11W 有膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('White Flare Booster Box', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV11W', '宝可梦', 'White Flare', 'White Flare--Booster Box']::text[], 'SV11W', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV11B 有膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Black Bolt Booster Box', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV11B', '宝可梦', 'Black Bolt', 'Black Bolt--Booster Box']::text[], 'SV11B', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M3 有膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Munikis / Nihil Zero Booster Box', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M3', '宝可梦', 'Munikis / Nihil Zero', 'Munikis / Nihil Zero--Booster Box']::text[], 'M3', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M2a 散包 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('MEGA Dream ex Single Pack', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M2a', '宝可梦', 'MEGA Dream ex', 'MEGA Dream ex--Single Pack']::text[], 'M2a', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV8a 散包 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Terastal Festival ex Single Pack', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['SV8a', '宝可梦', 'Terastal Festival ex', 'Terastal Festival ex--Single Pack']::text[], 'SV8a', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV10 散包 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Glory of Team Rocket Single Pack', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['SV10', '宝可梦', 'Glory of Team Rocket', 'Glory of Team Rocket--Single Pack']::text[], 'SV10', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M3 散包 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Munikis / Nihil Zero Single Pack', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M3', '宝可梦', 'Munikis / Nihil Zero', 'Munikis / Nihil Zero--Single Pack']::text[], 'M3', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M2 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Inferno X (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M2', '宝可梦', 'Inferno X', 'Inferno X--in bag']::text[], 'M2', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV10 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Glory of Team Rocket (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['SV10', '宝可梦', 'Glory of Team Rocket', 'Glory of Team Rocket--in bag']::text[], 'SV10', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M1L 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Mega Brave (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M1L', '宝可梦', 'Mega Brave', 'Mega Brave--in bag']::text[], 'M1L', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M1S 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Mega Symphonia (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M1S', '宝可梦', 'Mega Symphonia', 'Mega Symphonia--in bag']::text[], 'M1S', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV11W 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('White Flare (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['SV11W', '宝可梦', 'White Flare', 'White Flare--in bag']::text[], 'SV11W', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV11B 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Black Bolt (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['SV11B', '宝可梦', 'Black Bolt', 'Black Bolt--in bag']::text[], 'SV11B', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M3 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Munikis / Nihil Zero (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M3', '宝可梦', 'Munikis / Nihil Zero', 'Munikis / Nihil Zero--in bag']::text[], 'M3', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M2a 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('MEGA Dream ex Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M2a', '宝可梦', 'MEGA Dream ex', 'MEGA Dream ex--no seal']::text[], 'M2a', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M2 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Inferno X Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M2', '宝可梦', 'Inferno X', 'Inferno X--no seal']::text[], 'M2', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV8a 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Terastal Festival ex Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV8a', '宝可梦', 'Terastal Festival ex', 'Terastal Festival ex--no seal']::text[], 'SV8a', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV10 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Glory of Team Rocket Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV10', '宝可梦', 'Glory of Team Rocket', 'Glory of Team Rocket--no seal']::text[], 'SV10', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M1L 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Mega Brave Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M1L', '宝可梦', 'Mega Brave', 'Mega Brave--no seal']::text[], 'M1L', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M1S 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Mega Symphonia Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M1S', '宝可梦', 'Mega Symphonia', 'Mega Symphonia--no seal']::text[], 'M1S', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV11W 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('White Flare Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV11W', '宝可梦', 'White Flare', 'White Flare--no seal']::text[], 'SV11W', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV11B 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Black Bolt Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV11B', '宝可梦', 'Black Bolt', 'Black Bolt--no seal']::text[], 'SV11B', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M3 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Munikis / Nihil Zero Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M3', '宝可梦', 'Munikis / Nihil Zero', 'Munikis / Nihil Zero--no seal']::text[], 'M3', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M4 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Ninja Spinner Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M4', '宝可梦', 'Ninja Spinner', 'Ninja Spinner--no seal']::text[], 'M4', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- APT 无膜 (龙珠) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('DRAGON BALL 40th Anniversary Edition Booster Box (Unsealed)', 'Other', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['APT', '龙珠', 'DRAGON BALL 40th Anniversary Edition']::text[], 'APT', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- FB09 无膜 (龙珠) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('DRAGON BALL SUPER CARD GAME FUSION WORLD Booster Pack "DUAL EVOLUTION" Box Booster Box (Unsealed)', 'Other', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['FB09', '龙珠', 'DRAGON BALL SUPER CARD GAME FUSION WORLD Booster Pack "DUAL EVOLUTION" Box']::text[], 'FB09', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE HEROES 原箱 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE HEROES (Case)', 'Yu-Gi-Oh', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['THE HEROES', '游戏王', 'THE HEROES--case']::text[], 'THE HEROES', 'case', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE RIVALS 原箱 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE RIVALS (Case)', 'Yu-Gi-Oh', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['THE RIVALS', '游戏王', 'THE RIVALS--case']::text[], 'THE RIVALS', 'case', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE HEROES 散包 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE HEROES Single Pack', 'Yu-Gi-Oh', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['THE HEROES', '游戏王', 'THE HEROES--Single Pack']::text[], 'THE HEROES', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE RIVALS 散包 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE RIVALS Single Pack', 'Yu-Gi-Oh', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['THE RIVALS', '游戏王', 'THE RIVALS--Single Pack']::text[], 'THE RIVALS', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE HEROES 无膜 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE HEROES Booster Box (Unsealed)', 'Yu-Gi-Oh', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['THE HEROES', '游戏王', 'THE HEROES--no seal']::text[], 'THE HEROES', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- THE RIVALS 无膜 (游戏王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE RIVALS Booster Box (Unsealed)', 'Yu-Gi-Oh', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['THE RIVALS', '游戏王', 'THE RIVALS--no seal']::text[], 'THE RIVALS', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- PRB-01 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Premium Booster ONE PIECE CARD THE BEST Box Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['PRB-01', '海贼王', 'Premium Booster ONE PIECE CARD THE BEST Box', 'Premium Booster ONE PIECE CARD THE BEST Box--Box']::text[], 'PRB-01', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-10 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Royal Blood Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-10', '海贼王', 'Royal Blood', 'Royal Blood--Box']::text[], 'OP-10', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- EB-04 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('EGGHEAD CRISIS (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['EB-04', '海贼王', 'EGGHEAD CRISIS', 'EGGHEAD CRISIS--Slit']::text[], 'EB-04', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-13 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('CARRYING ON HIS WILL (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-13', '海贼王', 'CARRYING ON HIS WILL', 'CARRYING ON HIS WILL--Slit']::text[], 'OP-13', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-09 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Emperors In The New World (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-09', '海贼王', 'Emperors In The New World', 'Emperors In The New World--Slit']::text[], 'OP-09', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-14 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('THE AZURE SEA''S SEVEN (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-14', '海贼王', 'THE AZURE SEA''S SEVEN', 'THE AZURE SEA''S SEVEN--Slit']::text[], 'OP-14', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-05 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Awakening Of The New Era (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-05', '海贼王', 'Awakening Of The New Era', 'Awakening Of The New Era--Slit']::text[], 'OP-05', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- EB-03 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('ONE PIECE Heroines edition (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['EB-03', '海贼王', 'ONE PIECE Heroines edition', 'ONE PIECE Heroines edition--Slit']::text[], 'EB-03', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- PRB-02 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('ONE PIECE CARD THE BEST vol.2 (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['PRB-02', '海贼王', 'ONE PIECE CARD THE BEST vol.2', 'ONE PIECE CARD THE BEST vol.2--Slit']::text[], 'PRB-02', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-11 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('A Fist of Divine Speed (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-11', '海贼王', 'A Fist of Divine Speed', 'A Fist of Divine Speed--Slit']::text[], 'OP-11', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-15 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Adventure on KAMI’s Island (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-15', '海贼王', 'Adventure on KAMI’s Island', 'Adventure on KAMI’s Island--Slit']::text[], 'OP-15', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- PRB-01 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Premium Booster ONE PIECE CARD THE BEST Box (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['PRB-01', '海贼王', 'Premium Booster ONE PIECE CARD THE BEST Box', 'Premium Booster ONE PIECE CARD THE BEST Box--Slit']::text[], 'PRB-01', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-12 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Legacy of the Master (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-12', '海贼王', 'Legacy of the Master', 'Legacy of the Master--Slit']::text[], 'OP-12', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-10 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Royal Blood (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-10', '海贼王', 'Royal Blood', 'Royal Blood--Slit']::text[], 'OP-10', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-08 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Two Legends Box Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-08', '海贼王', 'Two Legends Box', 'Two Legends Box--Box']::text[], 'OP-08', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-08 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Two Legends Box (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-08', '海贼王', 'Two Legends Box', 'Two Legends Box--Slit']::text[], 'OP-08', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-07 有膜 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('The Future After 500 years Booster Box', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-07', '海贼王', 'The Future After 500 years']::text[], 'OP-07', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-07 切一刀 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('The Future After 500 years (Cut Slice)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-07', '海贼王', 'The Future After 500 years']::text[], 'OP-07', 'cut_slice', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- SV9 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Battle Partners Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['SV9', '宝可梦', 'Battle Partners', 'Battle Partners--no seal']::text[], 'SV9', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- PRB-02 原箱 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('ONE PIECE CARD THE BEST vol.2 (Case)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['PRB-02', '海贼王', 'ONE PIECE CARD THE BEST vol.2', 'ONE PIECE CARD THE BEST vol.2--Box Case']::text[], 'PRB-02', 'case', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- EB-03 原箱 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('ONE PIECE Heroines edition (Case)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['EB-03', '海贼王', 'ONE PIECE Heroines edition', 'ONE PIECE Heroines edition--Box']::text[], 'EB-03', 'case', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- OP-13 原箱 (海贼王) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('CARRYING ON HIS WILL (Case)', 'One Piece', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['OP-13', '海贼王', 'CARRYING ON HIS WILL', 'CARRYING ON HIS WILL--Box']::text[], 'OP-13', 'case', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- FB09 有膜 (龙珠) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('DRAGON BALL SUPER CARD GAME FUSION WORLD Booster Pack "DUAL EVOLUTION" Box Booster Box', 'Other', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['FB09', '龙珠', 'DRAGON BALL SUPER CARD GAME FUSION WORLD Booster Pack "DUAL EVOLUTION" Box']::text[], 'FB09', 'sealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- 其他 其他 () → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('others (Other)', 'Other', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['其他', 'others']::text[], '其他', 'other', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M5 无膜 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Abyss Eye Booster Box (Unsealed)', 'Pokemon', 'JP', 'Sealed', 'Booster Box', true, 30, ARRAY['M5', '宝可梦', 'Abyss Eye', 'Abyss Eye--no seal']::text[], 'M5', 'unsealed', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M5 垃圾袋 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Abyss Eye (In Bag)', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M5', '宝可梦', 'Abyss Eye', 'Abyss Eye--in bag']::text[], 'M5', 'in_bag', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;
-- M5 散包 (宝可梦) → new
INSERT INTO products (name, brand, language, type, category, breakable, packs_per_box, aliases, short_code, variant, active) VALUES ('Abyss Eye Single Pack', 'Pokemon', 'JP', 'Pack', 'Booster Pack', false, NULL, ARRAY['M5', '宝可梦', 'Abyss Eye', 'Abyss Eye--Single Pack']::text[], 'M5', 'single_pack', true) ON CONFLICT (brand, type, category, name, language) DO UPDATE SET aliases = EXCLUDED.aliases, short_code = EXCLUDED.short_code, variant = EXCLUDED.variant;

-- ───────────────────────────────────────────────────────────────────────────
-- Verify before COMMIT:
-- ───────────────────────────────────────────────────────────────────────────
--   SELECT variant, COUNT(*) FROM products WHERE variant IS NOT NULL GROUP BY variant ORDER BY 2 DESC;
--   SELECT name, short_code, variant, aliases FROM products WHERE short_code IS NOT NULL ORDER BY short_code, variant LIMIT 30;

COMMIT;
