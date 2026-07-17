"use client";

import { useState, useEffect } from "react";

interface Props {
  show: boolean;
  onClose: () => void;
}

const LS_KEY = "qvideo_settings";
const GENDER_KEY = "qv_gender";

interface Settings {
  showId: boolean;
}

export type Gender = "female" | "male" | "private";

function loadSettings(): Settings {
  if (typeof window === "undefined") return { showId: true };
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return { showId: true };
  }
}

export function getSettings(): Settings {
  return loadSettings();
}

/** Read the user's declared gender, or null if they haven't picked one.
 *  Kept as a top-level export so the socket layer + future match filter can
 *  read it without going through the modal. Legacy "other" value from an
 *  earlier UI copy is silently mapped to "private" for continuity. */
export function getGender(): Gender | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GENDER_KEY);
    if (raw === "female" || raw === "male" || raw === "private") return raw;
    if (raw === "other") return "private";
    return null;
  } catch { return null; }
}

const GENDER_OPTIONS: Array<{ code: Gender; label: string; emoji: string }> = [
  { code: "female",  label: "女生", emoji: "👩" },
  { code: "male",    label: "男生", emoji: "👨" },
  { code: "private", label: "保密", emoji: "🔒" },
];

export default function SettingsModal({ show, onClose }: Props) {
  const [showId, setShowId] = useState(true);
  const [gender, setGender] = useState<Gender | null>(null);
  // Track logged-in state so the logout entry only shows for real users.
  // Re-read on every open so a stale close-and-reopen after login refreshes.
  const [loggedIn, setLoggedIn] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // Toast shown when a registered user tries to change gender — the actual
  // change requires admin approval (not implemented yet, so we just tell
  // them where to reach out).
  const [genderLockToast, setGenderLockToast] = useState(false);

  useEffect(() => {
    setShowId(loadSettings().showId ?? true);
    setGender(getGender());
    try { setLoggedIn(!!localStorage.getItem("token")); } catch { setLoggedIn(false); }
    setGenderLockToast(false);
  }, [show]);

  const saveShowId = (value: boolean) => {
    const s = loadSettings();
    s.showId = value;
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    setShowId(value);
  };

  const saveGender = (value: Gender) => {
    // Registered users can't change gender freely — admin approval flow is
    // still on the roadmap. Show a toast pointing to support and bail.
    if (loggedIn) {
      setGenderLockToast(true);
      return;
    }
    try { localStorage.setItem(GENDER_KEY, value); } catch { /* ignore */ }
    setGender(value);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl w-80 p-6 flex flex-col gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">设置</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-lg">&times;</button>
        </div>

        {/* Gender declaration — used for future matching preferences and for
            steering avatar recommendations. Not required. */}
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm text-neutral-200">我的性别</p>
            <p className="text-[10px] text-neutral-500">
              {loggedIn
                ? "已注册 · 修改需联系客服 contact@justsaysayforfun.com"
                : "用于匹配偏好和化身推荐,不公开"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {GENDER_OPTIONS.map((g) => {
              const active = gender === g.code;
              const locked = loggedIn && !active;
              return (
                <button
                  key={g.code}
                  type="button"
                  onClick={() => saveGender(g.code)}
                  className={`rounded-xl px-2 py-2 text-xs font-medium transition flex flex-col items-center gap-1 ${
                    active
                      ? "bg-sky-600 text-white shadow shadow-sky-600/30"
                      : locked
                      ? "bg-neutral-800/50 text-neutral-600 border border-neutral-800 cursor-not-allowed"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
                  }`}
                >
                  <span className="text-xl">{g.emoji}</span>
                  <span>{g.label}</span>
                </button>
              );
            })}
          </div>
          {genderLockToast && (
            <p className="text-[10px] text-yellow-400 leading-relaxed">
              性别一旦选定不可自行修改 · 如需变更请联系 <span className="font-mono">contact@justsaysayforfun.com</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-200">匹配时显示我的 ID</p>
            <p className="text-[10px] text-neutral-500">关闭后对方看到你为"匿名用户"</p>
          </div>
          <button
            onClick={() => saveShowId(!showId)}
            className={`w-10 h-6 rounded-full transition relative ${
              showId ? "bg-green-500" : "bg-neutral-700"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${
                showId ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        {/* Logout entry — bottom of modal, minimal styling so it doesn't
            compete with the primary settings toggles. Only shown when a
            token is present in localStorage. */}
        {loggedIn && (
          <div className="pt-3 border-t border-neutral-800 flex justify-center">
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="text-xs text-red-500/80 hover:text-red-400 transition py-1 px-3"
            >
              退出登录
            </button>
          </div>
        )}
      </div>

      {confirmLogout && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setConfirmLogout(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-neutral-900 border border-white/10 p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl mb-2">👋</div>
              <h3 className="text-lg font-semibold">退出登录?</h3>
              <p className="text-neutral-400 text-xs mt-2">下次可以用邮箱 / 手机号 / ID + 密码重新登录</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  try { localStorage.removeItem("token"); localStorage.removeItem("user"); } catch { /* ignore */ }
                  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
                  window.location.href = `${base}/`;
                }}
                className="w-full rounded-2xl bg-red-600 hover:bg-red-500 px-6 py-2.5 text-sm font-semibold text-white transition"
              >
                确认退出
              </button>
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                className="text-xs text-neutral-500 hover:text-neutral-300 py-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
