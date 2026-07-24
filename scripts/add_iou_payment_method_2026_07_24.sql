-- We Owe (IOU) payables ledger (2026-07-24): the /we-owe page represents an
-- open IOU as a storefront_payments row with this payment method. The client
-- bootstraps it on first load, but payment_methods.type is NOT NULL so the
-- insert needs both fields; this migration seeds it explicitly.
-- payment_methods.type is enum payment_type with no IOU member; nothing in the
-- codebase reads .type, so borrow 'Store Credit' — all logic keys off name.
INSERT INTO payment_methods (name, type, active)
SELECT 'IOU (we owe)', 'Store Credit', true
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE name = 'IOU (we owe)');
