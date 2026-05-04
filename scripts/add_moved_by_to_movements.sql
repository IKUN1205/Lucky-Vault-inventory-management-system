-- Add moved_by_id to movements so we record who PHYSICALLY moved the goods,
-- separate from created_by (who logged the record in the system).
--
-- Background: MovedInventory.jsx has a "Moved By" dropdown that the team uses
-- to attribute physical work to the right person, but the value was being
-- silently dropped because the column didn't exist. The Supabase JS client
-- ignores unknown columns rather than erroring, so the feature appeared to
-- work (Lark notifications showed the right name from client-side state) but
-- left no audit trail in the DB. This migration closes that gap.
--
-- Both old and new movement rows are valid — the column is nullable and the
-- new code in MovedInventory.jsx writes form.moved_by_id || null on every
-- new record.

ALTER TABLE movements
  ADD COLUMN IF NOT EXISTS moved_by_id UUID REFERENCES users(id);

-- Index supports queries like "what did Aldo move this week"
CREATE INDEX IF NOT EXISTS idx_movements_moved_by
  ON movements (moved_by_id);

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'movements' AND column_name = 'moved_by_id';
