"use client";

import { useEffect, useRef, useState } from "react";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sourceText || translatedText) {
      setVisible(true);
    }
  }, [sourceText, translatedText]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [translatedText]);

  if (!visible || (!sourceText && !translatedText)) return null;

  return (
    <div className="relative w-full max-w-md mx-auto mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-neutral-500">AI 实时翻译</span>
        <span className="text-[10px] text-neutral-600">
          {sourceLang} → {targetLang}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-24 overflow-y-auto rounded-lg bg-neutral-900/80 border border-neutral-800 p-2 text-xs"
      >
        {sourceText && (
          <p className="text-neutral-500 mb-0.5 leading-relaxed">{sourceText}</p>
        )}
        {translatedText && (
          <p className="text-green-400 leading-relaxed">{translatedText}</p>
        )}
        {!sourceText && !translatedText && (
          <p className="text-neutral-600 italic">等待语音输入...</p>
        )}
      </div>
    </div>
  );
}
