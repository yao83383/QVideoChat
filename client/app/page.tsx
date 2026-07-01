"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import NameInput from "@/components/NameInput";
import MatchButton from "@/components/MatchButton";
import BlendshapeDebug from "@/components/BlendshapeDebug";
import VrmAvatar from "@/components/VrmAvatar";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSocket } from "@/hooks/useSocket";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

let globalUserId = "";
const getUserId = () => {
  if (!globalUserId) globalUserId = Math.random().toString(36).slice(2, 10);
  return globalUserId;
};

export default function Home() {
  const router = useRouter();
  const userId = useMemo(() => getUserId(), []);
  const [username, setUsername] = useState("");
  const [matchStatus, setMatchStatus] = useState<"idle" | "matching">("idle");
  const [showDebug, setShowDebug] = useState(false);
  const usernameRef = useRef(username);
  usernameRef.current = username;

  const matchEvents: MatchEvents = useMemo(
    () => ({
      onWaiting: () => setMatchStatus("matching"),
      onFound: (data) => {
        const params = new URLSearchParams({
          uid: userId,
          uname: usernameRef.current,
          puid: data.partner.userId,
          pname: data.partner.username,
        });
        router.push(`/room/${data.roomId}?${params.toString()}`);
      },
      onPartnerLeft: () => {},
      onReady: () => {},
    }),
    [userId, router],
  );

  const signalEvents: SignalEvents = useMemo(
    () => ({
      onOffer: () => {},
      onAnswer: () => {},
      onIce: () => {},
    }),
    [],
  );

  const { joinMatch, cancelMatch } = useSocket(matchEvents, signalEvents);
  const { blendshapeRef, isLoaded, error, step, faceFound, start, stop } = useFaceMesh();

  const handleToggleCamera = async () => {
    if (isLoaded) { stop(); setShowDebug(false); } else { await start(); setShowDebug(true); }
  };

  useEffect(() => () => stop(), [stop]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-3xl font-bold tracking-tight">QVideoChat</h1>
      <p className="text-neutral-400 text-sm">Q版虚拟形象 · 随机匹配通话</p>

      <NameInput value={username} onChange={setUsername} disabled={matchStatus !== "idle"} />

      {matchStatus === "idle" && (
        <MatchButton
          label="开始匹配"
          disabled={!username.trim()}
          onClick={() => {
            // unlock audio autoplay
            const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
            ac.resume();
            joinMatch(userId, username);
            setMatchStatus("matching");
          }}
        />
      )}

      {matchStatus === "matching" && (
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          <p className="text-neutral-400">正在寻找匹配对象...</p>
          <MatchButton
            label="取消"
            variant="secondary"
            onClick={() => { cancelMatch(userId); setMatchStatus("idle"); }}
          />
        </div>
      )}

      <hr className="w-64 border-neutral-800" />

      <MatchButton
        label={isLoaded ? "关闭摄像头" : "测试: 打开摄像头"}
        variant="secondary"
        onClick={handleToggleCamera}
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {isLoaded && !faceFound && <p className="text-yellow-400 text-xs">追踪就绪 · 未检测到人脸</p>}
      {faceFound && <p className="text-green-400 text-xs">追踪就绪 · 人脸检测中</p>}
      {step && !isLoaded && <p className="text-yellow-400 text-xs">加载中: {step}</p>}

      {showDebug && (
        <div className="flex flex-col xl:flex-row items-center gap-6">
          <BlendshapeDebug blendshapeRef={blendshapeRef} />
          <VrmAvatar blendshapeRef={blendshapeRef} size={320} label="Q版形象 (本地)" />
        </div>
      )}
    </main>
  );
}
