"use client";

/**
 * Presence tile — the compact "friend's face" chip rendered in FriendList
 * (Phase 1.5) and, later, in the 10-person circle grid (Phase 3).
 *
 * Deliberately does NOT mount a VRM scene. Chromium caps live WebGL
 * contexts at ~16, Safari at ~8, so a friend list of a dozen would
 * exhaust the budget on its own — and that's before the room-view
 * previews. Emoji + tint is the "1000 tiles are cheap" mode; a full
 * 3D preview belongs in a dedicated single-focus panel that mounts one
 * VRM at a time.
 *
 * Four visual states (via the optional `presence` prop):
 *
 *   ● online     — solid emerald dot, tile shows normal emoji
 *   ● sleeping   — desaturated tile + slate dot with 💤 overlay
 *   ● busy       — amber dot (matching queue OR in-call)
 *   ● offline    — no dot; tile at ~50% opacity
 *
 * The dot lives at the bottom-right, sized ~30% of the tile so it reads
 * cleanly at both 40px and 96px. Interactive when `onClick` is provided;
 * disabled when the friend isn't online (Phase 2 will wire click →
 * call:invite, which only makes sense for reachable friends).
 */

import type { AvatarEntry } from "@/lib/avatars";
import type { PresenceEntry, PresenceStatus } from "@/hooks/usePresence";

interface Props {
  entry: AvatarEntry;
  /** Undefined when we haven't heard anything about this user yet
   *  (friend was just added, or presence layer isn't wired). Treated
   *  as offline. */
  presence?: PresenceEntry;
  /** Diameter in pixels. Default 60 fits the FriendList row; the circle
   *  grid (Phase 3) uses larger sizes. */
  size?: number;
  /** Fallback single-char label when `entry` isn't specific enough (e.g.
   *  we know the username but not which avatar they've picked). Rendered
   *  behind the emoji when both are present — keeps the row aligned even
   *  before the friend list fetches its avatarId join. */
  fallbackChar?: string;
  onClick?: () => void;
  /** Presented to a screen reader; falls back to entry name + status. */
  ariaLabel?: string;
}

interface DotSpec {
  bg: string;
  ring: string;
  overlay?: string;
  hidden?: boolean;
}

function dotFor(status: PresenceStatus): DotSpec {
  switch (status) {
    case "online":
      return { bg: "bg-emerald-400", ring: "ring-emerald-200/70" };
    case "sleeping":
      return { bg: "bg-slate-400", ring: "ring-slate-200/70", overlay: "💤" };
    case "busy":
      return { bg: "bg-amber-400", ring: "ring-amber-200/70" };
    case "offline":
    default:
      return { bg: "", ring: "", hidden: true };
  }
}

export default function AvatarTile({
  entry,
  presence,
  size = 60,
  fallbackChar,
  onClick,
  ariaLabel,
}: Props) {
  const status: PresenceStatus = presence?.status ?? "offline";
  const dot = dotFor(status);
  const clickable = !!onClick && (status === "online");
  const dimmed = status === "offline" || status === "sleeping";

  // Emoji sizing scales with the tile; ~55% keeps room for the dot at
  // the corner without crowding.
  const emojiFontSize = Math.round(size * 0.55);
  const dotSize = Math.max(12, Math.round(size * 0.28));

  const label = ariaLabel ?? `${entry.name} · ${status}`;

  const inner = (
    <div
      className={`relative rounded-2xl overflow-hidden bg-gradient-to-br ${entry.tint} border border-slate-200/70 flex items-center justify-center transition ${
        dimmed ? "opacity-60 saturate-50" : ""
      }`}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden
        className="select-none leading-none"
        style={{ fontSize: emojiFontSize }}
      >
        {entry.emoji}
      </span>
      {fallbackChar && !entry.emoji && (
        <span className="absolute inset-0 flex items-center justify-center text-slate-700 font-semibold">
          {fallbackChar}
        </span>
      )}
      {!dot.hidden && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ${dot.bg} ring-2 ring-white flex items-center justify-center shadow-sm`}
          style={{ width: dotSize, height: dotSize, fontSize: Math.round(dotSize * 0.7) }}
        >
          {dot.overlay && (
            <span className="select-none leading-none" aria-hidden>{dot.overlay}</span>
          )}
        </span>
      )}
    </div>
  );

  if (!onClick) {
    return (
      <div role="img" aria-label={label}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      aria-label={label}
      className={`focus:outline-none focus:ring-2 focus:ring-sky-400/60 rounded-2xl transition ${
        clickable ? "hover:-translate-y-0.5 hover:shadow-md hover:shadow-sky-500/20" : "cursor-not-allowed"
      }`}
    >
      {inner}
    </button>
  );
}
