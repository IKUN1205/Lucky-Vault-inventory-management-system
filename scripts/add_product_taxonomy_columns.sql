-- ============================================================================
-- products: aliases / short_code / variant — product taxonomy expansion
-- ============================================================================
-- Driven by the Japan team's existing nomenclature (db.xlsx). Each physical
-- card set splits into multiple SKUs by *packaging variant* (sealed box,
-- unsealed box, in-bag pack, single pack, case, cut-slice, etc.). Search by
-- short code (M2a / OP-15) or by Chinese name (海贼王 / 宝可梦) is also a
-- daily need that the existing english-only product.name doesn't cover.
--
-- Three additive columns on products:
--   - aliases     TEXT[]  array of alternative search terms (Chinese names,
--                         short codes, custom English aliases). Searched
--                         alongside name in product pickers.
--   - short_code  TEXT    set code (M2a, OP-15, EB-04). Used for one-shot
--                         search and as a chip prefix in product pickers.
--   - variant     TEXT    packaging form: sealed / unsealed / in_bag /
--                         single_pack / cut_slice / case / single_card /
--                         black_box / other.  English in DB; Chinese in UI
--                         via src/lib/japanVariants.js.  NULL means
--                         non-Japan product (US workflow unchanged).
--
-- All idempotent. Run once in Supabase SQL Editor.
-- ============================================================================

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS aliases    TEXT[],
  ADD COLUMN IF NOT EXISTS short_code TEXT,
  ADD COLUMN IF NOT EXISTS variant    TEXT
    CHECK (
      variant IN (
        'sealed', 'unsealed', 'in_bag', 'single_pack',
        'cut_slice', 'case', 'single_card', 'black_box', 'other'
      )
      OR variant IS NULL
    );

-- GIN index for fast array-membership queries (e.g. "find any product whose
-- aliases include 'M2a'"). Partial — most products will leave aliases NULL
-- so the index stays small.
CREATE INDEX IF NOT EXISTS idx_products_aliases
  ON products USING GIN (aliases)
  WHERE aliases IS NOT NULL;

-- B-tree index for short_code lookups (point queries). Partial again.
CREATE INDEX IF NOT EXISTS idx_products_short_code
  ON products (short_code)
  WHERE short_code IS NOT NULL;

-- Variant index for filter dropdowns ("show only sealed boxes")
CREATE INDEX IF NOT EXISTS idx_products_variant
  ON products (variant)
  WHERE variant IS NOT NULL;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='products' AND column_name IN ('aliases','short_code','variant');
