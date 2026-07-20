"use client";

import { useState, useRef, useEffect } from "react";

export interface LanguageOption {
  code: string;
  label: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
];

interface LanguageSelectorProps {
  sourceLang: string;
  targetLang: string;
  subtitleEnabled: boolean;
  onSourceChange: (lang: string) => void;
  onTargetChange: (lang: string) => void;
  onSubtitleToggle: () => void;
}

export default function LanguageSelector({
  sourceLang,
  targetLang,
  subtitleEnabled,
  onSourceChange,
  onTargetChange,
  onSubtitleToggle,
}: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const sourceLabel = LANGUAGES.find((l) => l.code === sourceLang) || LANGUAGES[0];
  const targetLabel = LANGUAGES.find((l) => l.code === targetLang) || LANGUAGES[1];

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {/* Subtitle toggle */}
      <button
        onClick={onSubtitleToggle}
        className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition ${
          subtitleEnabled
            ? "bg-sky-700/40 border border-sky-600 text-sky-300"
            : "bg-slate-100 border border-slate-300 text-slate-500"
        }`}
        title={subtitleEnabled ? "关闭 AI 字幕" : "开启 AI 字幕"}
      >
        <span className="text-[10px]">{subtitleEnabled ? "🟢" : "⚪"}</span>
        AI字幕
      </button>

      {subtitleEnabled && (
        <>
          {/* Language pair selector */}
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 rounded-full bg-slate-100 border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-sky-400 transition"
          >
            <span>{sourceLabel.flag}</span>
            <span className="text-slate-500">→</span>
            <span>{targetLabel.flag}</span>
          </button>

          {open && (
            <div className="absolute top-full mt-2 left-0 bg-white border border-slate-300 rounded-xl p-3 shadow-xl z-50 min-w-[200px]">
              <p className="text-[10px] text-slate-500 mb-2">我的语言</p>
              <div className="flex gap-1 flex-wrap mb-3">
                {LANGUAGES.map((l) => (
                  <button
                    key={`src-${l.code}`}
                    onClick={() => { onSourceChange(l.code); setOpen(false); }}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition ${
                      sourceLang === l.code
                        ? "bg-sky-700/30 border border-sky-600 text-sky-300"
                        : "bg-slate-100 border border-slate-300 text-slate-600 hover:border-sky-400"
                    }`}
                  >
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mb-2">翻译为</p>
              <div className="flex gap-1 flex-wrap">
                {LANGUAGES.filter((l) => l.code !== sourceLang).map((l) => (
                  <button
                    key={`tgt-${l.code}`}
                    onClick={() => { onTargetChange(l.code); setOpen(false); }}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition ${
                      targetLang === l.code
                        ? "bg-green-700/30 border border-green-600 text-green-300"
                        : "bg-slate-100 border border-slate-300 text-slate-600 hover:border-sky-400"
                    }`}
                  >
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
