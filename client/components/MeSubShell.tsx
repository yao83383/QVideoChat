"use client";

/**
 * Shared shell for /me/* subpages.
 *
 * Every subpage under /me follows the same visual pattern:
 *   ← 返回    <title>
 *   (subtitle)
 *   -----
 *   <content>
 *
 * The back button always goes to /me (not router.back(), which can send
 * the user into the wrong tab if they arrived from a friend request or
 * deep link).
 */

import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function MeSubShell({ title, subtitle, children }: Props) {
  return (
    <main className="max-w-md mx-auto px-4 pt-5 pb-6 flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <Link
          href="/me"
          aria-label="返回"
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
        >
          ←
        </Link>
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      {children}
    </main>
  );
}
