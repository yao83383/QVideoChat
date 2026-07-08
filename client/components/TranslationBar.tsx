"use client";

import { useEffect, useRef } from "react";

interface TranslationBarProps {
  sourceText: string | null;
  translatedText: string | null;
  sourceLang?: string;
  targetLang?: string;
}

export default function TranslationBar({
  sourceText,
  translatedText,
  sourceLang = "zh",
  targetLang = "en",
}: TranslationBarProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [sourceText, translatedText]);

  if (!sourceText && !translatedText) return null;

  return (
    <div ref={ref} className="absolute bottom-20 left-0 right-0 mx-auto max-w-lg px-4 z-10 pointer-events-none">
      <div className="rounded-xl bg-black/60 backdrop-blur-sm border border-white/10 px-4 py-3">
        {sourceText && (
          <p className="text-white/80 text-sm leading-snug">{sourceText}</p>
        )}
        {translatedText && (
          <p className="text-green-300 text-sm leading-snug mt-0.5">
            {translatedText}
          </p>
        )}
        <div className="flex items-center gap-1 mt-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
          <span className="text-[9px] text-white/30">AI · {sourceLang} → {targetLang}</span>
        </div>
      </div>
    </div>
  );
}
