"use client";

import { useEffect, useRef, useState } from "react";
import {
  createSherpaEngine,
  onSherpaLoadChange,
  preloadSherpa,
  type SherpaLoadState,
} from "@/lib/ai/sherpa-engine";
import type { SherpaEngine } from "@/lib/ai/sherpa-engine";
import type { ASRResult } from "@/lib/ai/asr";

type LogEntry = { time: string; type: "info" | "ok" | "err"; text: string };

export default function SherpaTest() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [interim, setInterim] = useState<string>("");
  const [finals, setFinals] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [load, setLoad] = useState<SherpaLoadState>({
    phase: "idle", loaded: 0, total: 0, percent: 0,
  });
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const engineRef = useRef<SherpaEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => onSherpaLoadChange(setLoad), []);
  useEffect(() => {
    // sherpa-onnx WASM is built with -pthread, which needs SharedArrayBuffer,
    // which needs the page to be crossOriginIsolated (COOP: same-origin +
    // COEP: credentialless are set in next.config.ts). Surface the state so
    // it's obvious if the environment is wrong before the user hits Start.
    setIsolated(typeof window !== "undefined" ? window.crossOriginIsolated : null);
  }, []);

  const push = (type: LogEntry["type"], text: string) => {
    const time = new Date().toISOString().slice(11, 23);
    setLogs((cur) => [...cur.slice(-30), { time, type, text }]);
    console.log(`[sherpa-test ${type}]`, text);
  };

  const preload = () => {
    push("info", "preloadSherpa() 触发...");
    preloadSherpa()
      .then(() => push("ok", "sherpa 加载完成"))
      .catch((e) => push("err", `加载失败: ${e?.message || e}`));
  };

  const start = async () => {
    if (running) return;
    try {
      push("info", "请求麦克风...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      push("ok", "麦克风获取成功");

      const engine = createSherpaEngine(
        stream,
        lang,
        (result: ASRResult) => {
          if (result.isFinal) {
            setFinals((prev) => [...prev, result.text]);
            setInterim("");
          } else {
            setInterim(result.text);
          }
        },
        (err) => push("err", err),
        (s) => { setStatus(s); push("info", `status=${s}`); },
      );
      engineRef.current = engine;
      await engine.start();
      setRunning(true);
      push("ok", "engine 启动");
    } catch (e: any) {
      push("err", `start 失败: ${e?.message || e}`);
    }
  };

  const stop = () => {
    engineRef.current?.stop();
    engineRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
    setStatus("idle");
    setInterim("");
    push("info", "engine 停止");
  };

  const clear = () => {
    setFinals([]);
    setInterim("");
    setLogs([]);
  };

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

  return (
    <main className="qv-dark-surface min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Sherpa-onnx ASR 测试</h1>
          <p className="text-sm text-neutral-400 mt-1">
            浏览器本地推理 (WASM)，模型 sherpa-onnx-streaming-zipformer-bilingual-zh-en。
            首次加载会下载 ~209MB 到浏览器缓存，之后离线可用。
          </p>
        </div>

        {/* Environment check */}
        <div className={`rounded-lg border p-3 text-xs ${
          isolated === true ? "bg-green-900/30 border-green-700 text-green-300" :
          isolated === false ? "bg-red-900/30 border-red-700 text-red-300" :
          "bg-neutral-900 border-neutral-800 text-neutral-400"
        }`}>
          crossOriginIsolated: <span className="font-mono">{String(isolated)}</span>
          {isolated === false && (
            <p className="mt-1">
              ⚠️ 页面未处于跨源隔离状态，sherpa-onnx 的 pthread wasm 会失败。
              先硬刷新 (Ctrl+Shift+R)；若仍为 false，说明 COOP/COEP 头没生效。
            </p>
          )}
        </div>

        {/* Loading state */}
        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-3">
          <div className="flex justify-between text-xs text-neutral-500 mb-1">
            <span>加载状态: <span className="text-neutral-300">{load.phase}</span></span>
            {load.total > 0 && (
              <span>{mb(load.loaded)} / {mb(load.total)} MB · {load.percent}%</span>
            )}
          </div>
          <div className="h-2 bg-neutral-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${
                load.phase === "ready" ? "bg-green-500" :
                load.phase === "error" ? "bg-red-500" :
                "bg-blue-500"
              }`}
              style={{ width: `${load.phase === "ready" ? 100 : load.percent}%` }}
            />
          </div>
          {load.message && (
            <p className="text-xs text-neutral-400 mt-1 truncate">{load.message}</p>
          )}
          {load.error && (
            <p className="text-xs text-red-400 mt-1">{load.error}</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 items-center">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "zh" | "en")}
            disabled={running}
            className="rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm disabled:opacity-40"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <button
            onClick={preload}
            disabled={load.phase === "ready" || load.phase === "downloading"}
            className="rounded-lg bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 px-4 py-2 text-sm"
          >
            预加载模型
          </button>
          <button
            onClick={start}
            disabled={running}
            className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-4 py-2 text-sm font-medium"
          >
            开始识别
          </button>
          <button
            onClick={stop}
            disabled={!running}
            className="rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 px-4 py-2 text-sm"
          >
            停止
          </button>
          <button
            onClick={clear}
            className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-sm"
          >
            清除
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          识别状态: <span className="text-neutral-300">{status}</span>
        </p>

        {/* Transcript */}
        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 min-h-[200px]">
          <p className="text-xs text-neutral-500 mb-2">识别结果</p>
          {finals.length === 0 && !interim && (
            <p className="text-neutral-600 italic text-sm">对着麦克风说话，字幕会出现在这里</p>
          )}
          {finals.map((t, i) => (
            <p key={i} className="text-neutral-100 mb-1">{t}</p>
          ))}
          {interim && (
            <p className="text-neutral-400 italic">{interim}</p>
          )}
        </div>

        {/* Logs */}
        <div className="rounded-lg bg-neutral-900 border border-neutral-800">
          <p className="text-xs text-neutral-500 p-2 border-b border-neutral-800">日志</p>
          <div className="p-2 max-h-56 overflow-y-auto font-mono text-[11px] space-y-1">
            {logs.length === 0 && (
              <p className="text-neutral-600 italic">尚无日志</p>
            )}
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-neutral-600 shrink-0">{l.time}</span>
                <span className={
                  l.type === "ok" ? "text-green-400" :
                  l.type === "err" ? "text-red-400" :
                  "text-neutral-400"
                }>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
