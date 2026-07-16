"use client";

import { useState, useEffect, useCallback } from "react";
import { getAvatar, bumpAvatarSelected, DEFAULT_AVATAR_ID, type AvatarEntry } from "@/lib/avatars";

const LS_KEY = "qv_selected_vrm";

/** Custom event so multiple `useSelectedAvatar` mounts stay in sync when one
 *  of them writes. Same-window `storage` events don't fire in the browser, so
 *  we roll our own bus. Prefixed to not collide with other libraries. */
const CHANGE_EVENT = "qv:avatar-changed";

/** Reads the user's chosen avatar id from localStorage and exposes it as
 *  React state. `selectedEntry` is safe to render even during SSR — it
 *  resolves to the DEFAULT_AVATAR_ID until the client-side effect populates
 *  the persisted value. */
export function useSelectedAvatar() {
  // Start with the default so SSR + first client paint agree. The real value
  // (if it differs) lands on the next tick.
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_AVATAR_ID);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setSelectedId(stored);
    } catch { /* ignore */ }

    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string") setSelectedId(id);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const setSelected = useCallback((id: string) => {
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
    bumpAvatarSelected(id);
    setSelectedId(id);
    // Broadcast so other mounted useSelectedAvatar instances update too.
    try {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id }));
    } catch { /* ignore */ }
  }, []);

  const selectedEntry: AvatarEntry = getAvatar(selectedId);

  return { selectedId, setSelected, selectedEntry };
}
