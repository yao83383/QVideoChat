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
import {
  router as inviteRouter,
  setInvitationNotifier,
  setRoomChecker,
} from "./routes/invite.js";
import { migrateLegacyUsersToConfirmed } from "./invite.js";

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
  getUserByToken,
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
app.use("/api/invite", inviteRouter);

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
const userSockets = new Map<string, string>(); // userId -> socketId (mirror of socketUsers keyed the other way, so presence fanout is O(1) instead of scanning socketUsers)
const activeSessions = new Map<string, string>(); // userId -> socketId

// Grace period for socket disconnects — lets the same userId rejoin (e.g. after
// a page refresh) without tearing down the room and the peer's PC state.
// key = `${roomId}:${userId}`, value = pending "really-close" timer.
const RECONNECT_GRACE_MS = 15000;
const pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();

// Isolated audio-test rooms — completely independent from matchQueue.
// Used by /audio-test client page to debug WebRTC audio without any other logic.
const testRooms = new Map<string, Set<string>>(); // roomId -> set of socketIds

// -----------------------------------------------------------------------------
// Presence layer (Phase 1.3)
// -----------------------------------------------------------------------------
//
// friendsCache: userId → Set of that user's accepted-friend userIds. Lazily
// populated on first read, invalidated when friend:accept lands. Avoids
// hitting SQLite per frame during the always-on presence broadcast.
//
// subscribers: publisherUserId → Set of subscriberUserIds who currently
// want that publisher's frames (i.e. have their AvatarTile mounted in
// FriendList). Managed by presence:sub/unsub. Server forwards
// presence:frame only to (subscribers ∩ friends) — double gate so a
// stale sub without an accepted-friend row can't leak avatar data.
//
// presenceUsers: userIds that have completed a presence:hello handshake
// (i.e. are declared "online for presence purposes"). Disjoint from
// matching / in-call state, which are tracked by matchQueue / roomManager
// and combined into a single busy state by getUserBusyState.
const friendsCache = new Map<string, Set<string>>();
const subscribers = new Map<string, Set<string>>();
const presenceUsers = new Set<string>();
const sleepingUsers = new Set<string>();

function getFriendsOf(userId: string): Set<string> {
  let set = friendsCache.get(userId);
  if (set) return set;
  const rows = getDb().prepare(`
    SELECT userId, friendId FROM friends
    WHERE (userId = ? OR friendId = ?) AND status = 'accepted'
  `).all(userId, userId) as any[];
  set = new Set<string>();
  for (const r of rows) {
    set.add(r.userId === userId ? r.friendId : r.userId);
  }
  friendsCache.set(userId, set);
  return set;
}

function invalidateFriendsCache(userId: string, friendId: string) {
  friendsCache.delete(userId);
  friendsCache.delete(friendId);
}

type BusyState = "offline" | "idle" | "sleeping" | "matching" | "in-call";

function getUserBusyState(userId: string): BusyState {
  if (matchQueue.hasUser(userId)) return "matching";
  if (roomManager.getByUserId(userId)) return "in-call";
  if (!userSockets.has(userId)) return "offline";
  if (sleepingUsers.has(userId)) return "sleeping";
  return "idle";
}

/** Emit an event to every online friend of `userId`. O(friends) — the SQL
 *  hit happens once per (userId, boot) via friendsCache. */
function broadcastToFriends(event: string, userId: string, data: Record<string, unknown>) {
  const friendIds = getFriendsOf(userId);
  for (const fid of friendIds) {
    const sid = userSockets.get(fid);
    if (sid) io.to(sid).emit(event, data);
  }
}

function kickOldSession(userId: string, newSocketId: string) {
  const oldSocketId = activeSessions.get(userId);
  if (oldSocketId && oldSocketId !== newSocketId) {
    console.log(`[session:kick] ${userId} old=${oldSocketId} new=${newSocketId}`);
    io.to(oldSocketId).emit("session:kick", { message: "账号在其他设备登录" });
  }
  activeSessions.set(userId, newSocketId);
}

/** Register the (socketId, userId) pairing across every side table we keep.
 *  Called from every entry point that "claims" a socket for a userId
 *  (match:join, room:join, presence:hello) so we can't forget one and
 *  end up with a half-registered user. */
function bindUserSocket(userId: string, socketId: string) {
  socketUsers.set(socketId, userId);
  userSockets.set(userId, socketId);
}

// --- Invitation notifier wiring ---
//
// invite router calls these hooks whenever it creates or resolves a pending
// invitation. We translate userId → live socketId(s) here so the router
// stays decoupled from socket.io. Same wiring later gets the Web Push
// dispatcher (J10) hung off it.
setInvitationNotifier((targetUserId, event, payload) => {
  const sid = userSockets.get(targetUserId);
  if (sid) io.to(sid).emit(event, payload);
});

setRoomChecker((roomId, userA, userB) => {
  const room = roomManager.get(roomId);
  if (!room) return false;
  const ids = room.users.map((u) => u.userId);
  return ids.includes(userA) && ids.includes(userB);
});

// One-shot migration on boot: any legacy registered users get promoted to
// confirmed + OFFICIAL displayId. Idempotent — skips already-migrated ones.
migrateLegacyUsersToConfirmed();

// periodic cleanup of stale unclaimed rooms
setInterval(() => roomManager.cleanupStale(15000), 10000);

// -----------------------------------------------------------------------------
// Socket authentication middleware (Phase 1.3 — transitional, warning-only)
// -----------------------------------------------------------------------------
//
// We WANT every socket to arrive with a valid handshake token so downstream
// events can trust socket.data.userId instead of whatever the client claims
// in each payload. But flipping this to hard-reject in one go would
// disconnect every old client (including a user with the app open across
// three tabs) the instant we deploy, so we run in "warning mode" for a
// week: unauthenticated connects go through, but we log them and mark the
// socket so we can measure how many are left before switching the reject
// on. Presence events specifically require socket.data.userId to be set —
// unauthenticated sockets can still do match:join (which sets it as a
// side effect via the userId in the payload) but can't publish frames.
io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token as string | undefined;
  if (!token) {
    console.warn(`[auth:warn] no token on socket ${socket.id} — allowing (transitional)`);
    (socket.data as any).authOk = false;
    return next();
  }
  const user = getUserByToken(token);
  if (!user) {
    console.warn(`[auth:warn] unknown token on socket ${socket.id} — allowing (transitional)`);
    (socket.data as any).authOk = false;
    return next();
  }
  (socket.data as any).userId = user.userId;
  (socket.data as any).authOk = true;
  next();
});

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("match:join", (data: { username: string; userId: string; tags?: string[]; nativeLang?: string; targetLang?: string }) => {
    const { username, userId } = data;
    console.log(`[match:join] ${username} (${userId}) sl=${data.nativeLang || "-"} tl=${data.targetLang || "-"}`);

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

    bindUserSocket(userId, socket.id);

    matchQueue.join({
      userId, username, socketId: socket.id,
      tags: data.tags ?? [],
      deviceId: user?.deviceId || "",
      nativeLang: data.nativeLang || undefined,
      targetLang: data.targetLang || undefined,
    });
    // Tell friends this user just left the "idle" pool. If they were
    // publishing presence frames we also stop the fanout implicitly (the
    // frame handler filters on busy state).
    broadcastToFriends("presence:busy", userId, { userId, state: "matching" });
    socket.emit("match:waiting");

    const pair = matchQueue.tryPair();
    if (pair) {
      const roomId = roomManager.create(pair[0], pair[1]);
      createMatchRecord(roomId, pair[0].userId, pair[1].userId);

      const partnerA = { userId: pair[1].userId, username: pair[1].username };
      const partnerB = { userId: pair[0].userId, username: pair[0].username };

      io.to(pair[0].socketId).emit("match:found", { roomId, partner: partnerA });
      io.to(pair[1].socketId).emit("match:found", { roomId, partner: partnerB });

      // Both users transitioned matching → in-call. Update friends' tiles
      // so a friend who was watching them "searching" now sees "in call"
      // (both render as the same orange 忙 dot, but keeps state accurate
      // for Phase 2 where an "in-call" friend still shouldn't be pinged).
      broadcastToFriends("presence:busy", pair[0].userId, { userId: pair[0].userId, state: "in-call" });
      broadcastToFriends("presence:busy", pair[1].userId, { userId: pair[1].userId, state: "in-call" });

      // Generate and push AI opening topic
      const topic = generateTopic(pair[0].tags, pair[1].tags);
      io.to(pair[0].socketId).emit("match:topic", topic);
      io.to(pair[1].socketId).emit("match:topic", topic);

      console.log(`[match] ${pair[0].username} <-> ${pair[1].username} room=${roomId}`);
    }
  });

  socket.on("match:cancel", (data: { userId: string }) => {
    matchQueue.cancel(data.userId);
    // matching → idle. If the socket is still bound to this userId (and
    // they aren't in some other room), tell friends they're back to idle.
    if (userSockets.get(data.userId) === socket.id && !roomManager.getByUserId(data.userId)) {
      broadcastToFriends("presence:idle", data.userId, { userId: data.userId });
    }
    console.log(`[match:cancel] ${data.userId}`);
  });

  socket.on("room:join", (data: { roomId: string; userId: string }) => {
    const room = roomManager.get(data.roomId);
    if (!room) {
      socket.emit("room:error", { message: "房间不存在" });
      return;
    }
    kickOldSession(data.userId, socket.id);
    bindUserSocket(data.userId, socket.id);

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
    const targetSid = userSockets.get(data.toUserId);
    if (targetSid) {
      io.to(targetSid).emit("friend:request", {
        fromUserId: data.fromUserId,
        fromUsername: data.fromUsername,
      });
    }
    sendFriendRequest(data.fromUserId, data.toUserId);
  });

  socket.on("friend:accept", (data: { fromUserId: string; toUserId: string }) => {
    const userId = socketUsers.get(socket.id);
    if (!userId) return;
    acceptFriendRequest(userId, data.fromUserId);
    // New friendship — both sides' cached friend sets are now stale. Drop
    // them so the next presence broadcast re-reads from DB and picks up
    // the new edge.
    invalidateFriendsCache(userId, data.fromUserId);

    const otherSid = userSockets.get(data.fromUserId);
    if (otherSid) {
      io.to(otherSid).emit("friend:accepted", { userId });
      // Push initial presence snapshot both ways so each side's newly
      // rendered tile isn't blank until the next state change. If one
      // side isn't presence-hello'd yet the other just sees offline.
      if (presenceUsers.has(userId)) {
        io.to(otherSid).emit("presence:online", { userId });
      }
    }
    if (presenceUsers.has(data.fromUserId)) {
      const mySid = userSockets.get(userId);
      if (mySid) io.to(mySid).emit("presence:online", { userId: data.fromUserId });
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
    // Snapshot users before remove() drops the room — we need userIds to
    // announce the state transition, and getByUserId won't find them
    // afterwards.
    const leavers = room.users.map((u) => u.userId);
    roomManager.remove(data.roomId);
    // Both users transitioned in-call → idle (if still online). Tell each
    // one's friends so their tile flips back to green.
    for (const uid of leavers) {
      if (userSockets.has(uid) && !matchQueue.hasUser(uid) && !roomManager.getByUserId(uid)) {
        broadcastToFriends("presence:idle", uid, { userId: uid });
      }
    }
    console.log(`[room:leave] ${data.roomId}`);
  });

  // ===== Presence layer (Phase 1.3) =====
  //
  // Rate limit for presence:frame. We cap upstream at ~40 Hz per user
  // (a bit above the intended 30fps so a slightly early tick doesn't
  // get dropped) — burst spikes above that are silently discarded so
  // one runaway client can't melt the fanout.
  const PRESENCE_FRAME_MIN_INTERVAL_MS = 25;
  const lastFrameAt = new Map<string, number>(); // userId -> ts

  socket.on("presence:hello", (data: { userId?: string }) => {
    // Prefer the authenticated userId; fall back to payload during the
    // io.use transition period (auth:warn is logged upstream). Reject the
    // event outright if we don't have a userId either way.
    const userId = (socket.data as any).userId as string | undefined ?? data?.userId;
    if (!userId) return;

    // If this is the user's first "authoritative" socket (e.g. they had
    // been in match:join → room:join without a presence hello yet), bind
    // now. If they were already bound to another socket, kick the old one
    // so presence and match paths agree on which socket owns the user.
    if (userSockets.get(userId) !== socket.id) {
      kickOldSession(userId, socket.id);
      bindUserSocket(userId, socket.id);
    }

    // Warm the friend cache before broadcasting so we don't do two DB hits
    // (one for online broadcast, one for the first frame).
    getFriendsOf(userId);

    if (!presenceUsers.has(userId)) {
      presenceUsers.add(userId);
      // Fresh presence transition: not sleeping until AFK triggers it.
      sleepingUsers.delete(userId);
      broadcastToFriends("presence:online", userId, { userId });
      console.log(`[presence:hello] ${userId} sid=${socket.id}`);
    }

    // Snapshot: tell the joiner which of their friends are currently
    // online/busy/sleeping so their FriendList tiles paint the right
    // state immediately (without waiting for the next per-friend
    // event). Only friends with a live socket count — offline friends
    // just render as empty by default.
    const friends = getFriendsOf(userId);
    const snapshot: Array<{ userId: string; state: BusyState }> = [];
    for (const fid of friends) {
      const state = getUserBusyState(fid);
      if (state !== "offline") snapshot.push({ userId: fid, state });
    }
    socket.emit("presence:snapshot", { friends: snapshot });
  });

  socket.on("presence:sub", (data: { userIds?: string[] }) => {
    const me = (socket.data as any).userId as string | undefined ?? socketUsers.get(socket.id);
    if (!me) return;
    const ids = Array.isArray(data?.userIds) ? data.userIds : [];
    const friends = getFriendsOf(me);
    for (const pubId of ids) {
      if (typeof pubId !== "string") continue;
      // Enforce the friendship gate at subscription time — if they
      // aren't friends we don't even record the sub, so a later
      // race (frame arrives before friend accept lands) can't leak.
      if (!friends.has(pubId)) continue;
      let subs = subscribers.get(pubId);
      if (!subs) { subs = new Set(); subscribers.set(pubId, subs); }
      subs.add(me);
    }
  });

  socket.on("presence:unsub", (data: { userIds?: string[] }) => {
    const me = (socket.data as any).userId as string | undefined ?? socketUsers.get(socket.id);
    if (!me) return;
    const ids = Array.isArray(data?.userIds) ? data.userIds : [];
    for (const pubId of ids) {
      const subs = subscribers.get(pubId);
      if (subs) {
        subs.delete(me);
        if (subs.size === 0) subscribers.delete(pubId);
      }
    }
  });

  socket.on("presence:sleeping", (data: { sleeping?: boolean }) => {
    const me = (socket.data as any).userId as string | undefined ?? socketUsers.get(socket.id);
    if (!me) return;
    const sleeping = !!data?.sleeping;
    const was = sleepingUsers.has(me);
    if (sleeping === was) return;
    if (sleeping) sleepingUsers.add(me);
    else sleepingUsers.delete(me);
    broadcastToFriends("presence:sleeping", me, { userId: me, sleeping });
  });

  // Client → server → subscribed friends. Payload is opaque to the server
  // (the codec lives client-side); we only stamp `fromUserId` on the way
  // out so subscribers can route to the right presence entry.
  socket.on("presence:frame", (payload: any) => {
    const me = (socket.data as any).userId as string | undefined ?? socketUsers.get(socket.id);
    if (!me) return;

    // Busy gate — never leak avatar frames while the user is matching or
    // in a call. Sleeping is a soft-stop (client should stop sending,
    // but if a stray frame arrives we also drop it here).
    const state = getUserBusyState(me);
    if (state !== "idle") return;

    // Rate limit.
    const now = Date.now();
    const last = lastFrameAt.get(me) || 0;
    if (now - last < PRESENCE_FRAME_MIN_INTERVAL_MS) return;
    lastFrameAt.set(me, now);

    const subs = subscribers.get(me);
    if (!subs || subs.size === 0) return;
    const friends = getFriendsOf(me);
    const out = { fromUserId: me, ...(payload || {}) };
    for (const subId of subs) {
      if (!friends.has(subId)) continue; // double gate — sub AND friend
      const sid = userSockets.get(subId);
      if (sid) io.to(sid).emit("presence:frame", out);
    }
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

    // Distinguish this disconnect from the "old socket kicked by a new
    // login" case. If activeSessions[userId] no longer points at us, a
    // newer socket has already taken over — leaving userSockets alone
    // avoids stomping on the live registration.
    const isCurrentSession = !userId || activeSessions.get(userId) === socket.id;

    // Clean session if this was the active one
    if (userId && isCurrentSession) {
      activeSessions.delete(userId);
    }

    // Snapshot whether this user was matching before we drop them from
    // the queue, so we can announce the state transition below.
    const wasMatching = !!userId && matchQueue.hasUser(userId);
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
        // Snapshot before remove(), then broadcast the state transition
        // for the surviving side (in-call → idle) if they're still online.
        const survivorId = currentPartner?.userId;
        roomManager.remove(roomId);
        if (survivorId && userSockets.has(survivorId)
            && !matchQueue.hasUser(survivorId)
            && !roomManager.getByUserId(survivorId)) {
          broadcastToFriends("presence:idle", survivorId, { userId: survivorId });
        }
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

    // Presence teardown — only fire when this was the currently-active
    // session for the user AND they're not sitting in a room whose grace
    // timer hasn't fired yet (in that case they're still "in-call" from
    // friends' perspective; the grace-timer path above handles the flip).
    if (userId && isCurrentSession) {
      userSockets.delete(userId);
      const wasPresence = presenceUsers.delete(userId);
      sleepingUsers.delete(userId);
      // Clean up any subscription state: this user's own subscribers
      // don't need clearing (they'll re-sub on reconnect), but we DO
      // need to remove this user FROM other publishers' subscriber sets
      // so we don't try to forward their frames to a dead socket.
      for (const set of subscribers.values()) set.delete(userId);
      subscribers.delete(userId);

      // Only broadcast a state transition if there isn't a still-running
      // room grace timer (which will decide the final state itself).
      const hasPendingRoom = Array.from(pendingDisconnects.keys())
        .some((k) => k.endsWith(`:${userId}`));
      if (!hasPendingRoom) {
        if (wasPresence) {
          broadcastToFriends("presence:offline", userId, { userId });
        } else if (wasMatching) {
          // Matching → offline. Not a presence user, so no "offline" per se,
          // but their busy tile should clear.
          broadcastToFriends("presence:offline", userId, { userId });
        }
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
