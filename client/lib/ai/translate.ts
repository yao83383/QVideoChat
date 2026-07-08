/**
 * Translation — NLLB-200 via transformers.js.
 * Supports 200 languages including zh ↔ en.
 *
 * NLLB language codes:
 *   Chinese (Simplified):  zho_Hans
 *   English:               eng_Latn
 *   Japanese:              jpn_Jpan
 *   Korean:                kor_Hang
 */

import { initTranslate } from './index';

const LANG_TO_NLLB: Record<string, string> = {
  zh: 'zho_Hans',
  'zh-CN': 'zho_Hans',
  en: 'eng_Latn',
  'en-US': 'eng_Latn',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
};

function toNllbCode(lang: string): string {
  return LANG_TO_NLLB[lang] || LANG_TO_NLLB[lang.split('-')[0]] || 'eng_Latn';
}

export interface TranslateResult {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}

let translateQueue: Array<{
  text: string;
  sourceLang: string;
  targetLang: string;
  resolve: (r: TranslateResult) => void;
  reject: (e: Error) => void;
}> = [];
let isProcessing = false;

async function flushQueue() {
  if (isProcessing || translateQueue.length === 0) return;
  isProcessing = true;

  while (translateQueue.length > 0) {
    const batch = translateQueue.splice(0, translateQueue.length);
    for (const item of batch) {
      try {
        const translator = await initTranslate();
        const srcCode = toNllbCode(item.sourceLang);
        const tgtCode = toNllbCode(item.targetLang);

        // NLLB translation pipeline: pass src_lang and tgt_lang as generation kwargs
        const output = await (translator as any)(item.text, {
          src_lang: srcCode,
          tgt_lang: tgtCode,
        });

        item.resolve({
          sourceText: item.text,
          translatedText: (output as any)?.[0]?.translation_text || '',
          sourceLang: item.sourceLang,
          targetLang: item.targetLang,
        });
      } catch (e) {
        item.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  isProcessing = false;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<TranslateResult> {
  return new Promise((resolve, reject) => {
    translateQueue.push({ text, sourceLang, targetLang, resolve, reject });
    flushQueue();
  });
}

// NLLB-200 requires the source language to be specified in the prompt.
// The format is: the text prefixed with the source language tag.
// Example: "zho_Hans 你好" → "eng_Latn Hello"
// This is handled automatically by the pipeline.
