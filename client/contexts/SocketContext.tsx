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

      s.on("connect", () => setIsConnected(true));
      s.on("disconnect", () => setIsConnected(false));

      current = s;
      setSocket(s);
    };

    openSocket();

    // React to login/logout in another tab: if token changes we drop the
    // current socket and reopen with the new token. Same-tab changes are
    // handled by the auth flow calling `location.reload()`, which restarts
    // the whole app so we don't need to observe those here.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "token") return;
      const newToken = readToken();
      if (newToken === tokenAtConnectRef.current) return;
      if (current) current.disconnect();
      current = null;
      setSocket(null);
      setIsConnected(false);
      openSocket();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
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
