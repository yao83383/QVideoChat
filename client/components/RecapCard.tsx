"use client";

import { useEffect } from "react";

export type FriendStatus = "none" | "sent" | "received" | "friends";

/** Snapshot of the just-ended partner + friend state, taken by RoomClient
 *  before it resets for the next match. */
export interface RecapState {
  puid: string;
  pname: string;
  friendStatus: FriendStatus;
  /** Local flag flipped when the user taps 加为好友 from the card, so the
   *  button swaps to a confirmation without waiting for a server round-trip. */
  addFriendSent: boolean;
  /** Same, for accepting an incoming request from within the card. */
  friendAccepted: boolean;
}

interface Props {
  recap: RecapState;
  onRate: (score: 1 | 2 | 3) => void;
  onAddFriend: () => void;
  onAcceptFriend: () => void;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms of no interaction. Passing 0 disables
   *  the timer — useful for tests or if we later add a "pin" affordance. */
  autoDismissMs?: number;
}

/** Bottom-anchored floating card shown after "下一个". Non-blocking — the
 *  next-match spinner stays visible behind it so the user can still see the
 *  system is working. Auto-dismisses so an impatient user isn't punished for
 *  ignoring it. */
export default function RecapCard({
  recap,
  onRate,
  onAddFriend,
  onAcceptFriend,
  onDismiss,
  autoDismissMs = 3500,
}: Props) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  return (
    <div
      className="fixed bottom-4 left-1/2 z-40 rounded-2xl bg-neutral-900/95 backdrop-blur-md border border-white/10 shadow-2xl px-5 py-4 flex flex-col items-center gap-3 min-w-[280px] max-w-sm"
      style={{ animation: "qv-slide-up 0.3s ease-out forwards" }}
    >
      <div className="text-3xl select-none" aria-hidden>🎭</div>
      <div className="text-center">
        <p className="text-neutral-500 text-[10px]">刚才和</p>
        <p className="text-base font-semibold leading-tight">{recap.pname}</p>
        <p className="text-neutral-400 text-xs mt-1">聊得怎么样?</p>
      </div>

      {/* Rating row */}
      <div className="flex gap-2">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onRate(n as 1 | 2 | 3)}
            className="w-12 h-12 rounded-full flex items-center justify-center text-3xl hover:bg-white/10 active:scale-90 transition select-none"
            aria-label={n === 1 ? "一般" : n === 2 ? "还行" : "很棒"}
            title={n === 1 ? "一般" : n === 2 ? "还行" : "很棒"}
          >
            {n === 1 ? "😕" : n === 2 ? "🙂" : "😍"}
          </button>
        ))}
      </div>

      {/* Friend action row — one of four possible states. */}
      {recap.friendStatus === "friends" && (
        <p className="text-xs text-green-400">已是好友</p>
      )}
      {recap.friendStatus === "sent" && (
        <p className="text-xs text-neutral-400">已发送好友请求</p>
      )}
      {recap.friendStatus === "none" && !recap.addFriendSent && (
        <button
          type="button"
          onClick={onAddFriend}
          className="rounded-full bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 text-xs font-medium transition"
        >
          + 加为好友
        </button>
      )}
      {recap.friendStatus === "none" && recap.addFriendSent && (
        <p className="text-xs text-green-400">请求已发送</p>
      )}
      {recap.friendStatus === "received" && !recap.friendAccepted && (
        <button
          type="button"
          onClick={onAcceptFriend}
          className="rounded-full bg-green-600 hover:bg-green-500 px-4 py-1.5 text-xs font-medium transition"
        >
          接受 TA 的好友请求
        </button>
      )}
      {recap.friendStatus === "received" && recap.friendAccepted && (
        <p className="text-xs text-green-400">已接受</p>
      )}
    </div>
  );
}
