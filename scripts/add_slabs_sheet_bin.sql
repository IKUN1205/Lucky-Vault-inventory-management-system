-- sheet_bin — raw Location cell from the slabs sheet ("H-01", "lucky",
-- "show", …) mirrored hourly by api/sync-slabs-sheet.js so staff can see
-- the exact shelf bin in the app (View Inventory slab rows show 📍 bin).
-- The routed room still drives location_id; this column is the
-- finer-grained raw text. Sync degrades gracefully until this runs.

ALTER TABLE slabs ADD COLUMN IF NOT EXISTS sheet_bin TEXT;
