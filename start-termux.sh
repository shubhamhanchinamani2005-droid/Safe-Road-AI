#!/data/data/com.termux/files/usr/bin/bash
# ==========================================================
# SafeRoad AI - Automated Termux Android Runner
# ==========================================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Cleaning up any old running processes..."
killall -9 node python python3 2>/dev/null || true

echo "=========================================================="
echo " Starting SafeRoad AI on Android (Termux)"
echo "=========================================================="

cleanup() {
    echo ""
    echo "Stopping SafeRoad AI services..."
    kill $AI_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    killall -9 node python python3 2>/dev/null || true
    echo "SafeRoad AI stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start AI Engine
echo "[1/3] Starting AI Engine (Port 8000)..."
cd "$ROOT_DIR/ai-engine"
python app.py > /tmp/saferoad-ai.log 2>&1 &
AI_PID=$!
sleep 2

# 2. Start Backend Server
echo "[2/3] Starting Backend Server (Port 5000)..."
cd "$ROOT_DIR/backend"
node server.js > /tmp/saferoad-backend.log 2>&1 &
BACKEND_PID=$!
sleep 1

# 3. Start Frontend
echo "[3/3] Starting Frontend (Port 5173)..."
cd "$ROOT_DIR/frontend"
echo ""
echo "=========================================================="
echo " SafeRoad AI is RUNNING on your phone!"
echo " Open your mobile browser (Chrome) and navigate to:"
echo ""
echo "       👉  http://localhost:5173"
echo ""
echo " Press Ctrl+C in Termux anytime to stop the app."
echo "=========================================================="
echo ""

npx vite --host 0.0.0.0 --port 5173
