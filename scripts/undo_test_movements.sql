-- Undo today's 6 test movements
BEGIN;

-- 2× movement 2c305cb6
UPDATE inventory SET quantity = quantity + 2 WHERE product_id = '6d63422b-69a6-468e-9120-88f3732343c7' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity - 2 WHERE product_id = '6d63422b-69a6-468e-9120-88f3732343c7' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';
DELETE FROM movements WHERE id = '2c305cb6-b5de-40fd-9c99-7c22909c4104';

-- 10× movement 88c8982d
UPDATE inventory SET quantity = quantity + 10 WHERE product_id = 'a77b79fb-2715-4d8d-8ede-3fcfa4c4aef6' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity - 10 WHERE product_id = 'a77b79fb-2715-4d8d-8ede-3fcfa4c4aef6' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';
DELETE FROM movements WHERE id = '88c8982d-4d49-4d30-93e7-ec2fd9e1d805';

-- 1× movement ba6e85ce
UPDATE inventory SET quantity = quantity + 1 WHERE product_id = 'b9746503-0c59-4b11-8733-384df95115dc' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 'b9746503-0c59-4b11-8733-384df95115dc' AND location_id = 'eeff0769-9131-4467-9d0a-020b37edc102';
DELETE FROM movements WHERE id = 'ba6e85ce-3383-4529-98e1-9f1cb9bfd3fc';

-- 1× movement 7c9eb7f5
UPDATE inventory SET quantity = quantity + 1 WHERE product_id = 'b8a67072-a8f7-4e64-975c-ce16017ef220' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 'b8a67072-a8f7-4e64-975c-ce16017ef220' AND location_id = 'eeff0769-9131-4467-9d0a-020b37edc102';
DELETE FROM movements WHERE id = '7c9eb7f5-8926-4e10-b241-e6a49f730e11';

-- 10× movement c26f1380
UPDATE inventory SET quantity = quantity + 10 WHERE product_id = '16249009-a1ae-470d-828d-9ab3d0f1c7c4' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity - 10 WHERE product_id = '16249009-a1ae-470d-828d-9ab3d0f1c7c4' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';
DELETE FROM movements WHERE id = 'c26f1380-9d6d-41aa-bcf6-67a90d87c260';

-- 1× movement 71df1bb3
UPDATE inventory SET quantity = quantity + 1 WHERE product_id = '4019a0e4-e460-46a6-8995-815ba7bd71dc' AND location_id = '1f68249f-7708-400c-80f7-e75bde85b556';
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = '4019a0e4-e460-46a6-8995-815ba7bd71dc' AND location_id = '04b32948-7920-46f6-bfa1-1b0d48cc71de';
DELETE FROM movements WHERE id = '71df1bb3-1303-40d8-aba0-0c860021a323';

COMMIT;

-- Verify movements gone
SELECT COUNT(*) AS movements_left_today FROM movements WHERE date = '2026-04-30';
