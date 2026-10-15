@echo off
setlocal
title Joan Metin CO-OP host - lokalni test
cd /d "%~dp0server"
where node >nul 2>&1
if errorlevel 1 (
  echo CHYBA: Nainstaluj Node.js 22 nebo novejsi.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Instaluji zavislosti...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo Instalace selhala.
    pause
    exit /b 1
  )
)
echo.
echo JOAN CO-OP - testovaci host 2-4 hraci.
echo Nyni se vypise tvoje soukroma adresa s kodem.
echo Otevri ji v prohlizeci. Ke kamaradum je potreba Tailscale nebo tunnel.
echo Konec hry: Ctrl+C v tomto okne.
echo.
node coop-host.js
pause
