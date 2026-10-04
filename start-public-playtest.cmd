@echo off
setlocal
cd /d "%~dp0"
if not exist "tools\cloudflared.exe" (
  echo Cloudflared is not installed in this project. Use the official Cloudflare download.
  pause
  exit /b 1
)
if not defined PORT set "PORT=3000"
curl.exe --fail --silent --max-time 5 http://127.0.0.1:%PORT%/api/health >nul 2>nul
if errorlevel 1 (
  echo Start start-blackgrid.cmd first, then open this launcher again.
  pause
  exit /b 1
)
echo This creates a PUBLIC temporary playtest link. Anyone with the link can join.
echo The laptop, game server, and tunnel must stay running. There is no uptime guarantee.
echo Press Ctrl+C or close this window to stop public access.
"tools\cloudflared.exe" tunnel --url http://127.0.0.1:%PORT% --no-autoupdate --protocol http2
pause
