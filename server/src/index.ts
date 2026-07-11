import { readFileSync, existsSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import { MatchQueue } from "./matchQueue.js";
import { RoomManager } from "./roomManager.js";
import { generateTopic } from "./topics.js";
import { router as authRouter } from "./routes/auth.js";
import { router as usersRouter } from "./routes/users.js";
import { router as friendsRouter } from "./routes/friends.js";
import { router as historyRouter } from "./routes/history.js";
import { router as reportsRouter } from "./routes/reports.js";

// Load .env.production if present. Node 20.6+ has process.loadEnvFile()
// natively; we fall back to a small manual parser for older runtimes so we
// don't need dotenv as a dependency.
(function loadEnv(path: string) {
  if (!existsSync(path)) return;
  try {
    (process as any).loadEnvFile?.(path);
    if ((process as any).loadEnvFile) return;
  } catch { /* fall through */ }
  const content = readFileSync(path, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
})(".env.production");
import {
  getDb,
  createMatchRecord,
  endMatchRecord,
  sendFriendRequest,
  acceptFriendRequest,
  isDeviceBanned,
} from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/history", historyRouter);
app.use("/api/reports", reportsRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const matchQueue = new MatchQueue();
const roomManager = new RoomManager();
const socketUsers = new Map<string, string>(); // socketId -> userId
const activeSessions = new Map<string, string>(); // userId -> socketId

// Grace period for socket disconnects — lets the same userId rejoin (e.g. after
// a page refresh) without tearing down the room and the peer's PC state.
// key = `${roomId}:${userId}`, value = pending "really-close" timer.
const RECONNECT_GRACE_MS = 15000;
const pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();

// Isolated audio-test rooms — completely independent from matchQueue.
// Used by /audio-test client page to debug WebRTC audio without any other logic.
const testRooms = new Map<string, Set<string>>(); // roomId -> set of socketIds

function kickOldSession(userId: string, newSocketId: string) {
  const oldSocketId = activeSessions.get(userId);
  if (oldSocketId && oldSocketId !== newSocketId) {
    console.log(`[session:kick] ${userId} old=${oldSocketId} new=${newSocketId}`);
    io.to(oldSocketId).emit("session:kick", { message: "账号在其他设备登录" });
  }
  activeSessions.set(userId, newSocketId);
}

function broadcastToFriends(event: string, userId: string, data: Record<string, unknown>) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT f.userId, f.friendId FROM friends f
    WHERE (f.userId = ? OR f.friendId = ?) AND f.status = 'accepted'
  `).all(userId, userId) as any[];

  const friendIds = new Set<string>();
  for (const r of rows) {
    friendIds.add(r.userId === userId ? r.friendId : r.userId);
  }

  for (const [sid, uid] of socketUsers) {
    if (friendIds.has(uid)) {
      io.to(sid).emit(event, data);
    }
  }
}

// periodic cleanup of stale unclaimed rooms
setInterval(() => roomManager.cleanupStale(15000), 10000);

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("match:join", (data: { username: string; userId: string; tags?: string[] }) => {
    const { username, userId } = data;
    console.log(`[match:join] ${username} (${userId})`);

    // Ensure user exists in DB (for FK constraints)
    getDb().prepare("INSERT OR IGNORE INTO users (userId, username, createdAt) VALUES (?, ?, ?)").run(
      userId, username, Date.now(),
    );

    // Check if this user's device is banned
    const user = getDb().prepare("SELECT deviceId FROM users WHERE userId=?").get(userId) as any;
    if (user?.deviceId && isDeviceBanned(user.deviceId)) {
      socket.emit("match:error", { message: "账号已被封禁" });
      return;
    }

    // Kick old session for this user
    kickOldSession(userId, socket.id);

    socketUsers.set(socket.id, userId);

    matchQueue.join({
      userId, username, socketId: socket.id,
      tags: data.tags ?? [],
      deviceId: user?.deviceId || "",
    });
    socket.emit("match:waiting");

    const pair = matchQueue.tryPair();
    if (pair) {
      const roomId = roomManager.create(pair[0], pair[1]);
      createMatchRecord(roomId, pair[0].userId, pair[1].userId);

      const partnerA = { userId: pair[1].userId, username: pair[1].username };
      const partnerB = { userId: pair[0].userId, username: pair[0].username };

      io.to(pair[0].socketId).emit("match:found", { roomId, partner: partnerA });
      io.to(pair[1].socketId).emit("match:found", { roomId, partner: partnerB });

      // Generate and push AI opening topic
      const topic = generateTopic(pair[0].tags, pair[1].tags);
      io.to(pair[0].socketId).emit("match:topic", topic);
      io.to(pair[1].socketId).emit("match:topic", topic);

      console.log(`[match] ${pair[0].username} <-> ${pair[1].username} room=${roomId}`);
    }
  });

  socket.on("match:cancel", (data: { userId: string }) => {
    matchQueue.cancel(data.userId);
    console.log(`[match:cancel] ${data.userId}`);
  });

  socket.on("room:join", (data: { roomId: string; userId: string }) => {
    const room = roomManager.get(data.roomId);
    if (!room) {
      socket.emit("room:error", { message: "房间不存在" });
      return;
    }
    kickOldSession(data.userId, socket.id);
    socketUsers.set(socket.id, data.userId);

    // Detect rejoin vs first join: if this user was already claimed into the
    // room (page refresh, transient disconnect), we skip the "first ready" path
    // and instead nudge the partner to rebuild their PC.
    const isRejoin = room.joinedUserIds.includes(data.userId);

    const ready = roomManager.updateSocket(data.roomId, data.userId, socket.id);
    console.log(`[room:join] ${data.userId} -> socket ${socket.id} room ${data.roomId} rejoin=${isRejoin}`);

    if (isRejoin) {
      // Cancel any pending "really close the room" timer for this user.
      const key = `${data.roomId}:${data.userId}`;
      const pending = pendingDisconnects.get(key);
      if (pending) {
        clearTimeout(pending);
        pendingDisconnects.delete(key);
      }

      // Refetch the room — updateSocket may have refreshed the partner's socketId
      // in the same tick if they also just rejoined.
      const fresh = roomManager.get(data.roomId);
      if (!fresh) return;
      const partner = fresh.users.find((u) => u.userId !== data.userId);
      if (partner) {
        io.to(partner.socketId).emit("partner:rejoined");
      }

      // Restart the WebRTC handshake — both peers reset their PC and the
      // deterministic initiator (lexicographically smaller userId) re-offers.
      const initiatorUserId = fresh.users[0].userId < fresh.users[1].userId
        ? fresh.users[0].userId : fresh.users[1].userId;
      const initiator = fresh.users.find((u) => u.userId === initiatorUserId);
      if (initiator) {
        io.to(initiator.socketId).emit("room:ready");
        console.log(`[room:ready] (rejoin) -> initiator ${initiatorUserId}`);
      }
      return;
    }

    if (ready) {
      const initiatorUserId = room.users[0].userId < room.users[1].userId
        ? room.users[0].userId : room.users[1].userId;
      const initiator = room.users.find((u) => u.userId === initiatorUserId);
      if (initiator) {
        io.to(initiator.socketId).emit("room:ready");
        console.log(`[room:ready] -> initiator ${initiatorUserId}`);
      }
    }
  });

  // WebRTC signaling relay
  socket.on("signal:offer", (data: { roomId: string; sdp: RTCSessionDescriptionInit }) => {
    const room = roomManager.get(data.roomId);
    if (!room) return;
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      io.to(partner.socketId).emit("signal:offer", { sdp: data.sdp });
    }
  });

  socket.on("signal:answer", (data: { roomId: string; sdp: RTCSessionDescriptionInit }) => {
    const room = roomManager.get(data.roomId);
    if (!room) return;
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      io.to(partner.socketId).emit("signal:answer", { sdp: data.sdp });
    }
  });

  socket.on("signal:ice", (data: { roomId: string; candidate: RTCIceCandidateInit }) => {
    const room = roomManager.get(data.roomId);
    if (!room) return;
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      io.to(partner.socketId).emit("signal:ice", { candidate: data.candidate });
    }
  });

  // Friend notifications relay
  socket.on("friend:request", (data: { fromUserId: string; fromUsername: string; toUserId: string }) => {
    for (const [sid, uid] of socketUsers) {
      if (uid === data.toUserId) {
        io.to(sid).emit("friend:request", {
          fromUserId: data.fromUserId,
          fromUsername: data.fromUsername,
        });
        break;
      }
    }
    sendFriendRequest(data.fromUserId, data.toUserId);
  });

  socket.on("friend:accept", (data: { fromUserId: string; toUserId: string }) => {
    const userId = socketUsers.get(socket.id);
    if (!userId) return;
    acceptFriendRequest(userId, data.fromUserId);
    for (const [sid, uid] of socketUsers) {
      if (uid === data.fromUserId) {
        io.to(sid).emit("friend:accepted", { userId });
        break;
      }
    }
  });

  socket.on("room:leave", (data: { roomId: string }) => {
    const room = roomManager.get(data.roomId);
    if (!room) return;
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      io.to(partner.socketId).emit("partner:left");
    }
    // Cancel any pending grace-period timers for either user in this room —
    // explicit leave supersedes the "wait 15s for rejoin" path.
    for (const u of room.users) {
      const key = `${data.roomId}:${u.userId}`;
      const t = pendingDisconnects.get(key);
      if (t) { clearTimeout(t); pendingDisconnects.delete(key); }
    }
    endMatchRecord(data.roomId);
    roomManager.remove(data.roomId);
    console.log(`[room:leave] ${data.roomId}`);
  });

  // ===== Isolated audio-test signaling =====
  // Peers join a shared roomId (chosen client-side, no matching). When 2 present,
  // server picks the initiator deterministically and emits test:ready to both.
  socket.on("test:join", (data: { roomId: string }) => {
    const roomId = String(data?.roomId || "").slice(0, 32);
    if (!roomId) return;
    let peers = testRooms.get(roomId);
    if (!peers) { peers = new Set(); testRooms.set(roomId, peers); }
    peers.add(socket.id);
    (socket.data as any).testRoom = roomId;
    console.log(`[test:join] socket=${socket.id} room=${roomId} peers=${peers.size}`);
    if (peers.size === 2) {
      const arr = [...peers];
      const initiator = arr[0] < arr[1] ? arr[0] : arr[1];
      for (const sid of arr) {
        io.to(sid).emit("test:ready", { initiator: sid === initiator });
      }
      console.log(`[test:ready] room=${roomId} initiator=${initiator}`);
    } else if (peers.size > 2) {
      // Third joiner — reject to keep test 1-on-1
      io.to(socket.id).emit("test:full");
      peers.delete(socket.id);
    }
  });

  const relayTest = (event: string) => (data: { roomId: string; [k: string]: any }) => {
    const peers = testRooms.get(data?.roomId);
    if (!peers) return;
    for (const sid of peers) {
      if (sid !== socket.id) io.to(sid).emit(event, data);
    }
  };
  socket.on("test:offer", relayTest("test:offer"));
  socket.on("test:answer", relayTest("test:answer"));
  socket.on("test:ice", relayTest("test:ice"));

  socket.on("test:leave", (data: { roomId: string }) => {
    const peers = testRooms.get(data?.roomId);
    if (!peers) return;
    peers.delete(socket.id);
    for (const sid of peers) io.to(sid).emit("test:partner-left");
    if (peers.size === 0) testRooms.delete(data.roomId);
    console.log(`[test:leave] socket=${socket.id} room=${data.roomId}`);
  });

  socket.on("disconnect", () => {
    const userId = socketUsers.get(socket.id);

    // Clean session if this was the active one
    if (userId && activeSessions.get(userId) === socket.id) {
      activeSessions.delete(userId);
    }

    matchQueue.removeBySocket(socket.id);

    const room = roomManager.getBySocket(socket.id);
    if (room && roomManager.isClaimed(room.roomId) && userId) {
      const partner = room.users.find((u) => u.socketId !== socket.id);
      if (partner) {
        io.to(partner.socketId).emit("partner:disconnected");
      }
      // Give the user 15s to rejoin (page refresh, transient network). Only
      // then do we tear the room down and notify the partner it's really over.
      const roomId = room.roomId;
      const key = `${roomId}:${userId}`;
      const existing = pendingDisconnects.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pendingDisconnects.delete(key);
        const stillThere = roomManager.get(roomId);
        if (!stillThere) return; // already cleaned up (e.g. explicit room:leave)
        // Was the user's socket refreshed in the meantime? updateSocket() would
        // have cleared the timer via room:join; if we're here, they didn't rejoin.
        const stillDisconnected = !stillThere.users.some((u) => u.userId === userId && socketUsers.has(u.socketId));
        if (!stillDisconnected) return;
        const currentPartner = stillThere.users.find((u) => u.userId !== userId);
        if (currentPartner) {
          io.to(currentPartner.socketId).emit("partner:left");
        }
        endMatchRecord(roomId);
        roomManager.remove(roomId);
        console.log(`[disconnect cleanup after grace] ${roomId}`);
      }, RECONNECT_GRACE_MS);
      pendingDisconnects.set(key, timer);
      console.log(`[disconnect pending] ${roomId} user=${userId} grace=${RECONNECT_GRACE_MS}ms`);
    }

    // Clean up test room membership
    const testRoom = (socket.data as any)?.testRoom;
    if (testRoom) {
      const peers = testRooms.get(testRoom);
      if (peers) {
        peers.delete(socket.id);
        for (const sid of peers) io.to(sid).emit("test:partner-left");
        if (peers.size === 0) testRooms.delete(testRoom);
      }
    }

    socketUsers.delete(socket.id);
    console.log(`[disconnect] ${socket.id}`);
  });
});

const PORT = parseInt(process.env.PORT || "3002", 10);
httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
