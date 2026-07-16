"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/** Catalog of emotes usable across sender / receiver. `key` is the wire
 *  identifier (short & stable), `emoji` is the display glyph, `label` is
 *  the tooltip / accessible name. */
export const EMOTES: ReadonlyArray<{ key: string; emoji: string; label: string }> = [
  { key: "laugh",  emoji: "😂", label: "哈哈" },
  { key: "thumbs", emoji: "👍", label: "赞" },
  { key: "love",   emoji: "💕", label: "爱心" },
  { key: "clap",   emoji: "👏", label: "鼓掌" },
  { key: "wow",    emoji: "😮", label: "惊讶" },
  { key: "sad",    emoji: "😢", label: "难过" },
];

/** Look up the emoji for a wire key. Falls back to a neutral marker for
 *  unknown keys sent by future clients — better a "?" than nothing. */
export function emojiForKey(key: string): string {
  return EMOTES.find((e) => e.key === key)?.emoji ?? "❓";
}

interface ActiveEmote {
  id: number;
  emoji: string;
  xOffset: number; // px offset from horizontal center, ±120 range
}

/** Hook that owns the list of currently-floating emotes and exposes a spawn
 *  function. The animation duration is baked into the CSS keyframe; the
 *  setTimeout here is only for React-side cleanup so the DOM doesn't grow
 *  unbounded. */
export function useFloatingEmotes() {
  const [emotes, setEmotes] = useState<ActiveEmote[]>([]);
  const nextIdRef = useRef(0);

  const spawn = useCallback((emoji: string) => {
    const id = nextIdRef.current++;
    const xOffset = Math.floor(Math.random() * 240 - 120);
    setEmotes((prev) => [...prev, { id, emoji, xOffset }]);
    setTimeout(() => {
      setEmotes((prev) => prev.filter((e) => e.id !== id));
    }, 3200); // keyframe is 3s; a small buffer keeps the fade-out clean
  }, []);

  return { emotes, spawn };
}

/** Renders the currently-floating emotes as an overlay pinned to the bottom
 *  of the viewport. `pointer-events: none` so the layer never eats clicks
 *  meant for underlying UI (avatars, buttons). */
export default function FloatingEmoteLayer({ emotes }: { emotes: ActiveEmote[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-0">
      {emotes.map((e) => (
        <div
          key={e.id}
          className="absolute left-1/2 bottom-0 text-6xl select-none"
          style={{
            animation: "qv-float-up 3s ease-out forwards",
            // Custom property consumed by the keyframe's translate() to
            // scatter concurrent emotes horizontally.
            ["--qv-x" as string]: `${e.xOffset}px`,
            willChange: "transform, opacity",
          }}
        >
          {e.emoji}
        </div>
      ))}
    </div>
  );
}
