/**
 * ASR (Automatic Speech Recognition) — dual-engine:
 *   1. Web Speech API (primary) — zero download, real-time, works in Chrome/Edge/Safari
 *   2. whisper-tiny (fallback) — transformers.js, ~39MB model, works everywhere
 */

import { initASR } from './index';

export type ASRResult = {
  text: string;
  lang: string;
  engine: 'web-speech' | 'whisper';
  isFinal: boolean;
};

type ASRCallback = (result: ASRResult) => void;

// Normalize short codes → BCP-47 for the Web Speech API. Passing bare "zh" or
// "en" causes some browsers to fall back to the OS default language, which is
// the single biggest cause of "recognition is slow / wrong / silent".
const BCP47_MAP: Record<string, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
};

const NORMALIZE_MAP: Record<string, string> = {
  'cmn-Hans-CN': 'zh',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
  zh: 'zh',
  'en-US': 'en',
  'en-GB': 'en',
  en: 'en',
  'ja-JP': 'ja',
  ja: 'ja',
  'ko-KR': 'ko',
  ko: 'ko',
};

function toBcp47(lang: string): string {
  if (!lang) return 'en-US';
  if (lang.includes('-')) return lang;
  return BCP47_MAP[lang] || lang;
}

function normalizeLang(bcp: string): string {
  return NORMALIZE_MAP[bcp] || bcp.split('-')[0] || 'en';
}

// ----- Web Speech API engine -----

export interface WebSpeechEngine {
  start: () => void;
  stop: () => void;
}

export function createWebSpeechASR(
  lang: string,
  onResult: ASRCallback,
  onError?: (err: string) => void,
  onStatus?: (status: string) => void,
): WebSpeechEngine | null {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.('该浏览器不支持语音识别');
    onStatus?.('unavailable');
    return null;
  }

  const bcp = toBcp47(lang);
  const normLang = normalizeLang(bcp);
  let recognition: any = null;
  let running = false;
  let stopping = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFinal = '';
  let lastFinalAt = 0;
  let restartCount = 0;

  const log = (...args: any[]) => console.log('[asr]', ...args);

  const buildRecognition = () => {
    const r = new SpeechRecognition();
    r.lang = bcp;
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;

    r.onstart = () => { log('start lang=', bcp, 'restarts=', restartCount); onStatus?.('starting'); };
    r.onaudiostart = () => { log('audio start'); onStatus?.('listening'); };
    r.onspeechstart = () => log('speech start');
    r.onspeechend = () => log('speech end');
    r.onaudioend = () => log('audio end');
    r.onnomatch = () => log('nomatch');

    r.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      const interim = interimText.trim();
      if (interim) {
        log('interim:', interim);
        onResult({ text: interim, lang: normLang, engine: 'web-speech', isFinal: false });
      }

      const final = finalText.trim();
      if (!final) return;

      const now = Date.now();
      if (final === lastFinal && now - lastFinalAt < 2000) {
        log('final DEDUP:', final);
        return;
      }
      lastFinal = final;
      lastFinalAt = now;
      log('FINAL:', final);
      onResult({ text: final, lang: normLang, engine: 'web-speech', isFinal: true });
    };

    r.onerror = (event: any) => {
      const err = event?.error || 'unknown';
      log('error:', err);
      if (err === 'no-speech' || err === 'aborted' || err === 'audio-capture') return;
      onError?.(`语音识别错误: ${err}`);
    };

    r.onend = () => {
      log('end (running=', running, 'stopping=', stopping, ')');
      // Chrome silently ends recognition every ~60s or after any error.
      // We MUST build a fresh instance — reusing the same one after end has
      // been observed to fire onstart but never actually listen.
      if (!running || stopping) return;
      restartCount++;
      restartTimer = setTimeout(() => {
        if (!running || stopping) return;
        recognition = buildRecognition();
        try {
          recognition.start();
        } catch (e) {
          log('restart start failed:', e);
        }
      }, 50); // faster than before — 200ms was long enough for users to lose a word
    };

    return r;
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      stopping = false;
      restartCount = 0;
      recognition = buildRecognition();
      try {
        recognition.start();
        log('started');
      } catch (e) {
        log('start failed:', e);
      }
    },
    stop: () => {
      log('stop() called');
      running = false;
      stopping = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      try {
        recognition?.stop();
      } catch { /* ignore */ }
      recognition = null;
    },
  };
}

// ----- whisper-tiny engine (transformers.js) -----

export async function transcribeWithWhisper(
  audioData: Float32Array,
): Promise<ASRResult | null> {
  try {
    const asr = await initASR();
    const result = await asr({ raw: audioData, sampling_rate: 16000 });
    return {
      text: (result as any).text || '',
      lang: (result as any).language || 'en',
      engine: 'whisper',
      isFinal: true,
    };
  } catch (e) {
    console.warn('[ASR] whisper transcription failed:', e);
    return null;
  }
}
