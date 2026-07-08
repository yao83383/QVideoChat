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
};

type ASRCallback = (result: ASRResult) => void;

const LANG_MAP: Record<string, string> = {
  'cmn-Hans-CN': 'zh',
  'zh-CN': 'zh',
  'zh': 'zh',
  'en-US': 'en',
  'en': 'en',
  'ja-JP': 'ja',
  'ja': 'ja',
  'ko-KR': 'ko',
  'ko': 'ko',
};

function normalizeLang(bcp: string): string {
  return LANG_MAP[bcp] || bcp.split('-')[0] || 'en';
}

// ----- Web Speech API engine -----

export function createWebSpeechASR(
  lang: string,
  onResult: ASRCallback,
  onError?: (err: string) => void,
): { start: () => void; stop: () => void } | null {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.('Web Speech API 不可用');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: any) => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      }
    }
    if (finalText.trim()) {
      onResult({ text: finalText.trim(), lang: normalizeLang(lang), engine: 'web-speech' });
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    onError?.(`语音识别错误: ${event.error}`);
  };

  return {
    start: () => {
      try { recognition.start(); } catch { /* already started */ }
    },
    stop: () => recognition.stop(),
  };
}

// ----- whisper-tiny engine (transformers.js) -----

export async function transcribeWithWhisper(
  audioData: Float32Array,
): Promise<ASRResult | null> {
  try {
    const asr = await initASR();
    // Whisper via transformers.js expects { raw: Float32Array, sampling_rate: number }
    const result = await asr({ raw: audioData, sampling_rate: 16000 });
    return {
      text: (result as any).text || '',
      lang: (result as any).language || 'en',
      engine: 'whisper',
    };
  } catch (e) {
    console.warn('[ASR] whisper transcription failed:', e);
    return null;
  }
}
