/** Catalog of avatars users can pick from. Each entry maps to a real VRM
 *  file under `client/public/models/{gender}/{filename}.vrm`. Adding a new
 *  avatar is: drop the .vrm in the right folder, then append an entry here.
 *
 *  Gender field is metadata for organization + future match filtering. It
 *  doesn't restrict WHO can use WHICH — a user's own gender preference is
 *  separate from which avatar body they want to inhabit. */

export type AvatarGender = "female" | "male" | "unisex";

export interface AvatarEntry {
  id: string;
  /** Display name shown on the card. */
  name: string;
  /** One-line personality/pitch shown under the name. */
  tagline: string;
  /** Emoji shorthand used as a lightweight thumbnail before the 3D preview
   *  loads (spawning a full three.js scene per grid card would blow through
   *  memory on the /avatars page). */
  emoji: string;
  gender: AvatarGender;
  /** Path relative to `client/public/models/` — e.g. "female/black.vrm". */
  vrmPath: string;
  /** CSS gradient class(es) for the card background — mixes it up so the
   *  grid doesn't look identical row-to-row. */
  tint: string;
}

/** Default avatar id used when the user hasn't picked one yet. */
export const DEFAULT_AVATAR_ID = "dlco";

export const AVATARS: AvatarEntry[] = [
  {
    id: "dlco",
    name: "DLco 默认款",
    tagline: "Q 版原型化身,不分风格,谁都能穿",
    emoji: "🎭",
    gender: "unisex",
    vrmPath: "unisex/DLco.vrm",
    tint: "from-purple-500/20 to-pink-500/20",
  },
  {
    id: "female-white",
    name: "白衣少女",
    tagline: "简约白色系,治愈基调",
    emoji: "🤍",
    gender: "female",
    vrmPath: "female/female-white.vrm",
    tint: "from-neutral-400/20 to-white/10",
  },
  {
    id: "female-black",
    name: "黑衣少女",
    tagline: "全黑轻酷,少即是多",
    emoji: "🖤",
    gender: "female",
    vrmPath: "female/black.vrm",
    tint: "from-neutral-700/40 to-neutral-900/40",
  },
  {
    id: "female-red",
    name: "红衣少女",
    tagline: "赤色抢眼,存在感拉满",
    emoji: "❤️",
    gender: "female",
    vrmPath: "female/red.vrm",
    tint: "from-red-500/20 to-rose-500/20",
  },
  {
    id: "female-yellowhair",
    name: "金发少女",
    tagline: "金色长发,阳光灿烂系",
    emoji: "💛",
    gender: "female",
    vrmPath: "female/yellowhair.vrm",
    tint: "from-yellow-500/20 to-amber-500/20",
  },
  {
    id: "male-blacktshirt",
    name: "黑衣少年",
    tagline: "黑 T 恤,少年清冷范",
    emoji: "👕",
    gender: "male",
    vrmPath: "male/male-blacktshirt.vrm",
    tint: "from-slate-500/20 to-blue-500/20",
  },
];

/** Look up an entry by id. Falls back to the default DLco entry rather than
 *  returning undefined — callers should never end up with "no avatar" as a
 *  valid state. */
export function getAvatar(id: string | null | undefined): AvatarEntry {
  if (!id) return AVATARS.find((a) => a.id === DEFAULT_AVATAR_ID)!;
  return AVATARS.find((a) => a.id === id) ?? AVATARS.find((a) => a.id === DEFAULT_AVATAR_ID)!;
}

/** Convenience for splitting the catalog into the three UI sections that
 *  /avatars renders. */
export function avatarsByGender(gender: AvatarGender): AvatarEntry[] {
  return AVATARS.filter((a) => a.gender === gender);
}

/** Bump the click-through counter for an avatar card. Feeds the same
 *  data-collection story we established for the F preview: which avatars
 *  users are drawn to, so we know what to author next. */
export function bumpAvatarClick(id: string) {
  try {
    const key = `qv_avatar_click_${id}`;
    const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
}

/** Record which avatar the user commits to. Separate from click, since click
 *  might be curiosity and select is intent. */
export function bumpAvatarSelected(id: string) {
  try {
    const key = `qv_avatar_selected_${id}`;
    const n = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
}
