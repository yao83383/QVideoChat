"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import VrmAvatar, { type AvatarConfig } from "@/components/VrmAvatar";
import VoiceStatus from "@/components/VoiceStatus";
import LoginPrompt from "@/components/LoginPrompt";
import TopicCard from "@/components/TopicCard";
import EmoteBar from "@/components/EmoteBar";
import FloatingEmoteLayer, { useFloatingEmotes, emojiForKey } from "@/components/FloatingEmoteLayer";
import RecapCard, { type RecapState } from "@/components/RecapCard";
import ReportModal, { REPORT_CATEGORIES, type ReportCategory } from "@/components/ReportModal";
import PIPWindow from "@/components/PIPWindow";
import CallToolbar from "@/components/CallToolbar";
import SubtitleOverlay from "@/components/SubtitleOverlay";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";
import { isBlocked, blockUser, bumpBlocklistHit } from "@/lib/blocklist";
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

  // Only the user's own identity is fixed for the life of the session; the
  // room and partner change every time we match a new peer via the in-room
  // "下一个" flow. Keep those as state, initialized from URL for the first
  // match that brought us here.
  const userId = sp.get("uid") || "";
  const uname = sp.get("uname") || "我";
  const isRegistered = sp.get("reg") === "1";
  const [roomId, setRoomId] = useState(sp.get("id") || "");
  const [puid, setPuid] = useState(sp.get("puid") || "");
  const [pname, setPname] = useState(sp.get("pname") || "对方");
  const isInitiator = userId < puid;

  // `searching` covers both "arrived without a partner" and "user clicked
  // 下一个 to re-queue" — the partner window shows a placeholder either way.
  const [searching, setSearching] = useState(!sp.get("id"));

  const [partnerLeft, setPartnerLeft] = useState(false);
  const [partnerReconnecting, setPartnerReconnecting] = useState(false);
  const [rejoinTick, setRejoinTick] = useState(0);
  const [roomReady, setRoomReady] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "received" | "friends">("none");
  const [showFriendPrompt, setShowFriendPrompt] = useState(false);
  const [reported, setReported] = useState(false);
  const [showReport, setShowReport] = useState(false);
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
  // 翻译独立开关(用户 2026-07-22 明确):字幕控制显不显示原文,
  // 翻译控制翻不翻译并显示译文.两者独立.历史上 subtitleEnabled 同时
  // 承载两件事,现在 translateEnabled 拆出来;translateText 的实际
  // 触发条件在 pipeline 中改为 (subtitleEnabled || translateEnabled)
  // AND translateEnabled.
  const [translateEnabled, setTranslateEnabled] = useState(false);
  // 主从互换 —— 单击 PIP 切换.默认 false = 大对方 / 小自己(微信风格).
  const [swapped, setSwapped] = useState(false);
  // 自己视图镜像开关.PIP 里镜像通常更自然(像照镜子),用户可在
  // 更多菜单里 toggle.
  const [selfMirrored, setSelfMirrored] = useState(true);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
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

  const { blendshapeRef, poseRef, isLoaded, isCameraOn, error: camError, step: camStep, faceFound, start, stop, toggleCamera } = useFaceMesh();
  const { selectedEntry } = useSelectedAvatar();
  useEffect(() => { start(); return () => stop(); }, []);
  const cameraEverLoaded = useRef(false);
  useEffect(() => { if (isLoaded) cameraEverLoaded.current = true; }, [isLoaded]);

  // Local avatar config (zoom + dolly gain) that VrmAvatar reports whenever
  // the user clicks the on-screen controls. Broadcast on every DC frame so
  // the peer's render of us honors OUR framing, not theirs.
  const myAvatarConfigRef = useRef<AvatarConfig | null>(null);
  const handleMyConfigChange = useCallback((cfg: AvatarConfig) => {
    myAvatarConfigRef.current = cfg;
  }, []);

  // Mirror the current selected VRM path into a ref so usePeer's fixed-rate
  // send interval always reads the latest value without needing to re-run.
  const myVrmPathRef = useRef<string | null>(null);
  useEffect(() => {
    myVrmPathRef.current = selectedEntry.vrmPath;
  }, [selectedEntry.vrmPath]);

  const onOfferRef = useRef<(sdp: RTCSessionDescriptionInit) => void>(undefined);
  const onAnswerRef = useRef<(sdp: RTCSessionDescriptionInit) => void>(undefined);
  const onIceRef = useRef<(candidate: RTCIceCandidateInit) => void>(undefined);

  const signalEvents: SignalEvents = useMemo(() => ({
    onOffer: (data) => onOfferRef.current?.(data.sdp),
    onAnswer: (data) => onAnswerRef.current?.(data.sdp),
    onIce: (data) => onIceRef.current?.(data.candidate),
  }), []);

  const matchEvents: MatchEvents = useMemo(() => ({
    onWaiting: () => {
      // Server acknowledged our re-queue — stay in "searching" state until
      // match:found arrives (or the user leaves).
      setSearching(true);
    },
    onFound: (data) => {
      // A new match arrived while we're sitting in the room. Swap in the new
      // partner and let the peer-init effect rebuild the PC on the next tick.
      setRoomId(data.roomId);
      setPuid(data.partner.userId);
      setPname(data.partner.username);
      setSearching(false);
      setPartnerLeft(false);
      setPartnerReconnecting(false);
      setRoomReady(false);
      setFriendStatus("none");
      setShowFriendPrompt(false);
      setTopicText("");
      setRejoinTick((t) => t + 1);
    },
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

  const peer = usePeer(blendshapeRef, signaling, poseRef, myAvatarConfigRef, myVrmPathRef);

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
    if (!roomId) return;  // in-room search state: no partner yet, don't init.
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

  // If we landed here without a partner (i.e. straight from the "开始匹配"
  // button on the home page), auto-queue ourselves as soon as the socket is
  // ready. Only fires ONCE per page load — re-matches via handleNext do their
  // own joinMatch call.
  const autoQueuedRef = useRef(false);
  useEffect(() => {
    // Direct-typed /room URL with no identity → bounce back to home so the
    // user can enter a name and start matching properly.
    if (!userId || !uname) {
      router.replace("/");
      return;
    }
    if (autoQueuedRef.current) return;
    if (!socket.isConnected) return;
    if (roomId) return;  // arrived with a partner, no need to queue.
    autoQueuedRef.current = true;
    let tags: string[] = [];
    try {
      tags = JSON.parse(localStorage.getItem("qv_pendingTags") || "[]");
      if (!Array.isArray(tags)) tags = [];
    } catch { /* ignore */ }
    setSearching(true);
    socket.joinMatch(userId, uname, tags, sourceLang, targetLang);
  }, [socket.isConnected, socket.joinMatch, roomId, userId, uname, router, sourceLang, targetLang]);

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

  // Preload translation model(s) as soon as translation is enabled OR the pair
  // changes. This is the biggest single win for perceived latency — the first
  // spoken sentence no longer waits on a cold-start download.
  useEffect(() => {
    if (!translateEnabled) return;
    if (sourceLang === targetLang) return;
    console.log('[room] preloadPair', sourceLang, '→', targetLang);
    setTranslateError(null);
    preloadPair(sourceLang, targetLang).catch((e) => {
      console.error('[room] preloadPair failed:', e);
      setTranslateError(`模型加载失败: ${e?.message || e}`);
    });
  }, [translateEnabled, sourceLang, targetLang]);

  // Kick off the sherpa-onnx WASM bundle download the moment ASR is
  // wanted (subtitle OR translate). ~209MB, browser-cached; front-loading
  // means the mic → recognizer path in the effect below sees a hot module.
  const asrWanted = subtitleEnabled || translateEnabled;
  useEffect(() => {
    if (!asrWanted) return;
    console.log('[room] preloadSherpa');
    preloadSherpa().catch((e) => {
      console.error('[room] preloadSherpa failed:', e);
      setAsrError(`识别模型加载失败: ${e?.message || e}`);
    });
  }, [asrWanted]);

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
    // 启动 ASR 的条件:字幕 OR 翻译 至少开一个,且通话已连接、麦克风开.
    // ASR 是本地 sherpa,不占 server;两按钮任一 on 就跑,off 全关.
    // (下一步块 C 会改成"ASR 常跑 for report 缓冲,按钮只控显示")
    if (!asrWanted || !peer.isConnected || !peer.isMicOn) {
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
        // (isEndpoint) segments. Show all as source text.
        setMySourceText(result.text);
        sendTranslationRef.current({
          text: "",
          sourceText: result.text,
          sourceLang,
          targetLang: tgt,
          isFinal: !!result.isFinal,
        });

        if (!result.isFinal) return;

        // 翻译分支:只在 translateEnabled 时才跑.字幕开+翻译关 → 只显示原文,不请求翻译.
        if (!translateEnabled) return;

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
  }, [asrWanted, translateEnabled, peer.isConnected, peer.isMicOn, sourceLang, peer.localAudioStream]);

  // Receive peer translations via DataChannel (event-driven, not polled).
  // 两按钮任一打开时都需要收 —— 字幕收原文,翻译收译文,组件层做过滤.
  useEffect(() => {
    if (!subtitleEnabled && !translateEnabled) {
      setPeerSourceText(null);
      setPeerTranslatedText(null);
      return;
    }
    return peer.onRemoteTranslation((msg) => {
      if (msg.sourceText) setPeerSourceText(msg.sourceText);
      if (msg.text) setPeerTranslatedText(msg.text);
    });
  }, [subtitleEnabled, translateEnabled, peer.onRemoteTranslation]);

  // --- Emote ---
  //
  // FloatingEmoteLayer owns the DOM overlay + auto-cleanup of expired emotes;
  // this hook exposes the list + a spawn fn. We subscribe to remote emotes so
  // the peer's tap appears on our screen too. Send/receive counters go to
  // localStorage as a foundation for future "热门 emoji" analytics — a real
  // upload path can pick them up later.
  const { emotes, spawn: spawnEmote } = useFloatingEmotes();

  useEffect(() => {
    return peer.onRemoteEmote((key) => {
      spawnEmote(emojiForKey(key));
      try {
        const storageKey = `qv_emote_recv_${key}`;
        const n = parseInt(localStorage.getItem(storageKey) || "0", 10) + 1;
        localStorage.setItem(storageKey, String(n));
      } catch { /* ignore */ }
    });
  }, [peer.onRemoteEmote, spawnEmote]);

  const handleEmoteSend = (key: string) => {
    spawnEmote(emojiForKey(key));
    peer.sendEmote(key);
    try {
      const storageKey = `qv_emote_sent_${key}`;
      const n = parseInt(localStorage.getItem(storageKey) || "0", 10) + 1;
      localStorage.setItem(storageKey, String(n));
    } catch { /* ignore */ }
  };

  // --- Recap card ---
  //
  // Snapshots the partner + friend state at the moment the user taps 下一个 so
  // the card can outlive the state reset that immediately follows. Rating and
  // add-friend actions from the card write local counters; those are the
  // foundation for a future "recommendation" pass and for judging whether
  // 下一个 without rating is common (i.e. is the card in the way?).
  const [recap, setRecap] = useState<RecapState | null>(null);

  const handleRecapRate = (score: 1 | 2 | 3) => {
    try {
      const key = `qv_rating_${score}`;
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    setRecap(null);
  };

  const handleRecapAddFriend = () => {
    if (!recap) return;
    if (!isRegistered) { setShowLoginModal(true); return; }
    socket.sendFriendRequest(userId, uname, recap.puid);
    setRecap({ ...recap, addFriendSent: true });
    try {
      const key = "qv_addfriend_from_recap";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
  };

  const handleRecapAcceptFriend = () => {
    if (!recap) return;
    if (!isRegistered) { setShowLoginModal(true); return; }
    socket.sendFriendAccept(recap.puid, userId);
    setRecap({ ...recap, friendAccepted: true });
  };

  const handleRecapDismiss = () => {
    // Auto-dismiss without a rating counts as "skipped" — tracked so we can
    // decide later if the card is intrusive vs useful.
    try {
      const key = "qv_rating_skipped";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    setRecap(null);
  };

  // --- Handlers ---

  const handleSourceLangChange = (lang: string) => { setSourceLang(lang); savePref("qv_sl", lang); };
  const handleTargetLangChange = (lang: string) => { setTargetLang(lang); savePref("qv_tl", lang); };

  const handleSubtitleToggle = () => setSubtitleEnabled((v) => !v);

  const handleHangup = () => {
    if (roomId) socket.leaveRoom(roomId);
    peer.disconnect();
    router.push("/");
  };

  const handleNext = () => {
    // Snapshot the current partner + friend state so the recap card can render
    // it even after the state reset below. Only meaningful when we actually
    // had a partner — skip for the "no match yet" case.
    if (puid && pname) {
      setRecap({
        puid,
        pname,
        friendStatus,
        addFriendSent: false,
        friendAccepted: false,
      });
    }
    // Leave current room, wipe partner state, and queue up for a new match
    // WITHOUT navigating away. The onFound handler in matchEvents will fill
    // the partner slot back in once the server matches us.
    if (roomId) socket.leaveRoom(roomId);
    peer.disconnect();
    setRoomId("");
    setPuid("");
    setPname("对方");
    setPartnerLeft(false);
    setPartnerReconnecting(false);
    setRoomReady(false);
    setFriendStatus("none");
    setShowFriendPrompt(false);
    setTopicText("");
    setSearching(true);
    let tags: string[] = [];
    try {
      tags = JSON.parse(localStorage.getItem("qv_pendingTags") || "[]");
      if (!Array.isArray(tags)) tags = [];
    } catch { /* ignore */ }
    socket.joinMatch(userId, uname, tags, sourceLang, targetLang);
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

  // Categorized report submit. Piggybacks the existing reportUser API — the
  // server just gets a labeled string in the reason slot now — and auto-adds
  // the partner to the local blocklist so the next-match handler skips them.
  const handleReportSubmit = (categoryKey: ReportCategory, freeText: string) => {
    const label = REPORT_CATEGORIES.find((c) => c.key === categoryKey)?.label ?? categoryKey;
    const reason = categoryKey === "other" ? `${label}: ${freeText}` : label;
    reportUser(puid, roomId, reason);
    if (puid) blockUser(puid);
    setReported(true);
    setShowReport(false);
    try {
      const k = `qv_report_${categoryKey}`;
      localStorage.setItem(k, String(parseInt(localStorage.getItem(k) || "0", 10) + 1));
    } catch { /* ignore */ }
  };

  // Auto-skip blocked partners. Fires whenever a new partner id lands
  // (via match:found → setPuid). If the id is on our local block list we
  // synthesise the same reset+requeue handleNext would do, without ever
  // showing the partner's avatar or waking the WebRTC handshake.
  useEffect(() => {
    if (!puid) return;
    if (!isBlocked(puid)) return;
    bumpBlocklistHit();
    if (roomId) socket.leaveRoom(roomId);
    peer.disconnect();
    setRoomId("");
    setPuid("");
    setPname("对方");
    setPartnerLeft(false);
    setPartnerReconnecting(false);
    setRoomReady(false);
    setFriendStatus("none");
    setShowFriendPrompt(false);
    setTopicText("");
    setSearching(true);
    let tags: string[] = [];
    try {
      tags = JSON.parse(localStorage.getItem("qv_pendingTags") || "[]");
      if (!Array.isArray(tags)) tags = [];
    } catch { /* ignore */ }
    socket.joinMatch(userId, uname, tags, sourceLang, targetLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puid]);

  // Camera-init gate: only spin here while the tracker is genuinely working.
  // Denying camera used to leave users stuck on this spinner forever because
  // useFaceMesh sets error but never flips isLoaded — after wiring the "match
  // without camera" flow (v1.3.0.017), a camError explicitly falls through to
  // the main room render so a camera-less user can still talk over voice.
  if (!isLoaded && !cameraEverLoaded.current && !camError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
        <p className="text-slate-600 text-sm">初始化摄像头...</p>
        {camStep && <p className="text-amber-600 text-xs">阶段: {camStep}</p>}
      </main>
    );
  }

  // 主视图 / PIP 视图的两个渲染函数.数据源不变;唯一区别是 size + mirror.
  // swapped=false 默认:主 = 对方,PIP = 自己(微信风格).
  const renderSelf = (size: number) => {
    if (!isCameraOn) {
      return (
        <div
          className="w-full h-full flex items-center justify-center bg-slate-800"
          style={{ minWidth: size, minHeight: size }}
        >
          <span className="text-white/40 text-4xl">📷</span>
        </div>
      );
    }
    return (
      <VrmAvatar
        blendshapeRef={blendshapeRef}
        poseRef={poseRef}
        size={size}
        vrmPath={selectedEntry.vrmPath}
        placeholderEmoji={selectedEntry.emoji}
        placeholderTint={selectedEntry.tint}
        mirror={selfMirrored}
        onConfigChange={handleMyConfigChange}
      />
    );
  };
  const renderPeer = (size: number) => {
    if (searching || !roomId) {
      return (
        <div
          className="w-full h-full flex flex-col items-center justify-center gap-3 bg-slate-900"
          style={{ minWidth: size, minHeight: size }}
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <span className="text-white/60 text-xs">等待接入</span>
        </div>
      );
    }
    return (
      <VrmAvatar
        blendshapeRef={peer.remoteBlendshapeRef}
        poseRef={peer.remotePoseRef}
        externalConfigRef={peer.remoteAvatarConfigRef}
        vrmPath={peer.remoteVrmPath ?? undefined}
        size={size}
        muted={partnerLeft}
      />
    );
  };

  // 主区大小 —— 撑满视口(减去 tab 栏和顶栏).对于 3D 化身 260 足够;
  // 后期换真视频流时改成 100% 容器即可.PIP 固定 112×160 也够表意.
  const MAIN_SIZE = 320;
  const PIP_W = 112;
  const PIP_H = 160;

  // "主"和"小窗"里装谁 —— swapped 是 UI 状态,数据源不变.
  const MainView = swapped ? renderSelf : renderPeer;
  const PipView = swapped ? renderPeer : renderSelf;
  const pipIsSelf = !swapped;

  return (
    <main className="relative min-h-screen bg-slate-950 text-white overflow-hidden">
      <audio ref={audioRef} autoPlay playsInline hidden />

      {/* 顶部状态条 —— 全部合并到一个 sticky 半透明栏,和视频画面不打架 */}
      <header
        className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0) + 0.75rem)" }}
      >
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className={`w-2 h-2 rounded-full ${peer.isConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
          <span className="text-xs text-white/80 font-medium">
            {peer.isConnecting ? "连接中..."
              : peer.isConnected ? (getSettings().showId ? pname : "匿名用户")
              : searching ? "寻找中..."
              : roomReady ? "建立连接..."
              : partnerReconnecting ? "对方重连中..."
              : partnerLeft ? "对方已离开"
              : "等待对方加入..."}
          </span>
        </div>
        {friendStatus === "friends" && (
          <span className="pointer-events-auto text-xs text-emerald-300/90">已是好友</span>
        )}
      </header>

      {/* 主视频区 —— 撑满,居中放化身/视频 */}
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="rounded-3xl overflow-hidden bg-slate-900 shadow-2xl"
          style={{ width: MAIN_SIZE, height: MAIN_SIZE }}
        >
          {MainView(MAIN_SIZE)}
        </div>
      </div>

      {/* PIP 小窗 —— 单击互换,拖拽换角,长按隐藏 */}
      <PIPWindow
        onSwap={() => setSwapped((v) => !v)}
        width={PIP_W}
        height={PIP_H}
      >
        <div className="relative w-full h-full">
          {PipView(PIP_H)}
          {/* 镜像按钮只在 PIP 装的是自己时显示 */}
          {pipIsSelf && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelfMirrored((v) => !v);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 hover:bg-black/70 text-white text-xs flex items-center justify-center backdrop-blur-sm z-10"
              aria-label={selfMirrored ? "关闭镜像" : "开启镜像"}
              title={selfMirrored ? "关闭镜像" : "开启镜像"}
            >
              ⇋
            </button>
          )}
        </div>
      </PIPWindow>

      {/* 底端字幕 */}
      <SubtitleOverlay
        subtitleOn={subtitleEnabled}
        translateOn={translateEnabled}
        mySource={mySourceText}
        myTranslated={myTranslatedText}
        peerSource={peerSourceText}
        peerTranslated={peerTranslatedText}
        myName={getSettings().showId ? uname : "我"}
        peerName={pname}
      />

      {/* 底部工具栏 */}
      <CallToolbar
        micOn={peer.isMicOn}
        subtitleOn={subtitleEnabled}
        translateOn={translateEnabled}
        connected={peer.isConnected}
        onToggleMic={peer.toggleMic}
        onToggleSubtitle={() => setSubtitleEnabled((v) => !v)}
        onToggleTranslate={() => setTranslateEnabled((v) => !v)}
        onMore={() => setShowMoreMenu(true)}
        onHangup={handleHangup}
      />

      {/* 更多菜单 —— emote / 加好友 / 下一个 / 举报 / 摄像头切换 */}
      {showMoreMenu && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowMoreMenu(false)}
        >
          <div
            className="w-full max-w-md bg-slate-900 border-t border-white/10 rounded-t-3xl p-5 pb-8 flex flex-col gap-4 text-white"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 2rem)" }}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto" />
            {peer.isConnected && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-white/40 uppercase tracking-wider">表情反应</p>
                <EmoteBar onSend={(k) => { handleEmoteSend(k); }} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <MoreItem
                icon="📷"
                label={isCameraOn ? "关摄像头" : "开摄像头"}
                onClick={() => { toggleCamera(); setShowMoreMenu(false); }}
              />
              {peer.isConnected && friendStatus === "none" && (
                <MoreItem
                  icon="➕"
                  label="加好友"
                  onClick={() => { handleAddFriend(); setShowMoreMenu(false); }}
                />
              )}
              {peer.isConnected && friendStatus === "received" && (
                <MoreItem
                  icon="✅"
                  label="接受好友"
                  onClick={() => { handleAcceptFriend(); setShowMoreMenu(false); }}
                />
              )}
              {peer.isConnected && (
                <MoreItem
                  icon="⏭️"
                  label={searching ? "寻找中..." : "下一个"}
                  disabled={searching}
                  onClick={() => { handleNext(); setShowMoreMenu(false); }}
                />
              )}
              {!reported && (
                <MoreItem
                  icon="🚨"
                  label="举报"
                  danger
                  onClick={() => { setShowMoreMenu(false); setShowReport(true); }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 顶部 toast:话题 / 好友请求 / 错误 —— 一次性,不常驻 */}
      {topicText && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-30 max-w-md w-[calc(100%-2rem)] pointer-events-auto">
          <TopicCard text={topicText} category={topicCategory} />
        </div>
      )}
      {friendStatus === "received" && !partnerLeft && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 rounded-full bg-emerald-500/90 text-white text-xs px-4 py-1.5 shadow-lg backdrop-blur-sm">
          {pname} 想加你为好友
        </div>
      )}
      {peer.error && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 max-w-md w-[calc(100%-2rem)] rounded-2xl bg-rose-500/90 text-white text-xs px-4 py-3 shadow-lg backdrop-blur-sm">
          {peer.error.includes("Permission denied") || peer.error.includes("NotAllowedError")
            ? "🎤 麦克风权限被拒绝 · 请在浏览器地址栏 🔒 图标里授权后刷新页面"
            : peer.error}
        </div>
      )}
      {reported && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 rounded-full bg-slate-800/90 text-white/80 text-xs px-4 py-1.5 shadow-lg backdrop-blur-sm">
          已举报,已加入黑名单
        </div>
      )}

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <FloatingEmoteLayer emotes={emotes} />
      {recap && (
        <RecapCard
          recap={recap}
          onRate={handleRecapRate}
          onAddFriend={handleRecapAddFriend}
          onAcceptFriend={handleRecapAcceptFriend}
          onDismiss={handleRecapDismiss}
        />
      )}
      {showReport && (
        <ReportModal
          partnerName={pname || "对方"}
          onSubmit={handleReportSubmit}
          onDismiss={() => setShowReport(false)}
        />
      )}
    </main>
  );
}

/** 更多菜单里的一个 grid 项. */
function MoreItem({
  icon, label, onClick, disabled, danger,
}: {
  icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  const tone = disabled
    ? "bg-white/5 text-white/30 cursor-not-allowed"
    : danger
    ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border border-rose-500/40"
    : "bg-white/10 hover:bg-white/20 text-white border border-white/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-sm font-medium transition ${tone}`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
