/**
 * Compact wire format for streaming a user's avatar state (blendshape +
 * head pose + upper-body pose + zoom/gain + which VRM they're wearing).
 *
 * The schema was originally inlined in `hooks/usePeer.ts` where it
 * traveled over a WebRTC DataChannel between two matched peers. Presence
 * (Phase 1) needs the same schema to travel over the app socket instead,
 * so the encode/decode was hoisted here — both transports now share the
 * exact same payload shape and rounding rules, which means a client
 * doesn't have to care whether a frame came from its P2P partner or from
 * a friend's presence broadcast.
 *
 * Design constraints preserved from the original:
 *
 * - Blendshape values are dropped when < 0.001 (MediaPipe outputs a lot
 *   of near-zero jitter). Surviving values are quantized to 3 decimals.
 *   ~30 fps of these still fits comfortably in one MTU.
 *
 * - Head euler is quantized to 3 decimals (~0.06° resolution), plenty
 *   for face tracking. Trailing distance (meters) is appended only when
 *   present; decoders that see a 3-element array must not choke on the
 *   missing 4th.
 *
 * - vrmPath is sent EVERY frame (not only on change). A late-joining
 *   subscriber (or a client that dropped a packet) picks up the correct
 *   asset on the next frame instead of hanging on the default DLco.
 *
 * - Field naming is single-letter to shrink the JSON on the wire:
 *   `t/b/h/p/c/v` — timestamp/blendshape/head/pose/config/vrmPath.
 *   Older clients that don't understand new letters just ignore them.
 */

import type { BlendshapeFrame, PoseFrame } from "@/hooks/useFaceMesh";
import type { AvatarConfig } from "@/components/VrmAvatar";

/** Compact wire payload — one avatar frame, ~240 bytes typical. */
export interface FramePayload {
  t: number;
  b: Record<string, number>;
  h?: number[]; // [pitch, yaw, roll, dist?]
  p?: number[]; // [shoulderRoll, shoulderYaw]
  c?: [number, number]; // [zoom, gain]
  v?: string;   // vrmPath, e.g. "female/black.vrm"
}

/** Input to encodeFrame. `blendshape` is required (drives everything);
 *  the rest is optional / null-tolerant so callers can pass raw refs. */
export interface FrameState {
  blendshape: BlendshapeFrame;
  pose?: PoseFrame | null;
  config?: AvatarConfig | null;
  vrmPath?: string | null;
}

/** Output of decodeFrame. Head is folded into `blendshape.head` to match
 *  the shape callers already consume from useFaceMesh. */
export interface DecodedFrame {
  blendshape: BlendshapeFrame;
  pose?: PoseFrame;
  config?: AvatarConfig;
  vrmPath?: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function encodeFrame({ blendshape, pose, config, vrmPath }: FrameState): FramePayload {
  const filtered: Record<string, number> = {};
  for (const [key, val] of Object.entries(blendshape.values)) {
    if (val > 0.001) filtered[key] = Math.round(val * 1000) / 1000;
  }

  const payload: FramePayload = {
    t: blendshape.timestamp,
    b: filtered,
  };
  if (blendshape.head) {
    payload.h = [r3(blendshape.head.pitch), r3(blendshape.head.yaw), r3(blendshape.head.roll)];
    if (blendshape.head.dist !== undefined) payload.h.push(r3(blendshape.head.dist));
  }
  if (pose) {
    payload.p = [r3(pose.shoulderRoll), r3(pose.shoulderYaw)];
  }
  if (config) {
    payload.c = [r3(config.zoom), r3(config.gain)];
  }
  if (vrmPath) {
    payload.v = vrmPath;
  }
  return payload;
}

/** Returns null when payload is missing the required blendshape field
 *  (e.g. corrupt frame, older sender pushing a different message type
 *  down the same channel). Caller should skip null frames. */
export function decodeFrame(payload: FramePayload): DecodedFrame | null {
  if (!payload || !payload.b) return null;

  const decoded: DecodedFrame = {
    blendshape: { timestamp: payload.t, values: payload.b },
  };
  if (Array.isArray(payload.h) && payload.h.length >= 3) {
    decoded.blendshape.head = {
      pitch: payload.h[0],
      yaw: payload.h[1],
      roll: payload.h[2],
    };
    if (payload.h.length >= 4) decoded.blendshape.head.dist = payload.h[3];
  }
  if (Array.isArray(payload.p) && payload.p.length >= 2) {
    decoded.pose = {
      timestamp: payload.t,
      shoulderRoll: payload.p[0],
      shoulderYaw: payload.p[1],
    };
  }
  if (Array.isArray(payload.c) && payload.c.length >= 2) {
    decoded.config = { zoom: payload.c[0], gain: payload.c[1] };
  }
  if (typeof payload.v === "string" && payload.v.length > 0) {
    decoded.vrmPath = payload.v;
  }
  return decoded;
}
