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

export async function signup(username: string, email: string, password: string) {
  const data = await request<{ userId: string; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username, email, password, deviceId: getDeviceId() }),
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
export async function reportUser(targetUserId: string, roomId: string, reason: string) {
  return request<{ ok: boolean }>("/api/reports/report", {
    method: "POST",
    body: JSON.stringify({ targetUserId, roomId, reason }),
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

export { getToken };
