"use client";

/**
 * Bottom tab bar — three primary destinations: home / friends / me.
 *
 * Hidden on routes that need the full viewport (通话中 /room, the desktop
 * pet window /pet, the standalone /login flow, and any deep test pages
 * that already ship their own chrome). All other pages get the bar so
 * navigation is one thumb-tap away.
 *
 * Uses next/navigation's usePathname to highlight the active tab. The
 * comparison is prefix-based so /me/language still lights up the "me"
 * tab. Root ("/") only matches exactly to avoid highlighting home when
 * we're actually somewhere deep.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface TabDef {
  href: string;
  label: string;
  icon: string;
  /** Prefix-match paths that also count as "active". `exact` skips
   *  prefix logic entirely — used for "/" so /me doesn't light home. */
  exact?: boolean;
}

const TABS: TabDef[] = [
  { href: "/", label: "首页", icon: "🏠", exact: true },
  { href: "/friends", label: "好友", icon: "👥" },
  { href: "/me", label: "我", icon: "👤" },
];

// Routes that should never show the tab bar. Kept as a Set for O(1)
// lookup; prefix matches (like /room/anything) are handled below.
const HIDE_ON_PREFIXES = [
  "/room",
  "/pet",
  "/login",
  "/welcome",
  "/audio-test",
  "/asr-test",
  "/sherpa-test",
];

function stripBase(path: string): string {
  if (!path) return "/";
  if (BASE_PATH && path.startsWith(BASE_PATH)) return path.slice(BASE_PATH.length) || "/";
  return path;
}

export default function BottomTabBar() {
  const pathname = usePathname();
  const path = useMemo(() => stripBase(pathname || "/"), [pathname]);

  const hidden = HIDE_ON_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  if (hidden) return null;

  return (
    <nav
      aria-label="主导航"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-2px_12px_rgba(15,23,42,0.06)]"
      // safe-area on iOS home indicator
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
    >
      <ul className="flex justify-around max-w-md mx-auto">
        {TABS.map((tab) => {
          const active = tab.exact
            ? path === tab.href
            : path === tab.href || path.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-2 transition ${
                  active ? "text-sky-600" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <span className="text-xl leading-none select-none" aria-hidden>
                  {tab.icon}
                </span>
                <span className={`text-[11px] ${active ? "font-semibold" : ""}`}>
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
