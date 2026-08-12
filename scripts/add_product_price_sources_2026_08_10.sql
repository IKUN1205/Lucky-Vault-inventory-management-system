-- product_price_sources — where a product's market price is allowed to come from.
--
-- Gary 2026-08-07: "市价我们就需要建立系统 用我们master sealed 入库的时候
-- 假设没有sku 我们就加一个到master sealed list 做为映射"
--
-- Today's price pins live in JSON files keyed by PRODUCT NAME, and that is the
-- defect this table exists to remove. Three failures, all observed:
--
--   * Renaming 164 One Piece products to add [EN]/[JP] prefixes in July silently
--     orphaned 90 of the 286 pins in sku_urls.json (31%) — the names they keyed
--     on no longer existed and nothing reported it.
--   * ストームエメラルダ sat unmapped in kaitori_ja_map.json for weeks while the
--     Runto board quoted it daily. 655 boxes, our largest position, had no
--     Japanese price because one mapping line said null (fixed 2026-08-10).
--   * Abyss Eye's box and pack are pinned but "Abyss Eye (In Bag)" is not, and
--     Ninja Spinner's "(Open)" and loose packs are not — $3,198 unpriceable
--     purely because a variant carries its own name.
--
-- So: keyed on product_id, never on name. Renaming a product cannot break it.
--
-- One product may legitimately have several sources (TCG for the US line,
-- kaitori for the Japanese bid, eBay BIN as a ceiling), so this is one row per
-- (product, source) and the consumer picks by priority.
--
-- Safe to re-run.

create table if not exists product_price_sources (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,

  -- where the number comes from. Kept as text + CHECK rather than an enum so
  -- adding a source is a migration, not an enum surgery (CN costs already hit
  -- the currency-enum wall and had to be written into notes instead).
  source        text not null check (source in (
                  'tcg',        -- TCGplayer product id
                  'kaitori',    -- Japanese buyback board (Runto / motosan)
                  'snkrdunk',
                  'ebay_bin',   -- Buy It Now — an ASK, never a sale
                  'ebay_sold',
                  '130point',   -- real completed medians
                  'manual')),

  -- the identifier within that source: a TCGplayer product id, the Japanese
  -- board title, an eBay query string. Text because these are not all numeric.
  source_key    text not null,

  -- 'sale'  = a completed transaction (130point, eBay sold, TCG market)
  -- 'ask'   = someone's asking price (eBay BIN, TCG listings) — an UPPER BOUND
  -- 'bid'   = what a buyer will pay us (kaitori) — a LOWER bound
  -- Gary 2026-08-07: "必须在库里标明这条价是'要价'还是'成交',否则会把挂牌价
  -- 当市价用". Storm Emeralda is the case in point: kaitori bid ¥18,500 and
  -- eBay ask $124.97 agree, while TCG quoted $187.68 — 51% higher. Consumers
  -- must be able to tell which kind they are holding.
  price_kind    text not null default 'sale'
                check (price_kind in ('sale', 'ask', 'bid')),

  priority      smallint not null default 100,   -- lower wins when several exist
  active        boolean not null default true,

  -- Pinning is a human act and must stay auditable: four separate EN/JP/CN
  -- mismatches were caught by hand before they reached the price sheet.
  verified_by   text,
  verified_at   timestamptz,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One key per source per product. Re-pinning the same thing is an update, not a
-- second row, so a product can never carry two contradictory TCG ids at once.
create unique index if not exists product_price_sources_uniq
  on product_price_sources (product_id, source);

create index if not exists product_price_sources_lookup
  on product_price_sources (product_id) where active;

create index if not exists product_price_sources_source
  on product_price_sources (source, source_key);

-- Products with stock and no price source at all. This is the working list for
-- "入库时该 SKU 没有价源就进待办" — deliberately a VIEW and not a constraint:
-- blocking intake on a missing price source would push people to edit inventory
-- by hand instead, which is how the quantity-with-no-paper-trail problem
-- started. Surface it, do not gate on it.
create or replace view products_needing_price_source as
select
  p.id                as product_id,
  p.name,
  p.brand,
  p.language,
  p.type,
  sum(i.quantity)     as units_on_hand,
  sum(i.quantity * coalesce(i.avg_cost_basis, 0)) as cost_on_hand
from products p
join inventory i on i.product_id = p.id and i.quantity > 0
where not exists (
  select 1 from product_price_sources s
  where s.product_id = p.id and s.active
)
group by p.id, p.name, p.brand, p.language, p.type
order by cost_on_hand desc;

comment on table product_price_sources is
  'Per-product price source pins, keyed on product_id so renaming a product '
  'cannot orphan them (renaming 164 One Piece SKUs in July 2026 silently broke '
  '90 of 286 name-keyed pins). price_kind separates a completed sale from an '
  'ask and from a buyback bid — mixing them reads a listing price as market.';

comment on column product_price_sources.price_kind is
  'sale = completed transaction; ask = listing price, an upper bound; '
  'bid = buyback offer, a lower bound. Never display an ask as market price.';
