"use client";

import { useState, useEffect } from "react";

interface Lang { code: string; label: string; flag: string; }

const LANGS: Lang[] = [
  { code: "zh", label: "中文",     flag: "🇨🇳" },
  { code: "en", label: "English",  flag: "🇺🇸" },
  { code: "ja", label: "日本語",   flag: "🇯🇵" },
  { code: "ko", label: "한국어",   flag: "🇰🇷" },
];

function loadPref(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function savePref(key: string, value: string) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

interface Props {
  /** Fires whenever the user changes either language so the parent can pass
   *  the fresh values into `joinMatch`. Also useful for preload triggers. */
  onChange?: (sourceLang: string, targetLang: string) => void;
}

/** Compact language filter for the home page. Persists to `qv_sl` / `qv_tl`
 *  in localStorage — the same keys the OnboardingWizard writes and RoomClient
 *  reads for subtitle translation. Users get one canonical language pref
 *  that flows through matching and in-room subtitles. */
export default function LangFilterBar({ onChange }: Props) {
  const [sl, setSl] = useState(() => loadPref("qv_sl", "zh"));
  const [tl, setTl] = useState(() => loadPref("qv_tl", "en"));

  // Emit on mount too so parent sees the persisted values without needing its
  // own localStorage read.
  useEffect(() => { onChange?.(sl, tl); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickSl = (code: string) => {
    setSl(code);
    savePref("qv_sl", code);
    // Force different targetLang if the user picks their old target as the source.
    let newTl = tl;
    if (code === tl) {
      const alt = LANGS.find((l) => l.code !== code)!.code;
      newTl = alt;
      setTl(alt);
      savePref("qv_tl", alt);
    }
    onChange?.(code, newTl);
    try {
      const key = `qv_matchpref_sl_${code}`;
      localStorage.setItem(key, String(parseInt(localStorage.getItem(key) || "0", 10) + 1));
    } catch { /* ignore */ }
  };

  const pickTl = (code: string) => {
    if (code === sl) return; // guarded in UI too, but be safe
    setTl(code);
    savePref("qv_tl", code);
    onChange?.(sl, code);
    try {
      const key = `qv_matchpref_tl_${code}`;
      localStorage.setItem(key, String(parseInt(localStorage.getItem(key) || "0", 10) + 1));
    } catch { /* ignore */ }
  };

  return (
    <div className="w-full max-w-sm flex flex-col gap-2">
      <p className="text-[10px] text-neutral-500 tracking-widest text-center uppercase">匹配语言偏好</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-neutral-500 w-8 shrink-0">我说</span>
        <div className="flex flex-wrap gap-1.5 justify-center flex-1">
          {LANGS.map((l) => (
            <button
              key={`sl-${l.code}`}
              type="button"
              onClick={() => pickSl(l.code)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                sl === l.code
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 border border-neutral-700"
              }`}
              title={l.label}
            >
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-neutral-500 w-8 shrink-0">对方</span>
        <div className="flex flex-wrap gap-1.5 justify-center flex-1">
          {LANGS.map((l) => {
            const disabled = l.code === sl;
            return (
              <button
                key={`tl-${l.code}`}
                type="button"
                onClick={() => pickTl(l.code)}
                disabled={disabled}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  tl === l.code && !disabled
                    ? "bg-pink-600 text-white shadow-md shadow-pink-600/30"
                    : disabled
                    ? "bg-neutral-900 text-neutral-700 border border-neutral-800 cursor-not-allowed"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 border border-neutral-700"
                }`}
                title={disabled ? "不能和我说的一样" : l.label}
              >
                {l.flag} {l.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
