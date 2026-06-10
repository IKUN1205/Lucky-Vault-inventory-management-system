-- Adds the boss's per-slab note from the slabs Google Sheet (Pokemon
-- Master col K / One Piece Master col J) as a dedicated column, kept
-- fresh by the hourly sync (api/sync-slabs-sheet.js) alongside MP/LV.
-- Separate from `notes`, which holds app-side system markers
-- ("Imported from slabs sheet…", "sold per sheet reconcile…").
--
-- Run once in the Supabase SQL Editor. The sync probes for this column
-- and silently skips note-syncing until it exists, so order doesn't
-- matter — but the app won't show notes until this runs.

ALTER TABLE slabs ADD COLUMN IF NOT EXISTS sheet_note TEXT;
