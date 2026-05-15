-- ============================================================================
-- Singles feature — grant page permissions to admin users
-- ============================================================================
-- Purpose: add '/singles' and '/singles/add' to the allowed_pages array of
--          every existing admin user (admin = anyone with '/users' in their
--          allowed_pages, per the LV convention in AuthContext.jsx).
--
-- Safety guarantees:
--   * Only modifies the `allowed_pages` array on existing user rows.
--   * Idempotent via array_remove + array_append: if the page is already
--     there, it's removed and re-added, leaving the set unchanged.
--   * Non-admin users are not touched. They get access by an admin granting
--     it through the Team Management UI.
--   * Wrapped in BEGIN / COMMIT. The dry-run SELECT below the COMMIT will
--     show the resulting state.
--
-- Run in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Dry-run preview (printed before the UPDATE). Shows which users WILL be
-- modified. If the result set is unexpected, ROLLBACK the transaction
-- before COMMIT below.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- Admins that will receive /singles and /singles/add access ---';
  FOR rec IN
    SELECT name, email, allowed_pages
      FROM users
     WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
       AND active = true
  LOOP
    RAISE NOTICE '  %  <%>  current: %', rec.name, rec.email, rec.allowed_pages;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Grant /singles (idempotent: only append when not already present)
-- ----------------------------------------------------------------------------
-- allowed_pages is jsonb (a JSON array of strings), not text[]. So we use
-- jsonb operators: `?` for "contains element", `||` to concat arrays, and
-- a NOT (… ? value) guard for the no-op-on-rerun property.
UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/singles"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles');

-- ----------------------------------------------------------------------------
-- Grant /singles/add (idempotent)
-- ----------------------------------------------------------------------------
UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/singles/add"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/add');

COMMIT;

-- ============================================================================
-- Verify (run separately, outside the transaction):
--
--   SELECT name, email, allowed_pages
--     FROM users
--    WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
--      AND active = true;
--
--   -- Every admin's allowed_pages should contain '/singles' AND '/singles/add'.
--
--   -- To grant access to a non-admin user later (Team Management UI handles
--   -- this graphically), the manual SQL form is:
--   --
--   --   UPDATE users
--   --      SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb)
--   --                          || '["/singles"]'::jsonb
--   --    WHERE name = 'SomeUser'
--   --      AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles');
-- ============================================================================
