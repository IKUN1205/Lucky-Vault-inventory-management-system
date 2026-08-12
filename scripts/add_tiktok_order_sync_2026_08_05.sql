-- tiktok order sync — the four tables tiktok/apply_orders_to_inventory.py has
-- always expected and that were never created (Gary 2026-08-05: "我们应该按照
-- tiktok 的 api order pull 的 sale 来算 discrepancy 还是就让他们记录").
--
-- WHY THIS MATTERS
-- A stream count measures the previous streamer's sales as expected − counted.
-- `expected` is the room's inventory, and nothing ever decrements it for a
-- TikTok sale, so every count has to absorb sales, shrink and unrecorded
-- transfers in one number. When a room ends up holding MORE than the books say,
-- the count can never come out negative and the sale is booked as zero:
-- 42 OP-13 blisters left Packheads 08-04..08-06 recorded as 0 sold.
--
-- With these tables the sync deducts named-product sales as they happen, so
-- `expected` already includes them and the count is left measuring only what
-- genuinely cannot be pulled from the API.
--
-- WHAT THE API CAN AND CANNOT COVER (measured 2026-08-05, last 7 days,
-- tiktok/_sku_coverage_probe2.py):
--   PackHeadsTCG     855 units over 34 distinct titles — roughly half name a
--                    real product, the rest are "$1 START PACKS" style slots
--   RocketsHQ        195 units over 6 titles — mostly "PACK AUCTIONS!"
--   VaultTcgAuction  346 units — 100% slots
-- Live-auction slot listings never say which physical SKU left the shelf, so
-- this sync REPLACES the count for named products only. It does not and cannot
-- replace it for auction rooms.
--
-- Run as: William (DDL — the anon key cannot). No app changes required; the
-- sync is a standalone script.

create extension if not exists pgcrypto;

-- Raw order headers, as pulled from /order/202309/orders/search.
create table if not exists tiktok_orders (
  order_id      text primary key,
  shop_name     text not null,              -- PackHeadsTCG / RocketsHQ / VaultTcgAuction
  status        text,
  create_time   timestamptz,
  update_time   timestamptz,
  raw           jsonb,
  synced_at     timestamptz not null default now()
);
create index if not exists tiktok_orders_shop_time_idx
  on tiktok_orders (shop_name, create_time desc);
create index if not exists tiktok_orders_status_idx on tiktok_orders (status);

-- One row per line item. line_id is the unit of idempotency downstream.
create table if not exists tiktok_order_items (
  line_id       text primary key,
  order_id      text not null references tiktok_orders(order_id) on delete cascade,
  shop_name     text not null,
  product_id_tt text,                       -- TikTok's product id
  sku_id        text,
  product_name  text,
  sku_name      text,
  quantity      integer not null default 1,
  sale_price    numeric(12,2),
  currency      text,
  create_time   timestamptz,
  synced_at     timestamptz not null default now()
);
create index if not exists tiktok_order_items_order_idx on tiktok_order_items (order_id);
create index if not exists tiktok_order_items_title_idx on tiktok_order_items (product_name);
create index if not exists tiktok_order_items_time_idx  on tiktok_order_items (create_time desc);

-- Listing title -> our SKU. `reviewed` is the safety gate: the sync applies a
-- mapping ONLY when a human has confirmed it, so a fuzzy title match can never
-- silently decrement the wrong product.
--
-- `units_per_listing` handles multi-pack listings ("OP13 blister ... 10 PACKS"
-- is 10 units of stock off one line). `is_slot` marks auction/$1 listings that
-- deliberately map to nothing — recording them keeps the unmapped report from
-- re-raising the same known-unmappable titles every run.
create table if not exists tiktok_product_map (
  id                uuid primary key default gen_random_uuid(),
  shop_name         text not null,
  product_name      text not null,
  sku_name          text,
  product_id        uuid references products(id),
  location_id       uuid references locations(id),   -- which room it ships from
  units_per_listing integer not null default 1,
  is_slot           boolean not null default false,
  reviewed          boolean not null default false,
  reviewed_by       text,
  reviewed_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now()
);
create unique index if not exists tiktok_product_map_key_idx
  on tiktok_product_map (shop_name, product_name, coalesce(sku_name, ''));
-- A reviewed mapping must resolve to something: either a real SKU, or an
-- explicit "this is a slot listing". Half-filled rows are what let a sync
-- decrement nothing and report success.
alter table tiktok_product_map drop constraint if exists tiktok_product_map_reviewed_resolves;
alter table tiktok_product_map add constraint tiktok_product_map_reviewed_resolves
  check (not reviewed or is_slot or (product_id is not null and location_id is not null));

-- Idempotency ledger: one row per line actually applied to inventory. The sync
-- re-reads recent orders every run, so this is what stops a line being
-- decremented twice.
create table if not exists tiktok_applied_lines (
  line_id      text primary key references tiktok_order_items(line_id) on delete cascade,
  product_id   uuid not null references products(id),
  location_id  uuid not null references locations(id),
  units        integer not null,
  movement_id  uuid references movements(id),
  applied_at   timestamptz not null default now()
);
create index if not exists tiktok_applied_lines_applied_idx
  on tiktok_applied_lines (applied_at desc);

-- The script writes movements into a "Sold - <room>" virtual location. Six such
-- rows exist (eBay ×2, Whatnot ×2, Storefront, TikTok RocketsHQ) and not one has
-- ever received a movement; Packheads has no row at all.
insert into locations (name, type, active)
select v.name, 'Sold', true
from (values ('Sold - TikTok Packheads')) as v(name)
where not exists (select 1 from locations l where l.name = v.name);

grant select, insert, update on tiktok_orders, tiktok_order_items,
  tiktok_product_map, tiktok_applied_lines to anon;
