-- last_slab_bin — remembers a slab's most recent REAL shelf bin in the
-- Slab Room (e.g. "2V-01") so that when the slab leaves for a show/stream
-- and later returns, the in-app move can restore it to that exact bin
-- instead of the generic "slab room" (boss directive 2026-06-16).
--
-- Captured by api/sync-slabs-sheet.js whenever the sheet Location cell is
-- a digit-prefixed bin code; preserved (not overwritten) while the slab is
-- away at a show/stream. Restored by api/sheet-update-location.js on the
-- move back into the Slab Room. Run in the Supabase SQL Editor.

ALTER TABLE slabs ADD COLUMN IF NOT EXISTS last_slab_bin TEXT;
