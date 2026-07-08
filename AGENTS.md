# QVideoChat 项目规则

## 版本号规则

- 版本号遵循语义化版本：`MAJOR.MINOR.PATCH`
- **每次打包（deploy/packaging）时，必须将 PATCH 位（最低位）增加 1**
- 例如：1.2.0 → 打包 → 1.2.1 → 打包 → 1.2.2
- 打包前同时更新 `server/package.json` 和 `client/package.json` 中的 version 字段
- MINOR 和 MAJOR 位仅在重大功能或架构变更时手动决定

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
