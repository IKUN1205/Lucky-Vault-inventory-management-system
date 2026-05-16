-- ============================================================================
-- Slabs import from boss's Google Sheet AZ CAC INV tab — 2026-05-15
-- ============================================================================
-- Source: scripts/_slabs_import_data.csv
-- Deduped slabs to insert: 158
--   IN_INVENTORY: 135
--   LISTED:       21
--   SOLD:         2
-- Skipped rows: 3 (see stderr from the generator)
--
-- Pre-req: scripts/create_slabs_table.sql must have run.
-- Per user directive: only A/B/C/L cols imported. Prices/Notes intentionally skipped.
-- Re-run safe via ON CONFLICT DO NOTHING on the partial cert_number UNIQUE index.
-- ============================================================================

BEGIN;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143582041', 'CGC', 'CGC Pristine 10 Mega Greninja ex #114 Special Art Rare POP 80 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, sale_date)
VALUES (
  '6092255029', 'CGC', 'CGC Pristine 10 Team Rocket''s Mewtwo ex #125 Special Art Rare POP 199 Japanese',
  'sold', CURRENT_DATE
  , '2026-04-28'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092217121', 'CGC', 'CGC Pristine 10 Team Rocket''s Moltres ex #229 Special Illustration Rare POP 73',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092260298', 'CGC', 'CGC Pristine 10 Prismatic Evolutions Sylveon ex #041 Surprise Box POP 114',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6060288032', 'CGC', 'CGC Pristine 10 Plasma Gale Lugia EX #059 1st Edition Holo POP 1 Japanese',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092242144', 'CGC', 'CGC Pristine 10 Chilling Reign Galarian Slowking V #179 Ultra Rare POP 66',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6060405037', 'CGC', 'CGC 7.5 EX Legend Maker Regirock ☆ #91 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6077540042', 'CGC', 'CGC Pristine 10 Legendary Shine Regigigas #023 1st Edition Holo POP 12 Japanese',
  'listed', CURRENT_DATE
  , '2026-04-25'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092236095', 'CGC', 'CGC Pristine 10 Black Bolt Zekrom ex #169 Special Art Rare Japanese',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6074608048', 'CGC', 'CGC Pristine 10 Mega Symphonia Mega Gardevoir ex #087 Special Art Rare Japanese',
  'listed', CURRENT_DATE
  , '2026-04-28'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6060288006', 'CGC', 'CGC Pristine 10 Spiral Force Latios EX #054 1st Edition SR POP 2 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6037430002', 'CGC', 'CGC 9 Groudon ex #008 1st Edition Cracked Ice Holo Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092260269', 'CGC', 'CGC Pristine 10 Prismatic Evolutions Umbreon ex #060 Surprise Box POP 194',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092217235', 'CGC', 'CGC 9 Skyridge Raikou #H26 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092236092', 'CGC', 'CGC Pristine 10 Black Bolt N''s Plan #173 Special Art Rare POP 144 Japanese',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092238236', 'CGC', 'CGC Pristine 10 Twilight Masquerade Tatsugiri #186 Illustration Rare POP 60',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092220069', 'CGC', 'CGC Pristine 10 Destined Rivals Rapidash #189 Illustration Rare POP 31',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '1401019886065', 'CGC', 'CGC 9.5 Neo Destiny Shining Steelix #112 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6060434101', 'CGC', 'CGC Gem Mint 10 Charizard ex #234 Special Illustration Rare POP 165',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6060434037', 'CGC', 'CGC 9 CD Promo Venusaur Holo Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092240233', 'CGC', 'CGC 9 Aquapolis Octillery #H20 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6085705051', 'CGC', 'CGC Pristine 10 VMAX Climax Eevee #210 Character Rare Holo POP 44 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6019889015', 'CGC', 'CGC Gem Mint 10 VMAX Climax Sylveon V #231 Character Super Rare Holo Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092247093', 'CGC', 'CGC 9 Awakening Legends Raikou Holo Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6059444131', 'CGC', 'CGC Gem Mint 10 Celebrations Classic Coll Venusaur #15 Base Set Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6060285026', 'CGC', 'CGC Gem Mint 10 Reviving Legends Scizor #048 1st Edition Holo POP 20 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6017963122', 'CGC', 'CGC Pristine 10 Wind from the Sea Kingdra #089 Holo POP 1 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584009', 'CGC', 'CGC Pristine 10 Mega Charizard X ex #223 Mega Attack Rare Holo POP 3 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6060285020', 'CGC', 'CGC Pristine 10 Scizor #037 McDonald''s Promotion POP 1 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092240093', 'CGC', 'CGC 9 Triumphant Magnezone #96 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584020', 'CGC', 'CGC Pristine 10 Terastal Fest ex Eevee ex #223 Special Art Rare POP 1 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584034', 'CGC', 'CGC Pristine 10 Iris''s Fighting Spirit #247 Special Art Rare POP 175 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584124', 'CGC', 'CGC Pristine 10 Violet ex Slowpoke #082 Art Rare Holo POP 32 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092240235', 'CGC', 'CGC 8 EX Team Rocket Returns Dark Octillery #8 Reverse Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584098', 'CGC', 'CGC Pristine 10 Mega Gengar ex #230 Mega Attack Rare Holo POP 4 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092232014', 'CGC', 'CGC Pristine 10 Magneton #159 Surging Sparks Pokémon Center ETB POP 92',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584128', 'CGC', 'CGC Pristine 10 Mega Dream ex N''s Zekrom #210 Art Rare Holo POP 2 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6143584022', 'CGC', 'CGC Pristine 10 Steven''s Metagross ex #245 Special Art Rare Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6026288122', 'CGC', 'CGC Pristine 10 Starmie V #083 Character Super Rare Holo POP 87 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092232101', 'CGC', 'CGC Pristine 10 Cynthia''s Garchomp ex #087 Special Art Rare Japanese',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, sale_date)
VALUES (
  '6092259037', 'CGC', 'CGC Pristine 10 Crown Zenith Suicune V #GG38 Galarian Gallery',
  'sold', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6060288002', 'CGC', 'CGC Pristine 10 Shining Darkness Blastoise Holo POP 3 Japanese',
  'listed', CURRENT_DATE
  , '2026-04-25'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092213229', 'CGC', 'CGC Pristine 10 Surging Sparks Milotic ex #237 Special Illustration Rare POP 60',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6060344007', 'CGC', 'CGC Pristine 10 Scarlet & Violet 151 Psyduck #175 Illustration Rare POP 56',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6017639002', 'CGC', 'CGC Pristine 10 Super Electric Breaker Pikachu ex #132 Special Art Rare Japanese',
  'listed', CURRENT_DATE
  , '2026-04-28'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092232015', 'CGC', 'CGC Pristine 10 Charizard ex #234 Special Illustration Rare POP 165',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092220078', 'CGC', 'CGC 9 EX Unseen Forces Suicune ☆ #115 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6077540037', 'CGC', 'CGC Gem Mint 10 Sylveon ex #156 Special Illustration Rare POP 197',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6060434109', 'CGC', 'CGC Gem Mint 10 Lost Origin Giratina V #186 Ultra Rare',
  'listed', CURRENT_DATE
  , '2026-04-28'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092259285', 'CGC', 'CGC Pristine 10 Stellar Crown Dachsbun ex #169 Special Illustration Rare POP 17',
  'listed', CURRENT_DATE
  , '2026-05-05'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6092240087', 'CGC', 'CGC Gym Heroes Sabrina''s Gengar #14 Holo',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '6028398291', 'CGC', 'CGC Pristine 10 VSTAR Universe Pikachu #205 Art Rare Holo POP 167 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6060344035', 'CGC', 'CGC Pristine 10 Scarlet & Violet 151 Caterpie #172 Illustration Rare POP 35',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '6092217122', 'CGC', 'CGC Pristine 10 Black Bolt Serperior ex #164 Special Illustration Rare POP 34',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '60361673', 'PSA', 'PSA 10 Sun & Moon Celestial Storm Blaziken 28 POP 165',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '148893280', 'PSA', 'PSA 10 Nullifying Zero mega Clefable SAR 112 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '107307725', 'PSA', 'PSA 10 Ssp En-surging Sparks Mesprit IR 204',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '75829740', 'PSA', 'PSA 9 Neo Genesis 1st Edition Lugia 1st Ed 9',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '92908008', 'PSA', 'PSA 10 Promo Bulbasaur 051 POP 70 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152422276', 'PSA', 'PSA 10 Shiny Treasure EX Mew SAR 347 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112072663', 'PSA', 'PSA 10 Svp En-sv Black Star Promo Magneton 159',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '110436353', 'PSA', 'PSA 10 Obf En-obsidian Flames Cleffa IR 202',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112925717', 'PSA', 'PSA 9 Svp En-sv Black Star Promo Mew 053',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '95041075', 'PSA', 'PSA 10 Par En-paradox Rift Altaria SIR 253',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112500230', 'PSA', 'PSA 10 Jtg En-journey Together Salamence SIR 187',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '130892087', 'PSA', 'PSA 10 Ssp En-surging Sparks Milotic SIR 237',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '99444080', 'PSA', 'PSA 10 Sfa En-shrouded Fable Persian IR 078',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '67910208', 'PSA', 'PSA 9 Advent Of Arceus Charizard 017 POP 56 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112906183', 'PSA', 'PSA 10 Obf En-obsidian Flames Cleffa IR 202',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '109312424', 'PSA', 'PSA 10 Terastal Fest EX Dragapult SAR 221 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153792669', 'PSA', 'PSA 9 Dri En-destined Rivals Rocket''s SIR 231',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '138762219', 'PSA', 'PSA 10 Sfa En-shrouded Fable Dusknoir IR 070',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '138762218', 'PSA', 'PSA 10 Sfa En-shrouded Fable Dusclops IR 069',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595237', 'PSA', 'PSA 10 Inferno X mega Charizard SAR 110 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '140432586', 'PSA', 'PSA 10 Mega Dream EX Iono''s SAR 236 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '137286240', 'PSA', 'PSA 10 The Town On No Map Togetic 1st Ed 062 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '122332890', 'PSA', 'PSA 9 Gym Heroes Blaine''s 1',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '65162057', 'PSA', 'PSA 9 Cry From The Mysterious Rayquaza 1st Ed 442 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '119456965', 'PSA', 'PSA 9 Tag Team GX All Stars Blue''s 193 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '67910206', 'PSA', 'PSA 9 Shining Darkness Charizard 006 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '103574871', 'PSA', 'PSA 9 Xy Steam Siege Gardevoir 116',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '118307338', 'PSA', 'PSA 10 Sword & Shield Fusion Strike Genesect 255',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '113918149', 'PSA', 'PSA 10 Sv-p Promo Iono''s 232 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '66547154', 'PSA', 'PSA 10 Sword & Shield Chilling Reign Blaziken 201',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '140432572', 'PSA', 'PSA 10 Mega Dream EX Iris''s SAR 247 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '117582007', 'PSA', 'PSA 10 Sword And Shield Crown Zenith Manaphy GG06',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112906161', 'PSA', 'PSA 10 Swsh Black Star Promo Galarian 284',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112906160', 'PSA', 'PSA 10 Swsh Black Star Promo Galarian 284',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '111923179', 'PSA', 'PSA 9 Scr En-stellar Crown Bulbasaur IR 143',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '78985420', 'PSA', 'PSA 9 Fossil Hitmonlee 1st Ed 7',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '141573148', 'PSA', 'PSA 10 Mega Dream EX N''s SAR 242 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '133595007', 'PSA', 'Promo Giovanni''s 277 POP 3 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '128946424', 'PSA', 'PSA 10 S Promo Lugia 325 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '126652455', 'PSA', 'PSA 10 Blk En-black Bolt Kyurem SIR 165',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '134922417', 'PSA', 'PSA 10 Pre En-prismatic Evolutions Flareon SIR 146',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '99444089', 'PSA', 'PSA 10 Swsh Black Star Promo Rayquaza 029',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '130084073', 'PSA', 'PSA 10 Time Gazer Machamp 073 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '139409801', 'PSA', 'PSA 9 Charizard Half Deck Charizard 1st Ed 002 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153930630', 'PSA', 'PSA 10 Sun & Moon Celestial Storm Rayquaza 177a',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '146619948', 'PSA', 'PSA 10 Sun & Moon Hidden Fates Umbreon SV69',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '142245458', 'PSA', 'PSA 10 Nami OP08-106 Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '97815155', 'PSA', 'PSA 10 Call Of Legends Lightning 91 POP 70',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '55630352', 'PSA', 'PSA 10 Vs Karen''s 1st Ed 092 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '44180331', 'PSA', 'PSA 9 EX Delta Species Kyogre 112',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '57551964', 'PSA', 'PSA 10 Sm Promo Chry.blsm.afr.pikachu 211 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '130084072', 'PSA', 'PSA 9 Remix Bout Blasts. 070 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '79450996', 'PSA', 'PSA 10 Platinum Supreme Victors Empoleon 27 POP 165',
  'listed', CURRENT_DATE
  , '2026-05-05'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '49884954', 'PSA', 'PSA 10 Promo Beautifly 005 POP 5 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '40745061', 'PSA', 'PSA 10 Call Of Legends Bayleef 40 POP 8',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '42467479', 'PSA', 'PSA 10 Promo Cosplay 99 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '127074022', 'PSA', 'PSA 10 EX Hidden Legends Groudon 93 POP 134',
  'listed', CURRENT_DATE
  , '2026-04-27'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '146808193', 'PSA', 'PSA 10 Black Bolt Snivy 087 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '112500227', 'PSA', 'PSA 10 Jtg En-journey Together Volcanion SIR 182',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152506399', 'PSA', 'PSA 10 Pfl En-phantasmal Flames Piplup IR 098',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '106518128', 'PSA', 'PSA 10 Ssp En-surging Sparks Hydreigon SIR 240',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '119739518', 'PSA', 'PSA 10 Svp En-sv Black Star Promo Snorlax 051',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '133418403', 'PSA', 'PSA 10 Xy Steam Siege M 109',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '26348302', 'PSA', 'PSA 10 Undone Seal Wigglytuff 058 POP 33 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '113220787', 'PSA', 'PSA 9 Movie Commemoration Vs Pack Sky Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152422275', 'PSA', 'PSA 10 Mega Dream EX mega Dragonite SAR 246 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '137037013', 'PSA', 'PSA 10 Sword & Shield Astral Radiance Orgn.frm.palkia 167',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '137037012', 'PSA', 'PSA 10 Sword & Shield Astral Radiance Orgn.frm.dialga 177',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152506395', 'PSA', 'PSA 10 Mega Dream EX Canari SAR 248 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152506393', 'PSA', 'PSA 10 Mega Dream EX mega Scrafty SAR 241 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152506398', 'PSA', 'PSA 10 Mega Dream EX mega Eelektross SAR 235 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '152506400', 'PSA', 'PSA 10 Pfl En-phantasmal Flames Meowth IR 106',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '130287695', 'PSA', 'PSA 10 Sword & Shield Evolving Skies Glaceon 209',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '127279926', 'PSA', 'PSA 9 Miracle Twins M.sbleye 102 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '102081453', 'PSA', 'PSA 10 Sword And Shield Crown Zenith Suicune GG38',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884088', 'PSA', 'PSA 10 Enel OP05-100 Special Alternate ART Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884104', 'PSA', 'PSA 10 Shirahoshi OP11-057 Special Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884103', 'PSA', 'PSA 10 Two OP11-080 Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884102', 'PSA', 'PSA 10 Guild PRB02-057 Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884090', 'PSA', 'PSA 10 Robin OP09-107 Alternate ART Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '154165889', 'PSA', 'PSA 10 Reiju EB03-031 Special Alternate ART POP 98',
  'listed', CURRENT_DATE
  , '2026-04-22'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired, listed_at)
VALUES (
  '151349354', 'PSA', 'PSA 10 Luffy OP13-119 Special Alternate ART Japanese',
  'listed', CURRENT_DATE
  , '2026-04-22'::date
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884113', 'PSA', 'PSA 10 Sanji OP12-070 Alternate ART POP 133',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884095', 'PSA', 'PSA 10 Luffy #014 ONE PIECE MAGAZINE VOL.20 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884094', 'PSA', 'PSA 10 Luffy #014 ONE PIECE MAGAZINE VOL.20 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884097', 'PSA', 'PSA 10 Luffy OP13-001 Alternate ART Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884096', 'PSA', 'PSA 10 Game OP12-037 Alternate ART Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884101', 'PSA', 'PSA 10 Luffy OP13-118 Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884100', 'PSA', 'PSA 10 Rayleigh OP11-005 Special Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '147884099', 'PSA', 'PSA 10 Roger OP13-118 Wanted Alternate ART',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595249', 'PSA', 'PSA 10 Sv-p Promo Espeon 066 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595243', 'PSA', 'PSA 10 Inferno X mega Charizard SAR 110 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595250', 'PSA', 'PSA 10 Sv-p Promo Jolteon 064 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595251', 'PSA', 'PSA 10 Sv-p Promo Leafeon 068 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595259', 'PSA', 'PSA 10 Terastal Fest EX Leafeon SAR 200 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595254', 'PSA', 'PSA 10 VMAX Climax Pikachu 222 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595255', 'PSA', 'PSA 10 VSTAR Universe Charizard 211 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595258', 'PSA', 'PSA 10 VMAX Climax Charizard 187 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595257', 'PSA', 'PSA 10 VMAX Climax Rayquaza UR 284 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595269', 'PSA', 'PSA 10 Mep En-me Black Star Promo Oricorio 024',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595240', 'PSA', 'PSA 10 Mega Brave mega Absol SAR 089 Japanese',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595267', 'PSA', 'PSA 10 Sun & Moon Hidden Fates Giovanni''s 67',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595265', 'PSA', 'PSA 10 Sword & Shield Silver Tempest Rayquaza TG29',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

INSERT INTO slabs (cert_number, grading_company, item_name, status, date_acquired)
VALUES (
  '153595235', 'PSA', 'PSA 10 Mep En-me Black Star Promo mega Charizard 023',
  'in_inventory', CURRENT_DATE
)
ON CONFLICT (cert_number) WHERE deleted = false DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- Verify:
--   SELECT count(*) AS total_slabs FROM slabs WHERE deleted = false;
--   -- expected: 158
--
--   SELECT status, count(*) FROM slabs WHERE deleted = false GROUP BY status;
--   -- expected: in_inventory=135, listed=21, sold=2
-- ───────────────────────────────────────────────────────────────────────────

COMMIT;
-- ROLLBACK;     -- ← if numbers look wrong, run this instead