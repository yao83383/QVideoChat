"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import type { BlendshapeFrame, PoseFrame } from "@/hooks/useFaceMesh";

/** Camera/dolly config that the user tunes for their own avatar. Sent over
 *  DataChannel so the peer's rendering of us mirrors our chosen framing —
 *  we control how we appear to others, not the other way around. */
export interface AvatarConfig {
  zoom: number;
  gain: number;
}
import {
  createRenderer,
  createScene,
  createCamera,
  loadVRM,
  applyBlendshapes,
  applyHeadRotation,
  applyUpperBody,
  createFallbackModel,
  applyBlendshapesToFallback,
  computeFramings,
  type FramingTargets,
} from "@/lib/blendshapeMap";

interface Props {
  blendshapeRef: React.MutableRefObject<BlendshapeFrame | null>;
  poseRef?: React.MutableRefObject<PoseFrame | null>;
  size?: number;
  label?: string;
  muted?: boolean;
  isSpeaking?: boolean;
  /** Mirror head rotation horizontally — set true for self-view. */
  mirror?: boolean;
  /** Optional external config source. When provided, VrmAvatar reads zoom/gain
   *  from this ref every frame and hides the on-screen controls. This is how
   *  the partner view respects settings the peer chose for their own avatar. */
  externalConfigRef?: React.MutableRefObject<AvatarConfig | null>;
  /** Fired whenever the local user changes zoom or gain via the controls.
   *  RoomClient forwards these values through the DataChannel so the peer's
   *  view of us matches what we picked. */
  onConfigChange?: (config: AvatarConfig) => void;
  className?: string;
}

export default function VrmAvatar({
  blendshapeRef,
  poseRef,
  size = 280,
  label,
  muted = false,
  isSpeaking = false,
  mirror = false,
  externalConfigRef,
  onConfigChange,
  className = "",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const fallbackRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  // Baseline face distance seen in the first valid frame — used as the
  // "neutral" position so the dolly reads user movement relative to it.
  const baseFaceDistRef = useRef<number | null>(null);
  const smoothedRatioRef = useRef<number>(1);
  // User-controlled zoom that stacks on top of the automatic distance dolly —
  // acts as a manual shift of the "neutral" size. Kept as both state (so the
  // buttons re-render on click) and a ref (so the animation loop can read the
  // latest value without React re-triggering the WebGL setup effect).
  const [userZoom, setUserZoom] = useState(1);
  const userZoomRef = useRef(1);
  userZoomRef.current = userZoom;
  const ZOOM_STEP = 1.15;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const handleZoomIn = useCallback(() => {
    setUserZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP));
  }, []);
  const handleZoomOut = useCallback(() => {
    setUserZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP));
  }, []);
  const handleZoomReset = useCallback(() => setUserZoom(1), []);

  // Dolly gain (near-big/far-small sensitivity) — tunable at runtime via the
  // debug panel below. Persisted to localStorage so a value that feels good
  // survives page reloads. Ref-backed so the animation loop reads the latest
  // without React needing to re-run the WebGL setup effect.
  const [dollyGain, setDollyGain] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("qv_dolly_gain");
      const n = raw ? parseFloat(raw) : NaN;
      return Number.isFinite(n) && n >= 0.5 && n <= 6 ? n : 1.25;
    } catch { return 1.25; }
  });
  const dollyGainRef = useRef(dollyGain);
  dollyGainRef.current = dollyGain;
  const [showDollyDebug, setShowDollyDebug] = useState(false);
  const bumpDollyGain = useCallback((delta: number) => {
    setDollyGain((oldGain) => {
      const newGain = Math.max(0.5, Math.min(6, Math.round((oldGain + delta) * 100) / 100));
      // Re-baseline so the CURRENT camera position stays put across the gain
      // change. Without this, the amplifier applied to whatever offset the
      // user has right now (rarely exactly at neutral) would suddenly stretch
      // by the new multiplier — user sees the avatar jump size for free.
      // Solve for newBase such that:
      //   1 + (currDist/newBase - 1) * newGain  =  currentAmplified
      const bs = blendshapeRef.current;
      const currentDist = bs?.head?.dist;
      if (currentDist && currentDist > 0.05) {
        const currAmp = smoothedRatioRef.current;
        const denom = 1 + (currAmp - 1) / newGain;
        if (denom > 0.001) {
          baseFaceDistRef.current = currentDist / denom;
        }
      }
      try { localStorage.setItem("qv_dolly_gain", String(newGain)); } catch { /* ignore */ }
      return newGain;
    });
  }, [blendshapeRef]);

  // Notify parent whenever local config changes so it can broadcast to the
  // peer. Only meaningful on self-view (where the user actually operates the
  // buttons); on partner-view the callback is typically absent.
  useEffect(() => {
    onConfigChange?.({ zoom: userZoom, gain: dollyGain });
  }, [userZoom, dollyGain, onConfigChange]);

  // When rendering a peer, we don't want them to see our local controls or
  // to have their view shaped by our sliders — they shape their own view via
  // their own controls, and we honor whatever config they broadcast.
  const controlsEditable = !externalConfigRef;
  // Two framings precomputed from the model: head close-up and head+shoulders.
  // The camera eases between them based on whether pose is emitting.
  const framingsRef = useRef<FramingTargets | null>(null);
  // 0 = head-only framing, 1 = upper-body framing. Eased each frame.
  const framingBlendRef = useRef<number>(0);
  // Timestamp of most recent pose frame — used to detect pose loss so the
  // camera smoothly pulls back to head close-up rather than snapping.
  const lastPoseTsRef = useRef<number>(0);
  // Keep the current mirror flag reachable from the animate closure without
  // re-mounting the WebGL context (which would reload the ~25MB VRM).
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = createRenderer(canvas, size);
    const scene = createScene();
    const camera = createCamera(size);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    loadVRM(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/models/DLco.vrm`)
      .then((vrm) => {
        // Some VRMs are authored facing -Z (away from the camera at +Z);
        // spin the whole rig 180° so we see the face by default.
        vrm.scene.rotation.y = Math.PI;
        scene.add(vrm.scene);
        vrmRef.current = vrm;
        framingsRef.current = computeFramings(vrm.scene, vrm);
      })
      .catch((err) => {
        console.warn("[VrmAvatar] VRM load failed, using fallback:", err);
        const fallback = createFallbackModel();
        scene.add(fallback);
        fallbackRef.current = fallback;
        framingsRef.current = computeFramings(fallback);
      });

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const bs = blendshapeRef.current;
      const pose = poseRef?.current;
      const cam = cameraRef.current;
      const framings = framingsRef.current;

      if (vrmRef.current && bs) {
        applyBlendshapes(vrmRef.current, bs.values, mirrorRef.current);
        if (bs.head) applyHeadRotation(vrmRef.current, bs.head, mirrorRef.current);
        if (pose) applyUpperBody(vrmRef.current, pose, mirrorRef.current);
        vrmRef.current.update(0.016);
      } else if (fallbackRef.current && bs) {
        applyBlendshapesToFallback(fallbackRef.current, bs.values);
      }

      // Camera framing + dolly for perceived depth. Two overlapping effects:
      //   1. Framing blend: eases between head close-up (blend=0) and head +
      //      shoulders (blend=1) based on whether pose is being received.
      //   2. Distance dolly: scales the framing's base Z by face distance
      //      relative to the first observed distance, so leaning in/out
      //      changes the avatar's apparent size like a real webcam.
      if (cam && framings) {
        const now = performance.now();
        if (pose && pose.timestamp > lastPoseTsRef.current) {
          lastPoseTsRef.current = pose.timestamp;
        }
        // Consider pose "fresh" if we've seen a frame within the last 400 ms.
        const poseAlive = now - lastPoseTsRef.current < 400;
        const targetBlend = poseAlive ? 1 : 0;
        framingBlendRef.current = framingBlendRef.current + (targetBlend - framingBlendRef.current) * 0.04;
        const t = framingBlendRef.current;
        const baseY = framings.head.y + (framings.upperBody.y - framings.head.y) * t;
        const baseZ = framings.head.z + (framings.upperBody.z - framings.head.z) * t;

        let ratio = 1;
        if (bs?.head?.dist !== undefined) {
          if (baseFaceDistRef.current === null && bs.head.dist > 0.05) {
            baseFaceDistRef.current = bs.head.dist;
          }
          if (baseFaceDistRef.current) {
            // Amplify the raw dist ratio around 1.0 so a modest lean produces
            // a visible size change. Gain is user-tunable via debug panel and
            // saved to localStorage; typical range 1.0-2.5.
            const DOLLY_MIN = 0.35;
            const DOLLY_MAX = 2.5;
            const remoteCfg = externalConfigRef?.current;
            const effectiveGain = remoteCfg?.gain ?? dollyGainRef.current;
            const rawRatio = bs.head.dist / baseFaceDistRef.current;
            const amplified = 1 + (rawRatio - 1) * effectiveGain;
            const clamped = Math.max(DOLLY_MIN, Math.min(DOLLY_MAX, amplified));
            smoothedRatioRef.current = smoothedRatioRef.current + (clamped - smoothedRatioRef.current) * 0.2;
            ratio = smoothedRatioRef.current;
          }
        }

        const remoteCfg = externalConfigRef?.current;
        const effectiveZoom = remoteCfg?.zoom ?? userZoomRef.current;
        cam.position.set(0, baseY, baseZ * ratio / effectiveZoom);
        cam.lookAt(0, baseY, 0);
      }

      rendererRef.current!.render(sceneRef.current!, cam!);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [size]);

  const glowClass = isSpeaking ? "ring-2 ring-green-400/60" : "";

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div
        className={`relative overflow-hidden rounded-2xl bg-neutral-950 ${glowClass}`}
        style={size > 0 ? { width: size, height: size } : { width: "100%", height: "100%" }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        {muted && (
          <div className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
            MUTED
          </div>
        )}
        {/* Debug toggle — click 🔧 to reveal the dolly-gain tuner. Kept in
            the top-left so it doesn't overlap MUTED (top-right) or the zoom
            stack (bottom-right). Only rendered on the self-view; the peer's
            view of us is driven by our broadcast config, not their sliders. */}
        {controlsEditable && (
        <button
          type="button"
          onClick={() => setShowDollyDebug((v) => !v)}
          title="调节远近响应速度"
          className={`absolute left-2 top-2 h-6 w-6 rounded-md text-xs transition-opacity ${
            showDollyDebug
              ? "bg-yellow-500/70 text-black opacity-100"
              : "bg-black/50 text-white/60 opacity-60 hover:opacity-100"
          }`}
        >
          🔧
        </button>
        )}
        {controlsEditable && showDollyDebug && (
          <div className="absolute left-2 top-10 flex items-center gap-1 rounded-md bg-black/70 border border-white/20 px-2 py-1">
            <button
              type="button"
              onClick={() => bumpDollyGain(-0.25)}
              disabled={dollyGain <= 0.5 + 0.01}
              className="h-6 w-6 rounded bg-white/10 text-white text-sm font-bold hover:bg-white/20 disabled:opacity-30"
            >−</button>
            <span className="text-white text-[11px] font-mono w-10 text-center">{dollyGain.toFixed(2)}</span>
            <button
              type="button"
              onClick={() => bumpDollyGain(0.25)}
              disabled={dollyGain >= 6 - 0.01}
              className="h-6 w-6 rounded bg-white/10 text-white text-sm font-bold hover:bg-white/20 disabled:opacity-30"
            >+</button>
          </div>
        )}
        {/* Zoom controls. Reset stays PINNED at the top (disabled when at
            neutral) so the +/− buttons never shift positions — clicking − then
            − again always hits the same pixel, never accidentally reset. Only
            on self-view; the peer's rendering follows our broadcast config. */}
        {controlsEditable && (
        <div className="absolute bottom-2 right-2 flex flex-col gap-1 opacity-70 hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleZoomReset}
            disabled={Math.abs(userZoom - 1) < 0.01}
            title="重置缩放"
            className="h-7 w-7 rounded-md bg-black/60 border border-white/20 text-white text-[10px] hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ⟲
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={userZoom >= ZOOM_MAX - 0.01}
            title="放大"
            className="h-7 w-7 rounded-md bg-black/60 border border-white/20 text-white text-sm font-bold hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={userZoom <= ZOOM_MIN + 0.01}
            title="缩小"
            className="h-7 w-7 rounded-md bg-black/60 border border-white/20 text-white text-sm font-bold hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            −
          </button>
        </div>
        )}
      </div>
      {label && <span className="text-xs text-neutral-400">{label}</span>}
    </div>
  );
}
