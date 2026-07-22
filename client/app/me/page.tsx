"use client";

/**
 * /me hub —— tab bar's third destination, replacing the old modal-stack
 * ("/", SettingsModal, ProfileModal, LoginPrompt).
 *
 * Layout is a plain list of navigation cards, each linking to a dedicated
 * subroute that owns one concern. Two design commitments from the IA
 * rewrite:
 *
 * 1. Guest users see the SAME list, just with a "登录以同步" banner on
 *    top. Everything (avatar, language, tags) is editable in guest mode
 *    and gets pushed to the server on register via syncPrefsAfterAuth
 *    (existing wiring in useUser). Logout row becomes "注册"; account
 *    subpage handles the actual auth flow.
 *
 * 2. No nested modals. Each row is its own /me/<something> route so
 *    "改一件事 = 一次跳转 = 一屏就是那件事".
 *
 * Kept from the old /profile page (which this replaces): stats card,
 * PendingInvitationsPanel, match history. Those are read-only surfaces
 * that fit the hub. Everything editable moved out.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as api from "@/lib/api";
import PendingInvitationsPanel from "@/components/PendingInvitationsPanel";
import { useUser } from "@/hooks/useUser";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";

const LANG_LABEL: Record<string, string> = {
  zh: "中文", en: "英文", ja: "日文", ko: "韩文",
};

function readLang(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

interface RowProps {
  href: string;
  icon: string;
  title: string;
  value?: string;
}

function Row({ href, icon, title, value }: RowProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 px-4 py-3 bg-white border border-slate-200 rounded-2xl hover:border-sky-300 hover:shadow-sm transition"
    >
      <span className="text-2xl" aria-hidden>{icon}</span>
      <span className="flex-1 text-sm font-medium text-slate-900">{title}</span>
      {value && <span className="text-xs text-slate-500 truncate max-w-[60%]">{value}</span>}
      <span className="text-sky-500">›</span>
    </Link>
  );
}

export default function MePage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { selectedEntry } = useSelectedAvatar();

  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [langs, setLangs] = useState<{ sl: string; tl: string }>(() => ({
    sl: readLang("qv_sl", "zh"),
    tl: readLang("qv_tl", "en"),
  }));
  const [tagCount, setTagCount] = useState(0);

  const isGuest = !user?.isRegistered;

  // Refresh derived values whenever the page becomes visible (user comes
  // back from a subpage). No focus event needed — Next 15 re-renders on
  // route change automatically via /me/layout's mount lifecycle.
  useEffect(() => {
    setLangs({ sl: readLang("qv_sl", "zh"), tl: readLang("qv_tl", "en") });
    try {
      const raw = localStorage.getItem("qv_pendingTags");
      const parsed = raw ? JSON.parse(raw) : [];
      setTagCount(Array.isArray(parsed) ? parsed.length : 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (isGuest) return;
    setStatsLoading(true);
    api.getUserStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [isGuest]);

  if (userLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </main>
    );
  }

  const displayName = user?.username || "未命名";
  const langLabel = `${LANG_LABEL[langs.sl] || langs.sl} → ${LANG_LABEL[langs.tl] || langs.tl}`;

  return (
    <main className="max-w-md mx-auto px-4 pt-6 pb-6 flex flex-col gap-4">
      {/* 顶部身份卡 —— 头像 + 名称 + 状态 */}
      <section className="flex items-center gap-4 bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
        <div className={`qv-dark-surface w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br ${selectedEntry.tint}`}>
          <span className="text-4xl leading-none" aria-hidden>{selectedEntry.emoji}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-slate-900 truncate">
            {displayName}
          </p>
          {isGuest ? (
            <p className="text-[11px] text-amber-600 mt-0.5">未登录 · 数据仅存本机</p>
          ) : (
            <p className="text-[11px] text-emerald-600 mt-0.5">已登录</p>
          )}
        </div>
      </section>

      {/* guest 引导 banner —— 提示注册以跨设备同步 */}
      {isGuest && (
        <Link
          href="/me/account"
          className="flex items-center gap-3 bg-gradient-to-r from-sky-100 to-cyan-100 border border-sky-300 rounded-2xl px-4 py-3 hover:shadow-md hover:shadow-sky-500/20 transition"
        >
          <span className="text-2xl">✨</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">注册以跨设备同步</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              保留化身、语言、好友关系
            </p>
          </div>
          <span className="text-sky-600">→</span>
        </Link>
      )}

      {/* stats card —— 只登录才展示 */}
      {!isGuest && stats && (
        <section className="flex gap-6 justify-around bg-white border border-slate-200 rounded-2xl px-6 py-4">
          <div className="text-center">
            <p className="text-xl font-bold text-slate-900">{stats.matchCount || 0}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">匹配次数</p>
          </div>
          <div className="w-px bg-slate-200" />
          <div className="text-center">
            <p className="text-xl font-bold text-slate-900">
              {formatMinutes(stats.totalDuration || 0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">累计通话</p>
          </div>
        </section>
      )}

      {!isGuest && statsLoading && !stats && (
        <div className="flex justify-center py-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
        </div>
      )}

      {/* 邀请面板 —— 老 /profile 里已经有,直接挂过来 */}
      {!isGuest && <PendingInvitationsPanel />}

      {/* --- 分组一:个人化 --- */}
      <section className="flex flex-col gap-2">
        <p className="text-[11px] text-slate-500 tracking-wider uppercase pl-2">个人化</p>
        <Row href="/avatars" icon="🎭" title="化身" value={selectedEntry.name} />
        <Row href="/me/language" icon="🌐" title="通话语言" value={langLabel} />
        <Row href="/me/tags" icon="🏷️" title="兴趣标签" value={tagCount > 0 ? `${tagCount} 个` : "未选"} />
      </section>

      {/* --- 分组二:账号 --- */}
      <section className="flex flex-col gap-2">
        <p className="text-[11px] text-slate-500 tracking-wider uppercase pl-2">账号</p>
        <Row
          href="/me/account"
          icon={isGuest ? "🔑" : "🪪"}
          title={isGuest ? "登录 / 注册" : "账号 · 邀请码"}
        />
      </section>

      {/* --- 分组三:偏好 --- */}
      <section className="flex flex-col gap-2">
        <p className="text-[11px] text-slate-500 tracking-wider uppercase pl-2">偏好</p>
        <Row href="/me/privacy" icon="🛡️" title="隐私 · 权限" />
        <Row href="/me/about" icon="ℹ️" title="关于 · 反馈" />
      </section>

      {/* 登出 —— 只登录才显示,单独一块 */}
      {!isGuest && (
        <button
          type="button"
          onClick={() => router.push("/me/account?logout=1")}
          className="mt-4 text-xs text-rose-500 hover:text-rose-700 py-2 text-center"
        >
          退出登录
        </button>
      )}
    </main>
  );
}

function formatMinutes(ms: number): string {
  if (!ms) return "0 分";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} 分`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h${rem}m` : `${hours}h`;
}
