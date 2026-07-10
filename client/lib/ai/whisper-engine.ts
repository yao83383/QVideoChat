/**
 * whisper-engine — replacement for Web Speech API on networks that can't
 * reach Google's cloud (i.e. all of mainland China). Captures mic audio
 * at 16kHz, runs simple RMS-based voice-activity detection to slice out
 * utterances, and hands each slice to whisper-tiny inside the AI worker.
 *
 * Public API mirrors createWebSpeechASR so RoomClient can swap them freely.
 */

import { preloadASR, transcribeInWorker } from './index';
import type { ASRResult } from './asr';

type ASRCallback = (result: ASRResult) => void;

export interface WhisperEngine {
  start: () => Promise<void>;
  stop: () => void;
}

// Track ASR model warmup so the first utterance doesn't sit silent for the
// 10-20s it takes to spin up the whisper wasm session.
let asrWarm = false;
let asrWarming: Promise<void> | null = null;
function ensureWarm(): Promise<void> {
  if (asrWarm) return Promise.resolve();
  if (asrWarming) return asrWarming;
  asrWarming = preloadASR().then(() => { asrWarm = true; }).catch((e) => {
    console.warn('[whisper] preload failed:', e);
  });
  return asrWarming;
}

const SAMPLE_RATE = 16000;
// Voice activity thresholds — tuned for typical laptop/phone mics.
const RMS_SILENCE = 0.008;        // below this → treated as silence
const RMS_SPEECH = 0.012;         // above this → voice
const MIN_SPEECH_MS = 250;        // ignore blips shorter than this
const MAX_UTTERANCE_MS = 5000;    // hard flush every 5s of continuous speech
const TRAILING_SILENCE_MS = 400;  // silence gap that ends an utterance
const PREROLL_MS = 250;           // include audio right before speech onset

function rms(buf: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * @param stream           MediaStream — usually mic from getUserMedia; a
 *                         separate one from WebRTC's send track is fine.
 * @param lang             short lang code ("zh" / "en" / "ja" / "ko")
 * @param onResult         called per finalized utterance (final only, no interim)
 * @param onError          transient / fatal errors
 * @param onStatus         "starting" | "listening" | "transcribing" | "idle"
 */
export function createWhisperEngine(
  stream: MediaStream,
  lang: string,
  onResult: ASRCallback,
  onError?: (err: string) => void,
  onStatus?: (status: string) => void,
): WhisperEngine {
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let running = false;
  // Actual sample rate from AudioContext — mobile Safari and some Android
  // browsers silently ignore the requested 16kHz and hand us 44.1/48kHz.
  // We must downsample before whisper (which is trained on 16kHz).
  let actualRate = SAMPLE_RATE;

  // Rolling buffer of samples plus a preroll ring so we don't cut off the
  // first ~250ms of an utterance.
  const preroll = new Float32Array(Math.floor(SAMPLE_RATE * PREROLL_MS / 1000));
  let prerollWrite = 0;
  let prerollFilled = 0;

  let utterance: Float32Array = new Float32Array(SAMPLE_RATE * 2);
  let utteranceLen = 0;
  let speechStartMs = 0;
  let lastVoiceMs = 0;
  let inSpeech = false;
  const t0 = () => performance.now();

  const appendUtterance = (samples: Float32Array) => {
    if (utteranceLen + samples.length > utterance.length) {
      const grow = new Float32Array(Math.max(utterance.length * 2, utteranceLen + samples.length));
      grow.set(utterance.subarray(0, utteranceLen));
      utterance = grow;
    }
    utterance.set(samples, utteranceLen);
    utteranceLen += samples.length;
  };

  const flushUtterance = async () => {
    if (utteranceLen < actualRate * 0.4) {
      utteranceLen = 0;
      inSpeech = false;
      return;
    }
    const raw = utterance.subarray(0, utteranceLen);
    const audio16k = actualRate === SAMPLE_RATE
      ? new Float32Array(raw)
      : downsampleTo16k(raw, actualRate);
    utteranceLen = 0;
    inSpeech = false;
    // If the ASR model isn't loaded yet, tell the UI "loading" instead of
    // just "transcribing" — a whisper-base cold start on wasm can take
    // 10-20s, which otherwise looks like the app is frozen.
    if (!asrWarm) {
      onStatus?.('loading');
      try { await ensureWarm(); } catch { /* surfaced below */ }
    }
    onStatus?.('transcribing');
    try {
      const text = await transcribeInWorker(audio16k, lang);
      if (!running) return;
      const cleaned = cleanWhisperText(text);
      if (cleaned) {
        onResult({ text: cleaned, lang, engine: 'whisper', isFinal: true });
      }
    } catch (e: any) {
      console.warn('[whisper] transcribe failed:', e);
      onError?.(e?.message || String(e));
    } finally {
      if (running) onStatus?.('listening');
    }
  };

  const processFrame = (input: Float32Array) => {
    // Copy into preroll ring buffer.
    for (let i = 0; i < input.length; i++) {
      preroll[prerollWrite] = input[i];
      prerollWrite = (prerollWrite + 1) % preroll.length;
    }
    prerollFilled = Math.min(preroll.length, prerollFilled + input.length);

    const now = t0();
    const level = rms(input, 0, input.length);

    if (!inSpeech && level > RMS_SPEECH) {
      inSpeech = true;
      speechStartMs = now;
      lastVoiceMs = now;
      utteranceLen = 0;
      onStatus?.('speaking');
      // Emit preroll first so first phoneme isn't clipped.
      const prerollOrdered = new Float32Array(prerollFilled);
      // The ring buffer's oldest sample sits at (prerollWrite) if fully filled,
      // otherwise at 0. Reconstruct chronological order.
      if (prerollFilled === preroll.length) {
        prerollOrdered.set(preroll.subarray(prerollWrite));
        prerollOrdered.set(preroll.subarray(0, prerollWrite), preroll.length - prerollWrite);
      } else {
        prerollOrdered.set(preroll.subarray(0, prerollFilled));
      }
      appendUtterance(prerollOrdered);
      appendUtterance(input);
      return;
    }

    if (inSpeech) {
      appendUtterance(input);
      if (level > RMS_SILENCE) {
        lastVoiceMs = now;
      }
      // End of utterance: trailing silence long enough, OR max length reached.
      const trailing = now - lastVoiceMs;
      const total = now - speechStartMs;
      if (trailing > TRAILING_SILENCE_MS || total > MAX_UTTERANCE_MS) {
        // Ignore very short blips (throat clears, taps).
        if (total < MIN_SPEECH_MS) {
          utteranceLen = 0;
          inSpeech = false;
          return;
        }
        // Kick transcription — do NOT await inside the audio callback.
        void flushUtterance();
      }
    }
  };

  return {
    start: async () => {
      if (running) return;
      running = true;
      onStatus?.('starting');
      try {
        // Warm the whisper model up-front so the first utterance isn't stalled
        // by the ~10-20s wasm session init on top of a 125MB download.
        void ensureWarm();

        ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        actualRate = ctx.sampleRate;
        console.log('[whisper] AudioContext sampleRate requested=16000 actual=', actualRate);
        // Some browsers ignore the requested sample rate; that's OK — the
        // input we get will still be whatever AudioContext produces, and
        // we downsample to 16kHz in flushUtterance before handing to whisper.
        source = ctx.createMediaStreamSource(stream);
        // ScriptProcessor is deprecated but universally supported; 4096-sample
        // buffer at 16kHz ≈ 256ms per callback — plenty fast for VAD.
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (!running) return;
          const input = e.inputBuffer.getChannelData(0);
          try { processFrame(input); } catch (err) {
            console.error('[whisper] process error:', err);
          }
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        onStatus?.('listening');
      } catch (e: any) {
        running = false;
        onStatus?.('error');
        onError?.(e?.message || String(e));
      }
    },
    stop: () => {
      running = false;
      onStatus?.('idle');
      try { processor?.disconnect(); } catch { /* ignore */ }
      try { source?.disconnect(); } catch { /* ignore */ }
      try { ctx?.close(); } catch { /* ignore */ }
      processor = null;
      source = null;
      ctx = null;
      utteranceLen = 0;
      inSpeech = false;
      prerollWrite = 0;
      prerollFilled = 0;
    },
  };
}

/** Remove whisper's typical hallucinations on silence / short input. */
function cleanWhisperText(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  // whisper on empty or noise input often outputs its own boilerplate.
  const HALLUCINATIONS = [
    /^\s*(thanks?|thank you)\s+for watching\.?\s*$/i,
    /^\s*(please\s+)?subscribe.*$/i,
    /^\s*字幕由.*$/,
    /^\s*\(.*\)\s*$/,          // bare parenthetical (music), (applause)
    /^\s*\[.*\]\s*$/,          // bare bracketed [Music], [Applause]
    /^\s*(嗯+|啊+|呃+|哦+)\s*$/,  // pure filler in Chinese
    /^\s*(um+|uh+|hm+|ah+)\s*$/i,
    /^\s*(you|the|a|to)\.?\s*$/i, // trivial single tokens
  ];
  for (const re of HALLUCINATIONS) if (re.test(t)) return '';
  return t;
}

/**
 * Downsample to exactly 16kHz using a cheap box filter (moving-average
 * decimation). Whisper is trained on 16kHz mono and internally does no
 * resampling — feeding it 44.1/48kHz makes it either misdetect timing or,
 * in some versions, throw "e.subarray is not a function" when the tensor
 * shape doesn't match its expected mel-spectrogram bins.
 *
 * We avoid a proper polyphase FIR (~10x slower) because speech energy sits
 * well below the 8kHz Nyquist and box-filter aliasing is inaudible here.
 */
function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate <= 16000) return new Float32Array(input);
  const ratio = inRate / 16000;
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
