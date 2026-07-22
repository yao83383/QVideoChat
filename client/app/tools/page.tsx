"use client";

/**
 * /tools —— tab bar 第 3 个入口. 工具集合页.
 *
 * 目前只有一项"实时翻译",占位 grid 为未来其他工具留位置:
 *   - 语言学习卡片
 *   - 快速录音笔记
 *   - 好友间小游戏(2 人房)
 *   - 其他 utility
 *
 * 每个工具都是独立 route,不打模态,和 /me 的规则一致.
 */

import Link from "next/link";

interface Tool {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  /** 未做的工具 —— 显示但不可点,给用户看到 roadmap */
  disabled?: boolean;
}

const TOOLS: Tool[] = [
  {
    href: "/tools/translate",
    icon: "🌐",
    title: "实时翻译",
    subtitle: "对着话筒说话即刻翻译 · 中英双向",
  },
  // 占位 —— 想好之后再打开
  // { href: "/tools/notes", icon: "📝", title: "录音笔记", subtitle: "说一段话,自动转文字", disabled: true },
];

export default function ToolsPage() {
  return (
    <main className="max-w-md mx-auto px-4 pt-6 pb-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">工具</h1>
      </header>
      <p className="text-xs text-slate-500">
        独立使用的小工具,不需要匹配陌生人也能用.
      </p>

      <div className="grid grid-cols-1 gap-3 mt-2">
        {TOOLS.map((t) => (
          <ToolCard key={t.href} tool={t} />
        ))}
      </div>
    </main>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const base =
    "flex items-center gap-4 p-4 rounded-2xl border transition";
  const enabled =
    "bg-white border-slate-200 hover:border-sky-400 hover:shadow-md hover:shadow-sky-500/15";
  const disabled =
    "bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed";

  const inner = (
    <>
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400/20 to-cyan-400/20 border border-sky-200/50 flex items-center justify-center text-2xl">
        {tool.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">{tool.title}</p>
        <p className="text-[11px] text-slate-600 mt-0.5">{tool.subtitle}</p>
      </div>
      {!tool.disabled && <span className="text-sky-500">›</span>}
      {tool.disabled && (
        <span className="text-[10px] text-slate-400 rounded-full bg-slate-200 px-2 py-0.5">
          即将上线
        </span>
      )}
    </>
  );

  if (tool.disabled) {
    return <div className={`${base} ${disabled}`}>{inner}</div>;
  }
  return (
    <Link href={tool.href} className={`${base} ${enabled}`}>
      {inner}
    </Link>
  );
}
