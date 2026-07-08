# QVideoChat 项目规则

## 版本号规则

- 完整版本号格式：`MAJOR.MINOR.PATCH.BUILD`，首页展示用
- `MAJOR.MINOR.PATCH` 遵循语义化版本，记录在 `server/package.json` 和 `client/package.json`
- `BUILD` 为三位数字（如 001, 002），代表每次代码改动
- **每次修改代码后，BUILD 位（第四位）增加 1**
- **每次打包（deploy/packaging）时，将 PATCH 位（第三位）增加 1，BUILD 重置为 001**
- 例如：1.2.0.001 → 改代码 → 1.2.0.002 → 打包 → 1.2.1.001 → 改代码 → 1.2.1.002
- 修改代码时更新 `client/.env.local` 中的 `NEXT_PUBLIC_APP_VERSION`
- 打包时同步更新 `server/package.json`、`client/package.json` 和 `client/.env.local`

## 项目概述

Q版虚拟形象随机匹配视频通话。摄像头 → MediaPipe Blendshape → DataChannel 传输（不传原始视频），WebRTC AudioTrack 传输音频，Three.js + VRM 渲染 3D 形象。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 + Three.js + @pixiv/three-vrm |
| 面部追踪 | MediaPipe FaceLandmarker (tasks-vision) |
| 实时通信 | WebRTC (DataChannel + AudioTrack) |
| 信令 | Socket.IO |
| 后端 | Express 5 + TypeScript + better-sqlite3 |
| 部署 | pm2 + Docker |

## 部署信息

参考 `.opencode/plans/` 下的 handoff 文档获取最新的部署步骤和环境信息。
