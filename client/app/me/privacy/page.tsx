"use client";

/**
 * /me/privacy —— 隐私 & 权限 & 使用偏好.
 *
 * 承接原 SettingsModal 的能力(性别、匹配时是否显 ID),再叠加:
 *  - 摄像头默认策略 (always-on presence 的开关,新增)
 *  - AFK 阈值 (预留,当前只显示只读默认值)
 *
 * 性别的"注册后需联系客服修改"逻辑保留,和 SettingsModal 完全等价。
 */

import { useEffect, useState } from "react";
import MeSubShell from "@/components/MeSubShell";
import { getGender, type Gender } from "@/components/SettingsModal";

const SETTINGS_KEY = "qvideo_settings";
const GENDER_KEY = "qv_gender";
const CAMERA_AUTO_KEY = "qv_camera_auto";

interface Settings { showId: boolean }
function loadSettings(): Settings {
  if (typeof window === "undefined") return { showId: true };
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
  catch { return { showId: true }; }
}

const GENDER_OPTIONS: Array<{ code: Gender; label: string; emoji: string }> = [
  { code: "female",  label: "女生", emoji: "👩" },
  { code: "male",    label: "男生", emoji: "👨" },
  { code: "private", label: "保密", emoji: "🔒" },
];

export default function MePrivacyPage() {
  const [gender, setGender] = useState<Gender | null>(null);
  const [showId, setShowId] = useState(true);
  const [cameraAuto, setCameraAuto] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [genderLockToast, setGenderLockToast] = useState(false);

  useEffect(() => {
    setGender(getGender());
    setShowId(loadSettings().showId ?? true);
    try {
      setLoggedIn(!!localStorage.getItem("token"));
      // camera-auto 默认 true(memory:always-on 化身愿景已 lock always-on)
      const raw = localStorage.getItem(CAMERA_AUTO_KEY);
      setCameraAuto(raw === null ? true : raw === "1");
    } catch { /* ignore */ }
  }, []);

  const saveShowId = (v: boolean) => {
    const s = loadSettings();
    s.showId = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    setShowId(v);
  };
  const saveGender = (v: Gender) => {
    if (loggedIn) { setGenderLockToast(true); return; }
    try { localStorage.setItem(GENDER_KEY, v); } catch { /* ignore */ }
    setGender(v);
  };
  const saveCameraAuto = (v: boolean) => {
    try { localStorage.setItem(CAMERA_AUTO_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    setCameraAuto(v);
  };

  return (
    <MeSubShell title="隐私 · 权限">
      {/* 性别声明 */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">我的性别</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
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
                    ? "bg-sky-500 text-white shadow shadow-sky-500/30"
                    : locked
                    ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                }`}
              >
                <span className="text-xl">{g.emoji}</span>
                <span>{g.label}</span>
              </button>
            );
          })}
        </div>
        {genderLockToast && (
          <p className="text-[10px] text-amber-600 leading-relaxed">
            性别一旦选定不可自行修改 · 如需变更请联系{" "}
            <span className="font-mono">contact@justsaysayforfun.com</span>
          </p>
        )}
      </section>

      {/* 匹配时是否显 ID */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">匹配时显示我的 ID</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            关闭后对方看到你为"匿名用户"
          </p>
        </div>
        <Toggle value={showId} onChange={saveShowId} />
      </section>

      {/* 摄像头默认策略 (Phase 1 always-on 的开关) */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">进入应用自动打开摄像头</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            关闭后需要手动点击才启用化身追踪
          </p>
        </div>
        <Toggle value={cameraAuto} onChange={saveCameraAuto} />
      </section>

      {/* AFK 阈值(只读显示,后续开放调整) */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-900">AFK 阈值</p>
          <span className="text-xs text-slate-500">3 分钟</span>
        </div>
        <p className="text-[10px] text-slate-500">
          连续 3 分钟检测不到人脸,好友列表里你的头像会显示为"睡着"
        </p>
      </section>
    </MeSubShell>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-11 h-6 rounded-full relative transition ${value ? "bg-emerald-500" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          value ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
