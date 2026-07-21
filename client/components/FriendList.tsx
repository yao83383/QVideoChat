"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import * as api from "@/lib/api";
import AvatarTile from "./AvatarTile";
import { getAvatar } from "@/lib/avatars";
import { usePresence } from "@/hooks/usePresence";

interface Friend {
  userId: string;
  username: string;
  avatarOutfit: string;
  /** Server side stores the AVATARS id (e.g. "dlco", "female-black").
   *  Optional because older users may not have set one yet — getAvatar()
   *  falls back to the default when absent. */
  avatarId?: string;
  friendSince: number;
}

interface PendingRequest {
  id: number;
  fromUserId: string;
  fromUsername: string;
  createdAt: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  socket?: {
    onEvent: (event: string, handler: (...args: any[]) => void) => void;
  } | null;
}

export default function FriendList({ isOpen, onClose }: Props) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [tab, setTab] = useState<"friends" | "requests">("friends");
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([api.getFriends(), api.getPendingRequests().catch(() => [])]);
      setFriends(f);
      setPending(p);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadData();
  }, [isOpen, loadData]);

  // Subscribe to friends' presence ONLY while the panel is open. Passing an
  // empty array when closed makes usePresence emit presence:unsub for
  // whatever was previously subscribed, so a user who opens FriendList,
  // closes it, and browses elsewhere doesn't keep the server fanning frames
  // at them. Cheap re-sub on next open — snapshot event repaints tiles in
  // one round trip.
  const friendIds = useMemo(
    () => (isOpen ? friends.map((f) => f.userId) : []),
    [isOpen, friends],
  );
  const presence = usePresence(friendIds);

  const handleAccept = async (friendId: string) => {
    await api.acceptFriend(friendId);
    setPending((prev) => prev.filter((r) => r.fromUserId !== friendId));
    loadData();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div
        className="bg-white border border-slate-300 rounded-2xl w-80 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-sm">社交</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900 text-lg leading-none">&times;</button>
        </div>

        <div className="flex border-b border-slate-200">
          <button
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              tab === "friends" ? "text-slate-900 border-b-2 border-white" : "text-slate-500"
            }`}
            onClick={() => setTab("friends")}
          >
            好友 ({friends.length})
          </button>
          <button
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              tab === "requests" ? "text-slate-900 border-b-2 border-white" : "text-slate-500"
            }`}
            onClick={() => setTab("requests")}
          >
            请求 ({pending.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loadError ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-xs text-slate-600 text-center">请登录后查看好友列表</p>
              <Link href="/login" className="text-xs text-sky-600 hover:text-blue-300">去登录</Link>
            </div>
          ) : tab === "friends" ? (
            friends.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">还没有好友，去匹配认识新朋友吧</p>
            ) : (
              <div className="flex flex-col gap-2">
                {friends.map((f) => {
                  const entry = getAvatar(f.avatarId);
                  return (
                    <div key={f.userId} className="flex items-center gap-3 p-2 rounded-lg bg-slate-100">
                      <AvatarTile
                        entry={entry}
                        presence={presence.get(f.userId)}
                        size={44}
                        fallbackChar={f.username.slice(0, 1)}
                      />
                      <span className="text-sm text-slate-800 flex-1 truncate">{f.username}</span>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            pending.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">暂无好友请求</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pending.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs">
                        {r.fromUsername.slice(0, 1)}
                      </div>
                      <span className="text-sm text-slate-800">{r.fromUsername}</span>
                    </div>
                    <button
                      onClick={() => handleAccept(r.fromUserId)}
                      className="rounded-lg bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-3 py-1 text-xs font-semibold shadow-sm shadow-sky-500/30"
                    >
                      接受
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
