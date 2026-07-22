"use client";

/**
 * /tools/translate —— 实时双向翻译.
 *
 * 场景:出国 / 面对面沟通,不涉及视频通话,不需要匹配对方,不联网 P2P.
 * 只用本地 sherpa ASR + transformers.js 翻译.
 *
 * 交互:
 *   ← 返回      🌐 中 ⇋ 英
 *   ┌──────────────┐
 *   │  🇺🇸  英文      │  ← 对方那侧(A pane)
 *   │  Hello, ...    │
 *   │  你好, ...     │
 *   ├──────────────┤
 *   │  🇨🇳  中文      │  ← 我这侧(B pane)
 *   │  谢谢, ...     │
 *   │  Thanks, ...   │
 *   └──────────────┘
 *   [   🎤 常开中   ]  一个大按钮,tap 暂停/继续
 *
 * 语种判断:sherpa 是 zh-en 双语混合模型,识别结果就是原文.
 * 用 CJK 字符判断:含中日韩汉字 → 中文,否则 → 英文.然后翻译到另一种.
 *
 * 常开麦克风:一直录音一直识别,sherpa 自己判断句末.每句 final →
 * 分类 → 翻译 → 显示到对应 pane + 加进历史(仅本次会话内存,不落库).
 *
 * 未来可扩:更多语对(要加更多 sherpa 模型 + transformers.js pair);
 *          历史落 localStorage;导出 / 分享.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { createSherpaEngine, preloadSherpa, onSherpaLoadChange, type SherpaLoadState } from "@/lib/ai/sherpa-engine";
import { translateText, preloadPair } from "@/lib/ai/translate";
import { onLoadingChange } from "@/lib/ai";

interface Turn {
  id: number;
  /** 说话人的原语种 —— "zh" 或 "en". */
  sourceLang: "zh" | "en";
  /** 目标语种 —— 和 sourceLang 相反. */
  targetLang: "zh" | "en";
  sourceText: string;
  translatedText: string | null;
  ts: number;
}

/** CJK 判定:U+4E00-U+9FFF 汉字 + U+3400-U+4DBF 扩展 + U+3040-U+30FF 假名.
 *  实际只要有 1 个汉字/假名就归中文,避免"OK"混在中文句里被误判为英文. */
function detectLang(text: string): "zh" | "en" {
  if (/[぀-ヿ㐀-䶿一-鿿]/.test(text)) return "zh";
  return "en";
}

const LANG_META: Record<"zh" | "en", { label: string; flag: string; hint: string }> = {
  zh: { label: "中文", flag: "🇨🇳", hint: "对着话筒说中文..." },
  en: { label: "English", flag: "🇺🇸", hint: "Speak in English..." },
};

export default function TranslatePage() {
  const [micOn, setMicOn] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interimSelf, setInterimSelf] = useState<string>("");
  const [asrError, setAsrError] = useState<string | null>(null);
  const [asrStatus, setAsrStatus] = useState<string>("idle");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [permError, setPermError] = useState<string | null>(null);

  // Sherpa / translate model 加载进度 —— 用户第一次进来要下 ~209MB + ~78MB
  const [sherpaLoad, setSherpaLoad] = useState<SherpaLoadState>({
    phase: "idle", loaded: 0, total: 0, percent: 0,
  });
  const [modelLoading, setModelLoading] = useState(false);
  // initializing 阶段等太久(>90s)时显示"刷新页面"提示 —— 首次真实场景
  // 应该在 30-60s 内完成,超过就大概率有问题(网络断了 / 磁盘满了 /
  // emscripten 挂 pthread worker 失败).
  const [longWait, setLongWait] = useState(false);

  const turnIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Sherpa 预载(一进来就下,不等用户开麦)
  useEffect(() => {
    preloadSherpa().catch((e) => {
      setAsrError(`识别模型加载失败: ${e?.message || e}`);
    });
    // 双向都可能用到 → 两对翻译都预载
    preloadPair("zh", "en").catch(() => { /* silent */ });
    preloadPair("en", "zh").catch(() => { /* silent */ });
  }, []);

  useEffect(() => onSherpaLoadChange(setSherpaLoad), []);

  // initializing 阶段 90s 超时 → 显示"刷新页面"提示.重置逻辑:每次
  // phase 变都重设,ready 时永久隐藏.
  useEffect(() => {
    if (sherpaLoad.phase === "ready") { setLongWait(false); return; }
    if (sherpaLoad.phase !== "initializing") { setLongWait(false); return; }
    const t = setTimeout(() => setLongWait(true), 90_000);
    return () => clearTimeout(t);
  }, [sherpaLoad.phase]);

  useEffect(() => {
    return onLoadingChange((s) => {
      setModelLoading(Array.from(s.active).length > 0);
    });
  }, []);

  // 麦克风 —— 独立于 WebRTC.常开时保持一个 MediaStream,micOn=false 时
  // 关掉 track 省电.tab 切走应该也停 —— 用 visibilitychange 兜底.
  useEffect(() => {
    if (!micOn) {
      setMicStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        acquired = s;
        setMicStream(s);
        setPermError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setPermError(e?.name === "NotAllowedError" ? "麦克风权限被拒绝" : (e?.message || "无法访问麦克风"));
      });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
    };
  }, [micOn]);

  // 页面切走 → 停麦(节能 + 隐私). 回来时用户需要重新 tap 才恢复.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) setMicOn(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Sherpa ASR pipeline —— 参考 RoomClient 的用法.
  // sherpa 是 zh-en 双语混合识别,createSherpaEngine 的 `lang` 参数只是
  // 回调透传,底层不影响识别范围.
  useEffect(() => {
    if (!micOn || !micStream) return;
    if (sherpaLoad.phase !== "ready" && sherpaLoad.phase !== "downloading" && sherpaLoad.phase !== "initializing") {
      // 尚未 preload —— 上面的 useEffect 会触发,这里等下一轮 tick.
    }
    setAsrError(null);
    setAsrStatus("starting");
    let cancelled = false;
    let inflight = 0;

    const engine = createSherpaEngine(
      micStream,
      "zh", // 参数只是 tag,不影响识别
      (result) => {
        if (cancelled) return;
        setInterimSelf(result.text);
        if (!result.isFinal) return;
        const text = result.text.trim();
        if (!text) return;
        const sourceLang = detectLang(text);
        const targetLang = sourceLang === "zh" ? "en" : "zh";
        const id = ++turnIdRef.current;
        const turn: Turn = {
          id,
          sourceLang,
          targetLang,
          sourceText: text,
          translatedText: null,
          ts: Date.now(),
        };
        setTurns((prev) => [...prev, turn]);
        setInterimSelf("");

        const seq = ++inflight;
        translateText(text, sourceLang, targetLang)
          .then((tr) => {
            if (cancelled || seq !== inflight) {
              // 后到但不是最新 → 一样写进对应 id 的 turn,不 skip.
            }
            setTurns((prev) => prev.map((t) => t.id === id
              ? { ...t, translatedText: tr.translatedText }
              : t
            ));
          })
          .catch((e) => {
            setTurns((prev) => prev.map((t) => t.id === id
              ? { ...t, translatedText: `[翻译失败: ${e?.message || e}]` }
              : t
            ));
          });
      },
      (err) => { setAsrError(err); },
      (status) => { if (!cancelled) setAsrStatus(status); },
    );
    engine.start().catch((e) => {
      if (cancelled) return;
      setAsrError(e?.message || String(e));
    });
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, [micOn, micStream, sherpaLoad.phase]);

  // 自动滚到底部 —— 有新 turn 时
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [turns, interimSelf]);

  const clearHistory = useCallback(() => {
    setTurns([]);
    setInterimSelf("");
    turnIdRef.current = 0;
  }, []);

  return (
    <main className="max-w-md mx-auto min-h-screen flex flex-col px-4 pt-5 pb-32">
      <header className="flex items-center gap-3 mb-3">
        <Link
          href="/tools"
          aria-label="返回"
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
        >
          ←
        </Link>
        <div className="flex flex-col flex-1">
          <h1 className="text-lg font-semibold text-slate-900">实时翻译</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">中 ⇋ 英 · 说话自动翻译</p>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="text-xs text-slate-500 hover:text-rose-600 transition"
          >
            清空
          </button>
        )}
      </header>

      {/* 加载状态 —— 首次进入下载 sherpa + 翻译模型.
          - downloading + percent < 100 显示下载进度
          - downloading + percent == 100(数据全到位,等 emscripten 挂载 FS) 显示 "启动引擎中..."
          - initializing 显示 "初始化识别引擎..."
          - 长时间(>90s)initializing 显示可刷新提示 */}
      {(sherpaLoad.phase === "downloading" || sherpaLoad.phase === "initializing") && (
        <div className="mb-3 rounded-xl bg-cyan-50 border border-cyan-200 p-3">
          <p className="text-xs text-cyan-800 font-medium">
            {sherpaLoad.phase === "initializing"
              ? "初始化识别引擎..."
              : sherpaLoad.percent >= 100
                ? "启动引擎中..."
                : `下载识别模型 ${sherpaLoad.percent > 0 ? sherpaLoad.percent + "%" : ""}`}
            {sherpaLoad.total > 0 && sherpaLoad.phase === "downloading" && sherpaLoad.percent < 100 && (
              <span className="text-cyan-600 ml-1">
                ({(sherpaLoad.loaded / 1_048_576).toFixed(1)} / {(sherpaLoad.total / 1_048_576).toFixed(0)} MB)
              </span>
            )}
          </p>
          {/* emscripten 底层状态 —— 只在真的能帮上忙的时候显示,不要把
              "本地缓存加载 229MB" / "加载识别模型..." 这些自己写的
              占位 message 又展示一遍 */}
          {sherpaLoad.message
            && !sherpaLoad.message.startsWith("本地缓存加载")
            && !sherpaLoad.message.startsWith("下载识别模型")
            && !sherpaLoad.message.startsWith("加载识别模型")
            && sherpaLoad.message !== "初始化识别引擎..."
            && sherpaLoad.message !== "识别就绪" && (
            <p className="text-[10px] text-cyan-700/80 mt-1 font-mono truncate">
              {sherpaLoad.message}
            </p>
          )}
          <div className="mt-2 h-1 rounded-full bg-cyan-100 overflow-hidden">
            <div
              className={`h-full bg-cyan-500 transition-all ${
                (sherpaLoad.phase === "initializing" || sherpaLoad.percent >= 100) ? "animate-pulse" : ""
              }`}
              style={{
                width: `${
                  sherpaLoad.phase === "initializing" || sherpaLoad.percent >= 100
                    ? 100 : sherpaLoad.percent
                }%`,
              }}
            />
          </div>
          {sherpaLoad.percent < 100 && (
            <p className="text-[10px] text-cyan-600/70 mt-2">
              首次约 30-60 秒 · 模型 ~240MB · 下次访问会从本地缓存直接启动
            </p>
          )}
          {longWait && (
            <p className="text-[10px] text-amber-600 mt-1">
              等太久了?试试 <button
                type="button"
                onClick={() => window.location.reload()}
                className="underline hover:text-amber-800"
              >刷新页面</button>
            </p>
          )}
        </div>
      )}

      {modelLoading && sherpaLoad.phase === "ready" && (
        <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs text-amber-800">首次翻译加载翻译模型...</p>
        </div>
      )}

      {permError && (
        <div className="mb-3 rounded-xl bg-rose-50 border border-rose-200 p-3">
          <p className="text-xs text-rose-700 font-medium">🎤 {permError}</p>
          <p className="text-[11px] text-rose-600/80 mt-1">
            请在浏览器地址栏 🔒 图标里授权麦克风,然后刷新页面
          </p>
        </div>
      )}

      {/* 对话历史区 —— 上滚 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto flex flex-col gap-3 pb-4"
      >
        {turns.length === 0 && !interimSelf && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="text-5xl">🎙️</div>
            <p className="text-sm text-slate-600">对着话筒说话开始翻译</p>
            <p className="text-[11px] text-slate-500 max-w-xs">
              支持中文和英文 · 说什么翻译成另一种<br />
              可以把手机递给对方,让 TA 也说话回你
            </p>
          </div>
        )}
        {turns.map((t) => <TurnBubble key={t.id} turn={t} />)}
        {interimSelf && (
          <div className="self-center rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 italic">
            {interimSelf}
          </div>
        )}
      </div>

      {/* 底部大按钮 —— 麦克风开关 */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 pb-6 pt-4 flex justify-center pointer-events-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 5.5rem)" }}
      >
        <button
          type="button"
          onClick={() => setMicOn((v) => !v)}
          disabled={!!permError}
          className={`pointer-events-auto flex items-center gap-3 rounded-full px-8 py-4 shadow-2xl transition ${
            permError
              ? "bg-slate-200 text-slate-400 cursor-not-allowed"
              : micOn
              ? "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/40"
              : "bg-slate-800 hover:bg-slate-900 text-white shadow-slate-900/40"
          }`}
        >
          <span className="text-2xl">{micOn ? "🎤" : "🔇"}</span>
          <span className="text-sm font-semibold">
            {micOn ? (asrStatus === "speaking" ? "识别中..." : "常开中 · 说话即翻译") : "已暂停"}
          </span>
        </button>
      </div>

      {asrError && (
        <div className="fixed bottom-40 left-1/2 -translate-x-1/2 z-30 max-w-md w-[calc(100%-2rem)] rounded-2xl bg-rose-100 border border-rose-300 text-rose-800 text-xs px-4 py-2 shadow-lg">
          {asrError}
        </div>
      )}
    </main>
  );
}

function TurnBubble({ turn }: { turn: Turn }) {
  const isZh = turn.sourceLang === "zh";
  // 说中文 → 右对齐(视为"我方");说英文 → 左对齐(视为"对方").
  // 便于面对面时用户直观识别谁在说.出国场景多数用户母语中文,右侧
  // 是自己更符合视觉习惯.
  const align = isZh ? "items-end" : "items-start";
  const bubble = isZh
    ? "bg-sky-500 text-white border-sky-500"
    : "bg-white text-slate-900 border-slate-200";
  const source = LANG_META[turn.sourceLang];
  const target = LANG_META[turn.targetLang];

  return (
    <div className={`flex flex-col ${align} gap-1`}>
      <span className="text-[10px] text-slate-500 flex items-center gap-1">
        <span>{source.flag}</span>
        <span>{source.label}</span>
      </span>
      <div className={`rounded-2xl border px-4 py-2.5 max-w-[85%] shadow-sm ${bubble}`}>
        <p className="text-sm leading-snug break-words">{turn.sourceText}</p>
      </div>
      {turn.translatedText !== null ? (
        <div className={`rounded-2xl border px-4 py-2 max-w-[85%] bg-slate-50 border-slate-200`}>
          <p className="text-[10px] text-slate-500 mb-0.5">
            {target.flag} {target.label}
          </p>
          <p className="text-sm leading-snug break-words text-slate-800">
            {turn.translatedText}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-500 italic">
          翻译中...
        </div>
      )}
    </div>
  );
}
