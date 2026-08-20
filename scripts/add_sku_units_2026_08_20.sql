-- =====================================================================
-- SKU UNITS  --  "every SKU must say what one of it IS"
-- Gary 2026-08-19: "sku 需要 unit"
--
-- HOW TO RUN (no token needed):
--   https://supabase.com/dashboard/project/dqreqevbjszercgackuc/sql/new
--   paste this whole file, press Run.
--
-- Additive only. Adds columns and one table. Touches no existing row, drops
-- nothing, rewrites no data. Safe to run while the app is live.
-- =====================================================================
--
-- WHY
-- ---
-- Five incidents in three days, all the same defect: a row carries a number
-- and nothing says what the number counts.
--
--   (In Bag)        packs_per_box NULL -> read as 1 pack, really 30    30x
--   (Case)          printed "1 box",   a case holds 12 boxes           12x
--   Collection Box  624+624 packs booked from 132 boxes                2.3x
--   TikTok          multiplier lived in sku_name text ("10 Pack")      10x
--   TikTok          a bare number is a SLOT number, not a quantity     84x
--
-- Every one of them keeps the money correct -- total price, bank, batch total
-- all reconcile -- so no amount-level check can ever catch them. Only a unit
-- can.
--
-- FOUR DECISIONS, each paid for by one of the incidents above
-- ----------------------------------------------------------
-- 1. packs_per_unit is ALWAYS counted in PACKS. Never in boxes.
--    This is the whole point. `packs_per_box = 12` on a One Piece (Case) meant
--    twelve BOXES, and the same column on a booster box meant twelve PACKS.
--    One column, two meanings, inside one product family. A case is now
--    12 * 24 = 288 packs and there is nothing left to misread.
--
-- 2. packs_per_box is NOT touched and NOT deprecated here.
--    278 breakable products, BreakBox.jsx, JapanAddProduct.jsx and the JP SKU
--    importer all read it today. Redefining a live column mid-flight is how
--    the 30x error happened in the first place. Readers move over one at a
--    time, deliberately, and the old column stays until the last one is gone.
--
-- 3. A number with no witness is not a number.
--    The CHECK below refuses a packs_per_unit that nobody signed for. An
--    earlier migration allowed confidence='verified' without a verified_by and
--    it made the field decorative.
--
-- 4. Composition is a TABLE, not a column, because one box can yield two
--    DIFFERENT products. An OP Illustration Box gives 2x OP-15 packs AND
--    2x OP-16 packs. box_breaks has a single pack_product_id, so that break
--    is literally unrecordable today -- which is exactly why 1,248 packs
--    entered as purchase rows instead, and why no arithmetic could check them.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- It does not add NOT NULL. ~500 products have no unit yet and a constraint
-- that blocks writes before the backfill exists would just teach people to
-- type anything that gets past it. The gate goes in the app AFTER the values
-- are in. Until then the pressure comes from a report, not a wall.
-- =====================================================================

begin;

-- ---------------------------------------------------------------- columns
alter table products add column if not exists unit_kind          text;
alter table products add column if not exists packs_per_unit     integer;
alter table products add column if not exists unit_verified_by   text;
alter table products add column if not exists unit_verified_at   timestamptz;

comment on column products.unit_kind is
  'What ONE row of this product physically is: pack/blister/box/case/bag/... '
  'Never inferred. NULL means unknown and must never be read as "pack".';
comment on column products.packs_per_unit is
  'How many PACKS one unit contains. ALWAYS in packs -- a case is boxes*packs_per_box, '
  'not the box count. NULL means unknown; unknown must block, never default to 1.';
comment on column products.unit_verified_by is
  'Who established packs_per_unit. Required whenever packs_per_unit is set.';

-- Spelled out rather than an enum type so a new packaging format can be added
-- by one ALTER instead of a type migration.
alter table products drop constraint if exists products_unit_kind_chk;
alter table products add constraint products_unit_kind_chk check (
  unit_kind is null or unit_kind in (
    'pack',        -- one sealed booster pack. the atomic unit everything else counts in
    'blister',     -- sleeved / blister pack, sold as one but holds packs
    'box',         -- booster box
    'case',        -- holds BOXES. packs_per_unit is still packs.
    'bag',         -- trash-bag of loose packs; a box's worth with the box thrown away
    'bundle',      -- multi-pack retail bundle
    'tin',
    'deck',
    'collection',  -- collection / illustration / gift box. may yield MORE THAN ONE pack sku
    'single',      -- one card
    'slab',        -- one graded card
    'accessory',   -- sleeves, binders, card savers -- has no pack count and never will
    'other'
  )
);

-- A count nobody signed for is a rumour. Both directions are checked so the
-- witness columns cannot be filled in for a value that does not exist either.
alter table products drop constraint if exists products_unit_witnessed_chk;
alter table products add constraint products_unit_witnessed_chk check (
  (packs_per_unit is null and unit_verified_by is null and unit_verified_at is null)
  or
  (packs_per_unit is not null and packs_per_unit > 0
     and unit_verified_by is not null and unit_verified_at is not null)
);

create index if not exists products_unit_kind_idx on products (unit_kind);

-- ------------------------------------------------------- composition table
-- One row per (parent, child). An OP Illustration Box gets TWO rows.
create table if not exists product_contents (
  id                uuid primary key default gen_random_uuid(),
  parent_product_id uuid not null references products(id),
  child_product_id  uuid not null references products(id),
  qty_per_parent    integer not null check (qty_per_parent > 0),
  verified_by       text    not null,
  verified_at       timestamptz not null default now(),
  note              text,
  deleted           boolean not null default false,
  deleted_at        timestamptz,
  deleted_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- No ON DELETE CASCADE anywhere above, on purpose. Product rows are never
  -- deleted here (stock goes to zero instead), and a cascade would hard-delete
  -- a mapping, which the delete rule forbids. Soft-delete columns are provided
  -- so retiring a composition leaves the evidence behind.
  constraint product_contents_not_self check (parent_product_id <> child_product_id),
  constraint product_contents_soft_delete_witnessed check (
    deleted = false or (deleted_at is not null and deleted_reason is not null)
  )
);

create unique index if not exists product_contents_pair_uidx
  on product_contents (parent_product_id, child_product_id)
  where deleted = false;
create index if not exists product_contents_parent_idx on product_contents (parent_product_id);
create index if not exists product_contents_child_idx  on product_contents (child_product_id);

comment on table product_contents is
  'What a sealed product turns into when broken. One row per output product, '
  'because one box can yield several different pack SKUs -- an OP Illustration '
  'Box gives 2x OP-15 packs and 2x OP-16 packs, which box_breaks.pack_product_id '
  'cannot express. Breaking N parents must produce N*qty_per_parent of each child.';

-- updated_at does not maintain itself. An earlier migration shipped the column
-- without the trigger and it silently froze at insert time.
-- Named for this table on purpose. A generic set_updated_at() is a name other
-- migrations reach for too, and CREATE OR REPLACE would silently overwrite
-- whatever body they installed, changing the behaviour of triggers nobody in
-- this file is looking at.
create or replace function product_contents_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists product_contents_set_updated_at on product_contents;
create trigger product_contents_set_updated_at
  before update on product_contents
  for each row execute function product_contents_touch_updated_at();

-- ------------------------------------------------------------------ view
-- What still has no unit, biggest exposure first. This is the pressure that
-- replaces a NOT NULL we cannot afford yet.
create or replace view products_missing_unit as
select
  p.id,
  p.name,
  p.brand,
  p.language,
  p.type,
  p.variant,
  p.packs_per_box                          as legacy_packs_per_box,
  p.unit_kind,
  p.packs_per_unit,
  coalesce(sum(i.quantity), 0)             as on_hand,
  coalesce(sum(i.quantity * i.avg_cost_basis), 0) as book_value_usd
from products p
left join inventory i on i.product_id = p.id
where p.unit_kind is null or (p.packs_per_unit is null and p.unit_kind not in ('pack','single','slab','accessory'))
group by p.id, p.name, p.brand, p.language, p.type, p.variant,
         p.packs_per_box, p.unit_kind, p.packs_per_unit
order by book_value_usd desc, on_hand desc;

comment on view products_missing_unit is
  'SKUs that cannot answer "what is one of these". A pack is its own unit so it '
  'needs no pack count; singles, slabs and accessories never have one.';

commit;

-- =====================================================================
-- VERIFY  (run after, expect the columns and table to exist and be empty)
-- =====================================================================
-- select column_name, data_type from information_schema.columns
--   where table_name = 'products' and column_name in
--     ('unit_kind','packs_per_unit','unit_verified_by','unit_verified_at');
--
-- select count(*) as compositions from product_contents;                 -- 0
-- select count(*) as still_missing_a_unit from products_missing_unit;
-- select * from products_missing_unit limit 25;
--
-- -- the witness rule really bites (this MUST fail):
-- -- update products set packs_per_unit = 30 where id = (select id from products limit 1);
--
-- =====================================================================
-- ROLLBACK  (only if the migration itself is wrong)
-- =====================================================================
-- Deliberately refuses to run once anybody has filled anything in. Dropping a
-- column that already holds the only record of what a unit is would destroy the
-- very thing this migration exists to capture.
--
-- do $$
-- declare n_units int; n_contents int;
-- begin
--   select count(*) into n_units    from products where unit_kind is not null
--                                                     or packs_per_unit is not null;
--   select count(*) into n_contents from product_contents where deleted = false;
--   if n_units > 0 or n_contents > 0 then
--     raise exception 'refusing to roll back: % products carry a unit and % compositions exist. '
--                     'Export them before dropping anything.', n_units, n_contents;
--   end if;
--   drop view if exists products_missing_unit;
--   drop table if exists product_contents;
--   alter table products drop constraint if exists products_unit_witnessed_chk;
--   alter table products drop constraint if exists products_unit_kind_chk;
--   alter table products drop column if exists unit_verified_at;
--   alter table products drop column if exists unit_verified_by;
--   alter table products drop column if exists packs_per_unit;
--   alter table products drop column if exists unit_kind;
-- end $$;
