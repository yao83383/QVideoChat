import { Router, Request, Response } from "express";
import { getUserByToken, getAllTags, getUserTags, setUserTags, getUserStats, getReferralStats } from "../db.js";

export const router = Router();

function auth(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const user = getUserByToken(h.slice(7));
  return user?.userId ?? null;
}

router.get("/tags", (_req: Request, res: Response) => {
  const tags = getAllTags();
  res.json(tags);
});

router.get("/tags/mine", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const tags = getUserTags(userId);
  res.json(tags);
});

router.put("/tags", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const { tags } = req.body;
  if (!Array.isArray(tags)) { res.status(400).json({ error: "tags 应为数组" }); return; }
  setUserTags(userId, tags);
  res.json({ ok: true });
});

router.get("/stats", (req: Request, res: Response) => {
  const uid = auth(req);
  if (!uid) { res.status(401).json({ error: "未认证" }); return; }
  const stats = getUserStats(uid);
  if (!stats) { res.status(404).json({ error: "用户不存在" }); return; }
  const { passwordHash, token, email, ...safe } = stats;
  res.json(safe);
});

router.get("/stats/:userId", (req: Request, res: Response) => {
  const stats = getUserStats(req.params.userId);
  if (!stats) { res.status(404).json({ error: "用户不存在" }); return; }
  const { passwordHash, token, email, ...safe } = stats;
  res.json(safe);
});

router.get("/referral", (req: Request, res: Response) => {
  const userId = auth(req);
  if (!userId) { res.status(401).json({ error: "未认证" }); return; }
  const stats = getReferralStats(userId);
  res.json(stats);
});
