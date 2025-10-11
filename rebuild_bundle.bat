@echo off
REM Rebuilds the production bundle for the RTS game.
REM Run this shortcut whenever you need a fresh assets/index-*.js.

pushd "%~dp0"
call npm run bundle
popd

echo.
echo Bundle rebuild finished. Press any key to close this window.
pause >nul
