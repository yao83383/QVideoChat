"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Custom title bar for the Electron desktop shell.
 *
 * Mounts globally via app/layout.tsx and no-ops in two cases:
 *   1. Running in a plain browser (no window.qvHost) — the web page keeps
 *      its normal browser chrome.
 *   2. Inside the pet route (/pet) — the pet BrowserWindow is frameless
 *      and transparent, has its own tiny HUD (drag + ×), and definitely
 *      doesn't want a 36px opaque strip on top.
 *
 * On macOS the OS renders traffic lights on top of us via the shell's
 * `titleBarStyle: 'hiddenInset'`; we hide our own min/max/close row over
 * there and only leave the drag region + branding so the native lights
 * stay uncovered.
 *
 * Everywhere else (Windows / Linux) we paint all three window controls
 * ourselves. Close routes through the shell's tray-hide path — this is
 * the ONLY UI for the app's "hide to tray" gesture besides the native
 * close button we just deleted.
 *
 * Adds a `padding-top` on the body so page content isn't hidden under the
 * bar, and cleans up on unmount so the browser dev experience isn't
 * distorted by leftover style.
 */

const BAR_HEIGHT_PX = 36;

export default function DesktopTitleBar() {
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  const [maximized, setMaximized] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.qvHost) return;
    setPlatform(window.qvHost.platform);
    setReady(true);

    // Push body content down so `absolute top-*` layouts and normal flow
    // both clear the bar. Cleanup restores prior value for browser-tab dev.
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = `${BAR_HEIGHT_PX}px`;

    // Seed initial maximize state + subscribe to changes so glyph flips
    // in sync with Aero-snap / double-click / manual toggle.
    window.qvHost.isMainMaximized().then(setMaximized).catch(() => { /* ignore */ });
    const unsub = window.qvHost.onMainMaximizedChange(setMaximized);

    return () => {
      document.body.style.paddingTop = prev;
      unsub();
    };
  }, []);

  // Suppress inside the pet route — its BrowserWindow is transparent and
  // handles its own drag strip. Same JS bundle serves both, so path check.
  if (!ready) return null;
  if (pathname?.startsWith("/pet")) return null;

  const isMac = platform === "darwin";

  return (
    <div
      className="qv-drag-region fixed inset-x-0 top-0 z-50 flex items-center justify-between select-none border-b border-slate-900/10 bg-gradient-to-b from-sky-100/85 via-white/75 to-sky-50/85 backdrop-blur-md"
      style={{ height: BAR_HEIGHT_PX }}
    >
      {/* Left: brand chip. On macOS a chunk of left padding gives the
          traffic lights room to render above us. */}
      <div
        className={`flex items-center gap-2 ${isMac ? "pl-20" : "pl-3"}`}
      >
        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-sky-400 via-cyan-400 to-amber-300 shadow-[0_0_10px_rgba(14,165,233,0.5)]" />
        <span className="text-[11px] font-semibold tracking-wide text-slate-700">
          QVideoChat
        </span>
        <span className="text-[10px] text-slate-400">
          v{process.env.NEXT_PUBLIC_APP_VERSION || "dev"}
        </span>
      </div>

      {/* Right: window controls (win/linux only; macOS uses OS traffic lights). */}
      {!isMac && (
        <div className="qv-no-drag flex items-center h-full">
          <TitleBarButton
            label="最小化"
            onClick={() => window.qvHost?.minimizeMain()}
            variant="normal"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </TitleBarButton>
          <TitleBarButton
            label={maximized ? "还原" : "最大化"}
            onClick={() => window.qvHost?.toggleMaximizeMain()}
            variant="normal"
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.1" />
                <rect x="3" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            )}
          </TitleBarButton>
          <TitleBarButton
            label="关闭 (收入托盘)"
            onClick={() => window.qvHost?.closeMain()}
            variant="danger"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </TitleBarButton>
        </div>
      )}
    </div>
  );
}

function TitleBarButton({
  label,
  onClick,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  variant: "normal" | "danger";
  children: React.ReactNode;
}) {
  const base =
    "flex items-center justify-center w-11 h-full text-slate-500 transition-colors";
  const hover =
    variant === "danger"
      ? "hover:bg-rose-500 hover:text-white"
      : "hover:bg-slate-900/10 hover:text-slate-900";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${base} ${hover}`}
    >
      {children}
    </button>
  );
}
