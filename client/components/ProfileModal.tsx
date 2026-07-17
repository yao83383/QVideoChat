"use client";

import { useEffect, useState } from "react";
import TagSelector from "@/components/TagSelector";
import LangFilterBar from "@/components/LangFilterBar";

/**
 * "我的资料" modal — the single place users edit the three things that
 * used to clutter the home page: display name, source/target language,
 * and interest tags. See memory:oc-platform-vision for the framing that
 * pushed for a minimal home ("头像 + 匹配按钮" hero, everything else
 * behind a modal).
 *
 * Composition rules:
 *  - Registered users see their real username readonly + a link to the
 *    profile page for full edits. Guests see the auto-generated
 *    "未知'原创'角色N" name plus a "重新抽签" button.
 *  - Language / tags are pass-through to the existing widgets — no need
 *    to reimplement their storage or api hooks; both already persist
 *    to localStorage the same keys the home page and match server read.
 *
 * The modal is intentionally NOT a Tab of SettingsModal — settings is
 * for device-level toggles (mic/cam/ui), profile is for identity. Users
 * open profile 10× more often, so it deserves its own top-level entry.
 */

interface Props {
  show: boolean;
  onClose: () => void;
  /** Auto-generated when the user is a guest; the parent already owns it
   *  via useGuestName. Passed in so this modal doesn't have to duplicate
   *  the hook (which would re-generate on modal mount). */
  guestName: string;
  onRegenerateGuestName: () => void;
  /** null when the user hasn't signed in; the real UserState.username
   *  otherwise. Modal reads-only in the registered case; profile page is
   *  the canonical edit surface. */
  registeredUsername: string | null;
  /** Interest tag names (persist via qv_pendingTags in localStorage,
   *  same shape as the old TagSelector on the home page). */
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export default function ProfileModal({
  show,
  onClose,
  guestName,
  onRegenerateGuestName,
  registeredUsername,
  selectedTags,
  onTagsChange,
}: Props) {
  // Close on Escape so the modal feels responsive to the ambient keyboard-
  // driver behaviour users get on desktop. Guarded by `show` so we don't
  // eat keys when hidden.
  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-gradient-to-br from-neutral-900 via-neutral-950 to-black border border-white/10 shadow-2xl p-5 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sky-400 text-[10px] font-semibold tracking-widest uppercase">
              Profile
            </p>
            <h2 className="text-lg font-semibold mt-0.5">我的资料</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition"
          >
            ×
          </button>
        </div>

        {/* --- Identity block --- */}
        <section className="flex flex-col gap-2">
          <label className="text-[11px] text-neutral-400 tracking-wide uppercase">
            身份
          </label>
          {registeredUsername ? (
            <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
              <span className="text-lg" aria-hidden>👤</span>
              <span className="text-sm font-medium truncate">
                {registeredUsername}
              </span>
              <span className="ml-auto text-[10px] text-green-400 font-semibold uppercase tracking-wide">
                已登录
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                <span className="text-lg" aria-hidden>🎭</span>
                <span className="text-sm font-medium truncate flex-1">
                  {guestName || "抽取中…"}
                </span>
                <button
                  type="button"
                  onClick={onRegenerateGuestName}
                  className="text-[11px] text-sky-300 hover:text-sky-100 hover:underline whitespace-nowrap"
                  title="重新抽一个"
                >
                  重抽 ⟳
                </button>
              </div>
              <p className="text-[10px] text-neutral-500 leading-relaxed">
                你现在是未登录的"原创角色"。登录后可保留昵称、好友、配置。
              </p>
            </div>
          )}
        </section>

        {/* --- Language block --- */}
        <section className="flex flex-col gap-2">
          <label className="text-[11px] text-neutral-400 tracking-wide uppercase">
            通话语言
          </label>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <LangFilterBar />
          </div>
          <p className="text-[10px] text-neutral-500">
            "我说的语言 → 想听到的语言"。字幕翻译走这个方向。
          </p>
        </section>

        {/* --- Interest tags block --- */}
        <section className="flex flex-col gap-2">
          <label className="text-[11px] text-neutral-400 tracking-wide uppercase">
            兴趣标签
          </label>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <TagSelector selected={selectedTags} onChange={onTagsChange} />
          </div>
          <p className="text-[10px] text-neutral-500">
            匹配算法根据标签重合度优先撮合。不选也能匹配,但更随机。
          </p>
        </section>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 px-6 py-3 text-sm font-semibold shadow-lg shadow-sky-500/20 transition"
        >
          完成
        </button>
      </div>
    </div>
  );
}
