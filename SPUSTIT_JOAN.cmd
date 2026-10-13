@echo off
setlocal
title Spusteni Joan Metiny Online
cd /d "%~dp0server"
where node >nul 2>&1
if errorlevel 1 (
  echo CHYBA: Node.js neni dostupny. Nainstaluj Node.js LTS.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Instaluji knihovny serveru...
  call npm.cmd install --no-audit
  if errorlevel 1 (
    echo CHYBA: Instalace knihoven selhala.
    pause
    exit /b 1
  )
)
echo Spoustim Joan Online. Nezavirej otevrene okno serveru.
start "Joan Online - server" /D "%CD%" cmd /k "npm.cmd start"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3000/joan/"
echo Pokud se hra neotevre, zkontroluj okno Joan Online - server.
echo Pro vypnuti serveru stiskni Ctrl+C v okne serveru.
pause
