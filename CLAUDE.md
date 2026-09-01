# LV Inventory — 作业手册 brief (2026-09-01)

## ✅ 9/1 海贼王语言前缀:26 个 SKU 查证完毕,**等 Frank 回话再落库**(Gary:「改一下语言前缀 和其他op一样」「改之前我看一眼」「你问问frank」)
- **21 个 agent 取证 + 对抗复核**(4.5M token):语言列不能信,但这次它 25/26 是对的——**唯一错的正是最贵那个**:`64c3983b One Piece: Asia exclusive Japanese Mini-tin Vol3 TS-03` 记 EN,实为 **JP**(47 罐 / 8 月买 $8,900)。**三方互证**:Bandai 亚洲官网「日本以外亚洲限定」+ 对抗复核未能推翻 + **我们自己 PackHeads 的 live listing 标题就写着「… Asia Exclusive TS-03 [JP]」**。
- **TikTok API 对账没有一条真矛盾**:Illustration Box 全族 = EN(Vol.5/Vol.6 标题直接写 English,Vol.3/4 用英文版 set 名 `One Piece Promotion Cards (OP-PR)`,**日版 listing 一条都没有**)· Tin Pack Set Vol.1/2 = EN · Double Pack Set = EN(DP 系列国际独占,日本从未发行)。两条看似矛盾的(OP-09 / PRB-01 有 JP listing)查明**那些是「盒」,争议行是 blister —— 挂卡 blister 是西方零售独有形态**,UPC 810059 = Bandai Namco America。
- **分四类,一个字未写**:A 有货 9 个 + B 零库存活行 9 个 = **18 个建议加前缀**;C **7 个是已有带前缀 SKU 的重复行(全零库存)→ 该合并不该改名**(给它们加前缀等于把刚清掉的重复又擦亮);D **`EB-03 Heroines Booster Pack` 和 `OP-15 Booster Box` 三源都判不出,坚决留空**([EN] 和 [JP] 版本目录里都已存在)。
- **🔴 改名会打断按名字建的映射**:7 月那次废掉 90/286 条钉价就是这个原因。已查:这批断 8 个 key(`sku_urls.json` 2 + `ebay_bin_queries.json` 6),同步脚本已备(**新 key 加进去,旧 key 保留**);之前改的 7 个 OP17 名字不在任何配置里,没打断。
- **🔴 病根不是谁填错了,是两个表单各自写死一个值**:`AddProduct.jsx` 默认 `language:'EN'` 不问人(那六个 Starter Deck 是 8/03 一次 bulk 提交、1.2 秒内写进去的),`JapanAddProduct` 写死 `'JP'`。**所以 language 列记的是「用了哪个表单」,不是任何人的判断**——这就是必须写进名字的理由,名字是唯一出现在点货表/买入表/Lark 消息上的东西。
- **✅ 已英文 TG 问 Frank 五条**(命名格式 / 买入时带语言 / 那两个查不出的是哪版 / 六个 ST-31~36 是否英文版 / 7 个重复行能否合并)。**新 `lv-finance/frank_sku_followup.py` 挂 `LV_Frank_SKU_Followup` 每小时追问一次**(Gary:「没回答就持续每个小时问他」「用英文问他」):判「已回答」= Frank 在提问后发过任何消息(**不做关键词匹配**,否则会追问一个已经回过话的人)、回答自动转发 Gary 并**自行停止**、22:00–08:00 PT 照发但静音、**发送失败不推进计时**(否则那一小时静默丢失)、**inbox 读不到就 hold 不盲发**、每 6 小时未答向 Gary 升级一次。测试 16 项全过(全部 stub,零真实发送)。
- ⚠️ **写这条手册时又被 bash 反引号咬了一次**:heredoc 里的 `` ` `` 触发命令替换,把六处 SKU 名和金额整段吃掉(`$8,900` 变 `,900`)。**改 .md/.py 一律用 Write/Edit 工具**,这条家规不只管 Python。

## 🔴 9/1 到货警示大扫除:$20K 已送达从没入账 + 警报噪音已 dismiss(Gary:「很多已经到了不对吗」「之前的消除警报 dismiss」)
- **逐票问承运商,6 票 / $20,021 已 Delivered 但 receipts=0**(最老 28 天):Illustration Box V7+V8 ×114 $4,332 · CN Terastal30+Gem5 $1,691 · DR ETB ×40 $2,840 · DR 盒×10+Palworld $3,326 · **OP17 EN 盒 ×98 $7,056** · 151 散包 ×32 $776。**FedEx 876492985458(日本 61 件 $8,275)9/1 10:17 已配達完了**(3 个包裹全签收)而警示还在说 on the way。
- **真伤不在「晚了」,在成本没进账**:① Illustration Box V7/V8 **全系统零痕迹**(库存0/movements0/销售0/从没被盘点)② DR ETB ×40 库存全零但门店已卖 13 个 ③ DR 盒 ×10 **basis $0.00**(8/20 手工加库存,成本一分没记)④ **🔴 OP17 EN 盒 basis $353.84 而实付 $72**(8/26 一次从 Master 转出 186 盒进 PK)——**COGS 虚记近 5 倍,污染了 8/31-9/1 那套 OP17 消耗账,待 Gary 点头改**。
- **病根(8/21 就记过、没修)**:`inbound_notify` / `inbound_tracking` **只更新自己的 state 文件,从不写 `acquisitions.tracking_delivered_at`** → 这 6 票 `tracking_last_checked_at` 全是 NULL,追踪器从没真查过;`inbound_tracking` 的 state 里 8/19、8/21 那两票 `shipped` 日期写的是 **9/1**(今天才第一次看见),`1ZJ20R270315012804` 干脆是 null。外加 cron 日志一串 `composer content mismatch` / `search-focus check failed`,通知失败顺延。
- **✅ 已 dismiss 8 行**(`dismiss_stale_arrivals_backup_0901.json`,乐观锁+回读,**只关收货计数器,不碰库存/receipts/成本**):3 行 Storm 是 **8/12 你拍板的 RECONCILED_NO_STOCK_DELTA**(货早在楼里,补进去=148 个幽灵)、Gem Vol.5×3 / 评价卡×1 / others×3 有库存实证、Mega Symphonia×1 与 Storm In Bag 第 6 袋是同票其余行全收满的漏勾。**故意留着两行**:`[CN] 5.0 精灵球 ×80`(7/27 送到 Gary 家,**36 天零痕迹**,CN 账 ¥47,200——货在哪?)· `黑盒 ×1`。
- **🔴 为什么一个已经拍板的决定会天天回来**:两个消费方都不认 `RECONCILED_NO_STOCK_DELTA` —— app `IntakeToMaster.jsx` 的 outstanding 只看 `quantity_received < quantity_purchased`;`daily_inventory_watch` 用 `status neq 'Received'`,而结案状态正是 **`Received - Discrepancy`(不等于 Received)**。已修日巡(加 status/notes 三重过滤,含 `DISMISSED` 标记),实测 **10 行噪音 → 2 行真问题**。**app 侧同一处待改待发。教训:结案要写成消费方读得懂的东西,否则「已决定」会被反复要求再决定一次,把真信号埋 36 天。**

## ✅ 9/1 OP17 家族补 [EN]/[JP] 名字前缀(Gary:「THE WORLD'S STRONGEST WARRIORS ×13 是英文还是日文 我们需要在sku上显示」)
- **那 13 盒是日文**(`71cc6ce5`,Chiyoda 发出,$1,393.60÷13 = **$107.20/盒**,比 case 折算的 $138.19 和 Frank 的 $325-333 都便宜——JP 价在跌)。
- **查出来一个真雷:`c9e98cd7` [EN] 和 `77d8f781` [JP] 名字逐字节相同** —— `One Piece Card Game The World's Strongest Warriors (OP17) Booster Box`,一个 7 盒 @$353.84、一个 17 盒 @$333,**盘点表上就是同样的字出现两遍**。7 月给 164 个海贼王产品加前缀那一轮之后建的 SKU 没跟上。
- **已改 7 个**(`op17_name_prefix_backup_0901.json`,旧名全部吸进 `aliases` 所以 buy-list/tg_move/查重守卫照样搜得到):两个盒 SKU 分成 `[EN]`/`[JP]`,`[JP] (Case)` / `(Cut Slice)` / `Single Pack` / `[EN] 4th Anniversary Tournament Pack`。⚠️ **`77d8f781` 和 `71cc6ce5` 两行都是 JP 盒 = 同物异名,两边都有货(17/13),合并要 Gary 点头**;全库还有 **26 个海贼王 SKU 没前缀**,同一招待做。

## ✅ 9/1 Marvel Allegiance 双单位行根治:散包 SKU 已建+拆分写库(Gary:「tiktok api如果有的话 我们就补一个」)
- **API 实锤后才动手**:TikTok listing `1732404405434159181` 自己就挂着两个 SKU——**Pack `1732461065041449037` $12.99 / box `1732461065041514573` $206.99**;7/1 以来卖 **17 盒 + 22 包、零取消**(拉全量订单逐行验)。这就是「一行账管两种实物」的收银机铁证。
- **拆分依据**:8/24 Trey 式「只数盒」写 1(8/21 卖的 2 盒 DELIVERED 已发走,对的);**8/25→9/1 五场连续、三个盘点员全数 25 = 1 盒 + 24 散包**。已建 `773a95c5 2023 Upper Deck Marvel Allegiance The Infinity Trilogy Booster Pack`(brand Other/EN/type Pack/category Booster Pack)+ PK 库存行 **24 @ $3.72**(= 盒 basis $119÷32);盒行 qty 1 未动。备份 `marvel_pack_split_backup_0901.json`,回读全过。**故意不走 box_breaks** —— 历史拆盒早已通过盘点负差离账,现在再记一笔会双扣。点货表从今晚起两行各数各的,+24 幽灵永久消失。
- **known_dual_unit.json 已清空**(Marvel 摘掉)——recon 对这两行恢复正常报警。TikTok 侧 sku_id 映射(pack/box 两个 id 见上)留给 apply_orders 上线时用。⚠️ Masterpieces XL(eac57e70,breakable ppb=20)同构造,货架若也有散包就照方抓药。

## ✅ 9/1 房间级「收银机对账警示」上线(预览模式)+ OP17 箱规定案 12(Gary 三连指示)
- **新 `inventory-sync/count_room_recon_notify.py` 挂 `LV_Count_Room_Recon`(15 分钟一巡)**:PK/RocketsHQ 一有带差异的盘点,生成「REGISTER CHECK」发房间群——**只报异常**(Gary:「这个太多了信息」):写掉的行先和订单 API 按 set 码+形态自动配对,**配上的压成一句「N 行全对,no action」**;case/box 家族盒当量守恒的压成一句「形态数错,货没少,下次按箱数」;只有真无解释的短缺(附「窗口内补了 +N,可能是时差」)和 ≥3 的多出逐行点名要回复。**现在是 --preview 只发 Gary TG,Gary 说切群才去掉**。状态机 done/todo/pending/dead 四级、原子写、先持久化再发、只认 code==0、分片续传、死信 TG 重试到成功。Codex 三轮 24 条全收(仅 UTC−7 显示按全仓既例保留)。
- **匹配器的课**:pack/sleeved/blister 在本目录是一族(sleeved SKU 的 category 就叫 Blister Pack),形态闸门要按族放行;set 码正则的  **在 heredoc 里又变了退格符**(第 N 次!两处正则静默失效,靠真数据 ST01 配不上才暴露)——铁律重申:**这条管道改 .py 只用 Write/Edit,heredoc 里的反斜杠一律 chr(92)**。
- **OP17 箱规 = 12 盒/箱定案**(Gary:「他们可能按照箱子直接算12盒」+ Frank 说 12 + 72=6×12 整除),ppb 10→12 已写库,箱转盒成本 = $1,658.25÷12 = $138.19/盒。**按 12 做全家族盒当量守恒:PK 自 8/21 进 325 − 转出 65 − 今晚实点 92 = 真消耗 168 盒当量/11 天**;此前按盘点负差报的「22 箱/周」大半是拆箱假消耗,已撤回。周末 OP17 弹药实物 ≈14 箱当量,大概率够,Frank 补 3-5 箱保险即可。
- 顺带修:count_sales_recon 的 TG 日报因「<=」被当 HTML 标签拒收(8/29 那天整份日报无声丢失)——已全文转义;8/31 周报 PK「741 写掉在地板带内」Gary 批示放行。

## 📌 8/31 决定:Kevin 在 ebay2 拍的量贩 slab lot 不入系统(Gary:「这些便宜的就不进了」)
- slabbiepatty 账号(登录名 anthony,k1bkogcy 环境)8/24-8/31 拍入 **161 单 / 1,501 张**量贩评级卡(CGC 10 为主,Lot of 4/8/12/20,~$8/张,主供 e2 mystery slab 场):8/24 = 100 单 1,012 张(Gary 记 101/1,015,差 1 单 3 张,可能在 hidden/cancelled tab)· 8/28 = 50 单 409 张 · 8/31 = 11 单 80 张。**Gary 定:不入 slabs 表**——管理成本高于货值,mystery 场本来就无 SKU 卖。**以后盘点/审计在 e2 撞见成堆无账 slab 先想到这批,不是失窃。**原始抓取 `scratchpad/kevin_wins_raw.json`。
- 查法备忘:ebay2 购买记录在 k1bkogcy 的 `ebay.com/mye/myebay/purchase`,每单标题带 Lot of (N);购买页 pg 参数不翻页,一页全量;金额列 DOM 混杂别直接抓。⚠️ 当时有 2 单 Awaiting Payment($32+$77)已提醒。

## ✅ 8/31 Buy List Intake 页已发版(Gary:「给他们app function来一个…注意mapping sku 确保是正确的sku」;`61eee62`,Vercel READY)
- **`/buy-list`:门店买 lot 后把卖家 item list 一贴,逐行确认 SKU,一步入账+入库。** 解析(数量+自由文本+括号注记)→ 缩写展开(pb/dr/pkc/etb/AH/CR…;set 码 st22/op17 不受展开污染)→ 候选排序(**形态词一票否决**:etb≠box≠pack≠sleeved;按「剩余词最少」排;retired 排除;对不上返回空绝不硬配)→ **只有唯一完美双向匹配才预选,其余必须人点**(同名异语言双 exact 也不预选,下拉带 [EN]/[JP]/[CN])→ 提交:acquisitions(status Received,成本=实付总价按市价权重分摊,单行填价优先、余额分给未填行、尾差补末行使合计分毫等于实付)+ updateInventory 落选定房 + Lark purchased 通知(报入账额不报收银额)。**回滚**:acquisition 先记后写库存、invApplied 分段、恢复 basis 快照、删除后回读验证,回滚不完整红字喊停。
- **权限已开 9 人**(Admin/Sully/Frank/Mario/John John/Gary/Aldo/Eric/Jason),路由/侧栏/UserManagement 三处同步(**漏 UserManagement 就永远没法给人开权限**)。STOREFRONT CHATS 已发英文教程,并让店里把上周那单 buylist 补贴进来。
- **Codex 三轮共 15 条 P1 全修**,最要紧的几课:① 单行填价会把其余行静默记 \$0(部分填价=余额按市价权重分给未填行)② 分摊逐行四舍五入合计≠实付(尾差补末行)③ acquisition 成功而库存写失败时不进回滚清单(push 要在写库存**之前**)④ `DUPLICATE_CANCELLED` 不许静默采纳 candidates[0]——给候选但 product_id 留空 ⑤ **`fetchInventoryRow` 不返回 id**,拿它做快照恢复 basis 永远不触发(直查带 id)⑥ 金额输入 10.005 会绕过一切(先取整到分再校验)。**parser 测试 76 项**(形态矩阵+near-miss 返回空+变异),`scratchpad/buylist_parse_test.mjs`。updateInventory 无乐观锁 = 全仓已知缺陷,与 IntakeToMaster 同级,等 RPC,不算本页回归。

## ✅ 8/31 追加:30th Celebration 的 eBay 草稿 30/30 就位(Gary:「都上ebay了吗」「走 然后中文货以及日本货呢」)
- **30 个草稿(美 19 · 日 4 · 中 7)全在 LuckyVaultUS Seller Hub 草稿箱**,逐标题核对 30/30;qty 0、LV 描述模板、官图、$=Shopify 同价。**全部停在 Preview 没点 List it(铁律)**——Gary 说「发」即批量上线,发布时带 CN 批次那套 List-it 重试(自动补 Set/Game specifics)。draftId 台账 `scratchpad/ebay30/ebay30_log.json`。
- **复用现成管线零重造**:`lv-listings/tools/ebay_list_autodriver.py`(停在 Preview 的 sealed 自动驾驶)+ 克隆 `chinese_batch_list.py` 的跑批器(逐 SKU env、断点日志、每个跑完关 tab)。**CN 批次先例证实 LuckyVaultUS 开了缺货保留:qty 0 能直接发布 live**——「eBay 不能库存0」只对没开这个选项的号成立。
- 坑:标题带「Coin Set」会把 prelist 类目建议器带去钱币区(CCG 类目按钮不出现→卡在 identify 页)——**改成「Booster Packs x3 + Pikachu Coins」这种 pack 前置的标题就过**。类目按钮 no-btn = 标题的品类信号错了,不是页面坏了。

## ✅ 8/31 「30th Celebration」预备 listing 全线上架(Gary:「最新set 30th 周年…现放图片和价格 库存写0…先都做了」)
- **30 个 Shopify listing 已 live(美 19 · 日 4 · 中 7),全部 active + qty 0(inventory_policy deny = 显示 Sold Out 不可买)+ 官图 + 目录 SKU 同步建好**。tag `LV-30TH-PRELIST-2026-08-30` 一键可管;台账 `inventory-sync/data/anniv30_prelist_ledger_0830.json`(catalog_id ↔ shopify_id ↔ sku);SKU 格式 `LV-30C-<TYPE>-<uuid8>`。回读 30/30(状态/价/库存/图)+ 公开页实测渲染 Sold out。
- **产品线事实(31 个 agent 双源互证,9/16 全球同步发售,系列码 30C/M6a)**:**美版没有零售 booster box**(PHD 分销商货单+PokeBeach 全清单证实,包只走 Bundle/ETB/铁盒/collection);日版盒 MSRP ¥7,200 已炒到 ~¥45,000(feed $281);**中文盒预售仅 $84.99——三语同品价差 3 倍是本套最大的套利面**。UPC 分 Day($536)/Night($586)。验证轮纠了研究轮三个错价(UPC Day 405→536、Lucario 贴纸 106→39、Ditto 118→180)和一个 404 官图。
- **定价口径:锚点(市价>观察到的 ask>MSRP)×1.05 取半元**,qty 0 期间价格只嫌低不嫌高。**发售前要人工过一遍的**:两张 Battle Deck($21,MSRP 锚,ask 已 5×)、日版 Futuristic Box($180.50,抽选品转售预计远高)、Sylveon/Greninja ex Box($115.50,ask 锚可能是双盒套装价)。
- **唯一没建的:[CN] 幻彩未来纪念礼盒**——官方 image.pokemon.com.cn 对我们一律回 HTML 拦截页(带 Referer 也不行),TCGHobby/PokeUnlimited/KrystalKollectz 都没上架这个抽选品,**查无稳定图源不硬造**;到货拍照后跑 `scratchpad/create_futuristic_cn.py`(幂等,查重后建)即成。
- **坑四连,记死**:① `products.category` 是 NOT NULL(值域:Booster Box/ETB/Booster Bundle/Ultra-Premium Collection/Tin/Deck/Collection Box…)——插产品别漏 ② **Shopify 图片 src 拉取对签名 URL/巨图会 422**(像素上限 20MP);正解=本地下载→PIL 压 1600px JPEG→base64 `attachment` 直传(234KB 秒过)③ CN CDN(image.pokemon.com.cn)对非浏览器访问回 HTML 假装成功——**判「下载成功」必须验 magic bytes** ④ `lv-finance` 真路径是 `Desktop/LV Agents/lv-finance`(不是 luckyvault 下),`shopify_api` 在那里。

## 🔴 8/26 e1 空表擦除事故:702 件假销量已撤销、Brandon 真盘已恢复(Gary:「这个应该是brandon」)
- **06:08 UTC 一场以 Carlos 名义提交的盘点 32 行只填了 4 行,空行=0 一次擦掉 702 件**并广播「Sold 702」;**Brandon 14 分钟后(06:22)的盲盘把被擦前的账逐行数了回来**(White Flare 262 包和被擦前分毫不差——盲盘看不到 expected,抄不了,只能是实数),但他的 754 件全按正差被丢弃。**单向棘轮的完整病例:废盘写库、真盘作废。**
- **修法照 7/06 先例**:废盘 `c4bd7eec` 软删(`delete_mode='retract'`,理由写明);e1 20 行恢复成 Brandon 实数(备份 `e1_brandon_restore_backup_0826.json`,乐观锁+回读 20/20)。`count_sales_recon` 两处都滤 `deleted=eq.false`,日报不会吃进假 702。**盘点员记分卡如果哪天把 Carlos 记成事故大户,先看这场是不是就是那个已 retract 的废盘。**
- **✅ CN 盒子定案(Gary:「terastal 就是我们给他的加的…应该是在他们点之前加 这么一个逻辑」)**:5 盒 TG 是到货当天随 Gem4 一起递出去的实物——**废盘那 4 个有数的行反而读对了(Gem6 11 + TG 5),Brandon 把 5 盒 TG 归进了 Gem6(11+5=16)**。已修:Gem6 e1 16→11 + Move TG Master→e1 ×5(Master 剩 5,备份 `tg_e1_move_backup_0826.json`)。⚠️ Gary 那句「给ebay2」按实物观测落在 e1(盘点是在 LuckyVaultUS 看到的);若 e2 也拿了 TG,Master 剩的 5 盒等 e2 盘点自证或 Gary 补数。**制度(Gary 定的逻辑):直播中途递货,账要在他们点之前加** —— 递货的当下发一条 TG 给 bot(tg_move 四步已在)或直接告诉我当场落 Move;room_transfer_notify 10 分钟内会通知房间群。8/25 的教训:交接消息只列了 Gem4 没列 TG → TG 全记 Master → 当晚盘点把它数成 Gem6。
- **✅ 盘点消息「多出」段已精简(Gary:「转库的再精简一点」)**,在分支 `feat/surplus-trim` 等「发」:头行「+N beyond book」、可修段「✅ Log the missing Move: … ← Master 129 · PokeAuctionHouse 24 (+1 more)」(来源按量排、最多 2 个、房名去前缀)、查无段「❓ No source — recount; do NOT adjust」、去掉块间空行。**Codex 一轮 1 P1:第三个测试文件 `count_label_test.mjs` 还钉着旧文案——「改消息措辞先把所有钉文案的测试找全」**;修后 18+21+34 全绿,build 过。屏幕端 StreamCounts 表格文案没动(另一个面,故意不夹带)。

## ✅ 8/26 中国票部分到货已入账 + ebay3 = 现有 PokeCasino 房(Gary 定,不新建)
- **UPS `1Z03KC740405052385`(220 盒)部分到货 8/25**:10 Terestal Gathering + 60 Gem Vol.4。团队没走 Intake,Gary 直播中途直接分掉——已按 Intake-to-Master 语义补账(receipts ×2 + acquisitions recv 60/100、10/50 + inventory + movements ×3,备份 `cn_partial_intake_backup_0826.json`,回读全过)。**Gem4 三个房各 20(e2 / e1 / PokeCasino),Master 0;TG 10 留 Master**。成本 = 本批单价:Gem4 **$17.44/盒**(eBay ask ~$31,80%↓ 很健康)、TG **$51.94/盒**(ask $64.98 的 80%)。在途还剩 150 盒(40 Gem4 · 40 TG · 20 Gem2 · 50 Gem5),到了继续走 Intake。
- **🔴 ebay3 = PokeCasino,用现有 `Stream Room - PokeCasino` 房(原 Whatnot 8 月改名),不建新房**(Gary 选的)。⚠️ 账上还挂着 154 件 Whatnot 时代的货——**PokeCasino 首次盲盘会把旧账洗出来,该早点点一场**。待办:PokeCasino 现在是真直播房了,`room_transfer_notify` 的 STREAM_ROOMS(4 房)和 `count_sales_recon`(只认 4 直播房)都还不含它,要接的话得给它配群 webhook + 加名单。
- e2/e1 那两笔转库 movements 会被 10 分钟一跑的 room_transfer_notify 自动发进 SLABBIEPATTY(e1 没 webhook 照旧 TG 提醒)。

## ✅ 8/25 Sully 的 8/24 门店盘点已对账并写库(Gary:「我们直接帮忙写 就行」;15 行,备份 `front_sully_count_backup_0825.json`)
- **Sully 交的是文字清单没走 app**(Front Store 的 stream_counts 仍是 0 场)。对账前先用收银机把盘点时间窗钉死:10:18 PT 卖掉的 6 个 starter deck 已反映在他的数里、13:22 的 Black Bolt 散包 ×2 和 13:52 的 PO Bundle 他都没数到(=卖后才数)、而 **15:46 PT 一个大买家一次买走一排 ETB(Temporal/Vivid/Prismatic PC/PO PC/Chaos ETB/DA/ME/Meganium ex + 5 Poster)全在他清单上** → **盘点发生在 13:52–15:06 PT 之间**。把盘后销售加回去后 **~30 行分毫不差**(最干净:Darkness Ablaze 数 2 = 现账 1 + 盘后卖 1)。**对文字清单必须按「盘点时点账」对,不能拿现在的账直接比** —— 差一个下午的销售就全是假差异。
- **已写 15 行(按 Aldo 8/5 先例:Gary 下令的手点修正,短缺+多出都写;乐观锁+回读 15/15)**:短缺 −24(Ascended 散包 40→30 · **Gem Vol 6 盒 10→6** · PO 散包 12→8 · Riftbound CN 盒 6→4 · Gem5/JT Bundle/Phantasmal sleeved/Prismatic 铁盒 各 −1);多出 +34(**Chaos Rising Sleeved 0→12(e2 账上有 47)** · **151 散包 0→10(活行 8622041d,e1 有 39;Front 无 retired 行没踩三胞胎坑)** · DR sleeved 13→20(e1 有 87)· Prismatic 散包 5→7 · Surging Sparks 散包 0→1 **全系统查无来路** 等)。**多出三大项形状=从直播房/Master 补货没记 Move,e1/e2 总数暂时重复,等那两房下次盘点自证。**
- **没数到的 ~32 件一律没动(没数≠零)**:First Partner Illustration S2/S3 ×8 · Rayleigh/Shakuyaku ×3 · [EN] ST-01/ST-20 ×3 · MTG FF ×2 · 一串单件老盒(Paradox Rift/SV/Fusion Strike/Palworld/Storm/Evolving skies)· 151 ETB · DR 普通 ETB · Chaos Rising ETB ×2 —— **像展示柜/柜台后的货,要问 Sully**。⚠️ 文字清单「没写」和「没有」分不清,正是 app 盲盘空行=0 要治的;下次让店里走链接。
- **三件全目录无 SKU 未建待确认**:Evolving Powers Premium Collection ×1 · SV **Triple Beat** 盒 ×1 · SV **Ruler of Black Flame** 盒 ×1(后两个是日版 sv1a/sv3;账上那行孤零零的「Scarlet & Violet Booster Box」很可能就是其中一盒的粗录名,建 SKU 前要一张实物照片,建错方向会双计)。
- **⚠️ 两个已知模糊度,下次盘点自证**:① 14:58 PT 卖的 5 Chaos 散包 + 2 PO 散包落在盘点窗内,按「数在卖后」口径写的(若实际数在卖前,PO 是 −6、Chaos 是 −4)② **Prismatic Evolutions Tin 是一行管两种实物**(Umbreon 3 + Sylveon 2)—— 双身份行清单再 +1(Marvel Allegiance 之后第二例)。
- **Gem Vol 6 三处同时在漂**:Front −4 · 8/24 16:05 从 Master 名义卖 20 盒(收银行 location=Master)· Aldo 的 Master 手点 −90 待复点 —— 这个 SKU 该优先定案。

## ✅ 8/24 门店+Master 接入盲盘(Gary:「做一个点货和直播间一样」;`a251cea` 已发版,Sully 已在 STOREFRONT CHATS 收到链接)
- **点货页房间列表加了 Front Store 和 Master Inventory**——此前是硬编码 6 个直播间,这两个房构造上进不去(Master 零 app 盘点、Aldo 手写拍照的真正原因)。同一套盲盘规则原样适用。
- **🔴 核心不变量:ledger 房(门店/Master)的负差永远不叫 sold。** 门店 POS 实时扣库存、Master 无销售,负差=无解释短缺;当 sold 算会把门店损耗在 storefront_sales 之外重复计、把 Master 短缺算成凭空销量。新 `src/lib/countRooms.js` 的 `isLedgerRoomName()` 是唯一判定源,**8 个把盘点负差当销量的消费方全部排除 ledger 房**(daily-usage-report · fetchWeeklyUsage(3处) · Turnover · ExecutiveReport · Reports(totals/byRoom/byProduct,**正差仍全量进「需复核」**) · weekly-buy-report · weekly-usage-digest · StreamSessions)。**Codex 连审 4 轮共 ~12 条 P1**,前三轮全是「又找到一个没过滤的消费方」——这类改动的教训:**加一种新语义的行进旧表,先把所有读表人找全,漏一个就是假销量**。
- 措辞全链路分流:消息标题「Inventory Count」、群里写 **「Short vs book: N — NOT sales」**;streamer 字段对 ledger 房隐藏(counter 顶位填 NOT NULL 列);18h「合并场次」确认不弹;undo 消息同步分流;门店简报走 LARK_WEBHOOK_STOREFRONT 进 STOREFRONT CHATS,Master 落主群。auto-reconcile 只对 TikTok Packheads 触发,不受影响。
- 测试 34(ledger 专项,跑真 builder)+18+21 全过;发版前按 8/13 铁律 vite preview + playwright 实走截图(房间下拉 ✓ streamer 消失 ✓ 盲盘表 82 行 ✓ 控制台只剩既有 CORS/400 两个老错)。**server 端 count_sales_recon 只认 4 个直播房,ledger 盘点不会误入日报**;周报的 Master 锚定块待做。

## ✅ 8/24 制度:挪库进出直播房 = 该房群里自动通知(Gary:「以后记成给他们在群里发他们 transfer inventory」)
- 新 `inventory-sync/room_transfer_notify.py` 挂 `LV_Room_Transfer_Notify`(**每 10 分钟**):movements 里任何进/出直播房的转库,以该群现有 inventory bot 的 webhook 身份发进房间自己的群;`(Case)` SKU 自动附「SEALED CASES——按箱数,别数箱里的盒」——治的就是「货进了房、数货的人不知道」(Yaz 75 盒被擦 8/21 · Eric 转库晚记 41 分钟 · **8/24 中午 12 箱 WSW 进 PK 当晚被 Trey 连箱内盒数成 206**)。**Codex 连审 4 轮、11 条 P1 全修才 SHIP**:ingest 先落盘再发(崩溃最坏=重发一条,绝不丢)· 逐 (movement,group) 重试 3 次后放弃并 TG 点名 · 游标全精度 + 边界时间戳 id 全集(等值查询也分页)· 状态原子写 + 深度结构校验 + 损坏重播种(告警和状态变更同一笔落盘)· TG backlog 先持久化再发 + HTML 转义 · **Lark webhook 拒收是 HTTP 200 + body 错误码,只认 code==0**。
- **房→群映射(Gary 定)**:PK=PACKHEADS · e2=SLABBIEPATTY · RocketsHQ=ROCKETS TIKTOK · e1=EBAY TEAM。前三个群的 bot webhook 已从群设置收割存 `data/lark_room_webhooks.json`(路径:群 → ⋯ → Settings → Bots → bot → Copy 按钮 → 读剪贴板;**「⋯」按钮 aria 检索不到,要按坐标点,页面 DPR 1.25 坐标要换算**)。**⚠️ e1/EBAY TEAM 没拿到:Gary 不是那个群的群主**,bot 详情只显示「Added by Peilin Yu」不露 URL、也没有加 bot 入口——**待 Peilin 把「LuckyVault Inventory Bot」的 webhook URL 发来**,填进 json 即通;缺口期間 e1 的转库会每天 TG 提醒 Gary 一次「该房没被通知」。
- **顺带发现「US Buy Record」群**——8/19 读不到的 Frank 买取记录群就是它(侧边栏在),走 Gary 浏览器可读。
- **⏳ 同日决定待做(Gary:「报告不需要这么多错误 用 api 理解一下对上就行」)**:日报差异先过四道解释器(①API 销售对上→不报 ②窗口内转库→标时差 ③CASE BREAK 签名(箱负差+同家族盒正差同场)→一条拆箱账 ④已知双单位行(Marvel 两行)→标「一行两种货」),剩下的才点名。

## 🔴 8/24 账号主权查清:Vercel 已是 Gary 的,Supabase 生产库还在 William 手里
- **Vercel 转户坐实**:Gary 8/18 接受的那个邀请就是交接,现在是 `williamyu969716508-7854's projects`(Pro)团队 **Owner**。登录账号 **zhc091@gmail.com**;⚠️ 登录后默认落在他自己的**空 Hobby 空间**(zhc091-9477),看着零项目别慌,**切到 william 团队**才看得到生产项目。团队里只有一个项目 `lucky-vault-inventory-management-system`(prj_tufSRLZXtj02CTdaAnhj0fbrjfLL),唯一域名 **`lucky-vault-inventory-management-sy.vercel.app`,没有自定义域名**(8/21「真域名不知道」之谜的答案)。**Access Token 已建并验证**(无期限),存 `inventory-sync/data/vercel_token.json` —— 验部署/读日志/查 env 以后全走 API 不进浏览器。**坑:tokens 页 UI 的 SCOPE 下拉对合成事件免疫**(点了不提交,连试 4 版),正解是用登录会话在页面里 `fetch POST /api/v3/user/tokens` 一发即成(响应带一次性 bearerToken)。
- **🔴 推翻 8/11 的假设:全世界不存在 service_role key。** Vercel env 全量 11 个(Lark webhooks ×6 · GOOGLE_SERVICE_ACCOUNT_JSON · TIKTOK_COOKIE · AFTERSHIP_API_KEY · VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),**没有 service key、没有数据库连接串** —— api/ 路由全靠 anon + Google SA 在跑。**DDL 唯一路径 = Supabase dashboard,没有备选。**
- **🔴 Supabase:生产库 `dqreqevbjszercgackuc` 挂在 William 的账号下,Gary 够不着。** Gary 的 Supabase(GitHub `lucky4707` / zhc091@gmail.com)只有一个空项目(gmtgoebxathyotgvsskc,0 GB)。**待办:让 William 花 2 分钟** —— supabase.com 登录 → 那个 org → Organization Settings → Team → Invite,邀 **zhc091@gmail.com** 当 **Owner**;Gary 点邮件接受即完成,**URL/keys 全不变、零停机**。audit log 和 9 张积压表全卡在这一步;William 不理会才走整库迁移(最后手段)。**这次 handover 比 Vercel 那次要紧:Supabase 是数据本身,org 主人能读能删全库。**
- 化石项目 `luckyvault-inventory.vercel.app`(7 月老 build,连着生产库)**不在 Gary 团队里** → 在 William 个人 Vercel 账号下。让 William 顺手删,或以后轮换 anon key 让它失效(动静大,不急)。

## ✅ 8/24 周对账老板视图上线(Gary:「库存一周的变化能不能对应上直播的消耗 我作为老板比较需要知道」)
- **`count_sales_recon.py --weekly 7`**:按房汇总一周——写掉多少件/多少钱(账面 basis)· 直播证据多少(TT 地板+GMV / eBay 锤数+$)· 一句周判定 · 丢弃的正差合计 · **「最后一次盘点是 N 天前——之后全是未验证的」**。复用逐场机器(`build(collect=)`),周报和日报永远不会打架。已挂 `LV_Weekly_Count_Recon`(周一 08:00,run_weekly_recon.bat,wscript 模式)发 Gary Telegram;首份 8/24 手动补发。
- **首份周报实况(8/17-24)**:PK 11 场点/写掉 2,873 件 $86K 账面 vs TT 地板 1,883 件 $82K GMV(差 990 件但 662 行归不到 SKU,不断言损失);e1 5 场/1,019 件 $26K vs 1,578 锤 $71.8K 全有证据;RocketsHQ 112 件 vs 地板 1,156 无异常;**e2 6.7 天没盘 = 最大盲区**(上次盘点还丢弃了 +499 正差)。
- **⚠️ 8/24 00:00 PT Brandon 又盘了 e1(写掉 322 件)**:White Flare **第三次正差(+28,前两次 +15/+9)——WF 账面偏低在累积证据,该复点定案**;还有 **WSW box +12 正差**——Vahe 昨天刚写掉 −11,实物盒其实在架上(case 拆出来的),幽灵在账面上来回震荡,**case→box 的 box_breaks 路径不建这个洞不会停**。
- ⚠️ Bash heredoc 会吞 `\n` 转义级(f-string 里变真换行 → SyntaxError)——**往 .py 里写代码只用 Write/Edit 工具**,那条老家规连脚本生成脚本也适用。

## ✅ 8/23 对货日报上线:`inventory-sync/count_sales_recon.py` 已挂日巡(Gary:「先从对货开始做…卖的和少的库存对得上对不上…你和codex一起看看」)
- **每场盘点一个判定**:`[OK ]`(消耗全有卖出证据)/ `[OK*]`(过但带保留,保留逐条印出)/ `[GAP]`(干净窗口下消耗多于证据,点名)/ `[N/C]`(比不了,每条说清为什么:坑位行/窗口内调入/无转录/baseline 可疑/源挂了——**源挂了永不当 0 卖**)。窗口=上一场盘点→本场(created_at);正差只展示永不断言。已挂 `run_inventory_watch.cmd` 末尾(先跑 pull_transcripts 再跑 recon,失败不拖垮日巡),暂只发 Gary Telegram;**发团队群的 `--lark "Inventory In&Out"` 等 Gary 定群名**。
- **证据分房**:TT 房=订单 API 总量对铁律2 地板带(sold≤units×1.15+5;正向判定叫「no unexplained burn」——单边下限,不冒充双向一致;取消单独成桶「可能照样拆了」既不进地板也不丢);eBay 房=拍锤+转录家族归属(**共享 `ebay_session_pnl.py` 的函数,分类正则直接用 daily_inventory_watch 的对象,测试钉了 identity 防漂移**)。
- **eBay session→房间是推断的,规则三层**:①家族重叠计分(≥2 个消耗家族各≥3 次提及,或单家族covering ≥50% 消耗——纯 Journey 场合法、slab 场聊两句 one piece 不行)②**同房并发互斥**(一房不能同时开两场;用拍锤全时段判重叠≥15min,跨盘点窗口也生效——8/22 深夜 slab 场就是这样被排掉的)③平手=contested 谁都不给。**真正的根治是转录机在采集端打 sid→room 标**,待做。
- **Codex 两轮设计+两轮代码审查,要点全收**:锤是 lot 不是件(去掉 60% MATCH 阈值,eBay 判定=家族证据覆盖)· 转录证据必须裁到窗口(它抓到我测试的 epoch 写在窗口外还断言 OK)· baseline 可疑量级 > 消耗 25% → 不给任何判定(Brandon 8/21 场窗口里有我 690u 的手动恢复,正确地 N/C)· 无家族 SKU 不许从分母消失 · null 数量≠0。**17 项测试跑真函数+变异证红**(band 关掉→测试红)。
- **首跑实况(8/21-22 四场)**:Vahe 8/22 15:24 PT e1 首次下播盘点 `[OK*]`——272 件消耗,精确匹配到 CNNPaaT9 一场(72 锤 $5,084,1 锤未归属),和人工取证结论一致;Yaz/Trey/Brandon 三场 `[N/C]` 各有真原因(坑位行/调入/手动恢复污染 baseline)。
- **✅ 8/23 追加 lot 定件(Gary:「ebay lot不是件数 所以我们跑script对齐」)**:`ebay_session_pnl.attribute_sized()` 给每锤定件数,只认两种诚实来源——**宣告句显式数量**(「three packs of journeys」;否定句 24 字符守卫「it's NOT $70 a pack」、「30 packs **in a box**」是描述盒不是 lot、「gem five pack」是产品名、买家名「5x」永不当数量——全是 Codex 翻真转录抓的反例)+ **单价锚推导**(「crown zenith is 26 a pack」→ $260÷26=10 包;**锤价÷单价必须落在整数 ±0.2 绝对容差内否则拒绝**——$205÷$42=4.88→5 是真实的「41 if you grab five」批量价所以容差是设计;相对容差试过会把 150/11=13.64 也收进来,回滚了)。**定不出的 lot 老实标 unsized 绝不默认 1**(默认 1 就是 In-Bag/Case 单位病重演)。日报每家族印「85u counted out vs ~47u in sized lots (+8 unsized)」+ 总覆盖率,覆盖 <60% 只降级为保留不判 GAP(**口头直卖没有锤**,短缺≠丢货,orders join 落地后收口)。Vahe 场首跑 36% 定件覆盖;**当场纠正 8/22 的 CZ 结论:口播价 $26/包 > $22 成本,「$12.3/包在亏钱」是归属噪音摊薄的,撤回**。价锚只从单一家族句取(「Ascended is 14 each. Evolving skies is 42 each.」一句两价分不清谁的→跳过),锚有效期 30 分钟,recon 窗口前多读 PRICE_TTL 的引导段。测试 23 项。
- **顺带修正 8/22 Vahe 场结算**:WSW 那 −11 是 **Box SKU $333 basis 的假 COGS**——纸面从 PK 转来的 12 盒是 TT 已按 $409.99 卖掉的 count-lag 幽灵,实物拆的是 case 货($203/盒),**PK 的 7 箱 case 账下次盘点会缺**(case→盒无 box_breaks 路径,unit 链作业);**CZ 散包成本 $22/包是真实进货**(8/03+8/17 两笔),锤价 $12.3/包=每包亏 $10,63 包亏 ~$630,要问 Frank;**Journey 提价生效**(主播喊 $11/包,曾 $7);ES 未提价(仍喊 $42,要求 $48-50)。`ebay_session_pnl.py` 重构成可导入函数库(load_hammers/load_announces/attribute/sids_in_window/fam_of),CLI 行为不变,家族表补了 WSW/OP17、Mega Brave、Symphonia、Inferno X。

## 🚨 新铁律:答成员问题前先读 `lv-finance/data/tg_chat_log.jsonl`(8/22 Frank OP-17 事件)
- **成员发给 bot 的自由提问一直有人答**:处理链末尾的 `_spawn_chat` → `tg_chat_runner.py`(headless Claude,带角色简报),**Q/A 全文存档在 `data/tg_chat_log.jsonl`**(已 121 条)。Gary 中继给我看的只是问题,**看不到 runner 已经答了什么**。
- **8/22 我栽了个跟头**:Gary 转来 Frank 三条 OP-17 定价问题问「你怎么回复的」,我以为没人回过,盲答了三条——①先按英文盒算(Frank 更早的消息里明说 japanese,我没看到)②让他「先卖掉剩下 13 盒 $331 的」——**runner 早就用 TT 订单数据证明那 12 盒已按 $409.99 卖掉了**(盘点没归零的 count lag)。runner 的回答质量很高(链路:识别 OP17=日本独占 → 案例成本 $2,438.80/箱 → $224.99 边际 → 地板 $217)。**两条教训:① 回成员问题前必读 QA 存档 ② runner 用账面汇率 149.3,真实边际要按实时汇率重算**(它算 +$8/盒,真实 +$27/盒)。
- **OP-17(= THE WORLD'S STRONGEST WARRIORS,日本独占)整理**:`77d8f781 "(OP17) Booster Box"` 语言 **EN→JP 已修**(第 5 例错标;EN 版全球未发售,Frank 的 $325-333 是 day-one 日版 aftermarket,卖 $409.99 清仓 ✓)。家族:`71cc6ce5` JP盒(0库存)· `96a96f0a` Case(PK 7 箱)· 散包/切片。**⚠️ 两行盒 SKU 是同物异名待合并;Case ppb=10 vs Frank 说一箱 12 盒——已让他实物确认,错 20% 的每盒成本**;38 箱已购(¥320-370K/箱),12 箱 8/21 PO 未到。⚠️ 我给 Frank 的批发锚:case 货 $224.99 = 实时汇率下 +$27/盒(+15%),地板 $217。

## ✅ 8/22 批发通道首单闭环:小马 13 盒 $926 现金(问价→锚点→成交→一句话入账)
- **流程原型**:Mario TG 问「Mega Brave/Symphonia 買取价」→ 回了三个锚点(**買取=地板 · TCG 市价=天花板 · 建议批发=成本+20%+**,附精确汇率 158.95 和我们的落地成本)→ 他当天按锚谈成 6 Brave + 7 Symphonia = $926 现金 → 「mark as sold」一句话入账。**以后批发就走这个节奏;任何人 TG 问价都答得出(kaitori_prices.json + market_price_cache + 实时汇率)。**
- **入账**(tx `5b0d4ac1`,备份 `mario_wholesale_backup_0822.json`):收银台同套语义——storefront_sales 两行(Itemized,location=**Master**(货在哪记哪),cashier=Mario,分摊按批发参考价加权 $452.49/$473.51)+ 现金 payments 行 + Master 扣库存(Brave 11→5 · Symphonia 11→4,乐观锁+回读)。
- **毛利实话**:按真实落地成本 $826 赚 ~$100 = **+12%**——高于日本店地板($861)、低于建议区间($984+),13 盒同日清掉可接受,已告知下次往区间顶。⚠️ 账面 COGS 用 149.3 汇率的 basis($880)会把毛利压成 5%——**又是写死汇率那 6.7%**,读毛利报表时要记得。

## ✅ 8/22 JP 买入 % 基准 = Runto 買取(Gary:「对比 runto 的%,相当于 tcg 买取比例一个概念」;**服务端已生效,app 分支 `feat/kaitori-buy-pct` Codex SHIP 等「发」**)
- **服务端(已生效,无需发版)**:`buy_market_check.publish()` 加 kaitori 覆盖层——JP 品的 feed 价 = **Runto 買取 ÷ 实时汇率**(带 `source:"kaitori_runto"` + `jpy` + `fx`;汇率 80-250 保险带 + 上次好值兜底,取不到就跳过覆盖绝不编)。名字匹配**只认唯一精确命中**(kaitori key 去掉尾部 "Japanese" 对 products.name),46 条買取先映射上 5 条主力(Storm 盒 → Runto ¥16,500 = $103.80);**其余 41 条要靠别名扩展**(待做)。EN/CN 有真 TCG 价的不覆盖。
- **app 端(分支)**:kaitori 来源渲染 **「X% of Runto buyback (¥16,500 ≈ $103.80)」**,100% = 「that is what the shop itself pays」,>105% = 「MORE than the buyback shop pays」——**买方价永不冒充卖方市价**;TCG 措辞逐字节不变(Codex 一轮抓的 unit_mismatch 文案回滚);[20,300] 单位带照管 kaitori 条目。测试 15 项跑真模块含变异。**旧版 app 在发版前会把 Runto 数按「market」字样渲染**——数字对、标签暂时不精确,发版即correct。
- **无 SKU 的买入闭环(Gary 问「supabase 没有 sku 就要建立 sku 并且 map sku」——流程已通,不用新做)**:买入表单遇新品 → `createProductChecked`(查重守卫)建 SKU → **夜里 publish 的 stocked scope 自动含新 acquisitions** → TCG 严格名匹配或 kaitori 名匹配自动出价 → 都匹配不上的进 unpriced 点名清单等钉。唯一人工步 = 给对不上名的钉价源。
- **✅ 新日报 `inventory-sync/jp_buy_vs_kaitori.py` 已挂日巡(Gary:「JP不用报 给我和高原报就行 我们的买取价 vs 买取店的价格」)**:每天只发 **Gary + 高原**(点对点,绝不进群、不发日本团队),逐行「我们 ¥ vs Runto ¥ = %」,>100% 打 🔴。首刊当场两条:**Storm ×119 = 103% 🔴** · Mega Dream ×32 = 99% ⚠(靠新加的别名表抓到——board 写 Mega Dreams 我们叫 Mega Dream)。变体(In Bag/Unsealed/Case/散包)板上没有報价,明写「无買取参照」**绝不借用整盒价**。坑:acquisitions 时间过滤的 ISO 时间戳带 `+00:00` 会在 URL 里变空格 → 400,要用 `Z` 后缀。
- **Frank 的 per-item 成本+市价+% 已经在每张 Lark 买入卡上**(8/21 发的 marketClause,每行:成本 · 市价 · %)——JP 品的 % 数据现在从 Runto feed 流入;措辞(「of Runto buyback」)等 app 分支发版后完整。
- **背景(8/22 凌晨 Storm 定价链)**:¥17,000 买价 vs Runto ¥16,500 / Moto ¥17,000 / SNKRDUNK 实成交 ~¥16,300 / eBay 地板 $96.73 —— **买在日本市场顶端,唯一能撑住的通道是门店 $170**。SNKRDUNK 主页价格是客户端渲染,要 headless 渲染读(页面 innerText 里有逐笔成交历史,很好用);Storm 钉价页 apparels/846048。

## ✅ 8/22 e1 场结算首跑:eBay 版三源对账落地,当场抓到 Hidden Fates 零毛利(Gary:「ebay1 的库存报告和 tiktok 逻辑一样 看 transcript 对应 告诉我们赚了多少钱 什么产品在亏钱」)
- **新 `lv-finance/ebay_session_pnl.py`**:场耗=下播盲盘负差 · 收入=拍锤日志(按 sid 定房)+ 转录宣告句归属(Journey 方法:单一产品句→窗内下一锤,菜单句剔除)· 成本=e1 basis;**未归属的锤绝不硬塞**。转录行时间戳字段是 **`epoch`**(不是 t0/ts,猜错=归属全灭)。今晚 Brandon 场(sid unVraCjFTq4Ckp4e,17:04–22:43 PT):**143 锤毛 $10,787,归属 73%;场耗 234 件 / sealed COGS $6,963;真毛利 ≈ +$429〜1,650(4–16%)** —— slab 按 **Gary 定的 30% 毛利假设**计成本(slab 全库无成本,这是显式口径不是数据),区间宽度=39 个未归属锤是 slab 还是已计成本的 bundle,订单 join 后收窄。
- **🔴 Hidden Fates 散包 = 零毛利实锤(已发 Mario,Gary:「let mario know」)**:41 包 / 23 锤 $1,846 = $45.02/包,扣费 $42.02 vs 成本 $42.00 —— **一分不剩**。成本本身没错(Frank 8/17 Discord/PayPal 75包$3,150=$42,= 钉价市价 $48.38 的 87%,他的正常带;已发 TG 让他口头确认);**错在卖法**:$50 单包/两连 $90 全部贴成本,唯一赚钱的是 19:02-07 三锤 $185/135/130(chase 话术段,135%+ 市价)。**和 Journey 同构:lot 结构决定价格。** 建议:$55 底价或改 chase/定价形态。
- **消耗数 41 双链验证(Gary:「数的数量对吗」)**:账链 24(Aldo 含前晚转入30的余量)+45(15:38 转入)−28(Brandon 实点)=41;转录链 23 锤×~1.8 包≈41;全周期 79 进 − 10(vahe 两晚)− 41 = 28 分毫不差。**注意 HIF 有两笔转入(8/20 晚 30 + 8/21 45),基线修正时「点前转入不重加」的规则正好被它验证了一次。**
- **⏳ 下一步**:① `ebay_buyer_orders` 刷新后跑锤×订单 join 补实收、收窄毛利区间 ② 口播别名表 ③ 挂成每晚盘点后自动跑(e1+e2),亏钱产品直接进 Telegram。
- **✅ 8/22 追查三条(Gary 逐条点的,全对)**:① **ES 不是 bundle,21 包逐锤闭合**:3×$205 五连包 + 4×$42 单包 + 1×$84 两连包 = $867 = $41.29/包,主播原话「42 per, 41 if you grab five」= 按 TCG 市价平卖 → **整晚 ES 只赚 $21**。已发 Mario+Frank 要求提价(ES $48-50+ / HIF $55+;CZ 和 151 当晚卖到市价 130%+ 证明房间撑得起)。② **Storm 盒市价过期**:fuzzy TCG 日文线挂着 $153,当天 eBay 实拉 **$96.73(52 条合格挂牌)**,8/7 还是 $139.59。③ **Storm 成本 avg 算错了(Gary:「成本avg没算对」)——已修**:在库 123 盒(日本仓 122 + 门店 1)几乎全是 8/12 起 ¥17,000 的新批 = **真实成本 $113.90(账面汇率 149.3;真汇率 ~157 则 ~$108)**;美国各房挂的 $150-162 是三重污染的幽灵(**281 盒 jp_to_us_shipment 双计行** 拉高均价 + 7/30 ¥29-32K 贵批灌进全期 + Transfer 链把过期 blend 传给每个房——8/10 记的双计病 Storm 是最大受害者)。六个房 basis→113.90(备份 `storm_basis_backup_0822.json`,只降不升,日本仓本来就对没动)。**昨晚 e1 那 5 盒的真 COGS ≈$570 不是 $765,「每盒亏 $50」撤回**;但 eBay 地板 $96.73 < 真成本 $108-114,**直播/eBay 卖 Storm 盒仍是亏的,门店 $170 是唯一赚钱通道**。⚠️ 8/20-22 还在按 ¥17,000 连买 111 盒而 eBay 地板已 $97——买入没问题的前提是走门店/TT,别喂直播间。


## 🔴🔴 8/21 深夜 Journey 定案被 Brandon 实数推翻——今早的「纸面幽灵」判断是错的,已按实数恢复
- **Brandon 下播盘点 e1:Journey `exp 11 → act 275(+264)`,账当场闭合:11 + 今天转入 309 − 275 = 44 包今晚场耗。** 这个算术只有「309 包转移是真实物」才成立 → **e2 的 190 和 Master 的 119 一直是真货**,今天随 Aldo 的转库实际到了 e1;今早按 Gary「其实库存里现在没有JT pack」移除的 309 包不是幽灵。已恢复 e1 Journey **11→275**、顺带 Ascended **170→230**(= Aldo 没人看懂的「ASc packs: 180」+ 转入 50,和 Brandon 实数分毫不差——他那句话是对的,当时没敢写)。备份 `e1_brandon_restore_backup_0821.json`,乐观锁+回读。
- **教训(第 3 次同型)**:口头「没货」是那一刻某个视角的快照,**盘点才是观测**;「8/18 搬运幽灵」理论全靠那句话支撑,一个盲盘就推翻了。连带修正:8/18 那次搬运的 130 包记录**本来就是准的**,e2/Master 的账没错过;今早「~94 包 vahe 口头直卖」的推断仍然成立(它只依赖 e1 自己的 159→11 链)。
- **⏳ Brandon 这张表还剩三个小问号(要问 Aldo/Brandon,均未写)**:① Gem Pack Vol 6 +3(账 10 实 13,Master 有 190——像今天补货没记的一笔,确认来源房再补 Move)② Prismatic ETB 同名双行**都数到 1**(实物到底 1 盒还是 2 盒?我今天刚把重复行清零,zero-grace 又让它回到表上)③ Ascended「12」那半句(疑 Two Packs ×12,目录有 SKU,没确认不写)。

## ✅ 8/21 POS「卡不在系统」手动卖出入口 —— **已发版**(`7907f21` 推 main,Vercel success;Codex 4 轮 SHIP;群通告已发)
- **✅ 之前的卡已按同一标记补账(Gary:「之前的卡 我们能补吗」→ 补了 5 行,`backfill_gaps_0821.json`)**:Luna 8/21 $20 现金(新建交易:货行+收款行)· 8/17 `64951833` +$40(Dendra 老案)· 8/17 `84a35fa2` +$48 · 8/17 `10cb5a45` +$19.71 · 8/19 `f9331fbf` +$151.54 —— 四笔挂回**原交易**(钱早已入账,只补缺的货行),身份全部 `name=-` 待认领,五条都在 `manual_card_pending` 队列里天天点名。**收款对账 19→15 笔差额,剩的全是 trade/buy 语义 + $14 小额**(+$1/+$3/+$10 疑似税或小费,不敢断言没写)。
- **✅ 8/22 凌晨「读图区」两案结清(Gary:「之前的卡 你读图区」)**:**Luna 的卡她当场就发了照片** —— 和「Sold 20 cash」同一条消息带图,昨晚纯文本抓取看不见 `[Image]`(**又是 Aldo 照片那课:innerText 抓聊天永远丢图,判「没给信息」前先看图**)。图 = **Decidueye GX SV47/SV94(Hidden Fates: Shiny Vault)**,正是 8/13 批 60 张贴签卡之一(价签 $22.06)、昨晚 80 张扫不到的其中一张。已按新约定结案:活行 `6bfb3d0b` 卖出($20 现金,挂 Luna 交易)+ 占位行作废(防双计),交易两侧 $20=$20。**Dendra $40 那笔身份本来就有** —— 8/17 红条截图点名 `Dendra #266/193`,照 `_recoverSoldSingle` 语义补了 sold 克隆行(`ccef7ce6`,cost null,date_acquired=收银日),交易 $80=$80。**补账队列 5→3**($48 · $19.71 · $151.54,无图无据,等店里答);队列已加 `deleted` 过滤。⚠️ singles 插入的 NOT NULL 雷再 +1:**`brand` 也是 NOT NULL**(此前已知 card_number/set_id/date_acquired)。
- **✅ 英文通告已发 STOREFRONT CHATS**(附问 Luna 卡名)。⚠️ lark_send 踩了三个新坑,记死:① **多块草稿要用 `Ctrl+End`(文档末尾)再 `Ctrl+Shift+Home` 全选**——旧的 plain `End` 只到行尾,后面每轮只删一个字符 ② **清空后 textContent 是占位符 `Message <chat>`,把它当内容会误判「清不掉」** ③ 失败中止会把打了一半的字留成新草稿、且服务端同步回来——**同一会话内清完立刻发,别分两次跑**。
### 原始需求与实现(8/21)
- **入口两个**:Sale/Trade 模式购物车工具条 `+ Card not in system`;扫码查无此码的横幅上直接给按钮(**12/13 位 UPC 形状的码不给**——那是没登记条码的 sealed,走卡片路径会跳过扣库存,只留 Product Barcodes 注册提示)。弹窗三个字段:卡名*(必填)· 卡号(选填)· 卖价*(>0);Enter = Add & next(连录一摞卡)。
- **落库**:`single_manual` 行 → `storefront_sales`,notes 带可 grep 标记 `MANUAL_CARD_PENDING_RECONCILE | name=… | number=… | sold_for=…`。**零库存写入**;补账时**绝不回改这行**(卖出铁律)——正确记账后在新建的 singles 行 sale_notes 打 `RECONCILED_FROM_COUNTER:<行id>`,队列自动销案(状态是推导的不是存的,和 open-surplus R1 同哲学)。
- **服务端队列 `inventory-sync/manual_card_pending.py` 已挂日巡**:列出每条待补账(按**行 id** 判销案,不按 transaction——同单多卡补了一张不能把兄弟藏掉,Codex 三轮抓的)。
- **两轮外部审查共 11 条真缺陷全修**(Codex 4 轮 7 条 + 21-agent workflow 对抗审查 6 条确认、4 条驳回为已修旧账):qty 钉死 1(一个身份=一张卡,第二张开新行各带各的标记)· Buy 模式购物车里有此行拒绝提交(会把钱记成流出)· `|`/`=` 在录入处和 desc 上双重转义(自由文本不能伪造标记字段)· **`sold_for` 记柜员打的原价**(total 模式分摊会改 sale_price;行内价格编辑会同步 sold_for)· 横幅按钮 submit 中禁用(提交竞态会静默丢行)· **文案不许说「recorded now」**(Complete Sale 才落库——和 room_transfers「Transfer noted」同病)· 当日汇总组件学会解析 `SALE (manual)` 行(不再按 sealed 渲染、不再把标记串原样吐给柜员)。
- 测试:writer 18 项(跑真函数,含变异测试和注入测试)+ preflight 2 项;截图验过 UPC 隐藏/卡形显示两个方向、弹窗、购物车行,控制台零新错。**`our_price` 特意保留手输价**——价签价就是我们的要价,total 模式权重靠它,行上就写着 ⚠ NOT in system。

## 🔴 8/21 深夜 Luna「Sold 20 cash, stickered but not in system」→ 挖出 9 个从没入库的标签批次,已全部补入(Gary:「store群聊里说有卡没有not in system 你看看」)
- **病根:8/12 定的「每批必跑 `singles_intake_batch.py`」是手工步骤,6 个批次只跑过 1 次** —— 和 GTS commit 三个月跑 2/20 同一个病(「没人做的第二步不是保险,是漏点」)。8/11–8/21 累计 **9 个批次 ≈ 542 张贴了价签的实体卡**没入 Supabase:80 个 tcg_id **扫码查无此卡**(Luna 中的就是这个,里面有 $1,094 的 Grey Felt Hat Pikachu、$1,001 的 Mew ex)、91 个只剩 sold 行(扫出 Already sold,走覆盖恢复卖出、成本全 null)、76 个有活行但数量没加。
- **✅ 9 批全部补入(记成本 $15,338 = 市价×80%),247+114 个 tcg_id 复核:0 absent**。两张已通过收银覆盖卖掉的实体卡(Meowth ex $128、Mr. Mime $23.73,sale_notes 带 `RECOVERED_AT_COUNTER`)**从 TSV 副本里预先摘行再入库,不造幽灵**;normal 卖出走的是活行池、账自洽,不用扣。**Mr. Mime 同时出现在 441f 和 5c2b 两批里,同一笔卖出只许扣一次。**
- **甄别时排掉的**:`dd863a3dffbe` / `7d721e740004` 是 8/11 写入器重建时的**自测批**(自家卡重贴,入了就是重复);FAILED 的 `e47ba141b12c` 和成功批 md5 相同(误重交,零产出);FAILED 的 `bca2c792e6ab` **有 29 张真卡**(状态失败≠没产出,标签当天手工补渲过)。
- **✅ 已全自动(Gary 8/21「一定要自动」)**:`singles_intake_watch.py --apply` **自己跑 intake 而不是喊人**,新任务 `LV_Singles_Intake_Auto` 每小时一跑(wscript+run_hidden.vbs 模式,实测 exit 0),05:40 日巡同一条做备份。三层安全:① 批次工具自己的台账拒绝二次执行(实测:重触发已入批次 → 拒绝零写入)② **已通过收银覆盖卖掉的贴签卡自动从 TSV 扣行**(`RECOVERED_AT_COUNTER` + sale_date≥批次日),每笔卖出行记入 `singles_intake_recovered_claimed.json` 认领台账,**同一张卡出现在两个批次也只扣一次**(Mr. Mime 就是这个形状,已预置 2 行)③ 检查挂了报「查不了」,不报平安。
- **🔴 recovery 卖出全景(8/20–21 共 8 笔 / $340.66,全部成本 null)**:除批次里的 Meowth ex/Mr. Mime 外,**Poliwrath $120 · Nidoking · Kangaskhan · Trubbish/Sigilyph/Woobat(White Flare IR)6 张不在任何标签批次里** —— 是**门店买入那条断轨**的卡(买入记了钱、卡没建行,扫出 Already sold 走覆盖)。库存无需修正(它们从没在库),**成本 null 是 8/7 Codex 定的设计**(clone 连市价都不带),要补 COGS 得逐卡查市价×80%,待 Gary 点头才动(卖出行永不回改是铁律,改前必须明示)。
- **⏳ Luna 那 $20 仍未入账**:三张表零记录,候选卡好几张(~$18–22 的贴签卡)。**群聊金额不能直接改库存** —— 要 Luna 说清卖的是哪张(价签上印着卡名+编号),定了再按正常流程记卖出。
- ⚠️ 顺带发现:`api/sync-singles-sheet` 的「新 tcg_id 会自动插入」这个兜底**对这 9 批基本没生效**(80 个 absent 里大量是全新 id)——小时级 cron 是否还在跑没查,反正**不能再指望它当入库通道**。

## ✅ 8/21 点货页按大品类分组 —— **已发版**(`80cfe93` 推 main,Vercel 自动部署;Codex 两轮:一轮 2 P1 全修,二轮 SHIP;Gary:「只需要英文就行 可以发」)
- **发版内容五合一**:大品类分组 · 手机零横滑(名字滑出屏幕那个雷)· 回车跳下一行 + 滚轮防误改 + 去灰色 0 占位 · **整页纯英文**(横幅/品类条/空行确认/说明书/placeholder 全去中文;日本团队导航区中文不动,受众不同)· Codex 两条 P1 修复。
- **Codex 一轮抓的两条 P1(都核实为真)**:① 组内按「数量×价格」排序会让人从顺序反推相对库存,削弱盲盘 → 改成 品类→最近动销→名字(顺带得到会话间稳定的顺序,点货员每晚看到同一张表);② `Limit Over Collection ×2 / Ghost from the Past` 是游戏王(Yugipedia 查证)但 brand=Other,落进 Other 桶 → 补进名字规则,Other 37→34。**Codex 顺带点名两条既有 P1(未修,另立项)**:库存加载失败被吞掉仍进第二步(可能把上一房的表写进新房)· 提交写库中途失败不回滚(重试会重复扣)。
- 新 `src/lib/countCategories.js`:品类从**名字**判,不从 brand 判(brand 有已知错标;One Piece 规则排最前,正好救回 Kami 那个错标行)。规则拿全部 786 个活跃产品校准过:Other 桶只剩 37 个、全是真杂项;当场修了两个错(`Rarity Collection Quarter` 是游戏王不是宝可梦;`m4（fire）` 系列是宝可梦 M 系列)。
- 点货表排序变为 **品类 → 最近动销 → 价值**,每个品类一条金色横条(`One Piece · 5 products · 数完这一类再数下一类`);原「新到/旧货」两段式降级为行内 🆕 角标,**只保留一层分组**。盲盘规则一字未动。
- 44 项测试跑真函数 + 变异测试(关掉 One Piece 规则 → 7 条红);`npx vite build` 通过;**桌面+手机截图逐个看过**(无横向溢出;控制台仅剩既有的 CORS/400 两个老错)——截图当场抓到说明横幅还写着旧排序规则,已改。
- **🔴 8/21 以点货员身份手机实走一遍(Gary:「你自己打开页面看看 以团队的角度」),抓到一个真会让人数错行的缺陷并修掉(`7b4b145`)**:390px 手机上表格比屏幕宽,**点进输入框的瞬间容器自动右滑、产品名整个滑出屏幕**——数的人只看得见「Booster Box / 205」,不知道在给哪行填数。**这可能就是历史上部分「数字填错行」的来源。** 修法:手机上 type 挪到名字下方一行、BrandChip 隐藏(品类横条已经写着 One Piece,行内 chip 是 120px 的纯重复)、空缩略图列隐藏、输入框收窄 → **390px 零横滑实测(360px 仅剩 1px 取整)**。同批:**回车跳下一行**(type-enter-type-enter 顺着货架数)· **滚轮不再能悄悄改动焦点里的数字**(桌面数据完整性)· **去掉灰色 placeholder「0」**(空白必须看起来是空白,空/0 之分正是提交确认要人做的判断)· 三段话横幅压成两行(原来手机上第一行产品前要滚一整屏)。
- **✅ 网页版也全尺寸实走过(Gary:「可以试试网页版」)**:1380 桌面 / 1024 笔记本 / **720 半屏窗口(直播间电脑常态)** / 390 手机全部零横滑(360 小安卓仅 1px 取整)。走到了提交那步:**空行确认弹窗双语、逐个点名没填的产品、Cancel=中止**(用对话框拦截实测,零写入);底部有 `Counted: 0/20` 进度 + 「空格按 0 记」提示。**遗留小项(没做)**:进度只在页底,数到中段看不见——可考虑吸底;品类横条上加「已填 n/m」小计。
- ⏳ Gary 提的第二步「按数量/货况给 streamer 出精简点货名单」没做——那是另一个功能,等分品类先落地。
- 🔴 JV「SKU 搞错」假设已排除:记串的话总量守恒,该有别的行 +17/+13/+10,实际全表正差只有 +22(Marvel 已破案)+6+1,五个龙珠兄弟行原封不动。FB10/JP OP-13/Storm 三行是干净的 0,更像「货不在视线里被空行=0」或真消耗(待问 JV)。

## ✅ 8/21 日本 tracking 已挂进 05:40 日巡(Gary:「日本的tracking 你更新在alert里面」)
- **`jp_shipment_watch.py` 从 8/12 写好起 `--telegram` 就从来没发出去过**:`from notify_telegram import send` —— 模块在 lv-finance,日巡脚本加了那个 path 而它没加,ModuleNotFoundError 被 except 吞成一行 stderr。**又一个「装好了但从来没响过」**。已修(补 sys.path),实测 `已发 Telegram`。
- **在途也进消息**(原来只发「送达没人收」):箱子在路上就 1-2 天,日巡里的在途是信号不是墙纸;`IN_TRANSIT` 不计入 urgent,发送闸门单独判。已写进 `run_inventory_watch.cmd`(排日巡之后,失败不影响日巡)。
- **🔴 8/21 追更(Gary:「876032526966 its out for delivery 其实应该用fedex直接查?」→ 对,两点都对)**:那票 **17track(钉了 FedEx)完全查不到,而 fedex.com 直连看得一清二楚** —— 配達中、今日 ~10:30 前送达、已在洛杉矶、**3 个包裹之一**。**8/4「fedex.com 已废」的结论过时了**:现在能用,只是藏在 OneTrust cookie 墙后面(点掉横幅再等 ~11 秒才渲染;页面按发件地区出日文)。已升级 `web_track.py`:fedex 路径自动点 cookie 横幅 + `_classify` 认日文状态词(配達中→OutForDelivery,配達済み→Delivered,輸送中→InTransit),两票实测读对。**口径:FedEx 号直连优先,17track 钉承运商做备胎 —— 两个源各有瞎区,谁都不能独任。** ⚠️ 又踩一次 heredoc 退格符坑(`` 进 Python 变 U+0008,replace 静默不匹配),这次用逐行定位 + chr(92) 绕开 —— 手册那条「这条管道里的反斜杠一律用 chr(92) 构造」是铁的。
- 当日实况(Gary:「日本应该有两个快递 一个今天到」→ 17track 钉 FedEx 逐票实查后**他说得对**):**真在途 = 2 票,正是两箱 `THE WORLD'S STRONGEST WARRIORS (Case)`** —— `876087907291`(12 件 $26,612,8/21 晚离成田,**今天到的就是它**)+ `876032526966`(7 件 $17,072,8/19 发出,**17track 重试后仍查无数据 —— 要么还没进系统要么号录错,要让 Hwa 核号**)。「在途 4 票」里另两票其实**早已送达且基本收完**(`875850110456` 8/18 到、38/39;`875974095783` 8/20 到、18/19,各差 1 件)——账上 `tracking_delivered_at` 没人写才被分错桶,已用**承运商扫描日期**补上 9 行(备份 `jp_delivered_backup_0821.json`,回读通过),alert 已按修正分桶重发。**教训重申:watch 读的是 DB 字段,而没人写送达日期,分桶就永远停在「在途」—— 送达日期以后由谁写要定**(inbound_notify 只更新自己的 state 文件,不写 acquisitions)。

## ✅ 8/21 三源对账首次完整实战:Yaz 的 −87 被 API+转录 30 分钟内裁决(Gary:「看看api 只要api能对上 transcript能对上 这是我们设置这个系统的目的」)
- Yaz 13:13 PK 盘点(自售自数)一片负差,三源拆得干干净净:**真卖的 API 逐行对上**(OP-16 −71/卖73 · OP-13 blister −14/卖14 · **WSW 散包 −12/卖12,今早 10:30 到货 2.5 小时卖光** · OP-02 −5/卖5 · Lorcana −5/卖5)——**Yaz 数得极准,连续第 5 个被收银机验证的盘点员**。
- **被错擦的 75 盒 = 零销售 + 转录里主播自己说货在**:Aldo 12:37 纸转 6 个 SKU(OP-08×24 等),s12 转录 12:37-12:51「first time in the top one PRB」「EB3 back in the building」「**cases are in here right now**」——**货以未拆整箱(Case)形态在屋里,Yaz 数「盒」只数了架上散盒(各1-2)没拆算箱内**。单位铁律的第 7 个实锤,这次是「箱装着盒、盘点表按盒」。已按 e1 先例恢复六行(2→24 等,备份 `pk_case_restore_backup_0821.json`,回读 6/6)。
- **教训固化**:①盘点撞上「纸转→上架」时差/整箱未拆,负差写库前该有「窗口内有转入 + 该行大额负差 → 弹确认」的闸门(待做)②TT 转录 s12(05:49-12:51)正好盖住 JV→Yaz 全窗,**三源对账从今天起是常规能力不是专项**。
- ⚠️ WSW 散包卖 12 后账 0,但今天到的 **WSW Case ×7($17K)在 PK 账上**,散包 listing 在卖而散包账 0——拆箱补货没有 box_breaks 路径(Case→盒→散包),又是 unit 链条的作业。

## ✅ 8/21 e1 基线修正已写库(Gary 口令「先修正 然后转库 确保 started right」;Aldo 初点 27 行 + 当日转入)
- **公式:修正值 = Aldo 转库前初点 + 点后转入(转入量从 movements 实读)**。27 行全部备份+乐观锁+回读通过(`e1_baseline_backup_0821.json`)。大项:**Journey 11+309=320(原账 439,−119)** · Black Bolt 64+60=124(−40)· Crown Zenith 8+220=228(−22)· 151 → 138(−10)· Terastal Gathering 盒 16→7(−9)。正差也写(ETB×5 等 +1/+2)——**这是 Gary 下令的手点修正,走 Aldo 8/5 先例,不是盲盘自动写**。
- **🔴 写库过程连躲三颗雷,全是同名/近名 SKU**:①「151 Booster Pack」**同名三行**(两退役一活),名字映射抓到退役行、干跑显示「no row 建 138」——**发现 cur 与先前 148 对不上才拦下**,改按 id `8622041d` 钉死。**写库前 cur 必须和已知账面对得上,对不上就是抓错了行。** ②今天有 56 包 Evolving skies 被 app 的 Move 页转进 **8/19 已合并的死 SKU**(Move 页不滤 active=false,死行累到 96)——已把幸存者行改 58、死行清零。③「Prismatic Evolution ETB」vs「Prismatic Evolutions Elite Trainer Box」近名双行,我先在后者建了 1、发现房里前者已有 1(同一实物)——已把我建的清零。**Black Bolt Booster Pack 也是同名双行(都 active),Aldo 的数写在有货那行 `f1ebe9c5`,这对该进合并清单。**
- **✅ Journey 定案(Gary:「其实库存里现在没有JT pack」)——今天转进 e1 的那 309 包是纸面幽灵,已移除**(e1 320→11,乐观锁+回读;全系统 Journey 现在就剩 e1 的 11 包,今晚下播盘点结案)。**病根是 8/18 那次搬运:实物几乎全搬去了 e1、账只记了 130** —— e2 账上的 190 和 Master 账上的 119 从那天起就是幽灵,没人再盘过这两处所以一直活着;今天 Aldo 的纸面转库把幽灵集中到 e1,恰好让它现形。**我早上「e2 的 190 应该还是准的」判错了 —— 「该房间没消耗」推不出「账是对的」,账错在更早的搬运上。** 幽灵账面值 ~\$1,718(309×5.56)。
- **链条改用真基线后是闭合的**:Brandon 8/18 实点 159 → 两晚消耗 148 → Aldo 实点 11。其中拍锤钉死 54 包,**其余 ~94 包 = vahe 的口头直卖/白送**(transcript 里他整场喊「\$7 一包要多少说话」,直卖不进拍锤日志)——**直卖占了消耗的六成,这才是 e1 卖法的真形态**;等 ebay_buyer_orders 刷过 8/20 晚拿订单验这个数。
- **挂起待答**:① Aldo 的「ASc packs : 180 12」看不懂——Ascended 散包行(账 170)**没动**;猜测是「散包 180 + Two Packs 12」(目录里有 Two Packs SKU),**要 Aldo 确认,没确认不写** ② `Fates Collide blister ×2`、`Team Plasma Tin ×1` 目录里没有对应 SKU,没建没写 ③ **e1 账上有、Aldo 没数到的行**(未动,要问):Storm 盒 ×5 · Gem Pack Vol 6 盒 ×10 · Gem Vol.5 盒 ×5 · VStar Universe ×1。
- 顺带:成员 Telegram 中继已支持**照片落盘**(`tg_media/`,Gary 对话也开了);Aldo 15:54 那张原图确认无法追回(bot 无权翻私聊历史,试尽)。今天 Aldo 的七笔补货是 **tg_move 桥的首次实战,零差错**。

## 🔴 8/21 Vercel 转户核查:部署管道健康,但公网上还挂着一个 7 月老版本的化石项目
- **新管道健康**:GitHub deployments API(匿名可查)显示最近每笔 push 都触发 Production 部署且 `success`;部署专属 URL 带 Vercel SSO 保护。**生产自定义域名仍不知道**——`.vercel.app` 项目名域名 404,常见子域名 DNS 全无 Vercel CNAME;k1bkorhr 浏览器 Vercel/GitHub 都没登录,进不了后台。
- **🔴 化石:`luckyvault-inventory.vercel.app` 还在公网服务一个 7 月下旬之前的老 build**(585KB bundle 实测:房间名还是 `Stream Room - TikTok Whatnot`、无 PokeCasino 改名、无 stock_adjust/盲盘修复/preflight/查重守卫,连 7/29 的 shows 渠道都没有)。**它连的是同一个生产 Supabase(anon key 打包在内),登录也走同一张 users 表** —— 谁书签了这个网址,就在用几个月前的逻辑直写生产数据。近期盘点/销售数据形态都是新版行为,**暂无证据有人在用**,但这是把上了膛的枪。多半是 William 时代的原项目(账号断开后冻结),这次转户转的可能就是它。
- **待 Gary 在后台做(30 秒)**:① 看 dashboard 里是一个项目还是两个;② 化石项目要么重新连回 GitHub repo(它会重新部署最新 main,`luckyvault-inventory.vercel.app` 这个好记的域名就变成新版),要么删掉/暂停;③ 顺手建一个 Access Token(Settings→Tokens)存进 `inventory-sync/data/`,以后每次发版我能直接 API 验证生产、读部署日志、查真域名。

——查完:JV 没错,错在一笔纸面转库和一行抄出来的 0 差(Gary:「我们俩看看是系统错误还是什么错误」)
- **JV 8/21 04:42 PT 的 Packheads 盘点被收银机逐行验证是准的**:Lorcana `38−卖13=25=实点25` · Freedom Ascension `44−17=27=27` · OP-13 blister `25−11=14=14` —— **三条链分毫不差**。OP-16 `240−卖25≈215 vs 实点205`,差 10 在直播拆包误差内。**报警是铁律2 的已知盲区**(sold 124 里含整盒,盒被拆播永远没有订单行)。
- **🔴 真正的问题①:Aldo 8/20 16:44 PT 记的转库(Master→PK:OP-16 ×212 + Kami ×98)只动了账,实物没到货架。** 证据链:Polar 14:50 实点 286 → 窗口内收银机只卖 44 → Trey 20:02 实点 **240 ≈ 286−44**(Trey 这行数得很准);Kami 窗口 0 销售、Trey 实点 0。Trey 的表是新快照(exp 502/98),于是 **−262/−98 当场写库把纸面包抹掉**;Master 那头也已扣(OP-16 只剩 15、Kami 0)。**如果那 310 包实物还躺在 Master,它们现在两头都不在账上(≈$2,945),下次 Master 盘点报 +310 又会被正差规则丢弃 —— 单向棘轮的又一次咬合。要问 Aldo 实物搬没搬、搬到了哪,再复点 Master 的 OP-16 和 Kami。**
- **🔴 真正的问题②定案(Gary 8/21「这些产品是卖了还是没卖」):没卖,七个出口全部为零,$3,124 的货没有任何去向记录。** `FB10 散包 17→0($204)` · `[JP] OP-13 盒 13→0($2,340,大头)` · `Uma 盒 43→33($385)` · `Ayakashi 盒 60→54($195)`。证据:① TT 具名 listing 零订单(四个都有具名 listing,最近一次具名卖出停在 8/18)② 坑位行整夜只有 3 条,装不下 46 件 ③ `platform_sales` 0 ④ 门店 0 ⑤ 在线订单 0 ⑥ `movements` 0(账内没转走)⑦ **s11 转录(01:11–04:29,JV 场后半段)零拆零卖**。剩余可能:实物被无记录搬走(和 OP-13 blister 509 片同形状)或在 20:02–01:11 无转录时段被非卖出消耗;JV 在别的行被收银机逐行验证极准,数错概率低。**Gary 8/21 定:可能是数错,不追问,等下一个主播点(「可能会有点错的情况 等下一个主播点吧」)。** ⚠️ 但要知道等的局限:**FB10 和 JP OP-13 两行已归零,按 `.gt(0)` 规则不在下一张点货表上**——下一个主播看见货也没格子填,只能写进 notes(placeholder 里印着「product in the room but NOT on this list」那句,正是为这个);Uma(33)/Ayakashi(54)还在表上能自证。下一场 PK 盘点落地后做三明治对比,四行货若回来了按 A 类(总数对、房间对)补 Move。
- **✅ 8/21 晚三明治闭合,四行里两行已恢复(`pk_jv_restore_backup_0821.json`,乐观锁+回读)**:Uma 盒 JV 前**六场连着四个人都数 43** → JV 写 33 → JV 后 Yaz 42、Trey 43 → **恢复 33→43**;Ayakashi 盒 60 → JV 写 54 → 后两场都 60 → **恢复 54→60**。Aldo 20:57 那笔 Master→RocketsHQ ×12(Rockets 12→24)与 PK 无关,查过才动。**⚠️ 告警里 Ayakashi 那条「Fixable ← record a Move from Master」是错的处方**:那 6 盒从没离开 PK,照做会在 Master 挖一个新洞——A 类判定只看「别处有没有货」,看不见「本房刚被负差擦过」,该给 surplus 分类加一条「近期本房同 SKU 有大额负差 → 先怀疑擦除,不建议 Move」。
- **🔴 而且这是 JV 第二次擦同一个角落**:8/18 12:02 他就写过 OP-13 盒 13→1、Ayakashi 60→54、Uma 44→43,次日 Trey 全数了回来(8/19 04:49 act=13/60/43)——两次形状一模一样。**不是随机数错,是房里某个存放位置他没在数**(他收银机验证极准,错的全集中在这几个 SKU)。一句话问 JV「这些货放哪」比任何系统修复都便宜。**8/18 那次擦除是谁补回账的查不到**——OP-13 1→13、Ayakashi 54→60 之间零 movement,inventory 无 audit log,又一个「直接改库查无对证」的实例。
- **⏳ 还剩两行盲区**:FB10 17 包($204)/ JP OP-13 13 盒($2,340)归零后不在表上,Yaz、Trey 两场都没有它们的格子,无法自证。JV 两次擦除 + Uma/Ayakashi 复活让「货在同一个盲角」概率很大,但**没有复点观测就不写**——要么让 Trey 下播专门看一眼这两样,要么发 `feat/zero-row-grace`(48h 内归零行留在表上,自己就能数回来)。
- **✅ Marvel Allegiance 谜题破了(Gary:「trey应该看不到expected 现在marvel就是一个谜题了」)——两个人都没数错,是一行账管着两种实物。**
  - **先撤回我自己的指控**:我曾判「Trey 的 3 是抄 expected」。**代码证实盘点页全盲**(`StreamCounts.jsx` 注释明写「绝不预填 inv.quantity」「不渲染 expected」,空行=0 不再回落成 expected)——**看不到的数字抄不了**,那六行 exp=act 是他真数出来的。
  - **铁证在收银机里:TikTok 那条 listing 叫 `Hobby Boxes & Packs`,本身就是双 SKU** —— `box $206.99` 和 `Pack $12.99` 挂在同一条 listing 下。**8/14 卖的 3 件是 Pack;8/21 03:16 + 03:40 PT(JV 窗口内)卖的 2 件是 box。** 货架上盒和散包并存,而 `products` 只有 Hobby Box 一行(breakable=True · ppb=32 · 无散包 SKU)。
  - **所以两个稳定读数都是诚实的:Trey 数的是「盒」= 3;Yaz/JV/Polar 数的是「盒+散包」= 24–27。** 链条对得上:Yaz 27 = 3盒+24包 → 8/14 卖 3 包 → Polar 24 = 3盒+21包(分毫不差)→ JV 25(昨晚卖掉的 2 盒还没发货、仍在架上)。**盲盘没被违反,单位铁律又中一枪 —— 这是「一行两个单位」在盘点上的第一个实锤病例。**
  - **⚠️ 昨晚那 2 盒 = $413.98 已卖出**,账上仍写 3、TikTok 销售不扣库存;发货后货架变 1 盒 + ~22 包,下一场盘点又会出一个「谁也解释不了」的差。
- **处置(待 Gary 定,均未动库)**:① 问 Aldo 那 212+98 实物在哪 → 复点 Master OP-16/Kami ② 问 JV 昨晚 FB10 17 包 / [JP] OP-13 13 盒 / Uma 10 盒 / Ayakashi 6 盒的去向(**夜间三场 eBay 转录扫过,零拆包记录;JV 自己的 TT 场没有转录 —— TikTok 转录线停在 8/19,要让转录机重启**)③ **给 Allegiance 建散包 SKU + 走一笔 box_breaks**(3−2 已卖 = 1 盒 + 实点散包数),照单位铁律拆两行 ④ TikTok 映射的 key 必须 `(listing, sku_id)` —— 这条 listing 就是 8/19 那个论点的活例子。

## ✅ 8/21 转录库 v2 落地 + vahe 把 e1 的卖法改对了 + 首个「账 vs 转录消耗」对照(Gary:「本地我们更新了转录的库…可以查到每个 lot 卖多少 以及消耗情况对比」)
- **转录库目录 v2(8/21)**:Drive `live_transcripts/` 的转录文件挪进 `ebay/`、`tiktok/` 子目录,`MANIFEST.csv` 的 filename 列=相对路径;根级四件(MANIFEST / README_handshake / products_catalog / _auction_log)不动。**消费侧铁律:路径以 manifest 为准或递归扫,绝不根目录 glob `*.jsonl`(v2 下静默拿到 0 个转录不报错)。** 现 **41 场(eBay 31 + TikTok PK 10)**,覆盖到 8/21 凌晨;转录机每 30 分钟自动推。**TikTok Packheads 转录是全新的一条线**(s1–s10,8/16–8/19,含 `_meta` 头带 clock_offset)。
- **✅ 新 `lv-finance/pull_transcripts.py`**:SA(`slab-inventory/data/sheets_sa.json`)走 Drive API 的无头拉取器 —— 这正是 finance 侧 handshake 文档里欠的那个「常驻拉取器」(MCP 是交互会话,cron 里没有)。按 MANIFEST 驱动、尺寸比对增量、manifest 行缺文件时报错退出(投递缺口≠没数据)。本机镜像已重构成 v2 并补齐 14 场。
- **🔴 vahe 8/20(e1)当场把卖法改对了,钉死 8 个 lot / 34 包 / $223 = $6.56/包 = 市价的 100%**(8/18–19 他还是 $4.00 = 61%)。变化不是 2 连包卖好了(2 连包仍 $3–8/包,均 $5.33),是 **lot 结构变了**:上了 5 连包($37×2)、10 连包($76)、并反复用「packs are seven each」锚价 + 口头直卖(点着数出 10 包 = $70)。
  - **三个 lot 的赢家名和主播喊的人逐个对上**(sportsguyty4145 / beda_35826「BEDA」/ jrboy808「JR boy」),外加一笔主播自己报数(「went for six bucks for two packs」= lot070)。
  - **10 连包没人要 → 拆成两个 5 连包各 $37 当场卖掉** —— lot 结构决定价格的又一实证。
  - **按 lot 大小切全部 129 包:10 连包永远 $7.50/包 = 114% 市价(MA 8/13 $73 · Brandon 8/17 $76 · vahe 8/20 $76,三个主播两个房完全一致);2-3 连包 84%、5 连包 85%。** 存底 `journey_ebay_lots.json` 已更新(34 lots,备份 `.bak_0821`)。
- **🔴 拍锤日志的 ts 滞后真实落锤最多 ~3 分钟**(lot039:主播讨论 $4 结果比日志 ts 早 3 分钟)。宣告句→下一锤的 join 不受影响(滞后单向),但**不许拿日志 ts 当精确落锤时刻做窄窗口**。
- **🔴 口头直卖不进拍锤日志**:8/20 那笔 10 包 $70 是主播点着数出来的,没有锤。只有订单能证——而 `ebay_buyer_orders.jsonl` 停在 8/20 10:59 UTC,**vahe 晚场订单还没进来,先记 observed_not_pinned**。白送又 3 包(18:09/19:08/21:38)。
- **✅ 首个「账 vs 转录消耗」对照(Gary 要的那条,8/21 追问「vahe 今天晚上没点库存对吗」后修正基线)**:
  - **对,没点**:e1 最后一次盘点是 **8/18 22:31 PT(Brandon,counted_by=streamer 自售自数)**,vahe 8/19、8/20 连播两场都没有下播盘点;e2 也停在 8/17 15:53 PT。
  - **那次盘点把 Journey 数到 159(账 130,+29 正差按铁律丢弃)** —— 比「130 − 当日已消耗 12」的应有值还高 41。三种可能(转库少记 / e1 六七月 475 包时代的无账存货 / 数错),数据分不出。**基线以实数 159 为准,不以账 130 为准**(盘点是观测,账在 TikTok/eBay 销售上是瞎的)。
  - 159 之后转录看到 **20(8/19)+ 34(8/20)钉死 + ~15 没钉死 ≈ 69–75 包消耗 → 真实在架 ≈ 84–90**。账上 expected 仍是 130,**下次 e1 盘点预计报 −40 到 −46 的负差 —— 不是丢货,每一包都能逐 lot 说清**(daily_close 公式:盘点净差 = 补货 − 场耗)。**如果实点落在 85 上下,盘点→转录这条链第一次闭环。**
  - 对照组:**8/18 之后所有 e2 场次 0 次 Journey 开拍 → e2 的 190 应该还是准的**(但 e2 同样四天没点)。
- **finance 侧已建好的(别重复造)**:拍锤×订单 join(Brandon 52/52=100%、锤→订单中位 +0.6min)· TT 双口径($1 池逐单 88%,置顶品场级 GMV 97%)· 逐笔毛利 v0(`scratchpad/lt/brandon_pnl.py`)· 口播别名表需求(op eleven→OP-11)· 盘点净差分解公式。三方验证目标:transcript ↔ orders ↔ stream_counts 三源互证。

## 🔴 8/20 「Journey 在 eBay 均价多少」——答案是查不出,而查不出的原因就是 daily 结算该补的那条腿(Gary:「只能看 transcript 去看 ebay 这就是我们 daily 结算要带的 看 ebay 的数字准不准和 tiktok 一样 然后看消耗以及销售」)
- **钱有、货名没有。** eBay 发货 CSV 每一笔都有实际净额(item sales / 各项费 / 实收),但 **32,646 条 eBay 订单标题里「Journey」出现 0 次** —— 70% 的订单标题是场次名(`#156 - EBAY LIVE AUCTION- 8/9 W/CARLOS`),**`#N` 是坑位号**。Journey 853 包全走 `$1 START PACK RIPS` 混场,**从来没有过自己的具名 listing**。
- **对照:有具名 listing 的套一查就有** —— Abyss Eye 14 个标题 / 1,445 单 / 均 $64.93 · Mega 8/491/$133.63 · Storm Emeralda 7/427/$74.34。
- ~~**Producer 是 Gary 的监控机,`live_transcripts/` 目录至今不存在 —— 一个文件都没投过**~~ **← 这句是错的,Gary 当场纠正(「这个应该有啊 你看 shared drive」)。投递一直在,投在 Google Drive**(`live_transcripts` 文件夹,help@luckyvault.us,8/17 建):**24 场 eBay(8/11 起)+ 10 场 TikTok(8/16 起)+ `_auction_log.jsonl`(逐 lot 拍锤:坑位号+买家+价格+时间戳,8/16 起 1,247 锤)+ MANIFEST.csv**。**我只查了本机目录就断言「没投递」—— 投递点和契约文件写的不一样,但东西在。查「有没有」要查到所有已知的存放处。** 已镜像到本机 `lv-finance/data/live_transcripts/`。
- **Gary 定的 daily 结算逻辑(8/20)**:① transcript ↔ eBay 订单按 lot 号 join ② **先验 eBay 的数字准不准,和 TikTok 那套一样**(盘点写掉 vs 订单,**只在干净窗口断言**)③ 再看消耗 vs 销售。**eBay 侧今天没有任何一个窗口是干净的**(每一单都是坑位),所以这条检查在 transcript 落地之前会永远报「比不了」—— 不提前建一个只会喊比不了的检查器,transcript 一落地就接。
- **🔴 两个「自洽但不能用」的巧合,写下来防止以后有人拿去当均价**:8/15 写掉 81 包、e2 恰好 81 单均 $101.84(**那场是 MYSTERY SLABS,一包 Journey 不可能 $102**);8/16 写掉 215 包、唯一拆包场 141 单均 $34.33。**和 8/19 那个 2.3 倍同一形状。**
- **✅ 顺带修了 Journey 的成本(Gary:「成本你看 weighted average」)**:两行进货是 **FB03 同款「单价打进总价栏」**——`2faff15a` 400 包记 $5.50、`d34d7775` 150 包记 $5.75(= $0.01/包;而 $5.50/$5.75 作为单价是钉价市价 $6.56 的 84–88%,**签名完全吻合**,且两行都在 6/24 开关上线前)。已改 $2,200.00 / $862.50,notes 打 `FIXED_UNIT_AS_TOTAL`。**加权平均 $3,085.50 ÷ 555 = $5.56/包**,四个在库房的 basis 5.00→5.56(备份 `data/journey_cost_backup.json`,乐观锁 + 回读;**一行 qty=0 basis=4.66 的被锁正确拦下没动**)。COGS 少记的 ~$3,051 已回到进货账上。
- **✅ transcript ↔ 拍锤 join 首次跑通,Journey 的真实均价出来了,已发 Frank**:
  ```
  60 包核实(8/16–8/19,20 锤,每锤带主播原话):
    08-16  2-3包一组定价起拍        18 包   $6.49/包
    08-17  Brandon 10包一组          10 包   $7.60/包
    08-18  Vahe $1 起拍小包组        12 包   $2.92/包
    08-19  Vahe $1 起拍小包组        20 包   $4.65/包
    合计                             60 包   锤价 $5.35/包 · 扣费(6.7% CSV 实测)≈ $4.99/包
  ```
  - **🔴 结论:Journey 在 eBay 平均卖在成本($5.56)之下,锤价 = TCG 市价($6.56)的 82%。** 但均值掩盖了真信号:**结构化的 lot(10 连包 / 定价起拍)卖到市价,$1 起拍的两连包卖到市价一半** —— 同一批包、同一周,差 2.6 倍。**这不是谁卖得差,是 lot 结构决定价格。** 另有 penny drop($0.06/2包)和白送的 free pack 在 transcript 里都有据可查 —— **零收入消耗真实存在,正是盘点缺口对不上销售的一部分。**
  - **方法(照 TikTok 那套的纪律)**:语音里的**开拍宣告句**(「N packs of journey going live / dollar start」)→ 同场 `_auction_log` 的下一锤 → 锤价 ÷ 包数;**菜单式吆喝、拆包吐槽、宣告的是别的套的一律剔除**(剔了 9 个:白火 / Storm / 151 串场)。29 个强信号 → 人工逐个核 → 留 20。6 个 lot 在发货 CSV 里对到**实际净额**,量出费率 6.66%。存底 `lv-finance/data/journey_ebay_lots.json`。
  - **✅ 8/20 追问「其他的还有吗 ebay2 的有吗」→ 补齐后 95 包,而且按房一拆答案更利**:
    ```
    e2(结构化 lot:5-10 连包 / 定价起拍)   63 包  $6.73/包 = 市价的 103%
    e1($1 起拍 2 连包,Vahe 8/18-19)      32 包  $4.00/包 = 市价的  61%
    合计                                    95 包  $5.81/包 · 扣费 ≈$5.42 vs 成本 $5.56
    ```
    **e2 的卖法在赚钱,e1 现在的卖法在亏钱 —— 而 8/18 刚搬去 e1 的 130 包正用亏钱的卖法在卖。** 已补发 Frank。
  - **sid → e1/e2 的映射方法(以后 daily_close 直接用)**:拍锤的 `买家名+价格` join `ebay_buyer_orders.jsonl` 的 `u+sub`,12 个场次几乎全票(如 153/153);**订单 `d` 字段是 UTC,和拍锤差中位 −95 秒** —— 所以**没有拍锤日志的场次可以用「宣告句时间 → 窗内唯一订单」补价**,8/13 MA(10 连包 $73)和 8/14 Brandon(五个 5 连包,**主播喊到的买家名和订单买家名逐个对上**:jobar $36 / nukeengineer $38 / alexroman16 $35 / funkohut $32 / elektronics $17)就是这么补的。**窗内不唯一、买家钉不死的不进均值**(记在 `observed_not_pinned`)。
  - **8/11–8/13 其余六场(rob/carlos/backwall/gold star/mystery)0 次 Journey 开拍** —— 那几晚根本没跑这个货,不是漏检。
  - **⚠️ 覆盖有洞,别当全量销量用**:8/15 一场都没录(MANIFEST 里 8/14 直接跳 8/16),拍锤日志 8/16 才开始;所以 8/16 写掉的 215 包对不满是**覆盖问题**,不能反推销量。**e1 六七月那波(475 包)完全在覆盖之前,永远补不了价。**
  - **⏳ 下一步**:把这条 join 做成 daily_close 的常规腿(按 Gary 8/20 定的三步:join → 先验 eBay 数字准不准(干净窗口)→ 消耗 vs 销售)。lot 号 ↔ 发货 CSV `#N -` 的净额线已验通。

## 🔴 8/20 Frank 的 Telegram 转库:权限是给了的,卡在四层,第一层是一个词(Gary:「是没给他权限吗 卡在哪里」)
- **是 Frank,而且时间对得分毫不差。** `member_inbox.jsonl` 里他的原话:
  ```
  15:29 PT  I forgot to transfer the 146 op16 booster packs to packheads from master
  15:30 PT  Move 146 op16 booster packs to packheads
  15:32 PT  Okay i just did it manually
  ```
  而 `movements` 那笔是 **22:31:16 UTC = 15:31 PT**。**他等了两分钟,没等到,自己去网页做了。**
- **⚠️ 那笔在库里记在 Eric 名下,但它是 Frank 的。** 这是**第二次**出现「Frank 的动作记成 Eric」(8/18 那 35 片 blister 是第一次)。**按人算的表要当心这一条**,`moved_by_id` 是下拉框选的,不是身份。
- **① 真正卡住他的是一个词:`room_transfers.ROOM_ALIASES` 里没有 `master`。** 只有 `e2/e1/PK/RK/VA/store/office` 七个 —— **而 master 是几乎每一笔转库的出发地**。他写 "from master" → 解析器不认 → `from_room: null` → `status: unparsed` → 收到「没解析全」→ 换个说法再发 → 还是不行。
  - **`tg_move.py` 那张表一直是全的**(Gary 8/18 逐个确认过)。**两张别名表,而面对团队打字的那张是残缺的那张。**
  - ✅ 已补 `master / casino / PAH / japan`(含中文 `总仓 / 日本仓`)+ `ph / lvus / front / rocketshq`。**新测试 `test_room_aliases.py` 断言 `tg_move.ALIAS` 的每一个别名都必须在聊天解析器里解析得出来** —— 补一个词治不了下一次,让两张表不能再漂才治得了。
- **② 就算解析成功,它也不会动库存。** `room_transfers.handle_message` 只往 `data/room_transfers.jsonl` 追加一行,然后回一句 **"📦 Transfer noted (burn calc will offset it)"**。**它从不写 `movements` 或 `inventory`。**
- **③ 而那句承诺是假的:`room_transfers.jsonl` 全仓库没有任何东西读它**(grep lv-finance + inventory-sync + slab-inventory,只有它自己)。**所以 burn calc 也不会冲销。** ✅ 已改成明写「这只是留档,系统库存还没有动,请到 app 的 Move Inventory 里做一笔,否则下次盘点会报成差异」。**说 noted 而其实什么都没动,和批次报 DONE 却给一个空 PDF 是同一个病。**
- **④ 🔴 `tg_move.py` 没有 `if __name__ == "__main__"` 守卫,argparse 在 import 时就跑 —— 所以它根本 import 不了。** 这就是「昨天写好的写库工具没有任何东西调用它」的字面原因:**不是没接,是接不上。** ✅ 已包进 `main()`(备份 `tg_move.py.bak_0820`),**CLI 行为逐条实测不变**(不给身份仍然拒绝),现在 `import tg_move` 通了。
### ✅ 8/20 已接通并通知到人(Gary:「可以接 然后让 mario frank 以及 aldo 都知道」)
- 新 `lv-finance/tg_move_bridge.py`,挂在 `telegram_command_listener` 的成员中继里,**排在 `room_transfers` 之前**(顺序是硬要求:留档那条会先把消息吃掉然后回一句 "noted",而库存一动没动 —— 那正是让 Frank 白等两分钟的路径)。
- **流程永远是四步,绝不跳:`解析 → 定房定 SKU → 出计划 → 回 YES 才写`。** 计划带着 `tg_move` 的 token(SKU+房间+数量+**写完之后的库存**的哈希);**期间货架动过,token 就对不上,一个字不写。过期的 YES 落不了地。**
- **🔴 真数据当场推翻了我第一版的排序,而测试夹具看不见**:候选原来**按库存量排**,于是 Frank 那句 "op16 booster packs" 排出来第一个是 **sleeved(Master 有 1,216)**,而他要的散包(227)在第二 —— **顺手点「1」就搬错货**。改成**按「你打的词之外还剩几个词」排,最贴的排第一**;库存只用来打平手和把源房没货的沉下去。**读编号列表的人只会认真读第一行,第一行必须是最贴的那个,不是最大的那堆。**
- **🔴 而且候选里混着 `(RETIRED DUPLICATE)`** —— 已按 `active=false` 过滤(5 个候选 → 2 个)。**把合并掉的 SKU 当搬运目标提供出去,等于把刚清理掉的重复又灌回来。**
- **拒绝清单**(每一条都实测过「拒绝了,而且零写入」):**没登记的 chat**(身份只认 chat id,不认消息里打的名字)· **`app_user_id` 为空**(Gaoyuan)· **名字对上多个 SKU/房间** → 列出来问 · **源房不够** → 永不写负库存 · **超过 15 分钟的 YES** / **第二次 YES**(计划一次性,写之前就清掉)· **`VA` / `office` 两个房不给映射**(VaultTcgAuction 在 `tg_move.ALIAS` 里没有别名,裸 `va` 会子串命中好几个房 —— **宁可交回人做,也不猜房间**)。
- **数量检查排在查库之前**:`room_transfers` 对 5 位数返回 `qty=None` 却仍标 `ok=True`,不先拦就会报成「找不到 SKU」,**拿名字背数字的锅**。
- 测试 `test_tg_move_bridge.py`(桩掉 HTTP 层,**桩会记录每一次写请求**,所以「拒绝了」是靠零写入证明的,不是靠打印一句拒绝)+ `test_room_aliases.py`。**真库端到端跑过一遍,`dry=True` 只读,真实写入尝试 0 次。**
- ✅ **已 Telegram 通知 Frank / Mario / Aldo**(三条都回 `sent: True`),Frank 那条额外说明了今天下午为什么没通、以及那是我们的问题。

## ✅ 8/20 「+163 discrepancies」拆开:一个是转库,一个是没人认同货架上有什么(Gary:「是转库了呢还是什么情况」/「自售自数其实可以通过 api 对应上」)
- **`⚠️ +163` 是 25 行里的 2 行,其余 23 行分毫不差。** 那个数把 2 行分歧印成了 163 个错误 —— **`buildStreamCountBrief` 印的是件数求和,应该印行数并点名最大的那行。**
- **① OP-16 散包 +142 = 转库,已证实。** `movements` 里 **`2026-08-20T22:31:16 Master → Packheads x146 by Eric type=Transfer`** —— **Polar 21:50 报数,Eric 22:31 补记,差 41 分钟。** Master 373→227,Packheads 144→290,账已平。**货一直在,只是搬在前、记在后。**
- **② Marvel Allegiance +21 = 不是转库,也不可能是** —— 全系统只有 3 件、Master 是 0,**没有任何地方能转出 21 件**。
  - **🔴 收银机把这条钉死了:8/13–8/20 八天 Packheads 只卖过 3 件 Marvel Allegiance,全在 8/14,之后一件没卖。所以货架自 8/14 起没动过。** 而同期盘点读数是 `27 / 3 / 26 / 3 / 3 / 3 / 24`(Yaz/Trey/JV/Trey/Yaz/Trey/Polar)。
  - **同一个不动的货架,两个稳定读数。这不是漂移,是分歧。数据分不出来,只有看货的人能分 —— 一张照片的事。**
  - **⚠️ 我先猜「是散包在往下掉」,被收银机证伪了(没有销售可以解释下降),已撤回。**
  - **结构上的坑还在**:`breakable=True` · `packs_per_box=32` · **没有对应的散包 SKU**。**盒可以拆,拆出来的 32 个包没有任何地方可以记** —— 如果货架上真有散包,盘点表上只有一行可写。这正是 unit 那条铁律的第二个作业。
- **③ 自售自数可以用 API 校,Gary 说得对,而且有数。** Polar 那一场(08-20 04:57→21:50,16.9 小时)实测:
  ```
  Freedom Ascension sleeved   盘点写掉 12   收银机 12   差  0
  OP-16 sleeved               盘点写掉 15   收银机 19   差 −4
  窗口 34 条订单行,拍卖坑位 0 条 —— 干净
  ```
  **所以 Polar 这一场数得好**;看起来吓人的 +163 一个是转库、一个是读数分歧,**销售那一侧 31 件里只差 4 件**。
- **🔴 但只有 38% 的场次能这样验**:最近 24 个 Packheads 盘点窗口,**9 个坑位行为 0(可验)· 15 个被拍卖坑位污染(永远归不到 SKU)**。**所以规则必须是「干净才断言,不干净就明说比不了、并说清是什么挡住了」** —— 和今天日巡铁律2 的修法同一条。
- **⏳ 建议(待 Gary 定)**:① 盘点消息**在发送时就分类**(`fetchStockElsewhere` 8/12 就有了,多出消息在用,盘点简报没用)② **给告警一个 2 小时的宽限再复查** —— Eric 那笔 41 分钟就补上了,宽限一下这条根本不该响 ③ 把这个窗口的收银机核对**附在盘点消息里**。

## 🔴 8/20「为什么 Rockets 这么多错误」——它其实是最干净的一个房,但一行归零就永远数不回来了
- **前提要先纠正:按每一个能算的指标,RocketsHQ 都是四个直播间里最好的那个。**
  ```
                      有差%(全期)  7天    14天   30天   离群率   数成0的次数/件数
  eBay SlabbiePatty      56.0%    62%    71%    71%    0.7%     134 / 3,680
  eBay LuckyVaultUS      53.3%    74%    85%    68%    0.6%     183 / 8,604
  TikTok Packheads       35.9%    50%    58%    58%    0.8%      98 / 3,993
  TikTok RocketsHQ       31.5%    45%    37%    41%    0.3%      50 /   983   ← 全部最低
  ```
- **但它在「多出点名」那张表上占 13 项里的 6 项(46%),而件数只占 418 里的 60 件(14%)。** 看起来错得多的是**条数**,不是量。**这就是 Gary 看到的那个印象的来源。**
- **条数下不去是因为多出根本没有出口**:正差从 7/24 起不写库,所以同一项每盘一次就再报一次 —— **Ayakashi 从 8/05 到今天报了 6 次,Perfect Order 4 次**。Rockets 盘得勤(46 场),于是报得也勤。**报的次数是「有人在数」的证据,不是「错得多」的证据。**
- **🔴 真正的事故只有一件,而且是一场**:**Polar 8/17 19:27 在 Rockets 的首盘**,20 行里 7 行负差,**一场写掉 90 件**。
  - **两条可以证明是数错的**(前后两次互相吻合、中间和两边都不合):`Ayakashi 盒 23 → 12 → 21`、`Enchant 散包 8 → 5 → 8`。这两个现在还在每天报多出。
  - **两条是直接记成 0**:`151 Booster Pack 账上 63 → 记 0`、`Shining Legends 账上 9 → 记 0`。
- **🔴🔴 归零的 SKU 会从盘点表上消失,所以再也没有人能把它数回来。** `fetchInventoryForRoom` 用 `.gt('quantity', 0)` —— 实测 Polar 之后 Rockets 又盘了 2 场(Sue,8/18 两次),**`151` 和 `Shining Legends` 两次都不在表上**;而被写成 12(不是 0)的 Ayakashi 两次都在,并且继续报多出。
  - **写成 12 会被后续盘点纠正,写成 0 是永久的。** 这是这条规则最贵的地方,和「多出永不写库」加在一起构成一个**单向棘轮**。
- **🔴 而「记成 0」这个动作全库都在发生,Rockets 反而是最少的**:`actual=0 且 expected>=5` 共 **465 行 / 17,260 件**,eBay LuckyVaultUS 一家占 183 行 / 8,604 件。**盲盘规则「空行=0」让「跳过这一行」和「一件都没有」在系统里长得一模一样,而后者直接写库。**
  - **⚠️ 不能把这 17,260 件都算成错** —— 直播间真卖光是常事,那正是盘点要抓的。**能证明是错的只有前后夹住的那种**;其余是**风险敞口不是损失**。
- **⏳ 该做的一件事:让 Rockets 复点 `151 Booster Pack` 和 `Shining Legends Booster Pack`。** 两个都记在 0,五天前分别是 63 和 9,中间没有 Move、没有销售行能解释(**TikTok 卖出不扣库存,所以也可能真卖光了 —— 只有实物能定**)。而且**它们已经不在盘点表上,不专门去看就永远不会被发现**。
- **⚠️ Polar 8/20 21:50 又在 Packheads 盘了一场,写掉 27 件。** 新人的头几场值得复核。

## ✅ 8/20 进货消息加「买入价 = 市价的百分之几」(Gary:「这个消息我们再价格对比 market 的%可以吗」)
- **触发它的那条**:`🛍️ New Purchase Logged / Frank / Discord (USA) / [EN] OP-11 A Fist of Divine Speed Booster Box × 6 / $3,300`。现在这一行读作 **「$550 each — 85% of the $644.78 market」**。两分钟后 Frank 又下了一单 12 盒 @ $579.17 = **90%**;同批 PRB2 盒 $340 = **87%**。
- **🔴 app 那边答不了这个问题,所以放服务端。** `fetchCostReference()` 只认得 `avg_cost_basis` 和我们自己最近一笔进货 —— **两个都是我们自己的价,拿它比等于自己给自己打分**。市价在服务端(钉 id + `erp_pricing`)。**而且服务端还能覆盖 app 表单根本看不见的行**:过去 30 天 322 行进货里,绝大部分是 `origin=jp_vendor`,从来没走过 Purchased Items。
- 新 `inventory-sync/buy_market_check.py` + `test_buy_market_check.py`(**95 项,跑真函数**)。默认 dry-run;**发群是对外动作,必须显式 `--lark`**。
- **🔴 这个百分比是一句关于「单位」的断言,所以按单位来防**。「85% of market」暗含「我们那一件和 TCG 那一件是同一个东西」——**而这正是这周炸了五次的那句话**(In Bag 30 包 · Case 12 盒 · TikTok「10 Pack Bundle」),**每一次钱都是对的**。`sealed_type()` 已经挡住了 BOX 配 PACK,**但挡不住垃圾袋**:`Storm Emeralda (In Bag)` 推出来是 PACK,一袋 30 包,老实算就会印 **3,750%**。
  - 所以**比值落在 [20%, 300%] 之外一律不给结论**,改印「这两个数不在数同一个东西」+「你那一件大概装了它 38 个」——**那才是能回答的问题**,而且拿着货的人当场能答。
  - **变异测试证过会红**:把这道闸门关掉 → **9 条测试当场失败**,而且那个垃圾袋会被印成 **「that is market price」**。
- **🔴 顺手抓到一条真的**:`c5615d73`(08-20 12:04)记 **97 个 Ninja Spinner 散包 @ $0.6968**,而这个货 14 笔进货里 **13 笔都在 $1.34–$1.88**,当前标准价 $1.4070 —— **正好是一半**。要么数量该是 ~48,要么总价该是 ~$136。**两种读法都印出来,一个都不断言。**
  - **它不是市价抓到的**(22% 在带内),是**新加的「跟自己的历史比」抓到的**。这是**另一个问题**,而且**在取不到市价的那 16% 上照样有效**。
  - **参照只取最近 8 笔,不取全部** —— Storm Emeralda 三周里真的从 $194 跌到 $114,拿全期中位数会把一次真实的行情变动**每一笔都报成错误**。
- **📌 覆盖率比想的高得多,因为模糊匹配管用**:按**钉价**只有 21% 的钱能判,**按 `price_product`(钉价 + 模糊)是 84%**(30 天 $479,716 / $568,451)。模糊匹配**只当证据不当定论**,消息上明写 `(match not verified yet)`。**加权平均买入价 = 市价的 92%。**
- **🔴 30 天回溯那个数带着市场漂移,不能当买入质量读** —— 报出来的 Storm「127–140%」**全部是 7/30–7/31 的单**($194–$214),而同一个货今天 $113.90。**这正是 8/10 记的那条:拿今天的市价比当时的买入,量的是市场,不是买手。** 而**工具本身用在「刚记的那一笔」上,漂移 ≈ 0**,所以那条限制不影响它。
- **🔴 我 8/19 那条撤回本身是错的,现在改回来**:我曾报「OP-16 散包按市价 141% 买的」,后来撤回,理由是「$9.50 是拆盒推导出来的成本不是买入价」。**8/20 的取证已经证明拆盒那个前提不成立**(7 条 $9.50 的行 vendor 全是 **Discord**,而且包比盒早进门 9 天)。**所以 $9.50 是真买入价,128–142% 是真的。**
  - **但这个比值对这个货没有意义,而这才是重点**:同样这些包我们**实卖 $12.16–12.59 = 同一个 TCG 市价的 168%**。**TCG 不是我们成交的那个市场。** 所以 ≥105% 那句话已经改成「除非这也是我们卖得高于 TCG 的货」——**一句会误描述自己那个数的提示,会教人以后不看它**。
- **判定分四种,「查不到」永远不算通过**:`priced` / `ceiling`(`buy_rules` 有规则才给结论)/ `unit_mismatch` / `unpriced`(点名要钉哪个) / **`source_down`**(TCG 连不上 —— **绝不并进 unpriced**,「没查到」读成「没有」正是 130point 把 $36 的盒报成 $11,922 的来路)。

### ✅ 8/20 百分比已做进「录入的当下」(Gary:「可以给他们 buy record 的时候可以给个%」)
- **不是事后播报,是买手在 Purchased Items 打价的那一刻就看到**。和现有制度一致 —— 买入和转库是唯一有人真的拿着实物的时刻;事后只剩一个没人能核的数字。
- **是提示不是闸门**。旁边那个 `costSanity`(1/3–3x 硬拦)问的是「这是不是打错了」,**99% 市价不是打错,是买贵了,一个阈值答不了两个问题**。真会拦货的上限仍然只在 `buy_price_rules.json`,是 Gary 一个产品一个产品定的。
- **✅ 8/21 已发版(Gary:「buy request = buy record please show % in the report」;`5c6cbae` 推 main)**:`src/lib/marketPct.js` · `useMarketPrices.js` · `api/market-prices.js` · `PurchasedItems.jsx` 成本框下一行 + **Lark 卡片 marketClause**。**Codex 三轮**:一轮 6 条(2 条真 blocker:①价源挂掉被压成「没有市价」——已改 `feedDown` 独立状态,表单/卡片都印「market feed unreachable, not checked」,**source_down 永不并进 unpriced** ②Lark 卡丢了 pinned/asOf——模糊匹配现在带「(match not verified yet)」上卡、超 7 天印「market read N days ago」;另修 Infinity 防护 + **服务端自己复核 [20,300] 区间,不信客户端的 state 标签**);二轮 2 条(**pct 改传原始值**——取整后 19.6→20 会溜进区间;mismatch 分支也带 not-verified 标注);三轮 SHIP。测试 40→57+69。⚠️ 一轮里「unit_mismatch 印了句中百分比」不是缺陷——「either 3750% or 装了它 38 个」的二选一句式正是 8/20 定的设计,是我在审查提示里把不变量说过头了。
- **必须走 `costSanity.unitCostOf(item, toUsd)`** —— 它同时处理**「每件/总价」开关**和**币种**。少了换汇,¥18,000 一盒对 $153 的市价会读成 **11,765%**。
- **🔴 单位那道闸门和 Python 那边是同一套**(`[20%, 300%]`),而且**测试直接读 `buy_market_check.py` 校验常数有没有漂**。变异测试:关掉闸门 → **12 条红**,而且买手会看到 **「3752% of the $2.50 market — above market」**(垃圾袋)· **「2% of the $90.00 market」**(散包对盒,读起来像捡到宝)· **「11760% — above market」**(忘了换汇,告诉买手他巨亏而他没有)。
- **🔴🔴 顺带查出一个存在很久的洞:`lv-slabs.luckyvault.us` 一个 CORS 头都没有。** 用无头 Chromium 实测,跨域 fetch 直接 `TypeError: Failed to fetch`,原始响应里也确实没有 `Access-Control-Allow-Origin`。
  - **所以 `useProductImages.js` 那 319 条一直在返回 `{}`** —— 它**故意静默降级**(「pages render unchanged, with no thumbnails」),所以没人会发现。而**另一半 `products.image_url` 这一列根本不存在**(PostgREST 400,那条 DDL 还在积压里)。**两半都是死的,全库产品缩略图现在一张都不显示。** 这条在页面控制台里直接看得到,截图那一轮打出来了。
  - **修法没有去碰 8081(slabs)**,而是在本仓库加了 `api/market-prices.js` 服务端代理(服务器对服务器没有 CORS),照 `singles-price-detail.js` 的边缘缓存写法。**缩略图那条一行就能一起修好(把 URL 指过来),故意没做** —— 那是另一个功能,夹带进来就没法单独判断这次改动。
- **🔴 截图当场抓到一条断言看不见的**:140% 那条警告原来用琥珀色,**而这个页面从头到尾都是金色**(每件/总价开关、总价、提交按钮),它读起来不像警告,像又一个强调标签。**已改成红色 chip。** 这就是 8/13 那条「发版前必须自己打开截图看」的第二次兑现。
- **五个状态在真页面上逐个验过**(`scratchpad/shot_purchased_items.py`,vite preview + 真 feed):`85%` · `90%` · 垃圾袋 **「no market price — not checked」不给百分比** · OP-13 blister **97% 且没有「match not verified」**(它是钉过价的)· 140% 红条。**控制台零错误**(除了上面那两个既有的 CORS/400)。
- **feed 是 `buy_market_check.py --publish stocked` 写的**,落在 `slab-inventory/data/kaitori_board/market_prices.json`(**实测和公网那份 `product_images.json` 字节完全相同,确认就是被服务的那个目录**)。280 个产品 / 178 个有市价(64%)。**已挂进 05:40 日巡**(排在日巡前面、失败不影响日巡 —— 价旧了只是提示降级,日巡挂了是瞎一天)。缓存增量:第二次跑 **0 次取价**。
- **陈旧不许冒充实时**:超过 7 天的价会印 **「market read N days ago」** 并降掉「确认」的绿色。**这是汇率那个 bug 的教训写成代码** —— `convertToUSD` 四个月没人发现,就是因为从来没有东西说这个数多老了。
- **⚠️ 而 `convertToUSD` 现在仍是写死汇率**(8/13 那个修复至今未发版,`api/fx-rate.js` 在 main 上根本不存在),所以**日元线的百分比会带 6.7% 偏差**。Frank 买的是美元,这个表单上基本不咬人,但要知道。
- **⚠️ 36% 的产品没有市价** —— 这些行明写「no market price for this product — not checked」,**绝不印 0%**,也绝不让一行看起来被核过而其实没有。

## 🚨 铁律:**每个 SKU 必须写明「一件是什么」**(Gary 8/19:「sku 需要 unit」)
**这三天每一起事故都是同一个病根:行上有一个数,但没有任何地方说这个数在数什么。**
```
8/18  (In Bag)      packs_per_box=null → 下游读作 1 包,实际 30 包        30 倍
8/18  (Case)        消息印成 "1 box (case)",一箱装的是 12 个盒          12 倍
8/19  Collection Box 拆出的散包账上 1,248 包,实际只买过 134 个盒 × 4     2.3 倍
8/11  TikTok        倍数藏在 `sku_name` 文本里("10 Pack Bundle")       10 倍
8/11  TikTok        裸数字的 sku_name 是坑位号不是数量                   84 倍
```
- **这不是五个 bug,是同一个 schema 缺陷发作了五次。** 每次都是几十倍量级,而且**钱永远是对的**(总价对、银行对),所以任何金额级对账都抓不到 —— 和 OP-09 那笔 `530×$2` vs `2×$530` 完全同一形状。
- **要求两列,不是一列**:`unit`(这一件是 pack / box / bag / case / blister)+ `base_units`(它含多少个最小单位)。**`packs_per_box` 只回答了第二问,而它在袋子和箱子上答的还是错的** —— 因为第一问没人问。
- **`unit` 不许留空,也不许猜。** 猜不出来就**挡住入库**并点名(照 8/18 那条「去掉静默回退 `|| 30`」的先例)。**静默默认成 1 正是这五起事故的共同执行路径。**
- **落地顺序**(还没做):① 先在 `products` 上补两列(需要 DDL,走 dashboard SQL editor)② 加产品/加变体表单强制选 `unit` ③ 所有读 `packs_per_box` 的地方改读 `base_units` ④ **`scratchpad/ppb_sanity.py` 那把「盒的每包成本必须高于散包」的尺子扩成 unit 校验** —— 它 8/18 就自动抓出过两个 30 应该是 10 的行,是现成的自动查错器。
- **在补上之前,任何按件数算的结论都要先问一句「这一件是什么」。** 8/13 日本仓那个 7.5 倍虚高、今天这个 2.3 倍虚高,都是没问这一句。

## ✅ 8/19 SKU 统一已做完三笔(Gary:「我们要统一sku o需要修正」/「这个就是sleeve 我们改一下」/「kami是op15 我们需要更新一下sku」)
- **OP-16 散包**:`5080eecb`(零查重造的重复名 SKU)并进 `b6e1a0ee`,132 包移过去。
- **OP-15 / Kami 散包**:`1928690c OP-15 Kami's Adventure Booster Pack` 并进 `3a468a57`,幸存者按家族规范改名 **`[EN] OP-15 Adventure On Kami's Island Booster Pack`**,两个旧名都吸进 `aliases`。成本用**加权平均且排除 $0.00 的未知行**(我第一版直接继承幸存者的成本,是错的)。结果 98 @ $9.50(Master)+ 2 @ $0.00(ebay2)= 100 包。
- **sleeved 认领**:`[EN] OP-16 The Time Of Battle Blister Pack`(1,423 @ $9.50,8/09 进的)其实就是 sleeved,已改名。**我原先说「我们没买过 OP-16 sleeved」是错的,Gary 当场纠正。**
- **🔴 `variant` 是 CHECK 约束的枚举,没有 `sleeved` 这个值**(`sealed / single_pack / unsealed / cut_slice / in_bag / other / case`),硬写报 23514。**全库每一个 sleeved SKU 的 variant 都是 None** —— 照抄既定做法,别为一个 SKU 改约束。
- **🔴 我自己踩的两个坑,都值得记**:
  1. **`inventory.last_updated` 不是 PostgREST 自动写的,是 app 在写。** 我的脚本没写它 → `fetchOpenSurplus` 那条「盘点后账被动过就作废」的规则永远不触发 → 刚合并掉的两个 SKU 上凭空冒出 `+204` / `+22` 两条幽灵多出。**任何直接改 inventory 的脚本都必须自己盖 `last_updated`**,已补写 12 行。
  2. **名字已经 URL 编码过再走 `quote()` = 双重编码**,`%5B` 变成 `%255B`,**静默匹配零行**(不报错)。改成在 Python 里按 id 前缀过滤。

## ✅ 8/19 点货 vs TikTok API 对账(Gary:「所以说tiktok vs 点的 差多少能看出来吗」)
- **方法:拿盘点窗口去截收银机的订单行,逐 SKU 比。** 窗口用 **`count_time` 不是 `created_at`**(见下面那个坑),对照组是**没被合并过的 SKU**。
- **8/19 13:19 → 21:57 PT(8.6 小时)那一场**:
  ```
                     点出来  收银机    差    盘点/收银
  OP-13 blister         61      61     +0     100%   ← 对照组,分毫不差
  OP-16 散包           284      60   +224     473%
  Kami/OP-15 散包      354      81   +273     437%
  OP-16 sleeved          8       0     +8       -
  Lorcana                2       0     +2       -
  合计                 709     202   +507     351%
  ```
- **🔴🔴 上面这一版是拿错基准点算的,我先写的两条结论后来被 21 个 agent 的取证 workflow 全部推翻。以下才是定案(8/20):**
  - **`20:19` 那场盘点的表是在 19:50/19:59 两笔调库之前加载的** —— 它的 `expected` 报 60,而真账是 272。拿它当窗口起点,收银机就只剩 60/81。**换成真正定住货架的 `04:49` 那场,账立刻平了:**
    ```
                    04:49在架  调入   TikTok卖   应剩   21:57实点    差
    OP-16 散包         132     296      291     137     144       +7
    OP-15/Kami 散包     60     294      353       1       0       −1
    OP-13 blister       37      63       98       2      39      +37
    ```
    **707 件写掉,API 说全卖了。就是一个特别大的销售夜**,而账没有别的途径知道 —— TikTok 销售不扣库存,`platform_sales` 从 7/27 起零行。
  - **❌「两个重复 SKU 把同一堆数了两遍、账虚高 2.3 倍」是错的,而且 2.3 这个数我和五个审计员都复现不出来 —— 当成编的。**
  - **❌「那 1,248 包是拆 Collection Box 来的」也是错的**,五条反证:7 条 $9.50 的进货行 vendor 全是 **Discord**(拆盒没有供应商)· 其中一条是 **1,423 个 sleeved 包**(sleeved 不可能从 2+2 的盒里出来,所以 **$9.50 ≠ $38÷4**)· 全表 746 行进货里 $38.00/件的只有 4 行 132 件 · **时间顺序决定性:300+300 包 8/07 收货,第一个 Illustration Box 收货是 8/15 —— 包比盒早进门 9 天。**
- **教训**:`expected_qty` 是**页面加载那一刻的快照**。挑错了盘点当窗口起点,就会得出一个自洽但完全错误的缺口。**选窗口起点前,先确认那场的 expected 和当时的真账对得上。**
- **🔴 `count_time` 和 `created_at` 差得能改结论**:120 场盘点中位差 0.19 小时,**但有 3 场超过 8 小时,全在 Packheads、基本都是 Yaz(一场 67 小时、一场 15.5 小时)**。我先用 `created_at` 得出「OP-16 点货只看到 50%」,换 `count_time` 变成 3,867% —— **是拿 Lorcana 定的案**:Yaz 那场的 Lorcana 数(33)在 15.5 小时的**归档窗口**上和收银机分毫不差,证明她是**归档时才数的**,`count_time` 打错了。**对照 SKU 是唯一能分辨「窗口错」和「货真丢了」的东西。**
- **🔴 我自己的扫描器中过 Marvel 那个陷阱**:`_count_error_sweep.py` 把**没映射的 SKU 当成「什么都没卖」**,于是把差额报成 $13,595。加 `MAPPED_PIDS` / `unmapped_sku` 之后,**真正可核对的缺口是 3 行 / 15 件 / $2,930**。**没映射 ≠ 没卖,这条和「查询挂掉 ≠ 0 on hand」是同一条。**
- `listing_stock_audit.py` 加了 `oversell_gap` / `unmapped_live` / `slot_live` 三个桶:**40 个在售 listing / 1,404 件完全没有 SKU 映射**,最大两个正是 Kami's Island 和 OP-16 散包。**map 的 key 要从 listing 改成 `(listing, sku_id)`** —— 一个 listing 底下挂着多个 sku。
- **`apply_orders_to_inventory.py` 第 8 条缺陷(新)**:它按 listing 取一个**固定倍数**,而同一个 listing 底下不同 sku 的倍数不同 → 实测会把 889 件扣成 436 件,**少扣一半以上**。上线前必修。

## 🔴 8/20 singles 两个 bug + 团队自助报障(Gary:「系统有说报错了 / 他们现在 label 没有名字 只有 cat / 能不能让他们后台直接提交一个 ticket」)
- **报错那个是一行日志**:`job e47ba141b12c`(92 张)FAILED,`[sheet_streamer] gid 反查失败 (HttpError) — 用传入的名字 'New Singles'`,3 秒后 `Unable to parse range` 死掉。**33 秒后同一批重交就成功了。**
  - **病根不是 Google 抖了一下,是回落的目标本身是错的。** 真 tab 名是 `New Singles `(**尾部有空格,手册 8/11 记过**),job 里存的是没空格那个 —— **`_resolve_tab_name` 存在的唯一理由就是那个名字不对,失败时却回落到它**。那不是 fail open,是 fail broken:保证 3 秒后死,还附一句没人看得懂的错误。
  - **已改**:重试 3 次 → 用**上次成功反查到的名字**(落盘 `data/tab_names.json`)→ 都不行就**明确拒绝并说明为什么不回落**。三条路径都实测(正常/API 挂但有缓存/API 挂且无缓存)。
- **🔴 标签「只有号码没名字」是一个 `elif` 分支**。两条路都会打 `price_source=csv_export`,但只有一条补名字:
  ```python
  if not data:                        # 抓取彻底失败 → 名字/套/稀有度/价格全补 ✓
      data = csv_fallback_card(row)
  elif not data.get("market_price"):  # 页面「加载了」但没价 → 只补价格 ✗
      data["market_price"] = csv_px   #   名字保持抓取结果 = 空
  ```
  **8/20 两批 154 张全走第二条**:页面加载了但解析出来是空壳(名字空/套空/稀有度空/价格空),于是只有价格被补,标签上只剩 `285/217`。**而 CSV 里一直写着 `Mega Scrafty ex - 285/217`。**
  - **修法照抄 eBay 那条教训:「有卡但一条标题都解析不出 = 改版,不是没有结果」** —— **页面解析不出名字就判定为抓取失败**,走整条兜底。46 个原有测试全过。
  - **已补救 8/20 那 154 张**:`backfill_tsv_from_csv.py` 补 TSV(备份 `.bak_08201231`),再用 **webapp 自己那条 `python -m scripts.print_labels` 路径**重渲染 PDF(旧的留 `.bak_namefix`)。**⚠️ 我第一次直接调 `render_pdf` 用的是另一个默认版式,尺寸掉了 5 倍才发现** —— 补渲染必须走线上同一条命令。其中一张 **$1,094.11 的 `Pikachu with Grey Felt Hat` 原来只印了 `085/`**。
  - **⏳ sheet 上那 154 行仍带坏名字**(TSV 和 PDF 修了,表格没修)。
- **✅ 新 `webapp/tickets.py` + `/tickets` 页 + 批次页底部的报障框**。团队只写「看到了什么」,**日志、报错、以及对自己产出的体检报告全自动附上**;新 ticket 推 Gary 的 Telegram。
  - **🔴 但 ticket 是小的那一半。今天这两件事团队根本不需要解释,是没人在看。** 所以**批次跑完自己检查自己的产出**(`scan_job`),明显不对就**自己开单**。判据**故意只留三条**(全部/超 20% 标签没名字 · 超 20% 没价格 · 报 DONE 但产出读不出来)—— 会乱响的自检等于没有。
  - **两个方向都实测**:拿 8/20 修复前的 TSV → 自动开单「53 张里 46 张只有卡号没有卡名」;拿修复后的 → **一声不吭**。
  - 端到端在 **8099**(不是 8080、更不是 slabs 的 8081)跑通:无密码 401 → 带密码 200 → 提交 303 → 清单页显示自动抓取的证据;**测试单已删净**,按 PID 杀临时实例,重启线上,**8081 全程未被碰**,公网带密码 200。
- **✅ 日巡那条铁律2 告警之前一直在误报**(`count sold 731 > tiktok 253`)。两个 bug:**倍数没算**(`5 PACKS` 当 1 件)· **窗口用 `count_time`**(手打的,错过 67 小时)。现在改用 `created_at`、按单位词算倍数,并且**只有在「没有归不到 SKU 的行」且「窗口内没有调入」时才真报警**,否则打「比不了」并说清是什么挡住了比较。

## ✅ 8/20「Frank 说他转了」查实:他转了,而且不是共用登录(Gary:「所有 manager 包括 frank mario 都可以挪」)
- **Frank 说「那天一共转了 35」——** 全月 8/01–8/20 每人每天调入 Packheads 的总数里,**35 只出现过一次**:`08-18 PT 17:36 x29(Master)+ 17:44 x6(Front Store)= 35 片 OP-13 blister`。**数字分毫不差,他是对的。**
- **🔴 但我第一版判成「他用了 Eric 的登录」是错的。** 查代码:**`MovedInventory.jsx:795` 有一个 `Moved By *` 下拉框(required),`StreamCounts.jsx` 的 `counted_by_id` 同样是选的。** 名字是**填表人从名单里挑的**,不是会话身份。所以那 35 片记成 Eric,要么是 Eric 真替他做了(记录就是对的),要么是挑错了名字。**已在第二条 Telegram 里向 Frank 更正。**
- **反证很硬**:123 场盘点里 **117 场(95%)记在 `can_login=False` 的账号名下**(Yaz/Trey/JV/Brandon 根本登不进 app)。**共用登录解释不了这个,下拉框可以。**
- **✅ 所以按人算的那几张表没被污染**,而且比会话身份更可信(名字是主动挑的):盘点员记分卡的班次也对得上 —— **Yaz 集中 5–14 点、Trey 集中 14–22 点**,是真实排班带;「一个人十分钟内数两个房间」全期只有 1 次(Rob 7/04,8.3 分钟)。
- **✅ 已开放 Telegram 转库给所有 manager(`lv-finance/tg_move.py`)**。**关键改动是删掉 `--who` 的默认值 `aldo`** —— 网页有下拉框、Telegram 没有,原来任何人从 Telegram 转库都会静默变成 Aldo。现在**不给身份直接拒绝**,优先用 `--chat <TG id>`(助理绑在谁的对话里就只能以谁的名义写)。
  - 身份来自 `data/tg_members.json` 新增的 **`app_user_id`**,**故意不复用 `acquirer`** —— 那一列答的是「谁买的」,拿它答「谁搬的」就是这两天一直在治的「一列两个意思」。今天两者对 Frank/Mario/Hwa 恰好同值,但它们是两个问题。备份 `tg_members.json.bak_0820`。
  - 写库前**回查 `users` 表**(id 存在、active、名字对得上);**Gaoyuan 没有 app 账号 → 拒绝,绝不回落给别人**。5 项实测全过(不给身份/Frank/Mario/Gaoyuan/未登记 chat),dry-run 零写入。
  - **`tg_moves.jsonl` 全表只有 2 行,而且是 8/18 的自测(转出去又转回来)** —— 在此之前 Telegram 这条路一次都没真用过。

## ✅ 8/20 多出「点名」已挂进 05:40 日巡(Gary:「先1」)
- **病灶不是「多出不写库」那条规则,是它没有出口。** 规则是对的(误数写高会永久毁真货),但**被丢弃的数字不写到任何地方**,所以只有碰巧有人在查才会被发现 —— 8/19 那 63 片 blister 就是这么救回来的。
- **🔴 先纠正我自己报过的数**:「7/24 以来丢弃 3,624 件」是**原始数,没过销案规则**。加上两条规则后**真正还挂着的只有 12 项 / 278 件 / $9,664**(自动销案 47 项)。**原始数吓人但没法用,加了规则才是能干活的清单。**
- 新 `inventory-sync/surplus_rollcall.py`,每条带 **多久了 · 谁数的 · 报了几次 · 该做什么**,按天数排。销案沿用 8/06 那两条:**R1 账追上了**(比此刻的 inventory,不比当初的账)· **R2 盘点后账被动过 = 观测过期**。**查询失败是第三种状态,永不当成「已销案」。**
- **两类处理方式完全不同**:**A 记一笔 Move 就好**(别的房有货,总数一件不变,可以放心做)· **B 查无来路**(全系统都不够,**明写「别调库存」**,补了就是编数据)。
- **上限规则照抄 8/12 那条:最大的那条永远不许被挤掉。** 而且 **A 按件数、B 按金额** 排 —— B 问的是「多少钱没有解释」,23 个 Marvel 盒($2,737)比 24 个 Paldean 散包($470)重要。
- 已进日巡(`--no-surplus` 可关,整段包 try,**失败时明写「这一节没跑成,不代表没有挂着的」**)。实测正常路径和故障路径两条都对,全量日巡 `EXIT=0`。
- **⚠️ 日巡自己那条铁律2 告警现在是误报**:`08-19 Packheads: count sold 731 > tiktok 253 units`。我们已经证明真实是 **707 写掉 / 757 卖出**;日巡的窗口和倍数处理和核实过的那套不一致。**会喊狼来了的告警比没有告警更糟,待修。**

## 🔴 8/20 取证 workflow(21 agent / 4.2M token)顺带挖出的 8 条,全部独立复核过
- **🔴 正差从 2026-07-24 起就不写库存了。** `StreamCounts.jsx:507` 的 `if (item.difference < 0)`,commit `7028e69`。实测 964 对连续盘点:**正差 7/24 前 31/31 全写、7/24 后 3/40(7.5%)· 负差两个时期都是 100%**。**手册以前那句「差值直写库存(正负都写)」现在只对负差成立**;铁律1「多出永不写库」已经是代码行为,不再只是政策。
- **🔴 而这意味着任何「把盘点正差算进库存」的重建都是错的。** 我 8/19 那份守恒检验就中了招:按老口径残差是 −127/+662/+231/+78/+22,**按发版日期切开之后全部变成大正数 +923/+935/+236/+726/+22**,而且**没合并过没重复过的对照组 OP-13 是 +726** —— 说明残差根本不在量重复 SKU。
- **🔴 但那个残差也测不出来:37.4% 的 TikTok 订单行(9,552 / 25,536)是拍卖坑位,永远归不到 SKU**;直播拆的包离开货架时没有任何可归属的订单行。**91.9% 的行没有可解析的倍数,而订单行根本没有 quantity 字段** —— 所以**任何来自 TikTok 的件数都只是下限**。事故当晚那个窗口恰好是干净的(0 条无法解析),所以那次对账可信,**全生命周期的不可信**。
- **✅ 已修:OP-13 blister 的 $43.00 成本基准。** 16 条正常进货行全在 $16.00–$19.50(加权 $18.04),`$43` 是 8/17 19:05 翻的,**Master 后来改回 $18.25,四个直播房没跟着改**。自那以后写掉 266 片:**记 $11,438 / 实际 $4,854,COGS 虚增 $6,584**;货架上还挂着 $965 虚值。**已把 4 个房改回 $18.25**(备份 `blister_basis_backup.json`,乐观锁「仍为 43.00」,回读 4/4,**历史一条没动**)。**故意不从 acquisitions 重算** —— 有一行 `6/15 qty 1 cost 2128.00` 是填反的,重算会被它污染。
- **🔴 错的成本基准会跟着 Transfer 传进别的房,而且永远回不来。** Transfer 把 basis 抄向下游,没有任何东西反向对账。**这是一类 bug 不是一个**,全库扫过:当前只剩 2 行(`Prismatic Evolutions Booster Pack` 记 $0.95 而实付 $11.50,**8/07 就记过、至今未修**)。**这条我没写** —— $0.95 在 8 条移库记录里一致,不是两天前的翻转;而且只买过 72 件却动过 647 件,来路没查清之前改 12 倍是决定不是清理。
- **🔴 被丢弃的正差不留任何痕迹。** 决定只写负差是对的,但**丢掉的那个数没有写到任何地方**;发版后光这 79 个 SKU 就丢弃了 **1,993 件**。8/19 那 +63 片 blister 只是因为有人注意到、手工补了一笔调库才收场。**至少要把丢弃的差额记下来。**
- **🔴 `expected_qty` 是页面加载快照,过期的会静默毁账。** 8/19 20:19 那场在三笔调库之前加载,**少报了 292 件缺口,还把 80 件的缺口印成 +2 的多出**。99 对里只有 3 对能被检出,**因为表格加载时间根本没存** —— 真实发生率不可测。修法:把加载时刻盖在盘点头上,提交时若快照早于任一被盘 SKU 的移库就拒收或重算基准。
- **🔴 PostgREST 分页没有 `ORDER BY` 会静默重复/漏行。** 实测一个脚本返回 **5,648 行而只有 5,420 个不重复 id**,把一个 SKU 的盘点历史翻了倍。**我自己三个新脚本都有这个洞,已加 `&order=id`。`count_recon.py` 等老脚本还没加。**
- **🔴 Master 从来不做直播盘点。** 最大的房、可以随便手改、没有任何见证,**97% 的残差在那里**,而 `inventory` 至今没有 audit log(`add_inventory_audit_log_2026_07_23.sql` 仍未建)。**任何直接改 inventory 的操作在构造上就是查不出来的。**

## ✅ 8/19 买入价上限规则(Gary:「下次vol 7 8 高于90% buy request 我们要拒绝」/「我们更多是警告 需要approve才能入库」)
- **触发它的那笔**:`Illustration Box Vol. 7` 我们付 **$38.00**,近期成交 **$38.16 = 99.6%** —— **按市价买进,等于把利润全让给上家。**
- 新 `inventory-sync/buy_rules.py` + `data/buy_price_rules.json`,四种判定:`hold`(超上限)/ `ok` / `unrated`(没配规则)/ `unknown`(取不到市价)。**Gary 定的口径是警告不是硬拦** —— 动作叫 `approve_to_receive`,**货照收,但要人批准才入库**。
- **坑:`pct > cap` 会在 90.00% 上被浮点数判成超标**,已改 `round(pct, 2) > cap`。13 个测试全过。
- **⏳ 待定**:上限该不该套在散包上 —— OP-16 sleeved 买在 91%,但它实卖 $14.01,**散包的周转和盒不是一回事**。
- **⏳ 待接**:把 `buy_rules.check()` 接进 `intake_cost_watch.py`(服务端,不用发版)。

## ✅ 8/19 拆盒经济学首次算清(Gary 连问「他们实际能卖多少钱」「我们卖多少钱」「毛利是多少」「扣除tiktok手续费实际赚多少」)
```
一个 Collection Box $38.00  →  2 包 OP-16 + 2 包 OP-15(Gary 确认的配比)
四包实卖合计            $51.50
毛加价                  +36%
扣 TikTok 6% 手续费后   净毛利 ≈ 22%
```
- **🔴 我据此纠正了自己两个错判**:① 我曾报「$5,928 被重复入账」,理由是 OP-16 和 Kami 两个 SKU 上出现完全相同的 398/16/210 和日期成本 —— **Gary 指出一个盒出 2+2,数量本来就该一模一样**。`$38 ÷ 4 = $9.50` 和三行全部对得上。**撤回。** ② 我曾报「OP-16 散包我们按市价 141% 买的」—— **$9.50 是拆盒推导出来的成本,不是买入价**,而它实卖 $12.16–12.59。**撤回。**
- **顺带查出一个更值钱的数:折扣是我们自己给的。** 三周里 `seller_discount` **$2,031(13.1%)是我们自己打的折**,TikTok 出的 `platform_discount` 只有 **$169**。**「担保价 $11.99」不是平台压的,是我们自己挂的。**
- **⏳ 待补**:11 个 Illustration Box SKU 的 `packs_per_box` 还是空的(只有 2 个写了 4)。**这正是上面那条新铁律的第一个作业。**

## ✅ 8/19 TCGplayer 价源修复(Gary:「cloudfare 我们有本地解的方法」/「tcg换个proxy试一下」)
- **病根是办公室 IP 被封,不是代码坏了。** `slab-inventory/app/scrapers/tcg_api.py` 加 `_proxies()` 读 `inventory-sync/data/tcg_proxy.json`(socks5,27 个出口,`random.choice`)。**改动是加法的** —— 配置文件不在时行为完全不变,因为 slabs 也在用这个模块。
- **`erp_pricing.py` 加 `SOURCE_DOWN` 计数 + 独立标记 `TCG_SOURCE_UNREACHABLE -> price UNKNOWN, do not read as no-match`。** **「取不到价」和「这个品没有价」必须是两个答案** —— 混成一个正是 130point 那次差点写出「这些品没有成交数据」的来路。
- 验收:6 个钉了 id 的产品**全部恢复出价**。

## ⏳ 8/19 还欠的两件事
- **给群里发那份 correction report**(Gary:「我们群里发个correction report」)—— 稿子写好了,**等 Gary 定发哪个群**。
- **Frank 的买取记录在「buy record」群**(Gary:「frank的买取记录应该在buy record群聊里面」)—— **我们那个自建 Lark 应用现在看得到的群是 0 个**,连原来的 BACKEND CORE 都不在了,**读不到**。两条出路:把应用拉进那个群,或者我走 AdsPower(`k1bkorhr`,Gary 本人的 Lark)去读。

## ✅ 8/19 加产品零查重已堵上并发版(Gary:「frank或者aldo 买入 以及转库的时候发现没有sku 就开始做sku 或者prompt match sku」;**Codex 4 轮,已发版**)
- **触发时机他定得对**:买入和转库是**唯一有人真的拿着实物**的时刻。事后对账只能说某个数不对,永远还原不出那是什么货。
- **但同一个时刻也正是重复 SKU 的生产线** ——「找不到就新建」就是现有那批重复的来路。所以顺序必须是**先匹配、后新建**,不是反过来。
- **趁现在装锁最便宜**:实测 813 个产品,名字撞车 7 组 / 14 个,**两边都有库存的 0 组**。不是在收拾烂摊子,是在把「新建」权限交给更多人之前先补上。
- **新 `findSimilarProducts(name, {brand, language, type, variant})`** + **`createProduct` 加 `confirmedNotDuplicate`**(有候选就抛 `POSSIBLE_DUPLICATE`,error 带 `candidates`)。`createProduct` 原来是**裸 insert**,四个创建入口全走它,**改一处全堵上**。新 `src/lib/duplicateGuard.js` 的 `createProductChecked()` 统一弹提示;**取消 = 正确结果**,四个入口都不再报成失败(报成失败会教人下次直接点 OK)。
- **🔴 匹配规则是被真数据打出来的,前三版全是废的 —— 拿全库 813 个产品逐个模拟「今天有人打这个名字会看到什么」**:
  ```
  第1版 按名字相似度            → 触发 50.4%   废
  第2版 加形态签名              → 32.7%
  第3版 Jaccard + 剥品牌词      → 16.1%
  第4版 sleeved/ETB 进签名      →  8.2%
  第5版 变体不同 = 直接不是      →  3.2%   ✅
  ```
  - **50% 那版的病根**:同一套的 `Booster Box` 和 `Booster Pack` 只差一个词,**按文本算 83% 像**,而那是全目录最常见的一对。**包装词必须是决定性的,不能当成相似度里的一票。**
  - **相似度不能除以短的那边**(`min()`)—— 那会让任何短名字匹配上所有包含它的长名字(`Astral Radiance Booster Box` 撞上 `Elite Trainer Box`)。改成除以并集。
  - **品牌词要剥掉**(品牌是独立列)—— 不剥的话 `Pokemon 151 Tin` 和 `151 Tin` 看起来只有一半像,**真重复反而漏掉**。
  - **`sleeved` / `elite trainer` / `PC` 不是装饰词,是定产品的** —— 当噪音剥掉会把 `Journey Together Sleeved Pack` 报成那 459 个散包的重复。
  - **两个已知且不同的 `variant` 直接判定不是同一个** —— 有膜和无膜是故意分开的两个 SKU,变体表在这件事上比名字权威。
- **白捡一份东西:这 3.2%(26 个 / 13 对)就是目录里现存的重复清单** —— `151` vs `Pokemon 151` · `Fusion Strike` vs `Pokemon Fusion Strike` · `Chaos Rising Booster Box` vs `Booster Box Booster Box` · `Evolving skies` 两份 · `OP-13 Carrying On/on His Will` 大小写两份 · `Adventure on KAMI's Island (Cut Slice)` 带不带 `[JP]` 两份。**其中 `151 Booster Pack` 148 件 vs `Pokemon 151 Booster Pack` 0 件是唯一有库存的一边。**
- **测试 16 项跑真函数(只桩掉 supabase client)**,一半在验「什么时候必须闭嘴」:EN/JP 不许互指 · bundle 不是 box · 全新套不弹 · 空名字不弹 · **查询挂掉时 fail OPEN 返回空**(这是守卫不是闸门,查询故障不能挡住收货)。**变异测试证过会红**:关掉守卫 → 3 条失败。
- **✅ 13 对重复已合并 11 对(Gary:「合并」)**。**每一个被合并方库存都是 0**(写入时校验,不是假设),所以这次只动身份不动货。做法:**幸存者吸收对方的名字进 `aliases`**(否则合并之后那个东西比合并前更难搜到)· 被合方 `active=false` + `aliases` 打 `MERGED_INTO:<id>` 标记。**行不删**(永不删产品行),**历史一条不改**(acquisitions / movements / 盘点 / 销售记录的是发生过的事,卖出行永不回改)。回读 11/11 × 3 项。
  - **顺带修了守卫一个真洞:它会把已停用的死 SKU 当候选推给人** —— 那正好和合并的目的相反。加了 `active === false` 跳过(**只跳明确的 false**,没设过的不算)。合并 + 这条之后触发率 **3.2% → 1.5%**,而剩下那 12 个正是「打了旧名字 → 指向幸存者」,是想要的行为。
  - **⚠️ 2 对故意没合,要人定**:`Adventure on KAMI's Island (Cut Slice)` —— **`[JP]` 前缀是既定规范**(7 月 164 个海贼王产品就是为此改的名),所以带前缀那个可能才是正版,合错方向会把那次改名撤销;`Eeveelutions Badge Gift Box **Set**` vs **`Single Box`** —— **可能本来就是两个产品**,而匹配器把 `set`/`single` 当包装词剥掉了,两边还都有 movements。
  - **两个幸存者仍带着重复类型词**(`Evolving skies Booster Box Booster Box`)—— 它们是有库存有历史的那一边,**改名会当场改变房间盘点清单上的字**,那是要announce 的单独动作,没顺手做。
- **⚠️ 还没做的**:买入/转库页面那个「找不到?」入口(第 3 条)和 `tg_move.py` 回带编号候选(第 4 条)。**Gary 要求分两步发**:先发这层纯保护,UI 那两条过 Codex 再发。


### 🔴 Codex 4 轮又挖出 6 条,最重的三条都是「以为数全了」
- **入口不是四个,是六个。** 手册原话「四个创建入口全走 `createProduct`,改一处全堵上」**是错的** —— `JapanAddProduct` 走 `upsertProducts`(裸 upsert,一次提交整个变体家族,**近似撞名会一键造出整族重复**)、`StorefrontImport` 直接 `.from('products').insert()`。两个都补上(`upsertProductsChecked` / `confirmNoDuplicates`),**两处的「取消」也都改成不报失败**。
- **🔴 匹配器不读 `aliases`,而昨天合并时写进 aliases 的正是要留住的旧名字** —— 一手写进去、一手不看。实测 **162 个在库产品带着被吸收的名字,里面全是中文**(`宝石4弹 原盒` → `Gem Vol.4 Booster Box`),**而那正是中国快速加产品会被打进去的字**。现在名字和每个别名都参与打分;`MERGED_INTO:` 标记不算名字。
- **CJK 整段被吞**:`[^a-z0-9 ]` 把中日文字符全删光 → tokens 为空 → 直接返回「没有相似的」。改成 Unicode 感知 + 剥掉片假名包装词(ブースターボックス/パック/ケース)。**故意不把 CJK 拆成单字** —— 库里一个纯 CJK 产品名都没有,**没有数据可校准,而没校准过的匹配器正是第一版 50% 噪音的来路**。整段当一个 token:抓得住「同一个日文名打两遍」,不会误报。
- **复数没归一**:`_FORM_WORDS` 只有单数,`Booster Packs` 的形态签名成了 `booster` 而不是 `booster+pack`,和 `Booster Pack` 判成「包装不同」直接放行 —— **我们就有这么一个名字**(`PRB2 Booster Packs`)。只归一包装词的固定表,**不做通用去 s**(那会把差一个字母的两个套合并)。
- **候选查询没分页**(815 个且在长,PostgREST 截断不报错)→ 走 `fetchAllPages`,失败仍 fail OPEN。
- **🔴 库存查询失败会渲染成 `0 on hand`** —— 这是最能劝人按 OK 的一句话(「那个是空的,我这个肯定是别的」),**而它是编的**。现在 `on_hand` 为 null,提示明写 **stock unknown (lookup failed)**。
- 测试 16 → **28 项**,噪音率仍 **1.5%**(真 815 个产品逐个模拟)。**噪音脚本自己中过招**:它的 supabase 桩不认 `range()`,守卫因此 fail OPEN,报出「触发率 0.0%」—— **一个看起来完美调校、实际根本没跑的数字。**
- ⚠️ `add_batches_and_channel_map_2026_08_16.sql` 的 4 条仍未修,**这次没跟着发**。

### ✅ 8/19 盘点消息也简化了(Gary:「这消息也需要简化」)
- 病灶全在名字:发送侧拼的是 `brand | 套名 | 形态 | 语言`,四列里三列多余。
- **品牌列去掉** —— 名字里已经写着 OP-15、Lorcana,**而且它是错的**:`OP-15 Kami's Adventure` 的 brand 写着 Pokemon(全库唯一一个错标的海贼王产品)。**一个会骗人的列不如不印。**
- **形态列留下** —— 盒/包/blister 是三个价,**今天那 $2,856 就是这一栏没分开**。
- **语言只标少数派**:算出这条消息的多数语言,只给不同的几行打 `[JP]`。**十行九行都标等于没标**(日本报告那个 `[JP]` 就是这么废掉的)。
- **重复的套名合掉**:`The Time of Battle Booster Pack - The Time of Battle (OP16)` → 保留**带编号那一半**,编号是区分两个 OP 套的唯一凭据。
- 按件数排序 · 来源房去掉 `Stream Room -` 前缀。18 项测试跑真函数 + 你贴的那条真消息。

## ✅ 8/18「(In Bag) = 垃圾袋 = 30 包」—— 一句话纠正了 8/07 的结论,顺带得到一把能自动查错的尺子(Gary:「in bag 就是trash bag那个sku 就是30包 只是没盒子」/「盒子的hit rate是比散包好的 所以价格高」)
- **8/07 我判「那 278 个是盒不是包」** —— 方向对(绝不是 1 包),东西错。**它是一整盒的包拆出来装进垃圾袋、盒子扔掉。**
- **不是信这句话,是账本自己说的。** 五个套各自独立印证 `袋价 ÷ 30` 落在「散包」和「拆封盒」之间:
  ```
  套              袋÷30    拆封盒/包   散包
  Storm Emeralda   ¥509     ¥559      ¥399
  Abyss Eye        ¥351     ¥461      ¥336
  Mega Brave       ¥280     ¥283      ¥206
  Mega Symphonia   ¥215     ¥225      ¥220
  Munikis          ¥221     ¥240      ¥200
  ```
  **一袋若真是 1 包,单包成本就是 ¥6,452–15,266 —— 散包价的 30–40 倍。**
- **`variant` 这一列早就写对了,是名字和元数据在打架**:`variant=in_bag` 共 14 个 SKU —— **11 个叫 `(In Bag)`(type=Pack,ppb=null)· 3 个叫 `(Open)`(type=Sealed,ppb=30)**。同一个东西录了两遍,一遍对一遍错。Ninja Spinner `(Open) ¥7,440/30 = ¥248` 落在散包 ¥220 和无膜盒 ¥286 之间,**钱证明 (Open) 和 (In Bag) 是同一件事**。
- **🔴 病根一行**:`JapanAddProduct.jsx` 的 `PACK_VARIANTS = new Set(['in_bag','single_pack'])` —— **一个集合在回答两个不同的问题**:「放哪个货架」(袋子确实不是封盒,归 Pack 没错)和「一件是几包」(散包 1,袋子一整盒)。因为共用一个答案,**11 个垃圾袋 SKU 全部被写成 `packs_per_box=null`,而 null 在下游读作「1 件 = 1 包」**。已拆成两个谓词(新 `isSinglePackVariant()`),**`type` 故意没动** —— 错的只有算术。
- **✅ 已写库**:6 个有货有进价的 JP 宝可梦袋 `ppb→30`(Storm 38 · Mega Brave 16 · Mega Symphonia 14 · Abyss Eye 13 · Munikis 3 · Inferno X 1),备份 `bag_ppb_backup.json`,乐观锁「仍为 null」,**回读 6/6**。
- **故意没写的 5 个**:两个海贼王袋 —— **它家族里 `(Case)` 也写着 12,而一箱装的是 12 个盒不是 12 包**,同一列在一个家族里两个意思,**抄它就是把猜测洗成事实**;Black Bolt / White Flare / Glory of Team Rocket —— **零库存零进货,没有任何东西能验证 30**。要填说一声。
- **🔴 那句 hit rate 是一把能自动查错的尺子**:「盒的每包成本必须高于散包」是市场事实,所以它是个**能失败的检验**。`scratchpad/ppb_sanity.py` 扫全库 JP:**22 个盒 SKU,3 条不成立** ——
  - **`Mega Dream Booster Box (Open)` 和 `MEGA Dream ex Booster Box (Unsealed)` 记 30,钱推出来是 10.8 / 11.9**,而**它自己的封盒兄弟早就写着 ppb=10**(高级包盒本来就是 10 包)。按 30 算,盒里的包 ¥483 而散包 ¥1,105 —— **盒比散包便宜一半,不可能**。散包价是三次独立购入(¥900 / ¥1,110 / ¥1,000),不是坏行。**已改 30→10,备份 `megadream_ppb_backup.json`,回读通过。**
  - 第三条 `Mega Symphonia (In Bag)` 只差 2%(¥215 vs ¥220)—— 袋子本来就比散包便宜一点,**30 是对的**。**这条正好证明这把尺子不是见谁都报。**
- **🔴 Codex 连审 8 轮才判干净,共 15 条真缺陷,其中 13 条是我这批引入的。** 最重的两条:
  - **P1 我把袋子设成 `breakable=true`,那会凭空造货**:BreakBox 按 `breakable` 取源(`BreakBox.jsx:49`),而 `findPackProduct()` 只按 `brand+language+type='Pack'+名字包含` 找目标、**不排除自己** —— 袋子的 type 正是 Pack,拆 1 袋会对同一个 product 先 −1 再 +30,**净增 29**。已撤回 `breakable`(**`packs_per_box` 保留** —— 你说的那件事是包数,breakable 是另一个功能,而那个匹配器处理不了 Pack 型源)。实查全库 `type='Pack'` 且 breakable 的产品 **0 个**,所以这个洞是我要造出来的、不是已经开着的。
  - **P1 `Number(form.packs_per_box) || 30` 会静默造数**:空值/0/打错一律变 30,而 **30 对 10 包的高阶套和海贼王都是错的 —— 正是今天刚清掉的那个错**。已去掉静默回退,改成挡提交并点名会写到哪几个变体。
  - 其余:日本回落只在"env 没配"时触发(配了但失效的 webhook 一样收不到)→ 改成按**实际发送结果**触发;回落 `await` 排在美国发送之前(慢 Telegram 能把美国到货预告拖到超时)→ 改成并发;四个调用方全是 fire-and-forget(`.catch` 而已)→ 三个日本页面现在会读结果并弹"日本没收到,直接告诉 Hwa";`(Case)` 印成 `1 box (case)`(**一箱装的是多个盒**)→ 单独的 case 单位;EN/JP 同名套会被合并 → 分组键加上品牌+语言,**而且只在这条消息里真的混了才在行上打标**;逐行 USD 被 `else if` 吞掉 → 两个都印。
  - **导入器 `_build_japan_sku_import_sql.mjs` 有同一个病根**(它就是造出那 11 个坏 SKU 的东西)。改成**从同套的封盒读真实包数**,读不到就**留 NULL 并在生成的 SQL 里点名**,不再一律写 30。
- **🔴 一个反复中招的陷阱,值得单独记**:`bash heredoc → Python → JS` 三层下来,**`` 到 Python 时已经是 `` 被解释成退格符(U+0008)**。它在正则里不再是词边界,于是 **`!/boxe?s?/` 这种否定断言永远为真 —— 测试报平安,但它什么都没测**。今天写坏了三条,Codex 抓出一条。已在 `jp_group_test.mjs` 顶部加守卫:**文件里出现字面退格符就直接 abort**,并对 case 和双袋两组断言各做了一次变异测试(故意改坏代码,确认测试真的会红)。**以后这条管道里的反斜杠一律用 `chr(92)` 构造,不靠小心。**
- **又补审了分支上那笔 8/17 收银台修复(`5d2e87a`,手册记着「未过 Codex」)** —— 不能借今天这批把它夹带出去。连它一起再审 3 轮,又改 6 条:**Lark 拒收消息时返回的是 HTTP 200 + body 里的错误码**(`{"code":9499}` / `{"StatusCode":19001}`),我按 `r.ok` 判成功 = 把「被拒发」记成「已送达」,而回落和弹窗都挂在这个判断上 · 预填的 30 会直接走过我新加的校验(字段永远不空)→ **默认值删掉,包数必须手打** · 导入器 `ON CONFLICT` 不写 `packs_per_box` → 加 `COALESCE`(**只填空的,绝不覆盖人填的**)· `ex` 只在包装词前被剥,`Terastal Festival ex` 会和 `Terastal Festival ex Booster Box` 裂成两行 → 统一剥 · 导入器读产品**没分页**(811 行,离 1000 不远,`/slabs` 就被这个坑过 1500 行)· **发货页只检查日本那个收件人** —— 日本收到了但美国入库群没收到时页面一声不吭,**而那正是「包裹到了 LA 没人知道」**。
- **🔴 最后一条是我自己的误报,值得记**:Lark 失败但 Telegram 成功时,Hwa 其实收到了,页面却还在喊「没送到」。**日本是一个受众、两条路**;回落成功就该顶替掉失败那条,而不是两条并列。**会喊狼来了的告警比没有告警更糟** —— 这本手册通篇都是这个教训。
- **🔴 8/18 实测:token 这条路 Gary 拿不到(「还是没办法拿到」)。但 DDL 不是只有那一条路 —— 后台自带 SQL Editor,不需要任何 token**:`https://supabase.com/dashboard/project/dqreqevbjszercgackuc/sql/new`,粘贴、Run。**手册之前把「没有执行路径」写得太绝对了** —— 缺的是**自动化**执行路径(脚本自己跑),不是执行本身。9 张积压的表同样可以走这条,只是要人点一次。
  - 已备好 `scripts/allow_unknown_date_acquired_2026_08_18.sql`:一条 `ALTER TABLE singles ALTER COLUMN date_acquired DROP NOT NULL;` + 验证查询 + 回滚(**回滚会在有 NULL 时主动失败,这是对的**)。**不改任何现存行**;去掉 NOT NULL 不会重写数据。
- **⚠️ 明确不改、留给你定的一条**:Codex 连三轮坚持 `_recoverSoldSingle` 不该把收银台那天写进 `date_acquired`(它在 SinglesInventory 上直接显示,还参与 `fetchBestSingleIdentity` 的日期排序)。**它说得对,但正确的修法要 DDL** —— 那列是 `date NOT NULL`,「留空」和「加一个 observed_at 列」都需要建表权限,而我们没有(没有 service key、没有 William)。**写回 null 就是把 8/17 那个 bug 原样装回去。** 通了 Supabase access token 就能真修。
- **⚠️ 导入器不会回头修已存在的坏行**:它对已匹配到的 SKU 走 `updates` 分支,新加的「读同套封盒」只对新插入的生效。**那 6 个有证据的已经直接写库改好了**,这里不重复声称。
- 测试从 21 → **54 项**,`npx vite build` 通过。**⚠️ `scripts/add_batches_and_channel_map_2026_08_16.sql`(不是今天的东西)被连带审出 4 条**:slot 行 `product_id NOT NULL` 让拍卖坑位根本插不进去 · `ON DELETE CASCADE` 会硬删映射(违反软删铁律)· `confidence='verified'` 不要求 verified_by/at · `updated_at` 没有触发器。**待定。**
- **消息侧同步修了**:`jpItemLines` 现在把袋子按 bags 计,`Storm Emeralda — 10 bags`(原来印 `10 packs (in bag)`,**而那是 300 包,面子上就是 30 倍的错**)。**故意不印包数** —— builder 只拿得到名字和数量,而我们自己的目录对海贼王的 ppb 自相矛盾,**能修的是单位,不能顺手断言一个它看不见的数**。测试 37 项全过,其中一组专钉「袋子永远不许印 packs / boxes」,**而旧断言正好是在要求这个 bug**(它写死了要 `10 packs (in bag)`)。

## 🔴 8/17 门店"扫码说已卖出":8/07 那个出口从上线起一次都没成功过(已修,**未过 Codex 未发版**)
- **群里 Hazy 16:53 原话**:"since we are using safari it creates an error saying it's been sold on. And it still adds it but then it shows this" + 一张截图。**Gary 16:51 问 "bar code no working?",17:0x 回 "fixing system checking"。**
- **截图上是红条,病根直接印在上面**:`$40.00 charged but NOT recorded — tell a manager before the next sale. / Charged $80.00, recorded $40.00 of items. / Dendra — null value in column "date_acquired" of relation "singles" violates not-null constraint`。购物车那行是 `Dendra #266/193 · ⚠ app had this SOLD — booking a new line`。
- **`singles.date_acquired` 是 `date NOT NULL`(create_singles_table.sql:97),而 `_recoverSoldSingle` 把它连同成本/来源一起写成 null** —— 那个 null 是 8/07 故意的(不许把同一笔进货的 COGS 记两遍),但 `date_acquired` 跟着一起 null 就是每次 insert 都被 Postgres 打回。
- **实测确认它从来没成功过:全库 `sale_notes ~ RECOVERED_AT_COUNTER` = 0 行。** 这条出口 8/12 合进 main,5 天后今天第一次有人真的走到,**一次尝试一次失败**。
- **修法:`date_acquired` = 收银台那天,不是抄 sold 行的进货日。** 抄它就等于断言"这一张来自那笔进货",而那正是上面把成本留空所拒绝断言的事;**收银台那天是唯一能证明的事实**。写在 `...saleData` 展开**之后**,让以后任何 payload 形状都塞不回 null。`sale_notes` 里明写「这个日期不是进货日」—— 不写,下一个人就会把它当进货日读。
- **成本/来源仍然全 null,测试把这条钉死了** —— 修一个洞的时候顺手撤销另一个决定,以后就分不清哪个是对的。
- `scratchpad/counter_recovery_test.mjs` **39 用例跑真函数**。要紧的是:**NOT NULL 列是从 `create_singles_table.sql` 解析出来的,不是我手写的清单** —— 只钉 `date_acquired` 会让下一个漏列以完全相同的方式再来一次。**拿改之前的文件跑同一套,正好挂 4 条**(不会失败的测试等于没测)。
- **代价有界**:8/1 以来所有"收款 ≠ 记账"的纯销售单只有 **2 笔**,其中 8/14 那笔差 **$0.02** 是分摊取整,真缺口只有今天 **tx `64951833-d0ae-470f-aeb0-cedeb076f5b4`:收 $80.00,记 $40.00**。
- **⏳ 那 $40 没补**:Hazy 说"$80 for destined rival and $10 card",和收款 $80 对不上;**群聊里的金额永远不能直接改库存**。Dendra 只有一行 `4cf7cfbb`(6/12 卖出),**一个字没动**。要门店说清第二件是什么、多少钱。
- **红条那句原始 Postgres 错误别包装掉** —— 正是它让这个 bug 从一张手机翻拍照片上五分钟定位。
- **⚠️ 已知没动**:`singles_graded_quantity_one` 那条 CHECK 会拒绝 `form='graded'` 且 qty>1 的恢复行(sold_override 之后不再问"超过库存"那一问)。**全库 3,173 行 singles 全是 raw、graded 0 行**,所以今天碰不到;没有为一个不存在的行改行为。

## 🔴 8/13 singles 停摆 + "66 张只打出 7 张"(Gary:"singles 又down了 而且labels generate 少了 你看看storefront 群聊")
- **群里 Sully 8/13 10:30 的原话**:"We have 66 labels we're trying to print from list but it's only letting us print 7" + "Website is also down for singles";12:17 又追 "still down"。**我 12:22 把服务拉起来,时间对得上。**
- **服务这条**:`out/webapp.log` 里 `==== webapp start Wed 08/12 9:29:00 ====` 之后一个 `^C` —— **进程被 Ctrl+C 干掉,从 8/12 09:29 死到 8/13 12:22**。而且当时 **cloudflared 一个进程都没有**,两条隧道(singles + slabs)全断,`LV Slabs Webapp` 还活着但公网不通。三个任务全部 `result=3221225786`(被终止)。已 `Start-ScheduledTask` 拉起 `LV Singles Webapp Fixed` / `LV Singles Tunnel` / `LV Slabs Tunnel`,**按任务名启动,没按命令行关键词杀进程**(上次那么干误杀了 8081)。验证:三个 URL 全部回 **401 而不是 502** —— 401 是登录门,说明 app 起来了、隧道在路由。**⚠️ 但这个验证不够,当天晚些时候证明它漏掉了真病根**:我只证明了**我这条路**通,而当时 `lv-singles` 上还挂着 VPS 的第二个连接器,团队被分到那边就是 host error(见上一节)。**"我这边能打开"不能证明服务是好的。**
- **🔴 标签这条根本不是"生成少了"**:job **`44afa07bd512`(8/11 14:14,n_rows=66)** 的日志结尾写着 **`resolved: 6/66 · failed: 60`**,而**这 60 条全是同一句** `resolve_card ERR: Page.goto: Target page, context or browser has been closed`。**浏览器在第 7 张就死了,后面 60 张一张都没查过 —— 而 job 状态是 `DONE`,PDF 只有 6,742 字节(82 张那个是 65,837)。**
- **和今天查到的其他毛病是同一类:失败装成了结果。** 店里看到"只让打 7 个",以为系统只认出 7 张卡;实际是抓取器死了,系统告诉他做完了。
- **已修 `scripts/_batch4_ingest.py`**:加 `BrowserGone` + `_BROWSER_DEAD` 正则,**命中就 `break` 中止整批**(不是继续制造 60 条一样的错误),摘要照常打印、TSV 照常 flush(已解析的几张是真的,不能丢),**最后抛异常让 job 报 FAILED 而不是 DONE**。用 job 日志里的真实错误串验过:**真错误 → 中止;超时 / DNS / 页面没价 → 仍按单卡失败继续**(一张卡超时是那张卡的问题,浏览器关了是我们的问题)。
- **⚠️ 待办**:那 66 张要重跑,但**已解析的 7 张已经流进 sheet 了**(`sheet_streamer` 是逐行写的),整批重跑会写重复。重跑前要先把那 7 张排掉。

## 🔴 8/13 "host error" 真因:一条隧道上挂着两个连接器,一半流量打到 VPS 的空机器(已修并验证,Gary:"直接换成我们这边的隧道可以吗")
- **`cloudflared tunnel list` 一眼就看得出来**:`lv-singles` 的连接是 `1xiad02, 1xiad05, 1xiad12, 1xiad17, 2xlax01, 2xlax09` —— **8 条**;而正常的 `lv-slabs` 只有 4 条。**一个 cloudflared 建 4 条 HA 连接,8 条 = 两个连接器。**
  ```
  CONNECTOR                             CREATED               ORIGIN IP        EDGE
  a1f52b5c-285c-4a3b-b38d-b7e7199d5f73  2026-08-04 10:13 UTC  172.252.168.89   iad02/05/12/17   ← VPS
  02eb6db7-96cd-4096-99a8-2cee430f45c6  2026-08-13 19:22 UTC  12.127.38.18     lax01/lax09      ← 本机
  ```
- **VPS 那条隧道从 8/04 就连着,而 VPS 上的 singles webapp 8/10 被停了** —— 隧道留着、app 关掉。**Cloudflare 把请求交给它挑中的任意一个连接器,挑到 iad 就打在一台什么都没监听的机器上,返回 host error;挑到 lax 就正常。** 同一个网址,有人能开有人开不了,刷新一下可能又好了。
- **`prompts/vps_smoke_test.md` 早就写明了会这样**:"Do not start the cloudflared tunnel on VPS yet (would conflict with Gary's local tunnel **sharing the same tunnel ID**). Wait for explicit go." 隧道起来了,而停 app 的时候没人想起来隧道还连着。
- **🔴 我上一条结论是错的,病根不是密码。** 我把 webapp 日志里的"外部请求 401"当成团队在试密码 —— **`12.127.38.18` 就是这台机器自己的出口 IP**(我走公网绕一圈回来测,记的就是它)。全日志按 IP 统计:`12.127.38.18` 24 条(**全是我**)· `127.0.0.1` 12 条(**也是我**)· `54.251.7.248` / `13.251.10.225` 共 3 条(**AWS 新加坡,扫描机器人**)。**团队一条都没有,连一个 401 都没有 —— 他们的请求根本没到过这台机器。** 判"谁在打我的服务"之前,先查本机出口 IP。
- **✅ 修法:换一条只有本机有凭证的隧道**(Gary 批)。新建 `lv-singles-local` = `bf506712-78bd-41de-ac4c-c01c2d483e74`,`config.yml` 指过去(`run_singles_tunnel.bat` 读的就是它,bat 和任务都不用改),CNAME 用 `tunnel route dns -f` 重指。**VPS 那个 cloudflared 还连着旧隧道,但没有任何域名指向它 —— 它再也抢不走流量,VPS 重启也一样。** 旧配置留在 `config.yml.bak_0813`,回滚 = 还原它 + `tunnel route dns -f lv-singles lv-singles.luckyvault.us`。
- **顺序是为了不停机排的**:① 改 config.yml(**不影响已跑的进程,配置是启动时读的**)② 用新配置**另起一个临时 cloudflared**,等它连上 ③ **这时才切 DNS** —— 切过去的目标已经是连好的 ④ 停任务 + **按 PID 杀**旧连接器(49572)⑤ 起任务让它用新配置接管 ⑥ 撤临时进程。**全程公网可用。** 每一步都确认过 slabs 的 19604 / 8081 的 7808 没被碰。
- **验收不是"隧道连上了",是"外面带密码能进到应用页"**:不带密码 401 · 带密码 **200,标题 `Submit batch · LV Singles`,上传表单在** · `/health` 连打 8 次全 200 · `tunnel info` 只剩 1 个连接器,源 IP 是本机。
- **教训**:`tunnel list` 的连接数是个免费的健康指标 —— **不是 4 的倍数、或者 edge 跨了两个地区,就说明有第二个连接器**。这个故障形态最恶心的地方是它**部分工作**,所以"我这边能打开"根本不能证明什么。

## 🔴 8/13 "系统还是打不开" 的两个附带修复(Gary:"团队说 你可以确认吗 / 你修复一下")
- **时间线分两段,不是一件事**:8/12 09:29 → 8/13 12:22 是**进程被 Ctrl+C 干掉的全停**;12:22 → 22:33 是**上面那个双连接器,约一半请求 host error**。两段都是真的,先后发生。
- 验证方式很重要:**用 Python 裸 urllib 直连公网会被 Cloudflare 挡(error 1010「按浏览器签名封禁」)**,那是挡我不是挡他们。**必须带正常浏览器 UA 再测**。我第一次拿裸 urllib 测出 403 就差点报成"Cloudflare 在拦团队"。
- `.env` 里的 `WEB_PASSWORD`(13 位)**是有效的**(带它就 200);`WWW-Authenticate: Basic` 本地公网都在,所以浏览器会弹框。**密码这条至今没有任何证据说它错过** —— 团队根本没走到那一步。
- **✅ 修了让这件事一再发生的两个东西**(`webapp/main.py`,已重启生效):
  1. **新增 `/health`,不需要密码**。"服务挂了"和"我登不进去"从外面看长得一模一样 —— 都是打不开的网页 —— 而这两件事要找的人不同。今天就是因为分不开,白等了一天。现在一键可判:`/health` 打得开就说明服务活着。
  2. **401 改成人看得懂的页面**。原来浏览器密码试完就渲染 `{"detail":"Not authenticated"}`,店里读成"网站坏了"。现在写明账号是 `lvteam`、服务在运行、**没弹框就开无痕窗口**(Basic 认证存过一次错密码就一直重发、再也不问)。
  3. **`exc.headers` 原样透传** —— 弄丢 `WWW-Authenticate` 会让浏览器永远不弹框,把"密码错"变成真的打不开。六项端到端验过,本地公网一致。
- **重启要按 PID 杀,不能靠 `Stop-ScheduledTask`** —— 任务停了但 .bat 起的 python 子进程还活着(实测 PID 没变、`/health` 仍 404)。杀之前先分别取 8080 / 8081 的 PID 并比对,**8081 是 slabs,绝对不能碰**(上次按命令行关键词杀误伤过)。

## 🔴 8/13 晚:团队自己交的 49 张又死在第 30 张 —— 查出 `_reconnect` 从来就没救回来过(已修并验证)
- 隧道修好后**团队自己登进去了**:下走 60 张的标签、又交了一批 49 张(job `bca2c792e6ab`)。**跑到第 30 张浏览器又死了。**
- **今天早上那道闸门起作用了**:`🔴 ABORTED: browser died at card 30 of 49 … 19 cards unchecked` + `=== JOB FAILED ===`。对比 8/11:那次报 **DONE**、6KB 的 PDF、60 条一模一样的假失败。**失败不再伪装成结果。**
- **🔴 但顺着查出 `_reconnect` 本身是坏的,三次重启从来没有过机会。** 报错是 `BrowserContext.new_page: … has been closed` —— **重连成功了,拿到的却是一具尸体**。病根在 `slab-inventory/app/adspower.py` 的 `start_browser`,它的文档自己写着 "Start the profile (**or re-attach if already running**)":别的 cron 调 `browser/stop` 之后 AdsPower 仍可能认为 profile 是 Active,于是 `browser/start` **把那个正在退出的浏览器的旧 ws 原样还回来**;旧代码接着无条件用 `b.contexts[0]`,而那个 context 已经关了。
- **已修**(`scripts/_batch4_ingest.py`,**只改本地,没动 slab-inventory 那个共享模块** —— slabs 在用它):新 `_attach()` **逐个试 context 直到拿到能开页的**,都不行就新建 context;`_reconnect()` 先试便宜的重连,**拿不到可用页面就强制 `browser/stop` → 等 6 秒 → 重开**。
- **验的是真实故障形态**:建会话 → **真的把 profile 停掉** → 确认旧页面死了且死法被 `_BROWSER_DEAD` 认得 → `_reconnect` 拿回一个能真正加载内容的页面。**16 个检查全过**,含"超时/DNS/页面没价不许被误判成浏览器死"。
- **⚠️ 这只是让它自愈,不是根治。** 根因仍是 singles 抓价和 `cron_governor` / `price_check_cron` / `ig_common` **共用 AdsPower 默认号 `k1bkogcy`**,而那几个会调 `browser/stop`。**给 singles 单开一个号才是断根,待 Gary 定。**

### 🔴 中止会把已解析那部分的标签一起丢掉 —— 是我那个中止修复自己带出来的洞(已修)
- **`bca2c792e6ab` 的 29 张有价没标签**:`sheet_streamer` 逐行写,所以 29 张真的进了表;但 **PDF 渲染排在成功路径上**,`BrowserGone` 一抛就整个跳过。`out/` 里那个 job 连 PDF 文件都没有。**店里拿到的还是"价格在表上但印不出来",和早上那次抱怨的形状一模一样。**
- 已手工补渲染 **58 张**(29 张卡 × 数量),加上重跑的 62 张 = **120 张,正好等于原 job 记的 `physical qty total: 120`**。`/jobs/<id>/labels.pdf` **只判文件存不存在、不判状态**,所以 FAILED 的 job 照样下得到,job 页面上的链接也在(实测两个 job 都 200 + `%PDF`)。
- **已修 `webapp/jobs.py`**:抽出 `_render_labels()`,**`except` 里也调一次** —— TSV 里有几行就渲染几张,**状态仍然是 FAILED**(部分标签不是跑完了),`error_msg` 写明 `N label(s) for the cards that DID resolve are ready … the rest were never checked`。**一张都没解析时不生成 PDF、也不吹嘘有标签**(两个方向都验了,10 个检查全过)。
- **测试坑,差点测了个寂寞**:① 第一版 `sys.path` 把 slab-inventory 放在前面,**`from webapp import jobs` 静默导入了 slabs 那个同名模块**(它也有 `webapp/jobs.py`,`create_job` 签名还不一样)—— 现在测试里加了 `assert J.__file__ 在 ROOT 下面` ② 第二版输入不是 CSV,`is_csv` 判 False **走了 TXT 分支,我打的桩根本没被调用**,而测试"通过"了几条 —— **判定必须能区分"跑对了"和"根本没跑到"**。
- 测试建的 4 个 job 已从 `jobs.db` 清掉(只删 `submitted_by='selftest'`,删前打印、删后回读,两个真 job 和 PDF 都在)。**否则明早团队会看到 4 个 FAILED,读成第五次事故。**

### ✅ 那 49 张现在是完整的
- 重跑 job `5c2b83bff6b1`:**20/20 · failed 0 · 浏览器重启 0 次 · 真错误 0**,写进 A926–A945。
- **核对过,不是听 job 自报**:输入 49 个不重复 id = 29(第一批)+ 20(重跑),**漏 0 · 多 0 · 重复 0**;实读 sheet `A890:H950` 得 **56 个非空行**(5 行旧的 + 2 个分隔行 + 49 张卡),**A 列无重复**。
- **数错误数要区分大小写**:`Select-String` 默认不区分,`ov`**`err`**`ide` 会被 `ERR` 匹配上 —— 我因此一度把 29 个 `force_url override` 报成 28 个失败。

## ✅ 8/13 单卡批次的成交源改成 130point,不再走 eBay(Gary:"我们不走ebay了 直接走130points";已上线并验证)
- **换源的理由是权限不是数据质量**:eBay 的 sold 视图**要登录**,这就把批次管线锁死在"那个恰好登录着的号"上 —— 也就是被 cron 抢的共用号 `k1bkogcy`。130point **免登录**,同一批卡它给 10 笔而 eBay 给 5 笔。
- **🔴 但先查出一件推翻前提的事:专用号 `k1ckl201` 连 130point 也进不去。** 对照实测:`k1bkogcy` **3 秒进站**(标题 `130 Point`,搜索框在);`k1ckl201` **60 秒卡在 Cloudflare `Just a moment...` 不放行**。eBay 那边同样是弹登录页。**规律:专用号"太干净"(fresh fingerprint + no cookies),而反爬系统恰恰不信任干净的。换价源救不了隔离,这是两个独立问题。**
- **新 `scripts/point130.py`(共用模块)**:纯解析 `parse_sold_body()` + 异步 `fetch_sold_async()` + 给管线用的 `fetch_sold_for_card()`。**解析规则只留一份**,因为那三条(只认 `^\$X USD$` 行 / Best Offer 取最后一个价 / 等 `Sold(N)` 计数器,等不到就抛 `Point130Broken`)是 8/13 拿真页面打出来的,复制一份必漂。
- **🔴 130point 的中位数直接用会比现在更糟,必须过滤 —— 这是把标题打出来才看见的**:
  ```
  Charmeleon 28/108(TCG 市价 $0.63)
    $0.99–$4.99  Non Holo / Regular LP        ← 我们这张
    $15.00–$37.88 Reverse Holo Stamped        ← 另一个产品
    不过滤 → 中位 $4.99,8 倍误差,而且每一笔都是"真成交"
  Charizard Base Set 4/102
    $100 "Celebrations … 4/102"(2021 复刻,号一模一样)· $16 "(Fan Art)" 自制卡
  ```
  **它匹配的卡是对的,混进来的是版本 / 复刻 / 自制。** 和手册里 eBay BIN 那次同一句话:*"过滤器是对的,查询词太宽"*。
- **过滤器按 CSV 自己给的字段建,不猜**:`build_filters(set_name, printing)` 返回 `ban / want_reverse / want_first_ed`。**两个 flag 都是三态** —— True 要求、False 排除、**None 不加规则**(导出没说印次就不许猜,猜错不会报错,只会静默地给另一个产品定价)。
  - **`Reverse Holofoil` 是导出里的独立值(实扫 8 个批次:Holofoil 453 · Normal 49 · **1st Edition Holofoil 28** · Reverse Holofoil 14 · Unlimited Holofoil 3)**,所以 `Holofoil` 确实指非 reverse,映射站得住 —— **这是查过才敢写的,不是假设**。
  - 顺带补了 **1st Edition / Unlimited**:同一张画不同的钱,导出分得清就不该混。
  - `REPRINT_SETS`(celebrations / classic collection / 25th anniversary / legendary collection)**只在我们自己不是那个套时才排**。
- **落点**:`ingest_tcg_export.resolve_card` 的 vintage/JP 分支改调 `fetch_130point_sales()`,**用自己的新标签页**(不能把 TCGplayer 那页导航走)。`Point130Broken` **不吞** —— 明打 `🔴 130point unreachable — NOT the same as no sales`,comps 留空。`fetch_ebay_raw_sales` **保留**,`refresh_master_prices.py` 还在用。
- **测试 31 个用例,跑真解析器 + 真页面文本**(`scripts/fixtures_130point/` 是 8/13 抓的实页 innerText)。含:胡编查询 → 0 笔且**页面确实加载了**(`Sold (0)` 在)· 历史搜索里的别的卡名不会被当成结果 · **`$2.99 AUD` 不会被算进美元中位** · 版本/复刻/自制三类污染各自被排掉 · 排掉后中位真的落回同一量级(`plain 2.21 / mixed 4.28 / reverse 28.87`)。
- 端到端实跑:`Charmeleon → $2.71 (last sold 2.00, 0.99, 2.00)` · `Mr. Mime Jungle → $11.87` · **modern 卡照旧不查 130point**。`ebay_comps` 仍传给 `price_confidence`,所以 CHECK EBAY 的判定现在按 130point 笔数算。
- **⚠️ 已知且刻意没做的**:**品相没过滤**(NM/LP/MP/HP 混在一起),所以 vintage 的 comps 均值可能明显低于 NM 市价(Mr. Mime $11.87 vs 市价 $33.82)。**这和之前走 eBay 时是同一行为**,而且那一格是"成交参考"不是定价覆盖。要收紧的话是下一步。
- **⏳ 隔离那件事仍未解决**,专用号被 Cloudflare 和 eBay 双双挡住。三条路待 Gary 选:**① 养 `k1ckl201`(打开正常浏览一阵)② 重新克隆 `k1bkogcy` 并连 cookie 一起复制(k1ckl201 当初就是"no cookies",信任度是这么丢的)③ 不换号,给别的 cron 加闸门**(`refresh_master_prices` 已有 `_wait_for_ingest_clear()` 先例)。

## ✅ 8/13 "把搜索页面替他们做好":comps 页 + 逐笔 match 分析(Gary:"接进去链接 让团队看 类似于我们帮他们把搜索的页面做了的感觉")
- **不能贴 130point 的链接,这是硬约束**:它的搜索状态从不进 URL(8/13 实测,回车后地址栏还是 `/search`,查询被剥掉)。所以**页面只能是我们自己的** —— 而这反而更好,因为外部搜索页永远做不到"标出哪一笔不是这张卡、为什么"。
- **🔴 先证明了"一个中位数"这个展示方式本身是错的**。8 张真 vintage 卡实跑,按品相拆开后结论完全变了:
  ```
  卡                    TCG 市价   全部中位/市价   NM/LP 中位/市价
  Arceus DP50           $34.89        29%            64%
  Mewtwo LV.X DP28     $110.00        41%            67%
  Arceus AR1            $65.06        54%            57%
  Arceus AR6            $31.27        57%            62%
  Lucario LV.X DP12    $137.86        66%            73%
  ```
  **混着算是 29–66% 的一片乱数,按 NM/LP 算收敛到 57–73%。** DP50 那张 14 笔里 8 笔是 MP/HP/DMG —— 拿它比 NM 口径的市价会得出"我们挂太高"的错误结论,实际是一半成交是残卡。**顺带得到一个可用的校准数:vintage 单卡的成交约为 TCGplayer 市价的 60–70%,五张卡一致。**
- **两张卡的数直接不能用,而系统必须说出来**:`Magnemite 62/97` 13 笔里 reverse holo 9 / 普通 4,而**导出没写印次 → 判不了我们手上是哪个**(reverse 约 $6、普通约 $2.5);`Mr. Mime 06/64` 混进 1 笔 1st Edition($40,其余 $12–20)。**这种情况不挑数,只印"混了什么、各几笔"。**
- **新 `scripts/analyze_130_match.py`**(纯函数,不碰浏览器):`classify()` 给每一笔打 match/不match + 理由(`graded` / `lot/bundle` / `not-a-real-card` / `reverse-holo` / `not-1st-edition` / `reprint-set(...)` / `number-missing` / `name-missing`);`analyse()` 按品相分档 + 检测版本混杂;`save_analysis()` 落盘。**品相只打标不用来排除** —— vintage 本来就跨品相定价,那个分布是信息不是污染。
- **新页面 `GET /comps/<tcg_id>`(webapp,已上线)**:摘要就是**一个均价 + 区间 + 占市价百分比**(Gary 8/13:"condition 我们就给个average 然后给网页他们自己看就行"),下面逐笔列出成交、**每行带品相**、以及**被排除的行和理由**。**分布让他们自己看,不预先替他们切**;但**排除理由必须可见** —— 一个没人能检查的过滤器只是另一个要人盲信的数字。
- **10 张卡实跑(均价口径)**:`Arceus AR1 59%` · `Mewtwo LV.X 51%` · `Arceus AR6 59%` · `DP50 45%` · `Lucario LV.X 57%` · `Reshiram 79%` · `Entei 44%` · `Metagross ex 108%` · `Magnemite 221%` · `Mr. Mime 30%(仅 1 笔,已标注)`。**两个离群都解释得通**:Magnemite 市价才 $1.12,便宜卡的邮费占比大、成交必然高于"市价";Mr. Mime 是下面那条 1st Edition 的事。
- **🔴 1st Edition 那条规则当场救了一张卡**:`Mr. Mime (6) 06/64 Jungle` 的印次是 **1st Edition Holofoil,TCG 市价 $134.09**,而 24 笔成交里 **23 笔是 unlimited(都在 $12–20)**。加规则之前它报 **16/16 匹配、中位 $15** —— **等于把一张 $134 的卡按 $15 定价**。现在它只留 1 笔并明说"太薄,要人看"。
- **🔴 又抓到一条多张一起卖混进均价**:`Xs 5 Sealed Entei 34/53 … original packaging $122.50` 被当成一笔单卡成交,Entei 均价因此从 **$13.80 虚高到 $19.52**。原来的 lot 规则只认 `x` 后跟两位以上数字。**放宽时有个陷阱**:裸的 `\bx\s*\d+` 会匹配 `LV.X 100`,把 Mewtwo LV.X / Lucario LV.X 的正经成交全误杀 —— 所以数量词必须跟名词(`x2 cards`)或用 `Xs N` 前缀形,另加 `sealed`(单卡成交不可能是 sealed)。**测试里专门钉了三条 LV.X 不许被误杀。**
- **✅ TCG 那个锚点换成"最便宜的在售挂牌"(Gary 8/13:"我们做的是给他们一个reference 页面 … tcg我们选择cheapest listing的价格")**:
  - **导出给不了这个数**:`TCG Low Price` / `TCG Low Price With Shipping` / `TCG Direct Low` 在 **11 个批次 553 行里全是空的**(Market Price 有 546 行)。所以只能抓页面。
  - 页面上是 `As low as $X`,`extract_tcg_page` 已加提取。**取所有匹配里的最小值,不取第一个** —— 这个数按印次/品相分块重复出现,取"渲染时排第一个"会随页面重排而变。
  - 页面现在三个数并排:`成交均价(带区间)` · `最便宜挂牌` · `市价(成交均价占市价百分比)`。**不给"相对最便宜挂牌"的百分比** —— 最低挂牌通常是残卡,那个比值会给一张正常卡报出 348%,是噪音。
  - **comps 从 5 笔提到 25 笔**:表格那一格只显示最近 3 笔,但参考页是给人定价时读的,同一次请求不多花代价。实测每张返回 13–25 笔,而其中三分之一是评级卡或整套 —— 只存 5 笔常常只剩两笔可用。**表格那一格的均价也改成只算它显示的那 5 笔**,否则那一格自己和自己对不上。
- **🔴 定价锚点改成"NM 最低挂牌"(Gary 8/13:"我们定价按照nm的最低价格"),而我上一版那个"cheapest listing"是错的**:产品页的挂牌列表**按价格升序**,所以最便宜的那几条全是残卡 —— **Entei 的 `As low as` 是 $4.15,而 NM 的最低是 $27.00**。拿它定价会把每一张 vintage 都严重低估。
  - 品相筛选在 URL 上:`?Condition=Near+Mint`。**但不能读筛选后的 `As low as`** —— 实测 Metagross ex 在 NM 筛选下**一条挂牌都没有,而 `As low as` 仍然显示 $44.00(残卡的地板价,没跟着筛选更新)**。所以价格**从挂牌行本身读**,而且**只有当解析出的每一行都是 Near Mint 才采信**。
  - **"没有 NM 在售"是答案不是缺口**:Metagross ex 全部 5 条挂牌无一 NM(NM 市价 $80.01,跨品相最低是残卡 $44)。这时**返回空,页面明写 "No Near Mint listings"** —— 不许用别的数顶上,否则那 $44 会被读成 NM 地板价。
  - 实测四张:`Entei $27.00(送达 $28.00,10 条 NM)` · `Metagross ex 无 NM` · `Arceus DP50 $34.89(9 条)` · `Reshiram $90.99(10 条)`。**同时记 `nm_low_shipped`** —— DP50 那条 $34.89 的运费是 $19.99,只看标价会被运费做局。
  - 代价:**vintage/JP 卡每张多一次页面加载**(排在 130point 之后,所以它失败也不会丢掉 comps)。
- **🔴 发版前必须自己打开页面截图看(Gary 8/13:"我们每次推系统 我们都要自己打开截图看看有没有用验证")。`scripts/screenshot_pages.py`** 拍三种状态(有 NM / 无 NM / 从没跑过价)× 桌面+手机,报横向溢出,存 `out/screenshots/<时间戳>/`。
  - **这条当场就赚回来了。页面通过了 23 项断言,截图一眼看出两个真缺陷,测试一个都没抓到**:① **`$162.50 "… 2007 TAG 8.5"` 被当成裸卡算进均价** —— TAG 是评级公司,而我的名单只有 PSA/BGS/CGC/SGC/HGA(已补 TAG/GMA/KSA/ISA/BVG/ARK 等,并加 `POP \d+`)② **三笔真的 Entei 成交被灰掉标 `number-missing`** —— 它们写 `#34` / `WoTC Promo 34`,而我只认 `34/53`。
  - 卡号匹配已重写:**标题里出现了别的 `n/total` 就不许放行**(`12/53` 不是我们的 `34/53`),**没有任何 `n/total` 时才接受裸号**,且带边界(`34` 不匹配 `134`/`340`);字母编号 `AR1` 不匹配 `AR10`。**Entei 均价因此 $13.80 → $12.69,而 Metagross 因为剔掉 TAG 那张 $96.21 → $91.12。**
  - 顺带修:页面标题原来没有卡号(`Entei WoTC Promo`),H1 解析不到时**回落用导出的号** —— 卡号正是区分同名卡的唯一凭据。
- **⏳ 还没做:把这个数接到我们实际的挂价上。** 参考页已经在用,但**管线写进表格的价我没动** —— 那要先定"**没有 NM 在售时按什么定价**"(Metagross 那种),不定就没法安全切换。
- **🔴 顺带查出一个既有问题(未改,只在参考页规避)**:`extract_tcg_page` 的市价取的是页面上**第一个** `Market Price`,而产品页按印次/品相**各有一个**。实测:我们那张 **Reverse Holofoil 的 Entei 抓到 $15.44,导出写 $31.35**;**Metagross ex 抓到 $26.35,导出写 $80.01**(而最便宜挂牌就要 $44)。**两张都是导出的值才对得上,因为导出是按印次给的。** 参考页已改用导出值;**管线写进表格的那个值我没动** —— 那是我们的挂价,改它是决定不是清理。**待 Gary 定。**
- **`scripts/test_analyze_130_match.py` 32 用例**(标题全部取自 8/13 的真实 130point 结果):多张一起卖 · **不许误杀 LV.X** · 评级卡 · 自制卡 · reverse 双向 · 1st Ed 双向 · 异套复刻(自己是 Celebrations 时不排)· 卡号补零写法 · `analyse()` 汇总只算判定为同一张卡的。
- **故意不加密码**,和 `/health` 同一个理由:链接是从库存 app 点过去的,那些人不一定有 singles 的密码,**打不开的链接不是功能**;而页面里全是公开的 eBay 成交标题和价格,没有成本、没有库存、没有客户信息。
- **app 侧(分支 `feat/fx-and-sold-comps`,`1a7924b`,未过 review 未发版)**:`singlesCompsUrl(tcgId, {name,number,setName})` + `soldCompsLink(row)`,`SinglesInventory` 行和 `SellSingleModal` 各一个链接。
  - **🔴 我第一版写错并自己抓了回来**:原本让 app 判"有没有 comps",但 app 根本不知道 —— comps 只对**批次跑过的 vintage/JP 卡**存在,结果是每一行都显示链接、大部分点开是 404,而我写的 eBay 回退永远不触发。**改成 app 只出一个链接,卡的身份挂在 query 上,页面自己兜底**:有存的就展示,没有就给 eBay 成交搜索。**一个大部分时候打不开东西的链接,会教会人不要再点。**
- 测试:`scratchpad/ebay_sold_url_test.mjs` **29 用例**(跑真函数)+ 页面 **19 项公网实测**(不带密码能开 · 排除理由在页上 · 没数据时给得出 eBay 出路 · 连身份都没有时**不硬凑**一个会打开整个目录的链接 · 主页仍 401)。`npx vite build` 通过。
  - **测试自身的坑**:`URLSearchParams` 把空格编成 `+`,我用 `decodeURIComponent` 比对就误判失败 —— 改成按 URL 真正解析参数。
- **⚠️ 待办**:`classify()` 还没有单测(只有跑真数据的观察);品相未写的行占比不低(每张 2–10 笔),NM/LP 档常常只有 3–5 笔,**薄的时候要不要给数还没定**。

## ✅ 单卡加"成交记录"链接(8/13,Gary:"不用在labels上 我们在系统里面显示 就行 就是类似于slabs的状况 我们把sales 的link 贴上去";**已写完,未过 review 未发版**)
- **不做标签**(Gary 8/13 明确否掉)。**照 slabs 的先例做在 app 里** —— `SellSlabModal` / `SlabsInventory` 早就有 `slabCertUrl` + `ebaySearchUrl`,单卡这边只有 TCGplayer 链接。
- **🔴 130point 不能做链接,这是硬事实**:它的搜索状态**从不进 URL**(8/13 实测:输入查询回车后地址栏就是 `https://130point.com/search`,`?q=` 和 `?search=` 都被剥掉、结果为空)。所以标签也好、系统也好,**没有任何 130point 链接可以贴**。
- **落点改成 eBay 成交**:新 `ebaySoldUrl(name, number, setName)`(`src/lib/saleChannels.js`),`LH_Sold=1&LH_Complete=1&_sop=13` + **`-psa -bgs -cgc` 排掉评级卡**(和抓取器看同一批货)。**镜像 `lv-singles-erp/price_confidence.ebay_sold_url`**,让团队看到的结果集和管线推理的一致。
- **顺手改掉一条过时注释**:原来的 `ebaySearchUrl` 注释写"sold 过滤要登录所以只链普通搜索"。**普通搜索显示的是别人的要价,判 vintage 恰恰不能看要价** —— 8/12 实测 25 行 vintage 里 22 行(88%)背后只有 ≤1 笔成交。登录一次换真成交,值。两个函数都留着,用途注释分开写。
- 落在两处:`SellSingleModal`(定价那一刻)和 `SinglesInventory` 列表行(`sold comps` 链接,`stopPropagation` 免得点链接把行也点开)。
- **`name` 为空一律返回 null** —— 否则查询只剩 `-psa -bgs -cgc`,会打开 eBay 整个目录。**一个自信地打开错东西的链接比没有链接更糟。** `scratchpad/ebay_sold_url_test.mjs` **15 用例**(跑真函数),一半在验这个和"两个 eBay 函数不许混"。`npx vite build` 通过。

## 📌 8/13 当前库存实数(Gary:"过去的就不用砍了 从今天开始对齐 你帮我看看现在库存还有多少")
- **能按成本说的只有美国密封品:7,362 件 / $127,589**。按房:Master 2,892/$39,011 · Packheads 823/$35,334 · eBay SlabbiePatty 1,465/$24,256 · Front Store 532/$10,750 · RocketsHQ 417/$9,877 · PokeAuctionHouse 826/$4,453 · PokeCasino 154/$2,831 · eBay LVUS 253/$1,077。
- **日本 sealed 用他们自己的账:465 件 ≈ ¥1,913,935 ≈ $12,015**。**我们的表写 2,727 件 / $90,486 —— 虚高 7.5 倍,不要用**,那个房间从来没有一条进出记录。**光这一项,账上就多挂了约 $78,000。**
  - 构成:M6(Storm)367 件 = 散包 314 + 垃圾袋 26 + 有膜 23 + 无膜 4;M2 有膜 11;M1S/M1L 各档 35;M5 22;其余零星。
  - **值的来源分两半,不能混**:他们 `成本表` 自己有成本的只有 49 件(¥696,235);**M5/M6 共 416 件他们的成本表还没建行**,那部分 ¥1,217,700 是**我拿我们自己的 jp_vendor 进价推的(派生值)** —— Storm 盒 ¥18,000 · In Bag ¥16,000 · 散包 ¥450。另有 27 件(`M2/M2a 其他`)对不上我们任何产品,未估。
  - 对照:我们的日本仓记 Storm 1,204 件(225 盒 + 311 In Bag + 108 Unsealed + 560 散包),**他们记 367 件**。差 837 件。**他们的账是平的,我们的没有任何进出记录 —— 以他们的为准。**
- **所以全公司 sealed ≈ 美国 $127,589 + 日本 $12,015 ≈ $139,604**,不是之前那个 $194,436。
- **单卡 1,749 行 / 1,982 张 · 市价 $34,328**,有成本的只有 79 行($3,966)。**评级卡 1,906 个 · 市价 $521,200**,成本 0 条(Gary 8/10 定:自送评的不填)。**市价不能和成本相加。**
- 三条限制要一起看:① 美国密封品里 **62 行 / 399 件没有成本**,对上面那个数贡献 $0 ② 日元按**写死的 149.25** 折算(今天真实 ~159),日本货成本偏高约 6.7% ③ 读数当时 Aldo 正在搬库,房间数字在动。
- **🔴 日本对账定为从 8/13 起对齐,之前的 $163,842 缺口不追**(Gary 决定)。理由和 GTS 那次一样:**没有痕迹的历史补不回来,补了就是编**。往后按日本 `出库表(lv)` 对 `jp_to_us_shipment`。
- **范围收紧(Gary 8/13:"日本sheet内部的话其实无所谓 我们不用管他们内部 我们只要负责美国的帐 / 我们先focus on sealed")**:日本的 直播/订单/调货 三个内部出库口**不归我们管**,我们只对"发到美国 → 有没有入我们的账"这一段。单卡/评级卡先放一边。

### ✅ 130point 已修好并验证(8/13,Gary:"修 130points")
- **三个 bug,第一个是病根**:① **`/sales/` 现在重定向到首页,结果在 SPA 的 `/search` 路由上** —— 老代码在首页打字、睡 12 秒、然后读**首页**的正文 ② **固定 sleep 分不出"还在 Searching..."和"搜完了没结果"** ③ **`Best Offer Accepted` 行会印两个价(挂牌价 → 成交价),老代码取"后面第一个 $" 取到的是挂牌价**,把每一笔议价成交都记高了。另外页面里混着 `$98.40 AUD` 这种非美元行,老代码照收。
- **改法**:去 `https://130point.com/`(不是 `/sales/`)→ 打字回车 → **等到 `Searching...` 消失且出现 `Sold (N)` 计数器**(最多 60 秒)→ **等不到就抛 `Point130Broken`,绝不返回 0 笔**("没成交"和"页面没加载"是同一个空列表,只有一个有意义)→ 只认 `^\$X USD$` 行 → `Best Offer` 取**最后一个**美元价、其余取第一个。
- **两个方向都验了**:`Gem Vol.5 盒 → $41.25 / 10 笔`(坏版本报 **$11,922**,真实约 $30–36)· `charizard base set → $1,197.50 / 10 笔` · **胡编的查询 → 0 笔**。
- **修之前它已经在生产里跑**:`data/manual_price.log` 8/10 两次把 `Gem Vol.4 $36.00` 提议改成 **$10,397.50 / $11,247.00**,**唯一挡住的是 ±25% 熔断**;其余品全是 `0 clean comps, held` —— 这个周一任务实际上已经完全不工作。
- **教训**:「"什么都没找到"也可能是探测器坏了,必须验」。我第一轮 10 个品全 0 笔,差点写成"这些品没有成交数据" —— **是跑了一个已知有数据的对照查询才发现是抓取器的问题。**

### 🔴(已修,记录病根)130point 抓取器曾经返回错数而不是空
- `manual_price_update.sold_median` 打开 `https://130point.com/sales/`,**现在被重定向到首页** —— 实测结束时 `page.url == https://130point.com/`,页面文字是 `Log in / Find your next grail / Recent / Saved`。脚本在拿落地页的文本行去匹配随机 `$` 金额。
- **后果比返回空更糟**:大部分查询报 **0 笔**(看起来像"这个品没成交"),少数报**一个自信的错数**。对照实测:`Gem Vol.5 booster box → 中位 $11,922.50 / 10 笔`(真实约 $30);`charizard base set → 0 笔`(这个不可能没成交)。
- **生产日志 `data/manual_price.log`(8/10)**:`🧊 Gem Vol.4 Booster Box $36.00 -> $10,397.50 (sold-med $9,902, 10 comps) FROZEN >±25%`,下一轮 `-> $11,247.00`。**一个 $36 的盒差点被挂成一万美元,唯一挡住它的是那道 ±25% 熔断。** 其余品全是 `only 0 clean comps, held` —— **这个周一任务实际上已经完全不工作了。**
- **教训照抄手册那条**:「"什么都没找到"也可能是探测器坏了,必须验」。我第一轮拿 10 个品查 130point 全 0,差点当成"这些品没有成交数据"写进结论 —— **是跑了一个已知有数据的对照查询才发现是抓取器的问题**。
- **待修**:130point 的新搜索入口(`/sales/` 已废)。在修好之前,`sold_median` 的任何输出都不能用。

### 🔴 给无成本行查价的实测结果(8/13,Gary:"通过 tcgplayer ebay 或者 130points 查价格")
- **TCGplayer(`erp_pricing.price_product`)**:**钉了 id 能直接用的只有 5 个品 / 7 件 / $1,641**;模糊匹配到 11 个品 / 47 件(**按 7/24 铁律只能当钉价候选,不许写成本**);**28 个品 / 264 件根本没有 TCG 线**,包括最大的三个(Rarity Collection 119 · First Partner S3 30 · Costco Mini Tins 26)。
- **eBay BIN**:已给 27 个品加了查询词(`data/ebay_bin_queries.json`,备份 `.bak_0813`)。**过滤器是对的,查询词太宽** —— `yugioh rarity collection quarter century` 返回 55 条**全是单卡**($1.39–$6.29),`floor 40` + `form "booster box"` 正确地全挡了。**每个品都要单独收紧查询词**,那是查询词文件自己 readme 写明的人工活。
- **130point(修好之后重跑)**:
  ```
  Costco Prismatic Evolutions Mini Tins   26 × $168.78  =  $4,388   (10 笔)
  2023 UD Marvel Allegiance Trilogy        4 × $135.41  =    $542   (10 笔)
  Prismatic Evolutions Poster Collection   7 × $43.00   =    $301   (10 笔)
  Monkey D Luffy Starter Deck              6 × $29.80   =    $179   (10 笔)
  ```
  查不到的:`First Partner S3` 30 · `YGO Chaos Origins` 6 · `Zoro Starter Deck` 6 · `Dinosaur's Rage` 4 —— 查询词还要收紧。

### 🔴 我报错过一次:Rarity Collection 是日版不是英版(Gary 8/13 当场纠正)
- 我用 `yugioh rarity collection booster box sealed` 查到 **$105 × 119 = $12,495** 并写进了简报。**Gary:「rarity collection 是日文的 不是英文」。查下来他是对的,那个 $105 是英版 RA 系列盒的价。**
- **库里有两个一模一样的名字**:`0414c498 [EN] ppb=None 库存 0 成本 $40` · **`95108ef2 [JP] ppb=15 库存 119 成本 $0`**(日版一盒 15 包,对得上)。**119 盒全在 JP 那个上。** 又是加产品零查重造的重名。
- **手册里早写着「钉前必验:名称+语言三对齐,已四次抓到 EN/JP 错配」—— 这是第五次,而且是我犯的。以后查价前先读 `products.language`。**
- 重查日版:**130point 英文和日文两种写法都是 `Sold(0)`**(页面正常加载、有计数器,所以是真没数据不是抓取器坏);TCG 无严格匹配;eBay BIN 被单卡淹没。**公开源查不到这个品。**
- **而且它在系统里没有任何来路**:acquisitions 无 · 日本 `入库表` 1,353 行 0 命中 · GTS 56 张发票 0 命中 · `movements` 0 条。**119 盒出现在 Master,零单据** —— 和 Storm 那个收货缺口同一形状(被盘点过 39 次)。
- **✅ 最后是 Gary 直接给的数:日版 $40/盒。** 已写 `95108ef2` Master 行 **119 × $40.00 = $4,760**,备份 `rarity_jp_cost_backup.json`,乐观锁("仍无成本"才写)+ 回读通过。**这个数任何引擎都产不出来,只有买的人知道。**
- **🔴 口径提醒**:这三个源给的都是**市价**,不是我们实付。**要写进 `avg_cost_basis` 必须 Gary 先定折扣口径** —— 单卡是 8/10 定的"市价×80%",**sealed 从来没定过**。在定之前这 $18,251 只能当参考,不许写库。

### ✅ 8/13 补了 12 行成本(Gary:"我以为我们修正了 你确定吗")
- **他问得对 —— 之前没修。** 8/12 只做到了分类:`cost_recovery_probe` 把无成本行归了类,`gts_map_queue` 映射了 15 个 SKU,**但映射 SKU 不写成本** —— 成本要 commit 发票才落地,而 `CUTOVER` 又把老发票挡住了。**那 62 行原封不动。**
- 已补 **12 行 / 80 件 / $4,991**(`Paldean Fates 24×$19.33` · `Storm Emeralda 13×$152.17` · `Ascended Heroes Bundle 10×$71` · `Scarlet & Violet Box 3×$250` …)。来源优先级:**同产品的进货记录 > 别的房间的 avg_cost_basis**(前者是实付,后者已经是派生)。备份 `zero_cost_fill_backup.json`,**乐观锁条件是"仍然没有成本"**(期间有人填了就以人的为准,派生数不许盖),回读 12/12。
- **剩下 50 行 / 319 件留空**,最大的是 `Rarity Collection Quarter Century 119 件`。**查无可查就留空 —— 编一个数看起来像核验过,比空着更糟。**

### 🔴 汇率是写死的常数,而且两个方向都错(8/13 已修,**未过 review 未发版**)
- `src/lib/supabase.js` 里 `JPY: 0.0067 / RMB: 0.14`,注释写着 "Static exchange rates (no external API calls)"。**四个月的日本进货算出来的隐含汇率零波动**,就是因为它从不更新。
- **实测偏差**:日元写死 **149.25**,实时 **159.29** → **日元成本高估 6.7%**(8 月一个月就多记 $8,348);人民币写死 **7.14**,实时 **6.757** → **人民币成本低估 5.7%**。**成本高估 = 毛利低估**,正是让一笔烂买入看起来还行的方向。
- **修法:查询放服务端不放浏览器** —— 新 `api/fx-rate.js`(6 小时缓存 + **合理性上下界 JPY 80–250 / CNY 4–12**,取回一个离谱的数会当场重写全站成本,所以宁可回落)。`supabase.js` 加 `refreshExchangeRates()` 在 `main.jsx` 启动时 fire-and-forget 拉一次,**`convertToUSD` 保持同步**(它在渲染路径上,改成 async 会波及每一个入库表单)。写死的值降级为 fallback。
- **失败时必须说自己是 fallback**:`getExchangeRatesMeta()` 带 `asOf / source / stale`。**一个陈旧但被当成实时的数字,正是这四个月没人发现的原因。**



## ✅ 8/12 两次发版已上线(main `965f2fd` + `4b3febd`,Vercel 已部署)
- **第一批**:门店半提交修复(`20f1d5b`,躺了很久的那个)+ 进货成本闸门 + 日本发货报告简写。
- **第二批**:Intake 撤销安全 + 收货报告按会话合并 + 盘点"不知道"不再记成"精确"。
- **两批都过了 review,共抓出 13 条,全部核实为真后才改**。其中 **4 条是我自己当天引入的回归**,最凶的两条:① `single_manual` 被 fail-closed 规则误拦 → **整条批量单卡销售会卖不了**(我把"认不出"和"本来就不用核对"混为一谈)② 成本闸门拿日元原值比 USD 参照 → **每一张日元进货单都会被硬拦**,而且闸门没有"我知道是对的"出口,只能全部打 `COST_FLAGGED` 存进去。
- **`IntakeToMaster.jsx` / `StreamCounts.jsx` 曾被判 DO NOT SHIP,第二批才修完发的**。发第一批时把这两个文件 stash 出去了 —— **发版前必须按文件核对手册里的 DO NOT SHIP 清单,不能整个工作区一把梭**。
- **测试:preflight 50 · cost sanity 39 · split rule 12 · count notes 15 · 两个 Lark 渲染器跑真数据**。preflight 的测试已从手抄副本改成**跑前从 `supabase.js` 抽函数**,不会再漂。

## 🔴 8/01 + 8/04 两票已结清,但**没有补库存**(8/12,Gary:"我们清空 8/01 8/04 我们重新开始")
- **执行的是"结清单据",不是"补录入库"**,因为查下来方向和预期相反。Storm Emeralda Booster Box 的美国账:
  ```
  receipts 入账 91 盒   ·   卖出/发出 90 盒(其中在线订单 71)
  按账应在库  1 盒      ·   实际在库 55 盒        ← 差 +54
  ```
  **54 盒是没有任何 receipt 把它们放进去的** —— 手动加库存进去的(和 8/04 查到的"Master receipts=0 却搬出 68 发出 41"同一个洞)。而且 **90 盒已经出去了,账上只进过 91**。
- **结论:那 148 盒不是没人开封的一垛货,是"实物一直在进、在卖,单据停在 0"的单据那一半。** 按单据补进去会让美国库存 **55 → 233 盒**,而没有任何证据说明 233 盒存在。**按铁律1「正差永不写库」,这就是禁止的动作。**
- 已做:3 行(75+73 盒 + 5 个 Unsealed,$28,441)`status → Received - Discrepancy`,`notes` 打 **`RECONCILED_NO_STOCK_DELTA`** 标记写明为什么不加库存,**`quantity_received` 保持 0(没点过就不能写成点过了)**,**inventory 一件没动**。备份 `close_old_shipments_backup.json`,回读 3/3。
- `jp_shipment_watch.py` 认这个标记,归入「已结清」不再报。看守从 3 票降到 **1 票**(7/31 的 3 件、$0,你没点名,要清说一声)。
- **真实数字只能靠实物盘一次 Master 的 Storm 定。** 单据这条路已经走到头了。

## ✅ 三方对账:钱 / 发票 / 系统(8/12 上线,Gary:"假设我们 wire 了 GTS 有财务 record 了之后就应该 trigger 我们去查")
- **这是目前最硬的触发点**。承运商扫描会瞎(17track 对 JP FedEx 号不钉承运商就不认)、到货会没人注意、入库会被忘掉(20 张跑了 2 张)——**但钱出账是事实,有金额,而且归财务管不归仓库轮班管**。
- **而且不用接任何新数据源**:缓存的发票详情自带 `amount_due`。
- `inventory-sync/gts_three_way.py`(只读)。**$54,899 是已经付过钱、系统里一条记录都没有的** —— 最大三张 `INV01150557 $13,754` · `INV01154080 $12,654` · `INV01136166 $10,166`。**这些货卖出去报的毛利都是假的(没有成本)。**
- **"已付没入账"和"已入账没付"必须分开报** —— 前者是数据洞,后者是现金,要找的人不是同一个。
- **只报新出现的**(`data/gts_three_way_state.json` 去重),`--all` 才看全量。一张发票在有人处理之前会一直挂着,每晚重报同样十张就没人看了。已验:摘掉一条状态 → 报 1 张新的;再跑 → 归零。
- 已挂进 `run_gts_ingest.cmd`,**紧跟在扫描后面**。

### 🔴 同日发现:付款状态从来不刷新,这个触发点其实一次都没触发过(Gary 一句"INV01177509 是不是已经打过去了"戳出来的)
- **`gts_ingest.py` 的 `targets = [x for x in invs if x["inv"] not in seen]` —— 只抓从没见过的发票,已缓存的永远不再看第二眼。** 所以 `amount_due` 冻结在第一次抓取那一刻,而 7/10 全量回填之后的每一张都是**开票后第 1 天**抓的。
- 实测滞后(开票日→抓取日):**判 PAID 的 46 张中位 143 天**(真的付了)· **判 UNPAID 的 10 张是 `1,1,1,1,1,2,3,10,10,123` 天**。**九张的"未付"说的不是发票,是我们什么时候看的。**
- **我今早报的「未付+已入账 3 张 $23,743 应付账款」全部作废** —— 那三张全是滞后 1 天。现在实跑 **`确认未付 + 已入账 0 张 $0`**。**报警那条($54,899)不受影响**,那 10 张滞后 17–65 天,"已付"是硬的。
- 已修:① `gts_ingest` 每轮**重读所有还挂着余额的发票**(`open_balance_targets`,按缓存里的 `key` 取,不依赖发票列表页 —— 老的欠款单早翻页翻没了)。**自限:余额归零就永久掉出这个列表**,今天 10 页/晚。② 抓取结果盖回缓存前**必须解析出 `total` 且 `items` 非空** —— 登录过期会解析成空壳,盖上去就把 `--commit` 要的行项目静默毁了。③ 重读的发票**不进 digest**,否则同一批货会被当成又到了一次。④ 写 `fetched_at` 时间戳(文件 mtime 不行,复制缓存会把日期全刷掉)。
- `gts_three_way` 现在**拒绝断言它证明不了的事**:余额非零但滞后 ≤7 天 → 归入 **`付款状态未确认`**,不是"欠着"。零余额任何时候读到都算数(读到 $0 就是 $0)。
- **唯一一张"确认未付"经得起推敲的是 `INV01085583 $1,692`(3/9,滞后 123 天)—— 而 `INV01086409`(3/10)是它的完全复制品:同两个品、同数量、同 $1,692,已付清。** 像 GTS 重开了一张、我们只付了一次。**要问 GTS,不能推。**

### ✅ 8/12 映射已做完 15 个,覆盖率 5.5% → 82%(Gary:"A ok / B 都是对的 / C 建立")
- map **9 → 25 个 SKU**;未映射 **61 个 / $78,158 → 46 个 / $16,377**(**金额砍掉 79%**)。已映射金额 **$81,215 / $98,749 = 82%**。
- **`Nct` 是不是倍数,由单价决定,不是固定读法** —— 已确认的映射里:`24ct` 在 Azuki/DBS 整盒上是 **per_unit=1**(盒里 24 包),在 Pitch Black 3-Pack Blister 上是 **per_unit=24**($221 = 24 × $9.21);`144ct` 散包是 144;`36ct`/`12ct`/`6ct` 整盒整袋都是 1。**判法:单价 ÷ N 落不落在那个品类的合理单价上。**
- **我自己设错一个又改回来了**:`UDMMXL24` 起初按 $189÷$15.75 设了 per_unit=12,但**同一家 Upper Deck、同样 `12/16/6` 记法的 `UDMAIT23` @ $119 明明是一盒**,而且 `packs_per_box=20 × $15.75 = $315 > $189` —— 那个 $15.75 自己就站不住。已改回 1。**per_unit 设高会凭空造货,拿不准一律 1。**
- **OP-16 是 EN,不是猜的**:`5f968c16 [EN] OP-16- The Time of Battle Booster Box` 的进货里躺着 **2026-06-09 ×180** 和 **2026-06-10 ×17**,和 `INV01154080`(180)/`INV01153051`(17)的日期数量分毫不差。
- **重复产品不用问人**:`Chaos Rising Booster Box Booster Box` / `Fujimi ... Booster Box Booster Box` 都是"类型词写两遍"的畸形名(加产品零查重造的,全库 19 个),**留干净那个是既定规范**。
- 新建 **`dba53824 2025 Cosmos Marvel Hobby Box`**(brand=Other,照两个 Upper Deck Marvel 同门的形状;**`packs_per_box` 留空** —— 三个同门的 `12/16/6` 记法和它们自己的 ppb 都对不上,推不出来就不填)。**名字故意不写厂牌**:SKU `25KWCM` 的 KW 读起来像 KaKaWow,但没有证据,零库存产品以后改名零成本。
- W2 机械继承验通:`PKU10399W2` 自动跟上,`PKU10422W2` 被描述校验正确拦下(base 写 `6ct`、W2 没写)。

### 🔴 OP-16:197 盒实付 $13,893,系统记 $140(单价打进了总价栏)
```
2026-06-09  x180  cost_usd $70  = $0.39/件    GTS 实际 $70.25/件 = $12,645
2026-06-10  x17   cost_usd $70  = $4.12/件    GTS 实际 $73.40/件 = $1,248
```
- **日期正好在 6/24 那个 unit/total 开关上线之前**,和「问题全部集中在 6/24 之前」完全吻合。缺 **$13,753** 成本。**待 Gary 定要不要改**(行 `69375f04` / `2ef92a6e`,货已清零,改的是历史毛利不是当前估值)。
- **`commit_invoice` 原来会把这 197 盒再入账一遍** —— 它的幂等判据只有"notes 里有没有发票号",而手工录的行没有发票号。**已加 `_already_booked_by_hand()`**:同产品 + 同数量 + 订货日 ±21 天且行上没有本发票号 → 跳过并明说"去改那行的成本,别再写一行"。**故意不比成本** —— 手工行错的正是成本,拿它做 join 条件就永远找不到。实跑全量:**正好拦下 OP-16 那 2 行,放行 26 行**(两个方向都验了,只拦不住的守卫和全拦的守卫一样没用)。
- 另加 `BOOKED_ELSEWHERE = {INV01198587, INV01192197}` 守卫 —— Azuki / Weiss 那两张的成本是**故意直接进库存不插 acquisitions** 的,commit 会把它悄悄反悔掉。`--force` 可越过。
- **Gary 8/12 拍板:老的一律不入账,那 $54,416 不补,OP-16 的 $13,753 也不改。** 已用 `CUTOVER` 钉死(见上)。**映射照样留着 —— 它管的是往后**:同一批 SKU 再来,自动入账。

### ✅ GTS 的真渠道找到了:Frank 和业务员的邮件线程(8/12 上线,Gary:"mrvault的邮件里面有 / 读")
- **`inventory-sync/gts_mail_watch.py`(新,只读,绝不写库)**。读 **mrvault@luckyvault.us** —— **凭证不用新加**:`lv-singles-erp/.env` 里那个 Gmail 应用密码本来只用来发信,**应用密码是账号级的,同一个就能读 IMAP**(只读 EXAMINE + BODY.PEEK)。故意不复制进 `inventory-sync/data/`,免得多一份要轮换的密钥。
- **GTS 不发结构化发票邮件**(`INV01xxxxxx` 和去掉前缀的纯数字,两个信箱四个文件夹全搜过,0 命中)。**但他们发的这个更有用** —— 8/12 当天:
  ```
  Mike Cardoza (GTS) → Franklin:
    "if you'd like 40 pok destined rivals ETBs $71 per, please send $2,849.50"
  Franklin → Mike: "Yes will send asap"
  ```
  **品名 · 数量 · 单价 · 要打的金额,全在纯文本里,而且在钱动之前。** 40 × $71 = $2,840,差的 **$9.50 正是 handling fee**(和发票上那个数一样)。
- **邮件跑在门户前面 0–5 天,已用真数据验**:60 天 7 条打款指令 / 约 $29,465,**3 条能被发票精确凑出**(`$13,286.25 = INV01176454 + INV01177509 + INV01179028`,分毫不差)。**一次打款覆盖多张发票** —— 我第一版按 1 对 1 测,得出"7 中 1",那是拿一对一的尺子量一对多的事,数字是真的但没有意义。
- **凑不出的那条最说明问题**:8/12 那笔 $2,849.50 **根本还没有发票** —— Frank 今天才说要打。**这不是漏检,这就是论点本身。**
- **只读,绝不建 acquisitions**:`40 pok destined rivals ETBs` 是分销商简写,而今天已经证明简写匹配会给自信的错答案(Dragon Ball 被猜成 Pokemon、Chaos Rising 被猜成 Celebrations)。**金额和单价是无歧义的,报出来;认产品这一步留给人。**
- **顺带白捡一个**:Mike 偶尔在邮件里把 SKU 和全名写在一起 —— `BJP2855305 / DRAGON BALL SUPER TCG: FUSION WORLD STORY BOOSTER 01 (20CT)` —— **正是映射队列推不出来的那个展开**,工具会把 map 里没有的挑出来。
- 噪音过滤按主题(Flash Sale / Stock List / Orders Due / New Product / Last Call…),**正向信号锚在 `send $X` 这句打款指令上**。19 个用例,**跑的是从信箱里抄出来的真文本**,其中一条专门验"促销群发里全是数量和金额,但没有 `send $` 就不许当订单"。
- 已挂进 `run_gts_ingest.cmd`。

### 🔴 邮箱查实:GTS 从来没往 help@ 发过发票(8/12)
- **道理是对的**:门户是一个可变页面,只能知道"我看的那一刻它长什么样";邮件是带时间戳、不会变的记录。今天那个 bug 本质就是拿轮询去测事件。**但对 GTS 这条线不成立。**
- 实搜 `help@luckyvault.us`(IMAP,**只读 EXAMINE + BODY.PEEK,不标已读、不碰 lv-inbound-mail 的 cursor**):缓存里最近 8 张发票号 **全部 0 命中**;`INV011` / `INV012` 前缀在 **All Mail · Spam · Trash · Sent 四个地方全是 0**;`from:gts` = 0。**唯一一条 `gtsdistribution` 是 2023 年 Gary 自己发出去的询价。**
- **139 封"GTS Distribution"全是 UPS 的到货通知**(GTS 是发货方,名字跟着运单走),不是 GTS 发的。
- **GTS 门户的登录名是纯用户名不是邮箱**,所以推不出他们档案里留的是哪个地址。**待问 Gary:GTS 发票发到哪个邮箱?**转发到 help@ 或单开一个别名,这条路立刻就通 —— IMAP 那套 plumbing 现成的。
- **✅ 但邮箱里有一个我们没用的信号:到货。** 最近 10 个 GTS 运单号 **7 个在邮箱里找得到**,带 `Your Packages Have Been Delivered` + 时间戳。**这比我们现在用的强** —— 17track 对不钉承运商的号会瞎、fedex.com 对我们已废、`_classify` 出过假 Delivered、`tracking_delivered_at` 还曾被写成 now()。**承运商推给我们的一封信,比我们去问它十次都准。**
- 探针坑(自己踩的):① 通用 IMAP `SEARCH` 在 21k 封里两分钟不返回,**Gmail 要用 `X-GM-RAW`** 走它自己的索引 ② `X-GM-RAW` 的参数里**不能有嵌套双引号**,否则整条命令 `Could not parse` ③ **批量 FETCH 的响应是按序号不是 UID 编号的**(`123 (UID 456 BODY[...`),我拿第一个数字当 UID,结果每封正文都取错了人 —— eBay 的标题配了 ULINE 的正文 ④ `[Gmail]` 是 `\Noselect`,**SELECT 失败会把会话打回 AUTH 状态**,后面所有 SEARCH 直接非法退出,要判 SELECT 的返回值不能靠 try/except。

### 📕 积压封存(8/12,Gary:"货过去的就不管了 我们新开始")
- `gts_three_way.py --close-open` → 当前 10 张 / $54,899 写进 state 的 `closed`(带日期),**不再报警,`--all` 仍看得到**。已验三步:封存后报警清单空 → 摘掉 `INV01131265` 立刻重报 1 张 $6,494(**探测器没被关掉**)→ 还原后归零。
- **但"过去"是对货说的,不是对发票说的。** 我试着按"货还在不在架上"切这 $54,899,切不动:**认得出的只有 $8,127,$46,310 认不出**,因为那些 SKU 正是没映射的那批。而且**我的模糊匹配当场编了一个错答案**:`PU ME04 Chaos Rising ETB` → `Celebrations Pokemon Center Elite Trainer Box`(靠 pokemon/elite/trainer/box 四个词凑过阈值)。**五条"在架上"里错一条**,又一次证明这一步必须人点。
- **所以清单换了单位**:发票积压不再是待办,**在库无成本的行才是**(`cost_recovery_probe.py`:**60 行 / 397 件**,其中 **11 行 / 58 件今天就能用自己的数据补**,49 行 / 339 件查无可查)。这批是**还在架上、卖出去还会报假毛利**的部分,有界、且都是真正还有风险的货。

## 🔴「库存没成本就触发全面 search」——探测器要,全自动匹配不行(8/12,Gary 提议)
- **实测在库无成本:60 行 / 397 件**(在库行共 272,22% 没有成本)。这个探测器该有,条件客观。
- **但自动匹配跨不过分销商缩写这道坎,我拿真数据试过**:GTS 写 `23 MRV ALG INF TRILOGY 12/16/6`,我们叫 `2023 Upper Deck Marvel Allegiance The Infinity Trilogy`。**token 重叠 1/8,分数 0.125**,任何阈值都会漏;Rarity Collection / Celebrations / Destined Rivals / Mega Symphonia 一并漏掉。**这不是字符串距离问题。**
- **更危险的是它会给自信的错答案**:`DBS FW-10 BB [FB10] 24ct` 被猜成 `Pokemon Ball 10 Booster Box`(BB→booster box、10→Ball 10)。**编出来的成本比空着更糟——空的看得出是缺,编的看起来像核验过。**
- **该做的是把人的判断压成一次点选,而且一次管永久**:`gts_map_queue.py` 按金额排未映射 SKU、展开缩写、给候选产品,人 `--set` 确认。**一次映射同时补两个洞**:GTS commit 不再跳过该 SKU + 该产品不再是无成本行。
- **机械安全的部分才自动做**:`--inherit-w2`。GTS 对同一产品的二仓发另一个 SKU(`PKU10425` / `PKU10425W2`,描述只多一个 W2)。**要求 SKU 前缀和描述两条都对上**才继承 —— 已写 2 条 / $5,382,**第 3 条 `PKU10422W2` 被描述校验拦下**(base 写 `6ct`、W2 没写),这正是它该做的。
- 剩余 **61 个 SKU / $78,158 要人判**,但**前 12 个占 71%** —— 工作量是一小时级,不是项目级。
- **搜索要搜证据,不要搜数字。** 优先级:**GTS 发票行(实付)> 同产品进货记录 > 同产品别房间 `avg_cost_basis` > 市价推导(派生,必须标明)**。`cost_recovery_probe.py` 按这个顺序给每一行归类;**查无可查的 49 行 / 339 件就留空**。

## 🔴 GTS 入账 $65,048 从没进过系统 —— 病根比"SKU 没进 map"深一层(8/12,Gary:"这个 gts 也有")
- **`run_gts_ingest.cmd` 自己写着**:"Commit to receivables is a separate explicit step: `python gts_ingest.py --commit INVxxxxxxx`"。**定时任务只做抓取 + 缓存 + 播报,入账要人手一张张跑。**
- 实测:**系统上线(2026-05-01,acquisitions 第一行)之后缓存了 20 张发票,acquisitions 里找得到发票号的只有 2 张**。排掉 Azuki/Weiss 那两张(成本已入库存、故意没插 acquisitions),**还剩 16 张 / $65,048 既没入账也不是有意跳过**。最大三张:`INV01150557 $13,754` · `INV01154080 $12,654` · `INV01136166 $10,166`。
- **所以补 map 只修了小的那一半**。map 修的是"commit 跑了但认不出 SKU";真正的大洞是 **commit 基本不跑** —— 三个月 20 张跑了 2 张。日志里 `UNMAPPED` 出现 **0 次**,不是因为没有未映射的,是因为 `commit_invoice` 几乎没被调用过。
- 口径:`gts_unmapped.py` 默认 `--since 2026-05`。**5 月之前那 $154,589 不能算丢** —— acquisitions 表最早一行就是 2026-05-01,那是系统上线日,不是损失。
- 缓存全量:56 张发票 / $253,337,map 只认得 7 个 SKU / $14,052(**5.5%**)。GTS 这个 vendor 名下的 acquisitions 恰好只有 $13,714,和自动入的金额几乎重合 —— **说明手工录入这条路基本没人走**。抽查金额最大的 6 个未映射 SKU,acquisitions 里一条对得上的都没有。
- **✅ 8/12 已定并上线:nightly 改成已映射的自动入账、未映射的点名报出来**(Gary:"老的不用进系统了 start fresh")。draft-first 是 7/10 定的设计,但"第二步靠人"这三个月跑了 2/20 —— **没人做的第二步不是保险,是漏点**,$54,899 就是这么漏出来的。`--no-commit` 可退回 draft。**只写 acquisitions,`quantity_received=0`,inventory 一件不动** —— 血溅范围仍限于成本/应收这本账。
- **切换点 `CUTOVER = 2026-08-12` 写死在代码里,不是靠记性**:早于这天的发票**永远不入账**(`--force` 才能越过)。实测 **56 张缓存发票全跑一遍 commit,写入 0 行**。
- **幂等改成按行不按发票**(原来是按发票,一张里 5 个认得 3 个不认得,入账后整张判"已入账",**那 3 行以后永远补不进来**)。判据用 notes 里的 `· <SKU> `,**尾部那个空格是必须的**,否则 `PKU10425` 会匹配上给 `PKU10425W2` 写的行。
- 三条都验了(stub 掉 POST,不碰库):**老的进不来 0 行 · 新的进得去 5 行(per_unit 倍数也对:`PKU10419 ×24`、`PKU10424101 ×144`)· 重跑写 0 行但认不出的那个 SKU 仍继续报**。

### 🔴「部分入账」原来长得和「全部入账」一模一样(8/12,Gary:"只要打了钱给 GTS 我们看见了 就应该 trigger 这个流程")
- **判"已入账"原来是看 notes 里有没有发票号 —— 一行入账就把整张点亮了。** 而 ingest 的设计正是"认得的入账、认不出的跳过",**所以半映射的发票必然半入账,而半入账在报表上和做完了没有区别**。
- **改成比金额**:`sum(acquisitions.cost_usd where notes ~ INVxxx)` vs 发票行项目合计(**不用 `total`** —— 那个含 handling fee,永远差几块)。改完当场抓到真的:**`INV01159499` 原来是"已付+已入账"那栏里唯一一张($9,958),实际只入账了 $4,404 / $9,507 —— 一直只记了 46%**。
- **触发点现在自己动手,不只是喊人**:`gts_ingest` 每轮加一道**重试**,把切换点之后**入账金额少于行项目合计**的发票再 commit 一次。治两种情况:上一轮 commit 中途挂了 · 昨晚认不出的 SKU 今早补了映射。**认不出的补不出来**(只能人映射),所以那种情况会把"还差多少"顶进 digest 发出去。
- **封存改成规则不是名单**:切换点之前的一律不报,不再依赖 `closed` 那张表。**`INV01159499` 就是理由** —— 它从没进过报警清单所以从没被封存,判据一变严它就作为"新警报"冒出来,而那批货我们早就决定不追了。**写在名单里的政策会忘,写成规则的不会。**
- 四条都验:两个文件的 `CUTOVER` 一致 · 切换点之前 11 张全封存 · 造一张切换点之后已付没入账的**立刻报出来** · 拿掉后归零。

## 🔴 收货缺口 $44,117 / 357 件(8/12,Gary 一句话点破:"还有的直播间卖了 这应该是一个 receiving 的问题")
- **Gary 是对的,我第一版算错了方向。** 我把出货算成 storefront+platform+在线订单,得出 Storm「多出 54 盒」。**但直播间消耗库存根本不写销售行**(这正是盘点存在的理由),所以一个房间真正卖了多少 = **搬进去的 − 现在还剩的**,不能从销售表读。
- 补上这块之后 Storm 变成:**美国一共经手 193 盒 · receipts 只入账 91 盒 · 102 盒从没走过收货单据**。不是货凭空出现,是**货一直在进在卖,收货这一步从来没发生**。
- **`inventory-sync/receiving_gap.py`(新)** 把这把尺子量到全库:**12 个产品 / 357 件 / 缺口成本约 $44,117**。Storm 102 · Abyss Eye 77 · Mega Dream 45 · Inferno X 22 · Ninja Spinner 35。**这些货卖掉了但没有进货成本,毛利被记高了。**
- **坑:门店销售扣的是 Front Store 不是 Master**,已含在该房间的消耗里,**再从 Master 扣一遍会把缺口多算 19 盒**(我第一版就是这么错的)。
- 这条也解释了为什么"不补库存"的决定仍然对:那 102 盒早卖光了,补进 Master 就是 148 个幽灵。**缺的是成本入账,不是库存数量。**

## 🔴 以后没人点货就自己补(8/12,Gary:"如果以后没有点我们看他们发的消息 我们来补充系统")
- **`inventory-sync/jp_backfill_receive.py`(新)**:发货单已经写明箱子里有什么、承运商说它到了,美国这边没人录就由它补 —— receipts + inventory + acquisition 三个写,顺序和 Intake to Master 一模一样,建出来的行分不出是谁写的。
- **它会拒绝补录,而且这才是重点**。每一行先算该产品自己的美国账:`应有 = 入账 + 调入 − 调出 − 卖出`,**已经多出 >2 件的一律拒绝** —— 多出来的货很可能就是这票没走单据先进的库,再补一次就是重复计。
- 实测 8/10 那票:`OP-13 差 −9 → 可补` · **`Storm Emeralda 差 +54 → 拒绝`**。正是它该拦的那一行。
- 用法:`--list` 看谁欠着 · `--tracking <号>` 看要补什么 · `--write` 才写。
- **一次入库发了 9 条通知,每条 6 行**。9 条全部核实**没有重复入账** —— 病根是**消息按 acquisition 行发,不按"这一票货"发**:运单 `875535947181` 一票拆成 8 个行(Mega Symphonia 拆成 1 和 6、OP-14 拆成 1 和 2),就发 8 条。
- **已改成按会话发一条**(`receive_digest`),按运单分组 + 只印 set 名 + 每行标出还欠多少。**9 条 54 行 → 1 条 21 行。**
- **攒着发不能把消息弄丢**:45 秒空闲 flush + 组件卸载 flush + `pagehide` 走 `sendBeacon`(**要检查返回值**,拒绝时回落 `keepalive` fetch —— StreamCounts 早就这么做了)。**撤销时要把那条从队列里摘掉**,否则会在撤销之后才播报"收到了",而且后面没有任何更正。
- **顺带把被淹掉的那条信息顶到消息末尾**:「已送达但从没入库」的运单。实测当天 —— **`875140436410`(75 盒 Storm,8/01 送达)· `875218962982`(73 盒,8/04 送达)合计 148 盒 / $27,874,至今 0 收货**,而同一天团队在收 8/10 和 8/12 的新货。**Master 的 Storm 是 0,eBay 还在从 Master 发货。**
- **⚠️ 一个待问的疑点**:8/12 当天发出的运单 `875659800743`,30 盒 Storm **当天就标了收货**。JP→LA 实测要 1–2 天。合理的解释是**那 30 盒实际是 LA 躺着的老货,被记在了最新那条 acquisition 上** —— 如果是这样,老运单会永远挂着 0,新到货不断把它们的收货吸走。**要问门店,不能推。**

## ✅ 8/12 单卡入库已打通 + 定为常规流程(Gary:"修 并且未来每一次singles录入 都走这个流程")
- **批次 3eba1cb5cefa 已全部入库**:bump 42 · insert 37 · **79/79 个 tcg_id 现在都有活行,79/79 都有成本**($2,285)。收银台扫得到了。
- **`singles_intake_batch.py` 现在是每批必跑的一步**,不是补救工具。加了 **`--job` 分阶段幂等台账**(`data/singles_intake_applied.json`)。
  - **幂等按 job 不按行** —— 一批里本来就会有同一张卡两张,光看行分不出"真的第二张"和"重放"。
  - **必须分阶段记**:第一次跑 42 个 bump 成功、37 个 insert 全挂,整job台账会让重跑**把 42 个数量加第二遍**(bump 是读-改-写,重放完全无痕)。现在 bump/insert 各自记各自的。
- **一次跑通踩了三个 400,全是猜列型踩的**:① `quantity` 是**整数列**,传 `2.0` 直接 22P02 ② `card_number` **NOT NULL** ③ `set_id` **NOT NULL**。`send()` 原来把 PostgREST 的错误正文吞了,只报 "HTTP Error 400" —— 已改成把 `message` 带出来(`details` 是整行 dump,会把真正的原因挤掉)。
- **`card_number` / `variant` 必须照抄 sync 路由的 `parseCardText`**(已 port 成 Python):它是从**卡名文本**里找第一个像号码的 token 切出来的,所以库里才会有 `card_number = 'Arcanine'`。自己发明会让本地建的行和 cron 建的行长得不一样。
- **`singles.variant` 已被占用**(存 `IR BLK` / `SWSD` / `PR` 这类,951 行),**不能拿 `Printing=Holofoil` 去盖**。印次和来源改写进 `notes` 的可 grep 标记:`PRINTING=` · `PRICE_SRC=` · `JOB=`(照 `RECOVERED_AT_COUNTER` 先例)。
- **套按需建**(照 sync 路由 5a/5b):本批建了 5 个。套名形状难看(`58/102 (Celebrations Metal Card) - Miscellaneous Cards & Products`)但**那是既有约定**,46 个里 36 个早就是这个样子,这里"修正"会把每个套劈成两个。
- **bump 原来只写成本不写市价** → 老行挂着 $0 却被按市价 80% 记了成本(85439 实测:成本 $14.51 / 市价 $0.00)。已改成**市价为空才填,有值不覆盖**(小时级 sheet sync 拥有那个数),存量 1 行已修。

## 🔴 8/12 单卡入库这条路是断的(已修,记录病根)
- **`api/sync-singles-sheet.js` 只插"库里没有的 tcg_id"**(注释原话 "NEW rows (TCG IDs not yet in DB) ARE inserted")。8/11 那批 82 张实体卡 / 79 个 tcg_id 实测:**已有 65 个 → 一个都不插,库里完全没有的只有 14 个**。**同一张卡第二次收进来,Supabase 完全没反应 —— 不插新行也不加数量,sheet 上有、库里没有。**
- **其中 23 个 tcg_id 只剩 sold 行** —— 卡实实在在收回来了,系统里却只有"已卖出"记录。**扫码扫不到,收银台报 "Already sold"** —— 这是门店那个老毛病的**新来源**(和 5/26-7/14 那批遗留是两回事)。
- 实证:**Supabase 里 8/11 和 8/12 新建单卡 0 行**,最新一条停在 8/10。货进来了账没动。
- **本地补库工具 `inventory-sync/singles_intake_batch.py`(dry-run 默认,还没写)**:活行→加数量 · 只剩 sold→**新建活行(sold 行一个字不改)** · 全新→插入(**字段形状直接抄 sync 路由,不自己发明**)。这批算出来:**加数量 42 · 新建 37(只剩sold 23 / 全新 14)· 成本合计 $2,250**。
- **成本口径:当天市价 × 80%**(Gary 8/12 确认沿用 8/10 定的口径)。**已有成本的行不覆盖** —— 派生数不许盖真实成本;**没市价的不填**。
- **🔴 3 张"没市价"的查下来根本不是没有价,是价格被丢掉了**:`scripts/_batch4_ingest.py` 的 `parse_csv` 把 CSV 自带的 `TCG Market Price` / `Set Name` 存进 `csv_market` / `csv_set_name`,**然后全程只用来打日志,从不参与定价**(grep 只有两处 print)。market **只认抓 TCGplayer 页面**;抓失败就整行空 —— 而卡名和套号也来自同一次抓取,所以**一失败三样全丢**,套号空了还会把卡误判成 `modern set ()` 走错分支。eBay 成交填的是**另一列**,永远不会顶替 market(85439 拿到 5 笔成交,market 仍是 0)。
  - 实证三张:`90507 Water Energy EX Emerald` CSV 写着 16.69 · `85439 Fighting Energy` 写着 18.14 · `709972 Chespin-058` 写着 8.39,**而且 CSV 连 `Printing=Holofoil` 都给了** —— 709972 的 TCG Normal 无人挂牌只有 Foil $7.75,我们那条"只认 Normal"的保险在这里**拦错了,因为输入已经写明是闪版,不需要猜**。
  - **已修**:`csv_fallback_card()` —— 抓不到就用 CSV 自己的 name/set/number/price 建行,标 `price_source=csv_export`。**故意不装成抓取结果**:`recent_sales` 留空(导出给的是价不是成交,假造 comps 会绕过 CHECK EBAY)、`set_abbr` 留空(abbr 映射不全,vintage 只能靠猜 —— 宁可少报也不断言)。TSV 末尾加 `printing` / `price_source` 两列(两个消费方都用 `DictReader`,加尾列看不见)。46 用例,**跑的是真的那份 CSV 不是 fixture**。
  - **`scripts/backfill_tsv_from_csv.py`** 修已生成的批次:那三行连**卡名都丢了**(表格上就叫 "103/106"),已补回 name/set/price,回读 82 行**零无市价**。顺手修了 `parse_csv` 只剥带斜杠号码的问题(`Chespin -  058 058` → `Chespin 058`)。

## 🔴 单卡价格有多薄 + CHECK EBAY 标记(8/12 上线,Gary:"有一些价格比较少见的 要推荐他们ebay查价 比如说日本的vintage以及high end")
- **实测所有已完成批次 106 行:3 笔成交 64 行(60%)· 2 笔 9 行 · 1 笔 14 行(13%)· 0 笔 19 行(18%)** —— **我们发出去的价格里三分之一是靠 ≤1 笔成交定的**,而表格上 $515 的卡和 $2 的卡长得一模一样,看不出背后有几笔。**vintage 更极端:25 行里 22 行(88%)只有 ≤1 笔。** Gary 的直觉是对的,而且比他说的更严重。
- 最贵的两张正好在这一档:**Base Set Charizard $515.63 = 一笔成交定价** · **Erika's Dragonair $387.00 = 零笔**。
- **`price_confidence.py`(新,纯函数)** + 32 用例。规则:没市价→must(不看金额)· **high end ≥$100 → 一律要人看**(两边加起来 ≤2 笔 = must)· ≥$20 且 ≤1 笔 / vintage 薄 / 日文薄 → should · **<$20 一律闭嘴**。
  - **两条设计是为了不让它变成墙纸**:① `LOW_VALUE_USD=20` —— $2 的普卡就算零成交也不报,**错的钱比人花的时间少** ② 管线**已经抓到 ≥3 笔 eBay 成交就不再叫人去查 eBay**(vintage/JP 本来就会自动查)。
  - **但 high end 不吃第二条豁免,顺序是特意排在前面的**:$500 的卡上,自动抓来的 comps 正是我们想让人去质疑的东西,不是跳过的理由。第一版把豁免放前面,Charizard 和 Dragonair **两张都被静默掉了**,是拿真数据跑才发现的。
- 落点在 **sheet 的 C 列**(团队真正看价的地方):`=HYPERLINK(<eBay sold 搜索>,"$515.63  <- CHECK EBAY (high value)")`,链接带 `LH_Sold=1&LH_Complete=1` 且 **`-psa -bgs -cgc` 排掉评级卡**(和抓取器的 `_GRADED_TOKENS_RX` 看同一批货)。
  - **坑:标记里绝对不能出现数字,价格必须排在最前面** —— `api/sync-singles-sheet.js:116` 的 `parseDollar` 是 `String(s).match(/[\d.]+/)` **取第一个匹配**,标记里写 "1 comp" 就会把市价读成 1。测试里钉死了这条。
  - **不新开列**:col I 已被 sync 路由当 Status 写。行仍是 8 列,F 列(`_verify_row` 每次写完校验的那列)不动。
- `scripts/price_check_report.py` —— 出「这批要复核」清单,可 `--lark` 跟在"labels are ready"那条后面发。**表格标记会留着,但表格要人记得去开;消息才会撞到人。**
- 实跑 106 行:**标出 12 行(11%),必须复核 3 行,涉及记价 $1,854**。那 3 张 must 正是上面抓价失败的三张(写 `no market price`,**不编数**)。
- 测试:`scripts/test_price_confidence.py` 32 用例(一大半在验"什么时候必须闭嘴")+ `scripts/test_sheet_row_check.py` 18 用例(**跑真的 `build_sheet_row_tsv`**,钉住 8 列 / F 列单引号 / parseDollar 仍读得出价)。

## 🔴 日本发货报告简写 + 运单看守(8/12,Gary:"日本这个report 也简写 只需要set名字 / tracking 记得加入 可以cron检查")
- **报告简写已改(app 侧,待 Codex + 发版)**:`api/lark-notify.js` 加 `shortSetName()`,行从 `One Piece | [JP] THE AZURE SEA'S SEVEN (Case) | Booster Box | JP × 1` 变成 `THE AZURE SEA'S SEVEN (Case) × 1`。**`(Case)` 在 set 名里,所以整箱和单盒仍分得开**(同一条消息里 TIME OF BATTLE 的 Case 和非 Case 并存,已验)。`[JP]` 去掉 —— 日本发来的每一行都是 JP,**非 JP 才是意外,所以只去 JP 这一个标**。发送侧 `JapanShipments.jsx` 加 `setName`,`name` 保留;builder 认不到 `setName` 时**回落切第二段**,老 payload 照样短。
- **缺运单不再静默**:原来 `if (trackingNumber)` 什么都不打,和"这票不需要运单"长得一样。现在明写 `⚠️ Tracking: NOT PROVIDED — nobody can watch this box`。
- **`inventory-sync/jp_shipment_watch.py`(新,只读)**。实测 28 票:
  - **🔴 已送达、系统里零收货记录:3 票 / 156 件 / $28,441** —— `875218962982`(78 件 Storm,8/04 送达)· `875140436410`(75 件 Storm,8/01 送达)· `875084488540`(3 件)。**就是那 148 盒 Storm 躺在 LA、Master 记 0、eBay 还在从 Master 发货的实证。**
  - **判"到没到"必须以入库为准,不以承运商扫描为准**。我第一版只看 `tracking_delivered_at`,报出 **21 票"无到货扫描"**,其中一大半货早就收进 Master 了 —— 17track 对 JP FedEx 号不钉承运商就瞎(见 8/04 那节),**缺扫描说的是我们追踪器的毛病,不是箱子的**。改成"收够了就算 DONE" 之后 21 → **9**。
  - **两个收货来源分开看**:`acquisitions.quantity_received`(计数器,大面积没人维护)vs **`receipts` 按 `acquisition_id` 的真行**(Intake to Master 写的,缺失才是证据)。两者不一致单独列 —— "账没记" 和 "货没收" 要找的是不同的人。
  - 运单号填写率实测 **91/91 = 100%**,notes 里藏号的 0 条。**号一直在库里,是报告没印。**

## 🔴 单卡:库存增长值 vs 花的钱(8/12 上线,Gary:"做一个singles 库存增长值 去对比花的钱")
- `inventory-sync/singles_growth_vs_spend.py`(只读)。近 30 天:**实付 $5,263(其中判定为单卡 $4,030)· 新建单卡 402 行/484 张 · 市价 $13,253 · 有成本的只有 17%**。
- **🔴 最值钱的一条:实付 / 市价 = 30%,而我们入库成本口径写的是 80% —— 差 2.6 倍。** 如果 30% 接近真实收卡价,那按 80% 记成本会把每张单卡的成本记高、毛利记低。两个数各有噪音(钱可能买的是窗口后才扫的卡、卡可能来自拆盒),**但 2-3 倍的差不是噪音**。**待 Gary 定口径。**
- **推翻 CLAUDE.md 原来的说法**:买入行不是只有 "Bulk buy: N cards"。`product_type` 确实 246 行全 null,**但 notes 前缀带品类而且点名了卡** —— `BUY: single — Trubbish IR WHT`(122 行)· `BUY: slab`(7)· sealed(4)。所以"花在单卡上的钱"分得出来,不必拿 sealed 的钱去比单卡。
- **符号约定是查出来的不是猜的**:`buy` 行 **134/134 全负**、`sale` 733 行全正 → 负 = 现金流出;`trade` 两个方向都有(44 负 / 42 正)。**总额只用按 transaction 去重的 `net_cash_usd`**;`sale_price×qty` 只用来做**同一笔交易内部**的品类占比折算(总额用它就是 $151,608 那个错)。

## 🔴 8/12 门店卖出/退货实测(用 app 真代码跑,不是复刻)
- 方法:`esbuild` 把 `src/lib/supabase.js` 打包成 ESM(`--define:import.meta.env='{}'`,文件里 URL/anon key 有兜底字面量)在 Node 里直接调真函数。**复刻只能证明我理解得对,证明不了代码是对的。**
- **退货 = 加新库存,不是撤销销售(Gary 8/12 拍板:就这样,没有更好的办法)**。`processReturn` 实测:一张**从没卖过**的卡扫一下就 `qty 1→2`;不核对任何销售记录;`sale untouched`。落点默认 Master,**但 Returns 页有落点下拉框**(我测试时没传才默认的,不是 bug)。
- **🔴 `preflightStorefrontCart` 原来是 fail-OPEN**:它只校验**认得**的行(`l.single?.id` / `l.slab?.id` / `l.product?.id`),形状不对的行既不产生 blocker 也不产生 source → **购物车通过一道从没看过它的闸门,写入时才崩 = 钱收了货没记**,正是这个函数存在要防的事。我是照 `submitStorefrontTransaction` **自己那行过时的注释**(`productId|slabId|singleId`)传参才掉进去的。**已改:认不出的行 = blocker**;注释也改了。测试 42 passed(原 34 + 新 8,含"正常形状必须照常通过"和"buy 依然豁免")。
- 测试残留:`returns` 表 3 行,notes 全是 `CLAUDE_SELL_REVERSE_TEST`。**这张表没有软删列**,按硬删禁止留着了 —— **任何退货报表要排掉这个标记**。库存已全部还原并回读。

## 🔴 8/12 门店买入侧:钱和卡两条轨接不上(Gary 决定暂不修)
- 近 30 天:**buy/trade 119 行 / 60 笔交易,我们付出去 $5,263**(按 transaction_id 去重算 `net_cash_usd`;**别用 `sale_price×qty` 加总,trade 有来有回会重复计,我第一次报的 $151,608 就是这么错的**)。**行里带 product_id 的只有 38/119**。
- 同期**新建单卡 365 张,有成本的 0 张**。
- 这是**设计上的两条轨**:`StorefrontSale.jsx` 的 buy 行只有自由文本(`Bulk buy: N cards (pending Cards Scan intake)`),卡的身份留给 Cards Scan 后补。问题是两条轨从来没接上 —— **门店记住了钱,Cards Scan 记住了卡,中间没有任何东西连起来**。
- CLAUDE.md 里早就设计过的"Cards Scan 加来源交易下拉" —— **Gary 8/12 明确不做**。

# (以下为 8/11 及更早)

本文件每次会话自动加载 = Gary 要的"运行前 brief"。**每次大改动当场更新此文件,版头日期=最后更新**。
工作区:app 仓库 + `../tiktok` + `LV Agents/inventory-sync`(+ slab-inventory、lv-finance)。老板 = Gary,中文回复,代码/路径英文。**Lark 消息一律英文、段落单换行**(空行被 Slate 转零宽字符 → composer 校验拒发)。

## 🔴 8/10 三件最要紧的(其余细节见下面各节)
1. **`jp_to_us_shipment` 的 85 行成本是重复计的 = $198,879 = acquisitions 总额的 23%**。发货 ≠ 进货,但这些行每行都带 cost。铁证:7/31 那张运单 75 盒记 **¥28,998**,而 7/30 供应商真实进价 **¥28,999** —— **差 1 日元,是把同一个进价抄了一遍**。连带 `avg_cost_basis` 被最后一张运单覆盖(日本仓 Storm 189 盒记 $162.70,真实均价 $123.79)。**待 Gary 问清这些行是谁建的、为什么带成本,再动。库存数量没受影响(inventory 是另一张表),中毒的只有成本/毛利。**
2. **singles 有 783 行是 7/28 实物 audit 找不到的货,系统里仍显示在库**(871 件 / 记价 $16,253,793 件挂 Front Store)。VPS 侧当天把 Master sheet 从 1,272 张 full-replace 成 150 张,而 `api/sync-singles-sheet` **只同步价格 + 插新行,从不删行** → sheet 改对了、Supabase 一行没动。**实证:这 783 行 100% 建于 7/28 之前,7/28 之后建的 0 行。** app 读的是 Supabase 不是 sheet,所以收银台仍能扫出来卖。
3. **门店拆卖修复至今没上线**。`20f1d5b` 在分支 `fix/storefront-checkout-integrity`,**未合并进 main → Vercel 没部署**。`shouldSplitSingleRow`、`sold_override` 在 main 上都不存在。Codex 三轮审完判 SHIP,34+12 用例过。**只差一次 merge。**

## 8/10 定的口径与新上线的东西
- **价格是动态的(Gary 8/10:"7/30的是当天的价格 是贵的 我们价格会dynamically 变化")**。所以 **"成本 vs 今天市价" 量的是市场漂移,不是买得好不好**,两个问题必须分开叫;判断买入质量只能用**买入当天**的市价。这条反过来证明 buy_requests 里 `market_price/market_ratio` **存快照不实时算** 的设计是对的 —— 不存快照,比值过两周自动变成假的。
- **日本进货均价(只算 `jp_vendor`,已排除上面那批重复行)**:密封整盒 **1,677 盒 / $202,471 / ¥18,019 一盒($120.73)**;拆封盒 ¥14,767 · In Bag ¥12,480 · 散包 ¥372 · 整箱 ¥220,053。**最近一周 Storm 实际进价 ¥17,999–18,999,今天買取 ¥18,500 → 93–103%,买得很准**;均价被 7/30 那 248 盒(¥29,000–32,000)拉高,那是当天的市场价不是买贵。
- **slab 成本一律留空(Gary 8/10)** —— 很多评级卡是我们自己送评的,没有成本核算系统,硬填就是编数据。**单卡成本 = 入库当天市价 × 80%**(Gary 8/10 定;之前 TCG×0.8 回填 50 行是同一口径)。
- **kaitori 映射已钉 16 条 + Storm Emeralda 补了 sheet 行**(POKEMONJapan `A48:B48`)。`ストームエメラルダ` 原本 4 条全 null —— **不是没人钉,是 sheet 上根本没有可钉的目标**,而板子每天都在报价。现验证:`買取 ¥18,500 (Runto 8/10)`,Abyss Eye ¥8,200 / Inferno X ¥20,500 / Mega Dreams ¥13,600 一并接通,匹配行数 44→48。**坑:`resolve()` 里 `if title in ja_map: return ja_map[title]` 在 substring fallback 之前,所以一条显式 null 会主动挡掉本来能匹配上的名字。**
- **eBay `_is_multi_set` 补了宝可梦日版 M 系列**(`scripts` 外,`inventory-sync/ebay_bin.py`)。Storm 报 $82.99 是"菜单挂单"(`M1S M1L M2 M2A M3 M4 M5 M6` 一条标题堆 8 个套),修完 **$124.97**。**代号必须带 `\b`** —— 单字母 `m` 不加词边界会把 "Team 10" 认成 M10。14 用例。
- **EN sealed 每日行情已开始存**:`inventory-sync/price_watch.py` → `data/pricing_hist/YYYY-MM-DD.json`,挂在 `master_check_pipeline` **stage1 之后、Codex 之前**(表写不写和市场怎么走是两回事;Codex 挂了那天行情一样真实),整段包在 try 里(**watchdog 不能搞挂它监视的管线**)。同时存 `market`(TCG 原始)和 `value`(我们推导的),不合并。日对比搭在管线原有发送闸门上,不新开 alert。
- **`master_check_pipeline.stage1_price` 原来是 `print(r.stdout[-2000:])`** —— 7/03 起每天只留表格尾巴约 16 行/170,表头 39 次运行只出现过 1 次,**日志因此永远无法回读成价格序列**。已改 `[-20000:]`。抢救出来的残余单独放 `data/pricing_hist_partial.json`(21 个产品有完整 39 天),**故意不进 `pricing_hist/`** —— 16 行的快照混进 170 行的序列会让每天报出 154 个"新产品",比没有更糟。
- `kaitori_board_history.json` 加了 `_meta` 时间戳(顶层单独 key,进日期逻辑前先 pop,prune/上一天计算不受影响),记的是数据自己的 `ts` 不是渲染时刻。

## 🔴 lv-singles 服务修复 + 写入器重写(8/11)
- **`lv-singles.luckyvault.us` 502 的两个真病根,都不是 Gary 关的那三个任务**:① `LV Singles Webapp` 任务的 **WorkingDirectory 是空的**,而它跑 `python -m webapp.main` —— 从 System32 找不到模块,`LastTaskResult=1`,**从 8/06 20:58 起每次都失败** ② **根本没有 singles 的隧道任务**,跑着的 cloudflared 挂的是 `config-slabs.yml`,所以哪怕 webapp 起来了公网还是 502。
- **这套东西 100% 跑在 Gary 本机**(FastAPI :8080 + AdsPower + Cloudflare 隧道只做转发),**没有 VPS**。`lv-singles.luckyvault.us → localhost:8080`,配置 `~/.cloudflared/config.yml`。
- 已建两个新任务:**`LV Singles Tunnel`** + **`LV Singles Webapp Fixed`**(登录时启动、失败重试 3 次、WorkingDirectory 设对)。**旧的 `LV Singles Webapp` 删不掉也停不掉 —— 它的 RunLevel 是 `Highest`,改它必须提权;但新建任务不需要提权。** 它一直失败所以无害。
- **🔴 写入器的 gviz 差一行是会删数据的(8/11 查实)**。`sheet_streamer` 原来用 gviz 定位空行,而 **gviz 会丢掉中间的空行**,行号从此和真实 sheet 对不上。8/11 那批算出的"下一个空行 A777",**真实 777 行上坐着一张 $1,190 的 Mega Gengar ex**;而 `_row_is_empty` 查的是同一个 gviz 视图,**看的是另一行**,所以那道"绝不覆盖已有行"的保险形同虚设。**是粘贴一直失败才挡住了这次覆盖。**
- 写入原本走 **`pyperclip` + 浏览器合成 Ctrl+V**(`_paste_at`),依赖剪贴板所有权和窗口焦点,**失败时完全静默**。已全部改成 `sheets_api`(服务账号,真实行号,`read_range` 保留空行为 `[]`),**不用浏览器、不用剪贴板、不用焦点**。对外接口 `open/_paste_at/write_row/close/next_row` 一个没变(5 处调用方)。测试 `scratchpad/test_writer.py` **6/6 过**,关键一条:`_row_is_empty(777)` 现在正确返回 False。
- **坑:`sheets_api.append_rows` 的两个默认值对我们是错的** —— `last_col="I"` 而我们的行是 8 列(A–H),会串列;`max_scan_row=1000` 而 New Singles 已经 860 行,**扫描上限用满时 last_filled 会卡住,下一次 append 直接覆盖真数据**。`sheet_streamer` 里设了 `SCAN_ROWS=20000` 并在触顶时抛错。
- **8/11 那批的抢救**:79 张 CSV / 82 张实体卡,**查价 79/79 全成功、写 sheet 79/79 全失败**。价格一直在 `data/webapp_<job>.tsv` 里,所以**没有重跑那 26 分钟** —— 新工具 `scripts/push_tsv_to_sheet.py` 直接把 TSV 推进 `A778:H860`,回读 83 行零错,市价合计 $2,812。标签 PDF 82 张本来就生成好了。
- 坑:**tab 名 `New Singles ` 尾部那个空格是真的**;写成 `New Singles`(无空格)时 **gviz 不报错,而是静默返回 `Master Singles` 的内容**。
- 群里已发两条(Gary 批的):提交时 "batch received / running / expect a few hours",完成后 "82 cards priced and written / labels are ready"。**"完成"那条只能凭回读的实数发,不能凭 job status —— 8/11 那批 status 是 DONE,而 sheet 上一行都没有。**
- **端到端验过(job `7d721e740004`,两张自家卡)**:`sheet tab: 'New Singles' → 'New Singles ' (按 gid 反查)` · `next free row A861` · 两张都 `WROTE ✓verified` · 价格对得上参照(Sewaddle 旧 NM $20 → 新 $19.63;Espeon & Deoxys GX 旧 $115 → 新 $112.50)。**同一时刻旧代码瞄准的是 A860,那上面是刚写进去的 Arcanine。** 测试行已清(A861:H863),Supabase 未产生重复。
- **重写时我自己引入两个回归,是测试抓出来的不是看出来的**:① `import sheets_api` 抢到了 **slab-inventory 那个同名模块**(webapp/main.py 把它加进了 sys.path),会往 slabs 的表写 —— 现在用 `importlib` 按文件路径加载并**校验 SHEET_ID**;② tab 名用了 job 里存的 `New Singles`(少尾部空格),API 直接 `Unable to parse range` —— 现在**用 gid 反查真实 tab 名**。
- 日志:`run_singles_webapp.bat` / `run_singles_tunnel.bat`(20MB 滚动 + 启停时间戳),任务已指向它们。之前计划任务直接跑 python,stdout 丢失,连"邮件发没发"都查不到。
- **🔴 两个运维坑(8/11 各踩一次)**:
  1. **杀进程的过滤条件写成 `-notlike "*slab*"` 挡不住 slabs webapp** —— 它的命令行就是 `python.exe -m webapp.main`,**"slab" 只出现在工作目录里**。我因此把 8081 杀了,`lv-slabs` 502 了一阵。**按端口或 PID 杀,别按命令行关键词。**
  2. **cloudflared 硬杀重启后,Cloudflare 边缘会有几分钟不往新连接器路由**。症状很好认:`ha_connections 4` 且 `request_errors 0`,但 **`cloudflared_tunnel_total_requests 0`** —— 连接器健康却一个请求都收不到,公网 502。**这时别再重启(我连着重启 4 次反而拖长了),等就行。** metrics 在 `127.0.0.1:20242/metrics`。

## 单卡定价(8/10 大改)
- **VPS 侧 singles 三个任务 Gary 已全部 Disabled**(`LV_Singles_Daily_Price_Refresh` 5am / `LV_Singles_Webapp` / `LV_Webapp_Watchdog`),查价号 k1bkogcy 已关,隧道还在(公网 502 是预期)。恢复见 `prompts/singles_handoff.md`。**所以从 8/10 起单卡价格 100% 不再更新。**
- **`market_price_updated_at` 不能当新鲜度用** —— 它只在价格**变了**才盖新戳,价没变的行看起来"15 天没更新"其实是当前价。我拿它得出"每天只刷 30 行"是错的,Gary 纠正后实查:`/api/sync-singles-sheet` **每小时**跑(vercel.json),sheet↔Supabase 价格 **555/557 = 100% 一致**;Master Singles 的刷新日期列(表头写着 `Status`,**H/I 与表头错位,信数据不信表头**)264 行里 262 行 = 当天。
- 两张 sheet 的分工:**Master Singles 263 行每天刷** · **New Singles 785 行日期停在 6/09–6/12,不在刷新范围** · 另有 **783 张两张都不在**(即上面那批 audit 孤儿)。
- **`inventory-sync/singles_price_refresh.py`(新,默认 dry-run,还没写过库)**:走 `mpapi.tcgplayer.com/v2/product/<id>/pricepoints`,**纯 HTTP、不开浏览器、不占 AdsPower**(VPS 那套是 AdsPower 抓页面,和本地邮寄追踪抢同一个 k1bkogcy)。783 张 39 秒。三道防线,每道都是被真数据打出来的:
  1. **优先 Normal**。`marketPrice: null` 只代表**当前没人挂**,不代表没有这个印次 —— 拿闪版价填,$9 的 Clefable 会变成 $122(+1256%)。
  2. **卡名带 `ex/GX/V/VMAX` 的认闪版**(这类本就无普通版)。印证:Mega Charizard X ex 库里 $786 vs 闪版 $716(-9%)、Umbreon VMAX $292 vs $287(-1%)、Marshadow & Machamp GX $234 vs $233(-0.1%)。
  3. **0.25x~4x 熔断**(抄 sealed 那条管线的 `0.4x-2.5x guard`)。拦下 `Umbreon ex $1.00 → $1,480.32`(1,480 倍)—— 这种幅度不是涨价,是身份对不上。
  结果:**可写 591 / 待人工 63 / 只有闪版有价不写 128 / 取不到 1**。
- **🔴 但还不能写**:591 行里大面积是 **+200~300%,规律太整齐**,不像市场变动。品相解释不成立(1,343 行里只有 4 张卡名带品相标签,`condition` 列全是 NM)。**验证方法(只读):拿 sheet 里那 560 张跑 `--include-sheet`,和 VPS 管线定过的价对照 —— 对得上说明方法没问题、那 783 张确实是旧价;对不上说明我的方法有系统偏差。**
- 坑:`singles` 的市价列叫 **`current_market_price_usd`**;sheet 的 `Market $` 是**取整**的(`$1,139`/`$491`),整数不代表是人手填的占位符。

## 进货成本闸门(8/12 上线,Gary:"我觉得可以拦截 thats why these is the gate")
- **app 侧 `feat/intake-cost-sanity` 分支**(未过 Codex):`src/lib/costSanity.js`(纯函数,**测试跑真代码不跑副本**)+ `fetchCostReference()` + `PurchasedItems.jsx` 提交前比对。
- **超出 1/3 ~ 3 倍 = 硬拦**,弹窗**没有"我知道对的,提交"按钮**。出口两个:改数字,或 **"送后台复核"**(采购照存,行上打 `COST_FLAGGED`)。**没有出路的闸门,结果不是填对,是编一个能过闸的数字** —— 那比原错更糟,因为看起来是核验过的。
- **"判不了"是独立结果,不是通过**(Gary 戳出来的洞):我第一版"没参照就闭嘴",而 **FB03 在 6/13 正是第一次进货、没有任何参照 —— 会被静默放行**,正是它要抓的那一行。现在打 `COST_UNVERIFIED` 标 + 进待办。标记写进 `acquisitions.notes`(没列可加,照 `RECOVERED_AT_COUNTER` 先例,可 grep)。31 个测试,**一大半在验"什么时候该闭嘴"**(涨价2倍不报/买便宜一半不报/边界值不报/没参照不报)。
- **服务端复查 `inventory-sync/intake_cost_watch.py`(只读,不用发版)**:对最近进货跑同样判定,**绕开 app 手工建的行也照抓**。**不比 `avg_cost_basis`(刚录的进货已被算进均价,等于自己给自己打分),只比钉价市价**。按买手分流通知(Frank 有 Telegram;Will/JAY/Mario 没有 → 只发 Gary 并写明"没送到本人")。每条只通知一次,**不让告警变成墙纸**。
- **实测:近 30 天 0 条命中**(6/24 上线的 unit/total 开关确实在起作用);**拉到 100 天抓到 54 条**,证明探测器没坏 —— **"什么都没找到"也可能是探测器坏了,必须验**。
- **`price_mode` 早在 6/24 就做了**(Gary 8/12 提的"团队只会算每个单独多少钱",默认就是 `unit`,保存时 ×qty)。FB03 是 **6/13** 的单,**早了 11 天**。问题全部集中在 6/24 之前。

## 日本买取日报(8/12 上线,Gary:"通过telegram 给日本团队发 这样美国团队不需要知道")
- `inventory-sync/kaitori_jp_digest.py` → **点对点发给 Hwa + Gaoyuan,不进任何群**。全量 48 个产品:**套号 + 日文名 + 買取价 + 前日比**,表头写買取店和シュリンク状态。**不发我们的进价**(Gary 8/12 定)。
- 套号来源两条:`kaitori_set_codes.json` 的规则表(宝可梦)+ **从日文标题的 `【OP-15】` 直接抽**(海贼王,不用一套一条规则去维护)。**已补 `storm emeralda → M6`**(备份 `.bak_0811`)。
- **坑:日期取自 history、价格取自 `kaitori_prices.json`,两边不同步就会拿一天跟自己比然后报"0 个变动"** —— **"没变动"和"没抓到"长得一模一样**。已加一致性校验,对不上就明说这天数据没抓全。

## 🚨 数据命脉铁律(Gary LOCKED)
- **实查实报,永不虚报、不反推**;sleeved pack / booster pack / booster box 三种产品三种价。
- 成本来源:进货发票 > kaitori 买取(JPY→USD 用 `jpy_to_usd_rate()`,是除)> eBay SOLD 中位 > TCG 市价。挂牌:TikTok/Shopify **≥ TCG 市价+5%**(Gary 7/23;shopify_daily_reprice 已加 tcg_market 下限,ref=min(mkt,sold) 不许把挂价拉到市价下);卖价永不低于成本。
- **定价铁律(Gary 7/24"不能一直模糊搜索"):sealed-master 钉 id 制** — 自动写价只认 `slab-inventory/data/sku_urls.json` 钉住的 TCG product id(285 条);模糊名搜只当钉价候选证据(erp_pricing 返回 `pinned` 字段+UNPINNED flag,reprice 未钉=只报不写)。钉前必验:名称+语言(DB lang / 标题 / 实拍图三对齐,已四次抓到 EN/JP/CN 错配)+价位合理。无 TCG 线(CN 全部、JP OP 盒=kaitori、Kayou/UpperDeck/JP 玩偶周边)→ 130point 周一(名单剩 7 个)或人工。
- **卖出铁律(7/23)**:卖出 = status=sold + 全套 sale_date/price/channel/fees/transaction_id,**行永不删**。日巡哨兵抓"sold 无信息"半截账。
- **删除铁律(7/23)**:只许软删(deleted + deleted_reason + 删前快照),硬删禁止;**不编数据**(假日期/假价格禁止,查无可查就留空)。
- **单位铁律(8/19,Gary「sku 需要 unit」)**:**每个 SKU 必须写明「一件是什么」**(`unit`)**和「一件含多少个最小单位」**(`base_units`)。**猜不出来就挡住入库并点名,绝不静默默认成 1** —— 静默默认正是 In Bag 30 倍、Case 12 倍、Collection Box 2.3 倍、TikTok 10 倍/84 倍这五起事故的共同执行路径,而它们**钱全是对的**,金额级对账永远抓不到。详见开头那节。

## Supabase(数据真源)
- Keys:`inventory-sync/data/_supabase_keys.json`(anon 可读写;DDL = William)。
- PostgREST 坑:1000 行必分页;空格用 `quote(p, safe="?&=.,*()-")` 勿双重编码;uuid 列无 like;products 列叫 `type`;**写完必 readback,批量写前备份 JSON**。`tps.sq`(tiktok_push_stock)自带完整分页**勿再套 offset 循环**、且不编码要先 quote。
- 表:`products` · `inventory`(数量原地覆盖**无变更 log** — audit-log SQL 待 William)· `locations` · `movements`(Transfer/Intake)· `box_breaks`(拆盒:sealed−N / pack+3N 全在 Master,pack 成本=盒成本÷packs_per_box,照 BreakBox.jsx 语义)· `stream_counts`+items · `acquisitions` · `slabs`(软删字段全:deleted/at/reason)。
- 房间:Master `1f68249f` · PH=Packheads `c995d0a6` · RocketsHQ `eeff0769` · LVUS `12293f16` · SlabbiePatty `04b32948` · **PokeCasino(原Whatnot,channel/sale_channel 存库值仍 'Whatnot'/'whatnot')**`ac9c06c4` · PokeAuctionHouse `1028e0f9` · Front Store `c4cf3dab`;共 23 locations(Sold 虚拟房有遗留怪名,勿用)。
- **🔴 分工:eBay 两个直播房(e1/e2)的运营/盘点安排找 Mario,不找 Frank**(Gary 8/21:「不该给frank提醒 ebay给mario」—— 我把 e1 没点货的提醒发给了 Frank,已补作废并转发 Mario)。
- **团队口头叫法 ≠ 房间名,推不出来只能问**(Gary 8/17 定):**`ebay1` = `Stream Room - eBay LuckyVaultUS` `12293f16`** · **`ebay2` = `Stream Room - eBay SlabbiePatty` `04b32948`**(Gary 8/18 确认)。库里没有任何房间叫 "ebay1"/"ebay2",而带 ebay 的有四个(两个直播房 + 两个 Sold 虚拟房)—— **猜错就是把货记进另一个直播间**。Gary 8/17:"你下次可以提问他" = 叫法对不上时直接问下单的人,别挑一个。**8/18 我按排除法推出 ebay2=SlabbiePatty 是对的,但仍然先摊开假设让 Gary 确认才写 —— 推得对不等于可以自己定。** 两个号已钉进 `lv-finance/tg_move.py` 的 `ALIAS`(`ebay2` 不钉的话直接解析不到,裸 `ebay` 则命中 4 个房)。

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
- **🔴 TikTok 的 `quantity` 数的是 listing 不是实物件数,倍数在 `sku_name` 里(8/11 查实)**。实证:OP-13 blister 一行 `sku_name="5 PACKS" / sale_price=114.99` —— 当成 1 件就是 **$137/片**(我们成本才 $17.25–19.50,差 7 倍),按 5 片算是 **$22.94/片**,对得上。**金额一直是对的,件数一直偏低。** 这就是 `tiktok_product_map.units_per_listing` 那一列的用处。
  - **坑中坑:裸数字的 `sku_name` 是坑位号不是数量**。`$1 Dollar Start Packs` 每个 lot 用坑位号当 sku_name,当成数量后 84 个 listing 变成 **3,570 件 —— 平均 42.5,正好是 1..84 的平均数**,一眼看穿。现在**只认带单位词的**(`5 PACKS`/`3 BOXES`/`10 PCS`),裸数字一律记 1 并计入"未知倍数"计数,**件数只报下限,不猜**。
- **8/11 新上线 `inventory-sync/tiktok_daily_sales.py`(只读,不写任何销售行)**:三个店的当日成交 vs `platform_sales` 实际入账,差额直接印成 `UNRECORDED: $X`。已挂进 05:40 日巡(`tiktok_sales(lines)`,整段包 try + `--no-tiktok-sales` 可关 —— **报表不能搞挂它监视的管线**)。每日快照存 `data/tiktok_sales_hist/YYYY-MM-DD.json` 攒成序列。首日(8/10)**353 件 / 商品价 $24,422 / 入账 $0**。坑:①`lark_send` 没有 `send()`,函数是 `post_by_name(msg, chat_name)`,而且**发群是对外的,必须显式 `--lark "群名"` 才发** ② 本机**没装 tzdata**,`ZoneInfo` 会假装成功后崩,所以自己按美国 DST 规则算 PT 偏移(写死 −7 到 11 月就错,和 `tracking_delivered_at=now()` 同一类 bug)③ 取价只认 `sale_price`/`original_price`,**取不到就报"N lines with no price",绝不当 0**。
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
- **~~`(In Bag)` 那 278 个是盒不是包~~ —— 8/18 Gary 纠正:是「垃圾袋」**,一整盒的包拆出来装袋、盒子扔掉,所以 **1 袋 = 30 包**(见 8/18 那节)。当时判「和整盒同价位带、绝不是 1 包」是对的,判「是盒」是错的;`type=Pack` 也不算错,**真正错的是 `packs_per_box` 存成了 null**。
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
- **`apply_orders_to_inventory.py` 早就写好了这套**(订单行→movements 到 `Sold - *` 虚拟房→扣库存→`tiktok_applied_lines` 幂等台账,只认 `reviewed=true` 的映射),四张表 `tiktok_orders/order_items/product_map/applied_lines` 至今没建,DDL 在 `scripts/add_tiktok_order_sync_2026_08_05.sql`(含 `reviewed` 未审不生效的 CHECK、`units_per_listing` 处理 10-PACK listing、`is_slot` 标记拍卖坑位、补建 `Sold - TikTok Packheads` 房)。
- **🔴 但 8/11 实跑 dry-run 推翻了"缺表是唯一阻塞"这个判断**(`scratchpad/tiktok_apply_dryrun.py` + `tiktok_room_truth.py`,只读)。三件事按顺序:
  1. **`data/product_map_staged.json` 85 条映射 `reviewed` 全是 false** —— 而脚本只认 true。**四张表明天建好,能扣的行数也是 0。** 真正的关键路径是复核那 85 条,不是 DDL。
  2. **直接补跑历史订单会把同一批货扣两次。** 近 14 天 PackHeads 只有 12 个映射产品有成交,其中 **10 个扣下去会变负**。查实原因不是映射错,是**盘点早就把这些房写到 0 了** —— OP-06 盒 `12→0`(8/04)、OP-10 盒 `7→0`(8/04)、PRB-02 `1→0`(8/07)、OP-04 盒 `6→0`(7/18),形状全一样。**盘点已经在充当销售扣减机制,库存数量其实是对的。** 所以上线必须带一个 **cut-over 时间戳,只认切换之后的订单行**;往前追等于毁真库存。
  3. **真正缺的是钱不是量。** 那 12 个产品 `platform_sales` **全部 0 条**。
- **🔴 TikTok 收入黑洞实测(8/11,`scratchpad/tiktok_revenue_gap.py`,近 14 天已排除 CANCELLED)**:PackHeads 1,336 单 / 1,688 件 / 商品价 $110,156 · RocketsHQ 396 单 / 423 件 / $7,603 · VaultTcgAuction 762 单 / 762 件 / $9,656 → **合计 2,873 件 / 商品价 $127,414(含运费税 $141,347)**。同期 `platform_sales` **0 行**;全表 155 行最后一条停在 **7/27**(eBay 111 / TikTok 31 / Shows 13)。**两周 $127,414 卖出去,系统里一分钱收入没有。**
  - 自查过口径:取价函数的"回落到订单总额"分支 **0 行触发**,不存在多行订单重复计价。两个数差 9–15% 是运费+税,`sale_price` 是纯商品价 —— **报销量用商品价,报客人付了多少用订单总额,别混。**
  - PackHeads 件数三分:**映射到 SKU 的只有 86 件**、有名字但没映射 843 件(37 个标题)、拍卖坑位 760 件(永远归不到 SKU)。最大的未映射项正是 **OP-13 blister 171 件**、Marvel Masterpieces 91、CN jumbo 68。
- **`apply_orders_to_inventory.py` 上线前必须补的坑(8/11 读码查出,均未修)**:① 无 cut-over(见上)② `limit=2000`/`5000` 硬截断,踩 PostgREST 分页坑 ③ 扣库存是"读了再写绝对值",**无乐观锁**,并发会丢写 ④ **无负库存下限**,违反铁律1 ⑤ movement+扣库存写完才写台账,中间崩了下次会**重复扣** ⑥ `PH_ROOM` 写死,RocketsHQ / VaultTcgAuction 两个店根本没处理 ⑦ **全程不写 `platform_sales`** —— 就算跑通了,$127k 那个洞照样在。

## 🔴 8/12「sealed 有没有 20 万」查实:美国 $104k,不是 $200k(Gary:"我们sealed没有20w美金吧 真的有吗")
- **重算:25,672 件 / $194,436** —— 但件数是假的。**18,000 件来自今早 02:33 的一条录入错误**(见下),扣掉后 **7,675 件**。**其中日本仓 $90,484,美国能卖的只有 $103,951。** 8/7 那个 "$223,990 / 10,777 件" 一直把日本仓算在里面。
- **✅ 已修 `e95aeedc`**:`qty 18000 · cost ¥54,000 · origin jp_vendor`。**¥54,000 ÷ ¥18,000 一盒 = 3 盒**,同日另一条 `63 盒 @ $120.60` 印证。**有人把日元单价打进了数量栏**,和 8/5 的 OP-09(`530×$2` 应为 `2×$530`)同一类 —— **总价对、银行对、批次总额也对,只有单价抓得到**。已改 qty/recv 18000→3,日本仓库存 18,222→225,均价 **$1.87→$151.45**;**金额一分未动**(钱真花了、3 盒真到了,错的只有件数)。备份 `storm_18000_backup.json`,乐观锁 + 回读通过,notes 打 `FIXED_QTY_FLIP`。
- **全库扫同类:40 行单价低于同产品中位 10 倍以上**,大部分在 6/24(unit/total 开关上线)之前;**之后还有 4 行**:`6/24 Journey Together 150×$0.04` · `8/04 others 870×$0.07` · `8/12 Storm 18000×$0.02`。**闸门按 1/3–3 倍判,$0.02 vs $120.60 是 6000 倍,本该拦下** —— 但 `origin=jp_vendor` 这条路可能不走 app,`intake_cost_watch.py` 就是为这个写的,该让它跑起来。
- **⚠️ 差点误报**:`[EN] OP-11 盒 @ $566.67` 我一眼当成错的,查了才发现两笔进货互相印证($27,200/48 和 $550/1),而且和 `[EN] OP-09 盒 $579` 同价位带。**英文海贼王盒本来就是这个价。**

## 🔴 日本仓:件数完全不能信,而且它只进不出(8/12,Gary:"日本没有那么多货物 / 可能是日本拆了")
- 扣掉两条已证实的错录后,**日本仓真实约 1,854 件 / $81,791**(账面 20,724 件)。**Storm 一个套占日本价值的 87%**(222 盒 + 311 In Bag + 108 Unsealed ≈ $71k)。
- **🔴 `movements` 里进出日本仓的记录是 0 条,一条都没有** —— 而各行 `last_updated` 从 7/24 到 8/12 都在动。**每一次变动都是直接覆盖数字,零留痕**,所以日本仓的数字等于"某人最后一次打了什么"。
- 账实差 **4,894 件 / 按买入价 $99,791**,按形态:**整盒 365 件 $45,155 · 拆封/开盒 293 件 $25,558 · In Bag 272 件 $19,246 · 散包 3,964 件 $9,832**。**散包占 81% 的件数但只占 10% 的钱;钱在盒上,而 Abyss Eye 一个套就 $65,732。**
- **拆盒能解释便宜的那一半,不能解释钱那一半**。我第一版说"拆盒不能解释"说过头了 —— **拆盒 + 再把包开掉做单卡,这个两步序列确实能让盒和包一起变少**。但 `box_breaks` 全表只有 **2 行,都在 Master,日本 0 行**。而 **Storm 几乎完全对得上**(散包 560 买 560 存、In Bag 311/311、Unsealed 142−34=108),**说明不是整个日本仓都乱,只是没人记**。
- **结论:两个问题分开处理。** 散包 $9,832 认了(开包做单卡是真实业务,几个月无痕迹,补录就是编),只管往后记；**盒 $90k 要答案不要解释 —— 日本那边有人今天就知道,去问**。
- **结构上只有一个 bug 造成两个问题**:`jp_to_us_shipment` 发货**新建一条 acquisition**,既不扣日本库存、又把成本重复计一遍(那 $198,879)。**修发货这条路,日本只进不出和成本翻倍一起好。**
- **顺带接上单卡成本口径那个悬案**:如果单卡有很大一部分来自日本 ¥372 的散包($2.36/包),那 80% 市价的口径一定错,真实成本应是**包价 ÷ 每包卡数** —— 和实测「实付/市价 = 30%」对得上。

## ✅ 找到日本那张 Base:24 张表,我们三个月只读了 1 张(8/12,Gary:"日本只有一个表 你看看别的tab / 订单-直播 在这个表里面")
- Base **`Y3lzbr740aZhLJsTbqejMVu0p8f`「dreamstar办公一张表」**,日本租户自己的 Lark 应用(`LARK_JP_APP_ID`,**有 bitable 权限**,和美国那个自建应用不是一个)。**`jp_base_api.py` 从 8/05 起只读 `tbl6wTXAxwC6nDIs`(财务账本)一张,另外 23 张从没打开过。**
- **日本的账是完整且平的**,`库存表` 114 个 SKU:**入库 27,868 = 出LV 17,897 + 出订单 3,021 + 出调货 151 + 出直播 6,315 + 库存 484**。
- **🔴 这就是我们那 4,894 件缺口的答案:日本有四个出库口,我们的系统只认得一个。** `jp_to_us_shipment` 对应他们的「出库(lv)」;**「订单」「直播」「调货」三个口(合计 9,487 件)我们连概念都没有**。所以不是货丢了,是**我们的模型里没有这三条腿**。
- **他们自己记的库存是 484 件** —— 我们的日本仓写着 20,724(修完 2,724)。**Gary 那句"日本没有那么多货物"以他们自己的账为准是对的。**
- 关键表:`直播`(59 场逐场 P&L)· `库存表`(114)· `入库表`(1,323,**有一列 `lv系统记录`**)· `出库表（lv）`(244,带 `买取平均价/盒`+`买取总成本`)· `出库表（订单）`(27,**tax成本/提现手续费/物流成本/毛利率/利润率/HWA收入/lv收入/HWA是否分成**)· `成本表`(84)· `每日价格`(230)· `散包 买取kpi分析`(16)。
- **坑:`records/search` 的 `page_token` 要放在 query string,放 body 里会静默重发第一页** —— 我第一次把 114 行的表读成 600 行,所有合计都虚高。

## ✅ 日本直播毛利(8/12 首次读到)
- `直播` 表 **59 场**(去掉分割线),日本自己标「数据有误」2 场。字段齐:`成本(单卡除外) + 成本(单卡) + 平台手续费 = 总成本` vs `营业额(JPY/USD)` → **毛利 / 毛利率**,外加 `人员 / 直播时长 / 平均毛利每小时 / 发货状态 / 绩效评级`。平台 ebay + whatnot。
- 55 场可用合计:**营业额 ¥14,546,465 · 毛利 ¥7,239,680 = 49.8%**。
- **🔴 但这个 49.8% 不能直接用**:近期成本记全的 ebay 场是 **14.5% / 23.1%(平台合计 19.6%)**,而早期几场是 **58.5%(华昊)/ 80.3%(李谢缘)** —— **80% 的直播拆包毛利不成立,几乎肯定是当时成本没记全**。**要看就看近期那几场。**
- 日本标「数据有误」的两场单列:`8/09 whatnot 2.4%` · `8/09 ebay −46.9%`。**别把它们算进均值。**
- 对照我们自己的:6/28–7/27 packheads 确切毛利 **32.7%**、rockethq **24.4%**。品类和市场不同,不能直接比,**但两边现在都有真数了**。

## 🔴 直播毛利:美国侧引擎在本地(8/12,Gary:"直播毛利数据也在lark里面")
- **Lark 两条路都堵着**:自建应用 "Lucky" 现在**看得到 0 个群**(手册记的是 BACKEND CORE,已经不在了);Base/Drive/Wiki/电子表格**全部无权限**(`bitable:app:readonly` 等 scope 一个没给)。**浏览器(AdsPower `k1bkorhr`,Gary 本人)可用,但要先知道是哪个群/哪张表。**
- **本地引擎是现成的且很硬**:`lv-finance/per_stream_pnl.py`(逐场)· `month_exact_gp.py`(整月确切毛利)· `group_daily_detail.py`(日卡)。6/28–7/27:**packheads 确切毛利 $47,001 = 32.7%** · **rockethq $5,892 = 24.4%** · **vaulttcg 无法实测(没房间没盘点,GMV $16,591)**。**8 月没跑过。**
- **它的可信度直接挂在今天修的那些成本上**:自己印的 `成本源 acq:$56,498 avg:$33,902` —— **37% 的 COGS 来自 `avg_cost_basis`**,正是被 Storm $1.87 那类错污染的字段;「无成本行」里就写着 `2023 Upper Deck Marvel Allegiance`,**那是今天刚映射掉的 GTS SKU**。
- `per_stream_pnl` 今天实跑 PackHeads:收入 $13,097 / COGS $20,944,**但引擎自己标了不可信**(`盘点间隔 21.4h → 消耗是多天累积,收入只落在窗口里`)。**别拿这个数当亏损报。**

## ✅ 8/12 多出分两类走(已写完,**未过 review 未发版**;Gary 问"这个怎么解决")
- **病根不是盘点员,是那条指令根本执行不了。** 原来八条多出印同一句 `Record a Move`,每场原样重印;`DB Masters Prismatic Clash` 已经连报 **11 场**。查下来它全公司只有 2 件,而 2 件**全部就在被盘的那个房间里** —— **没有任何房间可以搬给它**。一条被无视 11 次的指令不是没人看,是做不到。
- **判据是"这个房间之外还有没有货",不是"全系统够不够"**(我第一版就写错了,OP-16 那 270 件全在本房)。实测 8/12 那 97 件:**A 类 9 件(房外有货)· B 类 12 件(GTS 有发票没收货)· C 类 76 件(查无来路)** —— 和 8/11 那次形状一致,A 类永远只有个位数。
- **新 `fetchStockElsewhere(productIds, excludeLocationId)`**(`supabase.js`):返回每个 SKU 在**别的房间**的件数和来源房名。**提交时才查**,不在加载时 —— 只有多出的那几个要用,而且一个 SKU 可能这一场才第一次多出。
- **查询失败 = 第三种状态,不许归进任何一类**(照 `fetchOpenSurplus` 那次的先例:降级成空 map 会让所有销量被标 `exact`,拿一次故障制造确定性)。失败时 `fixable: null` → 消息明写 `Could not check other rooms … treat as unresolved, not as fixable`。
- **消息拆两块**(`api/lark-notify.js` 抽出 `appendSurplus()`):可修的**点名来源房间和件数**(`← Master Inventory has 36, RocketsHQ has 23`),一眼就能照做;查无来路的**不再要求 Move**,改印 `Do NOT adjust stock` + **连报几场 + 挂了多少天**,按年龄排。
- **上限里有一条特意的例外**:查无来路的只印 4 条,**但最大的那条永远不会被挤掉** —— 8/12 的 OP-16 是 +67 / +97(70%),为了给一条 +1 腾位置而把它省掉,比不印这张表更糟。省略的部分必须报数(`… and N more, +M units`),不能看起来像"就这些"。
- 屏幕上那张表加了 **What to do** 列,同一套判定;标题从 `needs transfer-in` 改掉 —— 对搬不动的那些,那是同一句错指令。
- `scratchpad/surplus_split_test.mjs` **21 用例**(跑真的 `appendSurplus`,用 8/12 那张卡的真数据),含"查不到别房时两块都不许说"、"最大的不会被上限挤掉"、"缺 since 不许印 NaN"。`npx vite build` 通过。
- **还没做的**:B 类(有发票缺收货)在 app 里看不到 —— GTS 发票是本地数据。那条留在 `inventory-sync` 侧。

## 盘点=销量尺(8/5 Gary:"这个数其实是为了上一个主播数的 就是对应他们的货卖掉了多少")
- 盘点的本质是**给上一场主播算销量**:`sold = expected − actual`。**expected 一旦错,这把尺子就废了** —— 实物高于账面时 actual 永远 ≥ expected,该 SKU 每场都算出 `sold 0`,货照样往外走。**实测 7/25–8/6 Packheads 因此吞掉 91 件销量 ≈ $2,615 成本**(最干净的病例:OP-13 blister 三个人五次盘点 170→156→150→128,走了 42 片,系统记 0;`scratchpad/swallowed_sales.py`)。
- **8/5 已上线修法(未 push,待 Codex)**:`fetchOpenSurplus(locationId)` 读近 12 次盘点算出"仍高于账面"的 SKU + **连续几场没解决(streak)**;StreamCounts 提交时,**之前就有多出的 SKU 销量标 `≥`(下限,不是精确值)**,本次仍多出的 SKU 在报表和 Lark 里明说 **"sales UNKNOWN this session, not zero"** 并带 "reported N counts in a row"。**盘点页面本身不显示任何多出信息**(盲盘不能泄露 expected)。实测 streak 正确:OP-13=5、FB03=5。
- **销案判定必须比当前库存,不能比当初那次盘点**(Gary 8/6:"不想看到这个warning")。`fetchOpenSurplus` 现在拿"最近一次盘点数到的 actual"和**此刻的 inventory.quantity** 比:账追上了就自动 CLOSED,不用等下一次盘点。改完当场验证:RocketsHQ 的 Perfect Order(数到 160/账 190)、Chaos Rising(27/27)因为 Aldo 那批写库已自动销案。**修完就不再报 = 警告才有人看**。
- **销案第二条(更重要):盘点后账被动过 = 这次观测作废,直接销案**。盘点是**带时间戳的一次观测,不是长期主张**;只要有人动过那个 SKU,旧观测就过期,真有问题下次盘点会再报。少了这条会出现"修完还在报":① **Journey Together 挂了三周 "+41"**,而 Aldo 7/17 00:24 **规规矩矩记了 Move 把那 41 包搬去 eBay LVUS** —— 账归零完全正确 ② **Ayakashi RocketsHQ "+26"** 是拿 Frank 8/5 **15:28 UTC** 那次去比 Aldo **18:20 UTC** 的更新数(Aldo 晚 3 小时),**写成 29 等于用旧数覆盖新数**。判定用 `created_at`(提交时刻)不用 `count_time`(可回填)。
- **改完实测(8/6,`scratchpad/verify_open_surplus3.py`)**:**RocketsHQ 归零,一条警告都不剩,且一行库存都没覆盖** —— 两条都是误报。全系统只剩 **Packheads 8 个 / 95 件** + eBay LVUS Battle Styles +2 = **97 件**。Packheads 那批基于 JV 8/6 04:33 的数,脚本 `packheads_baseline.py` dry-run 通过,**写库被 classifier 拦两次,待 Gary 放行**。
- 已知限制:`fetchInventoryForRoom` 用 `.gt('quantity', 0)`,**账归零的 SKU 会从盘点表消失**。正常卖光/搬走是对的,但万一实物还在就再也数不到。
- **🔴 8/11「+197 discrepancies / sold 13」拆解(Gary 问"为什么数货还是错误",`scratchpad/count_197.py` + `op16_trail.py`,只读)。三个机制性原因,没有一个是盘点员的错:**
  1. **最干净的证据 —— 20 件真销量当场被吞**。同一天同一 SKU:**05:47 JV 数到 458 → 12:53 Yaz 数到 438**,7 小时实走 20 件。但 expected 一直是 **270**,两次 actual 都高于 expected → 两次都判"多出" → **该 SKU 对 `sold` 的贡献是 0**。卡片上 `sold=13` 全部来自另外 3 个 SKU(OP-13 blister -10 / Azuki -2 / Blue Archive -1)。
  2. **多出永不写库 → 差永不销案 → 每场原样重报**:OP-16 packs `05:47 +188 → 12:53 +168`、Uma Musume `+11 → +12`、Epic Seven `+1 → +1`。铁律2 原话"误差偏高只是反复唠叨",现在**这个唠叨已经淹掉真信号**。
  - **⚠️ 算未销案总量必须带上 R2(盘点后账被动过就作废),否则虚高一倍**。我第一版漏了这条报成 457 件,实际:**粗算 457 / 20 项 → R2 该销案 374 / 14 项 → 真正未销案 197 件 / 9 项,全部在 Packheads、全部来自 8/11 Yaz 那一场**。误报里就有 **OP-13 blister +141**(盘点后 RocketsHQ 有 Move + 2 条进货动过)。`scratchpad/surplus_true.py` 是带全两条规则的版本。
- **🔴 「多出是不是移库问题」判据(8/11,Gary 问)**:**移库漏记的话货只是记错了房,全系统总数是对的**;总数都不够就是没来路。按这个分,197 件里 —— **移库未记只有 3 项 / 9 件**(Ayakashi +6 有 Master 36+RocketsHQ 23 挂着 · FB03 +2 · Epic Seven +1),**查无来路 6 项 / 188 件(95%)**(OP-16 packs +168 数到 438 而全系统只有 270 · Uma Musume 盒 +12 数到 44 全系统 32 · Marvel Allegiance +4 · Prismatic Clash +2 · Kami's Island +1 · DanDaDan +1)。**结论:基本不是移库问题。**
- **销案必须分两类走,不能一刀切(8/11 修正我自己的错误提议)**。我先提过"连续 2 场不同的人数到就按较小值写库" —— **那会给 OP-16 凭空造 168 件,就是编数据**。正确做法:
  - **A 类(总数对、只是房间分错)可以自动销案**:修法是**记一笔 Move** 从有货的房搬到数到货的房,**总数一件不变**,不可能凭空造货。今天只有 9 件,风险接近零。
  - **B 类(总数不够)永远不自动销案**,但要让它**变老而不是消失**:记首报日期+首报人+累计报了几场,**盘点页面不显示**(盲盘不能泄露 expected),日巡里单独列「欠单据清单」**按挂了多少天排序**。现在二十条混一起、每天长得一模一样,所以没人看。
  3. **`Sold last session` 只覆盖被数到的 SKU**。这场只数 17 行,而同期 TikTok 一天出 ~120 件 —— 这个数被当成"上一场主播卖了多少"发进群,其实只是这 17 行负差之和。**别把它当销量报表。**
- **+197 里 168 件(85%)来自一个 SKU:`5080eecb The Time of Battle Booster Pack - …(OP16) Booster Pack`**(正是 8/5 零查重造出来的重复名 SKU)。单据自己就对不上:`8/07 acquisition $152 received 0 (Purchased)` · `8/10 acquisition $1,995 received 210 ($9.50/包)` · `8/10 movement Master→Packheads ×270`(**比收到的多 60**)· **`receipts` 0 行**(从没走过 Intake to Master)· **`box_breaks` 0 行**,而 7/21×24 + 7/31×25 共 **49 个 JP OP-16 盒**进过这个房、现在全系统 0。**进 226 / 搬 270 / 实物 438,中间 168 件追不到单据 —— 不编解释**,只有问房里的人或全房复点能定。
- **假设已排除**:Kami's Island `+1` **不是**重复 SKU 拆账(该系列 5 个 SKU 里只有 `3a468a57` 有货 328,其余全 0),就是正常小差。全库"名字把类型词写两遍"的 SKU 共 **16 个**,但只有 4 个还有库存(Kami 328 / OP16 270 / Awakened Pulse 12 / DanDaDan 6)。

## App(本仓库,Vercel,push=生产)
- 只在 Gary 说"发"时 push;**所有改动过 Codex review(铁律 7/20)**。
- **7/29 已上线(60d2f12→b31bde4 五连发,每笔过 Codex)**:单卡拆卖(sellSingleQtySplit 三路共用,先插 sold 行+乐观锁扣减)· **singles sale_price_usd 语义统一=单价**(旧整行卖存总价,P/L 显示偏高属已知)· 渠道词表 `src/lib/saleChannels.js`(每直播间一值、eBay 分账号、去 COMC/泛 ebay、in_person 显示名=Storefront、加 shows、默认空强制选)· 标题直达 TCGplayer(tcg_id)· 卖卡弹窗显示 Market+sheet D 列 recent sales(`api/singles-price-detail` 实时读表,边缘缓存 10min)· /cards 两表 50 行分页 · /inventory 房间默认折叠(搜索自动展开)· scan 队列芯片带市价。验证部署要盯 **bundle 换名**,别用宽泛词 grep(7/29 误报教训)。
- **8/3 已上线(55f5434+426b758,过 Codex)**:① fetchSingles/fetchSlabs/ViewInventory buckets 全部接 `fetchAllPages` 分页(PostgREST 1000 行截断 → /slabs 曾隐形 ~1500 行、/inventory 房间 slab 数虚少,"90个slabs"之谜)② 扫码 lookup 活行优先(sold 行永不压活行;`lookupScannedCode` 先查 in_inventory/listed qty>0 再回落 sold;POS 传 `preferLocationId`=Front Store 防扣错房)。**门店"already sold"病根二分**:扫码排序 bug(已修)+ 99 个 tcg_id 只剩整叠 sold 行(5/26-7/14 老 bug 遗留)—— Gary 8/3 裁定:**的确卖了,保持 sold 不恢复**。7/28 tx 847aeb17 补录 Mega Evolution Booster Box $320 销售行(收款$1085-行$765 缺口,已平)。
- 设计已定待 Gary 点头开工:Cards Scan 加"来源交易"下拉(trade/buy 关联+trade_in 按市价分摊成本,治单卡无成本病根)+ 重提防双录 + buy 手写行 sealed 关键词提示。7/28 双录 trade 已修(备份 double_trade_backup_0728.json)。platform 扫车 singles 仍存小写渠道('ebay' 等,报表兼容,细分待办)。
- 门店对账待办(8/3 群聊考古):Storm Emeralda 8/3 两笔$160(3箱$320,疑多录1箱)+ OP-13 blister 双$20 —— 待门店确认;"Buy 2 destined rivals bundles $110" 未入系统;7/24 19包 Paldean Fates 未扣(系统 Front Store 13 包,下次盘点实点);**每日 storefront 对账模块**(收款vs行/双录/幽灵扣减→群里@当班)方案已提待 Gary 批。盘点 found-extra 写入=过审制:8/3 Packheads 按 Trey count 写入4项多出+Pitch Black -1→0(备份 trey_recon_backup_0803.json)。
- 历史疑案待门店确认:7/28 Pikachu ×3 $9、7/24 Elgyem ×2 $15 两笔 in_person 整行多张 sold —— 真打包卖 or 误全卖?误卖则拆回。
- 房间名是硬编码字符串:改名/加房要全改 StreamCounts/Moved/OnlineOrders/PlatformSales/Returns + api/*(lark-notify/sheet 路由/日报周报)+ inventory-sync 脚本 + lv-finance/weekly_cogs。
- **🔴 没有 William 了(Gary 8/11:"我们以后全面接手了 我们本地跑很多 没有will了")。DDL 现在没有执行路径**,实查:service_role key **只在 Vercel 环境变量里**,本地全仓库+全 `.env` 一份都没有;DB 密码/连接串没有;psycopg / psql / supabase CLI 都没装(npx 有)。**而且 service_role 也建不了表 —— PostgREST 只走表和 RPC,不执行 DDL。** GitHub 有(`IKUN1205/…`,Vercel 从它部署)但那给不了建表能力。项目 ref `dqreqevbjszercgackuc`。
  - 要打通只需一个一次性凭证,推荐 **supabase.com → Account → Access Tokens → 生成 `sbp_...`**(纯 HTTP Management API,不用装东西);另一条是 Settings → Database 的连接串+密码(要先装 psycopg)。**存进 `inventory-sync/data/` 别贴聊天。**
- **但 9 张表里真正非 DDL 不可的只有 `inventory_audit_log` 一张**(它要抓的是 app / Vercel 那一侧改库存,本地脚本站在外面看不见)。其余全部可以先本地跑:四张 TikTok 表(订单本来就是 API 拉的、map 本来就是 `build_product_map.py` 生成的、applied_lines 只是幂等台账,真正要写 Supabase 的 `movements`+`inventory` 早就有)· `buy_requests`(Frank 发 Lark→本地汇总→出 % 表)· `product_price_sources`(本地 JSON 按 product_id 索引就治好了按名字钉的病根,消费方 `erp_pricing`/`reprice`/`ebay_bin` 全是本地脚本)· `product_prices`(`price_watch.py`→`data/pricing_hist/` 已经是它的本地版)。**`Sold - TikTok Packheads` 房是 `locations` 插一行,不是 DDL,anon 就能建。**
  - **代价说清楚**:本地台账成立是因为我们是唯一写方,换来的是 **app 看不见** —— "买入申请在 app 里提交"和"入库时提示无价源"这两个交互最终还是得进库。
- 原 William 待办 SQL 清单(8/10 全部实查过,9 张表一张都还没建),按影响排:
  1. `scripts/add_tiktok_order_sync_2026_08_05.sql` → `tiktok_orders` / `tiktok_order_items` / `tiktok_product_map` / `tiktok_applied_lines` + 补建 `Sold - TikTok Packheads` 房。**注意:8/11 已查实缺表不是唯一阻塞,见上面 TikTok 那节的三条。**
  2. `scripts/add_buy_requests_2026_08_07.sql` → `buy_requests` / `buy_request_lines` / `buy_requests_outstanding`(视图)。`product_id NOT NULL` 就是治门店 buy 行 130/134 没产品那件事。
  3. `scripts/add_product_price_sources_2026_08_10.sql`(**8/10 新写**)→ `product_price_sources` + `products_needing_price_source` 视图。**按 product_id 不按名字**(7 月给 164 个海贼王产品加前缀,286 条钉价里 90 条当场失效);带 `price_kind`(sale/ask/bid)区分成交价、要价、买取出价。
  4. `scripts/add_inventory_audit_log_2026_07_23.sql` → `inventory_audit_log`(改库存零留痕)。
  5. `scripts/product_prices_2026_06_29.sql` → `product_prices`。
  - **`scripts/add_storefront_checkout_rpc_2026_08_09.sql` 标着 DO NOT RUN YET**(写入部分还是 TODO),别一起给。
  - 另外 product image column + 存储桶(见 [[product-image-upload]])。
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
