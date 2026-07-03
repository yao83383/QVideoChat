"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export interface BlendshapeFrame {
  timestamp: number;
  values: Record<string, number>;
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
      const vision = await FilesetResolver.forVisionTasks(`${BASE_PATH}/wasm`);

      setStep("model");
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `${BASE_PATH}/models/face_landmarker.task`,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

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
          setError(e?.message || (typeof e?.type === "string" ? `${step}: ${e.type}` : String(e || "未知错误")));
        }
        animFrameRef.current = requestAnimationFrame(processFrame);
      };
      processFrame();
    } catch (e) {
      setError(`${step}: ${e instanceof Error ? e.message : (typeof (e as any)?.type === "string" ? (e as any).type : String(e))}`);
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
