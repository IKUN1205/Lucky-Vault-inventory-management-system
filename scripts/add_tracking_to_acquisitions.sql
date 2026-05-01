-- Add carrier + tracking_number to acquisitions so we can record shipping info
-- when purchases are logged. Both columns are nullable — old rows have neither,
-- and walk-in purchases without tracking still work.
--
-- A daily cron (Phase 2, AfterShip) will read these fields, query AfterShip,
-- and post arrival reminders to Lark. For now these are just data + a clickable
-- link in the Lark "purchase logged" notification.

ALTER TABLE acquisitions
  ADD COLUMN IF NOT EXISTS carrier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;

-- Optional: index on tracking_number so the cron job can find rows quickly
-- without a full table scan once we have hundreds of acquisitions.
CREATE INDEX IF NOT EXISTS idx_acquisitions_tracking
  ON acquisitions (tracking_number)
  WHERE tracking_number IS NOT NULL;

-- Verify
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'acquisitions'
  AND column_name IN ('carrier', 'tracking_number');
