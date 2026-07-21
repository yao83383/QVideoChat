"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import * as api from "@/lib/api";

export interface UserState {
  userId: string;
  username: string;
  isRegistered: boolean;
  token: string | null;
}

/** Broadcast an auth transition to the rest of the app (chiefly
 *  SocketProvider, which needs to reopen the socket against the new
 *  token so presence:hello fires against the new userId). Storage events
 *  don't fire on the tab that wrote to localStorage — this event covers
 *  that same-tab path. */
function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event("qv:auth-changed"));
  } catch {
    /* ignore */
  }
}

export function useUser() {
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const saved = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    if (saved && token) {
      try {
        const parsed = JSON.parse(saved);
        setUser({ ...parsed, token });
        // Verify token is still valid
        api.getMe().then((me) => {
          setUser({
            userId: me.userId,
            username: me.username,
            isRegistered: me.isRegistered === 1,
            token,
          });
          localStorage.setItem("user", JSON.stringify({
            userId: me.userId,
            username: me.username,
            isRegistered: me.isRegistered === 1,
          }));
        }).catch(() => {
          localStorage.removeItem("user");
          localStorage.removeItem("token");
          setUser(null);
        });
      } catch {
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  const createUser = useCallback(async (username: string) => {
    try {
      const data = await api.createAnonymous(username);
      const u: UserState = {
        userId: data.userId,
        username,
        isRegistered: false,
        token: data.token,
      };
      setUser(u);
      notifyAuthChanged();
      return u;
    } catch {
      const userId = Math.random().toString(36).slice(2, 10);
      const u: UserState = { userId, username, isRegistered: false, token: null };
      setUser(u);
      return u;
    }
  }, []);

  const doLogin = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password);
    const u: UserState = {
      userId: data.userId,
      username: data.username,
      isRegistered: true,
      token: data.token,
    };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username: u.username, isRegistered: true }));
    setUser(u);
    notifyAuthChanged();
    // Bring cross-device prefs into localStorage — see syncPrefsAfterAuth.
    await syncPrefsAfterAuth(false).catch(() => { /* non-fatal */ });
    return u;
  }, []);

  /** Universal login accepting any of email / phone / displayId as the
   *  identifier. Preferred over doLogin for new UI paths. */
  const doLoginByIdentifier = useCallback(async (identifier: string, password: string) => {
    const data = await api.loginByIdentifier(identifier, password);
    const u: UserState = {
      userId: data.userId,
      username: data.username,
      isRegistered: true,
      token: data.token,
    };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username: u.username, isRegistered: true }));
    setUser(u);
    notifyAuthChanged();
    await syncPrefsAfterAuth(false).catch(() => { /* non-fatal */ });
    return u;
  }, []);

  /** Phone + OTP login/signup path. The server treats an unknown phone as a
   *  signup (returns `isNew=true`); an existing phone rotates the token and
   *  returns `isNew=false`. Prefs are then reconciled with the server: new
   *  signups push their local (guest-mode) prefs so nothing is lost, existing
   *  logins pull the server's authoritative values. */
  const doPhoneAuth = useCallback(async (phone: string, code: string, username = "", inviteCode = "") => {
    const data = await api.verifyOtp(phone, code, username, inviteCode);
    const u: UserState = {
      userId: data.userId,
      username: data.username,
      isRegistered: true,
      token: data.token,
    };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username: u.username, isRegistered: true }));
    setUser(u);
    notifyAuthChanged();
    await syncPrefsAfterAuth(data.isNew).catch(() => { /* non-fatal */ });
    return u;
  }, []);

  const doRegister = useCallback(async (userId: string, email: string, password: string) => {
    await api.register(userId, email, password);
    const u: UserState = { userId, username: user?.username || "", isRegistered: true, token: api.getToken() };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username: u.username, isRegistered: true }));
    setUser(u);
    notifyAuthChanged();
  }, [user]);

  const doSignup = useCallback(async (username: string, email: string, password: string, inviteCode = "") => {
    const data = await api.signup(username, email, password, inviteCode);
    const u: UserState = { userId: data.userId, username, isRegistered: true, token: data.token };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username, isRegistered: true }));
    setUser(u);
    notifyAuthChanged();
    await syncPrefsAfterAuth(true).catch(() => { /* non-fatal */ });
    return u;
  }, []);

  const doLogout = useCallback(() => {
    api.logout();
    localStorage.removeItem("user");
    setUser(null);
    notifyAuthChanged();
  }, []);

  return { user, loading, createUser, doLogin, doLoginByIdentifier, doRegister, doSignup, doPhoneAuth, doLogout };
}

/** Reconcile the four cross-device prefs (avatar, gender, sl/tl langs) with
 *  the server after the user just authenticated.
 *
 *  - `isNew=true` (fresh signup): PUSH local values so guest-mode setup isn't
 *    thrown away. If both local and server end up disagreeing later, the
 *    server wins on subsequent logins.
 *  - `isNew=false` (existing user logging in): PULL server values into
 *    localStorage — the authoritative copy — so a returning user on a new
 *    device gets their old avatar/gender/language pair back automatically. */
async function syncPrefsAfterAuth(isNew: boolean) {
  const readLocal = (key: string, fallback = ""): string => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch { return raw; }
    } catch { return fallback; }
  };

  if (isNew) {
    const localPrefs = {
      gender: readLocal("qv_gender"),
      avatarId: readLocal("qv_selected_vrm"),
      nativeLanguage: readLocal("qv_sl"),
      targetLanguage: readLocal("qv_tl"),
    };
    // Only include fields we actually have — server merges by-key.
    const payload: Partial<typeof localPrefs> = {};
    for (const [k, v] of Object.entries(localPrefs)) {
      if (v) (payload as any)[k] = v;
    }
    if (Object.keys(payload).length > 0) {
      await api.updateMyPrefs(payload);
    }
    return;
  }

  // Existing user login → pull authoritative prefs, overwrite localStorage.
  const server = await api.getMyPrefs();
  try {
    if (server.gender)          localStorage.setItem("qv_gender", server.gender);
    if (server.avatarId)        localStorage.setItem("qv_selected_vrm", server.avatarId);
    if (server.nativeLanguage)  localStorage.setItem("qv_sl", JSON.stringify(server.nativeLanguage));
    if (server.targetLanguage)  localStorage.setItem("qv_tl", JSON.stringify(server.targetLanguage));
  } catch { /* ignore */ }
}
