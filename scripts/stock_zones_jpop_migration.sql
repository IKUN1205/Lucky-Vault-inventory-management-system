-- Will 11/24 (Gary's permissions): a Japanese One Piece zone, JPOP1-JPOP5. Against the live database, once. Only the two zone-name
-- checks change: every name let in before is still let in, no row is touched. The pattern is ZONE_PATTERN in src/lib/stockCheck.js.
BEGIN;

ALTER TABLE stock_check_scans DROP CONSTRAINT stock_check_scans_zone_check;
ALTER TABLE stock_check_scans ADD CONSTRAINT stock_check_scans_zone_check CHECK (zone ~ '^([A-J][1-5]|DB[1-5]|(BLU|PUR|RED|GRN|YEL|BLK|LD|JPOP)[1-5]|Unsorted|Store)$');

ALTER TABLE stock_zone_qty DROP CONSTRAINT stock_zone_qty_zone_check;
ALTER TABLE stock_zone_qty ADD CONSTRAINT stock_zone_qty_zone_check CHECK (zone ~ '^([A-J][1-5]|DB[1-5]|(BLU|PUR|RED|GRN|YEL|BLK|LD|JPOP)[1-5]|Unsorted|Store)$');

COMMIT;
