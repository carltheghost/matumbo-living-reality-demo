@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3 -m venv .venv
  if errorlevel 1 goto failed
)
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto failed
echo Open http://localhost:8765 in a desktop browser. Phone cameras require HTTPS.
.venv\Scripts\python.exe -m server
goto :eof
:failed
echo Install Python 3.11 or newer, then retry. Read README.md for details.
pause
exit /b 1
