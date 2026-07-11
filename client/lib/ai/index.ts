/**
 * AI module — main-thread facade over the translation Web Worker.
 * Model loading and ONNX inference all happen inside translate.worker.ts
 * so the main thread stays free for React / avatar rendering / WebRTC.
 *
 * ASR lives elsewhere: sherpa-onnx WASM in lib/ai/sherpa-engine.ts. This file
 * is translation-only.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

// ============================================================
// Web Worker RPC — translation
// ============================================================

type PairStatus = {
  loaded: number;      // bytes downloaded across all files of the pair
  total: number;       // total bytes expected (grows as new files start)
  files: Record<string, { loaded: number; total: number; done: boolean }>;
  done: boolean;
};

export type LoadingState = {
  active: Set<string>;
  pairs: Record<string, { loaded: number; total: number; done: boolean; percent: number }>;
  version: number;
};

const listeners = new Set<(s: LoadingState) => void>();
const pairStatus = new Map<string, PairStatus>();
const activePairs = new Set<string>();

const state: LoadingState = { active: activePairs, pairs: {}, version: 0 };

function rebuildState() {
  state.pairs = {};
  for (const [pair, s] of pairStatus.entries()) {
    const percent = s.total > 0 ? Math.min(100, Math.round((s.loaded / s.total) * 100)) : 0;
    state.pairs[pair] = { loaded: s.loaded, total: s.total, done: s.done, percent };
  }
  state.version++;
  for (const l of listeners) l(state);
}

export function onLoadingChange(cb: (s: LoadingState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => { listeners.delete(cb); };
}

export function isLoading(): boolean {
  return activePairs.size > 0;
}

// ----- Worker lifecycle -----

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let msgSeq = 0;
const pending = new Map<number, (payload: any) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  if (typeof window === 'undefined') {
    throw new Error('Translation worker is browser-only');
  }
  console.log('[ai] spawning translation worker');
  worker = new Worker(new URL('./translate.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (e) => {
    console.error('[ai] worker error:', e.message, e);
  });
  worker.addEventListener('messageerror', (e) => {
    console.error('[ai] worker messageerror:', e);
  });

  workerReady = new Promise<void>((resolve) => {
    const onceReady = (e: MessageEvent) => {
      if (e.data?.type === 'ready') {
        worker?.removeEventListener('message', onceReady);
        console.log('[ai] worker ready');
        resolve();
      }
    };
    worker!.addEventListener('message', onceReady);
    worker!.postMessage({ type: 'init', basePath: BASE_PATH });
  });

  return worker;
}

function handleWorkerMessage(e: MessageEvent) {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'progress') {
    handleProgress(msg);
    return;
  }
  if (msg.type === 'result' || msg.type === 'error' || msg.type === 'preloaded') {
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
    return;
  }
}

function handleProgress(msg: any) {
  const pair: string = msg.pair;
  if (!pair) return;

  let s = pairStatus.get(pair);
  if (!s) {
    s = { loaded: 0, total: 0, files: {}, done: false };
    pairStatus.set(pair, s);
  }

  const status: string = msg.status;
  const file: string | undefined = msg.file;

  if (status === 'done' && !file) {
    // Pair-level done
    s.done = true;
    activePairs.delete(pair);
    for (const f of Object.values(s.files)) {
      if (!f.done) { f.done = true; f.loaded = f.total; }
    }
    s.loaded = s.total;
    rebuildState();
    return;
  }

  if (status === 'error') {
    activePairs.delete(pair);
    s.done = true;
    rebuildState();
    return;
  }

  if (!file) return;

  activePairs.add(pair);
  let f = s.files[file];
  if (!f) {
    f = { loaded: 0, total: 0, done: false };
    s.files[file] = f;
  }

  if (typeof msg.total === 'number' && msg.total > f.total) {
    s.total += msg.total - f.total;
    f.total = msg.total;
  }
  if (typeof msg.loaded === 'number') {
    const delta = msg.loaded - f.loaded;
    if (delta > 0) {
      f.loaded = msg.loaded;
      s.loaded += delta;
    }
  }
  if (status === 'done') {
    f.done = true;
    if (f.total > 0 && f.loaded < f.total) {
      s.loaded += f.total - f.loaded;
      f.loaded = f.total;
    }
  }

  rebuildState();
}

function send<T = any>(msg: any, timeoutMs = 60_000): Promise<T> {
  const w = ensureWorker();
  const id = ++msgSeq;
  msg.id = id;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        console.error('[ai] send TIMEOUT', msg.type, id, 'after', timeoutMs, 'ms');
        reject(new Error(`worker ${msg.type} timeout`));
      }
    }, timeoutMs);
    pending.set(id, (payload) => {
      clearTimeout(timer);
      if (payload.type === 'error') reject(new Error(payload.error || 'worker error'));
      else resolve(payload);
    });
    // Wait for worker ready before sending non-init messages.
    workerReady!.then(() => w.postMessage(msg));
  });
}

// ============================================================
// Public API
// ============================================================

export function preloadPair(sourceLang: string, targetLang: string): Promise<void> {
  const src = (sourceLang || '').split('-')[0];
  const tgt = (targetLang || '').split('-')[0];
  if (!src || !tgt || src === tgt) return Promise.resolve();
  // Preload can legitimately take a couple minutes on cold networks — longer timeout.
  return send<{ ok: boolean }>({ type: 'preload', src, tgt }, 180_000).then(() => undefined);
}

export function translateInWorker(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const src = (sourceLang || '').split('-')[0];
  const tgt = (targetLang || '').split('-')[0];
  // Individual translate should be quick (<10s) if the pipeline is warm.
  // Cold path (first sentence) rides on the preload path already.
  return send<{ text: string }>({ type: 'translate', text, src, tgt }, 30_000).then((r) => r.text);
}

export function disposeModels(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    workerReady = null;
    pending.clear();
    pairStatus.clear();
    activePairs.clear();
    rebuildState();
  }
}
