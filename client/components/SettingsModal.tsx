"use client";

import { useState, useEffect } from "react";

interface Props {
  show: boolean;
  onClose: () => void;
}

const LS_KEY = "qvideo_settings";

interface Settings {
  showId: boolean;
}

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

export default function SettingsModal({ show, onClose }: Props) {
  const [showId, setShowId] = useState(true);

  useEffect(() => {
    setShowId(loadSettings().showId ?? true);
  }, [show]);

  const save = (key: keyof Settings, value: boolean) => {
    const s = loadSettings();
    s[key] = value;
    localStorage.setItem(LS_KEY, JSON.stringify(s));
    if (key === "showId") setShowId(value);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl w-80 p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">设置</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-lg">&times;</button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-200">匹配时显示我的 ID</p>
            <p className="text-[10px] text-neutral-500">关闭后对方看到你为"匿名用户"</p>
          </div>
          <button
            onClick={() => save("showId", !showId)}
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
      </div>
    </div>
  );
}
