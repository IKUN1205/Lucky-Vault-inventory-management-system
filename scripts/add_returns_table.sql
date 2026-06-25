-- Returns log (boss 2026-06-25): when a sale is cancelled/returned, the goods
-- are scanned back into Master Inventory and a lightweight record is kept.
-- Policy: the ORIGINAL sale record is NOT touched — this table is the audit
-- trail of returns. RLS is disabled project-wide, so no policies needed.
create table if not exists public.returns (
  id                       uuid primary key default gen_random_uuid(),
  kind                     text not null check (kind in ('single','slab','sealed')),
  item_ref                 text,                       -- tcg_id / cert_number / product_id
  item_name                text,
  quantity                 integer not null default 1,
  reason                   text,                       -- 'return' | 'cancel' | 'defective' | 'other'
  source_stream_room       text,                       -- which room/channel CAUSED the return, for stats (Packheads/Rockets/LuckyVaultUS/SlabbiePatty/Whatnot/Shows/Storefront/Online/Other)
  notes                    text,
  returned_to_location_id  uuid references public.locations(id),
  original_sale_channel    text,
  original_sale_date       date,
  original_sale_price_usd  numeric,
  returned_by_id           uuid references public.users(id),
  created_at               timestamptz not null default now()
);

create index if not exists returns_created_at_idx   on public.returns (created_at desc);
create index if not exists returns_item_ref_idx     on public.returns (item_ref);
create index if not exists returns_source_room_idx  on public.returns (source_stream_room);

-- If you already created `returns` WITHOUT source_stream_room, run this instead:
-- alter table public.returns add column if not exists source_stream_room text;
-- create index if not exists returns_source_room_idx on public.returns (source_stream_room);
