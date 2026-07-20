"use client";

interface MatchButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}

export default function MatchButton({
  label,
  onClick,
  disabled = false,
  variant = "primary",
}: MatchButtonProps) {
  const base = "rounded-xl px-8 py-3 font-semibold text-sm transition disabled:opacity-30";
  const styles =
    variant === "primary"
      ? "bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white shadow-lg shadow-sky-500/30"
      : "bg-white/80 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-sky-300 shadow-sm backdrop-blur-sm";

  return (
    <button className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
