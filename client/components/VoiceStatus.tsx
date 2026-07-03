"use client";

import { useRef, useEffect } from "react";

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  label?: string;
}

export default function VoiceStatus({ stream, muted, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!analyserRef.current || !canvasRef.current) return;
      analyserRef.current.getByteFrequencyData(data);

      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const level = Math.min(avg / 128, 1);

      const canvas = canvasRef.current;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;

      ctx2d.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 5;
      const barW = 4;
      const gap = 3;
      const totalW = barCount * barW + (barCount - 1) * gap;
      const startX = (canvas.width - totalW) / 2;
      const maxH = canvas.height - 4;

      for (let i = 0; i < barCount; i++) {
        const h = Math.max(2, maxH * level * (0.4 + Math.random() * 0.6));
        const y = (canvas.height - h) / 2;
        ctx2d.fillStyle = muted
          ? "#ef4444"
          : level > 0.15
          ? "#4ade80"
          : "#3f3f46";
        ctx2d.beginPath();
        ctx2d.roundRect(startX + i * (barW + gap), y, barW, h, 2);
        ctx2d.fill();
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.close();
    };
  }, [stream, muted]);

  return (
    <div className="flex items-center gap-1.5">
      <canvas
        ref={canvasRef}
        width={40}
        height={16}
        className="shrink-0"
      />
      {label && <span className="text-[10px] text-neutral-500">{label}</span>}
    </div>
  );
}
