"use client";

import { useState, useEffect } from "react";

/** First-visit welcome + community guidelines gate.
 *
 *  Deliberately NOT an age gate — QVideoChat 是面向各年龄段的语言学习与
 *  友善交流平台,不做 18+ 门槛。1.4 之前的年龄声明已移除;老用户
 *  localStorage 里的 qv_age_confirmed / qv_age_refused 记录会顺路清掉,
 *  即使当年选过"未满 18 岁 / 不同意"的人也能重新进入。
 *
 *  Users only need to acknowledge the community norms once; the flag lives in
 *  localStorage so a fresh browser will see it again. There is no "later"
 *  button — reading three sentences before joining a live-video product is
 *  a reasonable ask. */

interface Props {
  onAccept: () => void;
}

const GUIDELINES_KEY = "qv_guidelines_accepted";
// v1.3 age gate keys — cleared on load so returning users don't stay blocked
// by a policy we no longer enforce.
const LEGACY_AGE_KEY = "qv_age_confirmed";
const LEGACY_REFUSE_KEY = "qv_age_refused";

export function needsCommunityGate(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(GUIDELINES_KEY) !== "1";
  } catch { return false; }
}

/** Retained for API compatibility with older callers — always false now. */
export function hasRefusedAge(): boolean {
  return false;
}

export default function CommunityGuidelinesModal({ onAccept }: Props) {
  const [guidelinesOk, setGuidelinesOk] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Migrate away from the legacy age-gate keys so users who ticked them in
    // v1.3 don't carry a stale "refused" record forward.
    try {
      localStorage.removeItem(LEGACY_AGE_KEY);
      localStorage.removeItem(LEGACY_REFUSE_KEY);
    } catch { /* ignore */ }
    setGuidelinesOk(localStorage.getItem(GUIDELINES_KEY) === "1");
  }, []);

  const commit = () => {
    try {
      localStorage.setItem(GUIDELINES_KEY, "1");
    } catch { /* ignore */ }
    onAccept();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-neutral-900 border border-white/10 p-6 flex flex-col gap-5">
        <div className="text-center">
          <div className="text-4xl mb-2">🌏</div>
          <h2 className="text-xl font-bold">欢迎来到 QVideoChat</h2>
          <p className="text-neutral-200 text-sm mt-2 font-medium tracking-wide">
            以你想要的样子,遇见世界
          </p>
          <p className="text-neutral-500 text-[10px] mt-1.5">
            练语言 · 交朋友 · 见世界 · 一起成长
          </p>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">🤝</span>
            <div>
              <p className="font-medium text-neutral-100">尊重每一位新朋友</p>
              <p className="text-neutral-500 text-xs mt-0.5">
                友善交流,不发表歧视、辱骂或骚扰性言论
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">🗣️</span>
            <div>
              <p className="font-medium text-neutral-100">开放式话题,鼓励练语言</p>
              <p className="text-neutral-500 text-xs mt-0.5">
                聊兴趣、聊学习、聊各自的文化,让每一次相遇都有收获
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">🛡️</span>
            <div>
              <p className="font-medium text-neutral-100">遇到不当行为请举报</p>
              <p className="text-neutral-500 text-xs mt-0.5">
                通话中的"举报"按钮一键提交,我们会认真审核
              </p>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl bg-white/[0.02] border border-white/10 p-3 cursor-pointer hover:border-white/25 transition">
          <input
            type="checkbox"
            checked={guidelinesOk}
            onChange={(e) => setGuidelinesOk(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded accent-sky-500"
          />
          <span className="text-sm text-neutral-200 leading-tight">
            我已阅读并同意上述社区准则
          </span>
        </label>

        <button
          type="button"
          onClick={commit}
          disabled={!guidelinesOk}
          className={`w-full rounded-2xl px-6 py-3 text-sm font-semibold transition ${
            guidelinesOk
              ? "bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-500 hover:from-sky-500 hover:via-cyan-500 hover:to-emerald-600 text-white shadow-lg shadow-emerald-500/30"
              : "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/5"
          }`}
        >
          进入 QVideoChat
        </button>
      </div>
    </div>
  );
}
