"use client";

interface NameInputProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export default function NameInput({ value, onChange, disabled }: NameInputProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <label className="text-sm text-slate-600">你的昵称</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="输入昵称..."
        maxLength={12}
        className="w-56 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-center text-slate-900 placeholder-slate-400 outline-none focus:border-sky-400 disabled:opacity-40"
      />
    </div>
  );
}
