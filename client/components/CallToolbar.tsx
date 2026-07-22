"use client";

/**
 * CallToolbar —— 通话页底部工具栏.
 *
 * 五个按钮,从左到右:
 *   🎤 麦克风  📝 字幕  🌐 翻译  ⋯ 更多  📞 挂断(红,大)
 *
 * 字幕 & 翻译两按钮的语义(用户 2026-07-22 明确):
 *   - 📝 字幕 = 是否显示原文字幕(ASR 永远在后台跑,受不受这个按钮影响都跑,
 *     受此按钮控制的只是"显示不显示原文这一行")
 *   - 🌐 翻译 = 是否翻译并显示译文(独立开关,和字幕按钮无联动)
 *   - 两者独立,不互斥.用户可以只看译文、只看原文、都看、都不看.
 *
 * 当前这一版只承载 UI 状态透出 —— ASR 后台常跑 + 举报 5min transcript
 * 后端在块 C 落地,那时的按钮语义就完全走通.现在字幕 toggle 沿用
 * subtitleEnabled 现有布尔,translate 独立出来是新加的.
 *
 * 更多菜单挂点在 onMoreClick 由父组件弹.举报入口在父组件 MoreMenu 里.
 */

interface Props {
  micOn: boolean;
  subtitleOn: boolean;
  translateOn: boolean;
  /** 通话尚未接通时禁用非挂断按钮(字幕 / 翻译 / 更多)—— 没意义. */
  connected: boolean;
  onToggleMic: () => void;
  onToggleSubtitle: () => void;
  onToggleTranslate: () => void;
  onMore: () => void;
  onHangup: () => void;
}

interface IconButtonProps {
  active: boolean;
  disabled?: boolean;
  danger?: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  size?: "md" | "lg";
}

function IconButton({
  active, disabled, danger, label, ariaLabel, onClick, size = "md",
}: IconButtonProps) {
  const dim = size === "lg" ? "w-14 h-14 text-2xl" : "w-12 h-12 text-xl";
  const base = "rounded-full flex items-center justify-center transition select-none shadow-lg";
  let variant: string;
  if (disabled) {
    variant = "bg-white/5 text-white/30 cursor-not-allowed shadow-none";
  } else if (danger) {
    variant = "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/40";
  } else if (active) {
    variant = "bg-white text-slate-900 shadow-white/20";
  } else {
    variant = "bg-white/10 hover:bg-white/20 text-white/90 backdrop-blur-md";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`${base} ${dim} ${variant}`}
    >
      <span aria-hidden>{label}</span>
    </button>
  );
}

export default function CallToolbar({
  micOn, subtitleOn, translateOn, connected,
  onToggleMic, onToggleSubtitle, onToggleTranslate, onMore, onHangup,
}: Props) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 pb-6 pt-4 flex items-end justify-center gap-3 pointer-events-none"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 1.5rem)" }}
    >
      <div className="pointer-events-auto flex items-end gap-3 rounded-full bg-slate-900/60 backdrop-blur-md border border-white/10 px-4 py-3 shadow-2xl shadow-black/40">
        <IconButton
          active={micOn}
          label={micOn ? "🎤" : "🔇"}
          ariaLabel={micOn ? "静音" : "取消静音"}
          onClick={onToggleMic}
        />
        <IconButton
          active={subtitleOn}
          disabled={!connected}
          label="📝"
          ariaLabel={subtitleOn ? "关闭字幕" : "打开字幕"}
          onClick={onToggleSubtitle}
        />
        <IconButton
          active={translateOn}
          disabled={!connected}
          label="🌐"
          ariaLabel={translateOn ? "关闭翻译" : "打开翻译"}
          onClick={onToggleTranslate}
        />
        <IconButton
          active={false}
          disabled={!connected}
          label="⋯"
          ariaLabel="更多"
          onClick={onMore}
        />
        <IconButton
          active={false}
          danger
          label="📞"
          ariaLabel="挂断"
          onClick={onHangup}
          size="lg"
        />
      </div>
    </div>
  );
}
