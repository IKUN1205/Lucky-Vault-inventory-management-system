# LV Inventory — 作业手册 brief (2026-07-24)

本文件每次会话自动加载 = Gary 要的"运行前 brief"。**每次大改动当场更新此文件,版头日期=最后更新**。
工作区:app 仓库 + `../tiktok` + `LV Agents/inventory-sync`(+ slab-inventory、lv-finance)。老板 = Gary,中文回复,代码/路径英文。**Lark 消息一律英文、段落单换行**(空行被 Slate 转零宽字符 → composer 校验拒发)。

## 🚨 数据命脉铁律(Gary LOCKED)
- **实查实报,永不虚报、不反推**;sleeved pack / booster pack / booster box 三种产品三种价。
- 成本来源:进货发票 > kaitori 买取(JPY→USD 用 `jpy_to_usd_rate()`,是除)> eBay SOLD 中位 > TCG 市价。挂牌:TikTok/Shopify **≥ TCG 市价+5%**(Gary 7/23;shopify_daily_reprice 已加 tcg_market 下限,ref=min(mkt,sold) 不许把挂价拉到市价下);卖价永不低于成本。
- **定价铁律(Gary 7/24"不能一直模糊搜索"):sealed-master 钉 id 制** — 自动写价只认 `slab-inventory/data/sku_urls.json` 钉住的 TCG product id(285 条);模糊名搜只当钉价候选证据(erp_pricing 返回 `pinned` 字段+UNPINNED flag,reprice 未钉=只报不写)。钉前必验:名称+语言(DB lang / 标题 / 实拍图三对齐,已四次抓到 EN/JP/CN 错配)+价位合理。无 TCG 线(CN 全部、JP OP 盒=kaitori、Kayou/UpperDeck/JP 玩偶周边)→ 130point 周一(名单剩 7 个)或人工。
- **卖出铁律(7/23)**:卖出 = status=sold + 全套 sale_date/price/channel/fees/transaction_id,**行永不删**。日巡哨兵抓"sold 无信息"半截账。
- **删除铁律(7/23)**:只许软删(deleted + deleted_reason + 删前快照),硬删禁止;**不编数据**(假日期/假价格禁止,查无可查就留空)。

## Supabase(数据真源)
- Keys:`inventory-sync/data/_supabase_keys.json`(anon 可读写;DDL = William)。
- PostgREST 坑:1000 行必分页;空格用 `quote(p, safe="?&=.,*()-")` 勿双重编码;uuid 列无 like;products 列叫 `type`;**写完必 readback,批量写前备份 JSON**。`tps.sq`(tiktok_push_stock)自带完整分页**勿再套 offset 循环**、且不编码要先 quote。
- 表:`products` · `inventory`(数量原地覆盖**无变更 log** — audit-log SQL 待 William)· `locations` · `movements`(Transfer/Intake)· `box_breaks`(拆盒:sealed−N / pack+3N 全在 Master,pack 成本=盒成本÷packs_per_box,照 BreakBox.jsx 语义)· `stream_counts`+items · `acquisitions` · `slabs`(软删字段全:deleted/at/reason)。
- 房间:Master `1f68249f` · PH=Packheads `c995d0a6` · RocketsHQ `eeff0769` · LVUS `12293f16` · SlabbiePatty `04b32948` · **PokeCasino(原Whatnot,channel/sale_channel 存库值仍 'Whatnot'/'whatnot')**`ac9c06c4` · PokeAuctionHouse `1028e0f9` · Front Store `c4cf3dab`;共 23 locations(Sold 虚拟房有遗留怪名,勿用)。

## 盘点与审计制度(Gary 7/22 定版)
- 盲盘:expected=系统值,actual=实数,差值直写库存(正负都写);空行=0;guardrail 永不部署(Gary 否)。
- **铁律1:多出>0=违规**(销售不会加库存);**铁律2:消耗>TikTok 成交×1.15+5=假卖出**。
- 坑:百包箱只有**原封**才按箱数、拆封逐包;自售自数不可信;边审边搬 — **写库前公告、写完复核**(7/15 快照盖账事故)。
- 制度:**直播间=异常驱动**(日巡 team_alert 自动发群喊人当天到房);**Master 每周三全盘**(cron 卡片周三 09:00,首卡 7/29;门店节奏待 Gary 定);V1 只记不写 → 后台 24h 对账**纯文字在 chat 报 Gary**;小差异只记录,**大问题过审才修**(缺整箱/百件级/负库存/多出)。

## 每日 health check 自查自修(Gary 7/23:"不需要给我 report")
巡检/审计发现的悬案**不甩给 Gary,自己查到结论**,顺序:① DB 考古(acquisitions/movements/同产品空行的历史成本 — Paldean Fates 和 Gem Vol.5 的答案都在系统里)→ ② Lark 群聊搜索 → ③ CN/JP 财务 Base。查实即修(写库授权内,备份+readback),**只有大问题/要花钱/要改流程的才报 Gary**。已知病根:转库不带成本(updateInventory 修过之前的历史遗留),零成本行优先找同产品 qty=0 行上的历史成本。

## 自动化 crons(全走 run_*.bat:全路径 Python314 + `>> log 2>&1`;vbs 参数整路径一对引号)
- 05:40 `daily_inventory_watch`(铁律+负库存+sold 哨兵+TikTok 挂牌审计+群线索;异常自动 team_alert 到 Inventory In&Out,`--no-team` 可关)→ Telegram Gary
- 9:00/14:00 Notify_Orders(Shopify→BACKEND CORE)· 周三 9:00 Weekly_Count_Reminder · **17:00 Arrival_Allocator(到货自动分房建议)** · Restock Radar(缺货拉侧,--lark 未开)· Stream_Notes_Digest
- 周一 7:30 `LV_Manual_Price_Weekly`(manual_price_update.py:TCG 无匹配的 Shopify SKU 按 **130point eBay 成交中位**调价 —— eBay sold 搜索已需登录,130point 免登录;**只自动上调**,下调/±25% 熔断进人工审;查询词 `data/manual_price_queries.json`)
- 8:15 `LV_Inbound_Notify`(inbound_notify.py,Gary 7/23 两条消息逻辑:新运单出现发一条"有什么/何时到",到货当天/签收再提醒一条;状态查承运商**网页**(web_track.py,k1bkogcy 浏览器,UPS/FedEx 直连其他走 17track,每轮≤6 票;Gary 否了 AfterShip);7/23 已 seed 11 票旧单不播;CN 出库不建 acquisitions = 自动看不见,CN 票靠人工读 Base)

## Smart restock(7/22 上线)
- **到货推**:`arrival_allocator.py` — Master 快照增量=到货(排除拆盒)→ 按房速度(盘点负差 ∨ platform_sales ∨ storefront_sales,7d/30d 取快)填 7 天 cover,cover 最低先;`--product "名" [--qty N]` 手动。
- **缺货拉**:`tiktok_restock_advisor.py` — URGENT/RESTOCK/STAGNANT/BUY,CSV 在 data/。
- 到货全流程:CN/JP 财务 Base 出库栏=预告(canvas 表,人工读)→ expected-incoming 发 BACKEND CORE → 到货验货 → **当天入库** → allocator 自动分房;**实物搬动必记 Move**(治幽灵流入)。

## TikTok API(`../tiktok`)
- tokens `~/.tiktok/tokens.json` 两店;products/search 用 `"ALL"`;订单 95% 是 $1 坑位**无 SKU**(per-SKU 账=盘点),订单只对总量。

## App(本仓库,Vercel,push=生产)
- 只在 Gary 说"发"时 push;**所有改动过 Codex review(铁律 7/20)**。
- **7/29 已上线(60d2f12,Codex 三轮过审)**:单卡拆卖(sellSingleQtySplit 三路共用:POS/弹窗/platform 扫车,先插 sold 行+乐观锁扣减)· **singles sale_price_usd 语义统一=单价**(消费方全对齐;7/29 前弹窗整行卖存的是总价,旧行 P/L 显示偏高属已知)· 渠道词表 `src/lib/saleChannels.js`(每直播间一值、eBay 分账号、去 COMC/泛 ebay、in_person 显示名=Storefront、加 shows、默认空强制选)· 标题直达 TCGplayer(tcg_id)。
- 设计已定待 Gary 点头开工:Cards Scan 加"来源交易"下拉(trade/buy 关联+trade_in 按市价分摊成本,治单卡无成本病根)+ 重提防双录 + buy 手写行 sealed 关键词提示。7/28 双录 trade 已修(备份 double_trade_backup_0728.json)。platform 扫车 singles 仍存小写渠道('ebay' 等,报表兼容,细分待办)。
- 历史疑案待门店确认:7/28 Pikachu ×3 $9、7/24 Elgyem ×2 $15 两笔 in_person 整行多张 sold —— 真打包卖 or 误全卖?误卖则拆回。
- 房间名是硬编码字符串:改名/加房要全改 StreamCounts/Moved/OnlineOrders/PlatformSales/Returns + api/*(lark-notify/sheet 路由/日报周报)+ inventory-sync 脚本 + lv-finance/weekly_cogs。
- William 待办 SQL:`scripts/add_inventory_audit_log_2026_07_23.sql` · product_prices · product image column。
- 产品图:`useProductImages.js` ← lv-slabs.luckyvault.us/kaitori/product_images.json(改磁盘即生效)。

## 惯例
- 永不删产品行:清库存 = quantity→0。
- Lark:k1bkorhr(Gary 本人),fail-closed:占位符验证 → 清草稿(**循环清,多块草稿一次清不完**)→ 复验再打字;浏览器 CDP 卡死 → AdsPower stop+start;Frank=Franklin。
- PowerShell 5.1:参数禁内嵌双引号/emoji;Python 一律写 .py 文件跑;**禁用 PS 文本替换改 py 文件(毁 UTF-8),改文件只用 Edit/Write 工具**。
- Gary 授权(7/21)直接跑写库/本地修复;classifier 拦 2 次就停手交 Gary。
