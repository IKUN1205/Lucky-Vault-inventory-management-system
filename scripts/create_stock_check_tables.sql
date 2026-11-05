-- Stock Check: John scans the Pokemon singles zone by zone (A1..J5), one round a week.
-- The app uses the anon key and RLS is off on singles and locations; these tables follow the same pattern (OL-192).
-- Run once, after Gary's go.

CREATE TABLE IF NOT EXISTS stock_check_rounds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid        NOT NULL REFERENCES locations(id),
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'cancelled')),
  expected        jsonb       NOT NULL,                  -- [{ id, qty, name }]: Pokemon stock when the round started
  zones_done      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  result          jsonb,                                 -- what the round changed, one line per card
  started_by_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_by_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  finished_at     timestamptz
);

-- One open round per room.
CREATE UNIQUE INDEX IF NOT EXISTS stock_check_rounds_one_open
  ON stock_check_rounds (location_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS stock_check_scans (
  round_id        uuid        NOT NULL REFERENCES stock_check_rounds(id) ON DELETE CASCADE,
  zone            text        NOT NULL CHECK (zone ~ '^([A-J][1-5]|Unsorted|Store)$'),
  tcg_id          text        NOT NULL,
  qty             integer     NOT NULL CHECK (qty >= 0),
  updated_by_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, zone, tcg_id)
);

-- Finding a card: which zones hold this id.
CREATE INDEX IF NOT EXISTS stock_check_scans_tcg_id ON stock_check_scans (tcg_id);

-- Gary 11/05: stock by zone. What each zone held when it was last submitted; a sale does not change it until the next scan.
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
