/** Invitation system helpers — displayId generation, HMAC signing, and the
 *  atomic "confirm this invitation" transaction that writes the ledger,
 *  assigns a displayId, and flips the user to confirmed. */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import { getDb, OFFICIAL_DISPLAY_ID, OFFICIAL_USER_ID } from "./db.js";

const HMAC_SECRET = process.env.INVITE_HMAC_SECRET || "qvideo-dev-secret-CHANGE-IN-PROD";

// --- displayId generators ---
//
// Two pools:
//   OFFICIAL bloodline · 100-prefix, length 4-10, digits ∈ {0-9}\{4}
//   Regular            · 11 digits, first '1', second '1-9' (avoid 100 prefix),
//                        remaining digits ∈ 0-9 unrestricted

const OFFICIAL_ALLOWED_DIGITS = "012356789"; // no 4
const OFFICIAL_MIN_LEN = 4;
const OFFICIAL_MAX_LEN = 10;

/** Generate an OFFICIAL bloodline displayId. Random length 4-10, prefix "100",
 *  digits after prefix avoid the character '4' (Chinese cultural taboo).
 *  Retries within a chosen length before escalating to longer codes.
 *  Throws if all lengths exhausted (~5M-code space so extremely unlikely). */
export function generateOfficialDisplayId(): string {
  const d = getDb();
  const stmt = d.prepare("SELECT 1 FROM users WHERE displayId=?");

  // Try each length starting from a random length. If that length exhausted
  // via collisions, walk up to longer codes (more available space).
  const startLen = OFFICIAL_MIN_LEN + Math.floor(Math.random() * (OFFICIAL_MAX_LEN - OFFICIAL_MIN_LEN + 1));

  for (let bump = 0; bump < OFFICIAL_MAX_LEN - OFFICIAL_MIN_LEN + 1; bump++) {
    const len = OFFICIAL_MIN_LEN + ((startLen - OFFICIAL_MIN_LEN + bump) % (OFFICIAL_MAX_LEN - OFFICIAL_MIN_LEN + 1));
    const suffixLen = len - 3; // "100" prefix

    for (let attempt = 0; attempt < 8; attempt++) {
      let suffix = "";
      for (let i = 0; i < suffixLen; i++) {
        suffix += OFFICIAL_ALLOWED_DIGITS[Math.floor(Math.random() * OFFICIAL_ALLOWED_DIGITS.length)];
      }
      const candidate = "100" + suffix;
      if (candidate === OFFICIAL_DISPLAY_ID) continue; // never dispense the root
      if (!stmt.get(candidate)) return candidate;
    }
  }
  throw new Error("OFFICIAL pool exhausted");
}

/** Generate a Regular 11-digit displayId. First digit '1' (per current
 *  scheme reserving '2-9' for future root systems), second digit '1-9' to
 *  visually distinguish from OFFICIAL "100-" bloodline. */
export function generateRegularDisplayId(): string {
  const d = getDb();
  const stmt = d.prepare("SELECT 1 FROM users WHERE displayId=?");

  for (let attempt = 0; attempt < 20; attempt++) {
    const second = 1 + Math.floor(Math.random() * 9);       // 1-9
    let rest = "";
    for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10);
    const candidate = "1" + second + rest;
    if (!stmt.get(candidate)) return candidate;
  }
  throw new Error("Regular pool collision after 20 attempts — extremely unlikely");
}

// --- HMAC signing ---
//
// One row in `invitation_records` per confirmation. Payload includes the
// core identity of the record so re-hashing detects tampering. Secret is
// only known to the server.

export interface InvitationRecordPayload {
  displayId: string;
  parentDisplayId: string;
  issuedAt: number;
  method: "manual" | "in-room" | "official";
}

export function signInvitationRecord(p: InvitationRecordPayload): string {
  const msg = `${p.displayId}|${p.parentDisplayId}|${p.issuedAt}|${p.method}`;
  return crypto.createHmac("sha256", HMAC_SECRET).update(msg).digest("hex");
}

export function verifyInvitationRecord(p: InvitationRecordPayload, signature: string): boolean {
  const expected = signInvitationRecord(p);
  // Timing-safe compare so a leaked audit tool can't probe secrets via
  // response timing. Overkill for MVP but cheap.
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch { return false; }
}

// --- Atomic confirmation ---
//
// Called by the API layer when an inviter approves a pending invitation, or
// by the OFFICIAL path when a cold-start guest auto-confirms via displayId
// "100". Wraps the four writes (assign displayId, flip user status, write
// audit record, close pending row) in one transaction so partial failure
// can't leave the DB in an inconsistent state.

export interface ConfirmResult {
  displayId: string;
  method: "manual" | "in-room" | "official";
  parentDisplayId: string;
}

export function confirmInvitation(
  guestUserId: string,
  parentUserId: string,
  method: "manual" | "in-room" | "official",
  roomId: string | null = null,
): ConfirmResult {
  const d = getDb();
  const parent = d.prepare("SELECT displayId FROM users WHERE userId=?").get(parentUserId) as any;
  if (!parent?.displayId) {
    throw new Error("Parent must be confirmed before confirming children");
  }

  // OFFICIAL vs Regular pool decided by parent identity.
  const displayId = parentUserId === OFFICIAL_USER_ID
    ? generateOfficialDisplayId()
    : generateRegularDisplayId();

  const now = Date.now();
  const signature = signInvitationRecord({
    displayId,
    parentDisplayId: parent.displayId,
    issuedAt: now,
    method,
  });

  const tx = d.transaction(() => {
    // 1. Assign displayId + flip confirmed.
    d.prepare(
      "UPDATE users SET displayId=?, invitedBy=?, isConfirmed=1, confirmedAt=?, isRegistered=1 WHERE userId=?",
    ).run(displayId, parentUserId, now, guestUserId);
    // 2. Write immutable audit ledger row.
    d.prepare(
      "INSERT INTO invitation_records (displayId, parentDisplayId, parentUserId, method, roomId, issuedAt, signature) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(displayId, parent.displayId, parentUserId, method, roomId, now, signature);
    // 3. Close any pending invitation row for this guest.
    d.prepare(
      "UPDATE invitations SET status='confirmed' WHERE guestUserId=? AND status='pending'",
    ).run(guestUserId);
  });
  tx();

  return { displayId, method, parentDisplayId: parent.displayId };
}

/** Lazy-expire pending invitations older than their expiresAt. Cheap enough
 *  to call on every read of a guest's own pending state — no cron needed. */
export function expireOldInvitations(): void {
  const d = getDb();
  d.prepare(
    "UPDATE invitations SET status='expired' WHERE status='pending' AND expiresAt < ?",
  ).run(Date.now());
}

/** One-time migration for accounts created before the invitation system. Any
 *  already-registered user without a displayId is promoted to confirmed and
 *  handed an OFFICIAL bloodline id as an early-adopter bonus. Idempotent —
 *  runs safely on every server start; users already migrated are skipped. */
export function migrateLegacyUsersToConfirmed(): number {
  const d = getDb();
  const rows = d.prepare(
    "SELECT userId FROM users WHERE isRegistered=1 AND (isConfirmed=0 OR isConfirmed IS NULL) AND userId != ?",
  ).all(OFFICIAL_USER_ID) as { userId: string }[];

  let migrated = 0;
  for (const row of rows) {
    try {
      confirmInvitation(row.userId, OFFICIAL_USER_ID, "official", null);
      migrated++;
    } catch (e) {
      console.warn(`[migrate] failed for ${row.userId}:`, e);
    }
  }
  if (migrated > 0) {
    console.log(`[migrate] promoted ${migrated} legacy users to confirmed + OFFICIAL bloodline`);
  }
  return migrated;
}
