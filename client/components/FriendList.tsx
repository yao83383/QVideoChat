"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import * as api from "@/lib/api";
import { acceptFriend } from "@/lib/api";

interface Friend {
  userId: string;
  username: string;
  avatarOutfit: string;
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

export default function FriendList({ isOpen, onClose, currentUserId, socket }: Props) {
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

  const handleAccept = async (friendId: string) => {
    await api.acceptFriend(friendId);
    setPending((prev) => prev.filter((r) => r.fromUserId !== friendId));
    loadData();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl w-80 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h3 className="font-semibold text-sm">社交</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-lg leading-none">&times;</button>
        </div>

        <div className="flex border-b border-neutral-800">
          <button
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              tab === "friends" ? "text-white border-b-2 border-white" : "text-neutral-500"
            }`}
            onClick={() => setTab("friends")}
          >
            好友 ({friends.length})
          </button>
          <button
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              tab === "requests" ? "text-white border-b-2 border-white" : "text-neutral-500"
            }`}
            onClick={() => setTab("requests")}
          >
            请求 ({pending.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loadError ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-xs text-neutral-400 text-center">请登录后查看好友列表</p>
              <Link href="/login" className="text-xs text-blue-400 hover:text-blue-300">去登录</Link>
            </div>
          ) : tab === "friends" ? (
            friends.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-6">还没有好友，去匹配认识新朋友吧</p>
            ) : (
              <div className="flex flex-col gap-2">
                {friends.map((f) => (
                  <div key={f.userId} className="flex items-center gap-3 p-2 rounded-lg bg-neutral-800/50">
                    <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-xs">
                      {f.username.slice(0, 1)}
                    </div>
                    <span className="text-sm text-neutral-200">{f.username}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            pending.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-6">暂无好友请求</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pending.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-neutral-800/50">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-xs">
                        {r.fromUsername.slice(0, 1)}
                      </div>
                      <span className="text-sm text-neutral-200">{r.fromUsername}</span>
                    </div>
                    <button
                      onClick={() => handleAccept(r.fromUserId)}
                      className="rounded-lg bg-white text-black px-3 py-1 text-xs font-medium hover:bg-neutral-200"
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
