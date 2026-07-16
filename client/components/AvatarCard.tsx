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
 *  The full 3D preview lives in the click-through modal. */
export default function AvatarCard({ entry, selected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-3xl bg-gradient-to-br ${entry.tint} border transition p-5 flex flex-col items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-purple-500/40 ${
        selected
          ? "border-green-500/70 shadow-lg shadow-green-500/20"
          : "border-white/10 hover:border-white/25"
      }`}
    >
      <div className="relative aspect-square w-full rounded-2xl bg-neutral-900/60 flex items-center justify-center overflow-hidden">
        <span className="text-7xl select-none" aria-hidden>{entry.emoji}</span>
        {selected && (
          <span className="absolute top-2 right-2 rounded-full bg-green-500/90 px-2 py-0.5 text-[10px] font-bold text-black select-none">
            使用中
          </span>
        )}
      </div>
      <div className="w-full text-center">
        <p className="text-base font-semibold leading-tight">{entry.name}</p>
        <p className="text-xs text-neutral-400 mt-1 line-clamp-2">{entry.tagline}</p>
      </div>
    </button>
  );
}
