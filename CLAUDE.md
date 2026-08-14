# LV Inventory — 作业手册 brief (2026-08-13)

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
