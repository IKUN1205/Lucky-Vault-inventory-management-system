-- ============================================================================
-- Cleanup: drop missing_count_alerts table (L2 retired)
-- ============================================================================
-- The L2 watchdog cron + alert table was retired on 2026-05-13. Rationale:
--
-- 1. L1 (auto-reconcile.js per-creator clustering, commit 6ea9ca5 + 3f23d66)
--    already detects merged sessions at count-time and fires a 🔀 MERGED
--    Lark notification with full per-session attribution. The audit-history
--    UI also flags the merged row visually.
--
-- 2. L2 fired alerts on a fixed 2h cron schedule regardless of whether
--    anyone could act on them (e.g. alerts firing at 2am with the next
--    streamer not due until 6pm = noise nobody reads).
--
-- 3. P2 Analytics LIVE integration (commit c98bab8) gives every recon
--    run TikTok's authoritative per-session items_sold, so the recon
--    itself is now the more accurate signal of "what each session
--    actually sold" — L2's proactive alerting is redundant.
--
-- Run this once in Supabase SQL Editor to drop the table + index. The
-- table held only alert-deduplication records — no business data is
-- lost. Idempotent.
-- ============================================================================

DROP INDEX IF EXISTS idx_mca_alerted_at;
DROP TABLE IF EXISTS missing_count_alerts;

-- Verify (should return 0 rows)
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'missing_count_alerts';
