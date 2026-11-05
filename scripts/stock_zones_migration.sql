-- Gary 11/05: stock by zone, Unsorted, the store's one big zone. Against the live database, once, after Gary's go.
-- 1) the zone names; 2) the zone records; 3) John's finished round (11/05) as the first record of each Inventory zone.
BEGIN;

ALTER TABLE stock_check_scans DROP CONSTRAINT stock_check_scans_zone_check;
ALTER TABLE stock_check_scans ADD CONSTRAINT stock_check_scans_zone_check CHECK (zone ~ '^([A-J][1-5]|Unsorted|Store)$');

CREATE TABLE IF NOT EXISTS stock_zone_qty (
  location_id     uuid        NOT NULL REFERENCES locations(id),
  zone            text        NOT NULL CHECK (zone ~ '^([A-J][1-5]|Unsorted|Store)$'),
  tcg_id          text        NOT NULL,
  qty             integer     NOT NULL CHECK (qty > 0),
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  scanned_by_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (location_id, zone, tcg_id)
);
CREATE INDEX IF NOT EXISTS stock_zone_qty_tcg_id ON stock_zone_qty (tcg_id);

INSERT INTO stock_zone_qty (location_id, zone, tcg_id, qty, scanned_at, scanned_by_id)
SELECT r.location_id, s.zone, s.tcg_id, s.qty, s.updated_at, s.updated_by_id
FROM stock_check_scans s
JOIN stock_check_rounds r ON r.id = s.round_id
WHERE s.round_id = 'ece2ff3a-e7dc-40f7-b478-a3f21a476ca0' AND s.qty > 0
ON CONFLICT (location_id, zone, tcg_id) DO NOTHING;

COMMIT;
