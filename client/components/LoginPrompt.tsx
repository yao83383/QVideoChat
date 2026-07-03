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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl w-72 p-6 flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-neutral-200 text-center">
          注册后即可添加好友，同步好友关系和数据
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-2 text-xs text-neutral-400 hover:text-white transition"
          >
            暂不注册
          </button>
          <button
            onClick={handleRegister}
            className="rounded-lg bg-white text-black px-4 py-2 text-xs font-medium hover:bg-neutral-200"
          >
            去注册
          </button>
        </div>
      </div>
    </div>
  );
}
