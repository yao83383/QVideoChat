/**
 * sherpa-engine — realtime ASR via sherpa-onnx WebAssembly.
 *
 * v2 (2026-07-22): 从流式 zipformer(zh-en 双语)升级到 VAD + offline
 * SenseVoice small(中/英/日/韩/粤 5 语种).识别准确率大幅提升,尤其
 * 中英切换.代价是失去 streaming interim —— 必须等一整句结束才出结果.
 *
 * Bundle at client/public/sherpa-asr/:
 *   sherpa-onnx-asr.js               offline OfflineRecognizer wrapper (~54KB)
 *   sherpa-onnx-vad.js               VAD (Silero) wrapper (~8KB)
 *   sherpa-onnx-wasm-main-vad-asr.js emscripten glue (~117KB)
 *   sherpa-onnx-wasm-main-vad-asr.wasm ONNX runtime + sherpa binary (~13MB)
 *   sherpa-onnx-wasm-main-vad-asr.data preload FS: silero_vad.onnx +
 *     sense-voice.onnx + tokens.txt (~240MB)
 *
 * Pipeline:
 *   mic → 16k downsample → CircularBuffer
 *          → 每 512 samples 切片喂 VAD (silero)
 *          → VAD 检测句末 → 取整段 samples
 *          → OfflineRecognizer 一次性识别
 *          → onResult(text, isFinal=true)
 *
 * 外部 API 完全等价 v1 —— createSherpaEngine 签名不变;上游 RoomClient /
 * /tools/translate 不用改.只是 onResult 里的 result 只有 final(没有
 * interim 更新),这体现在字幕不再流式跳字,而是"整句一次出".
 */

import type { ASRResult } from "./asr";

type ASRCallback = (result: ASRResult) => void;

export interface SherpaEngine {
  start: () => Promise<void>;
  stop: () => void;
}

const SAMPLE_RATE = 16000;

// ---- wasm typings (opaque handles + module object) ----
type EmscriptenModule = {
  onRuntimeInitialized?: () => void;
  locateFile?: (path: string, prefix?: string) => string;
  setStatus?: (status: string) => void;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  [k: string]: any;
};

interface OfflineStreamHandle {
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
  free?: () => void;
}

interface OfflineRecognizerHandle {
  createStream: () => OfflineStreamHandle;
  decode: (s: OfflineStreamHandle) => void;
  getResult: (s: OfflineStreamHandle) => { text: string; lang?: string };
}

interface VadHandle {
  acceptWaveform: (samples: Float32Array) => void;
  isEmpty: () => boolean;
  isDetected: () => boolean;
  pop: () => void;
  clear: () => void;
  front: () => { samples: Float32Array; start: number };
  reset: () => void;
  flush: () => void;
  free: () => void;
  config: any;
}

interface CircularBufferHandle {
  push: (samples: Float32Array) => void;
  get: (startIndex: number, n: number) => Float32Array;
  pop: (n: number) => void;
  size: () => number;
  head: () => number;
  reset: () => void;
  free: () => void;
}

type SherpaGlobal = {
  Module?: EmscriptenModule;
  OfflineRecognizer?: new (config: any, module: EmscriptenModule) => OfflineRecognizerHandle;
  createVad?: (module: EmscriptenModule, config?: any) => VadHandle;
  CircularBuffer?: new (capacity: number, module: EmscriptenModule) => CircularBufferHandle;
};

function sherpaBasePath(): string {
  const base =
    (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "") || "";
  return `${base}/sherpa-asr`;
}

// ---- load state progress ----
export type SherpaLoadState = {
  phase: "idle" | "downloading" | "initializing" | "ready" | "error";
  loaded: number;
  total: number;
  percent: number;
  message?: string;
  error?: string;
};

const loadListeners = new Set<(s: SherpaLoadState) => void>();
const loadState: SherpaLoadState = {
  phase: "idle", loaded: 0, total: 0, percent: 0,
};

export function onSherpaLoadChange(cb: (s: SherpaLoadState) => void): () => void {
  loadListeners.add(cb);
  cb(loadState);
  return () => { loadListeners.delete(cb); };
}

function updateLoadState(patch: Partial<SherpaLoadState>) {
  Object.assign(loadState, patch);
  if (loadState.total > 0) {
    loadState.percent = Math.min(100, Math.round((loadState.loaded / loadState.total) * 100));
  }
  for (const l of loadListeners) l({ ...loadState });
}

// ---- OPFS cache for the ~240MB .data payload ----
//
// v2 换 bundle 后文件名变了(sherpa-onnx-wasm-main-**vad**-asr.data),
// OPFS key 前缀也带 v2.  prune 会一次性清所有 sherpa 老前缀文件,
// 保证升级路径干净.
const SHERPA_DATA_VERSION = "v2-1.13.2-sensevoice-vad";
const SHERPA_DATA_OPFS_KEY = `sherpa-vad-asr.data-${SHERPA_DATA_VERSION}`;

async function opfsGetRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === "undefined") return null;
    if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") return null;
    return await navigator.storage.getDirectory();
  } catch (e) {
    console.warn("[sherpa opfs] getDirectory failed:", e);
    return null;
  }
}

async function opfsReadFile(root: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer | null> {
  try {
    const handle = await root.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function opfsWriteFile(root: FileSystemDirectoryHandle, name: string, buf: ArrayBuffer): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await (handle as any).createWritable();
  await writable.write(buf);
  await writable.close();
}

async function opfsPruneStaleData(root: FileSystemDirectoryHandle, keep: string): Promise<void> {
  try {
    // @ts-expect-error entries() 存在但 TS lib 未列
    for await (const [name] of root.entries()) {
      if (typeof name === "string"
          && (name.startsWith("sherpa-onnx-wasm-main-asr.data-")
              || name.startsWith("sherpa-vad-asr.data-")
              || name.startsWith("sherpa-onnx-wasm-main-vad-asr.data-"))
          && name !== keep) {
        try {
          await root.removeEntry(name);
          console.log("[sherpa opfs] pruned stale", name);
        } catch { /* best-effort */ }
      }
    }
  } catch { /* iterator unsupported */ }
}

async function fetchDataWithProgress(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
  const total = Number(resp.headers.get("content-length") || 0);
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.length;
    updateLoadState({
      phase: "downloading",
      loaded, total,
      message: total > 0
        ? `下载识别模型 ${(loaded / 1_048_576).toFixed(1)}/${(total / 1_048_576).toFixed(0)}MB`
        : `下载识别模型 ${(loaded / 1_048_576).toFixed(1)}MB`,
    });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}

async function resolveDataBlobUrl(baseUrl: string): Promise<string> {
  const root = await opfsGetRoot();
  if (root) {
    const cached = await opfsReadFile(root, SHERPA_DATA_OPFS_KEY);
    if (cached && cached.byteLength > 0) {
      updateLoadState({
        phase: "downloading",
        loaded: cached.byteLength, total: cached.byteLength,
        message: `本地缓存加载 ${(cached.byteLength / 1_048_576).toFixed(0)}MB`,
      });
      console.log("[sherpa opfs] hit", SHERPA_DATA_OPFS_KEY, "size=", cached.byteLength);
      return URL.createObjectURL(new Blob([cached], { type: "application/octet-stream" }));
    }
  }

  console.log("[sherpa opfs] miss, fetching", baseUrl);
  const buf = await fetchDataWithProgress(baseUrl);

  if (root) {
    try {
      await opfsWriteFile(root, SHERPA_DATA_OPFS_KEY, buf);
      console.log("[sherpa opfs] wrote", SHERPA_DATA_OPFS_KEY, "size=", buf.byteLength);
      await opfsPruneStaleData(root, SHERPA_DATA_OPFS_KEY);
    } catch (e) {
      console.warn("[sherpa opfs] write failed (will refetch next time):", e);
    }
  }
  return URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
}

// ---- singleton bootstrap ----
//
// v2 里 loaded state = { recognizer, Module }.recognizer 全局共享;每个
// createSherpaEngine 实例自己拿 vad + buffer(vad 有内部状态,不能共享).

interface SherpaEnv {
  Module: EmscriptenModule;
  recognizer: OfflineRecognizerHandle;
}

let envPromise: Promise<SherpaEnv> | null = null;

async function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-sherpa="${src}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.sherpa = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * fetch sherpa-onnx-{asr,vad}.js 的源码,自己 append `window.X = X;`
 * 挂上关键 class,然后 script tag inject.
 *
 * 需要这么绕的原因:v1.13.2 的 wrapper 在浏览器分支不 export 到 window
 * (只 Node.js 分支 module.exports).class 声明在 script 顶级会进 script
 * realm 的 lexical bindings,indirect eval 也拿不到.唯一稳的方法是自己
 * 拼接源码里加一句"暴露"再 eval.
 *
 * 这个 fn 幂等 —— 每个 URL 只 inject 一次,重复调直接 return.
 */
const injected = new Set<string>();
async function loadScriptWithExports(url: string, exportNames: string[]): Promise<void> {
  if (injected.has(url)) return;
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
  const src = await resp.text();
  const shim = exportNames
    .map((n) => `if (typeof ${n} !== 'undefined') window.${n} = ${n};`)
    .join(" ");
  const full = `${src}\n;(function(){${shim}})();`;
  return new Promise((resolve, reject) => {
    try {
      // Blob URL 传给 script tag,而不是 inline text — inline text 在
      // 有严格 CSP 的环境会被拒;blob: 通常允许.
      const blob = new Blob([full], { type: "application/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      const s = document.createElement("script");
      s.src = blobUrl;
      s.async = true;
      s.dataset.sherpa = url;
      s.onload = () => {
        URL.revokeObjectURL(blobUrl);
        injected.add(url);
        resolve();
      };
      s.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`inject failed for ${url}`));
      };
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });
}

function ensureSherpaLoaded(): Promise<SherpaEnv> {
  if (envPromise) return envPromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("sherpa can only load in the browser"));
  }

  const base = sherpaBasePath();
  const w = window as unknown as SherpaGlobal & Window;

  envPromise = (async () => {
    updateLoadState({ phase: "downloading", message: "加载识别模型..." });
    let dataBlobUrl: string | null = null;
    try {
      // 1) OfflineRecognizer + VAD + CircularBuffer wrappers.
      // 用 loadScriptWithExports —— fetch 源码后自己 append `window.X = X`
      // 再 inject.绕过 v1.13.2 上游 wrapper 不 export 到浏览器 window
      // 的漏洞;和"public/sherpa-asr/sherpa-onnx-*.js 结尾手改的 4 行
      // patch"效果等价,但不依赖服务器上文件的补丁状态,也不吃浏览器对
      // 老 asr.js 的 immutable 缓存 —— fetch 每次都会走(浏览器有权
      // conditional GET 但 body 一样).
      await loadScriptWithExports(
        `${base}/sherpa-onnx-asr.js`,
        ["OfflineRecognizer", "createOnlineRecognizer"],
      );
      await loadScriptWithExports(
        `${base}/sherpa-onnx-vad.js`,
        ["createVad", "CircularBuffer", "Vad"],
      );

      // 2) Resolve the ~240MB .data payload via OPFS (memory-speed once cached).
      dataBlobUrl = await resolveDataBlobUrl(`${base}/sherpa-onnx-wasm-main-vad-asr.data`);

      // 3) Install the Module contract emscripten expects, then load glue.
      w.Module = w.Module || {};
      const M = w.Module!;

      M.locateFile = (path: string) => {
        const url = path.endsWith(".data") && dataBlobUrl
          ? dataBlobUrl
          : `${base}/${path}`;
        console.log("[sherpa] locateFile", path, "->", url.startsWith("blob:") ? "[blob]" : url);
        return url;
      };

      const dumpTimer = setInterval(() => {
        console.log("[sherpa heartbeat]", {
          calledRun: (M as any).calledRun,
          runtimeInitialized: (M as any).runtimeInitialized,
          crossOriginIsolated: typeof self !== "undefined" ? self.crossOriginIsolated : "n/a",
        });
      }, 2000);

      let resolveInit: (() => void) | null = null;
      let initSettled = false;
      const finishInit = (source: string) => {
        if (initSettled) return;
        initSettled = true;
        clearInterval(dumpTimer);
        clearInterval(pollTimer);
        console.log(`[sherpa] runtime ready (via ${source})`);
        updateLoadState({ phase: "initializing", message: "初始化识别引擎..." });
        resolveInit?.();
        resolveInit = null;
      };

      // Poll fallback: 某些 emscripten build + blob URL 组合下
      // onRuntimeInitialized 不 fire.每 300ms 直接 poll Module.calledRun
      // (emscripten 里 main() 跑完就置 true),兜底 finish.
      const pollTimer = setInterval(() => {
        if ((M as any).calledRun === true) {
          finishInit("Module.calledRun");
        }
      }, 300);

      const initReady = new Promise<void>((resolve, reject) => {
        resolveInit = resolve;
        M.onRuntimeInitialized = () => finishInit("onRuntimeInitialized");
        M.onAbort = (reason: any) => {
          clearInterval(dumpTimer);
          clearInterval(pollTimer);
          console.error("[sherpa] onAbort:", reason);
          reject(new Error(`sherpa wasm abort: ${reason}`));
        };
      });

      M.setStatus = (status: string) => {
        console.log("[sherpa status]", JSON.stringify(status));
        // 空 status = emscripten 完成信号 —— fallback resolve 兜底
        if (!status) {
          finishInit("empty setStatus");
          return;
        }
        const p = loadState.phase;
        const phaseLocked = p === "initializing" || p === "ready" || p === "error";
        const m = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
        if (m) {
          const patch: Partial<SherpaLoadState> = {
            loaded: Number(m[1]),
            total: Number(m[2]),
            message: status,
          };
          if (!phaseLocked) patch.phase = "downloading";
          updateLoadState(patch);
          return;
        }
        // "Running..." 也是 runtime 已经就绪的信号 —— 也 fallback resolve
        if (status === "Running...") {
          finishInit("Running...");
          return;
        }
        updateLoadState({ message: status });
      };
      M.print = (msg: string) => console.log("[sherpa print]", msg);
      M.printErr = (msg: string) => console.warn("[sherpa printErr]", msg);

      await loadScript(`${base}/sherpa-onnx-wasm-main-vad-asr.js`);
      await initReady;

      // 有些 emscripten build 会在 setStatus("") 之前把 native symbols
      // 注册好;但保险起见,再 poll 一下 wasm 里的 CreateOfflineRecognizer
      // native fn 真正可用.最多等 5 秒.超时就直接尝试,让下面的 catch 兜底.
      const waitForNative = async () => {
        for (let i = 0; i < 50; i++) {
          if (typeof (M as any)._SherpaOnnxCreateOfflineRecognizer === "function") return;
          await new Promise((r) => setTimeout(r, 100));
        }
      };
      await waitForNative();

      // .data 已经进入 emscripten FS,可以 revoke blob URL 释放内存
      if (dataBlobUrl) {
        URL.revokeObjectURL(dataBlobUrl);
        dataBlobUrl = null;
      }

      if (typeof w.OfflineRecognizer !== "function") {
        throw new Error("OfflineRecognizer missing after script load");
      }

      // Build offline recognizer once, share across engine instances.
      // SenseVoice small,useInverseTextNormalization=1 让阿拉伯数字/标点
      // 自动规范化(比如 "五十" → "50"),更适合字幕/翻译输入.
      const recognizerConfig = {
        modelConfig: {
          debug: 1,
          tokens: "./tokens.txt",
          senseVoice: {
            model: "./sense-voice.onnx",
            useInverseTextNormalization: 1,
          },
        },
      };
      const Ctor = w.OfflineRecognizer;
      if (typeof Ctor !== "function") {
        throw new Error(
          `OfflineRecognizer missing after script load. `
          + `typeof=${typeof Ctor}. `
          + `window keys with 'ffline'=${Object.keys(window).filter((k) => /ffline/i.test(k)).join(",")}`,
        );
      }
      const recognizer = new Ctor(recognizerConfig, M);

      updateLoadState({ phase: "ready", message: "识别就绪" });
      return { Module: M, recognizer };
    } catch (e: any) {
      if (dataBlobUrl) { try { URL.revokeObjectURL(dataBlobUrl); } catch { /* ignore */ } }
      // 不清 envPromise —— 一旦初始化 flow 失败,不要让下一次
      // preloadSherpa/ensureSherpaLoaded 重跑整个 190MB 加载,让 error
      // 显式暴露给 UI.用户刷新页面来重试.
      updateLoadState({ phase: "error", error: e?.message || String(e) });
      console.error("[sherpa] init failed:", e);
      throw e;
    }
  })();

  return envPromise;
}

export function preloadSherpa(): Promise<void> {
  return ensureSherpaLoaded().then(() => undefined);
}

// ---- audio pipeline ----

function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate <= SAMPLE_RATE) return input;
  const ratio = inRate / SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcStart = i * ratio;
    const srcEnd = Math.min(srcStart + ratio, input.length);
    let sum = 0;
    let n = 0;
    for (let j = Math.floor(srcStart); j < srcEnd; j++) {
      sum += input[j];
      n++;
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

export function createSherpaEngine(
  micStream: MediaStream,
  lang: string,
  onResult: ASRCallback,
  onError?: (err: string) => void,
  onStatus?: (status: string) => void,
): SherpaEngine {
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let env: SherpaEnv | null = null;
  let vad: VadHandle | null = null;
  let buffer: CircularBufferHandle | null = null;
  let running = false;
  let actualRate = SAMPLE_RATE;
  let speakingActive = false; // 是否处于 "说话中"

  const handleAudio = (input: Float32Array) => {
    if (!vad || !buffer || !env) return;
    const samples = actualRate === SAMPLE_RATE
      ? input
      : downsampleTo16k(input, actualRate);
    try {
      buffer.push(samples);
      const windowSize = vad.config.sileroVad.windowSize;
      while (buffer.size() > windowSize) {
        const chunk = buffer.get(buffer.head(), windowSize);
        vad.acceptWaveform(chunk);
        buffer.pop(windowSize);

        // 状态转换:是否在说话.用于 UI "..." 提示.
        const nowSpeaking = vad.isDetected();
        if (nowSpeaking && !speakingActive) {
          speakingActive = true;
          onStatus?.("speaking");
        } else if (!nowSpeaking && speakingActive) {
          speakingActive = false;
          onStatus?.("listening");
        }

        // 有已完成的 segment 就跑 offline recognizer
        while (!vad.isEmpty()) {
          const segment = vad.front();
          vad.pop();
          try {
            const stream = env.recognizer.createStream();
            stream.acceptWaveform(SAMPLE_RATE, segment.samples);
            env.recognizer.decode(stream);
            const raw = env.recognizer.getResult(stream);
            const text = (raw.text || "").trim();
            stream.free?.();
            if (text) {
              onResult({ text, lang, engine: "sherpa", isFinal: true });
            }
          } catch (e: any) {
            console.error("[sherpa] recognize segment failed:", e);
            onError?.(`recognize: ${e?.message || String(e)}`);
          }
        }
      }
    } catch (e: any) {
      console.error("[sherpa] pipeline error:", e);
      onError?.(String(e?.message || e));
    }
  };

  return {
    start: async () => {
      if (running) return;
      running = true;
      onStatus?.("starting");
      try {
        env = await ensureSherpaLoaded();
        if (!running) return; // stop() 抢先

        const w = window as unknown as SherpaGlobal;
        if (typeof w.createVad !== "function" || typeof w.CircularBuffer !== "function") {
          throw new Error("VAD/CircularBuffer wrappers missing");
        }

        // 每个 engine 实例独立 vad + buffer(vad 有内部状态,共享会串音).
        // VAD tuning(v1.4.0.013):
        //   minSilenceDuration: 0.5s → 0.2s
        //   minSpeechDuration:  0.25s → 0.15s
        //
        // 默认(0.5s 静音才判句末)在流式跳字体验上太钝 —— 用户说"你好,
        // 今天怎么样"要等半秒静音才出第一段.压到 0.2s 后,自然停顿处
        // 会被切成短段(比如"你好" / "今天怎么样"),视觉上像跟随;副作用
        // 是长句被切成多段可能连贯性和上下文推理差一点,但对通话/翻译
        // 场景一段两三个字的短语更符合口语节奏.其余 sileroVad 字段保
        // 留 wrapper 默认(threshold 0.5 / windowSize 512 / maxSpeechDuration 20).
        const vadConfig = {
          sileroVad: {
            model: "./silero_vad.onnx",
            threshold: 0.5,
            minSilenceDuration: 0.2,
            minSpeechDuration: 0.15,
            maxSpeechDuration: 20,
            windowSize: 512,
          },
          tenVad: {
            model: "",
            threshold: 0.5,
            minSilenceDuration: 0.2,
            minSpeechDuration: 0.15,
            maxSpeechDuration: 20,
            windowSize: 256,
          },
          sampleRate: 16000,
          numThreads: 1,
          provider: "cpu",
          debug: 0,
          bufferSizeInSeconds: 30,
        };
        vad = w.createVad!(env.Module, vadConfig);
        buffer = new w.CircularBuffer!(30 * SAMPLE_RATE, env.Module);
        speakingActive = false;

        audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        actualRate = audioCtx.sampleRate;
        console.log("[sherpa] AudioContext sampleRate requested=16000 actual=", actualRate);

        source = audioCtx.createMediaStreamSource(micStream);
        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (!running) return;
          const buf = e.inputBuffer.getChannelData(0);
          const copy = new Float32Array(buf.length);
          copy.set(buf);
          handleAudio(copy);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);

        onStatus?.("listening");
      } catch (e: any) {
        running = false;
        onStatus?.("error");
        onError?.(e?.message || String(e));
      }
    },
    stop: () => {
      running = false;
      onStatus?.("idle");
      try { processor?.disconnect(); } catch { /* ignore */ }
      try { source?.disconnect(); } catch { /* ignore */ }
      try { audioCtx?.close(); } catch { /* ignore */ }
      try { vad?.free(); } catch { /* ignore */ }
      try { buffer?.free(); } catch { /* ignore */ }
      processor = null;
      source = null;
      audioCtx = null;
      vad = null;
      buffer = null;
      speakingActive = false;
    },
  };
}
