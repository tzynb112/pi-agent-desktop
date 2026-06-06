@echo off
title PianoAgent

echo ==========================================
echo        PianoAgent - Starting...
echo ==========================================
echo.

:: Release old ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9000 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo [1] Launching Electron and Webpack Dev Server...
start "PianoAgent" cmd /c "npm run start"

timeout /t 4 /nobreak >nul

echo [2] Opening browser preview window...
start http://localhost:9000

echo.
echo Application started successfully!
echo   - The Electron window will open automatically (please check your taskbar)
echo   - Fallback access: http://localhost:9000
echo   - To stop the application, close the Electron window or press Ctrl+C in this console
echo.
pause