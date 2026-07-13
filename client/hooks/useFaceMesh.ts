"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { FaceLandmarker, PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Matrix4, Euler } from "three";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * Feature flag for upper-body pose tracking. Turned OFF because MediaPipe
 * hallucinates shoulder positions when the shoulders aren't cleanly in frame
 * (typical for face-close-up webcam), producing spurious chest rotation that
 * looks like it's driven by head movement. All pose plumbing (types, DC
 * payload, VrmAvatar prop) is preserved so the feature can be re-enabled by
 * flipping this to true once we have a better upper-body signal — e.g. via
 * kalidokit, a stricter model, or a UX that requires the user to sit back.
 */
const ENABLE_POSE = false;

export interface HeadPose {
  pitch: number;
  yaw: number;
  roll: number;
  /** Distance from camera to face in meters, extracted from MediaPipe's
   *  facial transformation matrix translation vector. Absent when older
   *  peers send only Euler angles. */
  dist?: number;
}

export interface BlendshapeFrame {
  timestamp: number;
  values: Record<string, number>;
  head?: HeadPose;
}

/** Minimal upper-body pose. Route C — only shoulder-derived angles, no arm
 *  tracking. `shoulderRoll` is rotation around the front-back axis (tilt
 *  left/right); `shoulderYaw` is rotation around the vertical axis (twist).
 *  Both in radians. */
export interface PoseFrame {
  timestamp: number;
  shoulderRoll: number;
  shoulderYaw: number;
}

const tmpMat = new Matrix4();
const tmpEuler = new Euler();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 (${ms / 1000}s)`)), ms)),
  ]);
}

async function fetchWithProgress(
  url: string,
  onProgress: (pct: number, received: number, total: number) => void,
): Promise<Uint8Array> {
  const resp = await fetch(url, { cache: "default" });
  if (!resp.ok) throw new Error(`下载失败 ${resp.status} ${resp.statusText}`);
  const total = parseInt(resp.headers.get("content-length") || "0", 10);
  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    onProgress(100, buf.length, buf.length);
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastTick = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const now = Date.now();
    if (now - lastTick > 100) {
      lastTick = now;
      const pct = total ? Math.round((received / total) * 100) : 0;
      onProgress(pct, received, total);
    }
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  onProgress(100, received, total || received);
  return out;
}

export function useFaceMesh() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const blendshapeRef = useRef<BlendshapeFrame | null>(null);
  const poseRef = useRef<PoseFrame | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [faceFound, setFaceFound] = useState(false);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  // Pose runs at ~20fps regardless of face rate — skip N-1 frames between
  // pose calls so face keeps its 60fps and CPU doesn't get bogged down.
  const poseFrameSkipRef = useRef<number>(0);
  const lastPoseLogRef = useRef<number>(0);
  // Auto-zero calibration for shoulder angles: MediaPipe reports non-zero
  // shoulderRoll even for a straight-sitting user (camera not perfectly level,
  // natural asymmetry, etc.). Average the first N successful hits to establish
  // "neutral" and subtract from every reading afterwards. If the user was
  // slouched during calibration, refresh the page and sit straight for ~2 s.
  const biasRollRef = useRef<number>(0);
  const biasYawRef = useRef<number>(0);
  const biasCountRef = useRef<number>(0);

  const start = useCallback(async () => {
    try {
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("当前浏览器不支持摄像头 (需要 HTTPS 或 localhost)");
        return;
      }

      setStep("camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      streamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      video.muted = true;
      await video.play();
      await new Promise<void>((resolve) => {
        const check = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      videoRef.current = video;

      setStep("wasm");
      const vision = await withTimeout(
        FilesetResolver.forVisionTasks(`${BASE_PATH}/wasm`),
        30000,
        "wasm 加载",
      );

      setStep("model 下载 0%");
      const modelBuf = await withTimeout(
        fetchWithProgress(`${BASE_PATH}/models/face_landmarker.task`, (pct, recv, total) => {
          const kb = Math.round(recv / 1024);
          const totalKb = Math.round(total / 1024);
          setStep(total > 0 ? `model 下载 ${pct}% (${kb}/${totalKb}KB)` : `model 下载 ${kb}KB`);
        }),
        60000,
        "model 下载",
      );

      setStep("model 初始化");
      const landmarker = await withTimeout(
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetBuffer: modelBuf,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
        30000,
        "model 初始化",
      );

      landmarkerRef.current = landmarker;
      setIsLoaded(true);
      setIsCameraOn(true);
      setStep("tracking");
      setError(null);

      // Load pose landmarker in the background — face tracking must not wait.
      // Failures here are non-fatal: the avatar just won't have shoulder sway.
      if (ENABLE_POSE) (async () => {
        try {
          console.log("[pose] downloading model…");
          const poseBuf = await fetchWithProgress(
            `${BASE_PATH}/models/pose_landmarker_full.task`,
            () => {},
          );
          console.log(`[pose] downloaded ${poseBuf.length} bytes, initializing…`);
          const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetBuffer: poseBuf, delegate: "CPU" },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.3,
            minPosePresenceConfidence: 0.3,
            minTrackingConfidence: 0.3,
          });
          poseLandmarkerRef.current = poseLandmarker;
          console.log("[pose] ready — detector active");
        } catch (e) {
          console.warn("[pose] failed to load:", e);
        }
      })();

      const processFrame = () => {
        const lm = landmarkerRef.current;
        const v = videoRef.current;
        if (!lm || !v) return;
        if (v.videoWidth === 0 || v.videoHeight === 0) {
          animFrameRef.current = requestAnimationFrame(processFrame);
          return;
        }
        try {
          const now = performance.now();
          const result = lm.detectForVideo(v, now);
          if (result.faceBlendshapes?.length > 0) {
            setFaceFound(true);
            const values: Record<string, number> = {};
            for (const c of result.faceBlendshapes[0].categories) {
              values[c.categoryName] = c.score;
            }
            let head: HeadPose | undefined;
            const mats = result.facialTransformationMatrixes;
            if (mats && mats.length > 0) {
              // MediaPipe matrix is column-major, right-handed, Y-up in camera
              // space (canonical face at identity looks toward +Z). Extract YXZ
              // Euler — the natural head-rotation order.
              const m = mats[0].data;
              tmpMat.fromArray(m);
              tmpEuler.setFromRotationMatrix(tmpMat, "YXZ");
              // Translation is columns 12/13/14 in meters. Magnitude gives the
              // real-world camera-to-face distance, ~0.3-0.8 m for typical
              // laptop sitting posture.
              const tx = m[12];
              const ty = m[13];
              const tz = m[14];
              const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
              head = { pitch: tmpEuler.x, yaw: tmpEuler.y, roll: tmpEuler.z, dist };
            }
            blendshapeRef.current = { timestamp: now, values, head };
          } else if (result.faceLandmarks?.length > 0) {
            setFaceFound(true);
          } else {
            setFaceFound(false);
          }

          // Pose: run only every 3rd frame (~20fps at 60fps face) — the full
          // model is heavy and shoulder sway at 20fps is smooth enough.
          const poseLm = poseLandmarkerRef.current;
          if (poseLm) {
            poseFrameSkipRef.current = (poseFrameSkipRef.current + 1) % 3;
            if (poseFrameSkipRef.current === 0) {
              const pr = poseLm.detectForVideo(v, now);
              const worlds = pr.worldLandmarks?.[0];
              const image = pr.landmarks?.[0];
              // Aggressive hallucination filter. MediaPipe pose will happily
              // report shoulders even when they're completely out of frame,
              // and its guess is derived from the head — so a pure head tilt
              // ends up rotating fake shoulders opposite to the head, which
              // then rotates the chest bone. Detect this by requiring:
              //   - high visibility on both shoulders
              //   - both shoulders inside the image frame
              //   - shoulders well BELOW the nose in image space
              //   - shoulders spread horizontally with the nose BETWEEN them
              // Fail any one → no pose data emitted this frame.
              const nose = image?.[0];
              const Li = image?.[11];
              const Ri = image?.[12];
              const visL = (Li as any)?.visibility ?? 0;
              const visR = (Ri as any)?.visibility ?? 0;
              const nX = nose?.x ?? 0.5;
              const nY = nose?.y ?? 0.5;
              const lX = Li?.x ?? 0.5;
              const lY = Li?.y ?? 0.5;
              const rX = Ri?.x ?? 0.5;
              const rY = Ri?.y ?? 0.5;
              const shouldersConfident = visL > 0.75 && visR > 0.75;
              const shouldersInFrame =
                lX > 0.05 && lX < 0.95 && lY < 0.98 &&
                rX > 0.05 && rX < 0.95 && rY < 0.98;
              const shouldersBelowFace = (lY - nY) > 0.20 && (rY - nY) > 0.20;
              const shouldersWide = Math.abs(lX - rX) > 0.15;
              const noseBetween = (nX - lX) * (nX - rX) < 0;
              const poseHit = worlds
                && shouldersConfident
                && shouldersInFrame
                && shouldersBelowFace
                && shouldersWide
                && noseBetween;
              if (poseHit) {
                const L = worlds[11];
                const R = worlds[12];
                const dx = R.x - L.x;
                const dy = R.y - L.y;
                const dz = R.z - L.z;
                // Roll: right-shoulder-up rotates around the front axis.
                // atan2(dy, dx) gives the shoulder-line tilt vs. horizontal.
                // Y in MediaPipe world is DOWN, so a raised right shoulder has
                // negative dy — we flip the sign so "right shoulder up" ↔ positive.
                const rawRoll = -Math.atan2(dy, dx);
                // Yaw: torso twist. Right shoulder moves away from camera when
                // user twists to their right; dz becomes positive.
                const width = Math.sqrt(dx * dx + dy * dy);
                const rawYaw = width > 0.01 ? Math.atan2(dz, width) : 0;

                // Auto-zero calibration. Running mean of the first
                // BIAS_CALIB_FRAMES successful hits becomes the neutral point.
                const BIAS_CALIB_FRAMES = 40;
                if (biasCountRef.current < BIAS_CALIB_FRAMES) {
                  biasCountRef.current += 1;
                  const n = biasCountRef.current;
                  biasRollRef.current += (rawRoll - biasRollRef.current) / n;
                  biasYawRef.current += (rawYaw - biasYawRef.current) / n;
                  if (n === BIAS_CALIB_FRAMES) {
                    console.log(
                      `[pose] calibration done — bias roll=${(biasRollRef.current * 180 / Math.PI).toFixed(1)}° ` +
                      `yaw=${(biasYawRef.current * 180 / Math.PI).toFixed(1)}°`,
                    );
                  }
                }
                poseRef.current = {
                  timestamp: now,
                  shoulderRoll: rawRoll - biasRollRef.current,
                  shoulderYaw: rawYaw - biasYawRef.current,
                };
              }
              // Diagnostic log every ~1s so user can share console output.
              if (now - lastPoseLogRef.current > 1000) {
                lastPoseLogRef.current = now;
                if (worlds) {
                  console.log(
                    `[pose] vis L=${visL.toFixed(2)} R=${visR.toFixed(2)} ` +
                    `inFrame=${shouldersInFrame ? "Y" : "N"} ` +
                    `belowFace=${shouldersBelowFace ? "Y" : "N"} ` +
                    `wide=${shouldersWide ? "Y" : "N"} ` +
                    `noseBetween=${noseBetween ? "Y" : "N"} ` +
                    `→ hit=${poseHit ? "Y" : "N"}`,
                  );
                } else {
                  console.log("[pose] no worldLandmarks in result");
                }
              }
            }
          }
        } catch (e: any) {
          setError(e?.message || (typeof e?.type === "string" ? `${step}: ${e.type}` : "未知错误"));
        }
        animFrameRef.current = requestAnimationFrame(processFrame);
      };
      processFrame();
    } catch (e) {
      setError(`${step}: ${e instanceof Error ? e.message : (typeof (e as any)?.type === "string" ? (e as any).type : "未知错误")}`);
    }
  }, [step]);

  const stop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    poseLandmarkerRef.current?.close();
    poseLandmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    blendshapeRef.current = null;
    poseRef.current = null;
    setIsLoaded(false);
    setIsCameraOn(false);
    setStep("");
  }, []);

  useEffect(() => () => stop(), [stop]);

  const toggleCamera = useCallback(() => {
    if (isLoaded) {
      stop();
    } else {
      start();
    }
  }, [isLoaded, start, stop]);

  return { videoRef, blendshapeRef, poseRef, isLoaded, isCameraOn, error, step, faceFound, start, stop, toggleCamera };
}
