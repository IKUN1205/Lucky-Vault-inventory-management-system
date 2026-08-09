# LV Inventory — 作业手册 brief (2026-08-05)

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
- **盘点员准确率实测(8/4,`scratchpad/counter_scorecard.py` 离群法:前后两次盘点互相吻合、中间这次和两边都对不上=这次是错的)**。6/15 起 139 场 3536 行:Nerses 7.1% · Carlos 5.5% · Rob 5.0% · Sue 4.4% · Jason 2.0% · **Yaz 1.8% · Trey 1.7% · JV 0.6%(三个主力里最准)**。**真病根是自售自数:Trey 637 行全部自数(100%)、Brandon 369 行全自数,JV 只有 10%**;8/3 PRB2 被砍 6 盒就是 Trey 自数写的 -9。负差当场写库、正差永不写库 → 误数偏低会**永久毁真货**,偏高只是反复唠叨。
- **OP-13 blister 悬案(8/4,Gary:"其实我们是移库了 但是我们没发 因为我们要重新点一下")**:Packheads 三天内被盘点写掉 **509 片**(7/31 Yaz -208、8/3 Yaz -301),而两次之前 JV 分别数到 603 和 464(7/31 两次相隔仅 6 小时:JV 603 vs Yaz 301)。若确系移库未记 Move,则约 **$9.4k**(单价 $17.25–19.5)被当成卖出抹掉。系统现存 288(RocketsHQ 141 / Master 126 / Front 16 / eBay 5),Packheads 0。**待全房复点后再决定是否恢复**。
- 8/4 已按 Gary "以 JV 的数为准" 刷新 Packheads:Hololive 56→62、PRB2 1→7、Marvel Masterpieces 10→12(备份 jv_recon_backup_0804.json,乐观锁+回读)。
- **8/5 Packheads "+286" = Trey 重复数一遍(查实,非缺货)**:两个 bulk-add SKU 都是 `exp 114 → act 230`(=114×2+2),各 +116,占 286 里的 232。而 9 小时前 Yaz 数同一堆是 `exp 114 → act 114 差 0`,**期间零 Move**。Trey 又是自售自数。多出永不写库所以没伤到账,但拉了三个人进来查。**判"系统丢货"前先比对当天前一次盘点**——同一 SKU 两次盘点差一倍就是重复计数,不是系统问题。
- **群里报的"bulk add didnt work"是假警报**(Franklin 8/5):Eric 06:16 的 bulk add 写进去了(inventory 13:16:50Z),Yaz 06:20 那次盘点当场对上 114/114/0;也没有落到 Master。真问题是它**新建了重复 SKU**(见下节)。
- **OP-13 blister 基本定案(8/5,Gary:"aldo报的数字那是最准确的")**:Aldo 在 BACKEND CORE 手点 **Master 有 300 片 sleeved OP-13**,系统 Master 只有 **16**。同日 Packheads 两个盘点员各自数出 150/156(系统 100)。全系统在册合计 286(Master 16 / Packheads 100 / RocketsHQ 141 / Front 24 / eBay 5)—— **就算把 RocketsHQ 记的 141 全算成实际堆在 Master,也只有 157,离 Aldo 的 300 还差 143**。即 **至少 143、很可能 284 片实物在系统里查无此货**,和 7/31+8/3 被盘掉的 509 片对得上 → **移库未记 Move,不是卖掉了**(单价 $17.25–19.5,143 片≈$2.6k、284 片≈$5.1k)。
- **Aldo 手点已按 Gary 令写库(8/5,`scratchpad/aldo_write.py --write`,备份 aldo_write_backup.json,乐观锁+回读 36/36 OK)**。Master 25 行、Rockets 11 行;**他没列的 41+8 个 SKU(371+296 件)一律没动 —— 没数≠零**。Master 2368 件 / Rockets 788 件。大头:OP-13 16→300 · jumbo 522→738 · red promo 21→175 · blue archive 27→51 · **Destined Rivals sleeved 576→432** · Epic Seven 24→1;Rockets Pitch Black 25→70 · Perfect Order 160→190 · Ayakashi 盒 29→3 · Enchant 盒 11→3。
- **三条写完仍待人确认**:① **red promo 175**(系统 red 21 / **blue 204**,Aldo 只报 red 一行,像红蓝混点,写完 red+blue=379)② **Ayakashi/Enchant 盒少了 26/8 而 Aldo 另列散包 6/9** —— **拆盒没走 box_breaks**,盒数对不上散包数,得问谁拆的 ③ Paldea Chest / Oddish / PO Checkout Lane 三个品 Aldo 在 Master 数到,而系统把它们记在 Front Store / eBay 房 —— 已按他的数写 Master,**另一头没动所以总数暂时重复**,等那两个房复点。
- **新建 4 个 SKU(建前全库查过重,不是 AddProduct 那条零查重路径)**:`6eab93e9 Zacian & Zamazenta Ultra-Premium Collection` · `6e8314c6 Perfect Order Sleeved Booster Pack` · `ced1b25b hololive Enchant Regalia Booster Pack` · `f3ba8331 Hololive: Ayakashi Vermillion Booster Pack`。原以为缺的另外 5 个**其实早就有**(Paldea Adventure Chest Other e04bbffc / Oddish Two Pack Blister Other 7c4aba94 / Perfect Order Checkout Lane Blister Pack aea52538 / Mega Evolution Sleeved Booster Pack 3d60400f / Charizard GX Special Case File 21fb3b62)——**按精确名匹配会漏,必须模糊搜全库再判缺**。新 SKU 无成本(不编数据,散包成本要盒价÷packs_per_box,ppb 未知)。
- **Aldo 两个品认不出、没建也没写**:"greninja & kingdra ex box" ×1(系统只有 Mega Greninja ex Premium Collection,他已单列 9)、"detective pika charzaird GX special case file" ×1(混了 `Detective Pikachu Special Box` 和 `Charizard GX Special Case File`,后者 Front Store 有 1)。
- 制度:**直播间=异常驱动**(日巡 team_alert 自动发群喊人当天到房);**Master 每周三全盘**(cron 卡片周三 09:00,首卡 7/29;门店节奏待 Gary 定);V1 只记不写 → 后台 24h 对账**纯文字在 chat 报 Gary**;小差异只记录,**大问题过审才修**(缺整箱/百件级/负库存/多出)。

## 每日 health check 自查自修(Gary 7/23:"不需要给我 report")
巡检/审计发现的悬案**不甩给 Gary,自己查到结论**,顺序:① DB 考古(acquisitions/movements/同产品空行的历史成本 — Paldean Fates 和 Gem Vol.5 的答案都在系统里)→ ② Lark 群聊搜索 → ③ CN/JP 财务 Base。查实即修(写库授权内,备份+readback),**只有大问题/要花钱/要改流程的才报 Gary**。已知病根:转库不带成本(updateInventory 修过之前的历史遗留),零成本行优先找同产品 qty=0 行上的历史成本。

## 🔴 加产品零查重(8/5 定性,**唯一没修的真 bug**)
- `createProduct`(src/lib/supabase.js:302)是**裸 insert,名称/品牌/语言/类型全无唯一约束**,只有 barcode 有 partial unique index。AddProduct 又用 `name = launch_name + " " + product_type`(AddProduct.jsx:258)拼名 —— 人只要把类型也打进 Launch Name,类型就出现两遍,并且**当场诞生一个新 SKU 顶掉老的**。
- 实测:**全库 19 个 SKU 名字带重复类型词**。最脏的 `[JP] One Piece: OP14 Booster Box Booster Box` 同一天建了**两份**(8fcaeb4a / b12b8ef5,只差一个空格)。8/5 新建的两个装着**全部 228 件**:`3a468a57 Adventure on Kami's Island Booster Pack - …(OP15-EB04) Booster Pack`(114)、`5080eecb The Time of Battle Booster Pack - …(OP16) Booster Pack`(114)。后者和已有的 `c7995a3f [EN] The Time Of Battle Booster Pack`、`07e568b8 [EN] The Time Of Battle - OP16 Booster Pack`(都 0 库存)**三选一重复**。
- 连带伤害:丢 `[EN]/[JP]` 前缀(违反 164 产品改名规范)· `packs_per_box=null` · 不在 `sku_urls.json` 里 → **自动定价钉不上、reprice 完全看不见** · 盘点清单上真假 SKU 并列。
- 待办:① createProduct 加同 brand+language+type 的近名查重(建前提示"是不是这个?")② AddProduct 提交前剥掉 launch_name 末尾已有的类型词 ③ 存量 19 个合并/改名(**改 SKU 身份会当场改变直播间盘点清单,开播中别动**)。

## 自动化 crons(全走 run_*.bat:全路径 Python314 + `>> log 2>&1`;vbs 参数整路径一对引号)
- 05:40 `daily_inventory_watch`(铁律+负库存+sold 哨兵+TikTok 挂牌审计+群线索;**8/3 加 storefront 对账**:每 tx 收款vs货品(sealed+singles+slabs,trade 按净额)/孤儿款/同品5分钟双录,跨窗口补录不误报,`--no-storefront` 可关;群 @当班播报未开待 Gary 批文案;异常自动 team_alert 到 Inventory In&Out,`--no-team` 可关)→ Telegram Gary
- 9:00/14:00 Notify_Orders(Shopify→BACKEND CORE)· 周三 9:00 Weekly_Count_Reminder · **17:00 Arrival_Allocator(到货自动分房建议)** · Restock Radar(缺货拉侧,--lark 未开)· Stream_Notes_Digest
- 周一 7:30 `LV_Manual_Price_Weekly`(manual_price_update.py:TCG 无匹配的 Shopify SKU 按 **130point eBay 成交中位**调价 —— eBay sold 搜索已需登录,130point 免登录;**只自动上调**,下调/±25% 熔断进人工审;查询词 `data/manual_price_queries.json`)
- 8:15 `LV_Inbound_Notify`(inbound_notify.py。**Gary 8/4 改版:群里只播"今天即将要到的",已经到了的不播** —— Delivered 只静默标记 state,首次见到就已 Delivered 的连"Incoming"也不发;"已签收未入库"改由 05:40 日巡报给 Gary 本人(不进群),带已放天数。原 7/23 两条消息逻辑:新运单出现发一条"有什么/何时到",到货当天/签收再提醒一条;状态查承运商**网页**(web_track.py,k1bkogcy 浏览器,UPS/FedEx 直连其他走 17track,每轮≤6 票;Gary 否了 AfterShip);7/23 已 seed 11 票旧单不播。**8/3 修死机**:web_track 的 sync_playwright 会话必须先 close 再调 lark_send(两个同线程 sync 会话= "Sync API inside asyncio loop" 崩,且崩在 state 保存前 → 7/30-8/3 每天组装消息但一条没发出去)。**CN 出库铁律**:CN 出库不建 acquisitions=自动看不见 → **每周一人工读 CN/JP Base 出库表补 acquisitions**(读法:出库表 canvas 选中行→点格内展开图标→记录卡片是 DOM 直接抽 innerText 拿全运单号;8/3 教训:CN 7/16 宝石5×3+评价卡+黑盒、7/24 精灵球×80 两票 UPS 签收到 Gary 家 12 天无人知,已补录+建 [CN] Pokemon 5.0 Poke Ball 产品;CN 成本 CNY 进不了 currency enum,写 notes)。姊妹脚本 `inbound_tracking.py`(17track→BACKEND CORE step-1 通知,正常在跑)8/3 加 `--weekly-jp`:**周一自动发 acquisitions 真数据版 "Expected Arrivals" 到 Shipment Tracking Japan**——群里原有的 LV CLAW webhook bot 数据源 5 月就断了,只会空播 "No shipments expected"(播报空转真凶),CLAW 的排程要 Peilin 侧才能关。
- **8/4 到货追踪修通(Gary:"ETA 我们自己用 ads 查")**。四个坑串在一起,曾让 JP 票整条线全瞎:
  1. **fedex.com 对我们已废**——美站/日站对所有 87xxxxxxxxxx 一律"查无此单",连 CLAW 四月播过 Arrived 的 871028274196 也一样(UPS 对照正常)。**别再走 fedex.com,一律走 17track。**
  2. **17track 必须钉承运商**:JP FedEx 号自动识别失败,restapi 返回 `code:400 / carrier:0 / shipment:null` + 一串 `extra.multi` 候选;旧代码只等 `code:200` → 永远空手,看起来像"没发货"。已加 `CARRIER_17T={fedex:100003, ups:100002}`(取自 17track 自家 carrier.all),URL 带 `&fc=&fa=`;`code:100`=查询中要继续轮询,`code:400`=没钉承运商,现在会明确报出来。
  3. **单号在 URL 片段里,连续查会静默返回上一票**——SPA 不因 `#` 变化重载。每票之间必须先 `goto about:blank`。
  4. **`tracking_delivered_at` 曾写成 now()**,晚查一周就把到货日错记成今天;改用承运商自己的扫描日期。
  另修 web_track `_classify` 假到货:17track 页面筛选栏自带 "Delivered (0)"+样例已送达单,任何非 UPS/FedEx 承运商都会被判 Delivered → inbound_notify 会误播"✅ Delivered 立刻入库"。现要求正文必须含本单号(比对去掉非字母数字,兼容 UPS 空格)+ 识别 not-found/見つかりません,判不出一律 None。
  另:运单号写进 `notes` 没进 `tracking_number` 的行追踪器彻底看不见(7/31 Storm×75 中招,已修+回读)——**补录必须填 tracking_number 字段本身**。
- **8/4:五票全部签收、全部未入库**。JP:875218962982(Storm 盒×73+Unsealed×5)**8/4 送达 LA**、875140436410(Storm 盒×75)8/1 送达、875084488540(others×3)7/31 送达;CN:两票 7/22 / 7/27 签收在 Gary 家。**在途已清零**。JP→LA 实测 1–2 天。已发 Inventory In&Out 催入库。**入库一律走 app 的 Intake to Master(Gary 8/4 定),`quantity_received` 不手改。**
- **急**:Master 的 Storm Emeralda Booster Box 已经是 **0**(eBay 房 13 / 门店 1 / 日本仓 190),而 8/3 还在从 Master 发 eBay 订单(×15/×1/×2)。**148 盒就躺在上面两票 JP 到货里没入库** —— 这是当前最该先做的一件事。
- **CN 进货成本在 Base 的「入库」表里(8/7 找到,之前只读过「出库」所以一直没成本)**。表是 canvas,innerText 拿不到,**只能截图读**;列:入库编号 / 入库日期 / 出库_追踪 / 单价 / 数量 / 其他成本 / 总价 / 产品_备注。全表 20 条,合计 ¥351,160.09。汇率用 `open.er-api.com` 实时取(8/7 = 6.7634 CNY/USD)。
  - **Terastal Gathering(CN 侧叫 "17.5")= 三批不是两批**:¥360×30 · ¥335×7 · ¥355×33 → **70 盒 ¥24,860 → ¥355.14/盒 = US$52.51**。对比 eBay BIN 要价 $64.98 = **81%**,健康。
- **🔴 出库表才是发货真源,别信口头数(8/7 教训)**。我 8/5 按 Gary 口头"110盒17.5"建了 acquisitions,**出库表实际写的是 30 盒**。买 70 发 30 → **剩 40 盒还在中国仓,不是丢了**。运单 `1Z03KC740436008893` 出库表 4 行:宝石五散盒 8 · **17.5 = 30** · **火线 80(¥16,000,我们系统里完全没有这个产品)** · 评级卡 1(¥7,085)。**待修**:`d091b16c` qty 110→30、补 火线×80、`3a0bcb66 others` 换成评级卡真成本。
- 出库表列:出库编号 / 发货日期 / 入库_追踪 / 地址 / sku / 数量 / 物流公司 / 运单号 / 运费 / 货物_成本 / 总成本。**其他 CN 运单**:`1Z03KC740406973174`(7/16 宝石5箱×3 + 评价卡×1 + 黑盒×1)· `1Z03KC740431746523`(7/24 5.0精灵球×80 + m4火线×10)· `1Z03KC740438765428`(7/24 5.0精灵球×80)· 海运 `7892607258395267`(服务器×1 + 旧电脑×2)。
  - **宝石5 才是真正的"两个版本"**:`入库*001` **箱装** ¥6,570/箱 ÷ **40盒/箱** = ¥164.25/盒(US$24.29)· `入库*083` **散盒** ¥190/盒(US$28.09)→ 合并 **128 盒 ¥21,230 → ¥165.86/盒 = US$24.52**。**系统现在记的是 $30.00,高估了 $5.48/盒(22%)**。
  - `入库*090` **20箱宝石6** ¥2,880/箱 × 20 = ¥57,600。**箱规没写**,若照宝石5 的 40盒/箱 推是 ¥72/盒($10.65),但那比宝石5 便宜一半多,**别直接采信,要问 CN 侧箱规**。
  - 评级卡:7/14 那条 ¥20,000 备注写着"目前为止所有的评级卡,大概估算"(是估的);8/6 `入库*091` ¥7,085 ×1 是当前这票的。
- **8/5 新 CN 票 1Z03KC740436008893**(Gary 口头给,CN Base 出库**最后修改还停在 7/24**,没登记):宝石5×8 + Terestal Gathering Booster Box(CN)×110 + 评级卡(数量 CN 侧没给,先记 1 待到货核)。UPS Worldwide Express Saver,8/5 上海出口扫描,**ETA 8/6**。已建 acquisitions 三行(cost 待 CN 财务表)。**"17.5" = Terastal Gathering**(Gary 8/5 确认),CN 侧简称记进产品别名可省下次再问。
- 17track 抓取偶发空手(restapi 还在 `code:100` 就超时),**判"没数据"前必须重试一次**(8/4 首轮两票 NO DATA,重试即出 Delivered)。
- **8/6 补第五个坑:`_classify` 没有"派送未果"分支**。UPS 页面顶部写 `Delivery Attempted`,底下 `On the Way` 还亮着 → 旧代码撞上 in-transit 词表判成 **InTransit**(正常状态,不播报)。CN 票 1Z03KC740436008893(宝石5×8 + Terastal Gathering×110 + 评级卡)**8/6 上门没人签,系统一声没吭**,Gary 自己发现。已加 `AttemptFailed`(**必须排在 in-transit 判断之前**,兼容中日文「不在/ご不在/受取人不在」),inbound_notify 对这个状态**每天重播**(漏掉=整票退回中国)。同时修 `_find_eta`:UPS 把日期放在 "Estimated delivery" 的**下一行**,原正则 `[^\n]` 不跨行 → ETA 永远取不到,现改 `[\s\S]`。7 个用例全过(含"17track 页面里没有本单号→None"回归),dry-run 已发出正确消息。
- **acquisitions 两类行别混**:`origin=jp_vendor` + status=Received + 无运单 = **日本本地买入**(落 Japan Warehouse,不是到美国);`origin=jp_to_us_shipment` + 有运单 = 真发美国的票。`quantity_received` 全系统基本没人维护(5 月的单还挂 recv 0),**判到货只能看运单/实物,不能看 status**。

## 买取 review(8/4 上线,Gary 要"判断是 market 的百分之多少")
- `inventory-sync/buy_review.py [--date] [--days N] [--who]` — 读 acquisitions,每个产品过 `erp_pricing.price_product` 取 tcg_market,算**单价÷市价**。只读不写。钉 id 的才进均值,模糊匹配单列成钉价候选证据;**比值落在 30%–140% 之外一律当数据错单独隔离**——这个隔离**当天就抓到了真错**:OP-09 盒 ×530 单价 $2(市价 $663)一条把均值从 82% 拉到 6%,查下来是**数量和单价填反了**(见下)。8/5 修完重跑:20 条钉价行 $24,332 买入 vs 市价 $29,476 = **82.5%**、0 条隔离;最薄 Vivid Voltage 92.0%/Chaos Rising 90.9%。无市价的:海贼王盒、日文(In Bag)袋装 → 要钉 id 或走 130point。
- **数量/单价填反(8/5 修,Frank 在 Inventory In&Out 自认 "it was flipped it was 2 boxes for 530")**:8/3 那条 OP-09 盒本该 `2 × $530`,填成了 `530 × $2` —— **总价 $1,060 两种填法一样,所以钱对、账不对**,金额对账永远抓不到这类错。已改 acquisitions 5f44ae1d(qty/recv 530→2)+ receipts 9d938e68(530→2)+ 三个房间 avg_cost_basis $2→$530(备份 op09_flip_backup.json,乐观锁+回读);库存不用回滚(三行早已是 0,货 8/4 卖掉了)。**唯一抓得住它的就是 buy_review 的市价比值**,所以这个哨兵别关。
## 市价映射(8/7 Gary:"市价我们就需要建立系统 用我们master sealed 入库的时候假设没有sku 我们就加一个到master sealed list 做为映射")
- **实测覆盖率只有 32.8%**(`scratchpad/pin_coverage.py`):在库 191 个 SKU / 9,926 件,能定价的只有 **66 个 / 3,252 件**;**125 个 SKU / 6,674 件取不到市价**,光前 30 条就压着 **约 $12 万成本**(Storm Emeralda 盒 288 件≈$4.9万、In Bag 278≈$2.9万、Unsealed 129≈$1.5万)。
- **现有映射表三个硬伤**:① **按产品名做 key** → 7 月给 164 个海贼王产品加 `[EN]/[JP]` 前缀,**286 条钉价里 90 条(31%)的名字在 products 里已经不存在了**,悄无声息全废 ② **是 JSON 文件不在库里** → app 看不见,所以"入库时检查有没有映射"这件事**现在根本做不到** ③ **散成 6 个以上文件**:`sku_urls.json`(286)`snkrdunk_urls.json`(68)`snkr_overrides.json`(11)`snkr_verified.json`(19)`proposed_url_map.json`(134)`jp_prices_prev.json`(42)+ goldin 若干。
- **钉 TCG id 覆盖不了三分之二的货**:未钉的 6,674 件里 **CN 3,139 + JP 2,257 = 5,396 件 TCG 根本没有线**(中文宝可梦完全没有),**只有 1,278 件是 EN 能直接钉**。所以映射必须是 `source + key`(tcg / kaitori / snkrdunk / 130point / manual),不能只存一个 TCG id。
- 建议落法:Supabase 建 `product_price_sources(product_id, source, source_key, verified_by, verified_at, note)`,**按 product_id 不按名字**;erp_pricing 改读这张表;AddProduct/Intake 提交后若该 SKU 无价源就标 `needs_price_source` 进待办清单(**不拦提交** —— 拦了人就绕开 app)。
- **8/7 实测 CN/JP 走 TCG 的可行性**(`scratchpad/tcg_jp_cn_probe.py`,拿在库最大的 26 个未定价 JP/CN SKU 实跑):**JP 能过一半**(10 个 / 744 件出价:Storm Emeralda 盒 $188.31、[JP] OP-13 盒 $471.59、Inferno X 盒 $129.18、Uma Musume $54.09…)**但 erp_pricing 自己就给这些打了 `HIGH JP -> VERIFY vs eBay` 的标**,因为 TCG 的日文线挂单薄、价虚高,不能直接信。**CN 一个都没有**,代码里写死了 `NEEDS_EBAY_US (TCG has no CN)`。
- **第三类问题不是价源,是我们自己的命名**:`others (Other)` 929 件、`Storm Emeralda (In Bag)` 278、`Abyss Eye (In Bag)` 45、`Stream JP (order) (Other)` 6 —— 这些是日仓的**收纳桶名和包装变体,不是真产品**,任何外部价源都永远匹配不上,只能挂到母产品上按比例推,或者清理掉。
- 价源优先级:**130point(真成交中位)> eBay Buy It Now(是要价不是成交,只能当上限)**。eBay **sold 搜索要登录**、BIN 不用。**必须在库里标明这条价是"要价"还是"成交"**,否则会把挂牌价当市价用。
- **8/7 已上线 eBay BIN 价源(Gary "go 走ebay bin 的逻辑")**:`ebay_bin.py`(通用取价,**复用** `ebay_jp_prices` 的 `_raise_if_blocked` / `_is_pack_listing` / `_parse_price`,不 fork)+ `data/ebay_bin_queries.json`(查询词人工可改)+ `ebay_bin_run.py`(驱动;**取不到就保留旧值,绝不用空覆盖**)。返回值带 `kind: "ebay_bin_ask"`,消费方不许当成交价显示。
- **🔴 修了一个正在流血的 bug:eBay 改版 SERP,`li.s-item`/`.su-item-card__*` 全废**,现在是 `li.s-card` + `.s-card__title` + `.s-card__price`。后果:60 张卡正常渲染但标题全空 → `_raise_if_blocked` 见有卡就放行 → 判成"没有匹配" → **`ebay_jp_prices.json` 8/6 23:45 被覆盖成 `{}`,kaitori 板的 eBay 列已经空了**。两个文件都加了新哨兵:**有卡但一条标题都解析不出 = 改版,抛 EbayBlocked**,让调用方保留旧价。
- 另一个坑:`li.s-card` 和 `.su-card-container` 会匹配到**同一张卡**,一起查会把每条 listing 数两遍(报 50 实际 25)。现在只用一个选择器族 + 按 URL 去重。
- CN 首轮 6/6 出价(cost/u vs eBay ask):Gem Vol.5 $30→**$36.99**(49 条)· Gem Vol.4 $18.10→**$30.99**(57 条)· Terastal Gathering →**$64.98**(53 条)。**下面两条只有 1–9 条挂单,不能当市价用,要人工复核**:红/蓝 promo pack $1→$9.99(**各只有 1 条挂单**)· Venusaur jumbo $3→$16.98(最佳匹配标题是 "**Primordial Arts** Venusaur Jumbo",可能不是同一套)。

### CN 缺什么 / JP 缺什么(8/7 Gary 问,`scratchpad/lang_gap.py` + `variant_pin.py` 实查)
- **CN 只缺 5 个 SKU / 3,139 件 / $8,799**,而且正好就是已配好 BIN 查询的那 5 个 → **CN 这条线其实已经通了**,剩下的是复核那 3 条弱证据(红/蓝 promo 各 1 条挂单、Venusaur jumbo 标题存疑,而 jumbo 是 1,705 件的大头)。
- **JP 缺 25 个 SKU / 2,217 件 / $98,986,但归并后只有 9 个"套"**。**Storm Emeralda 一个套就占 $87,043 = 88%**,其余全部加起来不到 $12k。**别按 SKU 排工作量,按套排。**
- **`products.variant` 列本来就有**(sealed / unsealed / in_bag / single_pack),变体建模是对的;**错的是钉价按名字** → 母产品钉了、变体名字不同就取不到价。实证:**Abyss Eye 盒和散包都钉了,`Abyss Eye (In Bag)` 45 件没钉;Ninja Spinner 盒钉了,`(Open)` 13 件 + 散包 200 件没钉** = $3,198 纯粹因为变体自己有个名字而定不了价。**这是"必须按 product_id 不按名字"最干净的证据。**
- **`Storm Emeralda (In Bag)` 的 `type=Pack` 是错的**:acquisitions 里每一条都是 ¥15,000–17,000/个,和整盒同一个价位带(散包实际是 $3.37)。**那 278 个是盒不是包**,$102.93 的成本是对的,type 要改。
- **未定价里真正"外部价源永远匹配不上"的只有 `others (Other)` 929 件和 `Stream JP (order)` 6 件** —— 日仓的收纳桶,不是产品。之前把 In Bag / Unsealed 一起算进"命名问题"是我判错了,它们是正经变体。

### eBay BIN 两个新过滤器(8/7,都是被真数据打出来的)
- **`_is_partial_box(low, packs_per_box)`**:Storm Emeralda 首查报 **$65.69**,点开是 `"... Booster Box M6 ... Sealed 10 Pack"` —— **拆开卖的 10 包**,底下还有 15 包 $81.60,而真整盒 $139.59 起。`form="booster box"` 和 `_is_pack_listing` 都拦不住它(后者只认 "single pack")。**取最便宜的会把市价报成真值的 38%,而这是我们最大的一个仓位(655 盒)。** 查询词要填 `packs_per_box`。
- **`_is_multi_set(low, set_code)`**:OP-13 首查 **$68.99 / 55 条**,样本全是 `OP-10 Royal Blood ... OP-01-15 OP-05 OP-13` 这种关键词堆砌,和 `OP(01-15)` 这种"任选一套"的菜单挂单。**光加 `must_any:["op-13"]` 没用 —— `OP-01-13` 里就含 "op-13"**。现在的判法:**同一标题里出现两个同族套号(或一个 `OP-01-15` 区间)= 菜单/堆砌,直接丢**。加完 $68.99 → **$112.00 / 37 条全干净**。10 个用例全过。
- 查询词新增可选字段:`packs_per_box` · `set_code` · `must_any`(驱动侧转成 `must` 谓词)。
- **JP 首轮实跑,结论是"价源不缺,挂单太薄"**(这正是 erp_pricing 给 JP 打 `HIGH JP -> VERIFY` 的原因):**Storm Emeralda $139.59 / 46 条(唯一够厚的)** · **OP-13 $112.00 / 37 条** · Uma Musume $148.76 / **只 2 条** · Inferno X $199.48 / **只 1 条** · Limit Over Collection **0 条**。**≤2 条挂单的不许当市价用。**

### 🔴 Storm Emeralda 定价对照(8/7 首次拿到市价,`scratchpad/storm_vs_market.py`)
- 在库 **655 盒**:sealed 251 @ $173.13(**124% of ask**)· in_bag 278 @ $102.93(74%)· unsealed 126 @ $114.05(82%)。**总账 book $86,440 vs ask 值 $91,431 → 整体还安全($4,990 余量),但 sealed 那一档单独看是亏的**($8,421 高于 ask)。
- 历史买入 **1,152 盒 / $175,909 / 均价 $152.70 = 109% of ask**。**买价一路在跌**:7/30 $194–214(139–154%)→ 8/2 $113.90(82%)→ 8/4 $134.00(96%)。今天的 ask 是 8/7 的快照,**7/30 那批高不一定是当时买贵了,可能是市场跌了 —— 没有历史 BIN 数据不能下这个结论**。
- **但 8/6 那批 49 盒 @ $173.13 = 124%,是昨天买的**,市场漂移解释不了;8/3 那票 73 盒 @ $182.22 = 131% 同理。**这两笔正好是 buy_requests 闸门的用途**(49×$33.54 = $1,644,73×$42.63 = $3,112)。
- **OP-13 盒成本 $180 vs ask $112 = 161%** —— 13 盒,$884。

## 🔴 门店 "already sold" 真因(8/7 查实,Gary 问"这个sold是怎么回事")
- **扫码排序 bug 已经修好了、也上线了**(`426b758`,origin/main == HEAD),但 8/5 门店群里一个班就报了五次。**剩下的不是排序问题,是"实物在手、系统里这张卡没有活行"** —— 这时扫码回落到 sold 行是**正确行为**,只是没给收银台任何出路。
- **病灶在 `StorefrontSale.jsx:356`:`if (single.status === 'sold') { addToast('Already sold','error'); return }` —— 硬拦,没有覆盖入口。** 而**紧接着下面几行就已经有正确的做法**:数量对不上时弹 "App only shows N in stock, you scanned another physical copy. Add it anyway?" + `stock_adjust=true`(6/9 铁律**实物为准**)。**同一个原则,只用在了数量上,没用在 sold 状态上。** 修法就是把这个 confirm 扩到 sold:允许开单,结账时克隆/复活一行,而不是把人挡在门外。
- **后果是真的丢钱,不是体验问题**:staff 打字记的 8/5 三笔 **"Sold for $300 cash" / "Sold $50. All came up sold" / "Sold $10. Also sold in system" —— `storefront_sales`、`singles`、`slabs` 三张表 8/02–8/08 整周全查,一分钱都没有(`scratchpad/sold_gap.py` + `sold_singles_day.py`)。合计 $360 收了钱、零记录、库存也没扣。** 同班的 $195(3 张单卡)和 $15 是记上的,所以不是整台机器坏了,**是专挑扫出 sold 的那几单漏**。
- staff 原话 **"For the sold in system can i get a bar code / All the customers are already gone"** —— 他们要的就是一个能重新建行的入口。**没有出路的拦截,结果不是"没卖",是"卖了不记"。**
- 对账坑:**单卡销售不在 `storefront_sales` 里**,是 `singles` 上的 status=sold 行。只查 storefront_sales 会把 $195 误判成丢单(我第一遍就这么错了)。任何门店对账必须两张表一起查。
- 8/3 群里那句 "Sold $100 cash. Showing sold in system" **不算数** —— 8/4 17:37 PT 确有一笔 $100 tx(1b509b7c),对得上,不列入缺口。
- 参考:全库 2,533 个有单卡行的 tcg_id 里,**1,196 个只剩 sold 行**(卖光了就是这个状态,本身不是 bug),**49 个 sold+live 并存**(这 49 个才是排序修复覆盖的范围)。

### 🔴 "sold 之前已经被 mark" 的真凶 = 整车结账允许部分成功(8/7 查实)
- `submitStorefrontTransaction`(supabase.js:4368)**每行独立 try/catch,没有事务**;失败的行进 `failed` 留在购物车,成功的行**已经写成 sold 了**。然后:
  ```js
  if (ok.length > 0 && normalizedPayments.length > 0) {   // 只要有一行成功
    ledgerRows = normalizedPayments.map(p => ({ amount_usd: p.amount }))  // ← 客人付的全额
  ```
  **total 模式下总额是在写库之前就 `distributeCartTotal` 分摊到全部车行的** → 一半行失败时:**付款账记全额、货品只记活下来那几行、失败那几行的库存永远不扣**,而且数据里没有任何报错痕迹。
- 收银员重试时,第一次成功的那几张**已经是 sold** → 报 "Already sold"。**这就是"系统里在 sold 之前已经 mark 了"。**
- **实测(7/8 起,只算纯 sale,join 只按 transaction_id)**:**283 笔里 274 笔分毫不差,5 笔对不上,合计 $1,081.11**。最大一笔 **7/24 `8371256c`:收款 $1,228,货品只记 $294.72** —— $1,228÷$49.12 = 25 件,只写进 6 件,**19 件库存从没扣过**。另外四笔的缺口是干净的比例(paid $25 / 记 $12.50 = 正好一半;$110 / $60;$139 / $92.67 = 2/3;$199 / $160),全是"车里 N 行、写进去 M 行"的形状。
- **对账坑(我自己踩了)**:付款按 `created_at`(UTC)、货品按 `sale_date`(PT 日历日),两边都加日期过滤会把 7/07 的单算成"零货品"。**join 只能按 transaction_id,日期过滤只许加在一边。** 加错了会虚报 $695。
- **8/7 已改完(本地,待 Codex + Gary 说"发")**,四层,不是补丁:
  1. **`preflightStorefrontCart(cart, {transactionType})`(supabase.js,新)**:`submitStorefrontTransaction` 在**写第一行之前**把整车拿去和数据库现状核对(3 次查询,和车大小无关)。有一行卖不了 → **整单拒绝,一个字都不写**,抛出的 error 带 `blockers[]`(每行一条原因 + `fixable` 说明该按哪个覆盖)。**故意重新读库不信购物车** —— 车是几分钟前扫的,状态正是那个会变的东西,这个竞态就是病根。**读不到就 throw(fail closed)** —— 拒单只是重试一次,写一半是永远找不回的钱。买入(buy)不校验,它是加库存的。
  2. **sold 覆盖(实物为准)**:`StorefrontSale.jsx` 的硬拦改成 confirm("app 记它 X 日 $Y 卖掉了,你手上有实物就照卖,旧那笔一动不动")→ 行上带 `sold_override` → `_sellSingleLine(allowSoldOverride)` → **`_recoverSoldSingle` 克隆一行新的 sold 行**(带成本/身份/图),`sale_notes` 前缀 **`RECOVERED_AT_COUNTER`**(可 grep 审计,指明原行 id 和 tx)。**绝不回改历史 sold 行**(卖出铁律)。slab **不给覆盖** —— 唯一实物,"卖了又在手上"是退货流程不是重卖。
  3. **缺口必须刺眼**:返回值加 `recorded_value` / `shortfall`(收款 − 实际写进去的货值)。>$0.01 时收银台弹**红色常驻横幅**(不是 toast,toast 会被下一单刷走):"$X 收了但没记上,叫经理"。**付款账仍记全额** —— 钱确实在抽屉里,把账砍到和货对上等于让两本账互相自洽却和现实脱节。
  4. **sealed 同一条死路也补了**(8/7,原来 `no stock anywhere` 同样是硬 return):确认 → 行上 `stock_adjust` → `_sellSealedLine(allowStockAdjust)` **先把差额写进 Front Store 再卖**。**成本从同产品别房间的 `avg_cost_basis` 抄,绝不编**(抄不到就留 null,让 P/L 显示零成本 = 明显错,而不是似是而非的错)。购物车里的数量上限跟着实物走,否则会把收银员刚说错的数字又夹回去。UI 的 confirm **必须写在 `setCart` 外面** —— 放进 state updater 会在 StrictMode 下双触发(代码里原本就注明过这个坑,我第一版踩了)。
- 测试:`scratchpad/preflight_test.mjs`(stub supabase 直接跑函数本体)**34 用例** + `split_rule_test.mjs` **12 用例**,全过;`npx vite build` 通过。
- **Codex 连审两轮,首轮直接判"不建议合并"(3 个 P0),第二轮又抓出我修的时候新引入的 2 个回归。改完的清单**:
  1. **P0 并发覆盖已完成销售**:`markSingleAsSold` / `markSlabAsSold` 原来是无条件 update → 两台收银机同时读到可卖,第二笔会**覆盖第一笔的 transaction_id / 价格 / 日期 / 付款方式**,直接违反卖出铁律。现在都带 `.neq('status','sold')`,0 行就抛"别人先卖掉了"。
  2. **P0 preflight 查的房间 ≠ writer 能扣的房间(我引入的)**:preflight 原来把**所有**房间的货加起来,而 `_sellSealedLine` 只能动 Front Store + Master(不够时从 Master 自动 Move)。结果直播间有货就放行,writer 照样抛 —— 正好造成这个闸门要防的半提交。现在只算 Front+Master,并提示"另外 N 个在直播间,要先走 Move"。
  3. **preflight 读的数据没交给 writer**:writer 收到的仍是**扫码那一刻**的快照。现在 preflight 返回 `{blockers, sources}`,`sources[line.key]` 是刚读的行,submit 用它替掉旧快照。
  4. **🔴 `avg_cost_basis` 忘了 select(我引入的回归)**:sources 里没有成本 → Master→Front 自动 Move 传 `newAvgCost=null` → `updateInventory` 新建行写成 **$0**,**把正常销售的成本也清零了**,不只是覆盖场景。
  5. **🔴 重复车行(我引入的回归)**:光"按 id 汇总需求"不够 —— 每条重复行**各自按同一份快照写**,Front=1 + 两条 qty=1 会扣到 **-1**。现在重复行直接拦,提示合并成一行。slab 重复同理。
  6. sealed 先建销售行再扣库存 → 扣失败**删掉刚建的那行**(和拆分路径同一个"回滚自己产生的失败痕迹"先例);**必须检查 delete 的 error** —— Supabase 是把错误放在返回值里不 reject,不查就会一边说"已回滚"一边把行留在库里,收银员再录一遍。
  7. **成本诚实**:recovery clone **不抄成本/来源**(手上有实物 ≠ 和那笔进货同源,抄了会把同一批 COGS 记两遍),全 null 并在 `sale_notes` 写明;sealed 覆盖若全库找不到成本,在 `storefront_sales.notes` 明写"$0 是未知不是免费"。
  8. 拆分克隆补上 `grade` / `grading_company` / `photo_url`,**故意不抄 `cert_number`** —— 一个 cert 只对应一张实物,一堆里说不清是哪张,抄了就是编身份。
- **第三轮问的是"这版相对生产是否更糟",Codex 又抓出两条,都已改**:① **补偿用硬删** —— 生产至少还留着"销售已记、库存没扣"的半截账,硬删会变成**钱收了、销售记录没了**,还违反软删铁律 → 改成 `deleted=true` + `deleted_at` + `notes` 写明作废原因,报表本来就滤 `deleted`,证据留下 ② **我把查重移出 `setCart` 后,两次快扫会各自 append 一条**(生产在 updater 里查重不会)—— 确认必须留在外面(StrictMode),但**追加要对 `prev` 幂等**:updater 里重查一遍再合并;单卡侧同样处理,且递增改成从 `prev` 加 1(原来用 render 时算好的 `nextQty`,两次快扫会互相覆盖丢一张)。
- **🔴 另外三个文件 Codex 判 DO NOT SHIP,4 个 P1,别跟着一起发**:① **Intake 撤销在 Smart Allocator 分完货之后仍可点**,只从 Master 扣回整批却不撤 Move 和目标房库存 → Master 可能负库存 ② 撤销**非原子**(先扣库存再恢复 acquisition 再删 receipt),中途失败按钮还在,再点一次**重复扣库存**;`deleteReceipt` 还是硬删 ③ **`fetchOpenSurplus` 查询失败降级成空 map**,于是所有销量被标成 `exact` —— **证据缺失时反而制造了确定性**,应该全标 unknown ④ `≥` 只是提交时的临时 UI 字段,**没落库**,刷新后历史和 `total_sold` 汇总仍是裸数字,下游照样当精确值用。
- **P0-1 真原子性没解决,也解决不了(在 JS 里)**:`scripts/add_storefront_checkout_rpc_2026_08_09.sql` 写了锁模型(**标了 DO NOT RUN YET**,写入部分还是 TODO;`sum() ... FOR UPDATE` 在 PG 里非法,已改成先 `PERFORM ... ORDER BY location_id FOR UPDATE` 再 sum,顺序固定防死锁)。**Codex 明确认定:单就原子性而言这版相对生产不是回归** —— 生产本来就是同一个逐行循环,而且连 preflight 和并发保护都没有。

### 🔴 门店买入自 7/28 起整个断档(8/7 按群聊对账查出,`scratchpad/chat_recon.py`)
- **`storefront_sales` 最后一笔 `transaction_type='buy'` 是 2026-07-28;之后 10 天零 buy、零 trade。** 而 STOREFRONT CHATS 里同期有 **6 笔买入 ≈ $3,120**(8/3 destined rivals bundles $110 · 8/4 $1,225「market $1,700」/ $150 / $600「market $800」· 8/5 $800「market $1,020」· 8/6 $120「market $180」· 8/7 $115「market $180」)+ 8/4 一笔 trade in $500。对比 7 月:7/20 有 7 笔 $1,750、7/23 有 5 笔 $1,957 —— **不是没人买,是没走系统**。
- 卡确实进来了:**8/5 入库 27 张(市价 $1,773)、8/7 入库 10 张(市价 $271)**,全在 Front Store,`source_type='other'`,**35 行 100% 没有 acquisition_cost_usd**。所以**数量对、成本全空、付出去的钱没有任何记录**。
- **8/4 群里那笔「Buy $1225 market $1700」和 8/5 那批 27 张(市价 $1,773)差 4%,是唯一对得上的一组** —— 但这是**假设不是证据**,别当结论写库。
- **总买入 $3,120 vs 总入库市价 $2,044 = 153%**,明显对不上 → **这几笔买入不都落在这 35 张卡上**(destined rivals bundles 是 sealed;有些可能压根没入库)。**逐笔映射必须问门店,不能推。**
- **群聊里的金额永远不能直接改库存**:8/5 那三笔 "$300 / $50 / $10"(合计 $360,三张表全周查无)**一个产品名都没有**。金额不是物品,照着调库存就是编数据(不编数据铁律)。要补录只能门店说清卖的是什么。

### 单卡数量安全:sold 会不会把数量变 0 / 变负(8/7 Gary 问)
- **实测答案:不会。** `markSingleAsSold` **只改 status,从不碰 quantity**;`sellSingleQtySplit` 拆分路径 `remainingQty = sourceQty − sellQty` 且 `sellQty > sourceQty` 先抛错、`sellQty === sourceQty` 走整行,所以拆分后 **remaining 恒 ≥ 1**。全库实查:**singles 负数量 0 条 · singles "live 状态但 qty≤0" 0 条 · sealed inventory 负库存 0 条**。
- **但拆分与否原来是看 `form === 'raw'`,这是个雷**:一个**外观字段**决定了"卖 1 张会不会连带把另外 4 张标成 sold"。qty=5 的行只要 form 不是 raw,卖 1 张就走整行路径 → **5 张全 sold,剩下 4 张从货架和扫码里一起消失**(`lookupScannedCode` 只找 qty>0)。今天全库 **2,623 行 form 全是 'raw'**、两个入库页也都把 graded 钉成 qty=1,所以**一行都没中**;但**数据库里没有任何约束保证这件事**,改一下某行的 form 就悄悄armed了。
- **已改成只看数量**:抽出 `shouldSplitSingleRow(sourceQty, sellQty) = sourceQty > 1 && sellQty < sourceQty`,`form` 不再参与。整行卖(sellQty === sourceQty)行为不变,所以这个改动不可能回归。测试 `scratchpad/split_rule_test.mjs` **12 用例全过**,含 1..40 全部堆叠尺寸的属性检查:**没有任何一种卖法会把没卖的卡标成 sold(0 violations)**。
- **已排除的三个假设**(别再查):① 7/29 前整叠误标 —— 102 个整叠行里**只有 4 个后来又出现过**,98 个再没出现,和 Gary 8/3 "的确卖了" 的裁定一致 ② sheet import 与真行 tcg_id 碰撞 —— **0 个** ③ staff 重新建行绕过 —— 近两周新建 190 行,**0 行**是给已有 sold 行的 tcg_id 建的(**他们没绕开,就是直接不记了**)。

## Shopify 现状与全库存值(8/7 Gary 问"shopify 要挂吗 目前如何 总共的库存以及价值")
- **全库存(成本口径)**:sealed **10,777 件 / $223,990**(879 件无成本)· singles 1,495 张 · slabs 1,938 个。**singles 和 slabs 的成本 100% 全空**(`acquisition_cost_usd` 一条不填),所以"总值"只有 sealed 这 $223,990 是成本口径;singles sheet 市价 $31,904、slabs 市价 $528,168 **是市价不是成本,不能相加**。
- sealed 按房:Japan Warehouse 2,155 件 $78,775 · Master 2,913 $36,930 · Packheads 997 $28,835 · eBay LVUS 2,150 $27,125 · SlabbiePatty 615 $11,813 · RocketsHQ 710 $10,404 · Front 377 $9,138 · PokeAuctionHouse 706 $3,317 · PokeCasino 154 $2,750。
- **Shopify SKU 格式是 `LV-GEN-<形态>-<uuid8>`,取 `sku.split("-")[-1]`**。按前 8 位切会得到 "lv-gen-p" 全表撞成一个 key,匹配率从 148 掉到 33 且结果全错(我第一次就是这么错的)。
- **310 产品 / 90 active / 181 draft。90 个 active 里只有 19 个是卡品** —— 其余 71 个是 slab case / card saver / 代送评级服务,**本来就不该进重定价,不是漏配**。
- **美国可卖 sealed(排除日本仓)8,619 件 / $145,113**:**LIVE 19 SKU / 3,376 件 / $30,119(21%)· DRAFT 49 SKU / 968 件 / $32,149(22%)· 完全没挂 121 SKU / 4,275 件 / $82,844(57%)**。
- 没挂的大头:[EN] OP-09 盒 24 件 $13,899 · **Storm Emeralda 盒 66 件在美 $11,426(+182 在日本)** · [EN] OP-13 blister 545 件 $10,278 · Shining Legends pack 51 件 $5,355 · Venusaur jumbo 1,705 件 $5,115 · Crown Zenith Bundle 26 件 $4,849 · Pitch Black 盒 40 件 $3,810。Draft 大头:Celebrations Pack 375 件 $12,750 · [JP] OP-13 盒 13 件 · Gem Vol.5 54 件(**卡在"没图"**)。
- **今天 reprice dry-run:0 改动 / 14 不变 / 4 flag,4 个 flag 全是 `CN_MANUAL` / `JP_MANUAL`** —— 引擎取不到价的那几个,**正好是 eBay BIN 现在能补上的**。
- 挂价 vs eBay ask:**Uma Musume 盒 挂 $69.50 / 成本 $38.50 / ask $148.76 = 挂在市价 47%**(只 2 条挂单,弱证据但方向明确)· Gem Vol.4 挂 $36.00 / ask $30.99 = **116%,比最便宜的 eBay 要价还贵** · 红/蓝 promo $9.99 = ask 持平(各 1 条挂单)· **Storm Emeralda 根本没挂** · **OP-13 JP 盒 draft $214.99 vs ask $112 = 192%,上架也卖不掉**。
- **19 条 live 没有一条低于成本**,+5% 下限守住了。
- **🔴 顺带查到两个成本错**:① **Prismatic Evolutions Booster Pack** 8/3 进货 72 个 $828 = **$11.50/个,库存却记 $0.95(差 12 倍)** → 912 件少记 $9,622 成本,挂 $14.50 真实毛利 **26% 不是 1526%** ② **FB03 Dragon Ball** 挂 $172.50 却绑在成本 $2.33/个的产品上(进货 60 个 $140)—— **盒的挂牌指向了散包的 SKU**。注意 `BAD_COST` 只在 cost > 2×market 时触发,**成本被低估它一声不吭**。
- **5 组重复挂牌:一个 uuid8 上挂着两条 Shopify listing(盒 + 散包共用同一个 product)** —— Abyss Eye(盒 $109.50 / 包 $3.49)· Black Bolt · DB Fusion World · Uma Musume(盒 active $69.50 / 包 draft $1.93)。同一个成本会同时驱动两条价,必有一条是错的。

## Buy request 审批制(8/7 Gary:"他们先 put in buy record request 我们再批钱去买 我们 check 一下他们的 market prices 然后再跑")
- DDL 写好:`scripts/add_buy_requests_2026_08_07.sql`(`buy_requests` + `buy_request_lines` + `buy_requests_outstanding` 视图)。
- **最关键的一条设计:比值必须算在「单价」上,不能算总额**。OP-09 那笔 `530×$2` 和 `2×$530` **总额都是 $1,060** —— 银行对得上、收据对得上、批次总额也对得上,**任何金额级对账都永远抓不到**。只有 `unit_price ÷ market` 抓得到。
- **market_price / market_source / market_ratio 存快照不实时算** —— 批准之后价格会动,审批必须能按当时已知的价复核。
- **30 天回测(172 条买入)**:闸门会拦 **5 条 / $4,867**,最大一笔是 **Adventure on Kami's Island 散包 398 个按市价 143% 买入($3,781)**;还有一条 `Inferno X (In Bag) $113.90 vs 单包市价 $3.80 = 2997%` 是典型的**袋装对单包**单位错。但**只有 49/172 条现在能验**(其余没有价源)→ 所以价源表必须先落地。
- **故意不拦**:没有市价的行标 `unverifiable` 但**照样能提交**。CN 全部、JP 大半都没价源,拦了人就退回表格自己买 —— 和拦入库会把人逼去手改库存是同一个道理。
- 其他三条针对已发生事故的设计:`product_id NOT NULL`(治 storefront 110 条 buy 行没产品)· `paid_total` + outstanding 视图(治 $8,335 付 $4,000 欠 $4,335 系统看不见)· `source_ref` 记数字来源(治 8/5 按口头"110盒"建单、出库表实际 30 盒)。

- **买入侧两个空洞**:① storefront 的 `buy` 行 110 条里几乎全部 `product_id` 为空(买了什么不知道)② `singles.acquisition_cost_usd` 575 张全空(市价有 sheet_sync,成本没有)→ 单卡买取算不了百分比。③ acquisitions 没有付款状态字段(8/1 那笔 $8335 付 $4000 欠 $4335,系统看不见,只有 Frank 手上有账)。

## 在线订单出货(8/4 查账,Gary："online order ship sealed 总体数量对不对")
- 走 `online_orders` + `online_order_items`(选来源库位→产品数量→扣库存→发 Lark),**不写 movements、不写 platform_sales**,除了库存数字变化没有第二处痕迹。
- **数量对不上:Storm Emeralda Booster Box 缺 109 个**。Master 的 `receipts` = **0**(一次都没通过 Intake 收过这个产品),却从 Master 搬出 68 + 在线订单发出 41 = 109;Master 现在 0 没变负 → 货是**手动加库存**进去的,而手动加**不写 receipts / movements**,对账看不见来源(和 inventory 改数零留痕同一个洞,William audit-log SQL 待办)。正规路本该是 875140436410(75)+875218962982(73)走 Intake to Master,这两票至今 recv=0。
- **钱没落账**:`online_orders` **没有金额字段**;记金额的 `platform_sales` **最后一条停在 7/27**,已 8 天零收入行。8/1 以来发出的 41 个 Storm 盒(eBay 约 $280/个 ≈ $11.5k)系统里一分钱没有。
- Shopify 待发 = 0(notify_orders dry-run 确认),没有积压。

## Smart restock(7/22 上线)
- **到货推**:`arrival_allocator.py` — Master 快照增量=到货(排除拆盒)→ 按房速度(盘点负差 ∨ platform_sales ∨ storefront_sales,7d/30d 取快)填 7 天 cover,cover 最低先;`--product "名" [--qty N]` 手动。
- **缺货拉**:`tiktok_restock_advisor.py` — URGENT/RESTOCK/STAGNANT/BUY,CSV 在 data/。
- 到货全流程:CN/JP 财务 Base 出库栏=预告(canvas 表,人工读)→ expected-incoming 发 BACKEND CORE → 到货验货 → **当天入库** → allocator 自动分房;**实物搬动必记 Move**(治幽灵流入)。

## TikTok API(`../tiktok`)
- tokens `~/.tiktok/tokens.json` **三店**(PackHeadsTCG / RocketsHQ / VaultTcgAuction);products/search 用 `"ALL"`。
- **8/5 实测推翻旧结论"95% 是 $1 坑位无 SKU"**(`_sku_coverage_probe2.py`,近 7 天):**每一条订单行都有 product_name,0 条为空**。PackHeads 855 件 / **34 个标题**,约一半是具名产品(OP-13 blister 74、CN jumbo 68、Marvel Masterpieces 51…),另一半是 `$1 START PACKS` / `Dollar Starts` 这类**坑位**;RocketsHQ 195 件 / 6 个标题,大头是 `PACK AUCTIONS!`,具名的只有 ~29 件;VaultTcgAuction 346 件 **100% 坑位**。
- **结论:API 不能取代盘点,但能吃掉一半**。拍卖坑位的订单永远不知道实物是哪个 SKU(主播在直播里挑),这部分只能靠盘点;具名产品那部分应该自动扣减。
- **`apply_orders_to_inventory.py` 早就写好了这套**(订单行→movements 到 `Sold - *` 虚拟房→扣库存→`tiktok_applied_lines` 幂等台账,只认 `reviewed=true` 的映射),**但四张表 `tiktok_orders/order_items/product_map/applied_lines` 从没建过(DDL=William),6 个 `Sold - *` 虚拟房至今 0 条 movement**。这是"盘点 expected 永远不含销量"的根因。DDL 已写好:`scripts/add_tiktok_order_sync_2026_08_05.sql`(含 `reviewed` 未审不生效的 CHECK、`units_per_listing` 处理 10-PACK листing、`is_slot` 标记拍卖坑位、补建 `Sold - TikTok Packheads` 房)。

## 盘点=销量尺(8/5 Gary:"这个数其实是为了上一个主播数的 就是对应他们的货卖掉了多少")
- 盘点的本质是**给上一场主播算销量**:`sold = expected − actual`。**expected 一旦错,这把尺子就废了** —— 实物高于账面时 actual 永远 ≥ expected,该 SKU 每场都算出 `sold 0`,货照样往外走。**实测 7/25–8/6 Packheads 因此吞掉 91 件销量 ≈ $2,615 成本**(最干净的病例:OP-13 blister 三个人五次盘点 170→156→150→128,走了 42 片,系统记 0;`scratchpad/swallowed_sales.py`)。
- **8/5 已上线修法(未 push,待 Codex)**:`fetchOpenSurplus(locationId)` 读近 12 次盘点算出"仍高于账面"的 SKU + **连续几场没解决(streak)**;StreamCounts 提交时,**之前就有多出的 SKU 销量标 `≥`(下限,不是精确值)**,本次仍多出的 SKU 在报表和 Lark 里明说 **"sales UNKNOWN this session, not zero"** 并带 "reported N counts in a row"。**盘点页面本身不显示任何多出信息**(盲盘不能泄露 expected)。实测 streak 正确:OP-13=5、FB03=5。
- **销案判定必须比当前库存,不能比当初那次盘点**(Gary 8/6:"不想看到这个warning")。`fetchOpenSurplus` 现在拿"最近一次盘点数到的 actual"和**此刻的 inventory.quantity** 比:账追上了就自动 CLOSED,不用等下一次盘点。改完当场验证:RocketsHQ 的 Perfect Order(数到 160/账 190)、Chaos Rising(27/27)因为 Aldo 那批写库已自动销案。**修完就不再报 = 警告才有人看**。
- **销案第二条(更重要):盘点后账被动过 = 这次观测作废,直接销案**。盘点是**带时间戳的一次观测,不是长期主张**;只要有人动过那个 SKU,旧观测就过期,真有问题下次盘点会再报。少了这条会出现"修完还在报":① **Journey Together 挂了三周 "+41"**,而 Aldo 7/17 00:24 **规规矩矩记了 Move 把那 41 包搬去 eBay LVUS** —— 账归零完全正确 ② **Ayakashi RocketsHQ "+26"** 是拿 Frank 8/5 **15:28 UTC** 那次去比 Aldo **18:20 UTC** 的更新数(Aldo 晚 3 小时),**写成 29 等于用旧数覆盖新数**。判定用 `created_at`(提交时刻)不用 `count_time`(可回填)。
- **改完实测(8/6,`scratchpad/verify_open_surplus3.py`)**:**RocketsHQ 归零,一条警告都不剩,且一行库存都没覆盖** —— 两条都是误报。全系统只剩 **Packheads 8 个 / 95 件** + eBay LVUS Battle Styles +2 = **97 件**。Packheads 那批基于 JV 8/6 04:33 的数,脚本 `packheads_baseline.py` dry-run 通过,**写库被 classifier 拦两次,待 Gary 放行**。
- 已知限制:`fetchInventoryForRoom` 用 `.gt('quantity', 0)`,**账归零的 SKU 会从盘点表消失**。正常卖光/搬走是对的,但万一实物还在就再也数不到。

## App(本仓库,Vercel,push=生产)
- 只在 Gary 说"发"时 push;**所有改动过 Codex review(铁律 7/20)**。
- **7/29 已上线(60d2f12→b31bde4 五连发,每笔过 Codex)**:单卡拆卖(sellSingleQtySplit 三路共用,先插 sold 行+乐观锁扣减)· **singles sale_price_usd 语义统一=单价**(旧整行卖存总价,P/L 显示偏高属已知)· 渠道词表 `src/lib/saleChannels.js`(每直播间一值、eBay 分账号、去 COMC/泛 ebay、in_person 显示名=Storefront、加 shows、默认空强制选)· 标题直达 TCGplayer(tcg_id)· 卖卡弹窗显示 Market+sheet D 列 recent sales(`api/singles-price-detail` 实时读表,边缘缓存 10min)· /cards 两表 50 行分页 · /inventory 房间默认折叠(搜索自动展开)· scan 队列芯片带市价。验证部署要盯 **bundle 换名**,别用宽泛词 grep(7/29 误报教训)。
- **8/3 已上线(55f5434+426b758,过 Codex)**:① fetchSingles/fetchSlabs/ViewInventory buckets 全部接 `fetchAllPages` 分页(PostgREST 1000 行截断 → /slabs 曾隐形 ~1500 行、/inventory 房间 slab 数虚少,"90个slabs"之谜)② 扫码 lookup 活行优先(sold 行永不压活行;`lookupScannedCode` 先查 in_inventory/listed qty>0 再回落 sold;POS 传 `preferLocationId`=Front Store 防扣错房)。**门店"already sold"病根二分**:扫码排序 bug(已修)+ 99 个 tcg_id 只剩整叠 sold 行(5/26-7/14 老 bug 遗留)—— Gary 8/3 裁定:**的确卖了,保持 sold 不恢复**。7/28 tx 847aeb17 补录 Mega Evolution Booster Box $320 销售行(收款$1085-行$765 缺口,已平)。
- 设计已定待 Gary 点头开工:Cards Scan 加"来源交易"下拉(trade/buy 关联+trade_in 按市价分摊成本,治单卡无成本病根)+ 重提防双录 + buy 手写行 sealed 关键词提示。7/28 双录 trade 已修(备份 double_trade_backup_0728.json)。platform 扫车 singles 仍存小写渠道('ebay' 等,报表兼容,细分待办)。
- 门店对账待办(8/3 群聊考古):Storm Emeralda 8/3 两笔$160(3箱$320,疑多录1箱)+ OP-13 blister 双$20 —— 待门店确认;"Buy 2 destined rivals bundles $110" 未入系统;7/24 19包 Paldean Fates 未扣(系统 Front Store 13 包,下次盘点实点);**每日 storefront 对账模块**(收款vs行/双录/幽灵扣减→群里@当班)方案已提待 Gary 批。盘点 found-extra 写入=过审制:8/3 Packheads 按 Trey count 写入4项多出+Pitch Black -1→0(备份 trey_recon_backup_0803.json)。
- 历史疑案待门店确认:7/28 Pikachu ×3 $9、7/24 Elgyem ×2 $15 两笔 in_person 整行多张 sold —— 真打包卖 or 误全卖?误卖则拆回。
- 房间名是硬编码字符串:改名/加房要全改 StreamCounts/Moved/OnlineOrders/PlatformSales/Returns + api/*(lark-notify/sheet 路由/日报周报)+ inventory-sync 脚本 + lv-finance/weekly_cogs。
- William 待办 SQL:`scripts/add_inventory_audit_log_2026_07_23.sql` · product_prices · product image column。
- 产品图:`useProductImages.js` ← lv-slabs.luckyvault.us/kaitori/product_images.json(改磁盘即生效)。

## 群里 @ bot(8/7 Gary 问"有时候群里会被 at 你能看到吗")
- **两个 bot,只有一个听得见**:群里那个 `Inventory Tracker` / `Packheads Inventory Bot` 是 **Lark incoming webhook,只出不进** —— 构造上就没有入站通道,**@ 它等于对着墙说话**,历史上每一条 @ 都是石沉大海。
- 真能读群的是自建应用 **"Lucky" `cli_a92bf28169b8deed`**(权限 `im:message:readonly` + `im:chat` + `im:message:send_as_bot`,凭证 `lv-finance/.env` 的 LARK_APP_ID/SECRET,读写封装在 `lv-finance/lark_bot_pull.py`)。**但它只被拉进了 BACKEND CORE**,而 @ 都发生在 Inventory In&Out。
- 已写好 `inventory-sync/mention_watch.py`(读 bot 能看到的所有群 → 抓真 mention + 纯文本 "@Inventory Tracker" 两种 → `data/mention_watch_state.json` 去重只报一次 → **只读不回**,以 bot 身份在群里说话是对外的,要 Gary 批)。跑通了,现在报 0 条 —— 因为看不到那个群。坑:`BOT_NAMES` 里**别放裸 "lucky"**,会匹配到人名 "Lucky Vault"(首跑误报 4 条)。
- **8/7 已在 Lark 开发者后台配通(AdsPower k1bkorhr)**:病根不是权限 —— `im:message` / `im:message.group_msg` / `im:message.group_at_msg:readonly` / `im:message.group_at_msg.include_bot:readonly` **早就全给了**,但 **Events & Callbacks 一直是空的**(`Subscription mode: Not configured` / `Events added: No data`),Lark 根本没地方推。已做:① 订阅方式选 **persistent connection(官方推荐,不需要公网域名 → 不依赖发版)**,Verify 显示 **Connected**,已 Save ② 加事件 `im.message.receive_v1`,所需 5 条 scope 全部 Added。
- **`inventory-sync/lark_mention_listener.py`(新)**:官方 SDK `lark-oapi` 长连接,收到的 @ 逐行 append 到 `data/lark_mentions.jsonl`(只读不回)。**坑:SDK 默认连 open.feishu.cn,必须传 `domain=lark.LARK_DOMAIN`**,否则秒断 `1000040351: Incorrect domain name`。控制台的 Verify **只有这个进程在跑时才点得亮**。待办:给它配 run_*.bat 常驻,现在只是手动起的。
- **8/7 版本 1.1.4 已发布**(Gary 令"你帮我提交一下"):表单显示 `Scope changes: None`(不申请新权限、不动 Availability),提示"exempt from review, goes live instantly",`Released at 2026-8-7 14:14`,Open Platform Assistant 回"App release request approved"。**事件订阅现已生效**。坑:创建后状态是 `Not Requested` **只是草稿**,必须进 View Version Details 再点 Publish 才真发布(中途刷新页面会把确认框弄丢)。
- **🔴 外部群这条路可能走不通(8/7 查实)**:**Inventory In&Out 是 External 群**(标题旁 External 标记,10 人/2 bot),PACKHEADS / STOREFRONT CHATS / SLABBIEPATTY / Whatnot / Aquisition Squad **全都是 External**,连 Franklin、Robert Ortiz 这些人都是外部联系人 —— 团队基本都在别的租户上。而 **BACKEND CORE 是唯一的内部群**(`external: False`,8 人),也正是自建应用唯一待的地方。外部群里的 bot **清一色是 webhook**。
- **命名陷阱**:Inventory In&Out 里那个 `Lucky Bot`(描述 "Push Custom Service Messages to Lark Via webhook")**不是**我们的自建应用;应用叫 `Lucky`,描述 "for shipping information",只在 BACKEND CORE。别把两个当成一个。
- 待验:UI 自动化没能打开外部群的"加成员"选择器,所以**没能证实**外部群到底收不收自建应用。**Gary 十秒可验**:Inventory In&Out → 右上角加人图标 → 搜 "Lucky" → 出现"for shipping information"那个就能加。
- 注意 bot **只能读入群之后的消息**,历史 @ 补不回来。
- 8/5–8/6 实际漏掉的 4 条:`@Inventory Tracker need to reverse thsi`(Prismatic 误收货,后来人工撤了)· `@Inventory Tracker nah bulk add didnt work`(假警报)· `@Inventory Tracker ^ this wasnt logged in our count`(Perfect Order ×92,至今没人答)· `@Packheads Inventory Bot maybe the manual add got added to master`(假警报)。

## 惯例
- 永不删产品行:清库存 = quantity→0。
- Lark:k1bkorhr(Gary 本人),fail-closed:占位符验证 → 清草稿(**循环清,多块草稿一次清不完**)→ 复验再打字;浏览器 CDP 卡死 → AdsPower stop+start;Frank=Franklin。
- PowerShell 5.1:参数禁内嵌双引号/emoji;Python 一律写 .py 文件跑;**禁用 PS 文本替换改 py 文件(毁 UTF-8),改文件只用 Edit/Write 工具**。
- Gary 授权(7/21)直接跑写库/本地修复;classifier 拦 2 次就停手交 Gary。
