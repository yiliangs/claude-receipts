@echo off
setlocal
title Agent Usage Stat
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :node_missing
where npm >nul 2>nul
if errorlevel 1 goto :node_missing
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto :node_old

set "RUNTIME=%USERPROFILE%\.agent-usage-stat\runtime"
set "APP=%RUNTIME%\node_modules\agent-usage-stat\bin\agent-usage-stat.js"
set "PACKAGE_SOURCE=agent-usage-stat@latest"

if exist "src\cli.ts" (
  if not exist "node_modules" call npm install
  if errorlevel 1 goto :failed
  if not exist "portal\node_modules" call npm --prefix portal install
  if errorlevel 1 goto :failed
  call npm run build
  if errorlevel 1 goto :failed

  call :pack_local
  if errorlevel 1 goto :failed
  goto :install_app
)

:use_installed
if exist "%APP%" goto :run_app

:install_app
call npm install --prefix "%RUNTIME%" "%PACKAGE_SOURCE%" --no-audit --no-fund
if errorlevel 1 goto :failed

:run_app
if defined AGENT_USAGE_STAT_DATA_ROOT (
  call node "%APP%" setup --data-root "%AGENT_USAGE_STAT_DATA_ROOT%"
) else (
  call node "%APP%" setup
)
if errorlevel 1 goto :failed

if defined AGENT_USAGE_STAT_NO_OPEN (
  call node "%APP%" portal --no-open
) else (
  call node "%APP%" portal
)
exit /b 0

:pack_local
set "PACK_DIR=%RUNTIME%\install-cache\%RANDOM%%RANDOM%"
mkdir "%PACK_DIR%"
if errorlevel 1 exit /b 1
set "PACKAGE_SOURCE="
for /f "delims=" %%F in ('npm pack --silent --pack-destination "%PACK_DIR%"') do set "PACKAGE_SOURCE=%PACK_DIR%\%%F"
if not defined PACKAGE_SOURCE exit /b 1
exit /b 0

:node_missing
echo.
echo Node.js 20 or newer is required. Install it from https://nodejs.org and try again.
goto :failed

:node_old
echo.
echo Your Node.js version is too old. Install Node.js 20 or newer and try again.
goto :failed

:failed
echo.
echo Initialization did not finish. Review the message above.
pause
exit /b 1
