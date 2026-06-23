-- ============================================================================
-- Weekly Usage — grant /weekly-usage page permission to admins
-- ============================================================================
-- Anyone who already has Reports (/reports) or is an admin (/users) gets the
-- new Weekly Usage report too — it's the same audience. Idempotent.
-- ============================================================================

BEGIN;

DO $$
DECLARE rec record;
BEGIN
  RAISE NOTICE '--- Users that will receive /weekly-usage access ---';
  FOR rec IN
    SELECT name, email FROM users
     WHERE (COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
         OR COALESCE(allowed_pages, '[]'::jsonb) ? '/reports')
       AND active = true
       AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/weekly-usage')
  LOOP RAISE NOTICE '  %  <%>', rec.name, rec.email; END LOOP;
END $$;

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/weekly-usage"]'::jsonb
 WHERE (COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
     OR COALESCE(allowed_pages, '[]'::jsonb) ? '/reports')
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/weekly-usage');

COMMIT;
