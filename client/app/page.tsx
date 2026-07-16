"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import NameInput from "@/components/NameInput";
import MatchButton from "@/components/MatchButton";
import VrmAvatar from "@/components/VrmAvatar";
import TagSelector from "@/components/TagSelector";
import LangFilterBar from "@/components/LangFilterBar";
import FriendList from "@/components/FriendList";
import LoginPrompt from "@/components/LoginPrompt";
import SettingsModal from "@/components/SettingsModal";
import OnboardingWizard from "@/components/OnboardingWizard";
import CommunityGuidelinesModal, { needsCommunityGate } from "@/components/CommunityGuidelinesModal";
import NoCameraMatchNotice from "@/components/NoCameraMatchNotice";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSocket } from "@/hooks/useSocket";
import { useUser } from "@/hooks/useUser";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";
import { AVATARS, DEFAULT_AVATAR_ID } from "@/lib/avatars";
import { preloadSherpa } from "@/lib/ai/sherpa-engine";
import { preloadPair } from "@/lib/ai/translate";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

// Rotating showcase for the "换个化身试试" banner. Pulled from AVATARS at
// module init so the copy can never drift out of sync with the actual roster
// (v1.2.3.001 shipped hard-coded names for chars that didn't exist — that's
// exactly what this closes off).
const FEATURED_BANNER_NAMES = AVATARS
  .filter((a) => a.id !== DEFAULT_AVATAR_ID)
  .slice(0, 3)
  .map((a) => a.name)
  .join(" · ");

export default function Home() {
  const router = useRouter();
  const { user, loading: userLoading, createUser } = useUser();
  const [username, setUsername] = useState("");
  const [matchStatus, setMatchStatus] = useState<"idle" | "matching">("idle");
  const [showFriends, setShowFriends] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [friendRequest, setFriendRequest] = useState<{ fromUserId: string; fromUsername: string } | null>(null);
  const [banMsg, setBanMsg] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Camera-off warning modal. Fires when the user tries to match without ever
  // opening the camera — parent-owned so runMatch can be re-invoked on the
  // Proceed branch without wiring the whole match closure into the modal.
  const [showNoCameraNotice, setShowNoCameraNotice] = useState(false);
  const usernameRef = useRef(username);
  usernameRef.current = username;

  // Pick avatar hero size once at mount from viewport width so mobile / desktop
  // both fit without re-measuring on resize (VrmAvatar's WebGL effect keys on
  // `size`, so changing it would dispose+reload the ~25MB VRM).
  const [avatarSize] = useState(() => {
    if (typeof window === "undefined") return 320;
    return Math.min(window.innerWidth - 32, 360);
  });

  // Restore username from user state
  useEffect(() => {
    if (user?.username && !username) setUsername(user.username);
  }, [user?.username]);

  const matchEvents: MatchEvents = useMemo(
    () => ({
      onWaiting: () => setMatchStatus("matching"),
      onFound: (data) => {
        const params = new URLSearchParams({
          id: data.roomId,
          uid: user?.userId || "",
          uname: usernameRef.current,
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
    [user?.userId, router],
  );

  const signalEvents: SignalEvents = useMemo(
    () => ({
      onOffer: () => {},
      onAnswer: () => {},
      onIce: () => {},
    }),
    [],
  );

  const { isConnected, joinMatch, cancelMatch, socketRef } = useSocket(matchEvents, signalEvents);
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

  // Onboarding gate. Read `qv_onboarded` on mount; if it's missing, mount the
  // wizard. `showOnboarding=null` during hydration to avoid SSR/CSR mismatch
  // (localStorage isn't available on the server), then resolves to boolean
  // after the first client-side effect.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowOnboarding(localStorage.getItem("qv_onboarded") !== "1");
  }, []);

  // Avatar-preview banner state. Same hydration dance — read once client-side,
  // hide forever after the user dismisses it (per-browser localStorage).
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

  // Separate counter from openAvatarPage: this fires from the always-visible
  // pill under the hero, not from the dismissible top banner. Splitting them
  // lets us see which entry point returning users actually reach for once the
  // banner has been closed.
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

  // Auto-open camera for returning users (qv_onboarded flag set by the wizard
  // in A3). First-time users don't trigger a permission dialog on landing —
  // they'll see it during onboarding step 3 as an explained gesture.
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

  // Warm up the ASR + translation pipelines from the home page so they're
  // ready by the time the user finishes matching. Two rules learned the hard
  // way in v1.2.2.007:
  //   1) SERIAL, not parallel. Kicking off sherpa's emscripten runtime AND
  //      the transformers.js worker at the same time on a cold cache produced
  //      a "null function" crash inside sherpa's wasm — presumably a race in
  //      shared feature-detection state or cross-origin isolation checks.
  //      Awaiting sherpa first sidesteps it.
  //   2) sherpa's .data (190MB) is now cached in OPFS by resolveDataBlobUrl —
  //      the second visit reads it locally in a couple seconds, no network.
  const preloadedRef = useRef(false);
  useEffect(() => {
    if (preloadedRef.current) return;
    preloadedRef.current = true;
    const readPref = (key: string, fallback: string) => {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
      catch { return fallback; }
    };
    (async () => {
      try {
        await preloadSherpa();
      } catch (e) {
        console.warn("[home] preloadSherpa failed:", e);
        return; // don't kick opus-mt if sherpa itself is broken — avoid noise
      }
      const sl: string = readPref("qv_sl", "zh");
      const tl: string = readPref("qv_tl", "en");
      if (sl !== tl) {
        try { await preloadPair(sl, tl); }
        catch (e) { console.warn("[home] preloadPair failed:", e); }
      }
    })();
  }, []);

  // The actual match kickoff: create user if needed, unlock autoplay, and
  // route into the room. Kept separate from handleMatch so the camera-off
  // warning modal can invoke it directly on Proceed without duplicating logic.
  const runMatch = async () => {
    if (!isConnected) return;
    const name = username.trim();
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
    // Unlock autoplay on this user gesture — otherwise the room page's remote
    // audio.play() may be blocked by autoplay policy.
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
    // Guard rails first: don't waste modal cycles on states the primary button
    // is already disabled for.
    if (!isConnected) return;
    if (!username.trim()) return;
    // Camera-off soft gate. Fires ONCE per session (sessionStorage, not
    // localStorage) so repeat matches don't nag, but a fresh browser session
    // still gets the gentle reminder + norms nudge. If camera is on, straight
    // through.
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center px-4 pt-6 pb-8 gap-5">
      {/* Top-right nav */}
      <div className="absolute top-4 right-4 flex gap-2 items-center">
        <span
          className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
          title={isConnected ? "已连接服务器" : "未连接服务器"}
        />
        <MatchButton label="⚙" variant="secondary" onClick={() => setShowSettings(true)} />
        {user?.isRegistered ? (
          <>
            <span className="text-xs text-neutral-500 mr-1">{user.username}</span>
            <MatchButton label="好友" variant="secondary" onClick={() => setShowFriends(true)} />
            <MatchButton label="我的" variant="secondary" onClick={() => router.push("/profile")} />
          </>
        ) : (
          <MatchButton label="登录/注册" variant="secondary" onClick={() => router.push("/login")} />
        )}
      </div>

      {friendRequest && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 bg-neutral-800 border border-neutral-600 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
          <span className="text-sm text-neutral-200">
            <span className="font-medium">{friendRequest.fromUsername}</span> 请求加你为好友
          </span>
          <button
            className="rounded-lg bg-white text-black px-3 py-1 text-xs font-medium"
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
            className="text-xs text-neutral-400 hover:text-white"
            onClick={() => setFriendRequest(null)}
          >
            忽略
          </button>
        </div>
      )}

      {/* Compact brand */}
      <div className="flex flex-col items-center gap-1 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">QVideoChat</h1>
        <p className="text-neutral-500 text-[11px]">Q版虚拟形象 · 随机匹配通话</p>
      </div>

      {/* Avatar-preview banner — small callout to /avatars until L1 商城 ships.
          Dismissible so it doesn't nag returning users. */}
      {showAvatarBanner && (
        <div className="w-full max-w-sm flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500/15 to-pink-500/15 border border-purple-500/25 pl-4 pr-2 py-1.5">
          <button
            type="button"
            onClick={openAvatarPage}
            className="flex-1 flex items-center gap-2 text-xs text-neutral-200 hover:text-white transition"
          >
            <span>✨</span>
            <span className="font-medium">换个化身试试</span>
            <span className="text-neutral-400">{FEATURED_BANNER_NAMES}</span>
            <span className="ml-auto text-neutral-400">→</span>
          </button>
          <button
            type="button"
            onClick={dismissAvatarBanner}
            aria-label="关闭"
            className="w-6 h-6 rounded-full text-neutral-500 hover:text-white hover:bg-white/10 transition text-xs"
          >
            ×
          </button>
        </div>
      )}

      {!isConnected && matchStatus === "idle" && (
        <div className="flex items-center gap-2 rounded-full bg-red-900/20 border border-red-800/50 px-3 py-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-400">服务器未连接</span>
        </div>
      )}

      {/* Hero: avatar always mounted so the character is always visible even
          when the camera is off (idle rest pose + breath keeps it alive). */}
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
        {/* One-line status under the avatar. Priorities:
              error > tracker-loading > face-not-found > tracking > idle-CTA */}
        <div className="min-h-[28px] flex items-center justify-center text-xs text-center">
          {error && <span className="text-red-400">{error}</span>}
          {!error && step && !isLoaded && (
            <span className="text-yellow-400">加载中: {step}</span>
          )}
          {!error && isLoaded && !faceFound && (
            <span className="text-yellow-500">追踪就绪 · 未检测到人脸</span>
          )}
          {!error && faceFound && (
            <span className="text-green-500">追踪中</span>
          )}
          {!error && !isLoaded && !step && (
            <button
              onClick={toggleCamera}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/25 hover:border-white/50 px-3.5 py-1 text-[11px] text-neutral-100 shadow-sm transition"
            >
              <span aria-hidden>📷</span>
              <span>打开摄像头,让化身跟着你笑</span>
              <span className="text-neutral-400" aria-hidden>→</span>
            </button>
          )}
        </div>
        {/* Persistent avatar-swap entry point. Sits directly under the hero so
            it survives banner dismissal — that dismissible top banner is a
            noticeable-once affordance; this pill is the always-on one that
            returning users can find without hunting. */}
        <button
          type="button"
          onClick={openAvatarFromHero}
          className="group inline-flex items-center gap-1.5 rounded-full border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 px-3 py-1 text-[11px] text-neutral-300 transition"
        >
          <span className="text-neutral-500">化身</span>
          <span className="font-medium text-neutral-100">{selectedEntry.name}</span>
          <span className="text-purple-300 group-hover:text-purple-200">换一换 →</span>
        </button>
      </div>

      {/* Name input (hidden once the user is registered — they already have one) */}
      {!user?.isRegistered && (
        <NameInput value={username} onChange={setUsername} disabled={matchStatus !== "idle"} />
      )}

      {/* Tag selector */}
      <TagSelector selected={selectedTags} onChange={setSelectedTags} />

      {/* Language pair — feeds match scoring server-side and drives subtitle
          translation in the room. Persists to qv_sl / qv_tl, same keys the
          Onboarding wizard writes. */}
      <LangFilterBar />

      {/* Primary CTA — matches the marketing site's gradient look for a
          consistent brand impression once the user lands from justsaysayforfun.com/. */}
      {matchStatus === "idle" ? (
        <button
          onClick={handleMatch}
          disabled={!username.trim() || !isConnected}
          className="w-full max-w-xs rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-8 py-3.5 text-base font-semibold shadow-xl shadow-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition"
        >
          开始匹配
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          <p className="text-neutral-400 text-sm">正在寻找匹配对象...</p>
          <MatchButton
            label="取消"
            variant="secondary"
            onClick={() => { cancelMatch(user?.userId || ""); setMatchStatus("idle"); }}
          />
        </div>
      )}

      {banMsg && <p className="text-red-400 text-sm">{banMsg}</p>}

      {/* Footer version — pushed to bottom via mt-auto */}
      <p className="text-neutral-700 text-[10px] mt-auto pt-4">
        v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
      </p>

      <FriendList
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        currentUserId={user?.userId || ""}
      />

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SettingsModal show={showSettings} onClose={() => setShowSettings(false)} />

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
