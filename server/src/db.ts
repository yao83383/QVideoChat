import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const DATA_DIR = path.join(import.meta.dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, "qvideochat.db");
let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables(db);
  }
  return db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId      TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      isRegistered INTEGER NOT NULL DEFAULT 0,
      email       TEXT UNIQUE,
      passwordHash TEXT,
      token       TEXT,
      deviceId    TEXT NOT NULL DEFAULT '',
      referredBy  TEXT NOT NULL DEFAULT '',
      avatarOutfit TEXT DEFAULT 'default',
      matchCount   INTEGER DEFAULT 0,
      totalDuration INTEGER DEFAULT 0,
      createdAt   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT UNIQUE NOT NULL,
      emoji    TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '通用'
    );

    CREATE TABLE IF NOT EXISTS user_tags (
      userId TEXT NOT NULL,
      tagName TEXT NOT NULL,
      PRIMARY KEY (userId, tagName),
      FOREIGN KEY (userId) REFERENCES users(userId)
    );

    CREATE TABLE IF NOT EXISTS friends (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    TEXT NOT NULL,
      friendId  TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(userId, friendId),
      FOREIGN KEY (userId) REFERENCES users(userId),
      FOREIGN KEY (friendId) REFERENCES users(userId)
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      roomId    TEXT UNIQUE NOT NULL,
      userA     TEXT NOT NULL,
      userB     TEXT NOT NULL,
      startedAt INTEGER NOT NULL,
      endedAt   INTEGER,
      FOREIGN KEY (userA) REFERENCES users(userId),
      FOREIGN KEY (userB) REFERENCES users(userId)
    );

    CREATE TABLE IF NOT EXISTS banned_devices (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId  TEXT UNIQUE NOT NULL,
      reason    TEXT DEFAULT '',
      createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fromUserId  TEXT NOT NULL,
      targetUserId TEXT NOT NULL,
      roomId      TEXT NOT NULL,
      reason      TEXT DEFAULT '',
      createdAt   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (fromUserId) REFERENCES users(userId),
      FOREIGN KEY (targetUserId) REFERENCES users(userId)
    );
  `);

  // Add deviceId column if missing (migration for existing DBs)
  try { db.exec("ALTER TABLE users ADD COLUMN deviceId TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN referredBy TEXT NOT NULL DEFAULT ''"); } catch {}

  seedTags(db);
}

function seedTags(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) as c FROM tags").get() as { c: number };
  if (count.c > 0) return;

  const tags = [
    { name: "深夜唠嗑", emoji: "🌙", category: "情感" },
    { name: "游戏搭子", emoji: "🎮", category: "兴趣" },
    { name: "冷知识", emoji: "🧊", category: "兴趣" },
    { name: "社恐互助", emoji: "🫂", category: "社交" },
    { name: "emo治愈", emoji: "💚", category: "情感" },
    { name: "音乐分享", emoji: "🎵", category: "兴趣" },
    { name: "电影推荐", emoji: "🎬", category: "兴趣" },
    { name: "摸鱼搭子", emoji: "🐟", category: "生活" },
    { name: "运动打卡", emoji: "🏃", category: "生活" },
    { name: "学习伴侣", emoji: "📚", category: "生活" },
    { name: "吐槽专区", emoji: "🗣️", category: "社交" },
    { name: "匿名心事", emoji: "🕯️", category: "情感" },
  ];

  const stmt = db.prepare("INSERT INTO tags (name, emoji, category) VALUES (?, ?, ?)");
  for (const t of tags) {
    stmt.run(t.name, t.emoji, t.category);
  }
}

// --- User helpers ---

export function createAnonymousUser(username: string, deviceId = "", referredBy = ""): { userId: string; token: string } {
  const d = getDb();
  if (deviceId && isDeviceBanned(deviceId)) {
    throw new Error("DEVICE_BANNED");
  }
  if (deviceId) {
    const existing = d.prepare(
      "SELECT userId FROM users WHERE deviceId=? AND isRegistered=0 LIMIT 1",
    ).get(deviceId) as any;
    if (existing) {
      const token = crypto.randomBytes(16).toString("hex");
      d.prepare("UPDATE users SET username=?, token=? WHERE userId=?").run(username, token, existing.userId);
      return { userId: existing.userId, token };
    }
  }
  const userId = crypto.randomUUID().slice(0, 12);
  const token = crypto.randomBytes(16).toString("hex");
  d.prepare("INSERT INTO users (userId, username, token, deviceId, referredBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(
    userId, username, token, deviceId, referredBy, Date.now(),
  );
  return { userId, token };
}

export function getUserByToken(token: string) {
  const d = getDb();
  return d.prepare("SELECT * FROM users WHERE token = ?").get(token) as any;
}

export function registerUser(userId: string, email: string, password: string): string {
  const d = getDb();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  const token = crypto.randomBytes(16).toString("hex");
  d.prepare(
    "UPDATE users SET email=?, passwordHash=?, token=?, isRegistered=1 WHERE userId=?",
  ).run(email, `${salt}:${hash}`, token, userId);
  return token;
}

export function createRegisteredUser(username: string, email: string, password: string, deviceId = "", referredBy = ""): { userId: string; token: string } {
  const d = getDb();
  if (deviceId && isDeviceBanned(deviceId)) {
    throw new Error("DEVICE_BANNED");
  }
  const existing = d.prepare("SELECT * FROM users WHERE email=? AND isRegistered=1").get(email) as any;
  if (existing) throw new Error("UNIQUE constraint failed: users.email");

  const userId = crypto.randomUUID().slice(0, 12);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  const token = crypto.randomBytes(16).toString("hex");

  d.prepare(
    "INSERT INTO users (userId, username, email, passwordHash, token, deviceId, referredBy, isRegistered, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
  ).run(userId, username, email, `${salt}:${hash}`, token, deviceId, referredBy, Date.now());

  return { userId, token };
}

export function loginUser(email: string, password: string) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM users WHERE email=? AND isRegistered=1").get(email) as any;
  if (!row) return null;
  const [salt, hash] = row.passwordHash.split(":");
  const check = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  if (check !== hash) return null;
  const token = crypto.randomBytes(16).toString("hex");
  d.prepare("UPDATE users SET token=? WHERE userId=?").run(token, row.userId);
  return { userId: row.userId, username: row.username, token };
}

// --- Tag helpers ---

export function getAllTags() {
  const d = getDb();
  return d.prepare("SELECT * FROM tags ORDER BY category, id").all();
}

export function getUserTags(userId: string): string[] {
  const d = getDb();
  const rows = d.prepare("SELECT tagName FROM user_tags WHERE userId=?").all(userId) as any[];
  return rows.map((r) => r.tagName);
}

export function setUserTags(userId: string, tags: string[]) {
  const d = getDb();
  const del = d.prepare("DELETE FROM user_tags WHERE userId=?");
  const ins = d.prepare("INSERT OR IGNORE INTO user_tags (userId, tagName) VALUES (?, ?)");
  del.run(userId);
  for (const t of tags) {
    ins.run(userId, t);
  }
}

// --- Friend helpers ---

export function sendFriendRequest(userId: string, friendId: string) {
  const d = getDb();
  const existing = d.prepare(
    "SELECT * FROM friends WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)",
  ).get(userId, friendId, friendId, userId) as any;
  if (existing) return existing.status;
  d.prepare("INSERT INTO friends (userId, friendId, status) VALUES (?, ?, 'pending')").run(userId, friendId);
  return "pending";
}

export function acceptFriendRequest(userId: string, friendId: string) {
  const d = getDb();
  d.prepare(
    "UPDATE friends SET status='accepted' WHERE userId=? AND friendId=? AND status='pending'",
  ).run(friendId, userId);
}

export function getFriends(userId: string) {
  const d = getDb();
  return d.prepare(`
    SELECT u.userId, u.username, u.avatarOutfit, f.createdAt as friendSince
    FROM friends f
    JOIN users u ON (f.friendId = u.userId AND f.userId = ?) OR (f.userId = u.userId AND f.friendId = ?)
    WHERE f.status = 'accepted'
  `).all(userId, userId) as any[];
}

// --- Match history helpers ---

export function createMatchRecord(roomId: string, userA: string, userB: string) {
  const d = getDb();
  d.prepare("INSERT OR IGNORE INTO match_history (roomId, userA, userB, startedAt) VALUES (?, ?, ?, ?)").run(
    roomId, userA, userB, Date.now(),
  );
}

export function endMatchRecord(roomId: string) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM match_history WHERE roomId=? AND endedAt IS NULL").get(roomId) as any;
  if (!row) return;
  const duration = Date.now() - row.startedAt;
  d.prepare("UPDATE match_history SET endedAt=? WHERE roomId=?").run(Date.now(), roomId);
  d.prepare("UPDATE users SET matchCount=matchCount+1, totalDuration=totalDuration+? WHERE userId IN (?, ?)").run(
    duration, row.userA, row.userB,
  );
}

export function getMatchHistory(userId: string) {
  const d = getDb();
  return d.prepare(`
    SELECT m.*, 
      CASE WHEN m.userA = ? THEN m.userB ELSE m.userA END as partnerId,
      CASE WHEN m.userA = ? THEN (SELECT username FROM users WHERE userId = m.userB) 
           ELSE (SELECT username FROM users WHERE userId = m.userA) END as partnerName
    FROM match_history m
    WHERE (m.userA = ? OR m.userB = ?) AND m.endedAt IS NOT NULL
    ORDER BY m.startedAt DESC
    LIMIT 50
  `).all(userId, userId, userId, userId) as any[];
}

export function getUserStats(userId: string) {
  const d = getDb();
  return d.prepare(
    "SELECT userId, username, avatarOutfit, matchCount, totalDuration, createdAt FROM users WHERE userId=?",
  ).get(userId) as any;
}

// --- Ban & Report ---

export function isDeviceBanned(deviceId: string): boolean {
  if (!deviceId) return false;
  const d = getDb();
  const row = d.prepare("SELECT id FROM banned_devices WHERE deviceId=?").get(deviceId);
  return !!row;
}

export function banDevice(deviceId: string, reason = "") {
  const d = getDb();
  if (!deviceId) return;
  d.prepare("INSERT OR IGNORE INTO banned_devices (deviceId, reason) VALUES (?, ?)").run(deviceId, reason);
}

export function unbanDevice(deviceId: string) {
  const d = getDb();
  d.prepare("DELETE FROM banned_devices WHERE deviceId=?").run(deviceId);
}

export function createReport(fromUserId: string, targetUserId: string, roomId: string, reason = "") {
  const d = getDb();
  d.prepare(
    "INSERT INTO reports (fromUserId, targetUserId, roomId, reason) VALUES (?, ?, ?, ?)",
  ).run(fromUserId, targetUserId, roomId, reason);
}

// Get all users by device (for banning all accounts on a device)
export function getUserIdsByDevice(deviceId: string): string[] {
  if (!deviceId) return [];
  const d = getDb();
  const rows = d.prepare("SELECT userId FROM users WHERE deviceId=?").all(deviceId) as any[];
  return rows.map((r: any) => r.userId);
}

// --- Referral ---

export function getReferralStats(userId: string) {
  const d = getDb();
  const referred = d.prepare("SELECT userId, username, createdAt FROM users WHERE referredBy=? AND isRegistered=1").all(userId) as any[];
  const referrer = d.prepare("SELECT userId, username FROM users WHERE userId=(SELECT referredBy FROM users WHERE userId=?)").get(userId) as any;
  return { referred, referrer: referrer || null };
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
