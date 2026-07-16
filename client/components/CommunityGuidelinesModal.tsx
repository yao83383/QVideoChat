"use client";

import { useState, useEffect } from "react";

/** First-visit gate. Blocks the app until the user has both:
 *   1. Confirmed they are >= 18 years old
 *   2. Acknowledged the community guidelines
 *
 *  Both signals are persisted separately so we can display which one is
 *  missing if needed for support debugging. There is no "later" button —
 *  legal + compliance surface must be positively acknowledged.
 *
 *  Users who refuse the age gate see a permanent block screen (can be undone
 *  by clearing localStorage, which is fine for anyone genuinely 18+ who
 *  clicked wrong). */
interface Props {
  onAccept: () => void;
}

const AGE_KEY = "qv_age_confirmed";
const GUIDELINES_KEY = "qv_guidelines_accepted";
const REFUSE_KEY = "qv_age_refused";

export function needsCommunityGate(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AGE_KEY) !== "1" || localStorage.getItem(GUIDELINES_KEY) !== "1";
  } catch { return false; }
}

export function hasRefusedAge(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(REFUSE_KEY) === "1"; }
  catch { return false; }
}

export default function CommunityGuidelinesModal({ onAccept }: Props) {
  const [ageOk, setAgeOk] = useState(false);
  const [guidelinesOk, setGuidelinesOk] = useState(false);
  const [refused, setRefused] = useState(() => hasRefusedAge());

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAgeOk(localStorage.getItem(AGE_KEY) === "1");
    setGuidelinesOk(localStorage.getItem(GUIDELINES_KEY) === "1");
  }, []);

  const commit = () => {
    try {
      localStorage.setItem(AGE_KEY, "1");
      localStorage.setItem(GUIDELINES_KEY, "1");
      localStorage.removeItem(REFUSE_KEY);
    } catch { /* ignore */ }
    onAccept();
  };

  const refuse = () => {
    try {
      localStorage.setItem(REFUSE_KEY, "1");
    } catch { /* ignore */ }
    setRefused(true);
  };

  if (refused) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-4">🚫</div>
        <h2 className="text-xl font-bold mb-2">很抱歉</h2>
        <p className="text-neutral-400 text-sm max-w-sm">
          QVideoChat 是面向 18 岁及以上用户的社交产品。
        </p>
        <p className="text-neutral-500 text-xs mt-8">如果这是误操作,请清除浏览器数据后重新进入。</p>
      </div>
    );
  }

  const canProceed = ageOk && guidelinesOk;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-neutral-900 border border-white/10 p-6 flex flex-col gap-5">
        <div className="text-center">
          <div className="text-4xl mb-2">🛡️</div>
          <h2 className="text-xl font-bold">欢迎加入 QVideoChat</h2>
          <p className="text-neutral-400 text-xs mt-1">在开始之前,请先了解我们的社区准则</p>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">💚</span>
            <div>
              <p className="font-medium text-neutral-100">尊重每一位陌生人</p>
              <p className="text-neutral-500 text-xs mt-0.5">不发表歧视、辱骂、骚扰性言论</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">🔞</span>
            <div>
              <p className="font-medium text-neutral-100">禁止未成年内容</p>
              <p className="text-neutral-500 text-xs mt-0.5">不上传、不索取任何涉及未成年人的敏感内容</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">🚨</span>
            <div>
              <p className="font-medium text-neutral-100">见到不良行为请举报</p>
              <p className="text-neutral-500 text-xs mt-0.5">通话中的"举报"按钮一键提交,我们会快速审核</p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          <label className="flex items-start gap-3 rounded-xl bg-white/[0.02] border border-white/10 p-3 cursor-pointer hover:border-white/25 transition">
            <input
              type="checkbox"
              checked={ageOk}
              onChange={(e) => setAgeOk(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-purple-500"
            />
            <span className="text-sm text-neutral-200 leading-tight">
              我已满 18 岁
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl bg-white/[0.02] border border-white/10 p-3 cursor-pointer hover:border-white/25 transition">
            <input
              type="checkbox"
              checked={guidelinesOk}
              onChange={(e) => setGuidelinesOk(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-purple-500"
            />
            <span className="text-sm text-neutral-200 leading-tight">
              我已阅读并同意上述社区准则
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={commit}
            disabled={!canProceed}
            className={`w-full rounded-2xl px-6 py-3 text-sm font-semibold transition ${
              canProceed
                ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/30"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/5"
            }`}
          >
            进入 QVideoChat
          </button>
          <button
            type="button"
            onClick={refuse}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition py-2"
          >
            我未满 18 岁 / 不同意
          </button>
        </div>
      </div>
    </div>
  );
}
