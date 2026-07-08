/**
 * AI module — client-side inference via transformers.js (ONNX Runtime).
 * Manages ASR and translation pipelines. Translation uses small (~78MB)
 * OPUS-MT models per language pair instead of one giant model.
 */

import { pipeline, env } from '@huggingface/transformers';

type AIPipeline = any;

// ----- Language pair → model mapping -----
// OPUS-MT models are small (~78MB each), bilingual, and fast.

const TRANSLATE_MODELS: Record<string, string> = {
  'zh->en': 'Xenova/opus-mt-zh-en',
  'en->zh': 'Xenova/opus-mt-en-zh',
  'ja->en': 'Xenova/opus-mt-ja-en',
  'en->ja': 'Xenova/opus-mt-en-jap',
  'ko->en': 'Xenova/opus-mt-ko-en',
};

// Use English as pivot for language pairs without a direct model.
// zh->ko = zh->en + en->ko = zh->en + en->XX → fall back to en output
const PIVOT_LANG = 'en';

// ----- model paths -----

const MODELS_BASE = '/models/onnx';
env.localModelPath = MODELS_BASE;

// ----- pipeline cache -----

const pipelines: Record<string, AIPipeline> = {};

// ----- ASR -----

export async function initASR(): Promise<AIPipeline> {
  const key = 'asr';
  if (pipelines[key]) return pipelines[key];
  console.log('[AI] loading ASR pipeline (whisper-tiny ~39MB)...');
  pipelines[key] = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { device: 'wasm' });
  console.log('[AI] ASR ready');
  return pipelines[key];
}

// ----- Translation -----

export async function initTranslateForPair(
  sourceLang: string,
  targetLang: string,
): Promise<AIPipeline | null> {
  // Normalize language codes
  const src = (sourceLang || '').split('-')[0];
  const tgt = (targetLang || '').split('-')[0];
  const pairKey = `${src}->${tgt}`;
  const modelId = TRANSLATE_MODELS[pairKey];

  if (modelId) {
    // Direct model exists
    const key = `tr-${pairKey}`;
    if (pipelines[key]) return pipelines[key];
    console.log(`[AI] loading translation ${pairKey} (${modelId})...`);
    try {
      pipelines[key] = await pipeline('translation', modelId, { device: 'wasm' });
      console.log(`[AI] ${pairKey} ready`);
      return pipelines[key];
    } catch (e) {
      console.warn(`[AI] failed to load ${modelId}:`, e);
      return null;
    }
  }

  // No direct model — try pivot via English
  if (src !== PIVOT_LANG && tgt !== PIVOT_LANG) {
    console.log(`[AI] no direct model for ${pairKey}, using ${PIVOT_LANG} pivot`);
    const srcToPivot = await initTranslateForPair(src, PIVOT_LANG);
    if (srcToPivot) return null; // caller will chain two translations
  }

  // Try to at least translate to/from English as fallback
  if (src !== PIVOT_LANG) return initTranslateForPair(src, PIVOT_LANG);
  if (tgt !== PIVOT_LANG) return initTranslateForPair(PIVOT_LANG, tgt);

  return null;
}

export async function runTranslation(
  pipeline: AIPipeline,
  text: string,
): Promise<string> {
  const output = await (pipeline as any)(text);
  return (output as any)?.[0]?.translation_text || '';
}

export function getPipelineKey(sourceLang: string, targetLang: string): string {
  const src = (sourceLang || '').split('-')[0];
  const tgt = (targetLang || '').split('-')[0];
  return `tr-${src}->${tgt}`;
}

export function getModelSize(key: string): string {
  const sizes: Record<string, string> = {
    'zh->en': '~78MB',
    'en->zh': '~78MB',
    'zh->ja': '~78MB',
    'ja->zh': '~78MB',
    'en->ja': '~78MB',
    'ja->en': '~78MB',
  };
  return sizes[key] || 'unknown';
}

export function disposeModels(): void {
  for (const key of Object.keys(pipelines)) {
    delete pipelines[key];
  }
}
