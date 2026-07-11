#!/bin/bash
# Download translation models for offline bundling (Capacitor app).
# Run this before npx cap sync to bundle models into the app.
#
# Models:
#   opus-mt-{zh,en,ja,ko}-en / en-{zh,ja} (~78MB each) — pairwise translation
#
# ASR is NOT downloaded here — it uses the sherpa-onnx WASM bundle
# (client/public/sherpa-asr/), fetched by scripts/download-sherpa.sh.
#
# Note: transformers.js auto-downloads models from Hugging Face CDN
#       at runtime. This script pre-downloads them for offline use.

set -e

MODELS_DIR="public/models/onnx"
mkdir -p "$MODELS_DIR"

download_model() {
  local model_id="$1"
  local dest="$MODELS_DIR/$model_id"

  if [ -d "$dest" ]; then
    echo "[skip] $model_id already exists"
    return
  fi

  echo "[download] $model_id ..."
  git clone --depth 1 --filter=blob:none \
    "https://huggingface.co/$model_id" \
    "$dest"

  echo "[done] $model_id"
}

# Core models — uncomment to download
# download_model "Xenova/opus-mt-zh-en"
# download_model "Xenova/opus-mt-en-zh"
# download_model "Xenova/opus-mt-ja-en"
# download_model "Xenova/opus-mt-en-jap"
# download_model "Xenova/opus-mt-ko-en"

echo ""
echo "Models directory: $MODELS_DIR"
echo ""
echo "Available translation models to download (~78MB each):"
echo "  Xenova/opus-mt-zh-en"
echo "  Xenova/opus-mt-en-zh"
echo "  Xenova/opus-mt-ja-en"
echo "  Xenova/opus-mt-en-jap"
echo "  Xenova/opus-mt-ko-en"
echo ""
echo "To download, uncomment the download_model lines in this script."
echo "For ASR, run scripts/download-sherpa.sh instead (~209MB WASM bundle)."
