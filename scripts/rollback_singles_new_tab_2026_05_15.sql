-- ============================================================================
-- Singles inventory — roll back the 2026-05-15 import of the NEW tab
-- ============================================================================
-- Boss said the NEW tab should NOT have been imported (it is pending his
-- manual approval, not yet live inventory). HE tab stays as-is.
--
-- NEW-only TCG IDs to soft-delete: 181
-- Both-tab TCG IDs to decrement qty: 17
-- HE-only TCG IDs (unchanged): 266
--
-- Wrapped in BEGIN/COMMIT. ROLLBACK if numbers look off after verify.
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- A. Soft-delete 181 NEW-only cards
-- ───────────────────────────────────────────────────────────────────────────
UPDATE singles
   SET deleted = true,
       deleted_at = now(),
       deleted_reason = 'Boss directive — new tab not yet approved (2026-05-15)'
 WHERE deleted = false
   AND tcg_id IN (
     '250309', '88517', '589925', '560396', '478045', '590090', '676062', '88467',
     '542930', '676037', '490290', '226573', '478025', '613765', '613760', '676043',
     '610532', '477056', '490719', '124124', '107004', '617417', '647237', '566523',
     '566517', '571753', '566524', '566521', '264208', '44421', '642568', '538687',
     '241737', '542884', '642247', '642555', '632989', '542894', '509955', '487060',
     '197785', '197651', '567427', '642564', '452021', '560401', '560402', '523886',
     '523894', '284119', '90543', '523870', '589857', '567436', '590003', '633013',
     '509963', '542933', '165766', '589973', '642544', '642562', '642224', '517028',
     '542901', '567474', '517050', '246714', '83678', '452019', '90180', '91145',
     '497474', '86954', '642218', '185987', '521697', '263876', '183948', '200350',
     '490063', '250324', '659231', '272488', '664010', '659612', '96006', '590063',
     '568414', '246760', '642596', '88711', '509956', '566525', '232378', '534521',
     '165634', '534497', '573702', '573205', '572321', '535165', '534680', '534634',
     '232426', '534496', '534529', '226445', '502625', '618887', '250335', '248731',
     '157773', '684333', '509951', '478029', '264205', '201348', '518872', '250303',
     '513721', '250321', '250319', '284266', '542914', '284270', '577145', '478020',
     '642597', '148343', '642234', '251103', '535149', '534459', '534463', '534631',
     '680480', '162042', '91238', '117891', '676044', '523885', '201355', '654485',
     '478038', '250338', '632992', '635467', '523893', '450289', '219320', '124035',
     '44419', '662222', '642235', '219312', '148425', '263903', '535093', '284284',
     '251089', '497630', '477181', '85270', '88533', '610430', '684462', '684461',
     '684463', '185984', '189278', '251102', '111564', '272446', '589879', '642547',
     '560381', '550228', '623611', '684338', '478062'
   );

-- ───────────────────────────────────────────────────────────────────────────
-- B. Decrement qty for 17 cards in BOTH tabs
--    (we summed both tabs at import time → revert to HE-only count)
-- ───────────────────────────────────────────────────────────────────────────
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '165725' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 2, 0)
  WHERE tcg_id = '642552' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '490080' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 2, 0)
  WHERE tcg_id = '642550' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '490076' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '632987' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '654524' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '517029' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '654525' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '662150' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '610528' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '490078' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '534462' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '676040' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '646169' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '509983' AND deleted = false;
UPDATE singles SET quantity = GREATEST(quantity - 1, 0)
  WHERE tcg_id = '589987' AND deleted = false;

-- ───────────────────────────────────────────────────────────────────────────
-- Verify BEFORE committing:
--   -- Active cards should now equal HE-only count
--   SELECT count(*) AS active_singles, sum(quantity) AS total_qty
--   FROM singles WHERE form='raw' AND tcg_id IS NOT NULL AND deleted=false;
--   -- expected: 283 active singles
--
--   -- Soft-deleted by this rollback
--   SELECT count(*) AS soft_deleted_by_rollback FROM singles
--   WHERE deleted_reason = 'Boss directive — new tab not yet approved (2026-05-15)';
--   -- expected: 181
-- ───────────────────────────────────────────────────────────────────────────

COMMIT;
-- ROLLBACK;     -- ← if numbers look wrong, run this instead