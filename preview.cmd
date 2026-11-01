@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node tools\preview.mjs
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools\preview.mjs
) else (
  echo Node.js was not found. Use the Codex terminal or install Node.js from https://nodejs.org/.
  pause
  exit /b 1
)
if errorlevel 1 pause
