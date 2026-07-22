"use client";

/**
 * SubtitleOverlay —— 通话底端字幕层.
 *
 * 像看视频那样底部居中的字幕.按讲话人两条独立行显示:
 *   Peer(对方)在上,颜色偏白;My(自己)在下,颜色偏灰,较小
 * 每行内部还分:原文一行 + 译文一行(启用翻译时).
 *
 * 显示规则(按用户 2026-07-22 敲的两按钮语义):
 *   - subtitleOn=false && translateOn=false → 什么都不渲染
 *   - subtitleOn=true                        → 显示原文
 *   - translateOn=true                       → 显示译文
 *
 * 组件只做视觉;数据从上游传进来 —— ASR 触发 + 翻译触发都在 RoomClient
 * 里.以后 ASR 常跑 + 只是显不显示,数据源不变,这层的判断"看到原文
 * 就渲染原文行"仍成立.
 *
 * 底部预留 92px inset,避免和 CallToolbar 打架.
 */

interface Props {
  subtitleOn: boolean;
  translateOn: boolean;
  /** 自己的原文 —— ASR 结果(interim + final 都会来这里). */
  mySource: string | null;
  /** 自己的译文 —— translateText 完成后写入. */
  myTranslated: string | null;
  /** 对方的原文 —— 通过 DataChannel 收到. */
  peerSource: string | null;
  /** 对方的译文. */
  peerTranslated: string | null;
  /** 自己 / 对方的显示名,右侧一个小标记. */
  myName?: string;
  peerName?: string;
  /** 底部 inset(高于 CallToolbar). */
  bottomInset?: number;
}

interface RowProps {
  who: string;
  source: string | null;
  translated: string | null;
  showSource: boolean;
  showTranslate: boolean;
  variant: "peer" | "me";
}

function Row({ who, source, translated, showSource, showTranslate, variant }: RowProps) {
  const anyShown = (showSource && source) || (showTranslate && translated);
  if (!anyShown) return null;
  const tone =
    variant === "peer"
      ? "bg-slate-900/70 text-white border-white/10"
      : "bg-slate-900/55 text-white/85 border-white/5";
  return (
    <div className={`max-w-[80vw] rounded-2xl border ${tone} backdrop-blur-md px-4 py-2 shadow-lg`}>
      <span className="block text-[10px] text-white/50 mb-0.5 tracking-wider uppercase">{who}</span>
      {showSource && source && (
        <p className="text-sm leading-snug break-words">{source}</p>
      )}
      {showTranslate && translated && (
        <p className="text-sm leading-snug break-words text-emerald-300/95">
          {translated}
        </p>
      )}
    </div>
  );
}

export default function SubtitleOverlay({
  subtitleOn, translateOn,
  mySource, myTranslated, peerSource, peerTranslated,
  myName = "我", peerName = "对方",
  bottomInset = 92,
}: Props) {
  if (!subtitleOn && !translateOn) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center gap-2 w-full"
      style={{ bottom: bottomInset }}
    >
      <Row
        who={peerName}
        source={peerSource}
        translated={peerTranslated}
        showSource={subtitleOn}
        showTranslate={translateOn}
        variant="peer"
      />
      <Row
        who={myName}
        source={mySource}
        translated={myTranslated}
        showSource={subtitleOn}
        showTranslate={translateOn}
        variant="me"
      />
    </div>
  );
}
