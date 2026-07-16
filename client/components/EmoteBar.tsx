"use client";

import { useRef } from "react";
import { EMOTES } from "./FloatingEmoteLayer";

interface Props {
  /** Called with the emote key ("laugh", "thumbs", ...) when the user taps
   *  a button. The parent is responsible for spawning a local float and
   *  broadcasting on the peer data channel. */
  onSend: (key: string) => void;
  /** Ignore taps that arrive within this many ms of the last one — protects
   *  the DC and the peer's screen from spam. 500ms is generous enough for
   *  double-taps but blocks a held-down finger. */
  throttleMs?: number;
}

export default function EmoteBar({ onSend, throttleMs = 400 }: Props) {
  const lastTsRef = useRef(0);

  const handle = (key: string) => {
    const now = performance.now();
    if (now - lastTsRef.current < throttleMs) return;
    lastTsRef.current = now;
    onSend(key);
  };

  return (
    <div className="flex items-center justify-center gap-1.5 rounded-full bg-neutral-900/70 border border-white/10 backdrop-blur-sm px-2 py-1.5">
      {EMOTES.map((e) => (
        <button
          key={e.key}
          type="button"
          onClick={() => handle(e.key)}
          title={e.label}
          aria-label={e.label}
          className="w-10 h-10 rounded-full flex items-center justify-center text-2xl hover:bg-white/10 active:scale-90 transition select-none"
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );
}
