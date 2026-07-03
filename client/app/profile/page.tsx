"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MatchButton from "@/components/MatchButton";
import * as api from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [referral, setReferral] = useState<any>(null);

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
      <MatchButton label="返回首页" variant="secondary" onClick={() => router.push("/")} />
    </main>
  );
}
