"use client";

/**
 * Application-wide socket connection.
 *
 * Historically each page that needed a socket (`app/page.tsx`,
 * `app/room/RoomClient.tsx`, `app/audio-test/page.tsx`) called `useSocket()`
 * which internally did `io(SERVER_URL)` on mount and `disconnect()` on
 * unmount. That was fine for "match → talk → hang up" but it drops the
 * socket whenever the user navigates away from those pages — which makes
 * always-on presence impossible (a user sitting on `/profile` would go
 * offline to their friends the moment they left the home page).
 *
 * This provider owns the *only* socket in the app. It mounts once at the
 * root layout, opens the connection when a login token is available,
 * exposes `{ socket, isConnected }` via context, and closes only when the
 * whole app unmounts (or when the token is cleared, e.g. logout).
 *
 * `useSocket()` was rewritten to consume this context — it no longer
 * builds its own socket. The consumer API (match/signal event bags,
 * emit helpers) is unchanged so existing pages don't need code changes.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

/** Read the current auth token from localStorage. Returns empty string when
 *  no token — the socket still connects (server treats missing token as
 *  guest today; Phase 1.3 will start enforcing). */
function readToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}

/** Read the current logged-in userId from the `user` blob localStorage
 *  keeps in sync with useUser. Returns null if we don't have one — the
 *  presence:hello won't fire in that case, and the server treats the
 *  socket as guest until match:join comes along. */
function readUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.userId === "string" && parsed.userId ? parsed.userId : null;
  } catch {
    return null;
  }
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  // Socket lives in state (not just a ref) so consumers re-render the
  // moment it's created — a ref-only implementation would leave consumers
  // holding `null` until the next unrelated render.
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // Keep the token seen at last connect. If it changes (login/logout while
  // the app is open) we tear down and rebuild so the server sees the new
  // auth on handshake. Reading localStorage directly at connect time would
  // miss the "user just logged in in another tab" case; a storage listener
  // patches that.
  const tokenAtConnectRef = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    let current: Socket | null = null;

    const openSocket = () => {
      const token = readToken();
      tokenAtConnectRef.current = token;

      const s = io(SERVER_URL, {
        path: SOCKET_PATH,
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        auth: { token },
      });

      s.on("connect", () => {
        setIsConnected(true);
        // Announce ourselves to the presence layer (Phase 1.3). Server
        // uses this to broadcast presence:online to our friends and to
        // push a snapshot of their current states back on the same
        // socket. Re-emit on every connect (including reconnections) so
        // a transient network blip doesn't leave the server thinking
        // we're offline. If we don't have a userId yet (pre-login) we
        // just skip — the hello can re-fire after login via the storage
        // listener path.
        const uid = readUserId();
        if (uid) s.emit("presence:hello", { userId: uid });
      });
      s.on("disconnect", () => setIsConnected(false));

      current = s;
      setSocket(s);
    };

    openSocket();

    // React to login/logout: token changing means the socket needs to
    // hand up a fresh handshake, and — more importantly — presence:hello
    // needs to fire against the new userId. Two channels:
    //
    // - `storage` event: another tab logged in/out. Fires everywhere
    //   except the tab that made the change.
    // - `qv:auth-changed` custom event: fired by useUser on the same tab
    //   whenever setUser transitions state (login, signup, logout).
    //   Storage events don't fire on the source tab, so without this
    //   the tab that just logged in would keep talking to the server as
    //   a guest until the user manually reloaded.
    const reconnectIfTokenChanged = () => {
      const newToken = readToken();
      if (newToken === tokenAtConnectRef.current) return;
      if (current) current.disconnect();
      current = null;
      setSocket(null);
      setIsConnected(false);
      openSocket();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "token" && e.key !== "user") return;
      reconnectIfTokenChanged();
    };
    const onAuthChanged = () => reconnectIfTokenChanged();
    window.addEventListener("storage", onStorage);
    window.addEventListener("qv:auth-changed", onAuthChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("qv:auth-changed", onAuthChanged);
      if (current) current.disconnect();
      current = null;
      setSocket(null);
      setIsConnected(false);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

/** Consume the app-wide socket. Returns `{ socket: null, isConnected: false }`
 *  before the provider has opened its connection (first render, SSR). */
export function useSocketConnection(): SocketContextValue {
  return useContext(SocketContext);
}
