@echo off
echo ==========================================================
echo SafeRoad AI - Android APK Local Build Script
echo ==========================================================

echo [1/3] Building Web Assets...
cd /d "%~dp0frontend"
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Web build failed.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/3] Syncing Capacitor Android Project...
call npx cap sync android
if %errorlevel% neq 0 (
    echo [ERROR] Capacitor sync failed.
    pause
    exit /b %errorlevel%
)

echo.
echo [3/3] Compiling Android APK with Gradle...
cd /d "%~dp0frontend\android"
if exist gradlew.bat (
    call gradlew.bat assembleDebug
    if %errorlevel% equ 0 (
        echo.
        echo ==========================================================
        echo BUILD SUCCESSFUL!
        echo Your APK is located at:
        echo frontend\android\app\build\outputs\apk\debug\app-debug.apk
        echo ==========================================================
        pause
        exit /b 0
    )
)

echo.
echo [NOTICE] If Gradle wrapper download timed out, open the project in Android Studio:
echo Directory: %~dp0frontend\android
echo Android Studio will build the APK with 1 click: Build ^> Build APK(s)
pause
