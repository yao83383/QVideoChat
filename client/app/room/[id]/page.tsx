"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import MatchButton from "@/components/MatchButton";
import VoiceStatus from "@/components/VoiceStatus";
import LoginPrompt from "@/components/LoginPrompt";
import { getSettings } from "@/components/SettingsModal";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { usePeer } from "@/hooks/usePeer";
import { useSocket } from "@/hooks/useSocket";
import { reportUser } from "@/lib/api";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

export default function Room() {
  const router = useRouter();
  const { id: roomId } = useParams<{ id: string }>();
  const sp = useSearchParams();

  const userId = sp.get("uid") || "";
  const uname = sp.get("uname") || "我";
  const puid = sp.get("puid") || "";
  const pname = sp.get("pname") || "对方";
  const isRegistered = sp.get("reg") === "1";
  const isInitiator = userId < puid;

  const [partnerLeft, setPartnerLeft] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "received" | "friends">("none");
  const [showFriendPrompt, setShowFriendPrompt] = useState(false);
  const [reported, setReported] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const { blendshapeRef, isLoaded, isCameraOn, error: camError, step: camStep, faceFound, start, stop, toggleCamera } = useFaceMesh();
  useEffect(() => { start(); return () => stop(); }, []);
  const cameraEverLoaded = useRef(false);
  useEffect(() => { if (isLoaded) cameraEverLoaded.current = true; }, [isLoaded]);

  const onOfferRef = useRef<(sdp: RTCSessionDescriptionInit) => void>(undefined);
  const onAnswerRef = useRef<(sdp: RTCSessionDescriptionInit) => void>(undefined);
  const onIceRef = useRef<(candidate: RTCIceCandidateInit) => void>(undefined);

  const signalEvents: SignalEvents = useMemo(() => ({
    onOffer: (data) => onOfferRef.current?.(data.sdp),
    onAnswer: (data) => onAnswerRef.current?.(data.sdp),
    onIce: (data) => onIceRef.current?.(data.candidate),
  }), []);

  const matchEvents: MatchEvents = useMemo(() => ({
    onWaiting: () => {},
    onFound: () => {},
    onReady: () => setRoomReady(true),
    onPartnerLeft: () => {
      setPartnerLeft(true);
      setShowFriendPrompt(true);
    },
    onFriendRequest: (data) => {
      if (data.fromUserId === puid) {
        setFriendStatus("received");
        setShowFriendPrompt(true);
      }
    },
    onFriendAccepted: (data) => {
      if (data.userId === puid) {
        setFriendStatus("friends");
      }
    },
    onSessionKick: () => {
      router.push("/");
    },
  }), [puid, router]);

  const socket = useSocket(matchEvents, signalEvents);

  const signaling = useMemo(() => ({
    onOffer: (sdp: RTCSessionDescriptionInit) => { socket.sendOffer(roomId, sdp); },
    onAnswer: (sdp: RTCSessionDescriptionInit) => { socket.sendAnswer(roomId, sdp); },
    onIceCandidate: (candidate: RTCIceCandidateInit) => { socket.sendIce(roomId, candidate); },
  }), [socket.sendOffer, socket.sendAnswer, socket.sendIce, roomId]);

  const peer = usePeer(blendshapeRef, signaling);

  useEffect(() => {
    onOfferRef.current = peer.handleIncomingOffer;
    onAnswerRef.current = peer.handleIncomingAnswer;
    onIceRef.current = peer.handleIncomingIce;
  });

  useEffect(() => {
    if (!socket.isConnected || !isLoaded || peer.isConnecting || peer.isConnected) return;
    socket.joinRoom(roomId, userId);
    peer.initConnection(false);
  }, [socket.isConnected, isLoaded, peer.isConnecting, peer.isConnected, roomId, userId, peer.initConnection]);

  useEffect(() => {
    if (!roomReady || !isInitiator) return;
    peer.startAsInitiator();
  }, [roomReady, isInitiator, peer.startAsInitiator]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(true);
  const audioRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (peer.remoteAudioStream) {
      setAudioBlocked(true);
      // Clear old retry timer
      if (audioRetryRef.current) clearInterval(audioRetryRef.current);
    }
    return () => {
      if (audioRef.current) { audioRef.current.srcObject = null; audioRef.current = null; }
    };
  }, [peer.remoteAudioStream]);

  const unlockAudio = () => {
    const stream = peer.remoteAudioStream;
    if (!stream) {
      // No remote audio yet, retry until it arrives
      if (audioRetryRef.current) clearInterval(audioRetryRef.current);
      audioRetryRef.current = setInterval(() => {
        if (peer.remoteAudioStream) {
          clearInterval(audioRetryRef.current!);
          tryPlayAudio(peer.remoteAudioStream);
        }
      }, 1000);
      return;
    }
    tryPlayAudio(stream);
  };

  const tryPlayAudio = (stream: MediaStream) => {
    if (audioRef.current) { audioRef.current.srcObject = null; }
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    ac.resume();
    const audio = new Audio();
    audio.srcObject = stream;
    audio.muted = false;
    audio.volume = 1;
    audioRef.current = audio;
    audio.play().then(() => setAudioBlocked(false)).catch((e) => console.log("audio play failed:", e));
  };

  // Auto-unlock on first tap
  const handleFirstInteraction = () => {
    if (audioBlocked && audioRef.current) unlockAudio();
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

  const handleAddFriend = () => {
    if (!isRegistered) { setShowLoginModal(true); return; }
    socket.sendFriendRequest(userId, uname, puid);
    setFriendStatus("sent");
  };

  const handleAcceptFriend = () => {
    if (!isRegistered) { setShowLoginModal(true); return; }
    socket.sendFriendAccept(puid, userId);
    setFriendStatus("friends");
  };

  if (!isLoaded && !cameraEverLoaded.current) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
        <p className="text-neutral-400 text-sm">初始化摄像头...</p>
        {camStep && <p className="text-yellow-400 text-xs">阶段: {camStep}</p>}
        {camError && <p className="text-red-400 text-sm">{camError}</p>}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4" onClick={handleFirstInteraction}>
      <h1 className="text-xl font-bold tracking-tight">QVideoChat</h1>

      {partnerLeft && (
        <p className="rounded-lg bg-yellow-900/30 px-4 py-2 text-yellow-400 text-sm">对方已离开房间</p>
      )}
      {peer.error && (
        <p className="text-red-400 text-sm">{peer.error}</p>
      )}

      {friendStatus === "received" && !partnerLeft && (
        <p className="rounded-lg bg-green-900/30 px-4 py-2 text-green-400 text-xs">{pname} 想加你为好友</p>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          {isCameraOn ? (
            <VrmAvatar blendshapeRef={blendshapeRef} size={260} />
          ) : (
            <div className="rounded-2xl bg-neutral-950 flex items-center justify-center" style={{ width: 260, height: 260 }}>
              <span className="text-neutral-600 text-5xl">📷</span>
            </div>
          )}
          <VoiceStatus stream={peer.localAudioStream} label={getSettings().showId ? `${uname} (你)` : "匿名用户"} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <VrmAvatar blendshapeRef={peer.remoteBlendshapeRef} size={260} muted={partnerLeft} />
          <VoiceStatus stream={peer.remoteAudioStream} label={`${pname} (对方)`} muted={partnerLeft} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className={`text-xs ${peer.isConnected ? "text-green-400" : "text-neutral-500"}`}>
          {peer.isConnecting ? "连接中..." : peer.isConnected ? "已连接" : roomReady ? "建立连接..." : "等待对方加入..."}
        </span>
        <span className="text-xs text-neutral-600">ICE: {peer.iceState}</span>
        {!faceFound && isLoaded && (
          <span className="text-xs text-yellow-400">未检测到人脸</span>
        )}
      </div>

      {cameraEverLoaded.current && (
        <div className="flex gap-2">
          <button
            onClick={toggleCamera}
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition ${
              isCameraOn ? "bg-neutral-800 border border-neutral-600 text-neutral-300 hover:bg-neutral-700" : "bg-red-600/30 border border-red-700 text-red-400"
            }`}
            title={isCameraOn ? "关闭摄像头" : "打开摄像头"}
          >
            {isCameraOn ? "📷" : "📷"}
          </button>
          <button
            onClick={peer.toggleMic}
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition ${
              peer.isMicOn ? "bg-neutral-800 border border-neutral-600 text-neutral-300 hover:bg-neutral-700" : "bg-red-600/30 border border-red-700 text-red-400"
            }`}
            title={peer.isMicOn ? "关闭麦克风" : "打开麦克风"}
          >
            {peer.isMicOn ? "🎙" : "🎙"}
          </button>
        </div>
      )}

      {peer.isConnected && audioBlocked && (
        <button
          onClick={unlockAudio}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm text-white font-medium hover:bg-green-500 animate-pulse"
        >
          🔈 点击启用语音 {!peer.remoteAudioStream && "(等待音频...)"}
        </button>
      )}
      {peer.isConnected && !audioBlocked && (
        <p className="text-xs text-green-400/60">语音已连接</p>
      )}

      {peer.isConnected && friendStatus === "none" && (
        <button
          onClick={handleAddFriend}
          className="rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white transition"
        >
          + 添加好友
        </button>
      )}

      {peer.isConnected && friendStatus === "received" && (
        <button
          onClick={handleAcceptFriend}
          className="rounded-lg bg-green-700 px-4 py-1.5 text-xs text-white hover:bg-green-600"
        >
          接受好友请求
        </button>
      )}

      {friendStatus === "sent" && (
        <p className="text-xs text-neutral-500">好友请求已发送</p>
      )}

      {friendStatus === "friends" && (
        <p className="text-xs text-green-400">已是好友</p>
      )}

      {showFriendPrompt && partnerLeft && (
        <div className="flex items-center gap-3 rounded-lg bg-neutral-800/60 px-4 py-3">
          <span className="text-xs text-neutral-400">聊得开心吗？</span>
          {friendStatus === "none" && (
            <button
              onClick={handleAddFriend}
              className="rounded-lg bg-white text-black px-3 py-1 text-xs font-medium hover:bg-neutral-200"
            >
              加为好友
            </button>
          )}
          {friendStatus === "sent" && (
            <span className="text-xs text-green-400">已发送</span>
          )}
          {friendStatus === "friends" && (
            <span className="text-xs text-green-400">已是好友</span>
          )}
        </div>
      )}

      <div className="flex gap-4 mt-2">
        <MatchButton label="挂断" variant="secondary" onClick={handleHangup} />
        <MatchButton label="下一个" onClick={handleNext} />
        {!reported && (
          <button
            onClick={() => { reportUser(puid, roomId, ""); setReported(true); }}
            className="text-[10px] text-red-600 hover:text-red-400 underline underline-offset-2"
          >
            举报
          </button>
        )}
        {reported && (
          <span className="text-[10px] text-neutral-600">已举报</span>
        )}
      </div>

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </main>
  );
}
