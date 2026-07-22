/**
 * SIGNALING API
 */

import { getDeviceId } from "./device";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";
const BASE = SERVER_URL + SOCKET_PATH.replace(/\/socket\.io$/, "");

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

function setToken(t: string) {
  localStorage.setItem("token", t);
}

function clearToken() {
  localStorage.removeItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

// Auth
export async function createAnonymous(username: string) {
  const data = await request<{ userId: string; token: string }>("/api/auth/anonymous", {
    method: "POST",
    body: JSON.stringify({ username, deviceId: getDeviceId() }),
  });
  setToken(data.token);
  return data;
}

export async function signup(username: string, email: string, password: string, inviteCode = "") {
  const data = await request<{ userId: string; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username, email, password, deviceId: getDeviceId(), invite: inviteCode }),
  });
  setToken(data.token);
  return data;
}

export async function register(userId: string, email: string, password: string) {
  const data = await request<{ token: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ userId, email, password }),
  });
  setToken(data.token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await request<{ userId: string; username: string; token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

/** Universal login by identifier — email / phone / displayId, server picks
 *  whichever column matches. New /login page uses only this. */
export async function loginByIdentifier(identifier: string, password: string) {
  const data = await request<{ userId: string; username: string; token: string }>("/api/auth/login-identifier", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  setToken(data.token);
  return data;
}

/** Ask the server to (mock-)send an OTP to `phone`. In dev the server echoes
 *  the generated code back as `devCode` so we can display it in the UI. */
export async function sendOtp(phone: string) {
  return request<{ ok: true; devCode?: string }>("/api/auth/otp/send", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

/** Verify the 6-digit OTP for `phone`. If the phone maps to an existing user
 *  we log them in; otherwise we create a new registered account. Either way
 *  we get back `{userId, username, token, isNew}` and store the token. */
export async function verifyOtp(phone: string, code: string, username = "", inviteCode = "") {
  const data = await request<{ userId: string; username: string; token: string; isNew: boolean }>("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code, username, deviceId: getDeviceId(), invite: inviteCode }),
  });
  setToken(data.token);
  return data;
}

/** Fetch the user's saved cross-device preferences. Only works when logged in. */
export async function getMyPrefs() {
  return request<{ gender: string; avatarId: string; nativeLanguage: string; targetLanguage: string }>("/api/users/me/prefs");
}

/** Push a subset of prefs to the server; omitted fields are left alone. */
export async function updateMyPrefs(prefs: Partial<{ gender: string; avatarId: string; nativeLanguage: string; targetLanguage: string }>) {
  return request<{ gender: string; avatarId: string; nativeLanguage: string; targetLanguage: string }>("/api/users/me/prefs", {
    method: "PATCH",
    body: JSON.stringify(prefs),
  });
}

// --- Invitation system (slice J) ---
//
// Guests apply with an inviter's displayId; inviter approves within 2 min.
// The "OFFICIAL" path (inviterDisplayId="100") auto-confirms — the response
// is the same shape but includes autoConfirmed=true and a displayId already.

export interface ApplyRequest {
  inviterDisplayId: string;
  email?: string;
  phone?: string;
  password: string;
  username?: string;
  gender?: "female" | "male" | "private";
}

export interface ApplyResponse {
  userId: string;
  token: string;
  autoConfirmed: boolean;
  displayId?: string;      // present only when autoConfirmed
  expiresAt?: number;      // present only when NOT autoConfirmed
}

export async function inviteApply(req: ApplyRequest): Promise<ApplyResponse> {
  const data = await request<ApplyResponse>("/api/invite/apply", {
    method: "POST",
    body: JSON.stringify({ ...req, deviceId: getDeviceId() }),
  });
  setToken(data.token);
  return data;
}

export interface MyPendingStatus {
  status: "pending" | "confirmed" | "rejected" | "expired";
  method: "manual" | "in-room" | "official";
  createdAt: number;
  expiresAt: number;
  remainingMs: number;
  targetUsername: string;
  targetDisplayId: string;
  myDisplayId: string | null;
  myIsConfirmed: boolean;
}

export async function inviteMyPending(): Promise<MyPendingStatus | null> {
  return request<MyPendingStatus | null>("/api/invite/my-pending");
}

export interface PendingInvitation {
  guestUserId: string;
  createdAt: number;
  expiresAt: number;
  method: "manual" | "in-room" | "official";
  guestUsername: string;
  email: string | null;
  phone: string | null;
}

export async function inviteListPending(): Promise<PendingInvitation[]> {
  return request<PendingInvitation[]>("/api/invite/pending");
}

export async function inviteConfirm(guestUserId: string) {
  return request<{ ok: true; displayId: string }>(`/api/invite/confirm/${guestUserId}`, {
    method: "POST",
  });
}

export async function inviteReject(guestUserId: string) {
  return request<{ ok: true }>(`/api/invite/reject/${guestUserId}`, {
    method: "POST",
  });
}

export async function inviteInRoom(roomId: string, guestUserId: string) {
  return request<{ ok: true; displayId: string }>("/api/invite/in-room", {
    method: "POST",
    body: JSON.stringify({ roomId, guestUserId }),
  });
}

export async function inviteOfficialId(): Promise<{ displayId: string }> {
  return request<{ displayId: string }>("/api/invite/official");
}

/** Pre-check an inviter's eligibility before the user submits an apply.
 *  Returns eligible/reason/isOfficial + a friendly username if the ID is
 *  valid — server enforces the same rule on /apply, so a bypass just gets
 *  rejected there too. */
export async function inviteCheck(displayId: string) {
  return request<{ eligible: boolean; reason?: string; isOfficial?: boolean; username?: string }>(
    `/api/invite/check/${displayId}`,
  );
}

export async function getMe() {
  return request<any>("/api/auth/me");
}

export function logout() {
  clearToken();
}

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

// Report
// transcript: JSON.stringify 的 TranscriptEntry[](5 min ASR 缓冲).
// 传空字符串 = 老客户端 / 举报时没缓冲的场景.
export async function reportUser(
  targetUserId: string,
  roomId: string,
  reason: string,
  transcript: string = "",
) {
  return request<{ ok: boolean }>("/api/reports/report", {
    method: "POST",
    body: JSON.stringify({ targetUserId, roomId, reason, transcript }),
  });
}

// Tags
export async function getAllTags() {
  return request<any[]>("/api/users/tags");
}

export async function getMyTags() {
  return request<string[]>("/api/users/tags/mine");
}

export async function setMyTags(tags: string[]) {
  return request<{ ok: boolean }>("/api/users/tags", {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
}

// Friends
export async function getFriends() {
  return request<any[]>("/api/friends");
}

export async function getPendingRequests() {
  return request<any[]>("/api/friends/pending");
}

export async function requestFriend(friendId: string) {
  return request<{ status: string }>("/api/friends/request", {
    method: "POST",
    body: JSON.stringify({ friendId }),
  });
}

export async function acceptFriend(friendId: string) {
  return request<{ ok: boolean }>("/api/friends/accept", {
    method: "POST",
    body: JSON.stringify({ friendId }),
  });
}

// History & Stats
export async function getMatchHistory() {
  return request<any[]>("/api/history");
}

export async function getUserStats() {
  return request<any>("/api/history/stats");
}

export async function getReferral() {
  return request<any>("/api/users/referral");
}

export { getToken };
