-- ============================================================================
-- Slabs feature — grant page permissions to admin users
-- ============================================================================
-- We will reuse the existing /singles, /singles/scan, /singles/log routes
-- (which already have permissions granted) by adding type tabs on those
-- pages — so technically no new permission row is strictly required.
--
-- HOWEVER, if we end up adding dedicated /slabs* routes too (e.g. for deep
-- links from Lark messages), we want admins to access them. Idempotent
-- grant of /slabs and /slabs/scan keeps that option open without an extra
-- migration later.
-- ============================================================================

BEGIN;

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/slabs"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/slabs');

UPDATE users
   SET allowed_pages = COALESCE(allowed_pages, '[]'::jsonb) || '["/slabs/scan"]'::jsonb
 WHERE COALESCE(allowed_pages, '[]'::jsonb) ? '/users'
   AND active = true
   AND NOT (COALESCE(allowed_pages, '[]'::jsonb) ? '/slabs/scan');

COMMIT;
