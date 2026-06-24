@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run VaultGate.
  echo Install Node.js, then run this script again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required to run VaultGate.
  echo Install Node.js with npm, then run this script again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

set "ELECTRON_NEEDS_REPAIR="
if not exist "node_modules\electron\path.txt" set "ELECTRON_NEEDS_REPAIR=1"
if not exist "node_modules\electron\dist\electron.exe" set "ELECTRON_NEEDS_REPAIR=1"

if defined ELECTRON_NEEDS_REPAIR (
  echo Repairing Electron install...
  call npm rebuild electron
  if errorlevel 1 (
    echo Failed to repair Electron.
    echo Try deleting node_modules\electron and running npm install.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\path.txt" (
  echo Electron is still not installed correctly.
  echo Try deleting node_modules\electron and running npm install.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is still not installed correctly.
  echo Try deleting node_modules\electron and running npm install.
  pause
  exit /b 1
)

echo Starting VaultGate...
call npm run electron:dev
if errorlevel 1 (
  echo VaultGate exited with an error.
  pause
  exit /b 1
)

endlocal
