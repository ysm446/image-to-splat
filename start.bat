@echo off
setlocal

rem Image to Splat launcher
rem Move to the directory of this batch file
cd /d "%~dp0"

rem Ensure Electron launches as a GUI app, not as plain Node.
rem (Some environments set ELECTRON_RUN_AS_NODE=1, which breaks the GUI.)
set "ELECTRON_RUN_AS_NODE="

rem Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js and retry.
  pause
  exit /b 1
)

rem Install dependencies on first run
if not exist "node_modules" (
  echo [setup] First run: installing dependencies with npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

rem Mode: "build" arg = production build + preview, otherwise dev
if /i "%~1"=="build" (
  echo [run] Production build ^(npm run build, then npm run preview^)...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] build failed.
    pause
    exit /b 1
  )
  call npm run preview
) else (
  echo [run] Starting dev mode ^(npm run dev^)...
  call npm run dev
)

endlocal
