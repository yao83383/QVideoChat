# QVideoChat - 稳定版 v1.0

Q版虚拟形象 · 随机匹配视频通话

## 核心功能
- 摄像头 → MediaPipe 面部追踪 → 52 blendshape 系数
- 系数通过 WebRTC DataChannel 传输（不传原始画面，隐私零泄露）
- 对方 Q版 3D 形象被实时表情驱动
- 音频通过 WebRTC AudioTrack 传输
- 国内 TURN 中继保证跨网穿透

## 技术栈
| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 + Three.js |
| 面部追踪 | MediaPipe FaceLandmarker (tasks-vision) |
| 实时通信 | WebRTC (DataChannel + AudioTrack) |
| 信令 | Socket.IO |
| TURN | coturn |
| 部署 | pm2 + Docker (稳定版) |

## 快速启动

### 本地开发
```bash
# 信令服务器
cd server && npm install && npm run dev    # → :3001
# 前端
cd client && npm install && npm run dev    # → :3000 (/q)
```

### 生产部署 (pm2)
```bash
cd server && npm install
cd client && npm install
pm2 start ecosystem.config.cjs
```

### 稳定版 Docker
```bash
docker compose -f docker-compose.stable.yml up -d --build
# 客户端 :4000  /  信令 :4001
```

## 环境变量 (client/.env.local)
```
NEXT_PUBLIC_SERVER_URL=https://your-domain.com
NEXT_PUBLIC_SOCKET_PATH=/qsignal/socket.io
```

## ICE 配置 (client/lib/webrtc.ts)
使用自建 TURN 中继 + 国内 STUN 服务器
