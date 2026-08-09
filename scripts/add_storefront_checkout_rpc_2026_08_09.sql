-- checkout_storefront_transaction — make a counter sale ATOMIC.
--
-- WHY (Codex review 2026-08-09, P0):
-- The app writes a checkout line by line from the browser. Even with the
-- preflight gate added on 08-07, the writes themselves are separate round
-- trips, so a fault between them still leaves money recorded against a
-- partially-recorded cart. That is exactly how five July sales banked $1,081
-- more than the items behind them, worst case $1,228 collected against
-- $294.72 of goods with 19 units never deducted.
--
-- The preflight closes the COMMON cause (stale cart, already-sold rows, stock
-- that lives in a room the till cannot reach) and the red shortfall banner
-- makes the rest visible instead of silent. Neither is integrity. Only one
-- transaction around all the writes is, and that has to live in the database.
--
-- Until this ships, submitStorefrontTransaction stays best-effort and reports
-- `shortfall`. See src/lib/supabase.js — the comment there points here.
--
-- ⚠ DO NOT RUN THIS YET. This is the DESIGN, not a finished function: the
-- per-line INSERT/UPDATE bodies still live in the client (see the TODO below).
-- What it does settle is the half that cannot be done from a browser — which
-- rows to lock, in what order, and which conditions must hold — so the writes
-- can be moved down without re-litigating the concurrency model.
--
-- Run as: William (DDL — anon key cannot), once the TODO is closed.

create or replace function checkout_storefront_transaction(
  p_transaction_id  uuid,
  p_lines           jsonb,   -- [{kind, product_id|single_id|slab_id, quantity, unit_price, ...}]
  p_payments        jsonb,   -- [{payment_method_id, amount}]
  p_cashier_id      uuid,
  p_sale_date       date,
  p_transaction_type text,
  p_front_store_id  uuid,
  p_master_id       uuid
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_line     jsonb;
  v_avail    integer;
  v_status   text;
  v_recorded numeric(12,2) := 0;
begin
  -- One transaction. Any raise below rolls back every write in this call,
  -- so the drawer and the shelf can never disagree because of a partial run.

  for v_line in select * from jsonb_array_elements(p_lines) loop

    if v_line->>'kind' = 'single' then
      -- Lock the row so a second register cannot read it as sellable and
      -- overwrite this sale. Plain UPDATE ... WHERE status <> 'sold' still
      -- lets two sessions interleave their reads.
      select status into v_status
        from singles
       where id = (v_line->>'single_id')::uuid
         for update;
      if v_status = 'sold' and coalesce((v_line->>'sold_override')::boolean, false) is not true then
        raise exception 'SOLD_ALREADY:%', v_line->>'single_id';
      end if;

    elsif v_line->>'kind' = 'slab' then
      select status into v_status
        from slabs
       where id = (v_line->>'slab_id')::uuid
         for update;
      if v_status = 'sold' then
        raise exception 'SOLD_ALREADY:%', v_line->>'slab_id';
      end if;

    elsif v_line->>'kind' = 'sealed' then
      -- Lock the rows FIRST. `SELECT sum(...) ... FOR UPDATE` is rejected by
      -- PostgreSQL — FOR UPDATE cannot be applied to an aggregate — so take
      -- the locks in their own statement, ordered by location_id so two
      -- registers grabbing the same two rooms cannot deadlock against each
      -- other, then read the total from the rows we now hold.
      perform 1
        from inventory
       where product_id = (v_line->>'product_id')::uuid
         and location_id in (p_front_store_id, p_master_id)
       order by location_id
         for update;

      select coalesce(sum(quantity), 0) into v_avail
        from inventory
       where product_id = (v_line->>'product_id')::uuid
         and location_id in (p_front_store_id, p_master_id);

      if v_avail < (v_line->>'quantity')::integer
         and coalesce((v_line->>'stock_adjust')::boolean, false) is not true then
        raise exception 'NO_STOCK:%:have %:need %',
          v_line->>'product_id', v_avail, v_line->>'quantity';
      end if;
    end if;

    v_recorded := v_recorded
      + (v_line->>'quantity')::numeric * (v_line->>'unit_price')::numeric;
  end loop;

  -- TODO(William + app): move the per-line INSERT/UPDATE bodies from
  -- src/lib/supabase.js (_sellSealedLine / _sellSingleLine / _sellSlabLine and
  -- the storefront_payments insert) in here. The locking above is the half
  -- that cannot be done from the client; the writes are mechanical.

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'recorded_value', v_recorded
  );
end;
$$;

grant execute on function checkout_storefront_transaction to anon;
