/**
 * sherpa-engine — realtime ASR via sherpa-onnx WebAssembly, running entirely
 * in the browser. Replaces the Tencent Cloud proxy — no server round-trip,
 * no per-minute cost, no signature dance, no /qsignal/asr WebSocket.
 *
 * Bundle at client/public/sherpa-asr/:
 *   sherpa-onnx-asr.js              wrapper defining createOnlineRecognizer()
 *   sherpa-onnx-wasm-main-asr.js    emscripten glue
 *   sherpa-onnx-wasm-main-asr.wasm  onnxruntime + sherpa-onnx binary
 *   sherpa-onnx-wasm-main-asr.data  preloaded FS: encoder/decoder/joiner + tokens.txt
 *
 * The .data file bundles a streaming Zipformer bilingual zh-en model
 * (sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20). One model,
 * both languages — the `lang` argument is passed through to callbacks
 * verbatim; it doesn't switch the underlying recognizer.
 *
 * Public API: createSherpaEngine(stream, lang, onResult, onError?, onStatus?)
 * returns { start(), stop() }. Mirrors the shape RoomClient already drives.
 */

import type { ASRResult } from "./asr";

type ASRCallback = (result: ASRResult) => void;

export interface SherpaEngine {
  start: () => Promise<void>;
  stop: () => void;
}

const SAMPLE_RATE = 16000;

type EmscriptenModule = {
  onRuntimeInitialized?: () => void;
  locateFile?: (path: string, prefix?: string) => string;
  setStatus?: (status: string) => void;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  [k: string]: any;
};

type SherpaRecognizer = {
  createStream: () => SherpaStream;
  isReady: (s: SherpaStream) => boolean;
  decode: (s: SherpaStream) => void;
  isEndpoint: (s: SherpaStream) => boolean;
  getResult: (s: SherpaStream) => { text: string; tokens?: string[] };
  reset: (s: SherpaStream) => void;
  config?: any;
};

type SherpaStream = {
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
  free?: () => void;
};

type SherpaGlobal = {
  Module?: EmscriptenModule;
  createOnlineRecognizer?: (module: EmscriptenModule) => SherpaRecognizer;
};

function sherpaBasePath(): string {
  const base =
    (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "") || "";
  return `${base}/sherpa-asr`;
}

// Progress reporting during .data + .wasm download. The emscripten runtime
// calls Module.setStatus with strings like "Downloading data... (12345/67890)"
// during preloadFile fetch.
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

// ---- OPFS cache for the 190MB .data payload ----
//
// The emscripten `.data` file bundles encoder/decoder/joiner ONNX + tokens.txt
// and never changes for a given sherpa release. HTTP `Cache-Control: immutable`
// keeps it in disk cache, but browsers evict disk cache under pressure and
// emscripten still re-parses ~190MB into the virtual FS every page load. Instead
// we mirror it into the origin-private OPFS: first visit fetches + writes,
// subsequent loads read from OPFS and hand emscripten a blob: URL — the network
// fetch inside emscripten now hits our blob (memory-speed) instead of the net.
//
// Version tag is baked into the OPFS key so upgrading the sherpa build later
// invalidates the cache cleanly (stale entries are pruned).
const SHERPA_DATA_VERSION = "v1.13.4-zh-en-zipformer";
const SHERPA_DATA_OPFS_KEY = `sherpa-onnx-wasm-main-asr.data-${SHERPA_DATA_VERSION}`;

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
    return null; // NotFoundError etc.
  }
}

async function opfsWriteFile(root: FileSystemDirectoryHandle, name: string, buf: ArrayBuffer): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true });
  // createWritable is broadly supported (Chrome 86+, Safari 15.2+, Firefox 111+).
  // Fall back silently if a browser refuses; we'll just re-fetch next time.
  const writable = await (handle as any).createWritable();
  await writable.write(buf);
  await writable.close();
}

async function opfsPruneStaleData(root: FileSystemDirectoryHandle, keep: string): Promise<void> {
  try {
    // @ts-expect-error entries() is standard on FileSystemDirectoryHandle but not always in TS lib
    for await (const [name] of root.entries()) {
      if (typeof name === "string"
          && name.startsWith("sherpa-onnx-wasm-main-asr.data-")
          && name !== keep) {
        try { await root.removeEntry(name); console.log("[sherpa opfs] pruned stale", name); }
        catch { /* best-effort */ }
      }
    }
  } catch { /* iterator unsupported — leave stale entries, minor waste */ }
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

// Resolve the .data payload as a blob: URL, using OPFS as a persistent local cache.
// Returns the blob URL — caller MUST revoke it once emscripten is done with it.
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

// ---- singleton recognizer bootstrap ----

let recognizerPromise: Promise<SherpaRecognizer> | null = null;

async function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-sherpa="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.sherpa = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export function ensureSherpaLoaded(): Promise<SherpaRecognizer> {
  if (recognizerPromise) return recognizerPromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("sherpa can only load in the browser"));
  }

  const base = sherpaBasePath();
  const w = window as unknown as SherpaGlobal & Window;

  recognizerPromise = (async () => {
    updateLoadState({ phase: "downloading", message: "加载识别模型..." });
    let dataBlobUrl: string | null = null;
    try {
      // 1) wrapper first — defines createOnlineRecognizer on the global scope.
      await loadScript(`${base}/sherpa-onnx-asr.js`);

      // 2) Resolve the 190MB .data payload BEFORE the emscripten glue starts.
      // On a warm OPFS this is a memory-speed read; on a cold cache it fetches
      // once, stores in OPFS, then hands emscripten the same blob URL. The
      // emscripten runtime will fetch the URL synchronously during preload —
      // by returning a blob:, we bypass the network path entirely.
      dataBlobUrl = await resolveDataBlobUrl(`${base}/sherpa-onnx-wasm-main-asr.data`);

      // 3) install the Module contract emscripten expects, THEN inject the
      // glue script. Order matters: emscripten's runtime reads window.Module
      // synchronously at script-eval time to pick up locateFile + hooks.
      w.Module = w.Module || {};
      const M = w.Module!;

      M.locateFile = (path: string) => {
        // Route the .data preload file at our OPFS-backed blob; everything else
        // (the .wasm binary etc.) stays on the normal HTTP path — the wasm is
        // only 19MB and disk cache handles it fine.
        const url = path.endsWith(".data") && dataBlobUrl
          ? dataBlobUrl
          : `${base}/${path}`;
        console.log("[sherpa] locateFile", path, "->", url.startsWith("blob:") ? "[blob]" : url);
        return url;
      };

      // Diagnostic heartbeat — emscripten silently stalls if a pthread worker
      // can't spin up. Print module state every 2s until we're either ready
      // or the promise rejects so we can see WHICH stage is stuck.
      const dumpTimer = setInterval(() => {
        console.log("[sherpa heartbeat]", {
          calledRun: (M as any).calledRun,
          runtimeInitialized: (M as any).runtimeInitialized,
          preloadRunning: (M as any).preloadResources,
          dataFileDownloads: (M as any).dataFileDownloads,
          crossOriginIsolated: typeof self !== "undefined" ? self.crossOriginIsolated : "n/a",
        });
      }, 2000);

      const initReady = new Promise<void>((resolve, reject) => {
        M.onRuntimeInitialized = () => {
          clearInterval(dumpTimer);
          console.log("[sherpa] onRuntimeInitialized");
          updateLoadState({ phase: "initializing", message: "初始化识别引擎..." });
          resolve();
        };
        M.onAbort = (reason: any) => {
          clearInterval(dumpTimer);
          console.error("[sherpa] onAbort:", reason);
          reject(new Error(`sherpa wasm abort: ${reason}`));
        };
      });

      M.setStatus = (status: string) => {
        console.log("[sherpa status]", JSON.stringify(status));
        if (!status) return;
        const m = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
        if (m) {
          updateLoadState({
            phase: "downloading",
            loaded: Number(m[1]),
            total: Number(m[2]),
            message: status,
          });
          return;
        }
        updateLoadState({ message: status });
      };

      // Capture EVERYTHING emscripten writes so we can see the pthread /
      // wasm instantiation trace if something fails silently.
      M.print = (msg: string) => console.log("[sherpa print]", msg);
      M.printErr = (msg: string) => console.warn("[sherpa printErr]", msg);

      await loadScript(`${base}/sherpa-onnx-wasm-main-asr.js`);
      await initReady;

      // Emscripten has finished consuming the .data blob. Release it so the
      // 190MB doesn't sit pinned in the JS heap forever.
      if (dataBlobUrl) {
        URL.revokeObjectURL(dataBlobUrl);
        dataBlobUrl = null;
      }

      if (typeof w.createOnlineRecognizer !== "function") {
        throw new Error("createOnlineRecognizer missing after script load");
      }
      const rec = w.createOnlineRecognizer(M);
      updateLoadState({ phase: "ready", message: "识别就绪" });
      return rec;
    } catch (e: any) {
      if (dataBlobUrl) { try { URL.revokeObjectURL(dataBlobUrl); } catch { /* ignore */ } }
      recognizerPromise = null;
      updateLoadState({ phase: "error", error: e?.message || String(e) });
      throw e;
    }
  })();

  return recognizerPromise;
}

// Explicit preload hook — used by RoomClient to start the download before the
// user toggles subtitles, so the first sentence isn't preceded by a cold
// 174MB fetch.
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
  let recognizer: SherpaRecognizer | null = null;
  let recStream: SherpaStream | null = null;
  let running = false;
  let actualRate = SAMPLE_RATE;
  // Track the last text hypothesis so we only emit onResult when it changes.
  // sherpa's getResult() returns an accumulating hypothesis every tick, so a
  // dumb pass-through would fire dozens of identical interim events per second.
  let lastText = "";
  let sawTranscript = false;

  const emit = (text: string, isFinal: boolean) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!sawTranscript) {
      sawTranscript = true;
      onStatus?.(isFinal ? "listening" : "speaking");
    }
    onResult({ text: trimmed, lang, engine: "sherpa", isFinal });
  };

  const handleAudio = (input: Float32Array) => {
    if (!recognizer || !recStream) return;
    const samples = actualRate === SAMPLE_RATE
      ? input
      : downsampleTo16k(input, actualRate);
    let stage: string = "start";
    try {
      stage = "acceptWaveform";
      recStream.acceptWaveform(SAMPLE_RATE, samples);
      stage = "isReady/decode";
      while (recognizer.isReady(recStream)) {
        recognizer.decode(recStream);
      }
      stage = "getResult";
      const text = recognizer.getResult(recStream).text || "";
      stage = "isEndpoint";
      const endpoint = recognizer.isEndpoint(recStream);

      if (text !== lastText) {
        lastText = text;
        emit(text, false);
      }

      if (endpoint) {
        stage = "reset";
        if (text) emit(text, true);
        recognizer.reset(recStream);
        lastText = "";
        sawTranscript = false;
        onStatus?.("listening");
      }
    } catch (e: any) {
      console.error(`[sherpa] error at stage=${stage}:`, e, "actualRate=", actualRate, "samples.len=", samples.length);
      onError?.(`${stage}: ${e?.message || String(e)}`);
    }
  };

  return {
    start: async () => {
      if (running) return;
      running = true;
      onStatus?.("starting");
      try {
        recognizer = await ensureSherpaLoaded();
        if (!running) return; // stop() beat us
        recStream = recognizer.createStream();
        lastText = "";
        sawTranscript = false;

        audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        actualRate = audioCtx.sampleRate;
        console.log("[sherpa] AudioContext sampleRate requested=16000 actual=", actualRate);

        source = audioCtx.createMediaStreamSource(micStream);
        // ScriptProcessorNode is deprecated but still universally supported and
        // matches the official sherpa-onnx web demo — swapping to AudioWorklet
        // means shipping a separate worklet file for a marginal quality win.
        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (!running) return;
          const buf = e.inputBuffer.getChannelData(0);
          // Copy — the underlying buffer is reused by the AudioContext.
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
      // Explicitly free the stream if the underlying binding exposes it —
      // otherwise emscripten's arena grows one stream per session until GC.
      try { recStream?.free?.(); } catch { /* ignore */ }
      processor = null;
      source = null;
      audioCtx = null;
      recStream = null;
      lastText = "";
      sawTranscript = false;
    },
  };
}
