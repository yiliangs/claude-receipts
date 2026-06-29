@echo off
title Claude Receipts - Usage Portal
REM ====================================================================
REM  Claude Receipts - Usage Portal - one-click launcher
REM
REM  Double-click this file. It clears any old portal server, refreshes the
REM  data from the Drive logbook, starts the local viewer, and opens your
REM  browser automatically at http://localhost:4179.
REM  Keep this window open while using the portal; close it to stop.
REM
REM  IMPORTANT: the portal lives at http://localhost:4179 (this launcher).
REM  Do NOT bookmark http://localhost:4173 - that is a stale built preview.
REM
REM  Data source: H:\My Drive\claude-receipts\logbook.csv
REM  Override:     set CLAUDE_RECEIPTS_LOGBOOK=path\to\logbook.csv
REM ====================================================================
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ERROR: Node.js / npm was not found on your PATH.
  echo  Install Node 22+ from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies, one moment...
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed - see the messages above.
    pause
    exit /b 1
  )
)

echo.
echo  Clearing any old portal server so you always see ONE fresh window...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":4179 "') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":4173 "') do taskkill /f /pid %%a >nul 2>nul

echo.
echo  Refreshing data from the Drive logbook...
set "CLAUDE_RECEIPTS_REQUIRE_SOURCE=1"
call npm run data --silent
if errorlevel 1 (
  echo.
  echo  WARNING: could not refresh from the logbook - opening with the last
  echo  saved snapshot. Check that H:\My Drive is connected, then relaunch
  echo  to pick up the newest sessions.
  echo.
)
set "CLAUDE_RECEIPTS_REQUIRE_SOURCE="

echo.
echo  Starting Claude Receipts portal...
echo  Your browser will open automatically at http://localhost:4179
echo  Close this window to stop the server.
echo.
call npx vite --open
