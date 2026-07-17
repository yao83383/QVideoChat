"use client";

import { useState, useRef } from "react";

type LogEntry = { time: string; type: "info" | "ok" | "err"; text: string };

export default function AsrTest() {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [audioStarted, setAudioStarted] = useState(false);
  const [firstResult, setFirstResult] = useState<string | null>(null);
  const [conclusion, setConclusion] = useState<string | null>(null);
  const [ua, setUa] = useState("");
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (type: LogEntry["type"], text: string) => {
    const time = new Date().toISOString().slice(11, 23);
    setLogs((cur) => [...cur, { time, type, text }]);
    console.log(`[asr-test ${type}]`, text);
  };

  const start = () => {
    if (running) return;
    setLogs([]);
    setAudioStarted(false);
    setFirstResult(null);
    setConclusion(null);
    setUa(navigator.userAgent);

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setApiAvailable(false);
      push("err", "SpeechRecognition API 不存在（浏览器不支持）");
      setConclusion("❌ 此浏览器不支持 Web Speech API");
      return;
    }
    setApiAvailable(true);
    push("ok", "SpeechRecognition API 存在");

    const r = new SR();
    r.lang = "zh-CN";
    r.continuous = false;
    r.interimResults = true;

    r.onstart = () => push("info", "onstart 触发（recognition 已 start）");
    r.onaudiostart = () => {
      push("ok", "onaudiostart 触发（成功连上 Google 云端）");
      setAudioStarted(true);
    };
    r.onspeechstart = () => push("ok", "onspeechstart 触发（检测到人声）");
    r.onspeechend = () => push("info", "onspeechend 触发");
    r.onaudioend = () => push("info", "onaudioend 触发");
    r.onnomatch = () => push("info", "onnomatch 触发");
    r.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      const text = last[0].transcript;
      const isFinal = last.isFinal;
      push("ok", `${isFinal ? "FINAL" : "interim"}: "${text}"`);
      if (!firstResult) setFirstResult(text);
    };
    r.onerror = (e: any) => {
      const err = e?.error || "unknown";
      push("err", `onerror: ${err}`);
      if (err === "network") {
        setConclusion("❌ 网络无法连到 Google 云端 ASR（大陆常见）");
      } else if (err === "not-allowed") {
        setConclusion("❌ 麦克风权限被拒");
      } else if (err === "service-not-allowed") {
        setConclusion("❌ 浏览器策略禁用了语音识别服务");
      } else if (err === "no-speech") {
        push("info", "no-speech 是正常的（没人说话）");
      }
    };
    r.onend = () => {
      push("info", "onend 触发（识别会话结束）");
      setRunning(false);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (!conclusion) {
        if (audioStarted && firstResult) {
          setConclusion("✅ Web Speech 可用，识别正常");
        } else if (audioStarted && !firstResult) {
          setConclusion("⚠️ 连上了 Google 但没识别到（说话太轻/太短）");
        } else if (!audioStarted) {
          setConclusion("❌ 静默失败：API 启动了但连不上 Google（大陆典型现象）");
        }
      }
    };

    recognitionRef.current = r;
    try {
      r.start();
      setRunning(true);
      push("info", "调用了 start()，等待事件... 请对着麦克风说一句中文");
      timerRef.current = setTimeout(() => {
        if (!audioStarted) {
          push("err", "10s 未收到 audiostart —— 大概率连不上 Google");
          try { r.stop(); } catch {}
        }
      }, 10000);
    } catch (e: any) {
      push("err", `start() 抛异常: ${e?.message || e}`);
      setRunning(false);
    }
  };

  const stop = () => {
    try { recognitionRef.current?.stop(); } catch {}
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setRunning(false);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Web Speech API 网络诊断</h1>
        <p className="text-sm text-neutral-400">
          用于确认你当前浏览器 + 网络能否连上 Google 云端 ASR。给不同 PC / 手机 / 网络下的用户试，
          能看到"这个用户能不能用 Web Speech"。
        </p>

        <div className="flex gap-3">
          <button
            onClick={start}
            disabled={running}
            className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-4 py-2 text-sm font-medium"
          >
            开始测试
          </button>
          <button
            onClick={stop}
            disabled={!running}
            className="rounded-lg bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 px-4 py-2 text-sm"
          >
            停止
          </button>
        </div>

        {conclusion && (
          <div className={`rounded-lg border p-4 ${
            conclusion.startsWith("✅") ? "bg-green-900/30 border-green-700 text-green-300" :
            conclusion.startsWith("⚠️") ? "bg-yellow-900/30 border-yellow-700 text-yellow-300" :
            "bg-red-900/30 border-red-700 text-red-300"
          }`}>
            <p className="text-sm font-medium">{conclusion}</p>
          </div>
        )}

        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-3">
          <p className="text-xs text-neutral-500 mb-2">环境信息</p>
          <p className="text-xs text-neutral-400 break-all">{ua || "点开始后显示"}</p>
          {apiAvailable !== null && (
            <p className="text-xs mt-2">
              API 存在: <span className={apiAvailable ? "text-green-400" : "text-red-400"}>
                {apiAvailable ? "是" : "否"}
              </span>
            </p>
          )}
        </div>

        <div className="rounded-lg bg-neutral-900 border border-neutral-800">
          <p className="text-xs text-neutral-500 p-2 border-b border-neutral-800">日志</p>
          <div className="p-2 max-h-96 overflow-y-auto font-mono text-[11px] space-y-1">
            {logs.length === 0 && <p className="text-neutral-600 italic">点"开始测试"</p>}
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

        <div className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-xs text-neutral-500 space-y-1">
          <p className="text-neutral-400 font-medium">解读关键事件</p>
          <p>• <span className="text-green-400">onaudiostart</span> 触发 = 成功连上 Google 云 = ✅</p>
          <p>• <span className="text-red-400">onerror: network</span> = 网络明确报错 = ❌</p>
          <p>• 10s 内都没 onaudiostart 也没 onerror = 静默死 = 大陆典型 ❌</p>
          <p>• onresult 出中文 = 完美工作</p>
        </div>
      </div>
    </main>
  );
}
