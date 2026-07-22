"use client";

/**
 * /friends —— tab bar's second destination.
 *
 * Full-page version of the friend list that used to live in a modal on the
 * home page. Structurally does what FriendList (the modal) did, but:
 *
 *  - No modal chrome (no backdrop, no close button, no fixed positioning).
 *  - Guest users get a login-CTA card instead of the empty-list message,
 *    since anonymous accounts can't have friends yet.
 *  - Presence is always subscribed while the tab is mounted — unlike the
 *    modal, which only subscribed while open. Users on the friends tab
 *    are explicitly asking for live state, so the fanout is warranted.
 *  - Header shows "我" chip (my current presence — the "我的化身状态" chip
 *    referenced in the plan). This is the only place we render it; other
 *    tabs don't need to see their own state.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as api from "@/lib/api";
import AvatarTile from "@/components/AvatarTile";
import { getAvatar } from "@/lib/avatars";
import { usePresence, type PresenceStatus } from "@/hooks/usePresence";
import { useUser } from "@/hooks/useUser";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";

interface Friend {
  userId: string;
  username: string;
  avatarOutfit: string;
  avatarId?: string;
  friendSince: number;
}

interface PendingRequest {
  id: number;
  fromUserId: string;
  fromUsername: string;
  createdAt: number;
}

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: "在线",
  sleeping: "睡着",
  busy: "通话中",
  offline: "离线",
};

export default function FriendsPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { selectedEntry: myAvatar } = useSelectedAvatar();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [tab, setTab] = useState<"friends" | "requests">("friends");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const isGuest = !user?.isRegistered;

  const loadData = useCallback(async () => {
    if (isGuest) { setLoading(false); return; }
    setLoading(true);
    try {
      const [f, p] = await Promise.all([
        api.getFriends(),
        api.getPendingRequests().catch(() => []),
      ]);
      setFriends(f);
      setPending(p);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [isGuest]);

  useEffect(() => { loadData(); }, [loadData]);

  // Subscribe to every friend's presence while the tab is mounted.
  const friendIds = useMemo(() => friends.map((f) => f.userId), [friends]);
  const presence = usePresence(friendIds);

  const handleAccept = async (friendId: string) => {
    await api.acceptFriend(friendId);
    setPending((prev) => prev.filter((r) => r.fromUserId !== friendId));
    loadData();
  };

  // Guest state ----------------------------------------------------------
  if (userLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </main>
    );
  }
  if (isGuest) {
    return (
      <main className="flex min-h-[80vh] flex-col items-center justify-center px-6 gap-4 text-center">
        <div className="text-5xl">👥</div>
        <h1 className="text-xl font-semibold text-slate-900">登录后管理好友</h1>
        <p className="text-sm text-slate-600 max-w-xs">
          注册账号后你就能看到谁在线、直接呼叫、以及在通话结束时把聊得来的人加为好友。
        </p>
        <Link
          href="/login"
          className="mt-2 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-6 py-2.5 text-sm font-semibold shadow-lg shadow-sky-500/30"
        >
          去登录 / 注册
        </Link>
        <button
          onClick={() => router.push("/")}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          返回首页
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 pt-6 pb-4 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">好友</h1>
        {/* 我的当前状态 chip —— 只在 /friends 顶部显示。让用户直观确认
            "我此刻对朋友是什么状态"。 */}
        <div className="flex items-center gap-2 rounded-full bg-white border border-slate-200 pl-1 pr-3 py-1 shadow-sm">
          <AvatarTile
            entry={myAvatar}
            presence={{
              userId: user.userId,
              status: "online",
              lastFrameAt: 0,
              blendshapeRef: { current: null } as any,
              poseRef: { current: null } as any,
              configRef: { current: null } as any,
              vrmPath: null,
            }}
            size={32}
          />
          <span className="text-xs text-slate-700">我 · 在线</span>
        </div>
      </header>

      {/* tab bar 好友 / 请求 */}
      <div className="flex rounded-xl bg-slate-100 p-1">
        {(["friends", "requests"] as const).map((k) => {
          const active = tab === k;
          const count = k === "friends" ? friends.length : pending.length;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {k === "friends" ? "好友" : "请求"}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600 text-center py-6">加载失败,稍后重试</p>
      ) : tab === "friends" ? (
        friends.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            还没有好友。<br />匹配聊天中长按对方头像可以加为好友。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((f) => {
              const entry = getAvatar(f.avatarId);
              const p = presence.get(f.userId);
              const status = p?.status ?? "offline";
              return (
                <li
                  key={f.userId}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-slate-200"
                >
                  <AvatarTile
                    entry={entry}
                    presence={p}
                    size={48}
                    fallbackChar={f.username.slice(0, 1)}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {f.username}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : pending.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6">暂无好友请求</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-200"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-semibold">
                  {r.fromUsername.slice(0, 1)}
                </div>
                <span className="text-sm text-slate-800 truncate">
                  {r.fromUsername}
                </span>
              </div>
              <button
                onClick={() => handleAccept(r.fromUserId)}
                className="rounded-lg bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-3 py-1.5 text-xs font-semibold shadow-sm shadow-sky-500/30"
              >
                接受
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
