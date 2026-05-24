-- ============================================================================
-- Cleanup: Japan SKU duplicates discovered 2026-05-24
-- ============================================================================
-- Three duplicate (short_code, variant) groups were caught after the xlsx
-- import + the earlier OP-14 fix. None of the duplicate rows being removed
-- have any inventory / acquisition / japan_stream_sales references — all
-- safe to deactivate (we soft-delete via active=false rather than hard-delete
-- so the rows stay around for audit).
--
-- The 4th case (OP-14 EN dup) gets its Japan taxonomy CLEARED instead of
-- being deactivated — it's a legitimate EN product that just shouldn't be
-- showing up in Japan pickers. Clearing short_code + variant + aliases
-- pulls it out of the Japan-flavored filters without touching its existence.
-- ============================================================================

BEGIN;

-- 1. OP-15 sealed — keep the JP baseline with stock (e0a1363a "OP-15 Adventure
--    on Kami's Island Booster Box"). Deactivate the xlsx-import dup
--    (1c4876fb "Adventure on KAMI's Island Booster Box") which has 0 refs.
UPDATE products SET active = false
WHERE id = '1c4876fb-2ab8-410c-a750-14315c78d645';

-- 2. OP-15 cut_slice — keep the Unicode-quote variant that matches the xlsx
--    canonical spelling (dae538e9 "Adventure on KAMI's Island (Cut Slice)").
--    Deactivate the ASCII-quote dup (0537ec98 same name, different apostrophe).
UPDATE products SET active = false
WHERE id = '0537ec98-e1e3-4f4a-ba25-055a89efa8c1';

-- 3. OP-14 sealed — keep the JP baseline (1edcb956 "OP-14 The Azure Seas
--    Seven Booster Box", 3 inv rows + 2 acquisitions). Deactivate the
--    xlsx-import dup (78ea8101 "THE AZURE SEA'S SEVEN Booster Box") which
--    has 0 refs.
UPDATE products SET active = false
WHERE id = '78ea8101-9762-4975-b69e-5168323bd051';

-- 4. OP-14 EN sealed — 8a03ebcc accidentally got Japan taxonomy applied
--    during the very first xlsx import run (before we filtered to language='JP'
--    in the matcher). Strip the Japan-flavored metadata so it doesn't pollute
--    Japan pickers; leave the row itself active for its EN use case.
UPDATE products
SET short_code = NULL,
    variant = NULL,
    aliases = NULL
WHERE id = '8a03ebcc-3b57-436f-8e5c-20fe44b6c517';

COMMIT;

-- Verify (should each return 0 rows):
--   SELECT short_code, variant, COUNT(*) FROM products
--   WHERE short_code IS NOT NULL AND variant IS NOT NULL AND active = true
--   GROUP BY short_code, variant HAVING COUNT(*) > 1;
