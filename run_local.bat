@echo off
if /I "%~1"=="stop" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-demo.ps1" %2 %3
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-demo.ps1" -OpenBrowser %*
)
