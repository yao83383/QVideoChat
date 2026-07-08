/**
 * Translation — small OPUS-MT models (~78MB per language pair).
 * Uses pivot translation via English for pairs without a direct model.
 */

import { initTranslateForPair, runTranslation } from './index';

export interface TranslateResult {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}

// ----- Queue for translation requests -----

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
        const src = (item.sourceLang || '').split('-')[0];
        const tgt = (item.targetLang || '').split('-')[0];

        // Try direct model first
        const direct = await initTranslateForPair(src, tgt);

        let result: string;

        if (direct) {
          // Direct translation
          result = await runTranslation(direct, item.text);
        } else if (src !== 'en' && tgt !== 'en') {
          // Pivot translation: src → en → tgt
          const srcToEn = await initTranslateForPair(src, 'en');
          const enToTgt = await initTranslateForPair('en', tgt);

          if (srcToEn && enToTgt) {
            const pivotText = await runTranslation(srcToEn, item.text);
            result = await runTranslation(enToTgt, pivotText);
          } else {
            // Partial pivot: just translate one direction
            if (srcToEn) {
              result = await runTranslation(srcToEn, item.text);
            } else if (enToTgt) {
              result = await runTranslation(enToTgt, item.text);
            } else {
              throw new Error(`No translation model for ${src}→${tgt}`);
            }
          }
        } else {
          throw new Error(`No translation model for ${src}→${tgt}`);
        }

        item.resolve({
          sourceText: item.text,
          translatedText: result,
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
