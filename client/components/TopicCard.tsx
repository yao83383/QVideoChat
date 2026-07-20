"use client";

import { useState } from "react";

interface TopicCardProps {
  text: string;
  category?: string;
}

const CATEGORY_EMOJI: Record<string, string> = {
  general: '💬',
  game: '🎮',
  music: '🎵',
  travel: '✈️',
  food: '🍜',
  study: '📚',
  tech: '💻',
  movie: '🎬',
  fitness: '🏃',
  talk: '🌙',
  anime: '🎌',
  pet: '🐾',
};

export default function TopicCard({ text, category = 'general' }: TopicCardProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !text) return null;

  return (
    <div className="relative mx-auto max-w-xs rounded-xl bg-gradient-to-r from-sky-900/40 to-blue-900/40 border border-sky-800/50 p-3 shadow-lg">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-1 right-2 text-slate-400 hover:text-slate-600 text-xs leading-none"
        title="关闭"
      >
        ✕
      </button>
      <div className="flex items-start gap-2 pr-4">
        <span className="text-lg leading-none mt-0.5">
          {CATEGORY_EMOJI[category] || '💬'}
        </span>
        <div>
          <p className="text-[11px] text-slate-500 mb-1">AI 建议话题</p>
          <p className="text-sm text-sky-200 leading-snug">{text}</p>
        </div>
      </div>
    </div>
  );
}
