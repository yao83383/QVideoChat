"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import MatchButton from "@/components/MatchButton";
import VrmAvatar from "@/components/VrmAvatar";
import FriendList from "@/components/FriendList";
import LoginPrompt from "@/components/LoginPrompt";
import SettingsModal from "@/components/SettingsModal";
import ProfileModal from "@/components/ProfileModal";
import OnboardingWizard from "@/components/OnboardingWizard";
import CommunityGuidelinesModal, { needsCommunityGate } from "@/components/CommunityGuidelinesModal";
import NoCameraMatchNotice from "@/components/NoCameraMatchNotice";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSocket } from "@/hooks/useSocket";
import { useUser } from "@/hooks/useUser";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";
import { useGuestName } from "@/hooks/useGuestName";
import { AVATARS, DEFAULT_AVATAR_ID } from "@/lib/avatars";
import { preloadSherpa } from "@/lib/ai/sherpa-engine";
import { preloadPair } from "@/lib/ai/translate";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

// Rotating showcase for the "换个化身试试" banner. Pulled from AVATARS at
// module init so the copy can never drift out of sync with the actual roster.
const FEATURED_BANNER_NAMES = AVATARS
  .filter((a) => a.id !== DEFAULT_AVATAR_ID)
  .slice(0, 3)
  .map((a) => a.name)
  .join(" · ");

const LANG_LABEL: Record<string, string> = {
  zh: "中文", en: "英文", ja: "日文", ko: "韩文",
};

function readLangPref(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export default function Home() {
  const router = useRouter();
  const { user, loading: userLoading, createUser } = useUser();
  const { guestName, regenerate: regenerateGuestName } = useGuestName();
  const [matchStatus, setMatchStatus] = useState<"idle" | "matching">("idle");
  const [showFriends, setShowFriends] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [friendRequest, setFriendRequest] = useState<{ fromUserId: string; fromUsername: string } | null>(null);
  const [banMsg, setBanMsg] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showNoCameraNotice, setShowNoCameraNotice] = useState(false);

  // The "identity" the user will match under: registered username wins, else
  // the auto-generated guest name (see memory:oc-platform-vision — every
  // anon is a "未知'原创'角色N"). Refs keep the value fresh for callbacks
  // that were memoized before the hook resolved.
  const activeName = user?.username?.trim() || guestName;
  const activeNameRef = useRef(activeName);
  activeNameRef.current = activeName;

  // Language pair — pulled at mount + refreshed when ProfileModal closes so
  // the chip label stays honest. Persisted by LangFilterBar to qv_sl/qv_tl.
  const [langs, setLangs] = useState<{ sl: string; tl: string }>(() => ({
    sl: readLangPref("qv_sl", "zh"),
    tl: readLangPref("qv_tl", "en"),
  }));
  const refreshLangsFromStorage = () =>
    setLangs({
      sl: readLangPref("qv_sl", "zh"),
      tl: readLangPref("qv_tl", "en"),
    });

  // Pick avatar hero size once at mount from viewport width so mobile / desktop
  // both fit without re-measuring on resize (VrmAvatar's WebGL effect keys on
  // `size`, so changing it would dispose+reload the ~25MB VRM).
  const [avatarSize] = useState(() => {
    if (typeof window === "undefined") return 320;
    return Math.min(window.innerWidth - 32, 360);
  });

  // Restore previously-saved tags so the chip shows accurate counts even before
  // the user opens ProfileModal. Same key ProfileModal + RoomClient read.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("qv_pendingTags");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setSelectedTags(parsed);
    } catch { /* ignore */ }
  }, []);

  const matchEvents: MatchEvents = useMemo(
    () => ({
      onWaiting: () => setMatchStatus("matching"),
      onFound: (data) => {
        const params = new URLSearchParams({
          id: data.roomId,
          uid: user?.userId || "",
          uname: activeNameRef.current,
          puid: data.partner.userId,
          pname: data.partner.username,
          reg: user?.isRegistered ? "1" : "0",
        });
        router.push(`/room?${params.toString()}`);
      },
      onPartnerLeft: () => {},
      onReady: () => {},
      onFriendRequest: (data) => setFriendRequest(data),
      onFriendAccepted: () => {},
      onSessionKick: () => {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        window.location.reload();
      },
    }),
    [user?.userId, router, user?.isRegistered],
  );

  const signalEvents: SignalEvents = useMemo(
    () => ({
      onOffer: () => {},
      onAnswer: () => {},
      onIce: () => {},
    }),
    [],
  );

  const { isConnected, joinMatch: _joinMatch, cancelMatch, socketRef } = useSocket(matchEvents, signalEvents);
  void _joinMatch;
  const { blendshapeRef, poseRef, isLoaded, isCameraOn, error, step, faceFound, start, stop, toggleCamera } = useFaceMesh();
  const { selectedEntry } = useSelectedAvatar();

  useEffect(() => () => stop(), [stop]);

  // Community-gate takes precedence over onboarding. Both are per-browser
  // localStorage gates, resolved after the first client-side effect so SSR
  // and initial paint agree (`null` until then).
  const [showCommunityGate, setShowCommunityGate] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowCommunityGate(needsCommunityGate());
  }, []);

  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowOnboarding(localStorage.getItem("qv_onboarded") !== "1");
  }, []);

  const [showAvatarBanner, setShowAvatarBanner] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowAvatarBanner(localStorage.getItem("qv_avatar_banner_hidden") !== "1");
  }, []);

  const dismissAvatarBanner = () => {
    try {
      localStorage.setItem("qv_avatar_banner_hidden", "1");
      const key = "qv_avatar_banner_dismiss";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    setShowAvatarBanner(false);
  };

  const openAvatarPage = () => {
    try {
      const key = "qv_avatar_banner_click";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    router.push("/avatars");
  };

  const openAvatarFromHero = () => {
    try {
      const key = "qv_avatar_hero_click";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    router.push("/avatars");
  };

  const completeOnboarding = () => {
    try {
      localStorage.setItem("qv_onboarded", "1");
      localStorage.setItem("qv_onboarded_at", String(Date.now()));
    } catch { /* ignore */ }
    setShowOnboarding(false);
  };

  const autoStartTriedRef = useRef(false);
  useEffect(() => {
    if (autoStartTriedRef.current) return;
    if (typeof window === "undefined") return;
    autoStartTriedRef.current = true;
    const onboarded = localStorage.getItem("qv_onboarded") === "1";
    if (onboarded) {
      start();
    }
  }, [start]);

  // Bridge blendshape / pose frames to the Electron pet window at ~30fps.
  useEffect(() => {
    if (typeof window === "undefined" || !window.qvHost) return;
    const host = window.qvHost;
    const iv = setInterval(() => {
      const bs = blendshapeRef.current;
      if (bs) host.pushBlendshape(bs);
      const ps = poseRef.current;
      if (ps) host.pushPose(ps);
    }, 33);
    return () => clearInterval(iv);
  }, [blendshapeRef, poseRef]);

  // Warm up ASR + translation pipelines. See historical notes on serial
  // ordering (sherpa first, then transformers.js) preserved from v1.2.2.007.
  const preloadedRef = useRef(false);
  useEffect(() => {
    if (preloadedRef.current) return;
    preloadedRef.current = true;
    (async () => {
      try {
        await preloadSherpa();
      } catch (e) {
        console.warn("[home] preloadSherpa failed:", e);
        return;
      }
      if (langs.sl !== langs.tl) {
        try { await preloadPair(langs.sl, langs.tl); }
        catch (e) { console.warn("[home] preloadPair failed:", e); }
      }
    })();
  }, [langs.sl, langs.tl]);

  const runMatch = async () => {
    if (!isConnected) return;
    const name = activeName;
    if (!name) return;
    let uid = user?.userId;
    if (!uid || !user?.token) {
      try {
        const newUser = await createUser(name);
        uid = newUser.userId;
      } catch (e: any) {
        setBanMsg(e?.message || "无法连接服务器");
        return;
      }
    }
    setBanMsg("");
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    ac.resume();
    try {
      localStorage.setItem("qv_pendingTags", JSON.stringify(selectedTags));
    } catch { /* ignore */ }
    const params = new URLSearchParams({
      uid,
      uname: name,
      reg: user?.isRegistered ? "1" : "0",
    });
    router.push(`/room?${params.toString()}`);
  };

  const handleMatch = () => {
    if (!isConnected) return;
    if (!activeName) return;
    if (!isCameraOn) {
      let acked = false;
      try { acked = sessionStorage.getItem("qv_no_camera_ack") === "1"; } catch { /* ignore */ }
      if (!acked) {
        setShowNoCameraNotice(true);
        return;
      }
    }
    runMatch();
  };

  const handleNoCameraProceed = () => {
    try {
      sessionStorage.setItem("qv_no_camera_ack", "1");
      const key = "qv_no_camera_proceed";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    setShowNoCameraNotice(false);
    runMatch();
  };

  const handleNoCameraCancel = () => {
    try {
      const key = "qv_no_camera_cancel";
      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
      localStorage.setItem(key, String(n));
    } catch { /* ignore */ }
    setShowNoCameraNotice(false);
  };

  if (userLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center px-4 pt-6 pb-8 gap-5">
      {/* Top-right nav — settings, profile (opens modal), friends, login */}
      <div className="absolute top-4 right-4 flex gap-2 items-center">
        <span
          className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
          title={isConnected ? "已连接服务器" : "未连接服务器"}
        />
        <MatchButton label="⚙" variant="secondary" onClick={() => setShowSettings(true)} />
        <MatchButton label="我" variant="secondary" onClick={() => setShowProfile(true)} />
        {user?.isRegistered ? (
          <>
            <MatchButton label="好友" variant="secondary" onClick={() => setShowFriends(true)} />
            <MatchButton label="个人页" variant="secondary" onClick={() => router.push("/profile")} />
          </>
        ) : (
          <MatchButton label="登录/注册" variant="secondary" onClick={() => router.push("/login")} />
        )}
      </div>

      {friendRequest && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md border border-sky-200 rounded-xl px-4 py-3 shadow-lg shadow-sky-500/10 flex items-center gap-3">
          <span className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{friendRequest.fromUsername}</span> 请求加你为好友
          </span>
          <button
            className="rounded-lg bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-3 py-1 text-xs font-medium shadow shadow-sky-500/30"
            onClick={() => {
              if (!user?.isRegistered) { setShowLoginModal(true); return; }
              socketRef.current?.emit("friend:accept", {
                fromUserId: friendRequest.fromUserId,
                toUserId: user?.userId || "",
              });
              setFriendRequest(null);
            }}
          >
            接受
          </button>
          <button
            className="text-xs text-slate-500 hover:text-slate-800"
            onClick={() => setFriendRequest(null)}
          >
            忽略
          </button>
        </div>
      )}

      {/* Compact brand */}
      <div className="flex flex-col items-center gap-1 mt-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">QVideoChat</h1>
        <p className="text-slate-500 text-[11px]">以你想要的样子,遇见世界</p>
      </div>

      {/* Avatar-preview banner */}
      {showAvatarBanner && (
        <div className="w-full max-w-sm flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-100 to-cyan-100 border border-sky-300 pl-4 pr-2 py-1.5 shadow-sm">
          <button
            type="button"
            onClick={openAvatarPage}
            className="flex-1 flex items-center gap-2 text-xs text-slate-700 hover:text-slate-900 transition"
          >
            <span>✨</span>
            <span className="font-semibold">换个化身试试</span>
            <span className="text-slate-500">{FEATURED_BANNER_NAMES}</span>
            <span className="ml-auto text-sky-600">→</span>
          </button>
          <button
            type="button"
            onClick={dismissAvatarBanner}
            aria-label="关闭"
            className="w-6 h-6 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-900/10 transition text-xs"
          >
            ×
          </button>
        </div>
      )}

      {!isConnected && matchStatus === "idle" && (
        <div className="flex items-center gap-2 rounded-full bg-rose-100 border border-rose-300 px-3 py-1">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-xs text-rose-700 font-medium">服务器未连接</span>
        </div>
      )}

      {/* Hero avatar */}
      <div className="flex flex-col items-center gap-2">
        <VrmAvatar
          blendshapeRef={blendshapeRef}
          poseRef={poseRef}
          size={avatarSize}
          vrmPath={selectedEntry.vrmPath}
          placeholderEmoji={selectedEntry.emoji}
          placeholderTint={selectedEntry.tint}
          mirror
        />
        <div className="min-h-[28px] flex items-center justify-center text-xs text-center">
          {error && <span className="text-rose-600 font-medium">{error}</span>}
          {!error && step && !isLoaded && (
            <span className="text-amber-600 font-medium">加载中: {step}</span>
          )}
          {!error && isLoaded && !faceFound && (
            <span className="text-amber-700 font-medium">追踪就绪 · 未检测到人脸</span>
          )}
          {!error && faceFound && (
            <span className="text-emerald-600 font-medium">追踪中</span>
          )}
          {!error && !isLoaded && !step && (
            <button
              onClick={toggleCamera}
              className="inline-flex items-center gap-2 rounded-full bg-white hover:bg-sky-50 border border-sky-200 hover:border-sky-400 px-3.5 py-1 text-[11px] text-slate-700 shadow-sm transition"
            >
              <span aria-hidden>📷</span>
              <span>打开摄像头,让化身跟着你笑</span>
              <span className="text-sky-500" aria-hidden>→</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={openAvatarFromHero}
          className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 hover:border-sky-400 bg-white/80 hover:bg-white px-3 py-1 text-[11px] text-slate-700 transition shadow-sm"
        >
          <span className="text-slate-500">化身</span>
          <span className="font-medium text-slate-900">{selectedEntry.name}</span>
          <span className="text-sky-600 group-hover:text-sky-700">换一换 →</span>
        </button>
      </div>

      {/* Current-config chip. Opens ProfileModal — the single edit surface
          for identity + language + tags. Kept subtle so the match CTA below
          remains the visual anchor. */}
      <button
        type="button"
        onClick={() => setShowProfile(true)}
        className="group flex flex-col items-center gap-0.5 max-w-sm px-4 py-1.5 rounded-2xl bg-white/70 hover:bg-white border border-slate-200 hover:border-sky-300 shadow-sm transition"
      >
        <span className="text-[13px] text-slate-900 font-semibold truncate max-w-full">
          {user?.isRegistered ? `@${user.username}` : (activeName || "抽取中…")}
        </span>
        <span className="text-[10px] text-slate-500 flex items-center gap-2 whitespace-nowrap">
          <span>
            {LANG_LABEL[langs.sl] || langs.sl} → {LANG_LABEL[langs.tl] || langs.tl}
          </span>
          <span className="text-slate-300">·</span>
          <span>
            {selectedTags.length > 0
              ? `${selectedTags.length} 个标签`
              : "未选标签"}
          </span>
          <span className="text-sky-600 group-hover:text-sky-700 ml-1">
            编辑 →
          </span>
        </span>
      </button>

      {/* Primary CTA */}
      {matchStatus === "idle" ? (
        <button
          onClick={handleMatch}
          disabled={!activeName || !isConnected}
          className="w-full max-w-xs rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-400 hover:from-sky-500 hover:via-cyan-500 hover:to-amber-500 text-white px-8 py-3.5 text-base font-semibold shadow-xl shadow-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition"
        >
          开始聊天
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
          <p className="text-slate-600 text-sm">正在为你连线聊伴…</p>
          <MatchButton
            label="取消"
            variant="secondary"
            onClick={() => { cancelMatch(user?.userId || ""); setMatchStatus("idle"); }}
          />
        </div>
      )}

      {banMsg && <p className="text-rose-600 text-sm font-medium">{banMsg}</p>}

      <p className="text-slate-400 text-[10px] mt-auto pt-4">
        v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
      </p>

      <FriendList
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        currentUserId={user?.userId || ""}
      />

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SettingsModal show={showSettings} onClose={() => setShowSettings(false)} />

      {/* Profile modal — identity + language + tags. Re-reads language
          keys from localStorage on close so the chip label reflects any
          change the LangFilterBar inside made. */}
      <ProfileModal
        show={showProfile}
        onClose={() => { setShowProfile(false); refreshLangsFromStorage(); }}
        guestName={guestName}
        onRegenerateGuestName={regenerateGuestName}
        registeredUsername={user?.isRegistered ? user.username || null : null}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
      />

      <OnboardingWizard
        show={showOnboarding === true && showCommunityGate === false}
        onComplete={completeOnboarding}
        onOpenCamera={start}
        onGoToAvatars={openAvatarFromHero}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
      />

      {showCommunityGate === true && (
        <CommunityGuidelinesModal onAccept={() => setShowCommunityGate(false)} />
      )}

      {showNoCameraNotice && (
        <NoCameraMatchNotice
          onProceed={handleNoCameraProceed}
          onCancel={handleNoCameraCancel}
        />
      )}
    </main>
  );
}
