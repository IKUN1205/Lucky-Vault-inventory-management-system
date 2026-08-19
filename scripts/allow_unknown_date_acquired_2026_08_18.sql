-- ============================================================================
-- singles.date_acquired: let it hold "unknown"
-- 2026-08-18
-- ============================================================================
-- WHY
--
-- When a cashier scans a card the app believes is already sold, and the card is
-- physically in their hand, `_recoverSoldSingle` books a new row. We cannot
-- prove where that copy came from — that is the whole point of the situation —
-- so its acquisition date is genuinely unknown.
--
-- The column is `date NOT NULL` (create_singles_table.sql:97), which has no way
-- to say that. The 08-07 version wrote NULL and every insert was rejected by
-- Postgres, so the escape hatch never worked once; on 08-17 that cost the
-- storefront a checkout that took $80 and recorded $40. The 08-18 fix writes
-- the counter date instead — true ("we had it at the register today"), but
-- stored in a column whose name means something else, and SinglesInventory
-- displays it and fetchBestSingleIdentity sorts by it.
--
-- Dropping NOT NULL lets the recovery row say "unknown" out loud, which is what
-- the house rule asks for: 查无可查就留空.
--
-- SAFETY
--
--   * No existing row changes. Dropping a NOT NULL constraint never rewrites
--     data; every current row keeps its date.
--   * Nothing else inserts a NULL here. Both intake paths set the date from the
--     form, and the storefront/sync paths copy an existing row's value. The
--     recovery path is the only caller that has nothing to put there.
--   * Reversible: add the constraint back with the second statement below, but
--     only after filling any NULLs — see the check query.
--
-- HOW TO RUN (no access token needed)
--
--   https://supabase.com/dashboard/project/dqreqevbjszercgackuc/sql/new
--   Paste, press Run. It is one statement and takes milliseconds.
-- ============================================================================

ALTER TABLE singles ALTER COLUMN date_acquired DROP NOT NULL;


-- ---------------------------------------------------------------------------
-- Verify (expect is_nullable = YES)
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'singles' AND column_name = 'date_acquired';


-- ---------------------------------------------------------------------------
-- Afterwards: which rows are actually claiming "unknown"?
-- Should only ever be counter recoveries.
-- ---------------------------------------------------------------------------
-- SELECT id, card_name, card_number, status, sale_date, sale_notes
-- FROM singles
-- WHERE date_acquired IS NULL
-- ORDER BY sale_date DESC NULLS LAST;


-- ---------------------------------------------------------------------------
-- Rollback (fails loudly if any NULLs exist — fill them first)
-- ---------------------------------------------------------------------------
-- ALTER TABLE singles ALTER COLUMN date_acquired SET NOT NULL;
