/**
 * tencent-engine — realtime ASR via Tencent Cloud, tunnelled through our own
 * server WebSocket at /qsignal/asr. The server signs the request with its
 * SecretKey (which never leaves the box) and streams audio bidirectionally.
 *
 * Public API mirrors createWhisperEngine so RoomClient can swap between the
 * two implementations (or fall back on transport failure).
 *
 * Audio format: 16kHz mono 16-bit PCM, ~40ms frames.
 * Tencent response format: JSON messages with `result.slice_type` where
 *   0 or 1 = interim, 2 = final segment.
 */

import type { ASRResult } from "./asr";

type ASRCallback = (result: ASRResult) => void;

export interface TencentEngine {
  start: () => Promise<void>;
  stop: () => void;
}

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 640; // 40ms at 16kHz — Tencent's recommended cadence

function buildAsrUrl(lang: string): string {
  const basePath =
    (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "") || "";
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  // basePath is empty in dev, /q-dev in dev-remote, /qvideochat in prod.
  // nginx routes /qsignal/ to the socket.io server on port 3002 — the ASR
  // WebSocket lives at /asr on that same server, so client URL is /qsignal/asr.
  const _ = basePath; // basePath doesn't apply to the WS path (nginx-level)
  return `${proto}//${host}/qsignal/asr?lang=${encodeURIComponent(lang)}`;
}

function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate <= 16000) return input;
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

export function createTencentEngine(
  stream: MediaStream,
  lang: string,
  onResult: ASRCallback,
  onError?: (err: string) => void,
  onStatus?: (status: string) => void,
): TencentEngine {
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let ws: WebSocket | null = null;
  let running = false;
  let actualRate = SAMPLE_RATE;
  let sendBuffer = new Float32Array(0);
  // Track whether we've seen ANY interim/final so we can flip status.
  let sawTranscript = false;

  const bufferedAppend = (chunk: Float32Array) => {
    const merged = new Float32Array(sendBuffer.length + chunk.length);
    merged.set(sendBuffer);
    merged.set(chunk, sendBuffer.length);
    sendBuffer = merged;
  };

  const flushFrames = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (sendBuffer.length >= FRAME_SAMPLES) {
      const frame = sendBuffer.subarray(0, FRAME_SAMPLES);
      const pcm = float32ToInt16(frame);
      try {
        ws.send(pcm.buffer);
      } catch (e) {
        console.warn("[tencent] send failed:", e);
        return;
      }
      sendBuffer = sendBuffer.subarray(FRAME_SAMPLES);
    }
  };

  const handleAudio = (input: Float32Array) => {
    const resampled = actualRate === SAMPLE_RATE
      ? input
      : downsampleTo16k(input, actualRate);
    bufferedAppend(resampled);
    flushFrames();
  };

  const handleMessage = (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }
    // Tencent error / not-success codes.
    if (data.code !== 0 && data.code !== undefined) {
      const msg = data.message || `tencent error ${data.code}`;
      console.warn("[tencent] code", data.code, msg);
      onError?.(msg);
      return;
    }
    const result = data.result;
    if (!result) return;
    const rawText: string = result.voice_text_str || "";
    const text = rawText.trim();
    if (!text) return;
    // slice_type: 0 = start of a segment (interim), 1 = interim, 2 = final segment.
    const isFinal = result.slice_type === 2;
    if (!sawTranscript) {
      sawTranscript = true;
      onStatus?.(isFinal ? "listening" : "speaking");
    }
    onResult({ text, lang, engine: "tencent" as any, isFinal });
    if (isFinal) {
      // After a final, reset to listening so the "开始说话..." placeholder
      // returns until the next utterance.
      sawTranscript = false;
      onStatus?.("listening");
    }
  };

  return {
    start: async () => {
      if (running) return;
      running = true;
      onStatus?.("starting");
      try {
        ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        actualRate = ctx.sampleRate;
        console.log(
          "[tencent] AudioContext sampleRate requested=16000 actual=",
          actualRate,
        );

        const url = buildAsrUrl(lang);
        console.log("[tencent] connecting", url);
        ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          console.log("[tencent] ws open");
          onStatus?.("listening");
        };
        ws.onmessage = handleMessage;
        ws.onerror = (e) => {
          console.warn("[tencent] ws error", e);
          onError?.("识别通道错误");
        };
        ws.onclose = (e) => {
          console.log("[tencent] ws closed", e.code, e.reason);
          if (running && e.code !== 1000) {
            onError?.(`识别通道断开 (${e.code})`);
            onStatus?.("no-response");
          }
        };

        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (!running) return;
          const input = e.inputBuffer.getChannelData(0);
          try { handleAudio(input); } catch (err) {
            console.error("[tencent] process error:", err);
          }
        };
        source.connect(processor);
        processor.connect(ctx.destination);
      } catch (e: any) {
        running = false;
        onStatus?.("error");
        onError?.(e?.message || String(e));
      }
    },
    stop: () => {
      running = false;
      onStatus?.("idle");
      try { processor?.disconnect(); } catch { /* ignore */ }
      try { source?.disconnect(); } catch { /* ignore */ }
      try { ctx?.close(); } catch { /* ignore */ }
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          // Politely tell the server to end the Tencent session so it flushes
          // any final segment.
          ws.send(JSON.stringify({ type: "end" }));
          ws.close(1000, "client stop");
        }
      } catch { /* ignore */ }
      processor = null;
      source = null;
      ctx = null;
      ws = null;
      sendBuffer = new Float32Array(0);
      sawTranscript = false;
    },
  };
}
