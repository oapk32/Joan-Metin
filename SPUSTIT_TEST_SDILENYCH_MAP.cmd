@echo off
setlocal
title Joan Metin - oddeleny test sdilenych map
cd /d "%~dp0server"
where node >nul 2>&1
if errorlevel 1 (
  echo CHYBA: Nainstaluj Node.js 22 nebo novejsi.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Instaluji CO-OP zavislosti...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo CHYBA: Zavislosti se nepodarilo nainstalovat.
    pause
    exit /b 1
  )
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4784 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo.
  echo CHYBA: Testovaci port 4784 je uz obsazeny.
  echo Pokud uz bezi testovaci server, nespoustej druhy.
  pause
  exit /b 1
)
for /f %%I in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "COOP_ROOM_CODE=%%I"
if not defined COOP_ROOM_CODE (
  echo CHYBA: Nelze vytvorit pristupovy kod.
  pause
  exit /b 1
)
set "COOP_PORT=4784"
set "COOP_BIND_HOST=127.0.0.1"
rem Deliberately do not set COOP_WORLD_BROWSER_TEST on a publicly reachable test.
start "Joan TEST sdilene mapy - NEZAVIRAT" cmd /k node coop-host.js
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:4784/coop/?code=%COOP_ROOM_CODE%"
echo.
echo EXPERIMENTALNI CO-OP TEST: http://127.0.0.1:4784/coop/?code=%COOP_ROOM_CODE%
echo.
echo Pouziva jiny port a prazdne uloziste prohlizece nez bezny CO-OP 3784.
echo Stary server na portu 3784 nech bežet beze zmeny.
echo TEST: nove postavy, ne cenne ulozene postavy.
echo Pro dalsi PC je potreba vlastni Cloudflare tunnel na 4784.
echo Vypnuti: Ctrl+C v novem okne testovaciho serveru.
pause
