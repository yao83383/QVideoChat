# QVideoChat v1.3 打磨版 Roadmap

## 版本主题

v1.2.x 攒下了完整的技术底座 — VRM 化身、面部驱动、WebRTC、实时字幕/翻译、匹配/好友。这一版把它包装成**用户第一屏就看得懂、通话中不想走、下次还愿意回来**的商业化雏形。**不做付费系统**,但为付费埋 UI / 数据 hook,保持和 [monetization-roadmap](../memory/monetization-roadmap.md) 分层一致。

## 版本策略

- 按切片(A–F)独立推进,每片能单独部署、单独衡量指标
- 版本号继续 BUILD++(1.2.3.002 → .003 → ...),整版跑完才升 MINOR 到 v1.3.0
- 每片 ship 后跑一次 q-dev,让真实设备验证再进下一片

## 三条主线

| 主线 | 覆盖切片 | 直接目的 |
|---|---|---|
| 首屏 & Onboarding | A | 首屏留存 ↑ |
| 通话 addictive loop | B, C, D | 单次时长 & 回访率 ↑ |
| 商业化 & 安全 hook | E, F | 合规 + 为 L1 商城铺路 |

---

## 切片 A · Hero 首屏 + 3 步 Onboarding

**目标**:用户第一屏就看到自己的化身在动,3 步内学会怎么用。

**对标**:
- 首屏化身占位 — IRIAM(一张脸变化身直播)
- 三步引导 — Azar(语言 / 兴趣 / 授权)

**修改点**:
- `client/app/page.tsx` 布局重构:化身预览升为 hero,占屏 40% 以上,居中
- 摄像头默认尝试自动打开(拒绝授权不阻断,fallback 展示静态占位)
- 首次 `localStorage.qv_onboarded` 缺失时进入 3 步 wizard:
  1. 你想聊什么(= 兴趣标签)
  2. 你希望用什么语言聊(= sl / tl)
  3. 让化身认识你(= 开摄像头,教用户对准脸)
- 走完 → 设 `qv_onboarded = "1"`,老用户不再见

**埋点**:
- `qv_onboarded_at` timestamp,记录首次完成时间
- 每步 skip 率(未来据此调整引导长度)

**不做**:
- 化身选择(F 做)
- 复杂动画,只用 CSS + 现有 VRM 静态展示

---

## 切片 B · 通话中 Emote / Reaction

**目标**:通话过程中一键表达情绪,不用说话也能互动。

**对标**:
- 悬浮 emoji 反应 — Monkey(6 个反应按钮 + 飘字动画)
- 化身 emote 库(动作) — REALITY(未来预留)

**修改点**:
- Room 页面底部加 emoji 反应栏:哈哈 / 赞 / 爱心 / 鼓掌 / 惊讶 / 难过 共 6 个
- 点击后:
  - 本地:屏幕从下往上飘一个 emoji,3s 淡出
  - DC 广播 `{type:"emote", e:"laugh"}`,~20 bytes
  - 对端收到同样飘同款 emoji
- 独立 DataChannel `emote`(避开 blendshape 高频通道)
- 长按化身可打开表情面板,为未来化身动作库预留入口

**埋点**:
- 每场通话 sender / receiver emote 计数
- 最热门 emoji 排行

**不做**:
- 化身主动动作(挥手 / 鞠躬)— 需 VRM Animation Clip,下版
- 音效
- 自定义 emote

---

## 切片 C · 挂断复盘 + 快速加好友

**目标**:每次挂断都是情感闭环 + 好友增长机会。

**对标**:
- Bumble / Azar 挂断评价卡

**修改点**:
- `handleNext` 触发时:
  - 弹 2–3s modal:对方化身缩略图 + 名字 + 3 星评分 + "加好友" 按钮
  - 不点也自动进入下一次匹配(默认 2s auto-dismiss)
- 评分数据存本地 + 上报(未来推荐算法用)
- 已经是好友的对方 → 不显示加好友,改为 "再来聊聊" 入口

**埋点**:
- 挂断评分 histogram
- "加好友" 转化率
- 没打分就下一位的比例(判断卡片是否挡路)

**不做**:
- 举报 / 拉黑(E 做)
- 通话内容回放 / 摘要

---

## 切片 D · 匹配前偏好 Filter

**目标**:匹配质量 ↑,"我在等谁" 变清晰。

**对标**:
- Azar 的 language / gender / region 三选一 filter bar

**修改点**:
- 首页 "开始匹配" 上方加一行 filter bar:
  - 语言:中文 / 英文 / 任意
  - 性别偏好:男 / 女 / 任意
  - (兴趣标签保持现状)
- match server 端匹配算法接受这几个字段(现在只按标签)
- 免费用户可用"任意",指定 filter 后期做付费门槛(现在都免费开放,只埋 UI 位)

**埋点**:
- 每种 filter 组合 → 匹配等待时间(未来判断哪种最贵)
- 用户使用 filter 的分布

**不做**:
- 付费卡位
- 位置 / 地区 filter(涉及 IP 定位和隐私,大改)

---

## 切片 E · 安全 UX 强化

**目标**:合规 + 用户安全感 + 举报数据可用。

**对标**:
- Yubo:首次进入的社区准则 + 未成年 age gate
- Discord / Azar:举报理由分类

**修改点**:
- 首次进入弹一次性 modal:"社区准则"(简短 3 条,不能跳过),记 localStorage
- 年龄声明:"我确认已满 18 岁"(单选框),不满不允许进匹配
- `reportUser` 表单从空文本升级为**理由分类**:
  - 骚扰 / 辱骂
  - 裸露 / 成人内容
  - 骗子 / 推销
  - 未成年
  - 其他(可写文本)
- 通话中"举报"按钮从二级菜单提到显眼位置
- Block-list:被自己举报 3 次的对方进本地 block-list,后续匹配跳过(服务器端同步逻辑)

**埋点**:
- 举报分类分布(给运营做审核决策)
- Block 使用率
- 未成年声明拒绝率

**不做**:
- 面部年龄识别(AI 成本 + 隐私)
- 实时 AI 内容审核(下版)

---

## 切片 F · 装扮商城 Preview(不做支付)

**目标**:让用户看到"化身可以变",为 L1 商城铺 UI + 埋点。

**对标**:
- REALITY:免费用户能试穿,支付卡在结账那步
- Zepeto:首页"每日推荐"装扮 rotate

**修改点**:
- `/profile` 加"我的化身"入口
- 化身选择器 grid:
  - 已拥有:DLco.vrm(默认,免费)
  - 锁定:2–3 个 mock 装扮(placeholder 图),打锁标
  - 点锁定装扮 → 弹"敬请期待,加入心愿单?"
- 心愿单存 SQLite `wishlist` 表(为未来推送准备)
- 首页顶部加"新装扮预告"横幅(可关)

**埋点**:
- 每个 mock 装扮点击率 → 决定第一批真装扮做哪几个
- 心愿单数量 → 决定 L1 商城什么时候上

**不做**:
- 真的 VRM 装扮切换(需多套 VRM + 加载逻辑,下版)
- 支付集成(monetization-roadmap L1 层)

---

## 参考产品对应表

| 功能 | 主对标 | 次对标 |
|---|---|---|
| Hero 首屏 | IRIAM | REALITY |
| Onboarding 3 步 | Azar | Bumble |
| Emote 反应 | Monkey | 抖音直播 |
| 挂断评价 | Bumble | Azar |
| 偏好 Filter | Azar | HeyThere |
| 安全 UX | Yubo | Discord |
| 装扮 Preview | REALITY | Zepeto |

## 不在此版本

- 真付费(monetization L1,下版)
- UGC 化身上传(monetization L4,更晚)
- 消息 / 私聊(需独立信道 + 通知系统,大改)
- 多人房 / 直播(架构大改)
- 面部驱动胳膊 / 上半身(pose 幻觉未解决,回避)
- AI 实时内容审核(成本 + 隐私)
- 面部年龄识别(隐私)

## 版本演进

- v1.3 = A + B + C + D + E + F 全部完成 → 升 MINOR 到 v1.3.0
- v1.4+ = monetization L1(装扮真买断)+ 消息系统 + 多化身

---

## 平行:切片 G · 宣传主页(已上线)

和 App 打磨解耦的独立初始化,2026-07-13 完成。

- 位置:`justsaysayforfun.com` 根路径(原 nginx `location /` proxy 到 3001 已改为 `root /opt/marketing-site`)
- 源码:仓库 `marketing/index.html`,单文件 Tailwind CDN
- 结构对标 IRIAM:Nav + Hero + 4 功能格 + 3 步流程 + 安全区 + FAQ + Final CTA + Footer
- 中文,CTA 跳 `/qvideochat` 生产
- 待补:真机录屏替换 Hero 里的 emoji 化身占位、隐私政策 / 服务条款 / 备案号页面(点击当前指向 `#`)、真实 og:image

