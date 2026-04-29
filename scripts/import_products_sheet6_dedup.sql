
[STDERR] POKEMONJP: 52 unique, 0 unmatched
[STDERR] Sheet6:    41 unique, 0 unmatched
[STDERR] OnePiece:  39 unique, 0 unmatched
-- ============================================
-- Bulk Pokemon JP import — sheet Sheet6 (gid=698669455) — duplicates of POKEMONJP, ON CONFLICT will skip most
-- 41 unique products generated
-- ============================================

INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('Pokemon', 'Sealed', 'Booster Box', 'Mega Symphonia Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Mega Dreams Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Mega Brave Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'White Flare Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Special Box', 'White Flare Deluxe Box', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Booster Box', 'Black Bolt Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Special Box', 'Black Bolt Deluxe Box', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Booster Box', 'SV9 Battle Partners Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Special Box', 'sv10 The Glory of Team Rocket Box', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Special Box', 'Heat Wave Arena Box', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Booster Box', 'Terastal Festival Japanese Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'SV Stellar Miracle Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Paradise Dragon Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Night Wanderer Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Transformation Mask Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Cyber Judge Booster Box sv5M', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Wild Force Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Crimson Haze Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Shiny Treasure Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Future Flash Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Nully Zero Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Raging Surf Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Ruler Of The Black Flame Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Triplet Beat Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Snow Hazard Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Clay Burst Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Scarlet ex Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Violet ex Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Vstar Universe Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Special Box', 'Paradigm Trigger Box', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Booster Box', 'Incandescent Arcana Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Electric Breaker Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Dark Fantasma Enhanced Expansion Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Time Gazer Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Eevee Heroes Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Dream League Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Booster Box', 'Inferno X Booster Box', 'JP', true, 30),
('Pokemon', 'Sealed', 'Special Box', 'Shiny Star V Box', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Special Box', 'Special Box Pokemon Center Fukuoka', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Special Box', 'Special Box Pokemon Center Hiroshima', 'JP', false, NULL),
('Pokemon', 'Sealed', 'Special Box', 'Special Box Pokemon Center Tohoku', 'JP', false, NULL)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

