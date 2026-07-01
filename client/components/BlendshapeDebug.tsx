"use client";

import { useRef, useEffect, useState } from "react";
import type { BlendshapeFrame } from "@/hooks/useFaceMesh";

const KEY_BLENDSHAPES = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "jawOpen",
  "mouthSmileLeft",
  "mouthSmileRight",
  "browInnerUp",
  "mouthPucker",
  "mouthFrownLeft",
  "mouthFrownRight",
  "cheekSquintLeft",
  "cheekSquintRight",
  "mouthFunnel",
];

interface Props {
  blendshapeRef: React.MutableRefObject<BlendshapeFrame | null>;
}

export default function BlendshapeDebug({ blendshapeRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const valuesRef = useRef<Record<string, number>>({});
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let lastTs = 0;
    const interval = setInterval(() => {
      const data = blendshapeRef.current;
      if (data) {
        if (data.timestamp !== lastTs) {
          lastTs = data.timestamp;
          frameCountRef.current++;
        }
        valuesRef.current = data.values;
        draw();
      }
      const now = performance.now();
      if (now - lastTimeRef.current > 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
    }, 50);

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const vals = valuesRef.current;
      const h = 18;
      const barW = 120;
      const xLabel = 10;
      const xBar = 160;
      const yStart = 30;

      // FPS counter
      ctx.fillStyle = "#0f0";
      ctx.font = "bold 12px monospace";
      ctx.fillText(`FPS: ${fps}   jawOpen: ${(vals.jawOpen ?? 0).toFixed(3)}`, xLabel, 16);

      ctx.fillStyle = "#888";
      ctx.font = "12px monospace";

      KEY_BLENDSHAPES.forEach((name, i) => {
        const y = yStart + i * h;
        const v = vals[name] ?? 0;

        ctx.fillStyle = "#aaa";
        ctx.fillText(name, xLabel, y + h - 4);

        ctx.fillStyle = "#333";
        ctx.fillRect(xBar, y, barW, h - 2);

        ctx.fillStyle = v > 0.7 ? "#4f4" : v > 0.3 ? "#fc4" : "#444";
        ctx.fillRect(xBar, y, barW * v, h - 2);

        ctx.fillStyle = "#888";
        ctx.fillText(v.toFixed(3), xBar + barW + 8, y + h - 4);
      });
    };

    return () => clearInterval(interval);
  }, [fps, blendshapeRef]);

  return (
    <canvas
      ref={canvasRef}
      width={330}
      height={KEY_BLENDSHAPES.length * 18 + 40}
      className="rounded-lg border border-neutral-700 bg-neutral-900"
    />
  );
}
