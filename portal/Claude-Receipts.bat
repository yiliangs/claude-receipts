@echo off
title Claude Receipts - Usage Portal
REM ====================================================================
REM  Claude Receipts - Usage Portal - one-click launcher
REM
REM  Double-click this file. It refreshes the data from the Drive logbook,
REM  starts the local viewer, and opens your browser automatically.
REM  Keep this window open while using the portal; close it to stop.
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
echo  Starting Claude Receipts portal...
echo  Your browser will open automatically at http://localhost:4179
echo  Close this window to stop the server.
echo.
call npm run dev -- --open
