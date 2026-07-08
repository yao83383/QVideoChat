"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export interface BlendshapeFrame {
  timestamp: number;
  values: Record<string, number>;
}

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
  const [isLoaded, setIsLoaded] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [faceFound, setFaceFound] = useState(false);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

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

      const processFrame = () => {
        const lm = landmarkerRef.current;
        const v = videoRef.current;
        if (!lm || !v) return;
        if (v.videoWidth === 0 || v.videoHeight === 0) {
          animFrameRef.current = requestAnimationFrame(processFrame);
          return;
        }
        try {
          const result = lm.detectForVideo(v, performance.now());
          if (result.faceBlendshapes?.length > 0) {
            setFaceFound(true);
            const values: Record<string, number> = {};
            for (const c of result.faceBlendshapes[0].categories) {
              values[c.categoryName] = c.score;
            }
            blendshapeRef.current = { timestamp: performance.now(), values };
          } else if (result.faceLandmarks?.length > 0) {
            setFaceFound(true);
          } else {
            setFaceFound(false);
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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    blendshapeRef.current = null;
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

  return { videoRef, blendshapeRef, isLoaded, isCameraOn, error, step, faceFound, start, stop, toggleCamera };
}
