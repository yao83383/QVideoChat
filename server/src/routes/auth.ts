import { Router, Request, Response } from "express";
import { createAnonymousUser, registerUser, createRegisteredUser, loginUser, loginByIdentifier, loginOrCreateByPhone, getUserByToken } from "../db.js";

export const router = Router();

// --- Phone OTP (mock, in-memory) ---
//
// Prod goal is aliyun/tencent SMS; for now we keep the OTP in a Map and, in
// dev mode, echo it back in the /otp/send response so the client can display
// it without needing to shell into the server. Rate limits are defensive:
// prevent someone smashing send to burn cash once we do wire real SMS.
interface OtpRecord { code: string; expiresAt: number; lastSentAt: number; sentCount: number; }
const otpStore = new Map<string, OtpRecord>();
const OTP_TTL_MS = 5 * 60 * 1000;       // 5 min validity
const OTP_MIN_SEND_INTERVAL_MS = 60 * 1000;  // 60s between sends per phone
const OTP_WINDOW_MS = 10 * 60 * 1000;   // rolling window
const OTP_MAX_PER_WINDOW = 5;           // max 5 sends / 10 min / phone
const isDev = process.env.NODE_ENV !== "production";
// Validates E.164-ish or Chinese mobile format (11 digits starting 1). Loose
// on purpose — the SMS gateway will reject malformed numbers before they cost
// us money.
function isValidPhone(p: unknown): p is string {
  return typeof p === "string" && /^1[3-9]\d{9}$/.test(p);
}

router.post("/otp/send", (req: Request, res: Response) => {
  const { phone } = req.body ?? {};
  if (!isValidPhone(phone)) {
    res.status(400).json({ error: "手机号格式不正确" });
    return;
  }
  const now = Date.now();
  const prev = otpStore.get(phone);
  if (prev) {
    if (now - prev.lastSentAt < OTP_MIN_SEND_INTERVAL_MS) {
      const wait = Math.ceil((OTP_MIN_SEND_INTERVAL_MS - (now - prev.lastSentAt)) / 1000);
      res.status(429).json({ error: `请 ${wait} 秒后再试` });
      return;
    }
    // Enforce rolling window cap by looking at sentCount within the window
    if (now - prev.lastSentAt < OTP_WINDOW_MS && prev.sentCount >= OTP_MAX_PER_WINDOW) {
      res.status(429).json({ error: "验证码请求过于频繁,请稍后再试" });
      return;
    }
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const rec: OtpRecord = {
    code,
    expiresAt: now + OTP_TTL_MS,
    lastSentAt: now,
    sentCount: (prev && now - prev.lastSentAt < OTP_WINDOW_MS ? prev.sentCount : 0) + 1,
  };
  otpStore.set(phone, rec);
  // TODO(prod): call aliyun/tencent SMS gateway here; return without devCode.
  console.log(`[otp] phone=${phone} code=${code} (mock — no SMS sent)`);
  const body: { ok: true; devCode?: string } = { ok: true };
  if (isDev) body.devCode = code;
  res.json(body);
});

router.post("/otp/verify", (req: Request, res: Response) => {
  const { phone, code, username, deviceId, invite } = req.body ?? {};
  if (!isValidPhone(phone)) {
    res.status(400).json({ error: "手机号格式不正确" });
    return;
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "验证码格式不正确" });
    return;
  }
  const rec = otpStore.get(phone);
  if (!rec) {
    res.status(400).json({ error: "请先发送验证码" });
    return;
  }
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(phone);
    res.status(400).json({ error: "验证码已过期,请重新发送" });
    return;
  }
  if (rec.code !== code) {
    res.status(400).json({ error: "验证码错误" });
    return;
  }
  // One-shot — consume so a leaked code can't be reused.
  otpStore.delete(phone);
  try {
    const result = loginOrCreateByPhone(
      phone,
      typeof username === "string" ? username : "",
      typeof deviceId === "string" ? deviceId : "",
      typeof invite === "string" ? invite : "",
    );
    res.json(result);
  } catch (e: any) {
    if (e?.message === "DEVICE_BANNED") {
      res.status(403).json({ error: "设备已被封禁" });
      return;
    }
    console.error("[otp/verify] failed:", e);
    res.status(500).json({ error: "登录失败" });
  }
});

router.post("/signup", (req: Request, res: Response) => {
  try {
    const { username, email, password, deviceId, invite } = req.body;
    if (!username || !username.trim() || !email || !password) {
      res.status(400).json({ error: "缺少昵称/邮箱/密码" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "密码至少6位" });
      return;
    }
    const result = createRegisteredUser(username.trim(), email, password, deviceId || "", invite || "");
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

// Universal login — identifier is email / phone / displayId, server picks
// whichever column matches. Preferred over /login going forward because the
// client doesn't have to guess what the user typed.
router.post("/login-identifier", (req: Request, res: Response) => {
  const { identifier, password } = req.body ?? {};
  if (typeof identifier !== "string" || !identifier || typeof password !== "string" || !password) {
    res.status(400).json({ error: "缺少参数" });
    return;
  }
  const result = loginByIdentifier(identifier, password);
  if (!result) {
    res.status(401).json({ error: "账号或密码错误" });
    return;
  }
  res.json(result);
});

router.post("/anonymous", (req: Request, res: Response) => {
  const { username, deviceId, invite } = req.body;
  if (!username || !username.trim()) {
    res.status(400).json({ error: "昵称不能为空" });
    return;
  }
  try {
    const result = createAnonymousUser(username.trim(), deviceId || "", invite || "");
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
