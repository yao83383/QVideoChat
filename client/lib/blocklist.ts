/** Local block list — userIds this user never wants to match with again.
 *
 *  Client-side only for now. The server doesn't dedupe against a per-user
 *  block set (yet), so matching may still surface a blocked partner; when
 *  that happens the room-join handler notices and immediately kicks off the
 *  next match, so the user never sees the blocked partner's avatar.
 *
 *  Add to the list from: report submit (E2), an explicit block button (future),
 *  or programmatic tests. Persistent across sessions via localStorage. */

const KEY = "qv_blocklist";

function readList(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function writeList(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); }
  catch { /* ignore */ }
}

export function getBlocklist(): string[] {
  return readList();
}

export function isBlocked(userId: string): boolean {
  if (!userId) return false;
  return readList().includes(userId);
}

export function blockUser(userId: string) {
  if (!userId) return;
  const list = readList();
  if (list.includes(userId)) return;
  list.push(userId);
  writeList(list);
}

export function unblockUser(userId: string) {
  if (!userId) return;
  writeList(readList().filter((x) => x !== userId));
}

/** Fires when a match:found landed on a blocked user and we auto-skipped
 *  them. Useful to know whether the block-list is doing meaningful work vs.
 *  just accumulating dead entries. */
export function bumpBlocklistHit() {
  try {
    const key = "qv_blocklist_hits";
    const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
}
