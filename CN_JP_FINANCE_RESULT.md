# CN/JP Finance — Implementation Result

**Scope delivered (app-side only, as assigned):**
- **Task 1** — `ChinaAcquisitions` Chinese-UI page mirroring `JapanAcquisitions.jsx`
- **Task 2 (UI)** — shared slab cert quick-intake (cert + amount + currency → writes `slabs` with `price_check='pending'`), mounted on **both** the China and Japan acquisition pages
- **Task 3 (form)** — `fx_transfers` CNY/USD page (RMB backfill queue + manual entry)

**Constraints honored:** feature-flagged (default **OFF**), minimally invasive (additive), **no git push, no deploy**, and **all DDL parked un-executed** in `sql/cn_jp_finance.sql`.

**Build:** `npm run build` → ✅ `1474 modules transformed … built in 3.68s`, no errors (the pre-existing 500 kB chunk-size warning is unrelated).

---

## CHANGELOG — CN quick-add product "+ 新货" (2026-07-06)

Added inline provisional-product creation to the China Acquisitions page so the China team isn't blocked when they buy a simplified-Chinese SKU not yet in the catalog (US side asleep). Per `CN_QUICKADD_BRIEF.md` (Gary-approved). **Build re-verified** (`npm run build` → ✅ 1474 modules, 3.73s, no errors).

- **`src/pages/ChinaAcquisitions.jsx`** — product dropdown is scoped to `language==='CN'`; a 「+ 新货」button by the Items header opens a new **`CnQuickAddProduct`** modal. Fields (Chinese): 中文名* / 类型* (原盒→Sealed·Booster Box / 散包→Pack·Booster Pack / 礼盒→Sealed·Collection Box / 其他→Sealed·Other) / 品牌 (宝可梦→Pokemon, 海贼王→One Piece, 其他 free-text) / 条码. Creates via existing **`createProduct`** with `language:'CN', active:true, breakable:false`, writing the Chinese to **both `name` and `aliases[0]`**. On success the product is added to the options and **auto-selected into the first empty line** (or a fresh line).
- **Duplicate guard** — before insert, case-insensitive match of 中文名 against existing CN products' `name`+`aliases`; a similar hit is shown ("可能已存在类似产品…") and creation then requires an explicit 「仍然创建」.
- **US-side Lark** — fire-and-forget `type:'cn_new_product'` → new `buildMessage` case in **`api/lark-notify.js`** posts `🇨🇳 中国新建产品: <中文名> (<类型>) — 待补英文名/归类` to the main (US-visible) group (falls through like `add_product`).
- **Normalization convention (no DDL)** — a CN product whose `name` still contains CJK = not yet normalized by US. US later renames `name`→English + fixes category; the Chinese survives in `aliases[0]` so China search/display are unaffected. Documented in a comment on `CnQuickAddProduct`.
- No new columns / DDL; reused `createProduct` (no second insert path). `sql/cn_jp_finance.sql` unchanged.

---

## CHANGELOG — Orchestrator review fixes (2026-07-05)

All 3 MUST-FIX defects + both "also worth taking" items applied; build re-verified.

**DEFECT 1 — `currency_code` enum lacked `RMB`.** `createChinaAcquisition` writes `currency:'RMB'`, but `acquisitions.currency` is enum `currency_code` (only `JPY`/`USD` live → 400 22P02). Added a standalone pre-transaction `ALTER TYPE currency_code ADD VALUE IF NOT EXISTS 'RMB';` next to the `region` ALTER in `sql/cn_jp_finance.sql`. *(This is distinct from the `region` enum, which backs `vendors.country`/`source_country`.)*

**DEFECT 2 — `slabs.price_check` CHECK too narrow.** The existing `slab-inventory/price_check_cron.py` (every 2h) PATCHes verdicts `ok`/`warn`/`over`/`nodata`, which the old `CHECK IN ('pending','done')` would have rejected. Widened to `('pending','done','ok','warn','over','nodata')`; DEFAULT stays `'done'`.

**DEFECT 3 — `fx_transfers` schema divergence.** Replaced my invented `transfer_date/amount_cny/rate_to_usd/amount_usd/direction` (with `amount_cny NOT NULL`, which blocked automation inserts) with the **decided** shared schema: `date, usd_amount, cny_amount, rate, counterparty, bank_txn_ref UNIQUE, purpose, note, …` + `CHECK (usd_amount IS NOT NULL OR cny_amount IS NOT NULL)`. Architecture: **lv-finance auto-inserts the USD leg from US bank feeds; the China team backfills the RMB leg.** Rate = **CNY per USD** = `cny_amount / usd_amount`.
- `src/lib/supabase.js`: `fetchFxTransfers({limit,pendingBackfill})`, new **`backfillFxTransfer(id,{cny_amount})`** (sets `cny_amount` + derived `rate`), `createFxTransfer` rewritten to the new columns (≥1 amount required, rate auto when both present), `undoFxTransfer` unchanged.
- `src/pages/FxTransfers.jsx`: rebuilt with **(a) primary RMB-backfill queue** (`cny_amount IS NULL` rows; enter RMB → PATCH) and **(b) secondary manual full-row insert**; Chinese-labeled; rate shown as CNY per USD; dup `bank_txn_ref` handled.

**Also worth taking:**
- **`fetchChinaVendors`** now filters **`country='China'` only** (dropped the `country.is.null` legacy fallback that pulled US/legacy vendors in). Added a hint under the China vendor dropdown: *"没有?去 Vendors 页把供应商国家设为 China,或点上方「+ New」新建。"*
- **`source_country` enum hedge** kept in the SQL comments (if `acquisitions.source_country` is a different enum than `vendors.country`, repeat the `ADD VALUE`).

---

## Files

### New
| File | Purpose |
|---|---|
| `src/lib/featureFlags.js` | `FEATURE_FLAGS.cnJpFinance = import.meta.env.VITE_ENABLE_CN_JP_FINANCE === 'true'` (default OFF) |
| `src/components/SlabQuickIntake.jsx` | Shared cert+amount+currency intake → `createSlab({ price_check:'pending', acquisition_cost_local, acquisition_currency, acquisition_cost_usd })`, fires `notifySlabsLark` |
| `src/pages/ChinaAcquisitions.jsx` | Full mirror of Japan page (RMB / `cn_vendor` / `source_country='China'`); `EditAcquisitionModal`; mounts `SlabQuickIntake`; China-only vendor hint |
| `src/pages/FxTransfers.jsx` | RMB-backfill queue + manual entry + recent list (new shared schema) |
| `sql/cn_jp_finance.sql` | **Un-executed** DDL (see below) |

### Modified (all additive)
| File | Change |
|---|---|
| `src/lib/supabase.js` | +China data layer (`fetchChinaWarehouseLocation`, `fetchChinaVendors` [China-only], `fetchChinaAcquisitions`, `create/update/undoChinaAcquisition`, private `fetchChinaProductStock`). +FX (`fetchFxTransfers`, `backfillFxTransfer`, `createFxTransfer`, `undoFxTransfer`, `fxRate` helper) |
| `src/App.jsx` | Imports + **flag-gated** routes `/cn/acquisitions`, `/cn/fx-transfers` |
| `src/components/Layout.jsx` | Flag-gated sidebar section **China 🇨🇳** (中国进货, 外汇划转) |
| `src/pages/UserManagement.jsx` | Flag-gated **China 🇨🇳** entries in the `PAGE_SECTIONS` permission registry |
| `src/pages/JapanAcquisitions.jsx` | Mounts `SlabQuickIntake` (flag-gated → **unchanged when OFF**) |
| `src/pages/ChinaAcquisitions.jsx` + `api/lark-notify.js` | **CN quick-add "+ 新货"** (see 2026-07-06 changelog): `CnQuickAddProduct` modal + `cn_new_product` Lark message |

---

## DDL in `sql/cn_jp_finance.sql` (NOT executed — apply manually before enabling)

Idempotent, wrapped in `BEGIN/COMMIT` (except the two enum changes, which Postgres requires outside a transaction). It:
1. **Enum adds (run each first, on their own):** `region` += `'China'`, and `currency_code` += `'RMB'`.
2. Inserts the **`China Warehouse`** location.
3. **Widens `acquisitions.origin` CHECK** to add `'cn_vendor'` (+ reserved `'cn_to_us_shipment'`) via a `DO` block that drops the auto-named check and re-adds a named `acquisitions_origin_check`.
4. **`slabs`** gains `price_check text NOT NULL DEFAULT 'done' CHECK (pending|done|ok|warn|over|nodata)`, `acquisition_cost_local numeric(12,2)`, `acquisition_currency text (USD|JPY|RMB)`, + partial index on `price_check='pending'`.
5. Creates **`fx_transfers`** per the decided shared schema (`date`, `usd_amount`, `cny_amount`, `rate`, `counterparty`, `bank_txn_ref UNIQUE`, `purpose`, `note`, soft-delete cols, `CHECK` ≥1 amount).

Verification queries are appended as comments in the file.

---

## Rollout checklist (orchestrator)
1. Review `sql/cn_jp_finance.sql`; confirm enum type names (`region`, `currency_code`) and that `acquisitions.source_country` shares `region` (else add `'China'` to its enum too).
2. Run **both `ALTER TYPE … ADD VALUE` statements first/alone**, then the `BEGIN…COMMIT` block.
3. Set `VITE_ENABLE_CN_JP_FINANCE=true` in `.env.local` / deploy env and rebuild.
4. In **Team Management**, grant `/cn/acquisitions` and `/cn/fx-transfers` to the China team (admins with `/users` already see them).
5. Smoke test: China acquisition (stock → China Warehouse), slab quick-intake (row `price_check='pending'` + local amount), fx backfill (RMB entered against an auto-inserted USD row → `rate` computed), CN quick-add ("+ 新货" → new `language='CN'` product auto-selected into the line).

Until steps 2+3 are done, the features are dark and the un-executed DDL touches nothing.

---

## Interface decisions locked (you own all app-side code)
- **Flag:** `VITE_ENABLE_CN_JP_FINANCE`, default OFF.
- **China mirrors Japan:** instant-receive, `origin='cn_vendor'`, `source_country='China'`, `currency='RMB'`, weighted-avg USD cost basis, same undo/edit stock guards. China vendor dropdown is **`country='China'` only**.
- **Slab quick-intake:** `cert_number` required; `amount`+`currency` (RMB/JPY/USD via `convertToUSD`) optional; `grading_company` defaults `Other`; blank `item_name` → `待定价 Pending pricing (cert …)`. Writes `price_check='pending'` + `acquisition_cost_local`/`acquisition_currency` alongside the USD snapshot. Existing Scan intake untouched (`price_check` defaults `'done'`).
- **fx_transfers:** shared with lv-finance — USD leg auto-inserted, RMB leg backfilled in-app. Rate = **CNY per USD**. App form does **not** set `bank_txn_ref` (NULL for manual rows; UNIQUE guards automation dupes).
- **CN quick-add:** provisional products carry the Chinese in `name` **and** `aliases[0]`; CJK-in-`name` is the "not yet normalized by US" signal. Reuses `createProduct`; no DDL.

## Assumptions & notes
- **`source_country` enum:** SQL assumes it shares `region` with `vendors.country`; hedged in the SQL comments.
- **China Lark:** China acquisitions post `type:'purchased', sourceCountry:'China'` → Acquisitions Squad webhook only; the CN quick-add posts `type:'cn_new_product'` → main webhook. Neither uses a dedicated `LARK_WEBHOOK_CHINA` (add server-side later if wanted).
- **No `/cn/inventory` page** (Task 1 = acquisitions page only). China stock still lands in the `China Warehouse` location and is visible via existing inventory views.
- Only `/cn/acquisitions` and `/cn/fx-transfers` exist — no China stream-sales / shipments / add-product *pages* (quick-add is an inline modal, not a page).

## Not done (per instructions)
- No `git push`, no deploy. DDL left un-executed. No changes to live Supabase schema or env.
