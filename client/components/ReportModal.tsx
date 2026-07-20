"use client";

import { useState, useEffect } from "react";

export const REPORT_CATEGORIES = [
  { key: "harass",    label: "骚扰 / 辱骂",       emoji: "🚫" },
  { key: "adult",     label: "裸露 / 成人内容",   emoji: "🔞" },
  { key: "scam",      label: "骗子 / 推销",       emoji: "💸" },
  { key: "minor",     label: "疑似未成年",         emoji: "🧒" },
  { key: "other",     label: "其他",              emoji: "📝" },
] as const;

export type ReportCategory = typeof REPORT_CATEGORIES[number]["key"];

interface Props {
  /** Displayed partner name for confirmation ("举报 <name>?"). */
  partnerName: string;
  /** Called with the categorized reason (or free-text for "其他"). Parent is
   *  responsible for the actual `reportUser()` API call + adding to blocklist. */
  onSubmit: (categoryKey: ReportCategory, freeText: string) => void;
  onDismiss: () => void;
}

/** Categorized report form. Replaces the old empty-text `reportUser` — the
 *  server gets a labeled reason so moderation can prioritize / bucket. */
export default function ReportModal({ partnerName, onSubmit, onDismiss }: Props) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onDismiss]);

  const canSubmit = category !== null && !submitting && (category !== "other" || freeText.trim().length > 0);

  const handleSubmit = () => {
    if (!canSubmit || !category) return;
    setSubmitting(true);
    onSubmit(category, freeText.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white border border-slate-200 p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <span className="text-rose-600">🚨</span>
            <span>举报 <span className="text-slate-600 font-normal">{partnerName}</span></span>
          </h3>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭"
            className="w-7 h-7 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-slate-600">
          选择举报理由。 提交后 TA 会加入你的黑名单,后续匹配自动跳过。
        </p>

        <div className="grid grid-cols-1 gap-2">
          {REPORT_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-left transition ${
                category === c.key
                  ? "bg-red-600/20 border border-red-500/60 text-red-100"
                  : "bg-white/[0.03] border border-slate-200 text-slate-800 hover:border-slate-200 hover:bg-white/[0.06]"
              }`}
            >
              <span className="text-lg">{c.emoji}</span>
              <span className="flex-1">{c.label}</span>
              {category === c.key && <span className="text-rose-600">✓</span>}
            </button>
          ))}
        </div>

        {category === "other" && (
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="简单描述问题(必填)"
            maxLength={200}
            rows={3}
            className="w-full rounded-xl bg-white/[0.03] border border-slate-200 focus:border-slate-200 outline-none px-3 py-2 text-sm text-slate-900 placeholder-neutral-600 resize-none"
          />
        )}

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full rounded-2xl px-6 py-3 text-sm font-semibold transition ${
              canSubmit
                ? "bg-red-600 hover:bg-red-500 text-slate-900 shadow-lg shadow-red-600/25"
                : "bg-slate-100 text-slate-500 cursor-not-allowed border border-slate-200"
            }`}
          >
            {submitting ? "提交中…" : "提交举报"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-slate-500 hover:text-slate-700 transition py-2"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
