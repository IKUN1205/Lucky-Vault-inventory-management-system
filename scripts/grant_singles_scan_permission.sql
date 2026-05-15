-- ============================================================================
-- Singles feature — grant /singles/scan page permission to admin users
-- ============================================================================
-- Follow-up to grant_singles_permissions.sql. New /singles/scan page
-- (barcode-driven intake + sell flow). Admins automatically get access;
-- non-admin streamers can be added via Team Management UI per usual.
--
-- Same jsonb-array pattern as the original grant migration:
--   ?   — does the jsonb array contain this string?
--   ||  — concat two jsonb arrays
-- Idempotent: only appends when missing.
-- ============================================================================

BEGIN;

-- Dry-run preview
DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- Admins that will receive /singles/scan access ---';
  FOR rec IN
    SELECT name, email, allowed_pages
      FROM users
     WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
       AND active = true
       AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/scan')
  LOOP
    RAISE NOTICE '  %  <%>', rec.name, rec.email;
  END LOOP;
END $$;

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/singles/scan"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/scan');

COMMIT;

-- Verify:
--   SELECT name, allowed_pages
--   FROM users
--   WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users' AND active = true;
-- Every admin's allowed_pages should now contain '/singles/scan'.
