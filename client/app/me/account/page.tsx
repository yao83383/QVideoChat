"use client";

/**
 * /me/account —— 账号页.
 *
 * 三种模式:
 *  - guest:显示登录/注册 CTA(跳 /login)
 *  - logged in:显示账号信息 + 邀请码 + 退出
 *  - ?logout=1:直接进退出确认对话框(从 /me hub 的退出按钮点进来)
 *
 * 老 LoginPrompt(未登录时"注册好友需要登录"的浮窗)不再需要 —— 未登录
 * 用户在任何时候都能来这里注册,不是必须被弹窗打断。
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MeSubShell from "@/components/MeSubShell";
import { useUser } from "@/hooks/useUser";
import * as api from "@/lib/api";

export default function MeAccountPage() {
  // useSearchParams 触发 client-side bailout,Next 15 要求包 Suspense.
  return (
    <Suspense fallback={<AccountFallback />}>
      <MeAccountInner />
    </Suspense>
  );
}

function AccountFallback() {
  return (
    <MeSubShell title="账号">
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </div>
    </MeSubShell>
  );
}

function MeAccountInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading, doLogout } = useUser();

  const [stats, setStats] = useState<any>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const isGuest = !user?.isRegistered;

  // Deep-link support: hub 的退出按钮把用户直接送到 ?logout=1.
  useEffect(() => {
    if (params.get("logout") === "1" && user?.isRegistered) {
      setConfirmLogout(true);
    }
  }, [params, user?.isRegistered]);

  useEffect(() => {
    if (!user?.isRegistered) return;
    api.getUserStats().then(setStats).catch(() => setStats(null));
  }, [user?.isRegistered]);

  if (loading) {
    return (
      <MeSubShell title="账号">
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
        </div>
      </MeSubShell>
    );
  }

  if (isGuest) {
    return (
      <MeSubShell title="账号" subtitle="登录或注册以跨设备同步数据">
        <div className="flex flex-col gap-3 rounded-2xl bg-white border border-slate-200 p-6 items-center text-center">
          <div className="text-5xl mb-2">🎭</div>
          <p className="text-sm text-slate-800">
            你现在是未登录的"原创角色"
          </p>
          <p className="text-[11px] text-slate-500 max-w-xs">
            登录后可保留昵称、好友关系、化身选择、语言偏好,并跨设备同步。
          </p>
          <Link
            href="/login"
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-6 py-3 text-sm font-semibold shadow-lg shadow-sky-500/30 text-center"
          >
            去登录 / 注册
          </Link>
        </div>
      </MeSubShell>
    );
  }

  const inviteCode = stats?.userId?.slice(0, 8);

  return (
    <MeSubShell title="账号">
      {/* 身份信息 */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-3">
        <Field label="用户名" value={user?.username || "-"} />
        <Field label="用户 ID" value={user?.userId || "-"} mono />
        {stats?.createdAt && (
          <Field label="加入时间" value={new Date(stats.createdAt).toLocaleDateString()} />
        )}
      </section>

      {/* 邀请码 */}
      {inviteCode && (
        <section className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-2">
          <p className="text-[11px] text-slate-500 tracking-wider uppercase">邀请码</p>
          <div className="flex items-center gap-2">
            <span className="text-base font-mono font-semibold text-slate-900 select-all">
              {inviteCode}
            </span>
            <button
              type="button"
              onClick={() => {
                const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
                navigator.clipboard.writeText(
                  `${window.location.origin}${base}/login?invite=${inviteCode}`,
                );
              }}
              className="ml-auto text-xs text-sky-600 hover:text-sky-800 transition"
            >
              复制邀请链接
            </button>
          </div>
        </section>
      )}

      {/* 退出 */}
      <button
        type="button"
        onClick={() => setConfirmLogout(true)}
        className="rounded-2xl bg-white border border-rose-200 hover:border-rose-400 hover:bg-rose-50 text-rose-600 py-3 text-sm font-medium transition"
      >
        退出登录
      </button>

      {confirmLogout && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setConfirmLogout(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white border border-slate-200 p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="text-3xl mb-2">👋</div>
              <h3 className="text-lg font-semibold text-slate-900">退出登录?</h3>
              <p className="text-slate-600 text-xs mt-2">
                下次可以用邮箱 / 手机号 / ID + 密码重新登录
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  doLogout();
                  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
                  window.location.href = `${base}/`;
                }}
                className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white transition"
              >
                确认退出
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLogout(false);
                  if (params.get("logout") === "1") router.replace("/me/account");
                }}
                className="text-xs text-slate-500 hover:text-slate-700 py-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </MeSubShell>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-slate-500 tracking-wider uppercase">{label}</span>
      <span className={`text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
