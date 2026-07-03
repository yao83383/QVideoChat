import { Router, Request, Response } from "express";
import { getUserByToken, createReport } from "../db.js";

export const router = Router();

function auth(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const user = getUserByToken(h.slice(7));
  return user?.userId ?? null;
}

router.post("/report", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const { targetUserId, roomId, reason } = req.body;
  if (!targetUserId || !roomId) {
    res.status(400).json({ error: "缺少参数" });
    return;
  }
  createReport(userId, targetUserId, roomId, reason || "");
  res.json({ ok: true });
});
