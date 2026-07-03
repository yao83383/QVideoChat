import { Router, Request, Response } from "express";
import { createAnonymousUser, registerUser, createRegisteredUser, loginUser, getUserByToken } from "../db.js";

export const router = Router();

router.post("/signup", (req: Request, res: Response) => {
  try {
    const { username, email, password, deviceId } = req.body;
    if (!username || !username.trim() || !email || !password) {
      res.status(400).json({ error: "缺少昵称/邮箱/密码" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "密码至少6位" });
      return;
    }
    const result = createRegisteredUser(username.trim(), email, password, deviceId || "");
    res.json(result);
  } catch (e: any) {
    if (e?.message === "DEVICE_BANNED") {
      res.status(403).json({ error: "设备已被封禁" });
      return;
    }
    if (e?.message?.includes("UNIQUE")) {
      res.status(409).json({ error: "邮箱已注册" });
      return;
    }
    res.status(500).json({ error: "注册失败" });
  }
});

router.post("/register", (req: Request, res: Response) => {
  try {
    const { userId, email, password } = req.body;
    if (!userId || !email || !password) {
      res.status(400).json({ error: "缺少参数" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "密码至少6位" });
      return;
    }
    const token = registerUser(userId, email, password);
    res.json({ token });
  } catch (e: any) {
    if (e?.message?.includes("UNIQUE")) {
      res.status(409).json({ error: "邮箱已注册" });
      return;
    }
    res.status(500).json({ error: "注册失败" });
  }
});

router.post("/login", (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "缺少参数" });
    return;
  }
  const result = loginUser(email, password);
  if (!result) {
    res.status(401).json({ error: "邮箱或密码错误" });
    return;
  }
  res.json(result);
});

router.post("/anonymous", (req: Request, res: Response) => {
  const { username, deviceId } = req.body;
  if (!username || !username.trim()) {
    res.status(400).json({ error: "昵称不能为空" });
    return;
  }
  try {
    const result = createAnonymousUser(username.trim(), deviceId || "");
    res.json(result);
  } catch (e: any) {
    if (e?.message === "DEVICE_BANNED") {
      res.status(403).json({ error: "设备已被封禁" });
      return;
    }
    res.status(500).json({ error: "创建失败" });
  }
});

router.get("/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "未认证" });
    return;
  }
  const token = auth.slice(7);
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: "无效 token" });
    return;
  }
  const { passwordHash, token: _, ...safe } = user;
  res.json(safe);
});
