"use client";

import { useRef, useEffect } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import type { BlendshapeFrame } from "@/hooks/useFaceMesh";
import {
  createRenderer,
  createScene,
  createCamera,
  loadVRM,
  applyBlendshapes,
  createFallbackModel,
  applyBlendshapesToFallback,
} from "@/lib/blendshapeMap";

interface Props {
  blendshapeRef: React.MutableRefObject<BlendshapeFrame | null>;
  size?: number;
  label?: string;
  muted?: boolean;
  isSpeaking?: boolean;
}

export default function VrmAvatar({
  blendshapeRef,
  size = 280,
  label,
  muted = false,
  isSpeaking = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const fallbackRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = createRenderer(canvas, size);
    const scene = createScene();
    const camera = createCamera(size);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    loadVRM("/models/sample.vrm")
      .then((vrm) => {
        scene.add(vrm.scene);
        vrmRef.current = vrm;
      })
      .catch(() => {
        const fallback = createFallbackModel();
        scene.add(fallback);
        fallbackRef.current = fallback;
      });

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const bs = blendshapeRef.current;

      if (vrmRef.current && bs) {
        applyBlendshapes(vrmRef.current, bs.values);
        vrmRef.current.update(0.016);
      } else if (fallbackRef.current && bs) {
        applyBlendshapesToFallback(fallbackRef.current, bs.values);
      }

      rendererRef.current!.render(sceneRef.current!, cameraRef.current!);
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
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative overflow-hidden rounded-2xl bg-neutral-950 ${glowClass}`}
        style={{ width: size, height: size }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        {muted && (
          <div className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
            MUTED
          </div>
        )}
      </div>
      {label && <span className="text-xs text-neutral-400">{label}</span>}
    </div>
  );
}
