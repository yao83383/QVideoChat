"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MatchButton from "@/components/MatchButton";
import PendingInvitationsPanel from "@/components/PendingInvitationsPanel";
import * as api from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [referral, setReferral] = useState<any>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (!api.isLoggedIn()) {
      setNeedLogin(true);
      setLoading(false);
      return;
    }
    Promise.all([
      api.getUserStats().catch(() => null),
      api.getMatchHistory().catch(() => []),
      api.getReferral().catch(() => null),
    ]).then(([s, h, r]) => {
      setStats(s);
      setHistory(h);
      setReferral(r);
      setLoading(false);
    });
  }, [router]);

  const formatDuration = (ms: number) => {
    if (!ms) return "0 分钟";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} 分钟`;
    const hours = Math.floor(mins / 60);
    const remain = mins % 60;
    return `${hours} 小时 ${remain} 分钟`;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
      </main>
    );
  }

  if (needLogin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
        <h1 className="text-xl font-bold">QVideoChat</h1>
        <p className="text-sm text-neutral-400">登录后查看个人资料和匹配历史</p>
        <Link
          href="/login"
          className="rounded-xl px-8 py-3 font-semibold text-sm transition bg-white text-black hover:bg-neutral-200"
        >
          去登录
        </Link>
        <button
          onClick={() => router.push("/")}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          返回首页
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-start gap-6 p-4 pt-12">
      <button
        onClick={() => router.push("/")}
        className="absolute top-4 left-4 text-xs text-neutral-400 hover:text-white transition"
      >
        &larr; 返回
      </button>

      <h1 className="text-xl font-bold">我的</h1>

      <PendingInvitationsPanel />

      {stats && (
        <div className="flex gap-6 rounded-xl bg-neutral-900 border border-neutral-800 px-8 py-5">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{stats.matchCount || 0}</p>
            <p className="text-xs text-neutral-500 mt-1">匹配次数</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{formatDuration(stats.totalDuration || 0)}</p>
            <p className="text-xs text-neutral-500 mt-1">累计聊天</p>
          </div>
        </div>
      )}

      {stats && (
        <div className="flex flex-col items-center gap-1">
          <div className="w-16 h-16 rounded-full bg-neutral-800 border-2 border-neutral-700 flex items-center justify-center text-2xl">
            {stats.username?.slice(0, 1) || "?"}
          </div>
          <p className="text-sm text-neutral-200 mt-2 font-medium">{stats.username}</p>
          <p className="text-xs text-neutral-500">加入于 {stats.createdAt ? formatDate(stats.createdAt) : "-"}</p>
          {stats.userId && (
            <p className="text-[10px] text-neutral-600 mt-1">
              邀请码: {stats.userId.slice(0, 8)} &middot;
              <button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/q-dev/login?invite=${stats.userId.slice(0, 8)}`)}
                className="text-blue-500 hover:text-blue-400 ml-1"
              >
                复制邀请链接
              </button>
            </p>
          )}
        </div>
      )}

      {referral && referral.referrer && (
        <div className="rounded-lg bg-neutral-800/40 px-4 py-2 text-xs text-neutral-400">
          邀请人: <span className="text-neutral-200">{referral.referrer.username}</span>
        </div>
      )}

      {referral && referral.referred && referral.referred.length > 0 && (
        <div className="w-full max-w-sm">
          <h3 className="text-xs text-neutral-400 mb-2">已邀请 ({referral.referred.length})</h3>
          <div className="flex flex-col gap-1">
            {referral.referred.map((r: any) => (
              <div key={r.userId} className="flex items-center justify-between text-xs text-neutral-500 px-2">
                <span>{r.username}</span>
                <span>{formatDate(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="w-full max-w-sm">
        <h2 className="text-sm font-medium text-neutral-300 mb-3">最近匹配</h2>
        {history.length === 0 ? (
          <p className="text-xs text-neutral-500 text-center py-4">还没有匹配记录</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-[10px]">
                    {h.partnerName?.slice(0, 1) || "?"}
                  </div>
                  <span className="text-sm text-neutral-300">{h.partnerName || "匿名"}</span>
                </div>
                <span className="text-[10px] text-neutral-600">
                  {h.startedAt ? formatDate(h.startedAt) : "-"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <hr className="w-64 border-neutral-800" />
      <button
        onClick={() => router.push("/avatars")}
        className="w-full max-w-sm rounded-2xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 hover:border-purple-500/60 transition px-5 py-4 flex items-center justify-between"
      >
        <span className="flex items-center gap-3">
          <span className="text-2xl">🎭</span>
          <span className="flex flex-col items-start">
            <span className="text-sm font-medium text-neutral-100">我的化身</span>
            <span className="text-[10px] text-neutral-400">试试即将上线的新装扮</span>
          </span>
        </span>
        <span className="text-neutral-400">→</span>
      </button>

      <MatchButton label="返回首页" variant="secondary" onClick={() => router.push("/")} />

      {/* Logout — kept below the primary "back home" to reduce accidental
          clicks. Confirmation modal so a stray tap can't wipe the session.
          Logout clears the token + user object; useUser resolves to null on
          next mount, which naturally puts the user in guest state. */}
      <button
        type="button"
        onClick={() => setConfirmLogout(true)}
        className="mt-8 text-xs text-red-500/80 hover:text-red-400 transition py-2 px-4"
      >
        退出登录
      </button>

      {confirmLogout && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setConfirmLogout(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-neutral-900 border border-white/10 p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl mb-2">👋</div>
              <h3 className="text-lg font-semibold">退出登录?</h3>
              <p className="text-neutral-400 text-xs mt-2">下次可以用邮箱 / 手机号 / ID + 密码重新登录</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  try { localStorage.removeItem("token"); localStorage.removeItem("user"); } catch {}
                  // Full page reload guarantees every hook + cached state is
                  // dropped — safer than router.push after logout.
                  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
                  window.location.href = `${base}/`;
                }}
                className="w-full rounded-2xl bg-red-600 hover:bg-red-500 px-6 py-2.5 text-sm font-semibold text-white transition"
              >
                确认退出
              </button>
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                className="text-xs text-neutral-500 hover:text-neutral-300 py-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
