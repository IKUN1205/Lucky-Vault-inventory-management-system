-- Drop the over-narrow sale_channel CHECK constraints (2026-06-23).
-- They only allowed a fixed set (ebay/whatnot/comc/tcgplayer/in_person/
-- trade_out/other) and rejected 'tiktok', so selling a slab/single on
-- TikTok (RocketsHQ / PackHeads) failed with
-- "violates check constraint slabs_sale_channel_check".
-- sale_channel is app-controlled; drop the CHECK rather than widen it for
-- every new channel (TikTok, Shows, Shopify…).
ALTER TABLE slabs   DROP CONSTRAINT IF EXISTS slabs_sale_channel_check;
ALTER TABLE singles DROP CONSTRAINT IF EXISTS singles_sale_channel_check;
