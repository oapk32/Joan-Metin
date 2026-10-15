@echo off
setlocal
title Joan Metin CO-OP - spoustec
cd /d "%~dp0server"
where node >nul 2>&1
if errorlevel 1 (
  echo CHYBA: Nainstaluj Node.js 22 nebo novejsi.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Instaluji knihovny serveru...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo Instalace selhala.
    pause
    exit /b 1
  )
)
for /f %%I in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "COOP_ROOM_CODE=%%I"
if not defined COOP_ROOM_CODE (
  echo Nepodarilo se vytvorit kod mistnosti.
  pause
  exit /b 1
)
set "COOP_BIND_HOST=127.0.0.1"
start "Joan CO-OP server - NEZAVIRAT" cmd /k node coop-host.js
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3784/coop/?code=%COOP_ROOM_CODE%"
echo.
echo Joan CO-OP spusten. V druhem cernem okne bezi server.
echo Adresa hostitele:
echo http://127.0.0.1:3784/coop/?code=%COOP_ROOM_CODE%
echo.
echo Kamaradi potrebuji tvoji Tailscale nebo Cloudflare adresu
echo a stejny kod za /coop/?code=.
echo Vypnuti: Ctrl+C v okne Joan CO-OP server.
pause
