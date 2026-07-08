# QVideoChat 1.1.0 — Session Handoff

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
| 部署 | pm2 + Docker (生产) / 手动 tsx + next start (测试) |

## 代码仓库

- **GitHub**: `https://github.com/yao83383/QVideoChat`
- **分支**: `master`
- **本地工作目录**: `E:\Projs\QVideoChat`

## 服务器信息

| 环境 | URL | 目录 | 端口 |
|------|-----|------|------|
| 生产 | `https://justsaysayforfun.com/qvideochat` | `/opt/qvideochat` | Docker: 4000/4001 |
| 测试 | `https://justsaysayforfun.com/q-dev` | `/opt/qvideochat-dev` | 3000 (client) / 3002 (server) |
| SSH | `root@justsaysayforfun.com` | 密钥: `E:\Projs\QVideoChat\key\starluck.pem` |

**Nginx 路由（测试环境）**:
- `/q-dev` → `127.0.0.1:3000/q-dev` (Next.js 客户端)
- `/qsignal/` → `127.0.0.1:3002/` (Express/Socket.IO 服务端)

## 1.1.0 已完成功能

### 基础设施
- **SQLite 数据库** (`server/src/db.ts`): 7 张表
  - `users`: userId, username, email, passwordHash, token, deviceId, referredBy, avatarOutfit, matchCount, totalDuration
  - `tags`: 12 个预定义兴趣标签
  - `user_tags`: 用户-标签关联
  - `friends`: 好友关系 (pending/accepted)
  - `match_history`: 匹配记录 (roomId, userA, userB, startedAt, endedAt)
  - `banned_devices`: 封禁设备
  - `reports`: 举报记录

### 功能模块
- **用户系统**: 匿名游客 (设备指纹复用) + 注册/登录
- **兴趣标签匹配**: tag-aware 打分算法，10s 超时回退随机
- **好友系统**: 添加/接受/列表，Socket 实时推送
- **匹配历史 + 个人主页**: 时长统计、最近匹配
- **反作弊**: 设备指纹 (UA+屏幕+CPU+时区 hash) → banned_devices → 举报
- **Session 管理**: 同一 userId 单 session，旧登录被踢
- **邀请链路**: referredBy 字段 + 邀请码复制 + 已邀请列表
- **设置**: 匹配时显示/隐藏 ID 开关
- **摄像头/麦克风开关**: 📷🎙 圆形按钮，关摄像头不黑屏只隐藏形象
- **音频波纹**: VoiceStatus 组件显示在双方头像下方（柱状可视化）

## 客户端文件结构

```
client/
  app/
    page.tsx              # 主页 (昵称输入 + 标签 + 匹配 + 设置/好友入口)
    room/[id]/page.tsx     # 房间页 (双人 avatar + 音视频控制 + 好友/举报)
    login/page.tsx         # 登录/注册页 (支持 invite 参数)
    profile/page.tsx       # 个人主页 (统计 + 邀请 + 历史)
    layout.tsx             # 根布局
    globals.css            # 全局样式
  components/
    VrmAvatar.tsx          # Three.js VRM 渲染
    BlendshapeDebug.tsx    # blendshape 调试画布
    VoiceStatus.tsx        # 音频波纹柱状图 (5 bars)
    MatchButton.tsx        # 通用按钮
    NameInput.tsx          # 昵称输入框
    TagSelector.tsx        # 兴趣标签选择器
    FriendList.tsx         # 好友列表弹窗
    LoginPrompt.tsx        # 游客加好友时引导注册弹窗
    SettingsModal.tsx      # 设置弹窗 (显示ID开关)
  hooks/
    useFaceMesh.ts         # MediaPipe 面部追踪 (摄像头 + blendshape 提取)
    usePeer.ts             # WebRTC 管理 (PC/DC/Audio/信令)
    useSocket.ts           # Socket.IO 客户端
    useUser.ts             # 用户状态管理 (localStorage)
  lib/
    webrtc.ts              # WebRTC 工具 (STUN/TURN/ICE/addTrack/offer/answer)
    blendshapeMap.ts       # VRM 加载 + blendshape→表情映射
    api.ts                 # REST API 封装 (自动带 token)
    device.ts              # 设备指纹生成
  public/
    wasm/                  # MediaPipe WASM 文件
    models/                # face_landmarker.task / sample.vrm
```

## 服务端文件结构

```
server/src/
  index.ts                 # Express + Socket.IO 主入口 (3002)
  db.ts                    # SQLite 数据库操作
  matchQueue.ts            # 匹配队列 (tag-aware 打分)
  roomManager.ts           # 房间管理
  routes/
    auth.ts                # /api/auth/* (注册/登录/匿名创建)
    users.ts               # /api/users/* (标签/统计/邀请)
    friends.ts             # /api/friends/* (好友CRUD)
    history.ts             # /api/history/* (匹配记录)
    reports.ts             # /api/reports/* (举报)
```

## 当前待解决问题

### 1. 音频双向 (优先级: 高)
- **现象**: PC → 手机能听到，手机 → PC 也能听到，但双向是否都通待验证
- **最近修复**: 
  - `handleIncomingOffer` 不再重复 `addTrack`（会报 "sender already exists"）
  - 改为只加固 `transceiver.direction = "sendrecv"`
  - `ontrack` 兼容 `event.streams[0]` 为 null
  - `createOffer` 加 `offerToReceiveAudio: true`
  - `addAudioTrack` 设 transceiver direction 为 "sendrecv"
- **关键文件**: `client/lib/webrtc.ts`, `client/hooks/usePeer.ts`

### 2. 手机端 [object Event] 报错 (优先级: 中)
- **现象**: 手机浏览器显示 `[object Event]` 错误
- **根因**: `client/hooks/useFaceMesh.ts` 的 catch 块用 `String(e)` 转换 Event 对象
- **需要修复的位置**:
  - `useFaceMesh.ts` line ~91: `setError(e?.message || ... || String(e))`
  - `useFaceMesh.ts` line ~99: `setError(\`\${step}: ...  || String(e)\`)`
- **修复方式**: 改为 `e?.message || e?.type || String(e)` 或类似

### 3. production 缺少 .env.local (优先级: 低)
- 测试环境可以用 `.env.production`，但 Docker 构建需要 env var
- `docker-compose.stable.yml` 已配置 NEXT_PUBLIC_* args

## 部署到测试服务器步骤

```bash
# 本地打包
tar -czf deploy.tar.gz --exclude='node_modules' --exclude='.next' --exclude='.git' -C E:\Projs\QVideoChat server client

# 上传
scp -i E:\Projs\QVideoChat\key\starluck.pem deploy.tar.gz root@justsaysayforfun.com:/tmp/

# 服务器解压 + 安装 + 构建 + 重启
ssh -i E:\Projs\QVideoChat\key\starluck.pem root@justsaysayforfun.com "cd /opt/qvideochat-dev; tar -xzf /tmp/deploy.tar.gz; cd server; npm install; cd ../client; rm -rf .next; NODE_OPTIONS='--max-old-space-size=512' npx next build; fuser -k 3000/tcp; fuser -k 3002/tcp; sleep 1; cd /opt/qvideochat-dev/server; nohup npx tsx src/index.ts > /tmp/qvideo-server.log 2>&1 &; cd /opt/qvideochat-dev/client; nohup npx next start -p 3000 > /tmp/qvideo-client.log 2>&1 &"
```

## 环境变量

**client/.env.production (测试)**:
```
NEXT_PUBLIC_SERVER_URL=https://justsaysayforfun.com
NEXT_PUBLIC_SOCKET_PATH=/qsignal/socket.io
NEXT_PUBLIC_BASE_PATH=/q-dev
```

**client/.env.local (本地开发)**:
```
NEXT_PUBLIC_SERVER_URL=http://localhost:3002
NEXT_PUBLIC_SOCKET_PATH=/socket.io
```

## 数据库迁移注意事项

SQLite 数据库有 ALTER TABLE 迁移 (用 try/catch 包裹):
- `users.deviceId` (TEXT DEFAULT '')
- `users.referredBy` (TEXT DEFAULT '')

首次创建或迁移时自动处理，不会丢数据。
