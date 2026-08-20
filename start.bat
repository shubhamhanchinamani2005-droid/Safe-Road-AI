@echo off
echo Cleaning up old processes...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
echo ==========================================
echo Starting SafeRoadAI Project (Single Terminal Mode)
echo ==========================================

echo [1/3] Starting AI Engine in background...
cd "%~dp0ai-engine"
start /B cmd /c "venv\Scripts\activate && python app.py"

timeout /t 3 /nobreak > nul

echo [2/3] Starting Backend Server in background...
cd "%~dp0backend"
if not exist node_modules (
    echo Installing backend dependencies...
    call npm install
)
start /B cmd /c "node server.js"

timeout /t 3 /nobreak > nul

echo [3/3] Starting Frontend (Main Process)...
cd "%~dp0frontend"
if not exist node_modules (
    echo Installing frontend dependencies...
    call npm install --legacy-peer-deps
)

echo Opening browser at http://localhost:5173...
start http://localhost:5173

echo.
echo All services are running! Press Ctrl+C to stop everything.
echo.
npm run dev
