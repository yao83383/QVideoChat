"use client";

import { useRef, useEffect } from "react";

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
}

export default function VoiceStatus({ stream, muted }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
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
      ctx2d.fillStyle = muted ? "#ef4444" : level > 0.3 ? "#4ade80" : "#525252";
      ctx2d.beginPath();
      ctx2d.arc(canvas.width / 2, canvas.height / 2, 6 + level * 4, 0, Math.PI * 2);
      ctx2d.fill();
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.close();
    };
  }, [stream, muted]);

  return (
    <canvas
      ref={canvasRef}
      width={24}
      height={24}
      className="shrink-0"
    />
  );
}
