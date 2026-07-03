"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import * as api from "@/lib/api";

export interface UserState {
  userId: string;
  username: string;
  isRegistered: boolean;
  token: string | null;
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
    return u;
  }, []);

  const doRegister = useCallback(async (userId: string, email: string, password: string) => {
    await api.register(userId, email, password);
    const u: UserState = { userId, username: user?.username || "", isRegistered: true, token: api.getToken() };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username: u.username, isRegistered: true }));
    setUser(u);
  }, [user]);

  const doSignup = useCallback(async (username: string, email: string, password: string) => {
    const data = await api.signup(username, email, password);
    const u: UserState = { userId: data.userId, username, isRegistered: true, token: data.token };
    localStorage.setItem("user", JSON.stringify({ userId: u.userId, username, isRegistered: true }));
    setUser(u);
    return u;
  }, []);

  const doLogout = useCallback(() => {
    api.logout();
    localStorage.removeItem("user");
    setUser(null);
  }, []);

  return { user, loading, createUser, doLogin, doRegister, doSignup, doLogout };
}
