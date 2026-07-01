"use client";

interface NameInputProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export default function NameInput({ value, onChange, disabled }: NameInputProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <label className="text-sm text-neutral-400">你的昵称</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="输入昵称..."
        maxLength={12}
        className="w-56 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-center text-white placeholder-neutral-500 outline-none focus:border-neutral-500 disabled:opacity-40"
      />
    </div>
  );
}
