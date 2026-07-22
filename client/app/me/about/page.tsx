"use client";

/**
 * /me/about —— 版本 + 反馈联系方式.
 *
 * 简短页,只承载三件事:版本号(原本挂在首页角落)、联系邮箱、
 * 社区准则回顾入口(用户想再看一次的时候,不必等浏览器 localStorage
 * 被清才能看到)。
 */

import MeSubShell from "@/components/MeSubShell";
import { useState } from "react";
import CommunityGuidelinesModal from "@/components/CommunityGuidelinesModal";

export default function MeAboutPage() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
  const [showGuidelines, setShowGuidelines] = useState(false);

  return (
    <MeSubShell title="关于 · 反馈">
      <section className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 via-cyan-400 to-amber-400 flex items-center justify-center text-2xl shadow">
            🌏
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">QVideoChat</p>
            <p className="text-[11px] text-slate-500">以你想要的样子,遇见世界</p>
          </div>
        </div>
        <div className="text-xs text-slate-500 flex justify-between border-t border-slate-100 pt-3">
          <span>版本</span>
          <span className="font-mono text-slate-700">v{version}</span>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col gap-3">
        <p className="text-sm font-medium text-slate-900">联系我们</p>
        <a
          href="mailto:contact@justsaysayforfun.com"
          className="text-xs text-sky-600 hover:text-sky-800 transition font-mono"
        >
          contact@justsaysayforfun.com
        </a>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          反馈、举报、账户申诉、商务合作,一封邮件即可。我们通常在 48 小时内回复。
        </p>
      </section>

      <button
        type="button"
        onClick={() => setShowGuidelines(true)}
        className="rounded-2xl bg-white border border-slate-200 hover:border-sky-300 p-4 flex items-center gap-3 transition"
      >
        <span className="text-2xl">📜</span>
        <span className="flex-1 text-left text-sm text-slate-900">社区准则</span>
        <span className="text-sky-500">›</span>
      </button>

      {showGuidelines && (
        <CommunityGuidelinesModal onAccept={() => setShowGuidelines(false)} />
      )}
    </MeSubShell>
  );
}
