-- ============================================================================
-- Singles feature — card_sets table (NEW, append-only migration)
-- ============================================================================
-- Purpose: catalog of TCG card sets so the new `singles` table can FK to a
--          canonical set row instead of free-text "Surging Sparks" / "surging
--          sparks" / "SS" all coexisting.
--
-- Safety guarantees:
--   * This migration ONLY creates the new `card_sets` table and seeds a few
--     rows. It does NOT touch any existing table (products, inventory,
--     high_value_items, box_breaks, etc.).
--   * Wrapped in BEGIN / COMMIT so any failure rolls back atomically — partial
--     state is impossible.
--   * Idempotent: safe to re-run. CREATE TABLE IF NOT EXISTS + ON CONFLICT.
--
-- Run in the Supabase SQL editor (or psql). Verify at the bottom.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Table: card_sets
-- ----------------------------------------------------------------------------
-- One row per (brand, language, set name). `code` (e.g. SV08, OP-11) is
-- optional but useful for fuzzy matching when users only know the abbreviation.
-- `release_date` is also optional — handy for sorting newest-first in dropdowns.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_sets (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         text          NOT NULL,                       -- 'Pokemon', 'One Piece', 'Magic', etc.
  name          text          NOT NULL,                       -- 'Surging Sparks', 'Base Set Shadowless'
  code          text,                                          -- 'SV08', 'BS', 'OP-11' (optional)
  language      text          NOT NULL,                       -- 'EN' / 'JP' / 'KR' / 'CN'
  release_date  date,
  active        boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (brand, language, name)
);

CREATE INDEX IF NOT EXISTS idx_card_sets_brand_lang
  ON card_sets (brand, language, active);

CREATE INDEX IF NOT EXISTS idx_card_sets_code
  ON card_sets (code) WHERE code IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Disable RLS to match the rest of the LV schema (which has RLS disabled per
-- supabase-updates.sql). If RLS is enabled elsewhere in the future, this line
-- becomes redundant; it's not harmful.
-- ----------------------------------------------------------------------------
ALTER TABLE card_sets DISABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Touch updated_at on UPDATE. Reuses the shared touch_updated_at() function
-- already defined elsewhere in the schema (see create_audit_tables.sql).
-- If for some reason that function doesn't exist yet, create it here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_card_sets_touch ON card_sets;
CREATE TRIGGER trg_card_sets_touch
  BEFORE UPDATE ON card_sets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- Seed: a starter list of common sets so the Add Single dropdown isn't empty
-- on day 1. Editable later via direct SQL or a future Manage Sets page.
-- ON CONFLICT (brand, language, name) DO NOTHING keeps this safe to re-run.
-- ----------------------------------------------------------------------------

-- Pokemon EN — modern Scarlet & Violet era + key vintage
INSERT INTO card_sets (brand, language, name, code, release_date) VALUES
  ('Pokemon', 'EN', 'Surging Sparks',          'SV08', '2024-11-08'),
  ('Pokemon', 'EN', 'Prismatic Evolutions',    'SV8.5','2025-01-17'),
  ('Pokemon', 'EN', 'Stellar Crown',           'SV07', '2024-09-13'),
  ('Pokemon', 'EN', 'Twilight Masquerade',     'SV06', '2024-05-24'),
  ('Pokemon', 'EN', 'Temporal Forces',         'SV05', '2024-03-22'),
  ('Pokemon', 'EN', 'Paldean Fates',           'SV4.5','2024-01-26'),
  ('Pokemon', 'EN', 'Paradox Rift',            'SV04', '2023-11-03'),
  ('Pokemon', 'EN', 'Obsidian Flames',         'SV03', '2023-08-11'),
  ('Pokemon', 'EN', 'Paldea Evolved',          'SV02', '2023-06-09'),
  ('Pokemon', 'EN', '151',                     'SV3.5','2023-09-22'),
  ('Pokemon', 'EN', 'Crown Zenith',            'SWSH12.5','2023-01-20'),
  ('Pokemon', 'EN', 'Silver Tempest',          'SWSH12','2022-11-11'),
  ('Pokemon', 'EN', 'Lost Origin',             'SWSH11','2022-09-09'),
  ('Pokemon', 'EN', 'Hidden Fates',            'SM11.5','2019-08-23'),
  ('Pokemon', 'EN', 'Shining Fates',           'SWSH4.5','2021-02-19'),
  ('Pokemon', 'EN', 'Evolving Skies',          'SWSH7','2021-08-27'),
  ('Pokemon', 'EN', 'Base Set',                'BS',   '1999-01-09'),
  ('Pokemon', 'EN', 'Base Set Shadowless',     'BS',   '1999-01-09'),
  ('Pokemon', 'EN', 'Base Set 1st Edition',    'BS',   '1999-01-09'),
  ('Pokemon', 'EN', 'Jungle',                  'JU',   '1999-06-16'),
  ('Pokemon', 'EN', 'Fossil',                  'FO',   '1999-10-10'),
  ('Pokemon', 'EN', 'Team Rocket',             'TR',   '2000-04-24'),
  ('Pokemon', 'EN', 'Neo Genesis',             'N1',   '2000-12-16')
ON CONFLICT (brand, language, name) DO NOTHING;

-- Pokemon JP — modern Scarlet & Violet + key sets
INSERT INTO card_sets (brand, language, name, code, release_date) VALUES
  ('Pokemon', 'JP', 'Terastal Festival ex',    'SV8a', '2024-12-06'),
  ('Pokemon', 'JP', 'Super Electric Breaker',  'SV8',  '2024-10-18'),
  ('Pokemon', 'JP', 'Paradigm Trigger',        'S12',  '2022-10-21'),
  ('Pokemon', 'JP', 'V-STAR Universe',         'S12a', '2022-12-02'),
  ('Pokemon', 'JP', 'Mega Evolution Inferno X','ME01', '2025-01-24'),
  ('Pokemon', 'JP', 'Battle Partners',         'SV9',  '2025-01-24'),
  ('Pokemon', 'JP', 'Pokemon Card 151',        'SV2a', '2023-06-16'),
  ('Pokemon', 'JP', 'Snow Hazard',             'SV2P', '2023-04-14'),
  ('Pokemon', 'JP', 'Clay Burst',              'SV2D', '2023-04-14')
ON CONFLICT (brand, language, name) DO NOTHING;

-- Pokemon CN — limited modern releases
INSERT INTO card_sets (brand, language, name, code, release_date) VALUES
  ('Pokemon', 'CN', '151 Gathering',           NULL,   NULL),
  ('Pokemon', 'CN', 'Sword & Shield All Stars BRAVE', NULL, NULL),
  ('Pokemon', 'CN', 'Sword & Shield All Stars CHARMING', NULL, NULL)
ON CONFLICT (brand, language, name) DO NOTHING;

-- One Piece EN
INSERT INTO card_sets (brand, language, name, code, release_date) VALUES
  ('One Piece', 'EN', 'Romance Dawn',                          'OP-01', '2022-12-02'),
  ('One Piece', 'EN', 'Paramount War',                         'OP-02', '2023-03-10'),
  ('One Piece', 'EN', 'Pillars of Strength',                   'OP-03', '2023-06-30'),
  ('One Piece', 'EN', 'Kingdoms of Intrigue',                  'OP-04', '2023-09-08'),
  ('One Piece', 'EN', 'Awakening of the New Era',              'OP-05', '2023-12-08'),
  ('One Piece', 'EN', 'Wings of the Captain',                  'OP-06', '2024-03-08'),
  ('One Piece', 'EN', '500 Years in the Future',               'OP-07', '2024-06-28'),
  ('One Piece', 'EN', 'Two Legends',                           'OP-08', '2024-09-13'),
  ('One Piece', 'EN', 'Emperors in the New World',             'OP-09', '2024-12-13'),
  ('One Piece', 'EN', 'Royal Lineage',                         'OP-10', '2025-03-14'),
  ('One Piece', 'EN', 'A Fist of Divine Speed',                'OP-11', '2025-06-13')
ON CONFLICT (brand, language, name) DO NOTHING;

-- One Piece JP
INSERT INTO card_sets (brand, language, name, code, release_date) VALUES
  ('One Piece', 'JP', 'Pillars of Strength',                   'OP-03', '2023-02-25'),
  ('One Piece', 'JP', 'Emperors In The New World',             'OP-09', '2024-08-31'),
  ('One Piece', 'JP', 'Royal Lineage',                         'OP-10', '2024-11-30'),
  ('One Piece', 'JP', 'A Fist of Divine Speed',                'OP-11', '2025-02-22'),
  ('One Piece', 'JP', 'The Bond Of Master And Disciple',       'OP-12', '2025-05-31'),
  ('One Piece', 'JP', 'Carrying On His Will',                  'OP-13', '2025-08-30'),
  ('One Piece', 'JP', 'The Azure Seas Seven',                  'OP-14', '2025-11-29')
ON CONFLICT (brand, language, name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Verify (run separately, outside the transaction):
--   SELECT brand, language, count(*)
--     FROM card_sets
--    GROUP BY brand, language
--    ORDER BY brand, language;
--
-- Expected rough counts: Pokemon/EN ~23, Pokemon/JP ~9, Pokemon/CN ~3,
-- One Piece/EN ~11, One Piece/JP ~7.
-- ============================================================================
