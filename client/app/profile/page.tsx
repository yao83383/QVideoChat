"use client";

/**
 * /profile → /me redirect.
 *
 * `/profile` was the pre-IA-rewrite version of "my page" — it lived as its
 * own top-level route because there was no bottom tab bar. Everything it
 * did (identity, stats, avatar link, logout) moved into /me hub + subpages.
 *
 * Kept as a redirect so external invitation links / bookmarks continue to
 * work. Purely client-side (useEffect + router.replace) — the next.js
 * middleware layer isn't set up for redirects, and adding it just for one
 * legacy path would be overkill.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProfileRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/me"); }, [router]);
  return null;
}
