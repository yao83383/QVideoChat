/**
 * ASR result shape shared across recognizer implementations. Currently only
 * sherpa-onnx (browser-local WASM) emits these — the Web Speech / whisper /
 * Tencent engines were removed when sherpa took over the pipeline.
 */

export type ASRResult = {
  text: string;
  lang: string;
  engine: 'sherpa';
  isFinal: boolean;
};
