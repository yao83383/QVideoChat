"use client";

import { useState } from "react";
import TagSelector from "@/components/TagSelector";

/** Fires once for a first-time visitor: interest tags → preferred languages
 *  → camera permission. The parent (`page.tsx`) mounts this behind the
 *  `qv_onboarded` localStorage flag and dismisses it via `onComplete`, which
 *  writes the flag so the wizard never fires again for this browser. */
interface Props {
  show: boolean;
  /** Called when the user finishes or dismisses the wizard. Parent should
   *  set `qv_onboarded=1` + `qv_onboarded_at=<timestamp>` in localStorage. */
  onComplete: () => void;
  /** Step-3 primary action. Parent invokes its useFaceMesh `start()` here,
   *  so the permission prompt appears as a direct response to the user's
   *  click (satisfying browser gesture requirements). */
  onOpenCamera: () => Promise<void> | void;
  /** Optional side-exit from step 3: users who won't/can't allow the camera
   *  jump straight to /avatars to pick a body first. Parent should also call
   *  onComplete before routing, so the wizard doesn't re-fire on return. */
  onGoToAvatars?: () => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

const LANGUAGES = [
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
];

function loadLang(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function logSkip(step: number) {
  try {
    const key = `qv_onboarding_skip_step${step}`;
    const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
}

export default function OnboardingWizard({
  show,
  onComplete,
  onOpenCamera,
  onGoToAvatars,
  selectedTags,
  onTagsChange,
}: Props) {
  const [step, setStep] = useState(0);
  const [sl, setSl] = useState(() => loadLang("qv_sl", "zh"));
  const [tl, setTl] = useState(() => loadLang("qv_tl", "en"));
  const [cameraBusy, setCameraBusy] = useState(false);

  if (!show) return null;

  const persistLang = () => {
    try {
      localStorage.setItem("qv_sl", JSON.stringify(sl));
      localStorage.setItem("qv_tl", JSON.stringify(tl));
    } catch { /* ignore */ }
  };

  const next = () => {
    if (step === 1) persistLang();
    setStep((s) => s + 1);
  };

  const skip = () => {
    logSkip(step);
    if (step === 1) persistLang(); // still save any language they picked before skipping
    if (step < 2) setStep((s) => s + 1);
    else onComplete();
  };

  const openCamera = async () => {
    setCameraBusy(true);
    try {
      await onOpenCamera();
    } finally {
      setCameraBusy(false);
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
      {/* Step indicator: current is a wide bar, past are dots, upcoming are ghost dots */}
      <div className="flex items-center gap-2 mb-10">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === step
                ? "w-10 bg-white"
                : i < step
                ? "w-2 bg-white/80"
                : "w-2 bg-white/20"
            }`}
          />
        ))}
      </div>

      <div className="w-full max-w-md flex flex-col items-center gap-6">
        {step === 0 && (
          <>
            <div className="text-center">
              <div className="text-5xl mb-3">🎯</div>
              <h2 className="text-2xl font-bold mb-2">你想聊什么?</h2>
              <p className="text-neutral-400 text-sm">
                选 1-3 个兴趣,匹配系统会用它们帮你找聊得来的人。
              </p>
            </div>
            <div className="w-full">
              <TagSelector selected={selectedTags} onChange={onTagsChange} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="text-center">
              <div className="text-5xl mb-3">🌐</div>
              <h2 className="text-2xl font-bold mb-2">用什么语言聊?</h2>
              <p className="text-neutral-400 text-sm">
                跨语言也能聊——对方说的话会实时翻译成你的语言。
              </p>
            </div>
            <div className="w-full space-y-5">
              <div>
                <p className="text-xs text-neutral-500 mb-3 text-center">我说的语言</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {LANGUAGES.map((l) => (
                    <button
                      key={`src-${l.code}`}
                      onClick={() => setSl(l.code)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        sl === l.code
                          ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30"
                          : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
                      }`}
                    >
                      <span className="mr-1">{l.flag}</span>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-3 text-center">对方的话翻译成</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {LANGUAGES.filter((l) => l.code !== sl).map((l) => (
                    <button
                      key={`tgt-${l.code}`}
                      onClick={() => setTl(l.code)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        tl === l.code
                          ? "bg-pink-600 text-white shadow-lg shadow-pink-600/30"
                          : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
                      }`}
                    >
                      <span className="mr-1">{l.flag}</span>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="text-center">
              <div className="text-5xl mb-3">🎭</div>
              <h2 className="text-2xl font-bold mb-2">让化身认识你</h2>
              <p className="text-neutral-400 text-sm max-w-sm mx-auto leading-relaxed">
                打开摄像头,把脸对准镜头。Q 版化身会跟着你笑、眨眼、说话,同步 60fps。
              </p>
              <p className="text-neutral-500 text-xs mt-3 max-w-sm mx-auto">
                真实画面只在本机跑识别,不会离开你的设备。
              </p>
            </div>
          </>
        )}

        {/* CTA + skip. Layout is a stack so the skip link never fights the primary
            action for tap targets on mobile. */}
        <div className="w-full flex flex-col gap-3 items-center mt-4">
          {step === 2 ? (
            <>
              <button
                onClick={openCamera}
                disabled={cameraBusy}
                className="w-full rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-8 py-3.5 text-base font-semibold shadow-xl shadow-purple-500/30 disabled:opacity-50 transition"
              >
                {cameraBusy ? "正在打开..." : "打开摄像头"}
              </button>
              {onGoToAvatars && (
                <button
                  onClick={() => {
                    try {
                      const key = "qv_onboarding_side_avatar";
                      const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
                      localStorage.setItem(key, String(n));
                    } catch { /* ignore */ }
                    onComplete();
                    onGoToAvatars();
                  }}
                  className="text-xs text-purple-300 hover:text-purple-200 transition py-1"
                >
                  或者先挑一个化身 →
                </button>
              )}
            </>
          ) : (
            <button
              onClick={next}
              className="w-full rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-8 py-3.5 text-base font-semibold shadow-xl shadow-purple-500/30 transition"
            >
              下一步
            </button>
          )}
          <button
            onClick={skip}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition py-2"
          >
            {step === 2 ? "以后再说" : "跳过"}
          </button>
        </div>
      </div>
    </div>
  );
}
