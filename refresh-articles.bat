@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"
if errorlevel 1 (
  echo Failed to enter project directory:
  echo   %ROOT%
  goto :fail
)

if not exist "%ROOT%\package.json" (
  echo package.json was not found under:
  echo   %ROOT%
  echo Put this bat file in the project root, next to package.json.
  goto :fail
)

if not exist "%ROOT%\scripts\sync-articles-index.mjs" (
  echo scripts\sync-articles-index.mjs was not found.
  echo Please check the project path and scripts folder.
  goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  goto :fail
)

echo Refreshing content\articles.md ...
call npm run sync-articles
if errorlevel 1 goto :fail

echo.
echo Done. content\articles.md has been refreshed.
goto :end

:fail
echo.
echo Refresh failed. See the message above.
pause
exit /b 1

:end
pause
endlocal
