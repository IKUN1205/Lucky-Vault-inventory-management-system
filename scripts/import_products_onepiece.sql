
[STDERR] POKEMONJP: 52 unique, 0 unmatched
[STDERR] Sheet6:    41 unique, 0 unmatched
[STDERR] OnePiece:  39 unique, 0 unmatched
-- ============================================
-- Bulk One Piece EN+JP import — sheet One Piece (gid=799475548)
-- 39 unique products generated
-- ============================================

INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('One Piece', 'Sealed', 'Booster Box', 'OP-09 ENG Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP-13 ENG Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB-03 ENG Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'PRB-01 ENG Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'A Fist of Divine Speed - Booster Box OP-11', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB-04 ENG Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP-10 Royal Blood Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 01 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 03 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 04 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 05 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 07 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 08 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 09 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 10 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 11 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 12 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 13 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 14 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 15 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB 01 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB 02 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB 03 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB 04 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB 05 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'PRB 02 Japanese Booster Box', 'JP', true, 24),
('One Piece', 'Pack', 'Booster Pack', 'OP 08 English Booster Pack', 'EN', false, NULL),
('One Piece', 'Sealed', 'Booster Box', 'OP 09 English Booster Box', 'EN', true, 24),
('One Piece', 'Pack', 'Booster Pack', 'OP 10 English Booster Pack', 'EN', false, NULL),
('One Piece', 'Pack', 'Booster Pack', 'OP 11 English Sleeved Booster Pack', 'EN', false, NULL),
('One Piece', 'Sealed', 'Booster Box', 'OP 13 English Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP 14 English Booster Box', 'EN', true, 24),
('One Piece', 'Pack', 'Booster Pack', 'OP 14 English Sleeved Booster Pack', 'EN', false, NULL),
('One Piece', 'Pack', 'Booster Pack', 'OP 14 English Booster Pack', 'EN', false, NULL),
('One Piece', 'Sealed', 'Booster Box', 'OP 15 English Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'EB 03 English Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'PRB 01 English Booster Box', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'Legacy of the Master Booster Box OP12', 'EN', true, 24),
('One Piece', 'Sealed', 'Booster Box', 'OP-07 500 Years in the Future Booster Box', 'EN', true, 24)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

