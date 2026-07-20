"use client";

interface Props {
  show: boolean;
  onClose: () => void;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function LoginPrompt({ show, onClose }: Props) {
  if (!show) return null;

  const handleRegister = () => {
    window.open(`${BASE_PATH}/login`, "_blank");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div
        className="bg-white border border-slate-300 rounded-2xl w-72 p-6 flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-slate-800 text-center">
          注册后即可添加好友，同步好友关系和数据
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 border border-slate-300 px-4 py-2 text-xs text-slate-600 hover:text-slate-900 transition"
          >
            暂不注册
          </button>
          <button
            onClick={handleRegister}
            className="rounded-lg bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white px-4 py-2 text-xs font-semibold shadow-sm shadow-sky-500/30"
          >
            去注册
          </button>
        </div>
      </div>
    </div>
  );
}
