@echo off
setlocal
title Aktualizace Joan Metiny Online
cd /d "%~dp0"
echo Pred aktualizaci vypni server (Ctrl+C).
git pull --ff-only origin multiplayer-dev
if errorlevel 1 (
  echo Aktualizace se nepovedla. Posli chybu z okna do chatu.
  pause
  exit /b 1
)
cd server
call npm.cmd install --no-audit
if errorlevel 1 (
  echo CHYBA pri instalaci serverovych knihoven.
  pause
  exit /b 1
)
echo Aktualizace hotova. Spust SPUSTIT_JOAN.cmd.
pause
