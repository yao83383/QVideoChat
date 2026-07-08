"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import NameInput from "@/components/NameInput";
import MatchButton from "@/components/MatchButton";
import BlendshapeDebug from "@/components/BlendshapeDebug";
import VrmAvatar from "@/components/VrmAvatar";
import TagSelector from "@/components/TagSelector";
import FriendList from "@/components/FriendList";
import LoginPrompt from "@/components/LoginPrompt";
import SettingsModal, { getSettings } from "@/components/SettingsModal";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSocket } from "@/hooks/useSocket";
import { useUser } from "@/hooks/useUser";
import type { MatchEvents, SignalEvents } from "@/hooks/useSocket";

export default function Home() {
  const router = useRouter();
  const { user, loading: userLoading, createUser } = useUser();
  const [username, setUsername] = useState("");
  const [matchStatus, setMatchStatus] = useState<"idle" | "matching">("idle");
  const [showDebug, setShowDebug] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [friendRequest, setFriendRequest] = useState<{ fromUserId: string; fromUsername: string } | null>(null);
  const [banMsg, setBanMsg] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const usernameRef = useRef(username);
  usernameRef.current = username;

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
  const { blendshapeRef, isLoaded, isCameraOn, error, step, faceFound, start, stop, toggleCamera } = useFaceMesh();

  const handleToggleCamera = async () => {
    toggleCamera();
    setShowDebug(isCameraOn ? false : !showDebug);
  };

  useEffect(() => () => stop(), [stop]);

  const handleMatch = async () => {
    const name = username.trim();
    if (!name) return;
    // Ensure we have a server-side user with token
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
    joinMatch(uid, name, selectedTags);
    setMatchStatus("matching");
  };

  if (userLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <div className="absolute top-4 right-4 flex gap-2 items-center">
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

      <h1 className="text-3xl font-bold tracking-tight">QVideoChat</h1>
      <p className="text-neutral-400 text-sm">Q版虚拟形象 · 随机匹配通话</p>
      <p className="text-neutral-600 text-[10px]">v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}</p>

      <NameInput value={username} onChange={setUsername} disabled={matchStatus !== "idle"} />

      <TagSelector selected={selectedTags} onChange={setSelectedTags} />

      {matchStatus === "idle" && (
        <MatchButton
          label="开始匹配"
          disabled={!username.trim()}
          onClick={handleMatch}
        />
      )}

      {matchStatus === "matching" && (
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          <p className="text-neutral-400">正在寻找匹配对象...</p>
          <MatchButton
            label="取消"
            variant="secondary"
            onClick={() => { cancelMatch(user?.userId || ""); setMatchStatus("idle"); }}
          />
        </div>
      )}

      <hr className="w-64 border-neutral-800" />

      <MatchButton
        label={isLoaded ? "📷 关闭" : "📷 摄像头"}
        variant="secondary"
        onClick={handleToggleCamera}
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {banMsg && <p className="text-red-400 text-sm">{banMsg}</p>}
      {isLoaded && !faceFound && <p className="text-yellow-400 text-xs">追踪就绪 · 未检测到人脸</p>}
      {faceFound && <p className="text-green-400 text-xs">追踪就绪 · 人脸检测中</p>}
      {step && !isLoaded && <p className="text-yellow-400 text-xs">加载中: {step}</p>}

      {showDebug && (
        <div className="flex flex-col xl:flex-row items-center gap-6">
          <BlendshapeDebug blendshapeRef={blendshapeRef} />
          <VrmAvatar blendshapeRef={blendshapeRef} size={320} label="Q版形象 (本地)" />
        </div>
      )}

      <FriendList
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        currentUserId={user?.userId || ""}
      />

      <LoginPrompt show={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <SettingsModal show={showSettings} onClose={() => setShowSettings(false)} />
    </main>
  );
}
