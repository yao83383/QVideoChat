# QVideoChat 1.2.0 — App化 + 客户端AI 开发计划

## 项目概述

Q版虚拟形象随机匹配视频通话。摄像头 → MediaPipe Blendshape → DataChannel 传输（不传原始视频），WebRTC AudioTrack 传输音频，Three.js + VRM 渲染 3D 形象。

1.2.0 核心方向：**全平台 App 化（Capacitor）+ 客户端 AI 推理（transformers.js）**。AI 模型跟随安装包分发，用户设备本地完成语音识别和翻译。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 + Three.js + @pixiv/three-vrm |
| 面部追踪 | MediaPipe FaceLandmarker (tasks-vision) |
| 实时通信 | WebRTC (DataChannel + AudioTrack) |
| 信令 | Socket.IO |
| 后端 | Express 5 + TypeScript + better-sqlite3 |
| AI 推理 | @huggingface/transformers.js (ONNX Runtime, 客户端) |
| App 框架 | @capacitor/core + @capacitor/ios + @capacitor/android + @capacitor-community/electron |
| 部署 | pm2 + Docker |

## 1.2.0 开发任务

### Task 0: 文档更新
- [x] ROADMAP.md — v1.2.0 路线图总览
- [x] handoff-v1.2.0.md — 开发执行清单
- [ ] AGENTS.md — 更新项目规则

### Task 1: bug 修复 — 手机端 [object Event] 报错
**位置**: `client/hooks/useFaceMesh.ts`
**修复**: `String(e)` → `e?.message || e?.type || String(e)`

### Task 2: Next.js Static Export 改造
- [ ] `next.config.ts`: 添加 `output: 'export'`
- [ ] 动态路由 `/room/[id]` 改为 client-side 路由 (useSearchParams)
- [ ] 移除 getServerSideProps / API routes 依赖
- [ ] 配置 `images.unoptimized = true`
- [ ] 验证 `npm run build` 生成 `out/` 目录

### Task 3: Capacitor 集成
- [ ] `npm install @capacitor/core @capacitor/cli` (client)
- [ ] `npx cap init "QVideoChat" "com.qvideochat.app" --web-dir out`
- [ ] `npm install @capacitor/ios @capacitor/android @capacitor-community/electron`
- [ ] `npx cap add ios`
- [ ] `npx cap add android`
- [ ] `npx cap add @capacitor-community/electron`
- [ ] 配置 `capacitor.config.ts` (server url, permissions等)
- [ ] 相机/麦克风权限声明 (iOS Info.plist, Android Manifest)
- [ ] 测试三平台构建

### Task 4: AI 模型本地打包
- [ ] 下载 whisper-tiny ONNX 模型到 `client/public/models/onnx/whisper-tiny/`
- [ ] 下载 NLLB-200-600M ONNX 模型到 `client/public/models/onnx/nllb-200-600M/`
- [ ] 下载 transformers.js WASM 二进制到本地（离线可用）
- [ ] 脚本化: `client/scripts/download-models.sh` (下载 + 校验)

### Task 5: AI 翻译管线 (transformers.js)
- [ ] `npm install @huggingface/transformers` (client)
- [ ] `client/lib/ai/index.ts` — AI 模块入口，初始化 + 缓存管理
- [ ] `client/lib/ai/asr.ts` — 语音识别 (Web Speech API 主力 + whisper-tiny fallback)
- [ ] `client/lib/ai/translate.ts` — 翻译 (NLLB-200)
- [ ] `client/lib/ai/audioCapture.ts` — 从 WebRTC AudioTrack 捕获音频片段
- [ ] Web Worker 沙箱运行 transformers.js (避免阻塞主线程)
- [ ] IndexedDB 模型缓存（App 内模型从本地加载，跳过网络下载）

### Task 6: DataChannel 翻译传输
- [ ] `client/lib/webrtc.ts`: 新增 `createTranslationChannel()` 
- [ ] DataChannel label: `"translation"`, ordered: true
- [ ] `client/hooks/usePeer.ts`: 集成 translation DC 生命周期
- [ ] 发送/接收翻译消息的接口

### Task 7: 翻译字幕组件
- [ ] `client/components/TranslationBar.tsx` — 滚动字幕条
- [ ] 支持说话人区分（自己/对方，左右对齐）
- [ ] 原生语言 + 翻译结果双行显示
- [ ] `client/app/room/[id]/page.tsx` — 集成

### Task 8: AI 开场话题
- [ ] `client/lib/ai/topics.ts` — 规则模板引擎
  - 预置模板库: 按兴趣标签分类 (游戏/音乐/旅行/学习...)
  - 匹配时根据双方 tag 交集选择话题
  - 降级: 无标签交集 → 通用话题
- [ ] Socket.IO: 匹配成功后推送话题文本
- [ ] `client/components/TopicCard.tsx` — 话题卡片
- [ ] room 页面集成

### Task 9: 匹配系统增强
- [ ] matchQueue 持久化: SQLite 表 `match_queue`
- [ ] 服务重启恢复逻辑
- [ ] 语言偏好字段: users 表 + `nativeLanguage`, `targetLanguage`

### Task 10: 基础设施升级
- [ ] pm2: `next dev` → `next build` + `next start`
- [ ] `ecosystem.config.cjs` 更新
- [ ] env 配置: AI 模型路径、Capacitor 配置

---

## 文件变更清单

```
客户端:
  next.config.ts                          # 修改: + output: 'export'
  capacitor.config.ts                     # 新增: Capacitor 配置
  package.json                            # 修改: + @capacitor/*, @huggingface/transformers
  
  lib/ai/index.ts                         # 新增: AI 模块入口
  lib/ai/asr.ts                           # 新增: 语音识别
  lib/ai/translate.ts                     # 新增: 翻译
  lib/ai/audioCapture.ts                  # 新增: 音频捕获
  lib/ai/topics.ts                        # 新增: 开场话题
  lib/ai/worker.ts                        # 新增: Web Worker
  lib/webrtc.ts                           # 修改: + translation DataChannel
  hooks/usePeer.ts                        # 修改: 集成 translation DC
  hooks/useFaceMesh.ts                    # 修改: 修复 [object Event]
  
  components/TranslationBar.tsx           # 新增: 翻译字幕
  components/TopicCard.tsx                # 新增: 话题卡片
  app/room/[id]/page.tsx                  # 修改: 集成新组件
  app/page.tsx                            # 修改: + 语言偏好 (可选)
  
  ios/                                    # 新增: iOS 平台代码
  android/                                # 新增: Android 平台代码
  electron/                               # 新增: Electron 平台代码
  scripts/download-models.sh              # 新增: 模型下载脚本

服务端:
  server/src/matchQueue.ts                # 修改: 持久化
  server/src/db.ts                        # 修改: + match_queue 表
  server/src/index.ts                     # 修改: + 话题推送 Socket 事件
  ecosystem.config.cjs                    # 修改: next start
```

## 服务器信息（不变）

| 环境 | URL | 目录 | 端口 |
|------|-----|------|------|
| 生产 | `https://justsaysayforfun.com/qvideochat` | `/opt/qvideochat` | Docker: 4000/4001 |
| 测试 | `https://justsaysayforfun.com/q-dev` | `/opt/qvideochat-dev` | 3000 (client) / 3002 (server) |
| SSH | `root@justsaysayforfun.com` | 密钥: `E:\Projs\QVideoChat\key\starluck.pem` |

## 部署步骤（测试环境）

```bash
# 本地
cd client
npm run build          # Next.js static export → out/
npx cap sync           # 同步到各平台
# 如需构建 App:
npx cap open ios       # Xcode 构建
npx cap open android   # Android Studio 构建

# 服务器端（不变）
# 上传 server 目录 → npm install → 重启
```
