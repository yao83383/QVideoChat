#!/bin/bash
# Download OPUS-MT translation models into public/models/onnx/Xenova/.
# transformers.js then loads them from our own server (fast + reliable in CN)
# instead of huggingface.co.
#
# Uses hf-mirror.com by default because huggingface.co is unreachable from
# CN networks. Override with HF_HOST=huggingface.co if abroad.
#
# Only the two ONNX weights transformers.js actually loads are pulled:
#   onnx/encoder_model_quantized.onnx        (~50MB)
#   onnx/decoder_model_merged_quantized.onnx (~60MB)
# fp32/fp16/int8 variants are skipped to save ~5x disk.
#
# Idempotent: files already present (non-empty) are skipped.
#
# Usage:
#   bash scripts/download-translate-models.sh
#   bash scripts/download-translate-models.sh Xenova/opus-mt-zh-en
#   HF_HOST=huggingface.co bash scripts/download-translate-models.sh
#
# Requires: curl + python3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_ROOT="$CLIENT_DIR/public/models/onnx"
HF_HOST="${HF_HOST:-hf-mirror.com}"

PY=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1; then
    # Skip Windows AppInstaller stub which returns empty on stdin.
    if echo '[]' | "$cand" -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
      PY="$cand"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "ERROR: a working python (with json) is required" >&2
  exit 1
fi

# Must match TRANSLATE_MODELS in client/lib/ai/index.ts
MODELS_ALL=(
  "Xenova/opus-mt-zh-en"
  "Xenova/opus-mt-en-zh"
  "Xenova/opus-mt-ja-en"
  "Xenova/opus-mt-en-jap"
  "Xenova/opus-mt-ko-en"
)

if [ $# -gt 0 ]; then
  MODELS=("$@")
else
  MODELS=("${MODELS_ALL[@]}")
fi

# Files transformers.js needs at runtime:
#   - all top-level tokenizer/config: *.json, *.txt, *.spm
#   - non-merged decoder + encoder (both quantized). The merged decoder
#     (decoder_model_merged_quantized.onnx) tickles an ONNX Runtime bug
#     "Missing required scale ... MatMulNBits" and refuses to instantiate,
#     so we deliberately skip it and let transformers.js use the split pair.
select_paths() {
  "$PY" -c '
import json, sys
data = json.load(sys.stdin)
keep_onnx = {
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_quantized.onnx",
    "onnx/decoder_with_past_model_quantized.onnx",
}
for f in data:
    if f.get("type") != "file":
        continue
    p = f["path"]
    if "/" not in p and (p.endswith(".json") or p.endswith(".txt") or p.endswith(".spm")):
        print(p)
    elif p in keep_onnx:
        print(p)
'
}

download_model() {
  local model_id="$1"
  local dest="$DEST_ROOT/$model_id"

  echo ""
  echo "======================================"
  echo "[$model_id] listing files from $HF_HOST..."

  local tree
  if ! tree=$(curl -fsSL --max-time 30 --retry 3 --retry-delay 2 \
    "https://$HF_HOST/api/models/$model_id/tree/main?recursive=1"); then
    echo "[error] tree API failed for $model_id — skipping"
    return 1
  fi

  local paths
  paths=$(echo "$tree" | select_paths)

  if [ -z "$paths" ]; then
    echo "[warn] no files matched filter for $model_id"
    echo "$tree" | head -c 500
    echo
    return 1
  fi

  mkdir -p "$dest"
  local total=0 skipped=0 downloaded=0
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    total=$((total + 1))
    local out="$dest/$rel"
    if [ -f "$out" ] && [ -s "$out" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    mkdir -p "$(dirname "$out")"
    local url="https://$HF_HOST/$model_id/resolve/main/$rel"
    printf "  → %-45s " "$rel"
    if curl -fsSL --retry 3 --retry-delay 2 --max-time 300 -o "$out.part" "$url"; then
      mv "$out.part" "$out"
      local sz
      sz=$(du -h "$out" | cut -f1)
      echo "$sz"
      downloaded=$((downloaded + 1))
    else
      rm -f "$out.part"
      echo "FAILED"
    fi
  done <<< "$paths"

  local size
  size=$(du -sh "$dest" 2>/dev/null | cut -f1)
  echo "[$model_id] $downloaded new, $skipped cached, total $size"
}

mkdir -p "$DEST_ROOT"
echo "destination: $DEST_ROOT"
echo "mirror:      $HF_HOST"

fails=0
for m in "${MODELS[@]}"; do
  download_model "$m" || fails=$((fails + 1))
done

echo ""
echo "======================================"
echo "Summary — $((${#MODELS[@]} - fails))/${#MODELS[@]} models OK"
du -sh "$DEST_ROOT"/Xenova/opus-mt-* 2>/dev/null || true
exit $fails
