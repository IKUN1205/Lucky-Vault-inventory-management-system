-- Will 11/11 (Gary's permissions): zones for Dragon Ball (DB1-DB5), One Piece by colour (BLU PUR RED GRN YEL BLK, 1-5 each) and
-- One Piece leaders + DON!! (LD1-LD5). Against the live database, once. Only the two zone-name checks change: every name let in
-- before is still let in, no row is touched. The pattern is ZONE_PATTERN in src/lib/stockCheck.js (scratchpad/stock_zones_test.mjs holds them equal).
BEGIN;

ALTER TABLE stock_check_scans DROP CONSTRAINT stock_check_scans_zone_check;
ALTER TABLE stock_check_scans ADD CONSTRAINT stock_check_scans_zone_check CHECK (zone ~ '^([A-J][1-5]|DB[1-5]|(BLU|PUR|RED|GRN|YEL|BLK|LD)[1-5]|Unsorted|Store)$');

ALTER TABLE stock_zone_qty DROP CONSTRAINT stock_zone_qty_zone_check;
ALTER TABLE stock_zone_qty ADD CONSTRAINT stock_zone_qty_zone_check CHECK (zone ~ '^([A-J][1-5]|DB[1-5]|(BLU|PUR|RED|GRN|YEL|BLK|LD)[1-5]|Unsorted|Store)$');

COMMIT;
