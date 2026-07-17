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
  applyIdleUpperBody,
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
  /** VRM asset path relative to /models (e.g. "unisex/DLco.vrm"). Changing
   *  this prop tears down and rebuilds the WebGL context, so pass a stable
   *  value — only flip it when the user commits to a new avatar. */
  vrmPath?: string;
  /** Optional external config source. When provided, VrmAvatar reads zoom/gain
   *  from this ref every frame and hides the on-screen controls. This is how
   *  the partner view respects settings the peer chose for their own avatar. */
  externalConfigRef?: React.MutableRefObject<AvatarConfig | null>;
  /** Fired whenever the local user changes zoom or gain via the controls.
   *  RoomClient forwards these values through the DataChannel so the peer's
   *  view of us matches what we picked. */
  onConfigChange?: (config: AvatarConfig) => void;
  /** Optional lightweight placeholder shown while the ~25MB VRM downloads.
   *  Fills the loading overlay with a big emoji + tint gradient so the first
   *  frame reads as "an avatar loading" instead of a black square + spinner. */
  placeholderEmoji?: string;
  placeholderTint?: string;
  /** Kill the rounded dark frame and all opaque loading overlays so the
   *  avatar floats on whatever's behind (desktop wallpaper in the pet
   *  window's case). Loading placeholder emoji still renders, just without
   *  its gradient card. */
  transparent?: boolean;
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
  vrmPath = "unisex/DLco.vrm",
  externalConfigRef,
  onConfigChange,
  placeholderEmoji,
  placeholderTint,
  transparent = false,
  className = "",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const fallbackRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  // Which of loading / ready / failed the current VRM asset is in. Feeds the
  // overlay under the canvas so users don't stare at a black square during
  // the ~5-20s download of a 15-33MB VRM file.
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "failed">("loading");
  // Byte-level download progress from the underlying fetch. Rendered as an
  // MB/percent readout + progress bar in the loading overlay so the hero
  // avatar reads as "downloading" rather than "frozen" on first visit.
  // total===0 means Content-Length was missing → fall back to a spinner-only
  // indeterminate state.
  const [loadProgress, setLoadProgress] = useState<{
    loaded: number;
    total: number;
    percent: number;
  }>({ loaded: 0, total: 0, percent: 0 });
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

    // Reset overlay to "loading" as soon as vrmPath changes — otherwise a
    // previously-loaded avatar's "ready" state would linger and users would
    // see a black canvas with no spinner while the new one downloads.
    setModelStatus("loading");
    setLoadProgress({ loaded: 0, total: 0, percent: 0 });

    const renderer = createRenderer(canvas, size);
    const scene = createScene();
    const camera = createCamera(size);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    loadVRM(
      `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/models/${vrmPath}`,
      (received, total) => {
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        setLoadProgress({ loaded: received, total, percent });
      },
    )
      .then((vrm) => {
        // Some VRMs are authored facing -Z (away from the camera at +Z);
        // spin the whole rig 180° so we see the face by default.
        vrm.scene.rotation.y = Math.PI;
        scene.add(vrm.scene);
        vrmRef.current = vrm;
        framingsRef.current = computeFramings(vrm.scene, vrm);
        setModelStatus("ready");
      })
      .catch((err) => {
        console.warn("[VrmAvatar] VRM load failed, using fallback:", err);
        const fallback = createFallbackModel();
        scene.add(fallback);
        fallbackRef.current = fallback;
        framingsRef.current = computeFramings(fallback);
        setModelStatus("failed");
      });

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const bs = blendshapeRef.current;
      const pose = poseRef?.current;
      const cam = cameraRef.current;
      const framings = framingsRef.current;

      if (vrmRef.current) {
        if (bs) {
          applyBlendshapes(vrmRef.current, bs.values, mirrorRef.current);
          if (bs.head) applyHeadRotation(vrmRef.current, bs.head, mirrorRef.current);
        }
        if (pose) applyUpperBody(vrmRef.current, pose, mirrorRef.current);
        // Idle runs whether or not the tracker has emitted a frame yet, so
        // the model is never seen in bare T-pose. It writes LAST because it
        // currently pure-assigns chest.rotation (see COMPOSE NOTE in
        // blendshapeMap). Safe today because pose tracking is disabled;
        // needs a rework if applyUpperBody is ever re-enabled.
        applyIdleUpperBody(vrmRef.current, performance.now());
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
      // Reset baseline so the next VRM starts with a fresh face-distance
      // calibration — otherwise switching avatars can leave the camera
      // at an odd dolly position relative to the new head Y.
      baseFaceDistRef.current = null;
      smoothedRatioRef.current = 1;
      // Dispose the currently-loaded VRM so we don't leak GPU buffers when
      // the user switches avatars. `renderer.dispose()` handles the WebGL
      // side; the geometry/material graph attached to `scene` needs its own
      // walk to release GPU memory attached to individual meshes.
      const vrm = vrmRef.current;
      if (vrm) {
        scene.remove(vrm.scene);
        vrm.scene.traverse((obj: any) => {
          if (obj.geometry) obj.geometry.dispose?.();
          if (obj.material) {
            (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m: any) => m.dispose?.());
          }
        });
        vrmRef.current = null;
      }
      const fb = fallbackRef.current;
      if (fb) {
        scene.remove(fb);
        fallbackRef.current = null;
      }
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [size, vrmPath]);

  const glowClass = isSpeaking ? "ring-2 ring-green-400/60" : "";

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div
        className={`relative overflow-hidden ${transparent ? "" : `rounded-2xl bg-neutral-950 ${glowClass}`}`}
        style={size > 0 ? { width: size, height: size } : { width: "100%", height: "100%" }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        {/* Loading overlay: canvas alone is transparent, so a slow VRM download
            leaves users staring at bg-neutral-950. Two shapes:
              1. Emoji placeholder (when placeholderEmoji is passed): big
                 emoji + tint gradient occupies the frame, small progress bar
                 tucks along the bottom. The hero on the home page uses this
                 so the first paint reads as "your character is loading" not
                 "black square".
              2. Plain spinner (fallback): the previous behaviour, used when
                 the caller doesn't know which entry is loading (partner view
                 in the room). */}
        {modelStatus === "loading" && placeholderEmoji && (
          <>
            <div className={`pointer-events-none absolute inset-0 flex items-center justify-center ${transparent ? "" : `bg-gradient-to-br ${placeholderTint || "from-sky-500/25 to-cyan-500/25"}`}`}>
              <span className="text-8xl opacity-70 select-none drop-shadow-lg" aria-hidden>{placeholderEmoji}</span>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-1.5 px-4">
              {loadProgress.total > 0 ? (
                <>
                  <div className="w-28 h-1 rounded-full bg-black/50 overflow-hidden shadow">
                    <div
                      className="h-full bg-gradient-to-r from-sky-300 to-cyan-300 transition-all duration-100"
                      style={{ width: `${loadProgress.percent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-white/90 font-medium tracking-wide drop-shadow">
                    {loadProgress.percent}% · {(loadProgress.loaded / 1_048_576).toFixed(1)} / {(loadProgress.total / 1_048_576).toFixed(0)} MB
                  </p>
                </>
              ) : (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
            </div>
          </>
        )}
        {modelStatus === "loading" && !placeholderEmoji && (
          <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-4 ${transparent ? "" : "bg-neutral-950/60 backdrop-blur-sm"}`}>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
            {loadProgress.total > 0 ? (
              <>
                <p className="text-[10px] text-neutral-200 font-medium">
                  加载化身中 {loadProgress.percent}%
                </p>
                <p className="text-[9px] text-neutral-500 -mt-1">
                  {(loadProgress.loaded / 1_048_576).toFixed(1)} / {(loadProgress.total / 1_048_576).toFixed(0)} MB
                </p>
                <div className="w-28 h-1 rounded-full bg-neutral-800/80 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-400 to-cyan-400 transition-all duration-100"
                    style={{ width: `${loadProgress.percent}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[10px] text-neutral-400">加载化身中…</p>
            )}
          </div>
        )}
        {modelStatus === "failed" && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-red-900/60 border border-red-700/60 px-2 py-1 text-center">
            <p className="text-[10px] text-red-300">化身加载失败,已切换为占位模型</p>
          </div>
        )}
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
            <div className="w-px h-4 bg-white/20 mx-0.5" />
            {/* Recalibrate the "neutral" face distance to whatever the camera
                sees right now. Handy when the first frame captured the user
                mid-lean, which anchors the dolly's baseline off and makes the
                avatar look permanently zoomed-in/out until they refresh. */}
            <button
              type="button"
              onClick={() => {
                baseFaceDistRef.current = null;
                smoothedRatioRef.current = 1;
              }}
              title="以当前脸距离为新基线"
              className="rounded bg-white/10 hover:bg-white/20 px-2 h-6 text-white text-[10px] font-medium"
            >
              重校准
            </button>
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
