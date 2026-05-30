@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python or add it to PATH.
  goto :end
)

echo Starting local preview...
echo A browser window should open automatically.
echo If it does not, copy the Preview URL printed below.
echo The default preview port is 8010.
python scripts\serve.py

:end
if /i not "%~1"=="--no-pause" pause
endlocal
