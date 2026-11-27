-- Will 2026-11-26 15:38 / 15:43 (D-20261126-02): Grading page beside Stock Check.
-- A Roca batch with labels goes to Kevin; when he is done, the page scans each card as "grading" (he keeps it) or "stock" (goes into
-- TCGplayer Singles, zone Unsorted). The page only records here; it never writes singles. Intake runs afterwards from
-- inventory-sync (row merge, cost = market x 80%, open-count guard, ledger), which fills intake_job.
-- RLS is off and anon has full rights, the same as stock_check_rounds (OL-192). Run once.
BEGIN;

CREATE TABLE IF NOT EXISTS grading_batches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key      text        NOT NULL UNIQUE,              -- e.g. roca:383161 ; set by the push script, so a batch is never pushed twice
  name            text        NOT NULL,                     -- e.g. 11/24 part1
  roca_batch      text,                                     -- Roca batch id
  location_id     uuid        NOT NULL REFERENCES locations(id),   -- where stock cards go (TCGplayer Singles)
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finished', 'cancelled')),
  notes           text,
  result          jsonb,                                    -- written at finish: counts, missing, extras
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_by_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  finished_at     timestamptz,
  intake_job      text,                                     -- JOB= of the intake script once the stock cards are in
  intake_at       timestamptz
);

CREATE TABLE IF NOT EXISTS grading_batch_cards (
  batch_id        uuid        NOT NULL REFERENCES grading_batches(id) ON DELETE CASCADE,
  seq             integer     NOT NULL,                     -- the card's number in the batch (label order)
  tcg_id          text        NOT NULL,                     -- what the label barcode reads
  card_name       text        NOT NULL,
  card_number     text,
  set_name        text,
  printing        text,
  condition       text,
  language        text,
  market_usd      numeric(10,2),
  decision        text        CHECK (decision IN ('grading', 'stock')),   -- null = not scanned yet
  scanned_at      timestamptz,
  scanned_by_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (batch_id, seq)
);
CREATE INDEX IF NOT EXISTS grading_batch_cards_tcg_id ON grading_batch_cards (batch_id, tcg_id);

-- Scans that match no card left in the batch: an id the batch does not have, or one copy more than the batch has.
CREATE TABLE IF NOT EXISTS grading_batch_extras (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid        NOT NULL REFERENCES grading_batches(id) ON DELETE CASCADE,
  tcg_id          text        NOT NULL,
  decision        text        NOT NULL CHECK (decision IN ('grading', 'stock')),
  reason          text        NOT NULL CHECK (reason IN ('not_in_batch', 'more_than_batch')),
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  scanned_by_id   uuid        REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS grading_batch_extras_batch ON grading_batch_extras (batch_id);

GRANT ALL ON grading_batches, grading_batch_cards, grading_batch_extras TO anon, authenticated;

-- Codex 11/26: once a batch is not open its scans cannot change (a stale screen, an undo after finish). Cards are inserted only by
-- the push script, so card INSERT is not guarded. FOR SHARE waits for a finish in progress, and a finish waits for scans in progress.
CREATE OR REPLACE FUNCTION grading_batch_open_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
  s text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    RAISE EXCEPTION 'a scan cannot move to another batch';
  END IF;
  SELECT status INTO s FROM grading_batches WHERE id = b FOR SHARE;
  IF s IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'grading batch is %, its scans cannot change', coalesce(s, 'missing');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS grading_cards_open_guard ON grading_batch_cards;
CREATE TRIGGER grading_cards_open_guard BEFORE UPDATE OR DELETE ON grading_batch_cards
  FOR EACH ROW EXECUTE FUNCTION grading_batch_open_guard();
DROP TRIGGER IF EXISTS grading_extras_open_guard ON grading_batch_extras;
CREATE TRIGGER grading_extras_open_guard BEFORE INSERT OR UPDATE OR DELETE ON grading_batch_extras
  FOR EACH ROW EXECUTE FUNCTION grading_batch_open_guard();

-- Finish in one transaction: close the batch first (row lock), then count from the tables, so the result is what the tables hold.
CREATE OR REPLACE FUNCTION grading_finish(p_batch uuid, p_by uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  UPDATE grading_batches SET status = 'finished', finished_at = now(), finished_by_id = p_by
   WHERE id = p_batch AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'grading batch % is not open', p_batch; END IF;
  SELECT jsonb_build_object(
      'cards', count(*),
      'grading', count(*) FILTER (WHERE decision = 'grading'),
      'stock', count(*) FILTER (WHERE decision = 'stock'),
      'left', count(*) FILTER (WHERE decision IS NULL),
      'gradingMarket', coalesce(sum(market_usd) FILTER (WHERE decision = 'grading'), 0),
      'stockMarket', coalesce(sum(market_usd) FILTER (WHERE decision = 'stock'), 0),
      'gradingCost', round(coalesce(sum(market_usd) FILTER (WHERE decision = 'grading'), 0) * 0.8, 2),
      'missing', coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'tcg_id', tcg_id, 'name', card_name, 'number', card_number,
                                                       'printing', printing, 'market', market_usd) ORDER BY seq)
                          FILTER (WHERE decision IS NULL), '[]'::jsonb))
    INTO r FROM grading_batch_cards WHERE batch_id = p_batch;
  r := r || jsonb_build_object('extras', coalesce((SELECT jsonb_agg(jsonb_build_object('tcg_id', tcg_id, 'decision', decision,
            'reason', reason, 'at', scanned_at) ORDER BY scanned_at) FROM grading_batch_extras WHERE batch_id = p_batch), '[]'::jsonb));
  UPDATE grading_batches SET result = r WHERE id = p_batch;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION grading_finish(uuid, uuid) TO anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
