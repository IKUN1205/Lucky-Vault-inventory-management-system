-- ============================================================================
-- Product images — one-time infra (William) · 2026-07-20
-- ============================================================================
-- Mirrors the EXISTING high-value-card photo setup (high_value_items.photo_url
-- + the `high-value-photos` public bucket). After this runs, staff can attach
-- a photo on the Add Product page; it uploads from the browser (anon key, the
-- same call already used for high-value photos) and shows as the product
-- thumbnail everywhere on next page load.
--
-- Two things: (1) a column on products, (2) a public Storage bucket + policies.
-- If unsure about the Storage policies, just COPY whatever the working
-- `high-value-photos` bucket already has, changing the bucket id.
-- ============================================================================

-- 1) Column to hold the public image URL (same idea as high_value_items.photo_url)
alter table public.products add column if not exists image_url text;

-- 2) Public Storage bucket for product images
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- 3) RLS on storage.objects for this bucket — mirror high-value-photos:
--    anon may upload; anyone may read (public bucket).
--    (Skip any policy that already exists / adjust role names to match yours.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'product-images anon upload'
  ) then
    create policy "product-images anon upload"
      on storage.objects for insert
      to anon, authenticated
      with check (bucket_id = 'product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'product-images public read'
  ) then
    create policy "product-images public read"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'product-images');
  end if;
end $$;

-- Readback checks (should return the column + the bucket row):
-- select column_name from information_schema.columns
--   where table_name='products' and column_name='image_url';
-- select id, public from storage.buckets where id='product-images';
