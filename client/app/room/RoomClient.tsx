"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import MatchButton from "@/components/MatchButton";
import VoiceStatus from "@/components/VoiceStatus";
import LoginPrompt from "@/components/LoginPrompt";
import TopicCard from "@/components/TopicCard";
import LanguageSelector from "@/components/LanguageSelector";
import { getSettings } from "@/components/SettingsModal";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { usePeer } from "@/hooks/usePeer";
import { useSocket } from "@/hooks/useSocket";
import { reportUser } from "@/lib/api";
import { createSherpaEngine, preloadSherpa, onSherpaLoadChange, type SherpaLoadState } from "@/lib/ai/sherpa-engine";
import { translateText, preloadPair } from "@/lib/ai/translate";
import { onLoadingChange } from "@/lib/ai";
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
  const [partnerReconnecting, setPartnerReconnecting] = useState(false);
  const [rejoinTick, setRejoinTick] = useState(0);
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
  const [translating, setTranslating] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelBytes, setModelBytes] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [asrError, setAsrError] = useState<string | null>(null);
  const [asrStatus, setAsrStatus] = useState<string>("idle");
  const [sherpaLoad, setSherpaLoad] = useState<SherpaLoadState>({
    phase: "idle", loaded: 0, total: 0, percent: 0,
  });

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
      setPartnerReconnecting(false);
      setShowFriendPrompt(true);
    },
    onPartnerDisconnected: () => {
      // Transient — the peer's socket dropped but they have 15s to rejoin.
      // Don't mark them as gone or pop the friend-request UI yet.
      setPartnerReconnecting(true);
    },
    onPartnerRejoined: () => {
      // The peer came back within the grace period. Clear the "disconnected"
      // banner and bump rejoinTick so the init effect rebuilds our PC. Also
      // reset roomReady so the initiator effect waits for the fresh room:ready
      // that follows this rejoin — otherwise it would fire before the new PC
      // has its mic track attached and send an audioless offer.
      setPartnerReconnecting(false);
      setPartnerLeft(false);
      setRoomReady(false);
      setRejoinTick((t) => t + 1);
    },
    onRoomError: () => {
      // Room was cleaned up before we could rejoin (e.g. grace period expired).
      // No point staying on the page — send them home.
      router.push("/");
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

  // Guard the init effect: only run once per rejoinTick value. Mount runs at
  // tick=0; onPartnerRejoined bumps the tick, which lets us re-init a fresh PC
  // without racing the old one.
  const initStartedRef = useRef<number>(-1);
  useEffect(() => {
    if (!socket.isConnected || !isLoaded) return;
    if (initStartedRef.current === rejoinTick) return;
    initStartedRef.current = rejoinTick;
    (async () => {
      try {
        await peer.initConnection(false);
        socket.joinRoom(roomId, userId);
      } catch { /* error surfaced via peer.error */ }
    })();
  }, [socket.isConnected, isLoaded, roomId, userId, peer.initConnection, socket.joinRoom, rejoinTick]);

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
    let anomalyReported = false;
    // Only log audio diagnostics when something is actually wrong; the every-
    // 3s heartbeat was drowning out the [asr]/[worker] logs we need.
    const diag = setInterval(() => {
      const t = tracks[0];
      const advancing = audio.currentTime > lastCT;
      const anomaly = audio.paused || audio.muted || audio.readyState < 3
        || t?.muted || !t?.enabled || t?.readyState !== "live" || !advancing;
      if (anomaly && !anomalyReported) {
        anomalyReported = true;
        console.warn("[audio] anomaly paused=", audio.paused, "muted=", audio.muted,
          "vol=", audio.volume, "currentTime=", audio.currentTime.toFixed(2),
          "advancing=", advancing, "readyState=", audio.readyState,
          "trackMuted=", t?.muted, "trackEnabled=", t?.enabled, "trackReadyState=", t?.readyState);
      } else if (!anomaly && anomalyReported) {
        anomalyReported = false;
        console.log("[audio] recovered");
      }
      lastCT = audio.currentTime;
    }, 3000);

    return () => {
      cancelled = true;
      cleanupListeners.forEach((fn) => fn());
      clearInterval(diag);
    };
  }, [peer.remoteAudioStream]);

  // --- AI Translation Pipeline ---

  // Track transformers.js model loading so we can show a hint instead of a
  // silent "translating..." while ~78MB downloads. Aggregates progress across
  // all pipeline files for the ACTIVE language pair(s).
  useEffect(() => {
    return onLoadingChange((s) => {
      const activePairs = Array.from(s.active);
      setModelLoading(activePairs.length > 0);

      // Aggregate loaded/total across all in-flight pairs.
      let loaded = 0;
      let total = 0;
      for (const p of activePairs) {
        const st = s.pairs[p];
        if (!st) continue;
        loaded += st.loaded;
        total += st.total;
      }
      // If nothing is active but a recently-loaded pair is present, use it for
      // the "done" flash (100%).
      if (total === 0 && Object.keys(s.pairs).length > 0) {
        for (const p of Object.values(s.pairs)) {
          loaded += p.loaded;
          total += p.total;
        }
      }
      setModelBytes({ loaded, total });
      setModelProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0);
    });
  }, []);

  // Preload translation model(s) as soon as subtitle is enabled OR the pair
  // changes. This is the biggest single win for perceived latency — the first
  // spoken sentence no longer waits on a cold-start download.
  useEffect(() => {
    if (!subtitleEnabled) return;
    if (sourceLang === targetLang) return;
    console.log('[room] preloadPair', sourceLang, '→', targetLang);
    setTranslateError(null);
    preloadPair(sourceLang, targetLang).catch((e) => {
      console.error('[room] preloadPair failed:', e);
      setTranslateError(`模型加载失败: ${e?.message || e}`);
    });
  }, [subtitleEnabled, sourceLang, targetLang]);

  // Kick off the sherpa-onnx WASM bundle download the moment subtitles are
  // enabled. It's ~209MB (wasm+data) and only downloads once — the browser
  // caches it via the /sherpa-asr/ immutable header — so front-loading here
  // means the mic → recognizer path in the effect below sees a hot module.
  useEffect(() => {
    if (!subtitleEnabled) return;
    console.log('[room] preloadSherpa');
    preloadSherpa().catch((e) => {
      console.error('[room] preloadSherpa failed:', e);
      setAsrError(`识别模型加载失败: ${e?.message || e}`);
    });
  }, [subtitleEnabled]);

  // Subscribe to sherpa download/init progress so we can show a real progress
  // bar in the subtitle panel instead of a mysterious "starting..." spinner
  // while ~209MB fetches.
  useEffect(() => onSherpaLoadChange(setSherpaLoad), []);

  // Send-side pipeline: mic → Web Speech (interim + final) → translate → peer.
  // ASR only depends on subtitleEnabled + peer connected + sourceLang.
  // targetLang changes must NOT rebuild the recognizer (would drop mid-sentence).
  const targetLangRef = useRef(targetLang);
  const sendTranslationRef = useRef(peer.sendTranslation);
  useEffect(() => { targetLangRef.current = targetLang; }, [targetLang]);
  useEffect(() => { sendTranslationRef.current = peer.sendTranslation; }, [peer.sendTranslation]);

  useEffect(() => {
    // Stop ASR whenever any of these is false: subtitle off, disconnected,
    // OR mic muted. Web Speech API opens its own mic stream separately from
    // WebRTC, so muting peer.audioTrack doesn't stop it — we must halt the
    // recognizer explicitly, otherwise "muted" partner still gets our captions.
    if (!subtitleEnabled || !peer.isConnected || !peer.isMicOn) {
      setMySourceText(null);
      setMyTranslatedText(null);
      setAsrError(null);
      setAsrStatus("idle");
      return;
    }
    setAsrError(null);
    setAsrStatus("starting");

    const stream = peer.localAudioStream;
    if (!stream) {
      setAsrError("麦克风流未就绪");
      return;
    }

    let cancelled = false;
    let inflightSeq = 0;

    const engine = createSherpaEngine(
      stream,
      sourceLang,
      (result) => {
        if (cancelled) return;
        const tgt = targetLangRef.current;

        // sherpa emits both interim (updating hypothesis) and final
        // (isEndpoint) segments. Show all as source text; only translate on
        // final.
        setMySourceText(result.text);
        sendTranslationRef.current({
          text: "",
          sourceText: result.text,
          sourceLang,
          targetLang: tgt,
          isFinal: !!result.isFinal,
        });

        if (!result.isFinal) return;

        if (sourceLang === tgt) {
          setMyTranslatedText(result.text);
          sendTranslationRef.current({
            text: result.text,
            sourceText: result.text,
            sourceLang,
            targetLang: tgt,
            isFinal: true,
          });
          return;
        }

        const seq = ++inflightSeq;
        setTranslating(true);
        console.log("[room] translateText call", sourceLang, "→", tgt, `"${result.text}"`);
        translateText(result.text, sourceLang, tgt)
          .then((tr) => {
            if (cancelled || seq !== inflightSeq) return;
            console.log("[room] translateText result:", tr.translatedText);
            setMyTranslatedText(tr.translatedText);
            setTranslating(false);
            setTranslateError(null);
            sendTranslationRef.current({
              text: tr.translatedText,
              sourceText: result.text,
              sourceLang,
              targetLang: tgt,
              isFinal: true,
            });
          })
          .catch((e) => {
            if (cancelled || seq !== inflightSeq) return;
            console.error("[room] translateText FAILED:", e);
            setTranslating(false);
            setTranslateError(`翻译失败: ${e?.message || e}`);
          });
      },
      (err) => { console.warn("[asr]", err); setAsrError(err); },
      (status) => {
        if (cancelled) return;
        console.log("[asr status]", status);
        setAsrStatus(status);
      },
    );

    engine.start().catch((e) => {
      if (cancelled) return;
      setAsrError(e?.message || String(e));
    });
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, [subtitleEnabled, peer.isConnected, peer.isMicOn, sourceLang, peer.localAudioStream]);

  // Receive peer translations via DataChannel (event-driven, not polled).
  useEffect(() => {
    if (!subtitleEnabled) {
      setPeerSourceText(null);
      setPeerTranslatedText(null);
      return;
    }
    return peer.onRemoteTranslation((msg) => {
      if (msg.sourceText) setPeerSourceText(msg.sourceText);
      if (msg.text) setPeerTranslatedText(msg.text);
    });
  }, [subtitleEnabled, peer.onRemoteTranslation]);

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <audio ref={audioRef} autoPlay playsInline hidden />
      <h1 className="text-xl font-bold tracking-tight">QVideoChat</h1>

      {partnerLeft && (
        <p className="rounded-lg bg-yellow-900/30 px-4 py-2 text-yellow-400 text-sm">对方已离开房间</p>
      )}
      {partnerReconnecting && !partnerLeft && (
        <p className="rounded-lg bg-blue-900/30 px-4 py-2 text-blue-400 text-sm">对方连接中断，等待重连...</p>
      )}
      {peer.error && (
        <p className="text-red-400 text-sm">{peer.error}</p>
      )}

      {topicText && <TopicCard text={topicText} category={topicCategory} />}

      {friendStatus === "received" && !partnerLeft && (
        <p className="rounded-lg bg-green-900/30 px-4 py-2 text-green-400 text-xs">{pname} 想加你为好友</p>
      )}

      <div className="flex flex-col md:flex-row items-center md:items-start gap-4 md:gap-6 w-full max-w-xl md:max-w-none px-2">
        {/* My avatar */}
        <div className="flex flex-col items-center gap-2 w-full max-w-[280px] md:w-72">
          {isCameraOn ? (
            <VrmAvatar blendshapeRef={blendshapeRef} size={260} />
          ) : (
            <div className="rounded-2xl bg-neutral-950 flex items-center justify-center" style={{ width: 260, height: 260 }}>
              <span className="text-neutral-600 text-5xl">📷</span>
            </div>
          )}
          <VoiceStatus stream={peer.localAudioStream} label={getSettings().showId ? `${uname} (你)` : "匿名用户"} />

          {/* My speech subtitle — always visible while subtitle is on, so
              users see status even before any recognition/translation happens. */}
          {subtitleEnabled && (
            <div className="w-full rounded-lg bg-black/50 border border-white/10 px-3 py-2 text-center min-h-[36px] max-h-24 overflow-y-auto">
              {mySourceText && (
                <p className="text-white/70 text-[11px] leading-snug break-words">{mySourceText}</p>
              )}
              {modelLoading && !myTranslatedText && (
                <div className="mt-1">
                  <p className="text-yellow-300/80 text-[10px] italic">
                    {modelProgress < 100
                      ? `首次加载翻译模型 ${modelProgress > 0 ? modelProgress + '%' : ''}`
                      : '初始化推理引擎...'}
                    {modelBytes.total > 0 && modelProgress < 100 && (
                      <span className="text-yellow-300/50 ml-1">
                        ({(modelBytes.loaded / 1_048_576).toFixed(1)} / {(modelBytes.total / 1_048_576).toFixed(0)} MB)
                      </span>
                    )}
                  </p>
                  <div className="mt-1 h-1 rounded-full bg-yellow-900/30 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-200 ${
                        modelProgress >= 100 ? 'bg-yellow-400/70 animate-pulse' : 'bg-yellow-400/70'
                      }`}
                      style={{ width: `${modelProgress}%` }}
                    />
                  </div>
                </div>
              )}
              {(sherpaLoad.phase === "downloading" || sherpaLoad.phase === "initializing") && (
                <div className="mt-1">
                  <p className="text-cyan-300/80 text-[10px] italic">
                    {sherpaLoad.phase === "initializing"
                      ? "初始化识别引擎..."
                      : `首次加载识别模型 ${sherpaLoad.percent > 0 ? sherpaLoad.percent + '%' : ''}`}
                    {sherpaLoad.total > 0 && sherpaLoad.phase === "downloading" && (
                      <span className="text-cyan-300/50 ml-1">
                        ({(sherpaLoad.loaded / 1_048_576).toFixed(1)} / {(sherpaLoad.total / 1_048_576).toFixed(0)} MB)
                      </span>
                    )}
                  </p>
                  <div className="mt-1 h-1 rounded-full bg-cyan-900/30 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-200 bg-cyan-400/70 ${
                        sherpaLoad.phase === "initializing" ? "animate-pulse" : ""
                      }`}
                      style={{ width: `${sherpaLoad.phase === "initializing" ? 100 : sherpaLoad.percent}%` }}
                    />
                  </div>
                </div>
              )}
              {translating && !modelLoading && !myTranslatedText && (
                <p className="text-white/30 text-[10px] italic">翻译中...</p>
              )}
              {translateError && (
                <p className="text-red-400 text-[10px] italic mt-1">{translateError}</p>
              )}
              {asrError && !modelLoading && (
                <p className="text-red-400 text-[10px] italic mt-1">语音识别: {asrError}</p>
              )}
              {!asrError && !mySourceText && sherpaLoad.phase === "ready" && (asrStatus === "starting" || asrStatus === "unavailable") && (
                <p className="text-yellow-300/70 text-[10px] italic mt-1">
                  {asrStatus === "starting" ? "正在启动语音识别..." : "该浏览器不支持语音识别"}
                </p>
              )}
              {!asrError && asrStatus === "speaking" && !mySourceText && (
                <p className="text-purple-300/70 text-[10px] italic mt-1">说话中...</p>
              )}
              {!asrError && asrStatus === "loading" && !mySourceText && (
                <p className="text-yellow-300/70 text-[10px] italic mt-1">首次加载识别模型，请稍候...</p>
              )}
              {!asrError && asrStatus === "transcribing" && !mySourceText && (
                <p className="text-white/40 text-[10px] italic mt-1">识别中...</p>
              )}
              {myTranslatedText && (
                <p className="text-green-400 text-[11px] leading-snug break-words">{myTranslatedText}</p>
              )}
              {!mySourceText && !myTranslatedText && !translating && !modelLoading && !translateError && !asrError && (
                !peer.isMicOn ? (
                  <div className="flex items-center justify-center gap-2 py-1">
                    <span className="text-2xl">🔇</span>
                    <span className="text-red-400 text-xs font-medium">麦克风已静音</span>
                  </div>
                ) : (
                  <p className="text-white/30 text-[10px] italic">开始说话...</p>
                )
              )}
            </div>
          )}
        </div>

        {/* Partner avatar */}
        <div className="flex flex-col items-center gap-2 w-full max-w-[280px] md:w-72">
          <VrmAvatar blendshapeRef={peer.remoteBlendshapeRef} size={260} muted={partnerLeft} />
          <VoiceStatus stream={peer.remoteAudioStream} label={`${pname} (对方)`} muted={partnerLeft} />

          {/* Partner speech subtitle */}
          {subtitleEnabled && (
            <div className="w-full rounded-lg bg-black/50 border border-white/10 px-3 py-2 text-center min-h-[36px] max-h-24 overflow-y-auto">
              {!peer.remoteMicOn ? (
                <div className="flex items-center justify-center gap-2 py-1">
                  <span className="text-2xl">🔇</span>
                  <span className="text-red-400 text-xs font-medium">对方已静音</span>
                </div>
              ) : (
                <>
                  {peerSourceText && (
                    <p className="text-white/70 text-[11px] leading-snug break-words">{peerSourceText}</p>
                  )}
                  {peerTranslatedText && (
                    <p className="text-green-400 text-[11px] leading-snug break-words">{peerTranslatedText}</p>
                  )}
                  {!peerSourceText && !peerTranslatedText && (
                    <p className="text-white/30 text-[10px] italic">等待对方发言...</p>
                  )}
                </>
              )}
            </div>
          )}
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
            }`}>
            📷
          </button>
          <button
            onClick={peer.toggleMic}
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition ${
              peer.isMicOn ? "bg-neutral-800 border border-neutral-600 text-neutral-300 hover:bg-neutral-700" : "bg-red-600/30 border border-red-700 text-red-400"
            }`}>
            🎙
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap justify-center">
        {peer.isConnected && (
          <LanguageSelector
            sourceLang={sourceLang}
            targetLang={targetLang}
            subtitleEnabled={subtitleEnabled}
            onSourceChange={handleSourceLangChange}
            onTargetChange={handleTargetLangChange}
            onSubtitleToggle={handleSubtitleToggle}
          />
        )}
      </div>

      {peer.isConnected && (
        <p className="text-xs text-green-400/60">语音已连接</p>
      )}

      {peer.isConnected && friendStatus === "none" && (
        <button onClick={handleAddFriend}
          className="rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white transition">
          + 添加好友
        </button>
      )}

      {peer.isConnected && friendStatus === "received" && (
        <button onClick={handleAcceptFriend}
          className="rounded-lg bg-green-700 px-4 py-1.5 text-xs text-white hover:bg-green-600">
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
            <button onClick={handleAddFriend} className="rounded-lg bg-white text-black px-3 py-1 text-xs font-medium hover:bg-neutral-200">
              加为好友
            </button>
          )}
          {friendStatus === "sent" && <span className="text-xs text-green-400">已发送</span>}
          {friendStatus === "friends" && <span className="text-xs text-green-400">已是好友</span>}
        </div>
      )}

      <div className="flex gap-4 mt-2">
        <button onClick={handleHangup}
          className="rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-red-600 hover:text-red-400 transition">
          挂断
        </button>
        <button onClick={handleNext}
          className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-neutral-200 transition">
          下一个
        </button>
        {!reported && (
          <button onClick={() => { reportUser(puid, roomId, ""); setReported(true); }}
            className="text-[10px] text-red-600 hover:text-red-400 underline underline-offset-2">
            举报
          </button>
        )}
        {reported && <span className="text-[10px] text-neutral-600">已举报</span>}
      </div>

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </main>
  );
}
