/**
 * Translation worker — runs transformers.js off the main thread so ~200-500ms
 * ONNX inference calls don't jank the UI (avatar frames, subtitle typing, etc).
 *
 * Message protocol (all typed):
 *   in  { type: 'init',      basePath }                 → { type: 'ready' }
 *   in  { type: 'preload',   id, src, tgt }             → { type: 'preloaded', id, ok }
 *   in  { type: 'translate', id, text, src, tgt }       → { type: 'result', id, text }
 *                                                        | { type: 'error', id, error }
 *   out { type: 'progress',  pair, status, loaded?, total?, file? }
 */

/// <reference lib="webworker" />

import { pipeline, env } from '@huggingface/transformers';

type AnyPipe = any;

const TRANSLATE_MODELS: Record<string, string> = {
  'zh->en': 'Xenova/opus-mt-zh-en',
  'en->zh': 'Xenova/opus-mt-en-zh',
  'ja->en': 'Xenova/opus-mt-ja-en',
  'en->ja': 'Xenova/opus-mt-en-jap',
  'ko->en': 'Xenova/opus-mt-ko-en',
};

const PIVOT_LANG = 'en';

const ASR_MODEL_ID = 'Xenova/whisper-base';
const LANG_TO_WHISPER: Record<string, string> = {
  zh: 'chinese',
  en: 'english',
  ja: 'japanese',
  ko: 'korean',
};

const pipelines: Record<string, AnyPipe> = {};
const loading: Record<string, Promise<AnyPipe | null>> = {};
const failedPairs: Record<string, string> = {};

let asrPipeline: AnyPipe = null;
let asrLoading: Promise<AnyPipe | null> | null = null;
let asrFailure: string | null = null;

// Per-pair serialization: ONNX session can't run two inferences concurrently.
// Different pairs can still run in parallel.
const pairLocks = new Map<string, Promise<any>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = pairLocks.get(key) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  pairLocks.set(
    key,
    next.finally(() => {
      if (pairLocks.get(key) === next) pairLocks.delete(key);
    }),
  );
  return next;
}

const ctx: DedicatedWorkerGlobalScope = self as any;

function log(...args: any[]) {
  console.log('[worker]', ...args);
}

function post(msg: any) {
  ctx.postMessage(msg);
}

function makeProgressCallback(pair: string) {
  return (data: any) => {
    post({
      type: 'progress',
      pair,
      status: data?.status || 'unknown',
      file: data?.file,
      loaded: typeof data?.loaded === 'number' ? data.loaded : undefined,
      total: typeof data?.total === 'number' ? data.total : undefined,
    });
  };
}

async function loadDirect(src: string, tgt: string): Promise<AnyPipe | null> {
  if (!src || !tgt || src === tgt) return null;
  const pairKey = `${src}->${tgt}`;
  const modelId = TRANSLATE_MODELS[pairKey];
  if (!modelId) {
    log('no direct model for', pairKey);
    return null;
  }

  if (pipelines[pairKey]) return pipelines[pairKey];
  const existing = loading[pairKey];
  if (existing) return existing;

  log('loading', pairKey, '→', modelId);
  const t0 = Date.now();

  const pipelineOptions: any = {
    device: 'wasm',
    // Force the non-merged decoder path (belt+suspenders — the merged file
    // is deleted from disk anyway).
    use_merged: false,
    // Belt+suspenders: also pass session_options at the pipeline level in case
    // transformers.js honors it here even when the global env override doesn't
    // reach every InferenceSession.create call.
    session_options: {
      graphOptimizationLevel: 'basic',
    },
    progress_callback: makeProgressCallback(pairKey),
  };

  loading[pairKey] = pipeline('translation', modelId, pipelineOptions)
    .then((p) => {
      log(pairKey, 'ready in', Date.now() - t0, 'ms');
      pipelines[pairKey] = p;
      delete loading[pairKey];
      delete failedPairs[pairKey];
      post({ type: 'progress', pair: pairKey, status: 'done' });
      return p;
    })
    .catch((e) => {
      const errMsg = e?.message || String(e);
      // Deep-error extraction — transformers.js often wraps the underlying
      // wasm/fetch error in a generic Error; the .cause chain has the real one.
      let cause = e?.cause;
      let depth = 0;
      while (cause && depth < 4) {
        console.error('[worker] pipeline error cause:', cause?.message || cause);
        cause = cause?.cause;
        depth++;
      }
      log(pairKey, 'LOAD FAILED:', errMsg);
      console.error('[worker] pipeline load error object:', e);
      failedPairs[pairKey] = errMsg;
      delete loading[pairKey];
      post({ type: 'progress', pair: pairKey, status: 'error', file: errMsg });
      return null;
    });

  return loading[pairKey];
}

async function preloadPair(src: string, tgt: string): Promise<boolean> {
  if (!src || !tgt || src === tgt) return true;
  if (TRANSLATE_MODELS[`${src}->${tgt}`]) {
    const p = await loadDirect(src, tgt);
    return !!p;
  }
  // Pivot: load legs SEQUENTIALLY to reduce peak memory. Loading two
  // ~110MB models + a 23MB wasm runtime in parallel is what tips low-end
  // phones into an OOM crash mid-inference. Sequential is a few seconds
  // slower but keeps memory ceiling roughly halved.
  const results: Array<any> = [];
  if (src !== PIVOT_LANG) results.push(await loadDirect(src, PIVOT_LANG));
  if (tgt !== PIVOT_LANG) results.push(await loadDirect(PIVOT_LANG, tgt));
  return results.every((r) => !!r);
}

async function runPipe(p: AnyPipe, text: string): Promise<string> {
  const output = await p(text);
  let result = output?.[0]?.translation_text || '';
  // Clean up common opus-mt output artifacts:
  //   "- I'll help you"  →  "I'll help you"    (dialog-line dashes)
  //   "  Hello "         →  "Hello"            (stray whitespace)
  //   "\"Hello\""        →  "Hello"            (stray wrap quotes on short input)
  result = result.replace(/^\s*[-–—]+\s*/, '').trim();
  if (result.length > 2 && result.startsWith('"') && result.endsWith('"')) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

// ---------- ASR (whisper) ----------

async function loadASR(): Promise<AnyPipe | null> {
  if (asrPipeline) return asrPipeline;
  if (asrLoading) return asrLoading;
  if (asrFailure) return null;

  log('loading ASR', ASR_MODEL_ID);
  const t0 = Date.now();

  const asrOpts: any = {
    device: 'wasm',
    session_options: { graphOptimizationLevel: 'basic' },
    use_merged: false,
    progress_callback: (data: any) => {
      post({
        type: 'progress',
        pair: 'asr',
        status: data?.status || 'unknown',
        file: data?.file,
        loaded: typeof data?.loaded === 'number' ? data.loaded : undefined,
        total: typeof data?.total === 'number' ? data.total : undefined,
      });
    },
  };

  asrLoading = pipeline('automatic-speech-recognition', ASR_MODEL_ID, asrOpts)
    .then((p) => {
      asrPipeline = p;
      asrLoading = null;
      log('ASR ready in', Date.now() - t0, 'ms');
      post({ type: 'progress', pair: 'asr', status: 'done' });
      return p;
    })
    .catch((e) => {
      const err = e?.message || String(e);
      log('ASR load FAILED:', err);
      console.error('[worker] ASR load error:', e);
      asrLoading = null;
      asrFailure = err;
      post({ type: 'progress', pair: 'asr', status: 'error', file: err });
      return null;
    });

  return asrLoading;
}

async function transcribe(audio: Float32Array, lang: string): Promise<string> {
  const pipe = await loadASR();
  if (!pipe) {
    throw new Error(asrFailure || 'ASR pipeline unavailable');
  }
  const whisperLang = LANG_TO_WHISPER[lang] || undefined;
  const t0 = Date.now();
  log('transcribe input', audio.constructor?.name, audio.length, 'samples');
  // @huggingface/transformers 4.x whisper pipeline: pass the Float32Array
  // DIRECTLY (assumed to be 16kHz mono). The older `{ raw, sampling_rate }`
  // wrapper is Xenova-transformers-only and causes "e.subarray is not a
  // function" here because the feature extractor tries to call `.subarray`
  // on what it thought was a raw waveform.
  const result = await withLock('asr', () => (pipe as any)(
    audio,
    {
      language: whisperLang,
      task: 'transcribe',
      // Shorter chunk_length_s tells whisper the max audio length we'll
      // send, avoiding wasteful mel-spectrogram padding to 30s. Utterances
      // are capped by VAD at MAX_UTTERANCE_MS = 5s, so 6s is enough headroom.
      chunk_length_s: 6,
      return_timestamps: false,
    },
  ));
  const text = String((result as any)?.text || '').trim();
  log('transcribe', audio.length, 'samples in', Date.now() - t0, 'ms →', text || '(empty)');
  return text;
}

async function translate(text: string, src: string, tgt: string): Promise<string> {
  if (!text.trim() || src === tgt) return text;
  const t0 = Date.now();
  log('translate:', src, '→', tgt, `"${text}"`);

  const direct = await loadDirect(src, tgt);
  if (direct) {
    const result = await withLock(`${src}->${tgt}`, () => runPipe(direct, text));
    log('translated (direct) in', Date.now() - t0, 'ms →', result);
    return result;
  }

  // Direct pair exists in the mapping but loading failed → surface the REAL
  // reason instead of falling through to the misleading "no model" branch.
  const directKey = `${src}->${tgt}`;
  if (TRANSLATE_MODELS[directKey]) {
    const why = failedPairs[directKey] || 'pipeline init failed';
    throw new Error(`模型 ${directKey} 加载失败: ${why}`);
  }

  const srcToEn = src === PIVOT_LANG ? null : await loadDirect(src, PIVOT_LANG);
  const enToTgt = tgt === PIVOT_LANG ? null : await loadDirect(PIVOT_LANG, tgt);

  if (srcToEn && enToTgt) {
    const mid = await withLock(`${src}->${PIVOT_LANG}`, () => runPipe(srcToEn, text));
    const result = await withLock(`${PIVOT_LANG}->${tgt}`, () => runPipe(enToTgt, mid));
    log('translated (pivot) in', Date.now() - t0, 'ms →', result);
    return result;
  }
  if (srcToEn) {
    const result = await withLock(`${src}->${PIVOT_LANG}`, () => runPipe(srcToEn, text));
    log('translated (src→en only) in', Date.now() - t0, 'ms →', result);
    return result;
  }
  if (enToTgt) {
    const result = await withLock(`${PIVOT_LANG}->${tgt}`, () => runPipe(enToTgt, text));
    log('translated (en→tgt only) in', Date.now() - t0, 'ms →', result);
    return result;
  }

  // Truly no path — pivot components also unavailable.
  const legFail = [
    src !== PIVOT_LANG ? failedPairs[`${src}->${PIVOT_LANG}`] : null,
    tgt !== PIVOT_LANG ? failedPairs[`${PIVOT_LANG}->${tgt}`] : null,
  ].filter(Boolean).join('; ');
  throw new Error(legFail ? `Pivot 加载失败: ${legFail}` : `不支持 ${src}->${tgt}`);
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg?.type === 'init') {
    const base = msg.basePath || '';
    log('init basePath=', base);
    env.localModelPath = `${base}/models/onnx/`;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    try {
      const anyEnv: any = env as any;
      anyEnv.backends = anyEnv.backends || {};
      anyEnv.backends.onnx = anyEnv.backends.onnx || {};
      anyEnv.backends.onnx.wasm = anyEnv.backends.onnx.wasm || {};

      const ua = ((self as any).navigator?.userAgent || '').toLowerCase();
      const isSafari =
        ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');

      const prefix = `${base}/onnx-wasm/`;
      anyEnv.backends.onnx.wasm.wasmPaths = isSafari
        ? {
            mjs: `${prefix}ort-wasm-simd-threaded.mjs`,
            wasm: `${prefix}ort-wasm-simd-threaded.wasm`,
          }
        : {
            mjs: `${prefix}ort-wasm-simd-threaded.asyncify.mjs`,
            wasm: `${prefix}ort-wasm-simd-threaded.asyncify.wasm`,
          };
      anyEnv.backends.onnx.wasm.proxy = false;
      anyEnv.backends.onnx.wasm.numThreads = 1;

      // KEY FIX: turn off ORT's extended graph optimizations. The default
      // "all" level runs a QDQ→MatMulNBits pass that requires a scale tensor
      // (weight_merged_0_scale) for shared encoder-decoder embeddings.
      // Xenova's quantized opus-mt models don't ship that tensor and ORT
      // crashes with "Can't create a session ... Missing required scale".
      // Dropping to "basic" skips the offending optimizer pass while
      // keeping quantized inference speed roughly the same.
      anyEnv.backends.onnx.wasm.session_options =
        anyEnv.backends.onnx.wasm.session_options || {};
      anyEnv.backends.onnx.wasm.session_options.graphOptimizationLevel = 'basic';
      anyEnv.backends.onnx.session_options =
        anyEnv.backends.onnx.session_options || {};
      anyEnv.backends.onnx.session_options.graphOptimizationLevel = 'basic';

      log('wasmPaths configured (isSafari=', isSafari, ')', anyEnv.backends.onnx.wasm.wasmPaths);
      log('graphOptimizationLevel forced to basic (avoid MatMulNBits QDQ bug)');
    } catch (err) {
      log('env config error (best effort):', err);
    }
    post({ type: 'ready' });
    return;
  }

  if (msg?.type === 'preload') {
    log('preload request', msg.src, '→', msg.tgt);
    try {
      const ok = await preloadPair(msg.src, msg.tgt);
      log('preload result', msg.src, '→', msg.tgt, 'ok=', ok);
      post({ type: 'preloaded', id: msg.id, ok });
    } catch (err: any) {
      log('preload error:', err?.message || err);
      post({ type: 'preloaded', id: msg.id, ok: false, error: err?.message || String(err) });
    }
    return;
  }

  if (msg?.type === 'translate') {
    try {
      const text = await translate(msg.text, msg.src, msg.tgt);
      post({ type: 'result', id: msg.id, text });
    } catch (err: any) {
      log('translate error:', err?.message || err);
      post({ type: 'error', id: msg.id, error: err?.message || String(err) });
    }
    return;
  }

  if (msg?.type === 'asr-preload') {
    try {
      const p = await loadASR();
      post({ type: 'preloaded', id: msg.id, ok: !!p });
    } catch (err: any) {
      post({ type: 'preloaded', id: msg.id, ok: false, error: err?.message || String(err) });
    }
    return;
  }

  if (msg?.type === 'asr') {
    try {
      const text = await transcribe(msg.audio, msg.lang);
      post({ type: 'asr-result', id: msg.id, text });
    } catch (err: any) {
      log('asr error:', err?.message || err);
      post({ type: 'error', id: msg.id, error: err?.message || String(err) });
    }
    return;
  }
};

// Surface uncaught errors so they show up in the main-thread console too.
ctx.addEventListener('error', (e: any) => {
  console.error('[worker] uncaught error:', e?.message || e);
});
ctx.addEventListener('unhandledrejection', (e: any) => {
  console.error('[worker] unhandledrejection:', e?.reason?.message || e?.reason || e);
});

// Export nothing — this file is only referenced via `new Worker(new URL(...))`.
export {};
