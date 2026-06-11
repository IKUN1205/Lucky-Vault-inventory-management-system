-- Fix: the audit-log check constraints only allow 'sold' (+'created' on
-- singles), so every 'moved' event — in-app Move Inventory, Cards Audit
-- physical-count fixes, AND the slabs sync's sheet-driven relocations —
-- has been failing SILENTLY since the move features shipped (logSlabEvent
-- / logSingleEvent swallow insert errors by design). Discovered
-- 2026-06-11 when the sheet-sync relocation trail came back empty.
-- Constraint names verified live via probe inserts.

ALTER TABLE slabs_audit_log
  DROP CONSTRAINT IF EXISTS slabs_audit_log_event_type_check;
ALTER TABLE slabs_audit_log
  ADD CONSTRAINT slabs_audit_log_event_type_check
  CHECK (event_type IN ('created', 'moved', 'sold', 'deleted'));

ALTER TABLE singles_audit_log
  DROP CONSTRAINT IF EXISTS singles_audit_log_event_type_check;
ALTER TABLE singles_audit_log
  ADD CONSTRAINT singles_audit_log_event_type_check
  CHECK (event_type IN ('created', 'moved', 'sold', 'deleted'));
