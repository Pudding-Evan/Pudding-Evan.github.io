@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python or add it to PATH.
  goto :end
)

echo Starting local preview...
echo Open http://127.0.0.1:8000 in your browser.
python scripts\serve.py

:end
if /i not "%~1"=="--no-pause" pause
endlocal
