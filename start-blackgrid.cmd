@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0tools\node-v24.21.0-win-x64\node.exe" set "PATH=%~dp0tools\node-v24.21.0-win-x64;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS before starting BLACKGRID.
  pause
  exit /b 1
)
if not exist "node_modules\ws" (
  call npm ci
  if errorlevel 1 exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 exit /b 1
)
if not defined PORT set "PORT=3000"
echo BLACKGRID will listen on http://localhost:%PORT%
echo Close this window or press Ctrl+C to stop the host.
call npm start
pause
