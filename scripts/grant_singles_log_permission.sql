-- ============================================================================
-- Singles feature — grant /singles/log page permission to admin users
-- ============================================================================
-- Idempotent jsonb-array append, same pattern as the other singles grants.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- Admins that will receive /singles/log access ---';
  FOR rec IN
    SELECT name, email
      FROM users
     WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
       AND active = true
       AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/log')
  LOOP
    RAISE NOTICE '  %  <%>', rec.name, rec.email;
  END LOOP;
END $$;

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/singles/log"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/log');

COMMIT;
