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
  const { targetUserId, roomId, reason, transcript } = req.body;
  if (!targetUserId || !roomId) {
    res.status(400).json({ error: "缺少参数" });
    return;
  }
  // transcript: 客户端已经用 JSON.stringify 打包成字符串,server 直接
  // 落库不再解析 —— 审核界面拿字符串反序列化即可.兜底上限 200KB
  // 防止有人用超长文本撑数据库.
  let transcriptStr = "";
  if (typeof transcript === "string") {
    transcriptStr = transcript.length > 200_000 ? transcript.slice(0, 200_000) : transcript;
  }
  createReport(userId, targetUserId, roomId, reason || "", transcriptStr);
  res.json({ ok: true });
});
