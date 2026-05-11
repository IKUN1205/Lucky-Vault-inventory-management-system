# Lucky Vault Inventory System — Operations Manual

**Audience**: Everyone on the Lucky Vault team — streamers, warehouse staff, shippers, store staff, and managers.

**Purpose**: This guide tells you, by role, what to do in the system every day so the numbers add up, the boss has accurate reports, and we stop losing inventory to bad paperwork.

> The single most important rule:
> **Every time a physical box moves, opens, or sells, somebody clicks something in this system.**  
> If you skip the click, the system can't tell the difference between "moved to another room" and "stolen."

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Find Your Role](#2-find-your-role)
3. [Daily Workflows by Role](#3-daily-workflows-by-role)
   - [Streamer (Stream Counts + Reconcile)](#streamer-workflow)
   - [Shipper (Online Orders)](#shipper-workflow)
   - [Warehouse (Intake / Move / Break)](#warehouse-workflow)
   - [Store Staff (Storefront Sales)](#store-staff-workflow)
   - [Manager (Audit / Reports)](#manager-workflow)
4. [Page-by-Page Reference](#4-page-by-page-reference)
5. [The Audit & Reconcile System](#5-the-audit--reconcile-system)
6. [Best Practices — Read This Twice](#6-best-practices--read-this-twice)
7. [Common Issues & How to Fix Them](#7-common-issues--how-to-fix-them)
8. [Glossary](#8-glossary)

---

## 1. Getting Started

### Logging in

1. Go to the Lucky Vault URL on your phone, tablet, or computer.
2. Enter your **4-digit PIN**. If you don't have one, ask your manager.
3. You'll land on the **Dashboard**.

If your PIN doesn't work:
- Make sure you're typing all 4 digits.
- The PIN is set by an admin. If you forgot it, ask them to look it up or set a new one.
- If your screen says "Access Denied" after login, your account exists but doesn't have permission for the page you're trying to open. Ask an admin to grant the page in **Team Management**.

### What you see after login

- **Sidebar (left)** — every page you have permission for, grouped by stage: Overview / Receive / Operations / Sales / Reports / Admin.
- **Top right** — your name and a logout icon.
- **Main area** — whichever page is open.

### Switching pages

Click any item in the sidebar. On mobile, tap the menu icon at the top-left.

---

## 2. Find Your Role

| If you are a … | Your main pages are |
| --- | --- |
| **Streamer** | Stream Counts → Reconcile |
| **Shipper / Order packer** | Online Orders |
| **Warehouse staff** | Purchased Items → Intake to Master → Move Inventory → Break Box |
| **Store staff** | Storefront Sales |
| **Manager / Owner** | Executive Report, Sales Audit, Reports, Turnover, Team Management |

You'll still see other pages in the sidebar — feel free to look around, but only the pages above are part of your daily job.

---

## 3. Daily Workflows by Role

### Streamer Workflow

You are the live-stream host. You sell sealed product on TikTok to viewers. Your job in the system is to **count what's left** before each new stream — this tells the system how much you sold during the previous stream — and to **reconcile** that count against TikTok's own sales numbers.

#### Before your stream (every single time)

1. Walk to your stream room shelf.
2. Open **Stream Counts** in the sidebar.
3. Click **Start New Count**.
4. Select:
   - **Stream Room** — the room you stream from (e.g. "Stream Room - TikTok Packheads").
   - **Streamer** — the person who streamed last in this room (whose sales you're recording).
   - **Counted by** — yourself (you're the one doing the count and streaming next).
   - **Date / Time** — defaults to now; usually leave it.
5. The system shows every product the inventory says should be on your shelf, with the expected quantity.
6. Walk down the shelf. For each product, count the physical units left and type that number.
7. After you've counted everything, click **Submit Count**.

The system computes "sold" for each product as `expected - actual`, decrements inventory, and posts a brief summary to the room's Lark group.

#### Right after submitting — Reconcile

After **Submit**, you'll see a **Reconcile last stream** button (or be navigated automatically). This compares what you just counted against TikTok's actual LIVE-session sales. Do this **every time** at Packheads (and any other room that has the feature turned on):

1. In Reconcile, click **Open TikTok Seller Center**. A new tab opens.
2. In TikTok: click **Filter** → set **LIVE session** to the show you just finished → click the **download ⬇️** icon. A CSV downloads.
3. Drag the CSV onto the **Drop CSV here** area in Reconcile.
4. Wait a second. You'll see a per-product diff table.
5. Click **Send to Lark**. The diff goes to the room group so the manager can see it.

If the diff has any 🚨 red rows (system > TikTok), you have inventory that left the shelf without a sale. Discuss with your manager immediately — don't wait.

#### Things to avoid

- ❌ Don't take boxes off the shelf "to display" without putting them back before the count.
- ❌ Don't take boxes home — even temporarily.
- ❌ Don't skip a count and "just guess" later — that's the single biggest source of inventory drift.

---

### Shipper Workflow

You receive customer orders that aren't sold during a live stream (online orders from eBay, the website, etc.) and ship them out.

#### When a customer order comes in

1. Pull the product from the right location.
2. Open **Online Orders** in the sidebar.
3. Click **+ New Order** (or similar — varies slightly).
4. Fill in:
   - **Date** — today.
   - **Platform / Channel** — e.g. "TikTok @ Packheads" or "eBay @ LuckyVaultUS".
   - **Order number / Customer name / Tracking** — optional but helpful.
   - **Source location** — the room you pulled the goods from.
   - **Handled by** — yourself.
5. Add each line item (product + quantity) to the cart.
6. Click **Ship Order**.

The system decrements inventory at the source location and posts a confirmation to Lark.

#### Things to avoid

- ❌ Don't ship without recording — even if you're in a rush. The whole system breaks if shipments aren't logged.
- ❌ Don't pick the wrong source location. If you took the box from Front Store, set source = Front Store, not Master Inventory.

---

### Warehouse Workflow

You receive new shipments from vendors and prepare inventory for streamers / shippers / store.

#### When a new shipment arrives

1. Open **Purchased Items** in the sidebar.
2. Click **+ New Purchase** (or similar).
3. Fill in vendor, date, brand, currency, cost. Add each product + quantity to the cart.
4. Click **Log Purchase**.

The purchase is now recorded but inventory **isn't** added to any room yet. That's the next step.

#### Intaking purchased items into Master Inventory

After a purchase is logged and the boxes are sitting in your warehouse:

1. Open **Intake to Master**.
2. Find the purchase you just logged.
3. For each line, confirm the quantity received (might be less than ordered if some were damaged), then click **Receive**.

This adds the boxes to **Master Inventory** at the correct cost basis. Use this every time real boxes arrive — not before.

#### Moving inventory between locations

Streamers ask for stock; the store needs to be restocked; you need to move stuff between rooms.

1. Open **Move Inventory**.
2. **From** — the location where the box currently is.
3. **To** — where you're moving it.
4. **Moved by** — who is physically doing the move (you, usually).
5. Pick products + quantities for the cart, then click **Submit Move**.

The system decrements `From` and increments `To`, all in one transaction. A Lark notification goes out.

⚠️ **Critical**: if you carry a box from Master to a stream room and skip this step, the system thinks it's still in Master. The streamer will count their shelf, find a box they "shouldn't have," and the audit will look like inventory appeared out of nowhere. **Log every move.**

#### Breaking sealed product (Box → Packs)

When you crack open a sealed box and want to track the resulting packs as their own SKU:

1. Open **Break Box**.
2. **Sealed product** — pick the booster box.
3. **Pack product** — pick the pack SKU it breaks into.
4. **Boxes broken** — how many.
5. **Packs created** — usually auto-fills based on box configuration; verify.
6. **Location** — where the break happened.
7. Click **Break**.

System decrements sealed inventory, increments pack inventory at the appropriate cost.

#### Things to avoid

- ❌ Don't intake boxes you haven't physically counted.
- ❌ Don't open a sealed box without recording the break — packs need to enter the system somehow.
- ❌ Don't intake boxes "from memory" — always pull the actual purchase row and confirm quantities.

---

### Store Staff Workflow

You run the physical storefront and sell sealed product to walk-in customers.

#### When a customer buys something

1. Open **Storefront Sales**.
2. Click **+ New Sale**.
3. Fill in:
   - **Date** — today.
   - **Sale type** — "Itemized" if you're recording individual products; "Bulk" for lump-sum sales without per-product detail.
   - **Payment method** — cash / card / etc.
4. For an Itemized sale, add each product + quantity + price to the cart.
5. Click **Submit Sale**.

#### Things to avoid

- ❌ Don't use "Bulk" if you can avoid it. Bulk sales aren't tied to a product, so they can't appear in audits. Use Itemized whenever possible.
- ❌ Don't log a sale "later." Either log it as it happens or write down what was sold and log within the hour.

---

### Manager Workflow

You read the reports, run audits, and chase discrepancies.

#### Daily (5 min)

1. **Executive Report** → switch to **Daily** view. Check yesterday's:
   - Total inventory value (sanity check it didn't drop dramatically).
   - Outflow / Inflow (does it match what you'd expect?).
   - Top 5 outflow products.
2. Scan Lark for any stream-count discrepancy alerts.

#### Weekly (30 min)

1. **Executive Report** → **Weekly** view. Same checks but for the last 7 days.
2. **Sales Audit** — upload the week's TikTok LIVE-only orders CSV. Walk through the flagged products with red diffs. Investigate any with `|diff| ≥ 5`.
3. **Turnover** — look at slow-movers. Anything sitting > 60 days at high stock is a working-capital problem.

#### Monthly (1 hour)

1. **Executive Report** → **Monthly** view.
2. Check **Dead Stock** section — products with no outflow in 30 days.
3. **Reports** — pull the monthly cost-of-goods report.
4. **Business Expenses** — reconcile against bank statements.
5. **High Value** — physical count any single-card-style high-value items.

#### When you spot a problem

Use the playbook in [Section 5](#5-the-audit--reconcile-system).

---

## 4. Page-by-Page Reference

### Overview

#### Dashboard
The home screen. Shows headline numbers: total inventory value, recent activity, alerts.
- **When to use**: Quick gut check at the start of the day.

#### View Inventory
Browse every SKU at every location with filters (Location, Brand, Language, Sealed/Unsealed, Search).
- **When to use**: "How much of X do we have?" or "Where is X?"
- Click a row to see / edit quantity if you have permission.

### Receive

#### Purchased Items
Log purchase orders from vendors. **Doesn't add inventory** — that's Intake's job. Tracks cost, currency, tracking numbers, expected vs received quantities.
- **When to use**: As soon as you place an order or boxes arrive on the loading dock.

#### Intake to Master
Receive the physical boxes from a logged purchase into Master Inventory at the right cost basis.
- **When to use**: When real boxes arrive in the warehouse.

#### Manual Inventory
Add inventory directly without going through Purchased Items → Intake. Use sparingly — only for one-off items, adjustments, or things you can't fit into the normal purchase flow.
- **When to use**: A consignment box arrives, or a manager asks you to correct a miscount.

#### Add Product
Create a brand-new SKU in the catalog. Once a product exists here, you can buy it, count it, move it, sell it.
- **When to use**: New product not in our system yet. Don't create duplicates — search first.

### Operations

#### Move Inventory
Transfer stock between locations. Most-used page in the warehouse.
- **When to use**: Every time a physical box changes rooms.

#### Break Box
Open a sealed box and convert it into pack SKUs. Decrements sealed, increments packs.
- **When to use**: Cracking sealed product to sell packs separately.

### Sales

#### Stream Counts
Pre-stream physical count. Records what's left from the previous stream → system computes what sold.
- **When to use**: Every time before going live.

#### Platform Sales
Aggregated lump-sum sales by platform/channel. Used when you don't have a clean per-line export and just want to log "$X of sales happened on platform Y today."
- **When to use**: Rarely. Most platform sales should come through Online Orders or get caught by Audit/Reconcile.

#### Online Orders
Per-order ship-out tracker. Records date, platform, channel, customer, products, source location, and tracking.
- **When to use**: Every time you pack and ship a non-live order.

#### Storefront Sales
Walk-in retail sales at the physical store.
- **When to use**: Every store transaction.

### Reports

#### Reports
Detailed report builder. Pull acquisitions, stream counts, business expenses, or summaries with date filters.
- **When to use**: Bookkeeper / accountant needs raw data.

#### Turnover
Working-capital and inventory-velocity view. Shows what's selling, what's sitting, sell-through rates.
- **When to use**: Weekly / monthly capital-allocation discussions.

#### Executive Report
Top-line cost-basis view for the owner. Inventory value + inflow/outflow + Top 5 movers + Hot Products + Dead Stock. Switch between Daily / Weekly / Monthly.
- **When to use**: Every morning by the manager. Anytime by the owner.

#### Sales Audit
Reconciliation tool. Upload a TikTok orders CSV; compare it against in-system stream-room outflow per product to detect missing inventory.
- **When to use**: Weekly minimum, after every TikTok export.

#### Reconcile (per-stream)
The lightweight version of Sales Audit, triggered from a single stream count. Compares one stream's outflow against one LIVE session's TikTok orders.
- **When to use**: Right after every Packheads stream count.

#### Product Mapping
Manage the table that maps TikTok product names to our system product IDs. Used by Audit/Reconcile.
- **When to use**: When Audit/Reconcile says a product is unmapped.

### Admin

#### High Value
Track individually serialized / high-dollar items (graded slabs, single cards over a threshold) with movement and price history.
- **When to use**: Logging a graded slab in/out, or updating market price.

#### Business Expenses
Log non-inventory costs (rent, fees, salaries, shipping supplies, etc.).
- **When to use**: Every business expense, every time.

#### Team Management
User accounts and permissions. Set someone's role, PIN, allowed pages, and which stream rooms they can act in.
- **When to use**: New hire, role change, someone forgot their PIN.
- ⚠️ Admin-only. Most coworkers don't see this page.

---

## 5. The Audit & Reconcile System

This is the core anti-shrinkage feature. It compares **what TikTok says was sold** against **what our system says left the shelf**.

### Two flavors

| Tool | Trigger | Frequency | Use it for |
| --- | --- | --- | --- |
| **Reconcile (per-stream)** | Right after a stream count | Every stream | Catching theft / mis-record same-day |
| **Sales Audit** | Manual, with a multi-day TikTok export | Weekly | Cross-stream patterns, trend tracking |

### How a healthy reconcile looks

```
Totals — TikTok 593 · Count 590 · Diff +3
✅ All products match within ±5
```

If TikTok and the count agree to within 5 units across every product, everything's accounted for. Move on.

### How a problem reconcile looks

```
⚠️ 3 products off by 5+:
  • Limit Over Collection: TikTok 3 · Count 24 · -21
  • OP-14 Azure Seas Seven: TikTok 14 · Count 30 · -16
  • White Flare Booster Pack: TikTok 145 · Count 60 · +85
```

#### Negative diff (TikTok < Count) — the dangerous one

> System says 24 left the shelf. TikTok says only 3 were sold.
> Where did the other 21 go?

This is the **direct theft signal**. Items physically left the room and no sale was recorded for them. Possible causes (in order from least to most worrying):

1. **Unrecorded Break Box** — somebody cracked a sealed box without clicking Break Box. Track down who streamed that night and ask.
2. **Unrecorded Move** — somebody walked the boxes to another room without logging a Move. Check if another room has phantom inventory.
3. **Stolen** — the boxes left the company.

**Action**: physical count the SKU across all rooms today. If real total matches system total, it's 1 or 2 above. If real total is less than system total, it's 3.

#### Positive diff (TikTok > Count) — the noisy one

> TikTok says 145 sold. Count says only 60 left the shelf.
> Where did the extra 85 come from?

Most often this is:
- **Lazy stream count** — the streamer didn't count carefully, or skipped some SKUs. Talk to them.
- **Items appeared from somewhere** — packs that came in via Break Box at another room, or a Move that wasn't recorded coming in.

Less commonly, this is:
- **Theft hidden by overstating remaining inventory** — the streamer counted "actual" too high to hide what they took. Requires physical verification to detect.

**Action**: Have a chat with the streamer first. If the conversation doesn't explain it, physical count.

### Investigation checklist for any flagged product

1. Open **View Inventory** and search the product. Note system stock at each location.
2. Physically count the product at every location you can reach today.
3. Compare physical total vs system total:
   - Equal → procedure failure (someone didn't log a move/break). Coach them.
   - Physical < system → **real loss**. Time to investigate seriously.
4. Open **Sales Audit** and check the SQL detail (the page can show every event for a product over the last 30 days).
5. Look for the operator names on Move events near the time of the loss.

---

## 6. Best Practices — Read This Twice

### The Six Commandments

1. **Log every physical movement.** No box leaves your hands without somebody clicking something.
2. **Count before the next stream, every time.** Skipped counts hide problems.
3. **Use Move Inventory for cross-room transfers.** Not "I'll do it later." Now.
4. **Use Break Box when you break a box.** Both the sealed decrement and the pack increment need to be in the system.
5. **Don't take inventory home.** Not "to look at," not "for a stream tomorrow," not anything.
6. **Reconcile after every stream.** Same-day discovery > weekly cleanup.

### When you screw up — and you will

You will:
- Mis-count something
- Forget to log a move
- Click submit too early

That's fine. **Tell your manager immediately.** Errors caught fast cost nothing. Errors caught a month later cost trust and money.

Most pages have an **Undo** button on the last action you took. Use it before it scrolls away.

### Pace yourself

If a process feels too slow:
- Stream counts: split the count between 2 people; one reads the shelf, one types.
- Online orders: batch-pack first, then sit down and log everything in 10 minutes instead of one-at-a-time.
- Reconcile: keep the TikTok Seller Center tab open in your browser; the export only takes 15 seconds when you're set up.

---

## 7. Common Issues & How to Fix Them

### "Page says 'Access Denied'"
Your account doesn't have permission. Ask an admin to grant it in **Team Management** → your user → Allowed pages.

### "I can't find a product when adding to cart"
- Check spelling.
- Try just the base name without "Booster Box" / "Pack."
- The product might not exist yet. Ask a manager to add it in **Add Product**.

### "I logged a sale / move / count wrong"
- Find it in the relevant page (most have a recent-activity list).
- Click **Undo** on the row. The system reverses inventory effects.
- If Undo isn't available (e.g. too old), tell your manager.

### "Stream count expected quantity looks wrong"
Means inventory was decremented somewhere you weren't expecting. Common causes:
- An online order shipped from your room and adjusted inventory.
- A Move Inventory took stock out of your room.
- A previous count was wrong and the next count is fixing it.

If the gap is big (>10), pause and tell your manager before submitting. Otherwise just count physical truthfully — the system will record the diff.

### "Reconcile shows 'unmapped products'"
TikTok has product names like `"NIKKE Booster Box - GODDESS OF VICTORY (English)"`. Our system has them as `"NIKKE Goddess of Victory Booster Box (Weiss Schwarz)"`. The mapping table connects the two.

- Open **Sales Audit**.
- Find the unmapped product.
- Pick the matching system product from the dropdown.
- The mapping is saved forever — every future audit/reconcile uses it automatically.

### "Lark notification didn't show up"
- Check the right Lark group (Packheads / RocketsHQ / etc.). Per-stream-room messages go to per-room groups.
- If still nothing after 30 seconds, ask the admin to check the webhook config.

### "Audit shows a huge diff (50+)"
Before assuming theft:
1. Are you using the **LIVE-only** TikTok export? (Filter by LIVE session before exporting.) If you exported all orders, online orders inflate the platform side.
2. Did anyone forget stream counts that week? If counts were skipped, the system side will be artificially low.
3. Are there any recent Break Box events that weren't logged?

After checking those, treat the remaining diff as real and physical-count.

---

## 8. Glossary

| Term | Meaning |
| --- | --- |
| **SKU** | Stock-Keeping Unit. One product. "Pokemon White Flare Booster Pack" = 1 SKU. |
| **Sealed product** | A box that hasn't been opened. The whole box is a SKU. |
| **Pack product** | Individual packs cracked from a sealed box. A different SKU from the sealed box. |
| **Master Inventory** | The main warehouse location. Default destination when you Intake a purchase. |
| **Front Store** | The retail storefront's stock. Sourced from Master. |
| **Stream Room** | A room each streamer streams from. Has its own physical shelf. |
| **Stream count** | The pre-stream act of counting what's on the stream-room shelf. |
| **Expected qty** | What the system thinks should be on the shelf. |
| **Actual qty** | What you physically count on the shelf. |
| **Diff (in a count)** | `expected - actual`. Positive = items left the shelf. Negative = found more than expected. |
| **Diff (in audit)** | `platform - system`. Positive = TikTok sold more than the count recorded. Negative = count showed more outflow than TikTok did. |
| **Outflow** | Anything that left inventory: sale, move out, break box. |
| **Inflow** | Anything that added inventory: purchase, move in. |
| **Cost basis** | What we paid per unit, in USD. Different from sale price. |
| **Lark** | The team's group-chat app. The system pushes notifications to specific groups. |
| **LIVE session (TikTok)** | A single TikTok live show. Each one has its own ID. Filter orders by LIVE session before exporting. |
| **Reconcile** | Comparing one stream's count against one LIVE session's TikTok orders. |
| **Audit** | Multi-day reconciliation across many products and many streams. |

---

## Questions?

If something doesn't match this manual, the manual is wrong. Tell the manager so we can fix it. The system also changes from time to time — when a button moves, the manual will say what it used to say. Trust the screen, then tell us.

**Last updated**: 2026-05-11
