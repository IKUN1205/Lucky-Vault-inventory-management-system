# 🎬 直播 CG 叠层 — 使用说明 (Stream CG Overlay)

直播画面上的弹出动画系统。两个网页:**叠层**(挂在 OBS 上)+ **控制台**(你点按钮)。
中间用现成的 Supabase 实时通道传信号,不用额外服务器、不花额外的钱。

```
  你/助手点按钮 (控制台)  ──实时──▶  OBS 叠层播动画  ──▶  观众看到
```

## 两个网址

部署后(`git push` 自动上线),换成你们自己的域名(就是你登录库存系统那个网址):

| 用途 | 网址 |
|---|---|
| **OBS 叠层** | `https://你的域名/cg-overlay.html?room=main` |
| **控制台** | `https://你的域名/cg-control.html?room=main` |

> `room=main` 是直播间名字。多个直播间各用一个名(`room=room2` 等),互不干扰。
> 叠层和控制台的 `room` **必须一样**才能对上。

## OBS 里怎么挂(一次性,做完不用再碰)

1. 在你的直播场景里,**来源 → ＋ → 浏览器(Browser)**
2. 网址填:`https://你的域名/cg-overlay.html?room=main`
3. **宽 1920、高 1080**(和你画面分辨率一致)
4. 确定。把这个"浏览器"来源拖到**所有图层最上面**(动画要盖在最上层)
5. 平时它是透明的,什么都不显示 —— 正常

## 怎么放动画

1. 手机 / 平板 / 电脑浏览器打开:`https://你的域名/cg-control.html?room=main`
2. 右上角显示**已连接**(绿点)就能用了
3. 点按钮 → OBS 画面上立刻出动画,播完自动消失

## 4 种动画

| 按钮 | 效果 | 要不要填 |
|---|---|---|
| 💰 **SOLD 成交** | 大大的 SOLD + 金色彩带 + 音效 | 可填商品名/价格,也可留空 |
| 👋 **买家欢迎** | 左下角横幅,欢迎某买家 | 填买家名 |
| 🔥 **稀有卡 HYPE** | 全屏金光庆祝 + 彩带 + 音效 | 可填大字,留空用默认 |
| ⏱️ **倒计时** | 3 → 2 → 1 → GO! | 填起始数字(默认 3) |
| 🔨 **拍卖** | 一次 / 两次 / 成交,按节奏点 | 不用填 |

底部 **⏹ 立即清空叠层** = 强制让画面上的动画马上消失。

## 小贴士

- **音效**:SOLD 和 HYPE 有金币音效,OBS 会自动收进直播声音。不想要在叠层网址后加 `&mute=1`
- **改了代码看不到更新**:OBS 里右键那个浏览器来源 → **刷新缓存(Refresh)**
- **调试**:叠层网址加 `&debug=1`,左下角会显示连接状态小圆点(上播前去掉)
- **素材**:现在的动画是用代码画的(金色金库风格)。以后有了真素材(图片/视频特效)可以替换进去

## 用实体按钮板(Elgato Stream Deck)触发

不想用手机点,想拍一下实体键就出动画 —— 用 Stream Deck。原理:每个键
配成"按一下 = 访问一个网址",那个网址(`/api/cg-cue`)会把动画打进叠层。

### 一次性设置

1. Stream Deck 软件 → Marketplace 搜 **Web Requests**(BarRaider 出的,免费)→ 安装
2. 把 **Web Requests → GET** 这个动作拖到一个键上
3. 在 **URL** 填对应动画的网址(见下表),方法选 **GET**
4. 给这个键起个名字 / 配个图标
5. 每个动画重复一次

### 每个键填的网址(把 `你的域名` 换成库存系统域名)

| 键 | 网址 |
|---|---|
| 🔥 HYPE | `https://你的域名/api/cg-cue?room=main&anim=hype` |
| 🔥 HYPE(自定义大字) | `https://你的域名/api/cg-cue?room=main&anim=hype&text=BIG%20W` |
| ⏱️ 倒计时 | `https://你的域名/api/cg-cue?room=main&anim=countdown&from=3` |
| 🔨 一次 | `https://你的域名/api/cg-cue?room=main&anim=auction&step=once` |
| 🔨 两次 | `https://你的域名/api/cg-cue?room=main&anim=auction&step=twice` |
| 🔨 成交 | `https://你的域名/api/cg-cue?room=main&anim=auction&step=sold` |
| 💰 SOLD(不带价格) | `https://你的域名/api/cg-cue?room=main&anim=sold` |
| ⏹ 清空 | `https://你的域名/api/cg-cue?room=main&anim=clear` |

### 实体键的限制 + 怎么补

实体键**不能临时打字**。所以:
- **不用打字的**(HYPE / 倒计时 / 拍卖 / SOLD 不带价)→ 用 Stream Deck,完美
- **要填买家名 / 价格的**(欢迎 @某人、SOLD $120)→ 还是用手机 `cg-control.html`

两个可以同时用,不冲突 —— 实体键放常用的固定动画,手机留着填字那几个。

### 测试有没有通

先确保 OBS 叠层(`cg-overlay.html`)开着,然后浏览器直接打开任意一条上面的网址。
看到 `{"ok":true,...}` + OBS 画面出动画 = 成功。

## 文件位置

- `public/cg-overlay.html` — 叠层(OBS 用)
- `public/cg-control.html` — 手机控制台(点按钮用)
- `api/cg-cue.js` — Stream Deck 触发接口
- `public/cg-demo.html` — 本地演示页(不连网,纯试玩)

都不影响库存系统。
