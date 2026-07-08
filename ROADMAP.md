# QVideoChat v1.2.0 Roadmap — App化 + 客户端AI

## 版本目标

将现有 H5 Web 应用改造为 **全平台 App（iOS/Android/Desktop）**，AI 模型（ASR+翻译）跟随安装包分发，在用户设备本地完成推理，服务器零 AI 成本。

## 技术架构

```
┌─────────────────────────────────────────┐
│        Capacitor Shell (Native)          │
│  ┌───────────────────────────────────┐  │
│  │   Next.js (output: export, SPA)   │  │
│  │  ┌──────────┐  ┌───────────────┐  │  │
│  │  │ Three.js  │  │ transformers  │  │  │
│  │  │ VRM       │  │   .js (ONNX)  │  │  │
│  │  │ MediaPipe │  │ 本地模型 ~250MB│  │  │
│  │  └──────────┘  └───────────────┘  │  │
│  └───────────────────────────────────┘  │
│  assets/models/ ←── ONNX bundled         │
└─────────────────────────────────────────┘
         │ WebSocket + WebRTC
         ▼
   云端 Express + Socket.IO 服务器（不变）
```

## 功能规划 (4项，~3周)

### P0: App 化 + Capacitor 集成
- Next.js `output: 'export'` 静态导出改造
- Capacitor 配置 + iOS/Android/Electron 三平台构建
- AI 模型本地打包：whisper-tiny (~39MB) + NLLB-200 (~200MB)
- transformers.js 配置从本地 assets 加载模型

### P1: AI 实时翻译
- 语音 → ASR (Web Speech API 主力 / whisper-tiny fallback)
- 文本 → NLLB-200 翻译 (transformers.js 本地推理)
- 翻译结果 → WebRTC DataChannel "translation"
- TranslationBar 字幕组件

### P2: AI 开场话题
- 匹配成功时根据双方兴趣标签生成破冰话题
- 规则模板 + 标签组合（LLM 留后续版本）
- TopicCard 话题卡片组件

### P3: 基础设施升级 + Bug 修复
- 修复手机端 `[object Event]` 报错
- pm2: next dev → next build + next start
- 匹配队列持久化 (SQLite)

## 模型打包

```
client/public/models/onnx/
  whisper-tiny/     ← ASR fallback (~39MB)
  nllb-200-600M/    ← 翻译 (~200MB)
```

- Web 版保留，不加载 AI 模型（轻量入口 → 引导下 app）
- App 版安装包增加 ~250MB

## 不在此版本

- ❌ VIP/付费体系
- ❌ 虚拟形象皮肤
- ❌ 指定国家匹配
- ❌ 微信小程序
- ❌ LLM 生成话题（先用规则模板）
