"use client";

/**
 * Presence subscription + local publishing (Phase 1.4).
 *
 * ```ts
 * const presence = usePresence(friendIds, {
 *   isAfk,
 *   blendshapeRef, poseRef, configRef, vrmPathRef,
 * });
 * // presence.get(friendId)?.status  → "online" | "sleeping" | "busy" | "offline"
 * // presence.get(friendId)?.blendshapeRef.current → decoded frame (mutated per socket frame)
 * ```
 *
 * Responsibilities:
 *
 * 1. Subscribe / unsubscribe. When `friendIds` changes we send a diff to
 *    the server via `presence:sub` / `presence:unsub` — never the full set
 *    over and over — so a friend list of size N only takes one round of
 *    subs on mount.
 *
 * 2. State ingestion. The server emits five event kinds — `presence:snapshot`
 *    (initial dump on hello) and `presence:online/offline/sleeping/busy/idle`
 *    (deltas). Each maps to the four-state (`online/sleeping/busy/offline`)
 *    that the UI tile renders.
 *
 * 3. Frame ingestion. `presence:frame` payloads land at ~30 fps per friend
 *    and are decoded with `blendshapeCodec.decodeFrame`. The decoded frame
 *    is written to per-friend `MutableRefObject`s so downstream consumers
 *    (VrmAvatar, if we ever want to render friends' avatars in 3D) read
 *    fresh data without triggering a React rerender per frame. Only the
 *    vrmPath field, which changes rarely, goes through setState.
 *
 * 4. Local publishing (optional). When `self` is passed we run a
 *    `useFrameSender` that emits `presence:frame` to the server. Cadence
 *    drops from 30fps to 5fps once `isAfk` flips true, and the AFK
 *    transition also fires a one-shot `presence:sleeping` so friends see
 *    the tile change even if the last frame was already sitting in
 *    their local ref. When busy state changes upstream (matching /
 *    in-call), the server drops incoming frames — we don't gate here.
 *
 * State container:
 *   The hook returns a plain Map keyed by userId. Map identity changes
 *   whenever a status / vrmPath field flips (so consumers using
 *   useMemo(() => ..., [presence]) rerender). Refs inside each entry
 *   are stable across updates, so a component holding
 *   `entry.blendshapeRef` won't see it swapped mid-render.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { MutableRefObject } from "react";
import { useSocketConnection } from "@/contexts/SocketContext";
import { decodeFrame, type FramePayload } from "@/lib/blendshapeCodec";
import { useFrameSender } from "./useFrameSender";
import type { BlendshapeFrame, PoseFrame } from "./useFaceMesh";
import type { AvatarConfig } from "@/components/VrmAvatar";

export type PresenceStatus = "online" | "sleeping" | "busy" | "offline";

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  /** Wall-clock ms of the last presence:frame we received for this user.
   *  0 if we've never seen one — the tile can render the emoji-only
   *  fallback in that case. */
  lastFrameAt: number;
  /** Live blendshape/head data for this friend. Content is overwritten
   *  in place; the ref object identity itself never changes. */
  blendshapeRef: MutableRefObject<BlendshapeFrame | null>;
  poseRef: MutableRefObject<PoseFrame | null>;
  configRef: MutableRefObject<AvatarConfig | null>;
  /** Which VRM asset this friend is currently wearing. Sent every
   *  frame by the publisher, so a late subscriber picks it up on the
   *  next tick — but we only setState when the value actually changes
   *  to avoid pointless rerenders. */
  vrmPath: string | null;
}

export interface UsePresenceSelf {
  /** From useAfk(). When true the sender drops to 5fps (still-alive
   *  heartbeat) and a one-shot presence:sleeping is emitted. */
  isAfk: boolean;
  blendshapeRef: MutableRefObject<BlendshapeFrame | null>;
  poseRef?: MutableRefObject<PoseFrame | null>;
  configRef?: MutableRefObject<AvatarConfig | null>;
  vrmPathRef?: MutableRefObject<string | null>;
}

/** Server's presence:snapshot payload — sent once on connect(hello) so
 *  the initial FriendList render doesn't have to wait for per-event
 *  deltas. */
interface SnapshotPayload {
  friends?: Array<{ userId: string; state: "idle" | "sleeping" | "matching" | "in-call" | "offline" }>;
}

interface FrameEnvelope extends FramePayload {
  fromUserId: string;
}

function serverStateToStatus(state: string | undefined): PresenceStatus {
  switch (state) {
    case "idle": return "online";
    case "sleeping": return "sleeping";
    case "matching":
    case "in-call": return "busy";
    default: return "offline";
  }
}

const FPS_AWAKE_MS = 33;   // ~30fps — publisher cap when face is present
const FPS_SLEEPING_MS = 200; // 5fps heartbeat when AFK — enough for reconnect detection

export function usePresence(
  friendIds: string[],
  self?: UsePresenceSelf,
): Map<string, PresenceEntry> {
  const { socket, isConnected } = useSocketConnection();

  // Refs pool — one MutableRefObject-per-field per friend, kept stable
  // across renders even when the surrounding PresenceEntry is rebuilt
  // for a status/vrmPath change. When a friend leaves the list we
  // drop their refs so a re-add doesn't get a stale frame.
  interface RefBag {
    blendshapeRef: MutableRefObject<BlendshapeFrame | null>;
    poseRef: MutableRefObject<PoseFrame | null>;
    configRef: MutableRefObject<AvatarConfig | null>;
  }
  const refsPoolRef = useRef<Map<string, RefBag>>(new Map());
  const getOrCreateRefs = useCallback((userId: string): RefBag => {
    let bag = refsPoolRef.current.get(userId);
    if (!bag) {
      bag = {
        blendshapeRef: { current: null } as MutableRefObject<BlendshapeFrame | null>,
        poseRef: { current: null } as MutableRefObject<PoseFrame | null>,
        configRef: { current: null } as MutableRefObject<AvatarConfig | null>,
      };
      refsPoolRef.current.set(userId, bag);
    }
    return bag;
  }, []);

  // Entries are a Map — status/vrmPath edits produce a new Map so consumers
  // rerender; per-frame edits go into the entry's refs directly (no rerender).
  const [entries, setEntries] = useState<Map<string, PresenceEntry>>(() => new Map());
  // Mirror of `entries` so effect handlers (frame receiver in particular)
  // can read the latest state without listing entries as a dep — otherwise
  // socket.on/off churns every status change.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const upsertEntry = useCallback((userId: string, patch: Partial<PresenceEntry>) => {
    setEntries((prev) => {
      const existing = prev.get(userId);
      const refs = getOrCreateRefs(userId);
      const base: PresenceEntry = existing ?? {
        userId,
        status: "offline",
        lastFrameAt: 0,
        vrmPath: null,
        blendshapeRef: refs.blendshapeRef,
        poseRef: refs.poseRef,
        configRef: refs.configRef,
      };
      // Bail if nothing observable actually changed — avoids a rerender
      // cascade when the server sends duplicate state (e.g. sleeping
      // event fires but we were already sleeping).
      let dirty = !existing;
      const merged: PresenceEntry = { ...base };
      for (const [k, v] of Object.entries(patch) as Array<[keyof PresenceEntry, any]>) {
        if ((merged as any)[k] !== v) {
          (merged as any)[k] = v;
          dirty = true;
        }
      }
      if (!dirty) return prev;
      const out = new Map(prev);
      out.set(userId, merged);
      return out;
    });
  }, [getOrCreateRefs]);

  // ---------------------------------------------------------------------------
  // Subscribe / unsubscribe diff
  // ---------------------------------------------------------------------------
  const subscribedRef = useRef<Set<string>>(new Set());
  const friendIdsKey = useMemo(() => friendIds.slice().sort().join(","), [friendIds]);

  useEffect(() => {
    if (!socket || !isConnected) return;
    const desired = new Set(friendIds);
    const current = subscribedRef.current;

    const toSub: string[] = [];
    const toUnsub: string[] = [];
    for (const id of desired) if (!current.has(id)) toSub.push(id);
    for (const id of current) if (!desired.has(id)) toUnsub.push(id);

    if (toSub.length > 0) socket.emit("presence:sub", { userIds: toSub });
    if (toUnsub.length > 0) socket.emit("presence:unsub", { userIds: toUnsub });

    subscribedRef.current = desired;

    // Drop entries for friends removed from the list — otherwise stale
    // avatar data hangs around under an unused id forever.
    if (toUnsub.length > 0) {
      setEntries((prev) => {
        let mutated = false;
        const out = new Map(prev);
        for (const id of toUnsub) {
          if (out.delete(id)) mutated = true;
          refsPoolRef.current.delete(id);
        }
        return mutated ? out : prev;
      });
    }
    // Reconnect: subscribedRef survives across renders but the server
    // forgot our subs on disconnect. Force a full resub when isConnected
    // flips back to true. Handled by the isConnected dep below.
  }, [socket, isConnected, friendIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // On (re)connect, resend the full sub set. The subscribedRef bookkeeping
  // above only diffs against the local view, which is out of sync with the
  // server after a reconnect.
  useEffect(() => {
    if (!socket || !isConnected) return;
    if (friendIds.length === 0) return;
    socket.emit("presence:sub", { userIds: friendIds });
  }, [socket, isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onSnapshot = (payload: SnapshotPayload) => {
      if (!Array.isArray(payload?.friends)) return;
      for (const row of payload.friends) {
        upsertEntry(row.userId, { status: serverStateToStatus(row.state) });
      }
    };
    const onOnline = ({ userId }: { userId: string }) => {
      upsertEntry(userId, { status: "online" });
    };
    const onOffline = ({ userId }: { userId: string }) => {
      upsertEntry(userId, { status: "offline", vrmPath: null });
    };
    const onSleeping = ({ userId, sleeping }: { userId: string; sleeping: boolean }) => {
      upsertEntry(userId, { status: sleeping ? "sleeping" : "online" });
    };
    const onBusy = ({ userId }: { userId: string }) => {
      upsertEntry(userId, { status: "busy" });
    };
    const onIdle = ({ userId }: { userId: string }) => {
      upsertEntry(userId, { status: "online" });
    };
    const onFrame = (env: FrameEnvelope) => {
      const uid = env?.fromUserId;
      if (typeof uid !== "string") return;
      const decoded = decodeFrame(env);
      if (!decoded) return;
      const refs = getOrCreateRefs(uid);
      refs.blendshapeRef.current = decoded.blendshape;
      if (decoded.pose) refs.poseRef.current = decoded.pose;
      if (decoded.config) refs.configRef.current = decoded.config;

      // Read latest state via ref (not from closure) so this handler
      // doesn't need `entries` as a dep — attaching/detaching per frame
      // is what we're avoiding here.
      const existing = entriesRef.current.get(uid);
      const nextVrm = decoded.vrmPath ?? existing?.vrmPath ?? null;
      const statusChanged = !existing || existing.status !== "online";
      const vrmChanged = (existing?.vrmPath ?? null) !== nextVrm;
      if (statusChanged || vrmChanged) {
        upsertEntry(uid, {
          status: "online",
          vrmPath: nextVrm,
          lastFrameAt: Date.now(),
        });
      } else if (existing) {
        // Ref-only mutation — bumps freshness timestamp without a
        // rerender. Consumers reading lastFrameAt in a rAF loop will
        // still see fresh values.
        existing.lastFrameAt = Date.now();
      }
    };

    socket.on("presence:snapshot", onSnapshot);
    socket.on("presence:online", onOnline);
    socket.on("presence:offline", onOffline);
    socket.on("presence:sleeping", onSleeping);
    socket.on("presence:busy", onBusy);
    socket.on("presence:idle", onIdle);
    socket.on("presence:frame", onFrame);

    return () => {
      socket.off("presence:snapshot", onSnapshot);
      socket.off("presence:online", onOnline);
      socket.off("presence:offline", onOffline);
      socket.off("presence:sleeping", onSleeping);
      socket.off("presence:busy", onBusy);
      socket.off("presence:idle", onIdle);
      socket.off("presence:frame", onFrame);
    };
  }, [socket, upsertEntry, getOrCreateRefs]);

  // ---------------------------------------------------------------------------
  // Local publishing (self)
  // ---------------------------------------------------------------------------
  const sendFrame = useCallback((payload: FramePayload) => {
    socket?.emit("presence:frame", payload);
  }, [socket]);

  const publisherEnabled = !!self && !!socket && isConnected;
  const interval = self?.isAfk ? FPS_SLEEPING_MS : FPS_AWAKE_MS;

  // useFrameSender is a no-op when refs are undefined — but its type
  // requires a blendshapeRef. Use a permanent null ref stand-in so the
  // hook can be conditionally "off" without disabling it via key change.
  const nullBs = useRef<BlendshapeFrame | null>(null);
  const nullPose = useRef<PoseFrame | null>(null);
  const nullConfig = useRef<AvatarConfig | null>(null);
  const nullVrm = useRef<string | null>(null);

  useFrameSender(
    interval,
    sendFrame,
    {
      blendshapeRef: self?.blendshapeRef ?? nullBs,
      poseRef: self?.poseRef ?? nullPose,
      configRef: self?.configRef ?? nullConfig,
      vrmPathRef: self?.vrmPathRef ?? nullVrm,
    },
    publisherEnabled,
  );

  // AFK → tell the server. One-shot on flip; the server broadcasts to friends.
  const lastSleepingSentRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!socket || !isConnected || !self) return;
    if (lastSleepingSentRef.current === self.isAfk) return;
    socket.emit("presence:sleeping", { sleeping: self.isAfk });
    lastSleepingSentRef.current = self.isAfk;
  }, [socket, isConnected, self?.isAfk]); // eslint-disable-line react-hooks/exhaustive-deps

  return entries;
}
