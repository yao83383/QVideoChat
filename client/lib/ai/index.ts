/**
 * AI module — client-side inference via transformers.js (ONNX Runtime).
 * Coordinates model loading, caching, and pipeline lifecycle.
 */

import { pipeline, env } from '@huggingface/transformers';

// Pipeline type — transformers.js returns a union type that's too wide for TS narrowing.
// We use 'any' for the actual invocation; the module is a thin wrapper.
type AIPipeline = any;

const MODEL_CACHE_NAME = 'qvideochat-ai-models';
const MODEL_CACHE_STORE = 'models';

interface ModelCacheEntry {
  key: string;
  data: ArrayBuffer;
}

// ----- cache helpers -----

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MODEL_CACHE_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(MODEL_CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedModel(key: string): Promise<ArrayBuffer | null> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_CACHE_STORE, 'readonly');
    const req = tx.objectStore(MODEL_CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function setCachedModel(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
    tx.objectStore(MODEL_CACHE_STORE).put({ key, data });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----- model paths -----

const MODELS_BASE = '/models/onnx';

export interface AIModels {
  asr: AIPipeline | null;
  translate: AIPipeline | null;
}

const state: AIModels = {
  asr: null,
  translate: null,
};

// ----- initialization -----

export async function initASR(): Promise<AIPipeline> {
  if (state.asr) return state.asr;
  console.log('[AI] loading ASR pipeline...');
  state.asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    device: 'wasm',
  });
  console.log('[AI] ASR pipeline ready');
  return state.asr;
}

export async function initTranslate(): Promise<AIPipeline> {
  if (state.translate) return state.translate;
  console.log('[AI] loading translation pipeline...');
  // NLLB-200 distilled 600M — supports 200 languages including zh ↔ en
  state.translate = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
    device: 'wasm',
  });
  console.log('[AI] translation pipeline ready');
  return state.translate;
}

export function getModels(): AIModels {
  return state;
}

export function disposeModels(): void {
  state.asr = null;
  state.translate = null;
}

// Configure local model path for Capacitor bundled models.
// In Capacitor, local assets are served from the root.
env.localModelPath = MODELS_BASE;
