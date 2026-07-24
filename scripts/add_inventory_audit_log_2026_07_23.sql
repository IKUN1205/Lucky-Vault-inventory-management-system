-- inventory_audit_log — row-level change history for backtrace (Gary 2026-07-23:
-- "在库存里删除的话 我们还有log吗 我们可能要backtrace").
--
-- Today only slabs/stream_counts soft-delete leaves a trail; inventory.quantity
-- is overwritten in place with no old value kept. This adds a generic audit
-- table + triggers so EVERY insert/update/delete on inventory (and any
-- update/delete on slabs) stores the full old/new row with a timestamp.
-- Backtrace = query the log by table_name + row_id, ordered by changed_at.
--
-- Run as: William (DDL — anon key cannot). No app changes needed; logging is
-- transparent to all existing writers (app, scripts, PostgREST).

create extension if not exists pgcrypto;

create table if not exists inventory_audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  row_id      uuid not null,
  action      text not null,            -- INSERT / UPDATE / DELETE
  old_row     jsonb,                    -- null on INSERT
  new_row     jsonb,                    -- null on DELETE
  changed_at  timestamptz not null default now(),
  db_role     text default current_user -- which key wrote (anon/service_role)
);

create index if not exists ial_row_idx
  on inventory_audit_log (table_name, row_id, changed_at desc);
create index if not exists ial_time_idx
  on inventory_audit_log (changed_at desc);

-- security definer so DML from the anon role still logs even though anon has
-- no direct insert grant on the log table (log stays tamper-proof from anon).
create or replace function log_row_change() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into inventory_audit_log (table_name, row_id, action, new_row)
    values (tg_table_name, new.id, tg_op, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(old) is distinct from to_jsonb(new) then
      insert into inventory_audit_log (table_name, row_id, action, old_row, new_row)
      values (tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into inventory_audit_log (table_name, row_id, action, old_row)
    values (tg_table_name, old.id, tg_op, to_jsonb(old));
    return old;
  end if;
end $$;

drop trigger if exists trg_inventory_audit on inventory;
create trigger trg_inventory_audit
  after insert or update or delete on inventory
  for each row execute function log_row_change();

drop trigger if exists trg_slabs_audit on slabs;
create trigger trg_slabs_audit
  after update or delete on slabs
  for each row execute function log_row_change();

-- read access for reporting/audit scripts (read-only; no insert/update grants)
grant select on inventory_audit_log to anon, authenticated;

-- readback check after running:
--   select count(*) from inventory_audit_log;              -- 0 rows, table live
--   update inventory set last_updated = now() where id = (select id from inventory limit 1);
--   select action, changed_at from inventory_audit_log order by changed_at desc limit 1;
