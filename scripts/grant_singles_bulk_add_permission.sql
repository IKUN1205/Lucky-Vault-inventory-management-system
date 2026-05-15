-- ============================================================================
-- Singles feature — grant /singles/bulk-add page permission to admin users
-- ============================================================================
-- Follow-up to grant_singles_permissions.sql + grant_singles_scan_permission.sql.
-- New /singles/bulk-add page (multi-card entry form, also the landing for
-- Scan → Batch Intake mode). Admins get access automatically; non-admin
-- streamers can be added via Team Management UI per usual.
--
-- Same jsonb-array pattern as the other singles grant migrations.
-- Idempotent: only appends when missing.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- Admins that will receive /singles/bulk-add access ---';
  FOR rec IN
    SELECT name, email, allowed_pages
      FROM users
     WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
       AND active = true
       AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/bulk-add')
  LOOP
    RAISE NOTICE '  %  <%>', rec.name, rec.email;
  END LOOP;
END $$;

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/singles/bulk-add"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/singles/bulk-add');

COMMIT;
