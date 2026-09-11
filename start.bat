@echo off
echo Cleaning up old processes...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
echo ==========================================
echo Starting SafeRoadAI Project
echo ==========================================

echo [1/3] Starting AI Engine (port 8000)...
cd /d "%~dp0ai-engine"
start /B "" "%~dp0ai-engine\venv\Scripts\python.exe" app.py

echo Waiting for AI Engine to start...
timeout /t 2 /nobreak >nul

echo [2/3] Starting Backend Server (port 5000)...
cd /d "%~dp0backend"
if not exist node_modules (
    echo Installing backend dependencies...
    call npm install
)
start /B cmd /c "node server.js"

timeout /t 1 /nobreak >nul

echo [3/3] Starting Frontend (port 5173)...
cd /d "%~dp0frontend"
if not exist node_modules (
    echo Installing frontend dependencies...
    call npm install --legacy-peer-deps
)

echo Browser will open automatically when Vite is ready...

echo.
echo All services running! Press Ctrl+C to stop.
echo.
npx vite --open
