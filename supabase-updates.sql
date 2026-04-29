-- ============================================
-- LUCKY VAULT INVENTORY SYSTEM
-- Complete SQL Setup - Run in Supabase SQL Editor
-- ============================================

-- ============================================
-- STEP 1: DISABLE ROW LEVEL SECURITY (makes everything public)
-- ============================================

ALTER TABLE acquisitions DISABLE ROW LEVEL SECURITY;
ALTER TABLE receipts DISABLE ROW LEVEL SECURITY;
ALTER TABLE shipments DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE box_breaks DISABLE ROW LEVEL SECURITY;
ALTER TABLE grading_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE high_value_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE high_value_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE vendors DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods DISABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 2: ADD INVENTORY LOCATIONS
-- ============================================

INSERT INTO locations (name, type, active) VALUES
('Master Inventory', 'Physical', true),
('eBay One', 'Physical', true),
('eBay Two/Slabbie Patty', 'Physical', true),
('Tiktok Rockets HQ', 'Physical', true),
('Tiktok Packheads', 'Physical', true),
('Whatnot', 'Physical', true),
('Storefront', 'Physical', true),
('Other/Out', 'Physical', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- STEP 4: UPDATE USER EMAILS (if needed)
-- ============================================

UPDATE users SET email = 'ann.liu.600@gmail.com' WHERE name = 'Ann';
UPDATE users SET email = 'mrvault@luckyvault.us' WHERE name = 'Gary';
UPDATE users SET email = 'help@luckyvault.us' WHERE name = 'Eric';

-- ============================================
-- STEP 5: CREATE BUSINESS EXPENSES TABLE (NEW)
-- ============================================

CREATE TABLE IF NOT EXISTS business_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    category VARCHAR(50) NOT NULL, -- shipping, office, utilities, food, travel, other
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    amount_usd DECIMAL(12,2),
    payment_method_id UUID REFERENCES payment_methods(id),
    description TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS on new table
ALTER TABLE business_expenses DISABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 6: ADD MISSING PACK PRODUCTS
-- These are needed for the Break Box feature to work
-- ============================================

-- POKEMON - JAPANESE (JP) - Missing Packs
INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('Pokemon', 'Pack', 'Booster Pack', 'Mega Evolution Inferno X', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Mega Dream', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'V-STAR Universe', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Amazing Volt', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Paradigm Trigger', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Star Birth', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Hot Air Arena', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Clay Burst', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Snow Hazard', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Lost Abyss', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Raging Surf', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Battle Partners', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Super Electric Breaker', 'JP', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Scarlet & Violet Collection File Set N', 'JP', false, 1)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

-- POKEMON - CHINESE (CN) - Missing Packs
INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('Pokemon', 'Pack', 'Booster Pack', '151 Bundle Box', 'CN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Vol.3 Box', 'CN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', '151 Gathering', 'CN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Sword & Shield All Stars CHARMING', 'CN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Sword & Shield All Stars BRAVE', 'CN', false, 1)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

-- POKEMON - ENGLISH (EN) - Missing Packs
INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('Pokemon', 'Pack', 'Booster Pack', 'Lost Origin', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Phantasmal Flames (Regular)', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Obsidian Flames', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Paldea Evolved', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Shining Fates', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Sword & Shield Elite (Zacian)', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Collector Chest Box Fall 2025', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Fusion Strike', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Hidden Fates', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Lillie Premium Tournament Collection', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', '151 Booster Tins', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Prismatic Surprise Box', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Poke Ball Tin', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Prismatic Evolutions', 'EN', false, 1),
('Pokemon', 'Pack', 'Booster Pack', 'Silver Tempest', 'EN', false, 1)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

-- ONE PIECE - JAPANESE (JP) - Missing Packs
INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('One Piece', 'Pack', 'Booster Pack', 'OP-03 Pillars of Strength', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-09 Emperors In The New World', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-10 Royal Lineage', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-11 A Fist of Divine Speed', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-12 The Bond Of Master And Disciple', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-13 Carrying On His Will', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-14 The Azure Seas Seven', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-The Best Vol.2 (PRB-02)', 'JP', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-EB3 Heroines Edition', 'JP', false, 1)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

-- ONE PIECE - ENGLISH (EN) - Missing Packs
INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES
('One Piece', 'Pack', 'Booster Pack', 'OP-01 Romance Dawn', 'EN', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-04 Kingdoms of Intrigue', 'EN', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-06 Wing of Captain', 'EN', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-11 A Fist of Divine Speed', 'EN', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-The Best Vol.2 (PRB-02)', 'EN', false, 1),
('One Piece', 'Pack', 'Booster Pack', 'OP-12 Double Packs Set 8', 'EN', false, 1)
ON CONFLICT (brand, type, category, name, language) DO NOTHING;

-- ============================================
-- DONE! Your database is now configured.
-- ============================================
