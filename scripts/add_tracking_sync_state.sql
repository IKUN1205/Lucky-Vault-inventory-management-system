-- Phase 2: AfterShip auto-sync state.
--
-- Daily Vercel cron (`/api/aftership-sync`) reads acquisitions with a
-- tracking_number that aren't yet "Delivered", asks AfterShip for the latest
-- status, and posts a Lark digest of items arriving today / tomorrow / just
-- delivered.
--
-- These columns are written by the cron, never by the UI. They're nullable so
-- existing rows remain valid.

ALTER TABLE acquisitions
  ADD COLUMN IF NOT EXISTS tracking_status TEXT,                -- AfterShip "tag": Pending / InTransit / OutForDelivery / Delivered / Exception / Expired
  ADD COLUMN IF NOT EXISTS tracking_subtag TEXT,                -- AfterShip "subtag" — finer-grained
  ADD COLUMN IF NOT EXISTS tracking_expected_delivery DATE,     -- AfterShip's estimated delivery date
  ADD COLUMN IF NOT EXISTS tracking_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aftership_registered BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aftership_slug TEXT,                 -- AfterShip carrier slug used (e.g. "usps", "fedex")
  -- Whether we've already sent the "delivered" notification for this row.
  -- Prevents the cron from re-pinging Lark every day after delivery.
  ADD COLUMN IF NOT EXISTS delivered_notified BOOLEAN DEFAULT FALSE;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'acquisitions'
  AND column_name IN (
    'tracking_status', 'tracking_subtag', 'tracking_expected_delivery',
    'tracking_last_checked_at', 'tracking_delivered_at',
    'aftership_registered', 'aftership_slug', 'delivered_notified'
  )
ORDER BY column_name;
