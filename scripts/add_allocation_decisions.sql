-- ============================================================================
-- allocation_decisions: log every smart allocator action
-- ============================================================================
-- Captures what the system suggested vs what the user actually decided, so
-- future iterations (potentially LLM-driven) can refine the baseline based on
-- past performance. Read-side queries look up post-decision sales in
-- platform_sales / storefront_sales by location to score "how well did
-- that allocation match actual demand."
--
-- Nullable + additive. No backfill. Safe to run any time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS allocation_decisions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by_id               UUID REFERENCES users(id) ON DELETE SET NULL,

  product_id                  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_category            TEXT,     -- redundant for fast category-level queries
  product_brand               TEXT,

  qty_received                INT NOT NULL,

  -- The system's suggestion at decision time, shape:
  -- [{ location_id, location_name, daily_velocity, current_stock, target, suggested_send }]
  suggested_split             JSONB,

  -- The final per-location split the user committed to, shape:
  -- [{ location_id, location_name, actual_send }]
  -- For skip actions this carries the user's last-edit numbers (or the
  -- baseline if they didn't edit), but no real Moves happened.
  final_split                 JSONB,

  -- What the user did
  action                      TEXT NOT NULL CHECK (action IN (
    'apply_suggested',    -- "一键挪过去" — used the baseline as-is
    'apply_adjusted',     -- "我手动改" → Apply changes — used edited numbers
    'skip',               -- "先不动" — no inventory change, advisory only
    'batch_apply_all'     -- footer "Apply all (use suggested)"
  )),

  -- Snapshot of suggestion parameters for replay
  days_coverage               INT,
  is_dying_flag               BOOLEAN,
  total_sold_7d_at_decision   INT,

  notes                       TEXT
);

CREATE INDEX IF NOT EXISTS idx_alloc_decisions_product_time
  ON allocation_decisions (product_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_alloc_decisions_category_time
  ON allocation_decisions (product_category, decided_at DESC);
