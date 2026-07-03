import { Router, Request, Response } from "express";
import { getUserByToken, sendFriendRequest, acceptFriendRequest, getFriends } from "../db.js";

export const router = Router();

function auth(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const user = getUserByToken(h.slice(7));
  return user?.userId ?? null;
}

router.post("/request", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const { friendId } = req.body;
  if (!friendId) { res.status(400).json({ error: "缺少 friendId" }); return; }
  if (userId === friendId) { res.status(400).json({ error: "不能加自己" }); return; }
  const status = sendFriendRequest(userId, friendId);
  res.json({ status });
});

router.post("/accept", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const { friendId } = req.body;
  if (!friendId) { res.status(400).json({ error: "缺少 friendId" }); return; }
  acceptFriendRequest(userId, friendId);
  res.json({ ok: true });
});

router.get("/", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const friends = getFriends(userId);
  res.json(friends);
});

router.get("/pending", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const db = require("../db.js").getDb();
  const requests = db.prepare(
    "SELECT f.id, f.userId as fromUserId, u.username as fromUsername, f.createdAt FROM friends f JOIN users u ON f.userId = u.userId WHERE f.friendId = ? AND f.status = 'pending'",
  ).all(userId);
  res.json(requests);
});
