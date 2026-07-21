"use client";

/**
 * Fixed-rate avatar frame publisher.
 *
 * Encapsulates the "read blendshape ref every N ms, encode, send" loop
 * that used to live inline in `usePeer.ts` for DataChannel broadcasts.
 * Same hook now serves presence (Phase 1) where the sink is a socket
 * emitter instead of a DataChannel.
 *
 * Contract:
 *   - Runs while `enabled` is true; setInterval starts/stops with it.
 *   - Timer interval is `intervalMs`. Changing it restarts the timer.
 *   - `send` is stored in a ref; passing a fresh closure each render
 *     does NOT restart the timer. This mirrors the ref pattern useSocket
 *     uses for its event handlers.
 *   - `refs` are React MutableRefObjects — they're read at each tick,
 *     never listed as effect deps.
 *   - When `blendshapeRef.current` is null (face lost, tracker warming
 *     up), the tick emits nothing. No throwing, no placeholder frames.
 */

import { useEffect, useRef } from "react";
import type { BlendshapeFrame, PoseFrame } from "./useFaceMesh";
import type { AvatarConfig } from "@/components/VrmAvatar";
import { encodeFrame, type FramePayload } from "@/lib/blendshapeCodec";

interface FrameRefs {
  blendshapeRef: React.MutableRefObject<BlendshapeFrame | null>;
  poseRef?: React.MutableRefObject<PoseFrame | null>;
  configRef?: React.MutableRefObject<AvatarConfig | null>;
  vrmPathRef?: React.MutableRefObject<string | null>;
}

export function useFrameSender(
  intervalMs: number,
  send: (payload: FramePayload) => void,
  refs: FrameRefs,
  enabled: boolean = true,
): void {
  // Mirror send + refs so callers can freely pass fresh closures each
  // render without restarting the timer. Only intervalMs / enabled are
  // deps that legitimately want a restart.
  const sendRef = useRef(send);
  sendRef.current = send;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const { blendshapeRef, poseRef, configRef, vrmPathRef } = refsRef.current;
      const bs = blendshapeRef.current;
      if (!bs) return;
      const payload = encodeFrame({
        blendshape: bs,
        pose: poseRef?.current ?? null,
        config: configRef?.current ?? null,
        vrmPath: vrmPathRef?.current ?? null,
      });
      try {
        sendRef.current(payload);
      } catch {
        // Sink errors (DataChannel closed mid-send, socket disconnected)
        // are the caller's problem — we just don't crash the timer.
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
}
