# QVideoChat v1.4 · 打包 + 桌宠版 Handoff

## 版本主题

把 v1.3 已经跑通的 web 版塞进 **Electron 桌面壳**,顺手把 VRM 化身做成 **桌宠**:一个透明、置顶、可拖动的小窗口挂在桌面角落,通话时显示对方/自己的头像跟着摄像头动,起陪伴作用。

**不在这一版**:Android app(下下版,和 Android 悬浮窗一起做);状态跨窗口承接("主 app 通话中缩小成桌宠"— 用"关掉主 app 自动开桌宠"骗过用户即可,不真的承接 socket/peer)。

## 版本策略

- 版本号 v1.3.0.017 → 继续 BUILD++(1.3.0.018 → ...),整版跑完升 MINOR 到 v1.4.0
- 每切片 ship 后:PC 装机跑一遍验证,再进下一片
- **前置**:先真机(手机 + 一台 PC 浏览器)把 v1.3 A~F+J 跑一遍,记录 bug,再开 v1.4

## 三窗口架构

```
┌─ main app window          (原 Next.js 全套 UX,BrowserWindow 加载 file://)
├─ pet window               (透明 · 置顶 · 无边框 · 可拖 · 可穿透)
└─ tray icon                (菜单:显示主 app / 显示桌宠 / 切换头像 / 退出)
```

三个窗口共享一个 Electron main process。主 app 和 pet 是**两个独立的 BrowserWindow**,各自跑一份 Next.js SPA 实例,通过 URL(`/` vs `/pet?target=self|partner`)区分。**不做**跨窗口共享 socket / RTCPeerConnection(WebRTC PC 无法跨 window,IPC 序列化太重),两个窗口是"二选一同时开一个"的关系。

## 切片划分

### 切片 A · Static Export + basePath 兼容改造

**目标**:让 `npm run build` 产出的 `.next` 或 `out/` 能被 Electron `file://` 加载。

**修改点**:
- `next.config.ts` 增加 `NEXT_ELECTRON=1` 分支,启用 `output: 'export'` + `trailingSlash: true` + **basePath 置空**(Electron 里不需要 `/q-dev`)
- `client/hooks/useSocket.ts`:从 `.env` 读 `NEXT_PUBLIC_SERVER_URL`,Electron 版硬编码到线上生产 socket 地址(`wss://justsaysayforfun.com/qsignal`)
- 走 dynamic route 的页面(`/room` 用 `useSearchParams`)确认在 static export 下能 hydrate(v1.2.1.003 已经处理过一次,复核)
- **client/scripts/build-electron.sh**:`NEXT_ELECTRON=1 NEXT_EXPORT=1 npm run build` 一键出 `out/`

**踩坑预判**:
- `crossOriginIsolated` 头 static export 不能通过 next 加 header,得走 Electron main process `session.defaultSession.webRequest.onHeadersReceived` 注入
- sherpa-onnx 的 `.data` 大文件从 `file://` 加载 fetch 语义变了,可能需要走 `net.fetch` 或先复制到 userData 目录

### 切片 B · Electron 壳最小可用

**目标**:`electron .` 起来能看到主页,能开摄像头,能匹配,能通话。

**新增**:
- `client/electron/main.ts` — main process,启动主 app 窗口,加载 `file://.../out/index.html`
- `client/electron/preload.ts` — 预留 IPC bridge(未来桌宠切换要用)
- `client/electron/permissions.ts` — 摄像头/麦克风权限自动 grant(不弹浏览器权限对话框,Electron 里 `session.setPermissionRequestHandler`)
- `package.json` 加 `electron` + `electron-builder` devDep,加 `"electron": "electron ./electron/main.js"` script

**验收**:PC 上 `npm run electron` 能开主 app,和 web 版行为一致。

### 切片 C · Pet Route(单头像视图)

**目标**:web 版新加一个 `/pet` 页面,专门做桌宠内容层,不做窗口容器。这样开 Electron 也能 debug,浏览器里直接 open 也能看。

**新增**:
- `client/app/pet/page.tsx`:单文件页面,只 render 一个 `<VrmAvatar>` + 顶部一条极简 hud(头像切换按钮 · 关闭)
- Query 参数:`?target=self` 用本地 blendshape,`?target=partner` 订阅 peer.remoteBlendshape
- 底层背景透明(`background: transparent`),globals.css 加 `.pet-body { background: transparent !important; }` overlay
- 复用 `useSelectedAvatar` — 桌宠 self 模式用户切换化身,直接生效

**不做**:字幕、控制条、any 主 app UI —— 桌宠就一个头。

### 切片 D · Pet Window(透明置顶)

**目标**:pet 窗口以桌宠形态出现在桌面,可以拖、可以穿透空白区域。

**Electron main process 里**:
```ts
new BrowserWindow({
  transparent: true, frame: false, alwaysOnTop: true,
  hasShadow: false, resizable: false, skipTaskbar: true,
  width: 320, height: 400,
  webPreferences: { preload: 'preload.js' }
});
```
- CSS 里 pet 容器加 `-webkit-app-region: drag` 划出一小块拖拽区,VRM canvas 区加 `no-drag` 让点击穿到 Three.js 交互
- 点击穿透:hover 到透明像素时 `win.setIgnoreMouseEvents(true, { forward: true })` — 用 preload + 主进程 IPC 报告 hover 状态
- 加载 `file://.../out/pet/index.html?target=self`

**验收**:桌面右下角能放一个能拖能挥手笑的小头。

### 切片 E · Tray + 桌宠 ↔ 主 app 切换

**目标**:关掉 x 不真退,进托盘。托盘菜单能:
- 显示主 app
- 显示/隐藏桌宠
- 切换桌宠显示(自己 / 对方)—— 通过 IPC 发给 pet window 让它改 URL 或 rerender
- 退出

**新增**:
- `main.ts` 里 `Tray` + `Menu`
- 关闭主 app window 时拦截 `close` event,只 `hide()`
- Pet window 内一个"关闭"按钮 = `hide`,不是真关闭

### 切片 F · 打包分发

**目标**:出一个 `QVideoChat-Setup-1.4.0.exe`,双击装,能启动。

**新增**:
- `client/package.json` 里 `build` 配置(electron-builder):产品名 / 图标 / target: NSIS / signing 先跳过
- `client/electron-builder.yml` 或 inline config,`extraResources` 塞 sherpa-onnx WASM 大文件
- 首次跑 icon 用 emoji 生成占位(不阻塞)
- **不做** auto-update / 代码签名(下版)

**验收**:另一台 Windows 装了 exe 能跑通匹配到通话。

## 桌宠角色 UX

- 桌宠内右上角固定一个小图标切换:`👤自己 ↔ 👥对方`
- 切"对方"时,若不在通话中:显示"未连接,点击开始匹配"占位;点了就 joinMatch,匹配到就自动 render 对方 blendshape
- 切"自己"时:直接开摄像头 render 本地
- 双击桌宠 = 打开主 app 窗口(继续操作)
- 右键桌宠 = 弹出 tray 同款菜单

## 关联 & 参考

- 老的 `handoff-v1.2.0.md` Task 3 里预留过 Capacitor + Electron 三平台构建,当时没做完;这次砍 iOS/Android,只出 Electron
- ROADMAP.md 里的 F 切片(装扮)在桌宠里也生效,用户切化身桌宠立刻跟着变
- Voice 架构([[voice-architecture-stance]]):Electron 里 P2P + TURN 无差别工作,不需要改
- Build 前必须 `rm -rf .next`([[next-15-5-stale-vendor-chunks]]);Electron export mode 生成到 `out/`,同样先清 `out/`

## 后续版本预告

- **v1.5** = monetization L1(装扮真买断)
- **v1.6** = Android app(Capacitor)+ Android 悬浮窗桌宠(`SYSTEM_ALERT_WINDOW` + foreground Service + WindowManager)
- 消息 / 私聊、多化身继续押后
