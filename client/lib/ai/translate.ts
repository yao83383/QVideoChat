/**
 * Translation — thin main-thread wrapper around the translation Web Worker.
 * Handles same-language short-circuit and an LRU cache for repeated phrases;
 * everything else (pipeline load, ONNX inference, pivot routing) happens in
 * translate.worker.ts so the main thread stays smooth.
 */

import { preloadPair, translateInWorker } from './index';

export interface TranslateResult {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}

const CACHE_MAX = 128;
const cache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet(key: string, value: string) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<TranslateResult> {
  const src = (sourceLang || '').split('-')[0];
  const tgt = (targetLang || '').split('-')[0];
  const trimmed = text.trim();

  if (!trimmed || src === tgt) {
    return { sourceText: text, translatedText: text, sourceLang, targetLang };
  }

  const cacheKey = `${src}->${tgt}::${trimmed}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return { sourceText: text, translatedText: cached, sourceLang, targetLang };
  }

  const translated = await translateInWorker(trimmed, src, tgt);
  if (translated) cacheSet(cacheKey, translated);

  return {
    sourceText: text,
    translatedText: translated || text,
    sourceLang,
    targetLang,
  };
}

export { preloadPair };
