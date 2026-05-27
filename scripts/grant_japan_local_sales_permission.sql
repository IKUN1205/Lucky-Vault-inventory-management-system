-- ============================================================================
-- Japan Local Sales — grant /jp/local-sales page permission
-- ============================================================================
-- Two-step backfill:
--   1) Every admin (anyone with /users) gets it automatically — admins always
--      need the full surface so they can troubleshoot.
--   2) Anyone who already has /jp/stream-sales gets it too — those are the
--      Japan team operators who'll actually use it. Stream + local are
--      sibling outflows; permitting one and not the other would be an
--      annoying oversight.
--
-- Idempotent — re-running is a no-op (NOT (... ? '/jp/local-sales') skips
-- users who already have it).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- Users that will receive /jp/local-sales access ---';
  FOR rec IN
    SELECT name, email
      FROM users
     WHERE (
              COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
           OR COALESCE(allowed_pages, '[]'::jsonb) ? '/jp/stream-sales'
           )
       AND active = true
       AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/jp/local-sales')
  LOOP
    RAISE NOTICE '  %  <%>', rec.name, rec.email;
  END LOOP;
END $$;

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/jp/local-sales"]'::jsonb
 WHERE (
          COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
       OR COALESCE(allowed_pages, '[]'::jsonb) ? '/jp/stream-sales'
       )
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/jp/local-sales');

COMMIT;
