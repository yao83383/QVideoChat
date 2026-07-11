#!/usr/bin/env bash
# Download the sherpa-onnx WebAssembly ASR bundle (streaming Zipformer, zh+en).
# Files are extracted into client/public/sherpa-asr/ and loaded at runtime by
# lib/ai/sherpa-engine.ts.
#
# Bundle: sherpa-onnx-wasm-simd-v1.13.4-zh-en-asr-zipformer.tar.bz2 (~174 MB)
#   - sherpa-onnx-wasm-main-asr.js       emscripten glue
#   - sherpa-onnx-wasm-main-asr.wasm     WebAssembly binary (onnxruntime + sherpa-onnx)
#   - sherpa-onnx-wasm-main-asr.data     preloaded FS — encoder/decoder/joiner ONNX + tokens.txt
#   - sherpa-onnx-asr.js                 high-level JS wrapper (createOnlineRecognizer)
#
# The .data file bundles the streaming Zipformer bilingual zh-en model
# (sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20) via emscripten
# --preload-file. It is opaque at runtime.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../public/sherpa-asr"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/sherpa-onnx-wasm-simd-v1.13.4-zh-en-asr-zipformer.tar.bz2"
ARCHIVE="$DEST_DIR/sherpa-asr.tar.bz2"

mkdir -p "$DEST_DIR"

if [ -f "$DEST_DIR/sherpa-onnx-wasm-main-asr.wasm" ] && [ -f "$DEST_DIR/sherpa-onnx-wasm-main-asr.data" ]; then
  echo "[skip] sherpa wasm bundle already present at $DEST_DIR"
  exit 0
fi

echo "[download] $URL"
curl -L --fail -o "$ARCHIVE" "$URL"

echo "[extract] $ARCHIVE"
tar -xjf "$ARCHIVE" -C "$DEST_DIR"

# Bundle unpacks into a single top-level directory named after the release —
# flatten it so files sit directly under public/sherpa-asr/.
INNER=$(find "$DEST_DIR" -maxdepth 1 -mindepth 1 -type d -name "sherpa-onnx-wasm-simd-*" | head -n1)
if [ -n "$INNER" ]; then
  mv "$INNER"/* "$DEST_DIR/"
  rmdir "$INNER"
fi

rm -f "$ARCHIVE"

echo "[done] $DEST_DIR contents:"
ls -lh "$DEST_DIR"
