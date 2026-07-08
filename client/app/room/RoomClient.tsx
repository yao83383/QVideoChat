"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import MatchButton from "@/components/MatchButton";
import VoiceStatus from "@/components/VoiceStatus";
import LoginPrompt from "@/components/LoginPrompt";
import TranslationBar from "@/components/TranslationBar";
import TopicCard from "@/components/TopicCard";
import LanguageSelector from "@/components/LanguageSelector";
import { getSettings } from "@/components/SettingsModal";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { usePeer } from "@/hooks/usePeer";
import { useSocket } from "@/hooks/useSocket";
import { reportUser } from "@/lib/api";
import { createWebSpeechASR } from "@/lib/ai/asr";
import { translateText } from "@/lib/ai/translate";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function savePref(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

export default function RoomClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const roomId = sp.get("id") || "";
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
  const [topicText, setTopicText] = useState("");
  const [topicCategory, setTopicCategory] = useState("general");
  const [mySourceText, setMySourceText] = useState<string | null>(null);
  const [myTranslatedText, setMyTranslatedText] = useState<string | null>(null);
  const [peerSourceText, setPeerSourceText] = useState<string | null>(null);
  const [peerTranslatedText, setPeerTranslatedText] = useState<string | null>(null);
  const [sourceLang, setSourceLang] = useState(() => loadPref("qv_sl", "zh"));
  const [targetLang, setTargetLang] = useState(() => loadPref("qv_tl", "en"));
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);

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
    onTopic: (data) => {
      setTopicText(data.text);
      setTopicCategory(data.category || "general");
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

  const initStartedRef = useRef(false);
  useEffect(() => {
    if (!socket.isConnected || !isLoaded) return;
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    (async () => {
      try {
        await peer.initConnection(false);
        socket.joinRoom(roomId, userId);
      } catch { /* error surfaced via peer.error */ }
    })();
  }, [socket.isConnected, isLoaded, roomId, userId, peer.initConnection, socket.joinRoom]);

  useEffect(() => {
    if (!roomReady || !isInitiator) return;
    peer.startAsInitiator();
  }, [roomReady, isInitiator, peer.startAsInitiator]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const stream = peer.remoteAudioStream;
    if (!stream) {
      audio.srcObject = null;
      return;
    }
    const tracks = stream.getAudioTracks();
    console.log("[audio] remote stream ready, tracks=", tracks.map((t) => ({
      id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState,
    })));
    audio.srcObject = stream;
    audio.muted = false;
    audio.volume = 1;

    let cancelled = false;
    const cleanupListeners: Array<() => void> = [];
    const tryPlay = (source: string) => {
      audio.play()
        .then(() => { console.log(`[audio] play ok (${source})`); })
        .catch((e) => {
          if (cancelled) return;
          console.warn(`[audio] play failed (${source}), will retry on next interaction:`, e?.name || e);
          const retry = () => {
            cleanupListeners.forEach((fn) => fn());
            cleanupListeners.length = 0;
            tryPlay("interaction");
          };
          const events: Array<keyof DocumentEventMap> = ["click", "pointerdown", "keydown", "touchstart"];
          events.forEach((ev) => {
            document.addEventListener(ev, retry, { once: true, passive: true });
            cleanupListeners.push(() => document.removeEventListener(ev, retry));
          });
        });
    };
    tryPlay("auto");

    let lastCT = 0;
    const diag = setInterval(() => {
      const t = tracks[0];
      console.log("[audio] diag paused=", audio.paused, "muted=", audio.muted, "vol=", audio.volume,
        "currentTime=", audio.currentTime.toFixed(2), "advancing=", audio.currentTime > lastCT,
        "readyState=", audio.readyState,
        "trackMuted=", t?.muted, "trackEnabled=", t?.enabled, "trackReadyState=", t?.readyState);
      lastCT = audio.currentTime;
    }, 3000);

    return () => {
      cancelled = true;
      cleanupListeners.forEach((fn) => fn());
      clearInterval(diag);
    };
  }, [peer.remoteAudioStream]);

  // --- AI Translation Pipeline ---

  // Web Speech API → translate → display + send to peer
  useEffect(() => {
    if (!subtitleEnabled || !peer.isConnected || !peer.isMicOn) return;

    const engine = createWebSpeechASR(
      sourceLang,
      (result) => {
        setMySourceText(result.text);
        // Translate in background — NLLB-200 is heavy, don't block UI
        translateText(result.text, sourceLang, targetLang)
          .then((tr) => {
            setMyTranslatedText(tr.translatedText);
            peer.sendTranslation({
              text: tr.translatedText,
              sourceLang,
              targetLang,
            });
          })
          .catch((e) => console.warn("[translate]", e));
      },
      (err) => console.warn("[asr]", err),
    );

    if (engine) engine.start();
    return () => engine?.stop();
  }, [subtitleEnabled, peer.isConnected, peer.isMicOn, sourceLang, targetLang]);

  // Receive peer translations via DataChannel
  useEffect(() => {
    if (!subtitleEnabled) return;
    const interval = setInterval(() => {
      const msg = peer.remoteTranslationRef.current;
      if (msg && msg.text) {
        setPeerTranslatedText(msg.text);
        // Clear after reading so it doesn't keep re-rendering
        peer.remoteTranslationRef.current = null;
      }
    }, 200);
    return () => clearInterval(interval);
  }, [subtitleEnabled]);

  // --- Handlers ---

  const handleSourceLangChange = (lang: string) => { setSourceLang(lang); savePref("qv_sl", lang); };
  const handleTargetLangChange = (lang: string) => { setTargetLang(lang); savePref("qv_tl", lang); };
  const handleSubtitleToggle = () => setSubtitleEnabled((v) => !v);

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
    <main className="flex flex-col h-dvh bg-black/95 overflow-hidden">
      <audio ref={audioRef} autoPlay playsInline hidden />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-b border-white/5 z-10">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white/70 font-medium">{pname}</span>
          <span className={`w-2 h-2 rounded-full ${peer.isConnected ? "bg-green-500" : "bg-red-500"}`} />
        </div>
        <div className="flex items-center gap-3">
          {peer.isConnected && <span className="text-[11px] text-green-400/60">语音已连接</span>}
          {!faceFound && isLoaded && <span className="text-[10px] text-yellow-400">未检测到人脸</span>}
          <span className="text-[10px] text-neutral-500">{peer.isConnecting ? "连接中..." : peer.isConnected ? "" : roomReady ? "等待对方加入..." : "等待对方加入..."}</span>
        </div>
      </div>

      {/* Partner avatar — full area */}
      <div className="flex-1 relative flex items-center justify-center bg-black/50">
        <VrmAvatar blendshapeRef={peer.remoteBlendshapeRef} size={340} muted={partnerLeft} className="self-center" />

        {/* Topic card overlay */}
        {topicText && (
          <div className="absolute top-4 left-0 right-0 mx-auto flex justify-center z-20">
            <TopicCard text={topicText} category={topicCategory} />
          </div>
        )}

        {/* Partner left overlay */}
        {partnerLeft && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
            <p className="rounded-lg bg-yellow-900/40 px-4 py-2 text-yellow-400 text-sm">对方已离开房间</p>
          </div>
        )}

        {/* Translation subtitle — bottom of partner area */}
        <TranslationBar
          sourceText={peerSourceText}
          translatedText={peerTranslatedText}
          sourceLang={targetLang}
          targetLang={sourceLang}
        />

        {/* My PiP avatar */}
        <div className="absolute bottom-4 right-4 z-20">
          <div className="relative">
            {isCameraOn ? (
              <VrmAvatar blendshapeRef={blendshapeRef} size={120} />
            ) : (
              <div className="rounded-xl bg-neutral-900/80 border border-neutral-700 flex items-center justify-center" style={{ width: 120, height: 120 }}>
                <span className="text-neutral-500 text-3xl">📷</span>
              </div>
            )}
            {/* Mic indicator on PiP */}
            <div className={`absolute top-2 left-2 w-3 h-3 rounded-full border-2 border-black/40 ${peer.isMicOn ? "bg-green-500" : "bg-red-500"}`} />
          </div>
        </div>

        {/* Voice status bars */}
        <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-1">
          <VoiceStatus stream={peer.remoteAudioStream} label={pname} muted={partnerLeft} />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-center gap-4 px-4 py-1.5 bg-black/60 border-t border-white/5 z-10">
        {peer.error && <p className="text-red-400 text-xs">{peer.error}</p>}
        {friendStatus === "received" && !partnerLeft && (
          <p className="text-green-400 text-xs">{pname} 想加你为好友</p>
        )}
        {friendStatus === "sent" && <p className="text-neutral-500 text-xs">好友请求已发送</p>}
        {friendStatus === "friends" && <p className="text-green-400 text-xs">已是好友</p>}

        {peer.isConnected && friendStatus === "none" && (
          <button onClick={handleAddFriend} className="text-[10px] text-neutral-400 hover:text-white underline underline-offset-2">
            + 添加好友
          </button>
        )}
        {peer.isConnected && friendStatus === "received" && (
          <button onClick={handleAcceptFriend} className="rounded bg-green-700 px-2 py-0.5 text-[10px] text-white">
            接受好友请求
          </button>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-black/60 border-t border-white/5 z-10">
        {cameraEverLoaded.current && (
          <>
            <button onClick={toggleCamera}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm ${
                isCameraOn ? "bg-white/10 border border-white/20 text-white" : "bg-red-600/30 border border-red-700 text-red-400"
              }`}>
              📷
            </button>
            <button onClick={peer.toggleMic}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm ${
                peer.isMicOn ? "bg-white/10 border border-white/20 text-white" : "bg-red-600/30 border border-red-700 text-red-400"
              }`}>
              🎙
            </button>
          </>
        )}

        <LanguageSelector
          sourceLang={sourceLang}
          targetLang={targetLang}
          subtitleEnabled={subtitleEnabled}
          onSourceChange={handleSourceLangChange}
          onTargetChange={handleTargetLangChange}
          onSubtitleToggle={handleSubtitleToggle}
        />

        <div className="flex gap-2 ml-2">
          <button onClick={handleHangup} className="w-10 h-10 rounded-full bg-red-600/70 border border-red-500 flex items-center justify-center text-lg hover:bg-red-500 transition">
            ✕
          </button>
          <button onClick={handleNext} className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-lg hover:bg-white/20 transition">
            →
          </button>
        </div>

        {!reported && (
          <button onClick={() => { reportUser(puid, roomId, ""); setReported(true); }}
            className="text-[9px] text-red-600/60 hover:text-red-400 underline underline-offset-2 ml-1">
            举报
          </button>
        )}
        {reported && <span className="text-[9px] text-neutral-600 ml-1">已举报</span>}
      </div>

      {/* Modals */}
      {showFriendPrompt && partnerLeft && (
        <div className="absolute bottom-24 left-0 right-0 mx-auto w-fit z-30">
          <div className="flex items-center gap-3 rounded-lg bg-neutral-800/90 px-4 py-2.5 shadow-lg">
            <span className="text-xs text-neutral-400">聊得开心吗？</span>
            {friendStatus === "none" && (
              <button onClick={handleAddFriend} className="rounded-lg bg-white text-black px-3 py-1 text-xs font-medium">
                加为好友
              </button>
            )}
            {friendStatus === "sent" && <span className="text-xs text-green-400">已发送</span>}
            {friendStatus === "friends" && <span className="text-xs text-green-400">已是好友</span>}
          </div>
        </div>
      )}

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </main>
  );
}
