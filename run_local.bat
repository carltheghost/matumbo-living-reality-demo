@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-demo.ps1" -OpenBrowser
if errorlevel 1 (
  echo.
  echo The demo launcher reported an error. See the message above.
)
echo.
echo Keep this window available for the local launch instructions.
echo Stop only launcher-owned processes with:
echo   powershell -ExecutionPolicy Bypass -File ".\scripts\stop-demo.ps1"
pause
