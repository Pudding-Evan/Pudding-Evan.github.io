@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python or add it to PATH.
  goto :end
)

echo Building Markdown articles...
python scripts\build.py
if errorlevel 1 (
  echo Build failed.
  goto :end
)

echo Build complete.

:end
if /i not "%~1"=="--no-pause" pause
endlocal
