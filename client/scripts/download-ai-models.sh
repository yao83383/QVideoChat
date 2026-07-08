#!/bin/bash
# Download AI models for offline bundling (Capacitor app).
# Run this before npx cap sync to bundle models into the app.
#
# Models:
#   whisper-tiny (~150MB) — ASR fallback
#   nllb-200-distilled-600M (~2.5GB) — translation
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
# download_model "Xenova/whisper-tiny"
# download_model "Xenova/nllb-200-distilled-600M"

echo ""
echo "Models directory: $MODELS_DIR"
echo ""
echo "Available models to download:"
echo "  Xenova/whisper-tiny              (~150MB, ASR)"
echo "  Xenova/nllb-200-distilled-600M   (~2.5GB, translation)"
echo ""
echo "To download, uncomment the download_model lines in this script"
echo "or run manually:"
echo "  git clone --depth 1 https://huggingface.co/Xenova/whisper-tiny $MODELS_DIR/Xenova/whisper-tiny"
