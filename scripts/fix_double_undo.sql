-- Fix: revert the over-applied undo. Brings inventory back to fresh import state.
BEGIN;

-- 2× 6d63422b: -2 from Master, +2 back to destination
UPDATE inventory SET quantity = quantity - 2 WHERE product_id = '6d63422b-69a6-468e-9120-88f3732343c7' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity + 2 WHERE product_id = '6d63422b-69a6-468e-9120-88f3732343c7' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';

-- 10× a77b79fb: -10 from Master, +10 back to destination
UPDATE inventory SET quantity = quantity - 10 WHERE product_id = 'a77b79fb-2715-4d8d-8ede-3fcfa4c4aef6' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity + 10 WHERE product_id = 'a77b79fb-2715-4d8d-8ede-3fcfa4c4aef6' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';

-- 1× b9746503: -1 from Master, +1 back to destination
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 'b9746503-0c59-4b11-8733-384df95115dc' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity + 1 WHERE product_id = 'b9746503-0c59-4b11-8733-384df95115dc' AND location_id = 'eeff0769-9131-4467-9d0a-020b37edc102';

-- 1× b8a67072: -1 from Master, +1 back to destination
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 'b8a67072-a8f7-4e64-975c-ce16017ef220' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity + 1 WHERE product_id = 'b8a67072-a8f7-4e64-975c-ce16017ef220' AND location_id = 'eeff0769-9131-4467-9d0a-020b37edc102';

-- 10× 16249009: -10 from Master, +10 back to destination
UPDATE inventory SET quantity = quantity - 10 WHERE product_id = '16249009-a1ae-470d-828d-9ab3d0f1c7c4' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity + 10 WHERE product_id = '16249009-a1ae-470d-828d-9ab3d0f1c7c4' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';

-- 1× 4019a0e4: -1 from Master, +1 back to destination
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = '4019a0e4-e460-46a6-8995-815ba7bd71dc' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity + 1 WHERE product_id = '4019a0e4-e460-46a6-8995-815ba7bd71dc' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';

COMMIT;

-- Verify Master is back to original quantities (expect: 2, 26, 1, 303, 125, 13)
SELECT p.name, i.quantity
FROM inventory i JOIN products p ON p.id = i.product_id
WHERE i.location_id = '1f68249f-7708-400c-80f7-e75bde85b556'
  AND i.product_id IN (
    '6d63422b-69a6-468e-9120-88f3732343c7','a77b79fb-2715-4d8d-8ede-3fcfa4c4aef6',
    'b9746503-0c59-4b11-8733-384df95115dc','b8a67072-a8f7-4e64-975c-ce16017ef220',
    '16249009-a1ae-470d-828d-9ab3d0f1c7c4','4019a0e4-e460-46a6-8995-815ba7bd71dc'
  )
ORDER BY p.name;
