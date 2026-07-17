"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Persistent guest identity — a friendly default name for users who haven't
 * signed up yet. Follows the OC-platform brand voice (see
 * memory:oc-platform-vision): every anonymous user is a nascent
 * "未知'原创'角色" rather than a generic "guest N", planting the
 * Original-Character framing from the very first paint.
 *
 * Storage key: `qv_guest_name` (localStorage). Written on first ever mount
 * and never regenerated on its own — the only way to get a new one is via
 * `regenerate()`, which the settings/profile modal can wire to a button.
 *
 * Registered users don't need this at all; call sites should prefer the
 * real username from useUser() when available and fall through here only
 * when unauthenticated.
 */

const STORAGE_KEY = "qv_guest_name";
const PREFIX = "未知'原创'角色";

function pickSuffix(): string {
  // 4-digit padded so widths stay stable across renders.
  const n = Math.floor(Math.random() * 9000) + 1000;
  return String(n);
}

function makeGuestName(): string {
  return `${PREFIX}${pickSuffix()}`;
}

export function useGuestName(): {
  guestName: string;
  regenerate: () => string;
} {
  // Start empty on SSR / first client render so the HTML is deterministic
  // (`Math.random()` at module scope would cause hydration mismatch). The
  // useEffect below fills in the real value on the first client tick — a
  // sub-16ms gap before the chip has its label populated, which reads as
  // "just mounted" not "broken".
  const [guestName, setGuestName] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing && existing.length > 0) {
        setGuestName(existing);
        return;
      }
      const fresh = makeGuestName();
      localStorage.setItem(STORAGE_KEY, fresh);
      setGuestName(fresh);
    } catch {
      // localStorage disabled (private mode, etc.). Still give the caller
      // something to render — accept losing it on refresh.
      setGuestName(makeGuestName());
    }
  }, []);

  const regenerate = useCallback((): string => {
    const fresh = makeGuestName();
    try {
      localStorage.setItem(STORAGE_KEY, fresh);
    } catch { /* ignore */ }
    setGuestName(fresh);
    return fresh;
  }, []);

  return { guestName, regenerate };
}
