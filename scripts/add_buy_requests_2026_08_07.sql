-- buy_requests — approve the money BEFORE it leaves (Gary 2026-08-07: "buy record
-- 我想以后走个request 就是他们先put in buy record request 我们再批钱去买 这个逻辑
-- 我们check一下他们的market prices然后再跑").
--
-- WHY, with the specific failures this is built against — all found in the data,
-- not imagined:
--
--  1. OP-09, 08-03. Entered as 530 boxes @ $2.00 instead of 2 @ $530.00.
--     BOTH WAYS THE TOTAL IS $1,060, so no amount-based reconciliation can ever
--     see it — the bank matched, the receipt matched, the batch total matched.
--     It surfaced two days later only because buy_review compared UNIT price to
--     market. That is why market_ratio is computed per LINE, on unit_price, and
--     why it is stored rather than recomputed: an approval has to be auditable
--     against the price that was known at the time.
--  2. The $8,335 batch, 08-01. $4,000 paid, $4,335 still owed, and the schema
--     had nowhere to say so — only Frank knew. Hence paid_total / outstanding.
--  3. 110 storefront `buy` rows carry no product_id at all: we know money left,
--     not what for. Hence product_id NOT NULL on a request line.
--  4. The 08-05 CN shipment was booked from a verbal "110 boxes" when the CN
--     outbound sheet said 30. Hence source_ref — where the number came from.
--
-- Backtested over the 30 days to 2026-08-07: of 172 purchase lines, the ratio
-- check flags 5 worth $4,867, the largest being 398 packs bought at 143% of
-- market ($3,781). It can only see 49 of those 172 lines today — the rest have
-- no market price at all — which is why product_price_sources has to land too.
--
-- DELIBERATELY NOT ENFORCED: a line with no market price is labelled
-- 'unverifiable', never blocked. Two thirds of what we buy (all CN, most JP) has
-- no priceable source, and a gate that blocks them would push buying back into
-- spreadsheets — the same way blocking intake would push staff into editing
-- inventory by hand. Make it visible; let a person decide.
--
-- Run as: William (DDL — anon key cannot).

create extension if not exists pgcrypto;

create table if not exists buy_requests (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'submitted',
                    -- submitted -> approved | rejected -> ordered -> received
  requested_by_id   uuid references users(id),
  requested_at      timestamptz not null default now(),
  vendor            text,
  source_country    text,                         -- US / Japan / China
  currency          text not null default 'USD',  -- CNY lives here, not in notes
  fx_rate_to_usd    numeric(12,6),                -- rate used, so totals reconcile later
  requested_total   numeric(12,2),
  source_ref        text,                         -- where the numbers came from:
                                                  -- invoice #, CN Base row, "verbal - Gary"
  note              text,

  approved_by_id    uuid references users(id),
  approved_at       timestamptz,
  approved_total    numeric(12,2),                -- may be LESS than requested
  reject_reason     text,

  paid_total        numeric(12,2) not null default 0,
  payment_method_id uuid references payment_methods(id),
  last_paid_at      timestamptz,

  created_at        timestamptz not null default now(),
  deleted           boolean not null default false,
  deleted_at        timestamptz,
  deleted_reason    text
);
create index if not exists buy_requests_status_idx on buy_requests (status, requested_at desc);

-- A request cannot be approved without someone's name and a number on it.
alter table buy_requests drop constraint if exists buy_requests_approval_complete;
alter table buy_requests add constraint buy_requests_approval_complete
  check (status <> 'approved'
         or (approved_by_id is not null and approved_at is not null
             and approved_total is not null));
-- Rejection needs a reason, or nobody learns anything from it.
alter table buy_requests drop constraint if exists buy_requests_reject_reason;
alter table buy_requests add constraint buy_requests_reject_reason
  check (status <> 'rejected' or coalesce(reject_reason, '') <> '');

create table if not exists buy_request_lines (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references buy_requests(id) on delete cascade,
  -- NOT NULL on purpose: "we spent money on something" is not a record.
  product_id     uuid not null references products(id),
  quantity       integer not null check (quantity > 0),
  unit_price     numeric(12,2) not null check (unit_price >= 0),
  line_total     numeric(12,2) generated always as (quantity * unit_price) stored,

  -- Snapshot of what the market looked like WHEN THIS WAS APPROVED. Not a live
  -- lookup: the approval must stay auditable after prices move.
  market_price   numeric(12,2),
  market_source  text,          -- tcg | ebay_bin_ask | kaitori | 130point | manual
  market_ratio   numeric(8,4),  -- unit_price / market_price
  flag           text,          -- ok | suspect | unverifiable
  flag_note      text,

  acquisition_id uuid references acquisitions(id),   -- filled once actually bought
  created_at     timestamptz not null default now()
);
create index if not exists buy_request_lines_req_idx on buy_request_lines (request_id);
create index if not exists buy_request_lines_flag_idx on buy_request_lines (flag)
  where flag <> 'ok';

-- What is still owed, per request. This is the number nobody could see on 08-01.
create or replace view buy_requests_outstanding as
select r.id, r.vendor, r.status, r.requested_at,
       r.approved_total, r.paid_total,
       coalesce(r.approved_total, 0) - r.paid_total as outstanding
from buy_requests r
where not r.deleted
  and r.status in ('approved', 'ordered', 'received')
  and coalesce(r.approved_total, 0) - r.paid_total <> 0;

grant select, insert, update on buy_requests, buy_request_lines to anon;
grant select on buy_requests_outstanding to anon;
