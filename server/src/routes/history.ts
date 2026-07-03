import { Router, Request, Response } from "express";
import { getUserByToken, getMatchHistory, getUserStats } from "../db.js";

export const router = Router();

function auth(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const user = getUserByToken(h.slice(7));
  return user?.userId ?? null;
}

router.get("/", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const history = getMatchHistory(userId);
  res.json(history);
});

router.get("/stats", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const stats = getUserStats(userId);
  if (!stats) { res.status(404).json({ error: "用户不存在" }); return; }
  const { passwordHash, token, email, ...safe } = stats;
  res.json(safe);
});
