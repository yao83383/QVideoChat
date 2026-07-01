"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import MatchButton from "@/components/MatchButton";
import VoiceStatus from "@/components/VoiceStatus";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { usePeer } from "@/hooks/usePeer";
import { useSocket } from "@/hooks/useSocket";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

export default function Room() {
  const router = useRouter();
  const { id: roomId } = useParams<{ id: string }>();
  const sp = useSearchParams();

  const userId = sp.get("uid") || "";
  const uname = sp.get("uname") || "我";
  const puid = sp.get("puid") || "";
  const pname = sp.get("pname") || "对方";
  const isInitiator = userId < puid;

  const [partnerLeft, setPartnerLeft] = useState(false);
  const [roomReady, setRoomReady] = useState(false);

  // Camera + blendshape
  const { blendshapeRef, isLoaded, error: camError, step: camStep, faceFound, start, stop } = useFaceMesh();
  useEffect(() => { start(); return () => stop(); }, []);

  // Bridge refs for socket <-> peer
  const onOfferRef = useRef<(sdp: RTCSessionDescriptionInit) => void>(undefined);
  const onAnswerRef = useRef<(sdp: RTCSessionDescriptionInit) => void>(undefined);
  const onIceRef = useRef<(candidate: RTCIceCandidateInit) => void>(undefined);

  // Signal events: socket receives → calls peer handlers
  const signalEvents: SignalEvents = useMemo(() => ({
    onOffer: (data) => onOfferRef.current?.(data.sdp),
    onAnswer: (data) => onAnswerRef.current?.(data.sdp),
    onIce: (data) => onIceRef.current?.(data.candidate),
  }), []);

  const matchEvents: MatchEvents = useMemo(() => ({
    onWaiting: () => {},
    onFound: () => {},
    onReady: () => setRoomReady(true),
    onPartnerLeft: () => setPartnerLeft(true),
  }), []);

  const socket = useSocket(matchEvents, signalEvents);

  // Signaling for peer: peer emits → socket sends
  const signaling = useMemo(() => ({
    onOffer: (sdp: RTCSessionDescriptionInit) => { socket.sendOffer(roomId, sdp); },
    onAnswer: (sdp: RTCSessionDescriptionInit) => { socket.sendAnswer(roomId, sdp); },
    onIceCandidate: (candidate: RTCIceCandidateInit) => { socket.sendIce(roomId, candidate); },
  }), [socket.sendOffer, socket.sendAnswer, socket.sendIce, roomId]);

  const peer = usePeer(blendshapeRef, signaling);

  // Wire peer handlers to bridge refs
  useEffect(() => {
    onOfferRef.current = peer.handleIncomingOffer;
    onAnswerRef.current = peer.handleIncomingAnswer;
    onIceRef.current = peer.handleIncomingIce;
  });

  // Step 1: Both join room + setup peer (as non-initiator)
  useEffect(() => {
    if (!socket.isConnected || !isLoaded || peer.isConnecting || peer.isConnected) return;
    socket.joinRoom(roomId, userId);
    peer.initConnection(false);
  }, [socket.isConnected, isLoaded, peer.isConnecting, peer.isConnected, roomId, userId, peer.initConnection]);

  // Step 2: Initiator sends offer after room:ready
  useEffect(() => {
    if (!roomReady || !isInitiator) return;
    peer.startAsInitiator();
  }, [roomReady, isInitiator, peer.startAsInitiator]);

  // Remote audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  useEffect(() => {
    if (!peer.remoteAudioStream) return;
    const audio = new Audio();
    audio.srcObject = peer.remoteAudioStream;
    audioRef.current = audio;
    audio.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    return () => { audio.srcObject = null; audioRef.current = null; };
  }, [peer.remoteAudioStream]);

  const unlockAudio = () => {
    audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {});
  };

  const handleHangup = () => {
    socket.leaveRoom(roomId);
    peer.disconnect();
    router.push("/");
  };

  const handleNext = () => {
    socket.leaveRoom(roomId);
    peer.disconnect();
    router.push("/");
  };

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
        <p className="text-neutral-400 text-sm">初始化摄像头...</p>
        {camStep && <p className="text-yellow-400 text-xs">阶段: {camStep}</p>}
        {camError && <p className="text-red-400 text-sm">{camError}</p>}
        {isLoaded && !faceFound && <p className="text-yellow-400 text-xs">就绪 · 未检测到人脸</p>}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-xl font-bold tracking-tight">QVideoChat</h1>

      {partnerLeft && (
        <p className="rounded-lg bg-yellow-900/30 px-4 py-2 text-yellow-400 text-sm">对方已离开房间</p>
      )}
      {peer.error && (
        <p className="text-red-400 text-sm">{peer.error}</p>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <VrmAvatar blendshapeRef={blendshapeRef} size={260} label={`${uname} (你)`} />
        <VrmAvatar blendshapeRef={peer.remoteBlendshapeRef} size={260} label={`${pname} (对方)`}
          muted={partnerLeft} />
      </div>

      <div className="flex items-center gap-3">
        <VoiceStatus stream={peer.remoteAudioStream} muted={partnerLeft} />
        <span className={`text-xs ${peer.isConnected ? "text-green-400" : "text-neutral-500"}`}>
          {peer.isConnecting ? "连接中..." : peer.isConnected ? "已连接" : roomReady ? "建立连接..." : "等待对方加入..."}
        </span>
        <span className="text-xs text-neutral-600">ICE: {peer.iceState}</span>
        {!faceFound && isLoaded && (
          <span className="text-xs text-yellow-400">未检测到人脸</span>
        )}
      </div>

      {peer.isConnected && audioBlocked && (
        <button
          onClick={unlockAudio}
          className="rounded-lg bg-green-700 px-4 py-1.5 text-xs text-white hover:bg-green-600"
        >
          点击启用语音
        </button>
      )}

      <div className="flex gap-4 mt-2">
        <MatchButton label="挂断" variant="secondary" onClick={handleHangup} />
        <MatchButton label="下一个" onClick={handleNext} disabled={partnerLeft} />
      </div>
    </main>
  );
}
