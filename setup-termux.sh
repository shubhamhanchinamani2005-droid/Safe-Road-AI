#!/data/data/com.termux/files/usr/bin/bash
# ==========================================================
# SafeRoad AI - Automated Termux Android Environment Setup
# ==========================================================
set -e

echo "=== [1/4] Updating Termux packages ==="
pkg update -y && pkg upgrade -y

echo "=== [2/4] Installing Node.js, Python, OpenCV and Build Tools ==="
pkg install -y nodejs python git clang make cmake libjpeg-turbo opencv

echo "=== [3/4] Installing Python AI Engine Dependencies ==="
pip install --upgrade pip
pip install fastapi uvicorn pydantic pillow numpy

# Attempt onnxruntime install (optional; code falls back to OpenCV if unavailable)
pip install onnxruntime || echo "Note: ONNX Runtime skipped or optional on ARM. CV engine fully active."

echo "=== [4/4] Installing Backend & Frontend Node dependencies ==="
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Backend dependencies..."
cd "$ROOT_DIR/backend"
npm install

echo "Installing Frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install --legacy-peer-deps

echo ""
echo "=========================================================="
echo " Setup complete! To start SafeRoad AI on your phone:"
echo " Run: ./start-termux.sh"
echo "=========================================================="
