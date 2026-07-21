"use client";

/**
 * Away-from-keyboard timer.
 *
 * Flips `isAfk` to true after the user's face has been missing from the
 * camera continuously for `thresholdMs` (default 3 min — the value we
 * agreed on 2026-07-21). Any frame with `faceFound=true` resets both the
 * timer and the flag immediately.
 *
 * The consumer (usePresence, Phase 1.4) reads this to decide whether to
 * keep pumping avatar frames at 30 fps, drop to a lower rate, or stop
 * broadcasting and switch friends' tiles to the sleeping state.
 *
 * Design notes:
 *
 * - No debouncing on face-lost. MediaPipe drops face for a frame or two
 *   during blinks / head tilts and the timer horizon (minutes) is far
 *   longer than those dropouts, so a naive edge-triggered timer is fine.
 *
 * - Timer is torn down and rebuilt whenever thresholdMs changes so a
 *   settings-driven change takes effect on the next lost-face event
 *   without needing a page reload.
 */

import { useEffect, useRef, useState } from "react";

export function useAfk(faceFound: boolean, thresholdMs: number = 3 * 60_000): boolean {
  const [isAfk, setIsAfk] = useState(false);
  // Latest faceFound value seen in a ref so the timer callback reads the
  // truth at fire time (avoids the "timer scheduled on a stale closure"
  // trap when faceFound flips right before the timer fires).
  const faceFoundRef = useRef(faceFound);
  faceFoundRef.current = faceFound;

  useEffect(() => {
    if (faceFound) {
      // Face is here — clear any pending timer and drop out of AFK.
      if (isAfk) setIsAfk(false);
      return;
    }
    // Face just went missing. Schedule the AFK flip; a fresh face event
    // will tear this timer down via the effect cleanup below.
    const t = setTimeout(() => {
      if (!faceFoundRef.current) setIsAfk(true);
    }, thresholdMs);
    return () => clearTimeout(t);
  }, [faceFound, thresholdMs, isAfk]);

  return isAfk;
}
