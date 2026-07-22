"use client";

/**
 * 首页 —— 只装匹配任务本身.
 *
 * IA 重写后的极简版本(v1.4.0.003):除了主 CTA 和让用户看得见自己
 * 化身的 hero,其他一切都搬走 —— 好友入口进底部 tab,设置/资料/
 * 语言/tag/化身/登录 全部进 /me hub,onboarding + 社区门进 /welcome.
 *
 * 保留:
 *  - 化身 3D 预览(用户的"我在场"的具身表达)
 *  - 主 CTA "开始匹配"
 *  - 语言 + tag 一行只读摘要(点击跳 /me/language)
 *  - 服务器连接状态指示灯
 *  - Presence publisher(登录 + 摄像头开时把自己化身广播给好友)
 *  - Electron pet window 桥(用了它的用户不受重构影响)
 *  - 匿名用户首次匹配时自动 createUser
 *  - 好友请求 toast(全局收到就显示,不局限于哪个 tab)
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import NoCameraMatchNotice from "@/components/NoCameraMatchNotice";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSocket } from "@/hooks/useSocket";
import { useUser } from "@/hooks/useUser";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";
import { useGuestName } from "@/hooks/useGuestName";
import { useAfk } from "@/hooks/useAfk";
import { usePresence } from "@/hooks/usePresence";
import { needsCommunityGate } from "@/components/CommunityGuidelinesModal";
import { preloadSherpa } from "@/lib/ai/sherpa-engine";
import { preloadPair } from "@/lib/ai/translate";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

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
  const { guestName } = useGuestName();
  const [matchStatus, setMatchStatus] = useState<"idle" | "matching">("idle");
  const [friendRequest, setFriendRequest] = useState<{ fromUserId: string; fromUsername: string } | null>(null);
  const [banMsg, setBanMsg] = useState("");
  const [showNoCameraNotice, setShowNoCameraNotice] = useState(false);

  // 首次访问未完成引导时把用户送到 /welcome. 老的 OnboardingWizard +
  // CommunityGate 都改到那边渲染;这里只判断是否需要跳。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const gate = needsCommunityGate();
    const onboarded = localStorage.getItem("qv_onboarded") === "1";
    if (gate || !onboarded) router.replace("/welcome");
  }, [router]);

  const activeName = user?.username?.trim() || guestName;
  const activeNameRef = useRef(activeName);
  activeNameRef.current = activeName;

  // Language + tags —— 只读展示,编辑入口在 /me
  const [langs, setLangs] = useState<{ sl: string; tl: string }>(() => ({
    sl: readLangPref("qv_sl", "zh"),
    tl: readLangPref("qv_tl", "en"),
  }));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  useEffect(() => {
    setLangs({ sl: readLangPref("qv_sl", "zh"), tl: readLangPref("qv_tl", "en") });
    try {
      const raw = localStorage.getItem("qv_pendingTags");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setSelectedTags(parsed);
    } catch { /* ignore */ }
  }, []);

  const [avatarSize] = useState(() => {
    if (typeof window === "undefined") return 320;
    return Math.min(window.innerWidth - 32, 360);
  });

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
    () => ({ onOffer: () => {}, onAnswer: () => {}, onIce: () => {} }),
    [],
  );

  const { isConnected, cancelMatch, socketRef } = useSocket(matchEvents, signalEvents);
  const { blendshapeRef, poseRef, isLoaded, isCameraOn, error, step, faceFound, start, stop, toggleCamera } = useFaceMesh();
  const { selectedEntry } = useSelectedAvatar();

  useEffect(() => () => stop(), [stop]);

  // Presence publisher(登录 + 摄像头开)
  const isAfk = useAfk(faceFound);
  const vrmPathRef = useRef<string | null>(null);
  vrmPathRef.current = selectedEntry?.vrmPath ?? null;
  const selfPresence = useMemo(
    () =>
      user?.userId && isCameraOn
        ? { isAfk, blendshapeRef, poseRef, vrmPathRef }
        : undefined,
    [user?.userId, isCameraOn, isAfk, blendshapeRef, poseRef],
  );
  usePresence([], selfPresence);

  // 自动开摄像头(qv_onboarded 走过就默认开)
  const autoStartTriedRef = useRef(false);
  useEffect(() => {
    if (autoStartTriedRef.current) return;
    if (typeof window === "undefined") return;
    autoStartTriedRef.current = true;
    const onboarded = localStorage.getItem("qv_onboarded") === "1";
    const cameraAuto = localStorage.getItem("qv_camera_auto");
    if (onboarded && cameraAuto !== "0") start();
  }, [start]);

  // Electron pet 桥
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

  // ASR + translate 预热
  const preloadedRef = useRef(false);
  useEffect(() => {
    if (preloadedRef.current) return;
    preloadedRef.current = true;
    (async () => {
      try { await preloadSherpa(); }
      catch (e) { console.warn("[home] preloadSherpa failed:", e); return; }
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
      if (!acked) { setShowNoCameraNotice(true); return; }
    }
    runMatch();
  };

  if (userLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </main>
    );
  }

  const langLabel = `${LANG_LABEL[langs.sl] || langs.sl} → ${LANG_LABEL[langs.tl] || langs.tl}`;

  return (
    <main className="relative flex min-h-screen flex-col items-center px-4 pt-6 pb-4 gap-5">
      {/* 服务器连接状态 —— 唯一保留在顶栏的东西.遇上断连一眼看到. */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`}
          title={isConnected ? "已连接服务器" : "未连接服务器"}
        />
        <span className="text-[10px] text-slate-500">{isConnected ? "在线" : "离线"}</span>
      </div>

      {/* 好友请求 toast —— 全局提示,不属于任何 tab */}
      {friendRequest && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md border border-sky-200 rounded-xl px-4 py-3 shadow-lg shadow-sky-500/10 flex items-center gap-3">
          <span className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{friendRequest.fromUsername}</span> 请求加你为好友
          </span>
          <button
            className="rounded-lg bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-3 py-1 text-xs font-medium shadow shadow-sky-500/30"
            onClick={() => {
              if (!user?.isRegistered) { router.push("/me/account"); return; }
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

      {/* 品牌头 */}
      <div className="flex flex-col items-center gap-1 mt-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">QVideoChat</h1>
        <p className="text-slate-500 text-[11px]">以你想要的样子,遇见世界</p>
      </div>

      {/* Hero 化身 */}
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
      </div>

      {/* 只读摘要 —— 一行显示身份 + 语言 + tag 数,点击去 /me */}
      <button
        type="button"
        onClick={() => router.push("/me")}
        className="group flex flex-col items-center gap-0.5 max-w-sm px-4 py-1.5 rounded-2xl bg-white/70 hover:bg-white border border-slate-200 hover:border-sky-300 shadow-sm transition"
      >
        <span className="text-[13px] text-slate-900 font-semibold truncate max-w-full">
          {user?.isRegistered ? `@${user.username}` : (activeName || "抽取中…")}
        </span>
        <span className="text-[10px] text-slate-500 flex items-center gap-2 whitespace-nowrap">
          <span>{langLabel}</span>
          <span className="text-slate-300">·</span>
          <span>
            {selectedTags.length > 0 ? `${selectedTags.length} 个标签` : "未选标签"}
          </span>
          <span className="text-sky-600 group-hover:text-sky-700 ml-1">编辑 →</span>
        </span>
      </button>

      {/* 主 CTA */}
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
          <button
            type="button"
            className="rounded-full bg-white border border-slate-200 hover:border-sky-300 text-slate-700 px-4 py-1.5 text-xs transition"
            onClick={() => { cancelMatch(user?.userId || ""); setMatchStatus("idle"); }}
          >
            取消
          </button>
        </div>
      )}

      {banMsg && <p className="text-rose-600 text-sm font-medium">{banMsg}</p>}

      {showNoCameraNotice && (
        <NoCameraMatchNotice
          onProceed={() => {
            try {
              sessionStorage.setItem("qv_no_camera_ack", "1");
            } catch { /* ignore */ }
            setShowNoCameraNotice(false);
            runMatch();
          }}
          onCancel={() => setShowNoCameraNotice(false)}
        />
      )}
    </main>
  );
}
