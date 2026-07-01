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
      ? "bg-white text-black hover:bg-neutral-200"
      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700";

  return (
    <button className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
