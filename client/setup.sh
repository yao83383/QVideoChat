#!/bin/bash
# Download MediaPipe WASM files and face landmarker model
# Run this after `npm install` in client/

echo "Downloading MediaPipe WASM files..."
mkdir -p public/wasm

# Copy from node_modules
cp node_modules/@mediapipe/tasks-vision/wasm/* public/wasm/ 2>/dev/null || {
  echo "WASM files not in node_modules. Installing @mediapipe/tasks-vision..."
  npm install @mediapipe/tasks-vision@latest
  cp node_modules/@mediapipe/tasks-vision/wasm/* public/wasm/
}

echo "Downloading face landmarker model..."
mkdir -p public/models
curl -L -o public/models/face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"

echo "Done! WASM files and model are ready."
