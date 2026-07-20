"use client";

import { useState, useEffect, useRef } from "react";
import { inviteListPending, inviteConfirm, inviteReject, type PendingInvitation } from "@/lib/api";

/** Section shown on /profile for confirmed users — lists all pending
 *  invitations targeted at me and lets me approve or reject each in place.
 *  Polls every 5s to stay in sync with the 2-minute expiration. */
export default function PendingInvitationsPanel() {
  const [list, setList] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // guestUserId being acted on
  const [tick, setTick] = useState(0);                    // forces countdown re-render
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const rows = await inviteListPending();
      setList(rows);
    } catch { /* transient */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 5000);
    const uiTick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearInterval(uiTick);
    };
  }, []);

  const handleAction = async (guestUserId: string, action: "confirm" | "reject") => {
    setBusy(guestUserId);
    try {
      if (action === "confirm") await inviteConfirm(guestUserId);
      else await inviteReject(guestUserId);
      setList((prev) => prev.filter((p) => p.guestUserId !== guestUserId));
    } catch (e: any) {
      alert(e?.message || "操作失败");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-sm rounded-xl bg-white/50 border border-slate-200 p-4 text-center">
        <div className="text-slate-500 text-xs">加载待处理邀请中…</div>
      </div>
    );
  }

  if (list.length === 0) return null;

  return (
    <div className="w-full max-w-sm rounded-2xl bg-gradient-to-br from-sky-500/10 to-cyan-500/10 border border-sky-500/30 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          待处理邀请 ({list.length})
        </h3>
        <span className="text-[10px] text-slate-500">2 分钟内回应</span>
      </div>

      {list.map((inv) => {
        const remaining = Math.max(0, Math.floor((inv.expiresAt - Date.now()) / 1000));
        // Suppress lint warning about unused tick — tick is what forces this to re-evaluate
        void tick;
        const contact = inv.email || inv.phone || "-";
        return (
          <div key={inv.guestUserId} className="rounded-xl bg-white border border-slate-200 p-3 flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{inv.guestUsername}</span>
                <span className="text-[10px] text-slate-500 font-mono">{contact}</span>
              </div>
              <span className={`text-xs font-mono tabular-nums ${remaining < 30 ? "text-rose-600" : "text-slate-600"}`}>
                {String(Math.floor(remaining / 60))}:{String(remaining % 60).padStart(2, "0")}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleAction(inv.guestUserId, "reject")}
                disabled={busy === inv.guestUserId}
                className="flex-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 py-1.5 text-xs text-slate-700 hover:text-white disabled:opacity-40 transition"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => handleAction(inv.guestUserId, "confirm")}
                disabled={busy === inv.guestUserId}
                className="flex-1 rounded-lg bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-500 hover:from-sky-500 hover:via-cyan-500 hover:to-emerald-600 py-1.5 text-xs font-semibold text-white disabled:opacity-40 transition"
              >
                {busy === inv.guestUserId ? "…" : "通过"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
