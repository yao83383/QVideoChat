"use client";

/**
 * /me/language —— 编辑通话语言对(源语言 → 目标语言).
 *
 * 直接复用 LangFilterBar,这是唯一入口(老 ProfileModal 已删)。
 * Guest 和登录状态都能改;登录时 syncPrefsAfterAuth 已在下次登录时
 * 反向拉取服务端权威值。
 */

import MeSubShell from "@/components/MeSubShell";
import LangFilterBar from "@/components/LangFilterBar";

export default function MeLanguagePage() {
  return (
    <MeSubShell
      title="通话语言"
      subtitle="我说的语言 → 想听到的语言。字幕翻译走这个方向。"
    >
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <LangFilterBar />
      </div>
    </MeSubShell>
  );
}
