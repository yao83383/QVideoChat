"use client";

import type { AvatarEntry } from "@/lib/avatars";

interface Props {
  entry: AvatarEntry;
  /** True when this avatar is currently the user's active one — parent reads
   *  it from `useSelectedAvatar` so cards refresh consistently. */
  selected: boolean;
  onClick: () => void;
}

/** Compact catalog tile. Uses the entry's emoji as a lightweight thumbnail so
 *  we can render all six at once without instantiating six three.js scenes.
 *  The full 3D preview lives in the click-through modal.
 *
 *  Emoji thumbnail 内层保留深底槽 (qv-dark-surface) 作为化身"聚光灯"效果,
 *  和白色页面底形成分层;外框翻浅色调,和页面基调协调。 */
export default function AvatarCard({ entry, selected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-3xl bg-gradient-to-br ${entry.tint} border-2 transition p-5 flex flex-col items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-sky-400/50 ${
        selected
          ? "border-emerald-400 shadow-lg shadow-emerald-500/25"
          : "border-slate-200 hover:border-sky-400 hover:shadow-md hover:shadow-sky-500/15"
      }`}
    >
      <div className="qv-dark-surface relative aspect-square w-full rounded-2xl flex items-center justify-center overflow-hidden">
        <span className="text-7xl select-none" aria-hidden>{entry.emoji}</span>
        {selected && (
          <span className="absolute top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white select-none shadow shadow-emerald-500/40">
            使用中
          </span>
        )}
      </div>
      <div className="w-full text-center">
        <p className="text-base font-semibold leading-tight text-slate-900">{entry.name}</p>
        <p className="text-xs text-slate-600 mt-1 line-clamp-2">{entry.tagline}</p>
      </div>
    </button>
  );
}
