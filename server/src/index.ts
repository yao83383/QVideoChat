import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { MatchQueue } from "./matchQueue.js";
import { RoomManager } from "./roomManager.js";

const app = express();
app.get("/", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const matchQueue = new MatchQueue();
const roomManager = new RoomManager();

// periodic cleanup of stale unclaimed rooms
setInterval(() => roomManager.cleanupStale(15000), 10000);

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("match:join", (data: { username: string; userId: string }) => {
    const { username, userId } = data;
    console.log(`[match:join] ${username} (${userId})`);

    matchQueue.join({ userId, username, socketId: socket.id });
    socket.emit("match:waiting");

    const pair = matchQueue.tryPair();
    if (pair) {
      const roomId = roomManager.create(pair[0], pair[1]);

      const partnerA = { userId: pair[1].userId, username: pair[1].username };
      const partnerB = { userId: pair[0].userId, username: pair[0].username };

      io.to(pair[0].socketId).emit("match:found", { roomId, partner: partnerA });
      io.to(pair[1].socketId).emit("match:found", { roomId, partner: partnerB });

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
    const ready = roomManager.updateSocket(data.roomId, data.userId, socket.id);
    console.log(`[room:join] ${data.userId} -> socket ${socket.id} room ${data.roomId}`);
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
    console.log(`[signal:offer] from ${socket.id} room ${data.roomId}`);
    const room = roomManager.get(data.roomId);
    if (!room) { console.log(`[signal:offer] room ${data.roomId} not found`); return; }
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      console.log(`[signal:offer] relay to ${partner.socketId}`);
      io.to(partner.socketId).emit("signal:offer", { sdp: data.sdp });
    } else {
      console.log(`[signal:offer] no partner found in room`);
    }
  });

  socket.on("signal:answer", (data: { roomId: string; sdp: RTCSessionDescriptionInit }) => {
    console.log(`[signal:answer] from ${socket.id} room ${data.roomId}`);
    const room = roomManager.get(data.roomId);
    if (!room) { console.log(`[signal:answer] room ${data.roomId} not found`); return; }
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      console.log(`[signal:answer] relay to ${partner.socketId}`);
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

  socket.on("room:leave", (data: { roomId: string }) => {
    const room = roomManager.get(data.roomId);
    if (!room) return;
    const partner = room.users.find((u) => u.socketId !== socket.id);
    if (partner) {
      io.to(partner.socketId).emit("partner:left");
    }
    roomManager.remove(data.roomId);
    console.log(`[room:leave] ${data.roomId}`);
  });

  socket.on("disconnect", () => {
    matchQueue.removeBySocket(socket.id);
    const room = roomManager.getBySocket(socket.id);
    if (room && roomManager.isClaimed(room.roomId)) {
      const partner = room.users.find((u) => u.socketId !== socket.id);
      if (partner) {
        io.to(partner.socketId).emit("partner:left");
      }
      roomManager.remove(room.roomId);
      console.log(`[disconnect cleanup] ${room.roomId}`);
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
