import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { getDb, getUserByToken, OFFICIAL_USER_ID, OFFICIAL_DISPLAY_ID, isDeviceBanned } from "../db.js";
import { confirmInvitation, expireOldInvitations } from "../invite.js";

export const router = Router();

// --- Rate limiting (in-memory, per process) ---
//
// Two windows enforced:
//   1. Per-device applications: max 3 per 10 min
//   2. Per-target incoming applications: max 3 per 10 min
// The pending 1-of-1 rule (a guest can only have one active pending at a
// time) is enforced separately in `POST /apply` by looking up the DB.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

const deviceAttempts = new Map<string, number[]>();
const targetIncoming = new Map<string, number[]>();

function rateLimited(map: Map<string, number[]>, key: string): boolean {
  if (!key) return false;
  const now = Date.now();
  const list = (map.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) return true;
  list.push(now);
  map.set(key, list);
  return false;
}

// --- Password hashing (same scheme as auth.ts email/password) ---

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(pw, salt, 10000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

// --- Auth helper ---

function auth(req: Request): { userId: string; row: any } | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const user = getUserByToken(h.slice(7));
  return user ? { userId: user.userId, row: user } : null;
}

// --- Notification hook ---
//
// Wired from index.ts on server startup. Called whenever a new pending
// invitation lands so the socket + Web Push layers can wake the inviter.
// Kept as a plain setter so this router file has no direct socket.io
// dependency.

type Notifier = (targetUserId: string, event: string, payload: any) => void;
let notify: Notifier = () => { /* noop until wired */ };
export function setInvitationNotifier(fn: Notifier) { notify = fn; }

// --- POST /api/invite/apply ---

const INVITE_TTL_MS = 2 * 60 * 1000;

/** Non-OFFICIAL inviters must have a phone binding — otherwise their
 *  identity is unverified and the accountability chain breaks. OFFICIAL
 *  (displayId "100") is always exempt because it IS the identity anchor. */
function inviterEligible(row: { userId: string; isConfirmed: number; phone: string | null }): true | string {
  if (row.userId === OFFICIAL_USER_ID) return true;
  if (!row.isConfirmed) return "该 ID 未通过认证,不能作为邀请人";
  if (!row.phone) return "该 ID 未绑定手机号,不能作为邀请人";
  return true;
}

router.get("/check/:displayId", (req: Request, res: Response) => {
  const displayId = req.params.displayId;
  if (!/^\d{3,11}$/.test(displayId)) {
    res.status(400).json({ eligible: false, reason: "ID 格式不正确" });
    return;
  }
  const inviter = getDb().prepare(
    "SELECT userId, isConfirmed, phone, username FROM users WHERE displayId=?",
  ).get(displayId) as any;
  if (!inviter) {
    res.json({ eligible: false, reason: "该 ID 不存在" });
    return;
  }
  if (inviter.userId === OFFICIAL_USER_ID) {
    res.json({ eligible: true, isOfficial: true, username: inviter.username });
    return;
  }
  const check = inviterEligible(inviter);
  if (check !== true) {
    res.json({ eligible: false, reason: check });
    return;
  }
  res.json({ eligible: true, username: inviter.username });
});

router.post("/apply", (req: Request, res: Response) => {
  const { inviterDisplayId, email, phone, password, username, gender, deviceId } = req.body ?? {};

  if (typeof inviterDisplayId !== "string" || !/^\d{3,11}$/.test(inviterDisplayId)) {
    res.status(400).json({ error: "邀请人 ID 格式不正确" });
    return;
  }
  if (typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "密码至少 6 位" });
    return;
  }
  const hasEmail = typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const hasPhone = typeof phone === "string" && /^1[3-9]\d{9}$/.test(phone);
  // Contact info (email / phone) is entirely optional so young / overseas
  // users without either can still join. If either was provided though, it
  // must be well-formed — a typo would silently persist otherwise.
  if (typeof email === "string" && email && !hasEmail) {
    res.status(400).json({ error: "邮箱格式不正确" });
    return;
  }
  if (typeof phone === "string" && phone && !hasPhone) {
    res.status(400).json({ error: "手机号格式不正确" });
    return;
  }

  const d = getDb();

  // Check inviter exists + confirmed
  const inviter = d.prepare("SELECT userId, isConfirmed, phone FROM users WHERE displayId=?").get(inviterDisplayId) as any;
  if (!inviter) {
    res.status(404).json({ error: "邀请人不存在" });
    return;
  }
  // Same eligibility rule as the /check endpoint — server is the last line
  // of defense against clients bypassing the frontend button.
  const elig = inviterEligible(inviter);
  if (elig !== true) {
    res.status(400).json({ error: elig });
    return;
  }

  // Device ban + rate limits
  if (deviceId && isDeviceBanned(deviceId)) {
    res.status(403).json({ error: "设备已被封禁" });
    return;
  }
  if (rateLimited(deviceAttempts, deviceId || "")) {
    res.status(429).json({ error: "申请过于频繁,请 10 分钟后再试" });
    return;
  }
  if (rateLimited(targetIncoming, inviter.userId)) {
    res.status(429).json({ error: "该邀请人收到申请过多,请稍后再试或换一位" });
    return;
  }

  // Uniqueness: email/phone can't collide with existing users
  if (hasEmail) {
    const dup = d.prepare("SELECT userId FROM users WHERE email=?").get(email);
    if (dup) { res.status(409).json({ error: "邮箱已注册,请直接登录" }); return; }
  }
  if (hasPhone) {
    const dup = d.prepare("SELECT userId FROM users WHERE phone=?").get(phone);
    if (dup) { res.status(409).json({ error: "手机号已注册,请直接登录" }); return; }
  }

  // Create pending user (isRegistered=1 so they can log in with password
  // and see their own pending state, but isConfirmed=0 until inviter approves).
  const userId = crypto.randomUUID().slice(0, 12);
  const token = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password);
  const finalUsername = (typeof username === "string" && username.trim()) || `游客${userId.slice(0, 6)}`;
  // Gender is declared at signup; may be missing (older clients / edge case).
  // Post-registration changes require admin approval (not implemented yet).
  const finalGender = (gender === "female" || gender === "male" || gender === "private") ? gender : "";

  const now = Date.now();

  // OFFICIAL path — auto-approve, no pending row, immediate confirmInvitation.
  if (inviter.userId === OFFICIAL_USER_ID) {
    d.prepare(
      "INSERT INTO users (userId, username, isRegistered, email, phone, gender, passwordHash, token, deviceId, createdAt) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)",
    ).run(userId, finalUsername, email || null, phone || null, finalGender, passwordHash, token, deviceId || "", now);
    const result = confirmInvitation(userId, OFFICIAL_USER_ID, "official", null);
    res.json({ userId, token, displayId: result.displayId, autoConfirmed: true });
    return;
  }

  // Normal path — pending 2 min, wait for inviter approval.
  d.prepare(
    "INSERT INTO users (userId, username, isRegistered, email, phone, gender, passwordHash, token, deviceId, invitedBy, createdAt) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(userId, finalUsername, email || null, phone || null, finalGender, passwordHash, token, deviceId || "", inviter.userId, now);

  const expiresAt = now + INVITE_TTL_MS;
  d.prepare(
    "INSERT INTO invitations (guestUserId, targetUserId, method, createdAt, expiresAt) VALUES (?, ?, 'manual', ?, ?)",
  ).run(userId, inviter.userId, now, expiresAt);

  notify(inviter.userId, "invite:new", { guestUserId: userId, guestUsername: finalUsername, expiresAt });

  res.json({ userId, token, autoConfirmed: false, expiresAt });
});

// --- POST /api/invite/confirm/:guestUserId ---

router.post("/confirm/:guestUserId", (req: Request, res: Response) => {
  const me = auth(req);
  if (!me) { res.status(401).json({ error: "未认证" }); return; }
  if (!me.row.isConfirmed) { res.status(403).json({ error: "你需要先通过认证" }); return; }

  const guestUserId = req.params.guestUserId;
  expireOldInvitations();

  const inv = getDb().prepare(
    "SELECT * FROM invitations WHERE guestUserId=? AND targetUserId=? AND status='pending' ORDER BY createdAt DESC LIMIT 1",
  ).get(guestUserId, me.userId) as any;
  if (!inv) { res.status(404).json({ error: "未找到待处理的申请" }); return; }
  if (Date.now() > inv.expiresAt) { res.status(410).json({ error: "申请已超时" }); return; }

  try {
    const result = confirmInvitation(guestUserId, me.userId, "manual", null);
    notify(guestUserId, "invite:approved", { displayId: result.displayId, parentDisplayId: result.parentDisplayId });
    res.json({ ok: true, displayId: result.displayId });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "确认失败" });
  }
});

// --- POST /api/invite/reject/:guestUserId ---

router.post("/reject/:guestUserId", (req: Request, res: Response) => {
  const me = auth(req);
  if (!me) { res.status(401).json({ error: "未认证" }); return; }

  const guestUserId = req.params.guestUserId;
  const result = getDb().prepare(
    "UPDATE invitations SET status='rejected' WHERE guestUserId=? AND targetUserId=? AND status='pending'",
  ).run(guestUserId, me.userId);
  if (result.changes === 0) { res.status(404).json({ error: "未找到待处理的申请" }); return; }

  notify(guestUserId, "invite:rejected", {});
  res.json({ ok: true });
});

// --- POST /api/invite/in-room ---
//
// Path B: guest in-call asks partner (confirmed user) to invite. Server
// validates via a caller-supplied `partnersInRoom` check; wired from index.ts
// on startup so this router doesn't need to know about roomManager directly.

type RoomChecker = (roomId: string, userIdA: string, userIdB: string) => boolean;
let checkRoom: RoomChecker = () => false;
export function setRoomChecker(fn: RoomChecker) { checkRoom = fn; }

router.post("/in-room", (req: Request, res: Response) => {
  const me = auth(req);
  if (!me) { res.status(401).json({ error: "未认证" }); return; }
  if (!me.row.isConfirmed) { res.status(403).json({ error: "你需要先通过认证" }); return; }

  const { roomId, guestUserId } = req.body ?? {};
  if (typeof roomId !== "string" || typeof guestUserId !== "string") {
    res.status(400).json({ error: "缺少 roomId 或 guestUserId" });
    return;
  }

  if (!checkRoom(roomId, me.userId, guestUserId)) {
    res.status(403).json({ error: "roomId 校验失败,双方不在同一房间" });
    return;
  }

  const guest = getDb().prepare("SELECT userId, isConfirmed FROM users WHERE userId=?").get(guestUserId) as any;
  if (!guest) { res.status(404).json({ error: "游客账号不存在" }); return; }
  if (guest.isConfirmed) { res.status(400).json({ error: "对方已经是正式用户,无需邀请" }); return; }

  try {
    const result = confirmInvitation(guestUserId, me.userId, "in-room", roomId);
    notify(guestUserId, "invite:approved", { displayId: result.displayId, parentDisplayId: result.parentDisplayId });
    notify(me.userId, "invite:in-room-done", { guestUserId, displayId: result.displayId });
    res.json({ ok: true, displayId: result.displayId });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "邀请失败" });
  }
});

// --- GET /api/invite/pending ---

router.get("/pending", (req: Request, res: Response) => {
  const me = auth(req);
  if (!me) { res.status(401).json({ error: "未认证" }); return; }
  expireOldInvitations();

  const rows = getDb().prepare(`
    SELECT i.guestUserId, i.createdAt, i.expiresAt, i.method, u.username as guestUsername, u.email, u.phone
    FROM invitations i
    JOIN users u ON u.userId = i.guestUserId
    WHERE i.targetUserId = ? AND i.status = 'pending'
    ORDER BY i.createdAt DESC
  `).all(me.userId);
  res.json(rows);
});

// --- GET /api/invite/my-pending ---
//
// Guest polls this to see their own status. Returns the latest pending or
// terminal (confirmed / rejected / expired) row for this guest, whichever
// is more recent.

router.get("/my-pending", (req: Request, res: Response) => {
  const me = auth(req);
  if (!me) { res.status(401).json({ error: "未认证" }); return; }
  expireOldInvitations();

  const row = getDb().prepare(`
    SELECT i.*, u.username as targetUsername, u.displayId as targetDisplayId
    FROM invitations i
    JOIN users u ON u.userId = i.targetUserId
    WHERE i.guestUserId = ?
    ORDER BY i.createdAt DESC LIMIT 1
  `).get(me.userId) as any;

  if (!row) { res.json(null); return; }

  // Include our own current status so the client can render "confirmed with
  // this displayId" without a second /me round-trip.
  const meRow = getDb().prepare("SELECT displayId, isConfirmed FROM users WHERE userId=?").get(me.userId) as any;

  res.json({
    status: row.status,
    method: row.method,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    remainingMs: Math.max(0, row.expiresAt - Date.now()),
    targetUsername: row.targetUsername,
    targetDisplayId: row.targetDisplayId,
    myDisplayId: meRow?.displayId || null,
    myIsConfirmed: meRow?.isConfirmed === 1,
  });
});

// --- OFFICIAL_DISPLAY_ID accessor for client-side hints ---

router.get("/official", (_req: Request, res: Response) => {
  res.json({ displayId: OFFICIAL_DISPLAY_ID });
});
