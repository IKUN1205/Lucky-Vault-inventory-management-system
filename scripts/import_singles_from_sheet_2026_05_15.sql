-- ============================================================================
-- Singles inventory import from boss's Google Sheet — 2026-05-15
-- ============================================================================
-- Source: scripts/_singles_import_data_he.csv + _singles_import_data_new.csv
-- Total deduped rows: 464
-- Skipped: 3 (see stderr from the generator)
--
-- Pre-req: scripts/add_singles_tcg_id_column.sql must have run.
--
-- All cards imported as form=raw, condition=NM, brand=Pokemon, language=EN.
-- Quantity is the sum across both tabs of the source sheet.
-- Prices intentionally skipped per user request — "建立库存先".
--
-- Safety: wrapped in BEGIN/COMMIT. If anything errors mid-batch, the
-- whole import rolls back. Idempotent guard: ON CONFLICT (tcg_id) DO NOTHING
-- via the partial unique index — re-running this is a no-op.
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- A. Card sets — auto-create any set names referenced below
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO card_sets (brand, language, name) VALUES
  ('Pokemon', 'EN', '026/131 (Prismatic Evolutions Stamp) - Miscellaneous Cards & Products'),
  ('Pokemon', 'EN', '073 (Paldean Fates Stamped) - Miscellaneous Cards & Products'),
  ('Pokemon', 'EN', '1/100 (Prerelease) - Miscellaneous Cards & Products'),
  ('Pokemon', 'EN', '105/193 (GameStop Exclusive) - Miscellaneous Cards & Products'),
  ('Pokemon', 'EN', '133/132 (Mega Evolution Stamped) - Miscellaneous Cards & Products'),
  ('Pokemon', 'EN', '16/101 (Cosmos Holo) - Blister Exclusives'),
  ('Pokemon', 'EN', '54a/124 - Alternate Art Promos'),
  ('Pokemon', 'EN', '8/102 (Base Set Shadowless) - Deck Exclusives'),
  ('Pokemon', 'EN', 'Ancient Origins'),
  ('Pokemon', 'EN', 'Aquapolis'),
  ('Pokemon', 'EN', 'Ascended Heroes'),
  ('Pokemon', 'EN', 'Astral Radiance'),
  ('Pokemon', 'EN', 'Battle Styles'),
  ('Pokemon', 'EN', 'Black Bolt'),
  ('Pokemon', 'EN', 'Brilliant Stars'),
  ('Pokemon', 'EN', 'Burning Shadows'),
  ('Pokemon', 'EN', 'Celebrations'),
  ('Pokemon', 'EN', 'Chilling Reign'),
  ('Pokemon', 'EN', 'Classic Collection'),
  ('Pokemon', 'EN', 'Collection Moon'),
  ('Pokemon', 'EN', 'Crimson Invasion'),
  ('Pokemon', 'EN', 'Darkness Ablaze'),
  ('Pokemon', 'EN', 'Delta Species'),
  ('Pokemon', 'EN', 'Deoxys'),
  ('Pokemon', 'EN', 'Destined Rivals'),
  ('Pokemon', 'EN', 'Double Blaze'),
  ('Pokemon', 'EN', 'Evolutions'),
  ('Pokemon', 'EN', 'Evolving Skies'),
  ('Pokemon', 'EN', 'Fossil'),
  ('Pokemon', 'EN', 'Fusion Strike'),
  ('Pokemon', 'EN', 'Gym Challenge'),
  ('Pokemon', 'EN', 'HeartGold SoulSilver'),
  ('Pokemon', 'EN', 'Hidden Fates'),
  ('Pokemon', 'EN', 'Journey Together'),
  ('Pokemon', 'EN', 'Legend Maker'),
  ('Pokemon', 'EN', 'Legendary Treasures'),
  ('Pokemon', 'EN', 'Lost Origin'),
  ('Pokemon', 'EN', 'Mega Evolution'),
  ('Pokemon', 'EN', 'Mega Evolution Promo'),
  ('Pokemon', 'EN', 'Neo Genesis'),
  ('Pokemon', 'EN', 'Obsidian Flames'),
  ('Pokemon', 'EN', 'POP Series 2'),
  ('Pokemon', 'EN', 'Paldea Evolved'),
  ('Pokemon', 'EN', 'Paldean Fates'),
  ('Pokemon', 'EN', 'Paradox Rift'),
  ('Pokemon', 'EN', 'Perfect Order'),
  ('Pokemon', 'EN', 'Phantasmal Flames'),
  ('Pokemon', 'EN', 'Primal Clash'),
  ('Pokemon', 'EN', 'Prismatic Evolutions'),
  ('Pokemon', 'EN', 'Radiant Collection'),
  ('Pokemon', 'EN', 'Rebel Clash'),
  ('Pokemon', 'EN', 'SM - Burning Shadows'),
  ('Pokemon', 'EN', 'SM - Celestial Storm'),
  ('Pokemon', 'EN', 'SM - Cosmic Eclipse'),
  ('Pokemon', 'EN', 'SM - Crimson Invasion'),
  ('Pokemon', 'EN', 'SM - Forbidden Light'),
  ('Pokemon', 'EN', 'SM - Guardians Rising'),
  ('Pokemon', 'EN', 'SM - Lost Thunder'),
  ('Pokemon', 'EN', 'SM - Team Up'),
  ('Pokemon', 'EN', 'SM - Ultra Prism'),
  ('Pokemon', 'EN', 'SM - Unbroken Bonds'),
  ('Pokemon', 'EN', 'SM100 - SM Promos'),
  ('Pokemon', 'EN', 'SM101 - SM Promos'),
  ('Pokemon', 'EN', 'SM167 - SM Promos'),
  ('Pokemon', 'EN', 'SM187 - SM Promos'),
  ('Pokemon', 'EN', 'SM80 - SM Promos'),
  ('Pokemon', 'EN', 'Scarlet & Violet 151'),
  ('Pokemon', 'EN', 'Scarlet & Violet Base Set'),
  ('Pokemon', 'EN', 'Scarlet & Violet Promo Cards'),
  ('Pokemon', 'EN', 'Shiny Vault'),
  ('Pokemon', 'EN', 'Shrouded Fable'),
  ('Pokemon', 'EN', 'Silver Tempest'),
  ('Pokemon', 'EN', 'Skyridge'),
  ('Pokemon', 'EN', 'Southern Islands'),
  ('Pokemon', 'EN', 'Steam Siege'),
  ('Pokemon', 'EN', 'Stellar Crown'),
  ('Pokemon', 'EN', 'Surging Sparks'),
  ('Pokemon', 'EN', 'Sword & Shield Base Set'),
  ('Pokemon', 'EN', 'Sword & Shield Promo Cards'),
  ('Pokemon', 'EN', 'Team Up'),
  ('Pokemon', 'EN', 'Temporal Forces'),
  ('Pokemon', 'EN', 'Through the Ages'),
  ('Pokemon', 'EN', 'Twilight Masquerade'),
  ('Pokemon', 'EN', 'Ultra Moon'),
  ('Pokemon', 'EN', 'Unseen Forces'),
  ('Pokemon', 'EN', 'Unsorted / Promo'),
  ('Pokemon', 'EN', 'Vivid Voltage'),
  ('Pokemon', 'EN', 'White Flare'),
  ('Pokemon', 'EN', 'Wild Force'),
  ('Pokemon', 'EN', 'WoTC Promo'),
  ('Pokemon', 'EN', 'XY - BREAKpoint'),
  ('Pokemon', 'EN', 'XY - Evolutions'),
  ('Pokemon', 'EN', 'XY - Fates Collided'),
  ('Pokemon', 'EN', 'XY - Flashfire'),
  ('Pokemon', 'EN', 'XY - Primal Clash'),
  ('Pokemon', 'EN', 'XY Base Set'),
  ('Pokemon', 'EN', 'XY186 - XY Promos'),
  ('Pokemon', 'EN', 'XY67a - Alternate Art Promos'),
  ('Pokemon', 'EN', 'XY84 - XY Promos')
ON CONFLICT (brand, language, name) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- B. Singles rows — one per (deduped) tcg_id
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lugia EX (94 Full Art)',
  '94',
  'UR AOR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '101516', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ancient Origins'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Machamp',
  '8/102',
  'Holo Rare PR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '107004', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '8/102 (Base Set Shadowless) - Deck Exclusives'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu EX XY84 PR',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '108614', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY84 - XY Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scizor EX',
  '119/122',
  'FA BKP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '111564', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - BREAKpoint'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Umbreon EX',
  '119/124',
  'FA FCO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '117891', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Fates Collided'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pokemon Ranger',
  '113/114',
  'FA STS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '121237', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Steam Siege'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'M Blastoise EX',
  '22/108',
  'UR EVO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '124035', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'M Pidgeot EX',
  '65/108',
  'UR EVO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '124078', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pidgeot EX',
  '104/108',
  'FA EVO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '124117', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Surfing Pikachu',
  '111/108',
  'SR EVO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '124124', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Magearna XY186 TCG PR',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '127138', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY186 - XY Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Field Blower',
  '163/145',
  'Rainbow SM02',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '131059', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Guardians Rising'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zygarde EX',
  '54a/124',
  'PR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '131698', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '54a/124 - Alternate Art Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard GX',
  '20/147',
  'UR SM03',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '138496', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Burning Shadows'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Guzma',
  '143/147',
  'FA SM03',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '138610', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Burning Shadows'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Fire Energy',
  '167/147',
  'Rainbow SM03',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '138635', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Burning Shadows'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jirachi XY67a PR',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '148343', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY67a - Alternate Art Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ho-Oh GX SM80 SMP',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '148425', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM80 - SM Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Silvally GX',
  '90/111',
  'UR SM04',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '149115', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Crimson Invasion'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Water Energy',
  '124/111',
  'Rainbow SM04',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '149149', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Crimson Invasion'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Leafeon GX',
  '157/156',
  'Rainbow SM05',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '157773', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Ultra Prism'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lucario GX SM100 SMP',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '162042', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM100 - SM Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dawn Wings Necrozma GX SM101 SMP',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '162460', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM101 - SM Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Blastoise',
  '16/101',
  'Promo BLE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '165634', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '16/101 (Cosmos Holo) - Blister Exclusives'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  '73/131 SM06',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '165725', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bonnie',
  '128/131',
  'FA SM06',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '165766', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Forbidden Light'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Steven''s Resolve',
  '165/168',
  'FA CES',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '171017', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Celestial Storm'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Blacephalon GX',
  '52/214',
  'UR SM8',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '178857', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Lost Thunder'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Cobalion GX',
  '168/181',
  'FA SM9',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '183889', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Team Up'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Morgan',
  '178/181',
  'FA SM9',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '183948', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Team Up'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Celebi & Venusaur GX SM167 SMP',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '185984', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM167 - SM Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Alolan Marowak GX SM187 SMP',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '185987', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM187 - SM Promos'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Green''s Exploration',
  '209/214',
  'FA SM10',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '189278', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Unbroken Bonds'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard GX',
  '9/68',
  'UR HIF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '197651', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Hidden Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Reshiram GX - Hidden Fates: Shiny Vault (HIF:SV)',
  'SV51/SV94',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '197785', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kartana GX - Hidden Fates: Shiny Vault (HIF:SV)',
  'SV73/SV94',
  'HIF:SV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '197827', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Venusaur & Snivy GX',
  '1/236',
  'UR SM12',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '200350', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Cosmic Eclipse'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Vileplume GX',
  '4/236',
  'UR SM12',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '201139', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Cosmic Eclipse'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Torkoal',
  '237/236',
  'Rainbow SM12',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '201348', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Cosmic Eclipse'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gallade',
  '244/236',
  'Rainbow SM12',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '201355', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'SM - Cosmic Eclipse'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Galarian Perrserker',
  'SWSH008',
  'SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '208265', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lapras VMAX',
  '203/202',
  'Rainbow SS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '208365', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Morpeko VMAX',
  '204/202',
  'Rainbow SS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '208381', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Snorlax VMAX',
  '206/202',
  'Rainbow SS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '208459', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Toxtricity VMAX',
  '196/192',
  'Rainbow RCL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '213157', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Rebel Clash'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Boss''s Orders',
  '189/192',
  'FA RCL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '213256', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Rebel Clash'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Butterfree VMAX',
  '190/189',
  'Rainbow DAA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '219312', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Darkness Ablaze'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Salamence VMAX',
  '194/189',
  'Rainbow DAA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '219320', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Darkness Ablaze'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Raikou',
  '050/185',
  'AR VIV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '226445', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Vivid Voltage'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Nessa',
  '196/185',
  'Rainbow VIV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '226525', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Vivid Voltage'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jirachi',
  '119/185',
  'AR VIV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '226573', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Vivid Voltage'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Togekiss VMAX',
  '141/185',
  'UR VIV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '226598', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Vivid Voltage'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Inteleon',
  'SV027/SV122',
  'SHFSV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '232378', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shiny Vault'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Yamper',
  'SV039/SV122',
  'SHFSV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '232395', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shiny Vault'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dreepy',
  'SV060/SV122',
  'SHFSV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '232426', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shiny Vault'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Carkol',
  'SV068/SV122',
  'SHFSV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '232439', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shiny Vault'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rillaboom VMAX',
  'SV106/SV122',
  'SHFSV',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '232495', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shiny Vault'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rapid Strike Urshifu VMAX',
  '170/163',
  'Alt Art Secret BST',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '234093', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Battle Styles'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Celebi VMAX',
  '008/198',
  'UR CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241656', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Blaziken VMAX',
  '021/198',
  'UR CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241671', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ice Rider Calyrex V',
  '163/198',
  'FA CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241699', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ice Rider Calyrex VMAX',
  '202/198',
  'Rainbow CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241702', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Shadow Rider Calyrex V',
  '172/198',
  'Alt Art CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241737', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Galarian Zapdos V',
  '174/198',
  'Alt Art CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241747', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tornadus V',
  '185/198',
  'Alt Art CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241805', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Caitlin',
  '213/198',
  'Rainbow CRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '241822', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Chilling Reign'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lycanroc VMAX',
  '213/203',
  'Rainbow EVS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '246714', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Evolving Skies'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Glaceon V',
  '174/203',
  'FA EVS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '246746', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Evolving Skies'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Duraludon VMAX',
  '219/203',
  'Rainbow EVS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '246752', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Evolving Skies'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jolteon VMAX',
  '051/203',
  'UR EVS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '246760', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Evolving Skies'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Metal Energy',
  '237/203',
  'Rainbow EVS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '246812', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Evolving Skies'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Greninja Star',
  'SWSH144',
  '/ SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '248731', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu',
  '005/025',
  'Holo Rare CLB',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250303', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Celebrations'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mew',
  '011/025',
  'Holo Rare CLB',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 6, '250309', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Celebrations'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Blastoise',
  '2/102',
  'Classic Collection CCC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250319', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Classic Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Venusaur',
  '15/102',
  'Classic Collection CCC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250321', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Classic Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rocket''s Zapdos',
  '15/132',
  'Classic Collection CCC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250324', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Classic Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Claydol',
  '15/106',
  'Classic Collection CCC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250333', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Classic Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Garchomp C LV.X',
  '145/147',
  'Classic Collection CCC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250335', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Classic Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zekrom',
  '114/114',
  'Classic Collection CCC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250338', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Classic Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rayquaza V',
  'SWSH147',
  'SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '250577', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lance''s Charizard V',
  'SWSH133',
  'SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '251089', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu V',
  'SWSH145',
  'SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '251102', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Poke Ball',
  'SWSH146',
  'SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '251103', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Greedent V',
  '257/264',
  'Alt Art FST',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '253157', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Fusion Strike'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lumineon V',
  '156/172',
  'Alt Art BRS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '263875', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Brilliant Stars'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu V',
  '157/172',
  'FA BRS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '263876', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Brilliant Stars'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Galarian Moltres V',
  '183/172',
  'Rainbow BRS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '263903', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Brilliant Stars'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zekrom -',
  'SWSH09',
  ': Brilliant Stars Trainer Gallery (SWSH09:TG) TG05/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '264205', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sylveon VMAX -',
  'SWSH09',
  ': Brilliant Stars Trainer Gallery (SWSH09:TG) TG15/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '264208', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Eevee -',
  'SWSH09',
  ': Brilliant Stars Trainer Gallery (SWSH09:TG) TG11/TG30 SWSH09:TG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '264218', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Origin Forme Palkia VSTAR (Secret) (192)',
  '192',
  'SR ASR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '272446', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Astral Radiance'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Machamp VMAX',
  '194/189',
  'Rainbow ASR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '272448', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Astral Radiance'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Path to the Peak',
  '213/189',
  'Rainbow ASR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '272468', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Astral Radiance'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Flapple -',
  'SWSH10',
  ': Astral Radiance Trainer Gallery (SWSH10:TG) TG02/TG30 SWSH10:TG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '272473', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Falinks -',
  'SWSH10',
  ': Astral Radiance Trainer Gallery (SWSH10:TG) TG07/TG30 SWSH10:TG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '272478', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Shadow Rider Calyrex V -',
  'SWSH10',
  ': Astral Radiance Trainer Gallery (SWSH10:TG) TG17/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '272488', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Armaldo',
  '1/100',
  'Promo MCAP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '282797', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '1/100 (Prerelease) - Miscellaneous Cards & Products'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rotom V',
  '177/196',
  'Alt Art LOR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284119', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Lost Origin'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Galarian Perrserker V',
  '184/196',
  'Alt Art LOR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284135', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Lost Origin'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Giratina VSTAR (201)',
  '201',
  'Rainbow LOR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284156', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Lost Origin'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Hisuian Zoroark VSTAR',
  '203/196',
  'Rainbow LOR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284158', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Lost Origin'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gengar -',
  'SWSH11',
  ': Lost Origin Trainer Gallery (SWSH11: TG) TG06/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284266', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Banette -',
  'SWSH11',
  ': Lost Origin Trainer Gallery (SWSH11: TG) TG07/TG30 SWSH11: TG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284267', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Snorlax -',
  'SWSH11',
  ': Lost Origin Trainer Gallery (SWSH11: TG) TG10/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284270', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Enamorus V -',
  'SWSH11',
  ': Lost Origin Trainer Gallery (SWSH11: TG) TG18/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '284284', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lapras (10)',
  '10',
  'Holo Rare FO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '44419', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Fossil'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Moltres (12)',
  '12',
  'Holo Rare FO',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '44421', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Fossil'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lugia V',
  '138/195',
  'UR SIT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '450289', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Silver Tempest'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zeraora V -',
  'SWSH12',
  ': Silver Tempest Trainer Gallery (SWSH12: TG) TG16/TG30 SWSH12: TG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '451398', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lugia VSTAR (Secret) (211)',
  '211',
  'SR SIT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '452009', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Silver Tempest'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Flaaffy -',
  'SWSH12',
  ': Silver Tempest Trainer Gallery (SWSH12: TG) TG03/TG30 SWSH12: TG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '452017', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gardevoir -',
  'SWSH12',
  ': Silver Tempest Trainer Gallery (SWSH12: TG) TG05/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '452019', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rockruff -',
  'SWSH12',
  ': Silver Tempest Trainer Gallery (SWSH12: TG) TG07/TG30',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '452021', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Primeape',
  '18/18',
  'Promo SI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '46475', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Southern Islands'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bibarel - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG25/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '475643', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lapras - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG05/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '477049', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Thievul - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG17/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '477056', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Hoopa V - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG53/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '477181', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Magmortar - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG03/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '478020', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Electivire - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG08/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '478025', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Deoxys - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG12/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '478029', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Latias - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG20/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '478038', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dunsparce - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG23/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '478041', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Riolu - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG26/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '478045', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Turtwig - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG31/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '478059', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Poochyena - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG33/GG70',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '478062', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Simisear VSTAR - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG37/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '478066', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Melony - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG)',
  'GG64/GG70',
  'CRZ:GG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '478093', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu V',
  'SWSH285',
  'SWSD',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '478423', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Sword & Shield Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Miraidon ex',
  '244/198',
  'SIR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '485259', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dondozo',
  '207/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '487060', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Fidough',
  '213/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '487086', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Miraidon ex',
  '253/198',
  'HR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490043', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Armarouge',
  '203/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490063', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Clauncher',
  '205/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490066', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kirlia',
  '212/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490072', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Riolu',
  '215/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490074', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mabosstiff',
  '218/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '490076', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kingambit',
  '220/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '490078', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Skwovet',
  '222/198',
  'IR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '490080', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Arven',
  '235/198',
  'UR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490093', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Great Tusk ex',
  '246/198',
  'SIR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490290', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Arven',
  '249/198',
  'SIR SVI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490292', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Miraidon',
  '013',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '490719', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu ex',
  'SV02',
  'RR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497474', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tropius',
  '195/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497598', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Floragato',
  '197/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497600', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pyroar',
  '200/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497603', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Marill',
  '204/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497607', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sandygast',
  '214/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497617', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rabsca',
  '215/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497618', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sudowoodo',
  '219/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497622', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Flamigo',
  '227/193',
  'IR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497630', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Meowscarada ex',
  '256/193',
  'SIR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497675', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Chi-Yu ex',
  '259/193',
  'SIR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '497678', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Chien-Pao ex',
  '261/193',
  'SIR PAL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '497680', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldea Evolved'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tinkaton',
  '105/193',
  'Promo MCAP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '502625', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '105/193 (GameStop Exclusive) - Miscellaneous Cards & Products'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gloom',
  '198/197',
  'IR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509944', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Houndour',
  '204/197',
  'IR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509951', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scizor',
  '205/197',
  'IR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509952', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pidgey',
  '207/197',
  'IR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '509955', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pidgeotto',
  '208/197',
  'IR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509956', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lechonk',
  '209/197',
  'IR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509957', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard ex',
  '215/197',
  'UR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509963', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pidgeot ex',
  '225/197',
  'SIR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '509983', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Artazon',
  '229/197',
  'HR OBF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '509990', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Obsidian Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu',
  '173/165',
  'IR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '513721', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Caterpie',
  '172/165',
  'IR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517016', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Golem ex',
  '189/165',
  'UR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517021', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jynx ex',
  '191/165',
  'UR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517023', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kangaskhan ex',
  '190/165',
  'UR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517024', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mr. Mime',
  '179/165',
  'IR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517028', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Nidoking',
  '174/165',
  'Illustration Rare  MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '517029', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Omanyte',
  '180/165',
  'IR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517031', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Poliwhirl',
  '176/165',
  'IR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517034', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Wigglytuff ex',
  '187/165',
  'UR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517039', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Giovanni''s Charisma',
  '204/165',
  'SIR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '517050', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Basic Psychic Energy',
  '207/165',
  'HR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 4, '517053', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Erika''s Invitation',
  '196/165',
  'UR MEW',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '517176', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet 151'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mewtwo',
  '052',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '518872', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard ex',
  '056',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '521697', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Crustle',
  '183/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523864', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mantyke',
  '189/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523870', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Blitzle',
  '195/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523876', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Joltik',
  '196/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523877', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gimmighoul',
  '198/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523879', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Garbodor',
  '204/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523885', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Yveltal',
  '205/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523886', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Morpeko',
  '206/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523887', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Loudred',
  '212/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523893', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Swablu',
  '213/182',
  'IR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '523894', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Golisopod ex',
  '246/182',
  'SIR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523927', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tapu Koko ex',
  '247/182',
  'SIR PAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '523928', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paradox Rift'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Oddish',
  '092/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534459', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Vileplume',
  '094/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '534462', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scyther',
  '095/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534463', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charcadet',
  '114/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534496', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Armarouge',
  '115/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534497', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Baxcalibur',
  '130/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534521', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pikachu',
  '131/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534522', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Luxio',
  '136/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534529', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Abra',
  '148/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534631', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kadabra',
  '149/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534634', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Spiritomb',
  '158/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534680', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mimikyu -160/091',
  '160/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '534683', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Paldean Wooper',
  '180/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '535093', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Arven',
  '235/091',
  'SIR PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '535095', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iono',
  '237/091',
  'SIR PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '535101', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Nemona',
  '238/091',
  'SIR PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 4, '535104', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Penny',
  '239/091',
  'SIR PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '535108', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scizor',
  '191/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '535149', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pidgeotto',
  '197/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '535165', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jigglypuff',
  '198/091',
  'Shiny PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '535174', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Espathra ex',
  '214/091',
  'Shiny Ultra Rare PAF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '535303', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Paldean Fates'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard ex',
  '074',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '538687', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Shiftry',
  '163/162',
  'IR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542884', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sawsbuck',
  '166/162',
  'IR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542887', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Relicanth',
  '173/162',
  'IR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542894', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lickitung',
  '180/162',
  'IR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542901', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gengar ex',
  '193/162',
  'UR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542914', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Explorer''s Guidance',
  '200/162',
  'UR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542921', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iron Leaves ex',
  '203/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542924', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gouging Fire ex',
  '204/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542925', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Walking Wake ex',
  '205/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542926', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iron Boulder ex',
  '207/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542928', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Raging Bolt ex',
  '208/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542929', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bianca''s Devotion',
  '209/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542930', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Salvatore',
  '212/162',
  'SIR TEF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '542933', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Temporal Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Chimecho',
  '179/167',
  'IR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550223', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Hisuian Growlithe',
  '181/167',
  'IR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550225', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lairon',
  '184/167',
  'IR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550228', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Teal Mask Ogerpon ex',
  '190/167',
  'UR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550234', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iron Thorns ex',
  '196/167',
  'UR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550240', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sinistcha ex',
  '210/167',
  'SIR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550254', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Carmine',
  '217/167',
  'SIR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550261', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kieran',
  '218/167',
  'SIR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '550262', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lana''s Aid',
  '219/167',
  'SIR TWM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '550263', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Twilight Masquerade'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tapu Bulu',
  '065/064',
  'IR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560376', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Houndoom',
  '066/064',
  'IR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560377', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Horsea',
  '067/064',
  'IR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '560378', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dusknoir',
  '070/064',
  'IR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560381', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Okidogi',
  '074/064',
  'IR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560385', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Fraxure',
  '077/064',
  'IR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560388', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pecharunt ex',
  '085/064',
  'UR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560396', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Janine''s Secret Art',
  '088/064',
  'UR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560399', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Okidogi ex',
  '090/064',
  'SIR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560401', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Munkidori ex',
  '091/064',
  'SIR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560402', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Powerglass',
  '097/064',
  'HR SFA',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '560408', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Shrouded Fable'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Caterpie -',
  '172/165',
  '- SV2a: Pokemon Card 151 (SV2a) 172/165 Art Rare',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '566517', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Poliwhirl -',
  '176/165',
  '- SV2a: Pokemon Card 151 (SV2a) 176/165 Art Rare',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '566521', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tangela -',
  '178/165',
  '- SV2a: Pokemon Card 151 (SV2a) 178/165 Art Rare',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '566523', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mr. Mime -',
  '179/165',
  '- SV2a: Pokemon Card 151 (SV2a) 179/165 Art Rare',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '566524', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Omanyte -',
  '180/165',
  '- SV2a: Pokemon Card 151 (SV2a) 180/165 Art Rare',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '566525', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lileep',
  '145/142',
  'IR SCR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '567421', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Stellar Crown'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Raboot',
  '147/142',
  'IR SCR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '567427', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Stellar Crown'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Meditite',
  '153/142',
  'IR SCR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '567436', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Stellar Crown'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lapras ex',
  '158/142',
  'UR SCR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '567448', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Stellar Crown'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Crispin',
  '164/142',
  'UR SCR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '567465', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Stellar Crown'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Galvantula ex',
  '168/142',
  'SIR SCR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '567474', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Stellar Crown'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gastly',
  '080/071',
  'Art Rare SV5K',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '568414', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Wild Force'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Suicune V -',
  '215/172',
  '- S12a: VSTAR Universe (S12a) 215/172 SAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '571753', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Glaceon GX',
  '067/066',
  'Super Rare SM5M',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '572321', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ultra Moon'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Umbreon GX',
  '063/060',
  'Super Rare SM1M',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '573205', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Collection Moon'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Persian GX',
  '104/095',
  'Super Rare SM10',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '573702', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Double Blaze'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Snorlax -',
  '181/165',
  '- SV2a: Pokemon Card 151 (SV2a) 181/165 Art Rare',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '577145', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Alolan Dugtrio',
  '208/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589857', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Appletun',
  '211/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589865', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Archaludon ex',
  '224/191',
  'UR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589868', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Archaludon ex',
  '241/191',
  'SIR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589869', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Braviary',
  '214/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589879', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ceruledge',
  '197/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589891', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Drayton',
  '244/191',
  'SIR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589925', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Exeggcute',
  '192/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589941', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jasmine''s Gaze',
  '245/191',
  'SIR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589973', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Latios',
  '203/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '589987', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lisia''s Appeal',
  '246/191',
  'SIR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '589990', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mesprit',
  '204/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '590003', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Skarmory',
  '209/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '590052', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Spheal',
  '199/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '590063', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Vibrava',
  '206/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '590086', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Vivillon',
  '193/191',
  'IR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '590090', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Alolan Exeggutor ex',
  '248/191',
  'HR SSP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '593855', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Surging Sparks'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Magneton',
  '159',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '594386', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Eevee ex',
  '075/131',
  'RR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610430', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Amarys',
  '132/131',
  'UR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610487', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ortega',
  '141/131',
  'UR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610496', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Tyme',
  '143/131',
  'UR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610498', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Teal Mask Ogerpon ex',
  '145/131',
  'SIR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610500', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sandy Shocks ex',
  '159/131',
  'SIR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '610514', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Umbreon ex',
  '161/131',
  'SIR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610516', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Amarys',
  '170/131',
  'SIR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610525', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Janine''s Secret Art',
  '173/131',
  'SIR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '610528', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Teal Mask Ogerpon ex',
  '177/131',
  'HR PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610532', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Exeggcute (Master Ball Pattern)',
  '001/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610637', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Exeggutor (Master Ball Pattern)',
  '002/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610638', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Whimsicott (Master Ball Pattern)',
  '008/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610643', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Slowking (Master Ball Pattern)',
  '019/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610650', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Aromatisse (Master Ball Pattern)',
  '039/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '610663', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scream Tail (Master Ball Pattern)',
  '042/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610665', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iron Boulder (Master Ball Pattern)',
  '046/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610669', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bronzor (Master Ball Pattern)',
  '066/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610684', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Duraludon (Master Ball Pattern)',
  '069/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '610687', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Noctowl (Master Ball Pattern)',
  '078/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610693', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dudunsparce (Master Ball Pattern)',
  '080/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610695', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Noibat (Master Ball Pattern)',
  '090/131',
  'PRE',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '610704', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Prismatic Evolutions'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Eevee',
  '173',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '610757', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Piplup M -',
  '007/022',
  '- Movie Commemoration Random Pack 007/022 None',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '613760', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Totodile M -',
  '006/022',
  '- Movie Commemoration Random Pack 006/022 None',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '613765', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dragonite (Pokemon TCG Game Boy Game) - Unnumbered Promotional cards / None',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '617417', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Glaceon ex',
  '026/131',
  'Promo MCAP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '618108', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '026/131 (Prismatic Evolutions Stamp) - Miscellaneous Cards & Products'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dragon of Mount Gulg 12/ FCA',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '618887', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Through the Ages'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Wailord',
  '162/159',
  'IR JTG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '623589', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Journey Together'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lillie''s Clefairy ex',
  '184/159',
  'SIR JTG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '623611', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Journey Together'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Hop''s Zacian ex',
  '186/159',
  'SIR JTG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '623613', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Journey Together'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'N''s Zoroark ex',
  '189/159',
  'HR JTG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '623616', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Journey Together'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Spiky Energy',
  '190/159',
  'HR JTG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '623617', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Journey Together'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Spidops',
  '187/182',
  'IR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '632987', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rapidash',
  '189/182',
  'IR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '632989', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ethan''s Typhlosion',
  '190/182',
  'IR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '632990', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Blaziken',
  '192/182',
  'IR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '632992', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Meowth',
  '203/182',
  'IR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '633003', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Mewtwo ex',
  '213/182',
  'UR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '633013', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Yanmega ex',
  '228/182',
  'SIR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '633028', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Ariana',
  '237/182',
  'SIR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 5, '633037', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Giovanni',
  '238/182',
  'SIR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '633038', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Cynthia''s Garchomp ex',
  '241/182',
  'SIR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '633041', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Crobat ex',
  '242/182',
  'HR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '633042', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jamming Tower',
  'SV10',
  'HR DRI',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '633043', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Destined Rivals'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Wobbuffet 203/ SVP',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '635467', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Leavanny',
  '089/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642204', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Cottonee',
  '090/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642205', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pignite',
  '097/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642212', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Emboar',
  '098/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642213', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dewott',
  '106/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642218', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Basculin',
  '108/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642220', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Vanillite',
  '111/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642223', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Vanillish',
  '112/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642224', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zebstrika',
  '115/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642227', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Yamask',
  '122/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642234', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Cofagrigus',
  '123/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642235', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gigalith',
  '129/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642242', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Archen',
  '131/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642244', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mienshao',
  '134/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642247', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Terrakion',
  '135/086',
  'TCG WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642248', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scraggy',
  '138/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642251', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zweilous',
  '147/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642258', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Ferrothorn',
  '149/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642260', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Hilda',
  '164/086',
  'UR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '642281', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Jellicent ex',
  '168/086',
  'SIR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642285', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Hilda',
  '171/086',
  'SIR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642288', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Simisage',
  '090/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '642539', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Foongus',
  '095/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642544', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Amoonguss',
  '096/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642545', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Darumaka',
  '097/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642547', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lampent',
  '102/086',
  'IR WHT',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '642550', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'White Flare'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Larvesta',
  '099/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 6, '642552', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Simipour',
  '102/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642555', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Palpitoad',
  '104/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642557', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Carracosta',
  '107/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642560', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Cubchoo',
  '109/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642562', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Cryogonal',
  '111/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642564', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Eelektrik',
  '114/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642567', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Eelektross',
  '115/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642568', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Elgyem',
  '120/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642575', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Throh',
  '128/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642583', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scolipede',
  '134/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642589', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sandile',
  '135/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642590', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Pawniard',
  '142/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642596', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bisharp',
  '143/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642597', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Fraxure',
  '146/086',
  'IR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '642600', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Meloetta ex',
  '167/086',
  'SIR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642619', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'N''s Plan',
  '170/086',
  'SIR BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '642622', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Reuniclus (Poke Ball Pattern)',
  '039/086',
  'BLK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '642735', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Black Bolt'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Victini',
  '208',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '646169', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Acerola''s Mischief -',
  '090/063',
  '- m1S: Mega Symphonia (m1S) 090/063 SAR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '647237', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gothitelle',
  '211',
  'SVP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '647306', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Scarlet & Violet Promo Cards'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Exeggutor',
  '135/132',
  'IR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654474', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Snover',
  '140/132',
  'IR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654479', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Marshadow',
  '146/132',
  'IR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654485', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Spiritomb',
  '148/132',
  'IR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654487', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Lucario ex',
  '160/132',
  'UR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654499', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Venusaur ex',
  '177/132',
  'SIR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654516', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Acerola''s Mischief',
  '183/132',
  'SIR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 4, '654522', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Lt. Surge''s Bargain',
  '185/132',
  'SIR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '654524', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Wally''s Compassion',
  '186/132',
  'SIR MEG',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 3, '654525', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bulbasaur',
  '133/132',
  'IR MCAP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '654703', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '133/132 (Mega Evolution Stamped) - Miscellaneous Cards & Products'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Riolu',
  '010',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '656260', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Meloetta',
  '026',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '659231', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Charizard X ex',
  '023',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '659612', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dawn',
  '118/094',
  'UR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '662149', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dawn',
  '129/094',
  'SIR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 4, '662150', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dewgong',
  '097/094',
  'IR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '662152', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Lopunny ex',
  '128/094',
  'SIR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '662190', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Sharpedo ex',
  '127/094',
  'SIR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '662193', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Rotom ex',
  '126/094',
  'SIR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '662222', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Sacred Charm',
  '122/094',
  'UR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '662224', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Togedemaru',
  '104/094',
  'IR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '662233', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Zacian',
  '100/094',
  'IR PFL',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '662245', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Phantasmal Flames'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Oricorio ex',
  '024',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '664010', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Eelektross ex -',
  '225/193',
  '- M2a: High Class Pack: MEGA Dream ex (M2a) 225/193 Mega Attack Rare M2A',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '665897', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unsorted / Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iron Treads ex',
  '073',
  'MCAP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '666603', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = '073 (Paldean Fates Stamped) - Miscellaneous Cards & Products'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Erika''s Tangela',
  '218/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676030', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Dustox',
  '220/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676032', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Scorbunny',
  '225/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676037', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Weavile',
  '228/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676040', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iono''s Wattrel',
  '231/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676043', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Marill',
  '232/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676044', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Misdreavus',
  '233/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676045', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Togekiss',
  '235/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676047', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Mimikyu',
  '238/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676050', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Team Rocket''s Dugtrio',
  '239/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676051', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Carbink',
  '242/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676054', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Galarian Obstagoon',
  '245/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676057', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mawile',
  '246/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676058', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Drakloak',
  '248/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676060', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Larry''s Staraptor',
  '249/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676061', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Fan Rotom',
  '250/217',
  'IR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676062', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Audino ex',
  '253/217',
  'UR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676065', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Black Belt''s Training',
  '255/217',
  'UR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676067', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Canari',
  '257/217',
  'UR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676069', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Froslass ex',
  '265/217',
  'Mega Attack Rare ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676077', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Diancie ex',
  '267/217',
  'Mega Attack Rare ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676079', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Hawlucha ex',
  '268/217',
  'Mega Attack Rare ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676080', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Scrafty ex',
  '270/217',
  'Mega Attack Rare ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676082', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Emboar ex',
  '273/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676085', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iono''s Bellibolt ex',
  '279/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676091', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Scrafty ex',
  '285/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 4, '676097', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Fezandipiti ex',
  '288/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676100', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Canari',
  '291/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '676103', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Iris''s Fighting Spirit',
  '292/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 2, '676104', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Surfer',
  '293/217',
  'SIR ASC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 4, '676105', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Ascended Heroes'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'N''s Zekrom',
  '031',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '680480', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'N''s Zekrom',
  '031',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '680481', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Poke Pad',
  '113/088',
  'UR POR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684333', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Perfect Order'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Zygarde ex',
  '104/088',
  'UR POR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684337', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Perfect Order'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Mega Zygarde ex',
  '120/088',
  'SIR POR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684338', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Perfect Order'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Meowth ex',
  '107/088',
  'UR POR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684341', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Perfect Order'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Bulbasaur',
  '037',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684461', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charmander',
  '038',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684462', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Squirtle',
  '039',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684463', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Turtwig',
  '040',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '684464', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Doublade',
  '067',
  'MEP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '685497', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Mega Evolution Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Azumarill',
  '002/111',
  'Holo Rare N1',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '83678', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Neo Genesis'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Entei',
  '34/53',
  'Promo PR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '85270', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'WoTC Promo'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Erika''s Kindness',
  '103/132',
  'G2',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '85299', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Gym Challenge'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Girafarig',
  '058/144',
  'SK',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '85727', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Skyridge'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Golduck (50a) 50a AQ',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '85813', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Aquapolis'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'M Blastoise EX',
  '30/146',
  'UR XY',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '86954', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY Base Set'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Manectric ex',
  '101/107',
  'UR DX',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '87167', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Deoxys'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Quagsire',
  '030/147',
  'AQ',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '88467', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Aquapolis'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Raichu',
  '10/123',
  'Holo Rare HS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '88517', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'HeartGold SoulSilver'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Raikou',
  '2',
  'POP',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '88533', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'POP Series 2'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Reshiram (114 Full Art Secret Rare)',
  '114',
  'SR LTR',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '88711', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Legendary Treasures'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Reshiram RC22/RC25 FA LTR',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '88712', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Radiant Collection'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Unown (D) D/28 UF',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '90171', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unseen Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Unown (F) F/28 UF',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '90173', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unseen Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Unown (M) M/28 UF',
  '',
  NULL,
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '90180', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Unseen Forces'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Victreebel',
  '13/92',
  'Holo Rare LM',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '90363', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Legend Maker'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Weedle',
  '87/113',
  'DS',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '90543', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Delta Species'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard EX (12)',
  '12',
  'UR FLF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '91145', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Flashfire'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Charizard EX (100 Full Art)',
  '100',
  'UR FLF',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '91238', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Flashfire'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Kingdra (Alpha)',
  '108/160',
  'Holo Rare PRC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '96006', 'in_inventory', '2026-05-12'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'XY - Primal Clash'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

INSERT INTO singles (
  card_name, card_number, variant, set_id, brand, language,
  form, condition, quantity, tcg_id, status, date_acquired
) SELECT
  'Gardevoir EX (155 Full Art)',
  '155',
  'UR PRC',
  cs.id, 'Pokemon', 'EN',
  'raw', 'NM', 1, '96053', 'in_inventory', '2026-05-13'
FROM card_sets cs
WHERE cs.brand = 'Pokemon' AND cs.language = 'EN' AND cs.name = 'Primal Clash'
ON CONFLICT (tcg_id) WHERE deleted = false AND tcg_id IS NOT NULL DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- Verify before committing:
--   SELECT count(*) AS imported FROM singles WHERE form='raw' AND tcg_id IS NOT NULL;
--   -- expect ~464
--   SELECT count(*) AS sets_used FROM card_sets WHERE brand='Pokemon' AND language='EN';
-- ───────────────────────────────────────────────────────────────────────────

COMMIT;
-- ROLLBACK;     -- ← if numbers look wrong, run this instead of leaving COMMIT