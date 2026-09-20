@echo off
setlocal
set REPO=C:\Users\carlg\Documents\Codex\maTumbo-Living-Reality-Worktrees\16-reality-lens-person
cd /d "%REPO%" || (echo Could not find %REPO% & pause & exit /b 1)

echo === maTumbo Living Reality ===
echo.

REM --- Python must exist before anything else ---
set PY=python
where python >nul 2>nul
if %errorlevel%==0 goto :havelang
where py >nul 2>nul
if %errorlevel%==0 (
  set PY=py
  goto :havelang
)
echo Python was not found on this computer.
echo Install it from https://www.python.org/downloads/
echo ^(tick "Add python.exe to PATH" during setup^), then run this file again.
pause
exit /b 1
:havelang

REM Fix "no tracking information" once and for all
git branch --set-upstream-to=origin/work/reality-lens-person work/reality-lens-person 2>nul

call :dopull
call :startservers
timeout /t 2 /nobreak >nul
call :openviews
goto :menu

:dopull
REM Safe pull: never auto-pull into a dirty tree
git status --porcelain | findstr /r "." >nul
if %errorlevel%==0 (
  echo Your checkout has uncommitted changes - skipping auto-pull.
  echo.
) else (
  echo Pulling latest...
  git pull --ff-only
  echo.
)
if not exist "vendor\three-r179.1\build\three.module.js" (
  echo WARNING: 3D engine files missing. Tell Tumbo - do not ignore this.
  echo.
) else (
  echo 3D engine files present.
  echo.
)
exit /b 0

:startservers
echo Starting servers...
call :startone 8080 demo
call :startone 8181 paper
call :startone 8282 nfts
call :startone 8383 person
call :startone 8484 luna
call :startone 8585 contracts
echo.
exit /b 0

:startone
REM %1 = port, %2 = label. Never kills anything: reuses a live server or warns.
curl -s -o nul -m 2 http://localhost:%1/ >nul 2>nul
if %errorlevel%==0 (
  echo   :%1  already serving - reusing it, no new server started.
  exit /b 0
)
netstat -an | findstr LISTENING | findstr /c:":%1 " >nul 2>nul
if %errorlevel%==0 (
  echo   :%1  WARNING: port is held by another program - skipping %2.
  exit /b 0
)
start "maTumbo :%1 %2" %PY% -m http.server %1
echo   :%1  starting %2...
exit /b 0

:openviews
start http://localhost:8080/index.html
start http://localhost:8181/paper.html
start http://localhost:8282/index.html?feature=nft-atelier
start http://localhost:8383/index.html?feature=person
start http://localhost:8484/index.html?feature=luna-companion
start http://localhost:8585/index.html?feature=contract-atelier
exit /b 0

:menu
echo.
echo  ============ BACKEND COMMAND ============
echo   8080  full 3D demo
echo   8181  white paper
echo   8282  NFT Atelier
echo   8383  Person
echo   8484  Luna Companion
echo   8585  Contract Atelier
echo  -----------------------------------------
echo   [1-6] open a view   [P] pull latest
echo   [R] restart servers [S] check status
echo   [Q] stop everything and quit
echo  =========================================
choice /c 123456PRSQ /n /m "Command: "
if %errorlevel%==10 goto :quit
if %errorlevel%==9 call :status & goto :menu
if %errorlevel%==8 call :restart & goto :menu
if %errorlevel%==7 call :dopull & goto :menu
if %errorlevel%==6 start http://localhost:8585/index.html?feature=contract-atelier & goto :menu
if %errorlevel%==5 start http://localhost:8484/index.html?feature=luna-companion & goto :menu
if %errorlevel%==4 start http://localhost:8383/index.html?feature=person & goto :menu
if %errorlevel%==3 start http://localhost:8282/index.html?feature=nft-atelier & goto :menu
if %errorlevel%==2 start http://localhost:8181/paper.html & goto :menu
if %errorlevel%==1 start http://localhost:8080/index.html & goto :menu
goto :menu

:status
echo.
for %%p in (8080 8181 8282 8383 8484 8585) do (
  curl -s -o nul -m 3 http://localhost:%%p/ >nul 2>nul && echo   :%%p  UP || echo   :%%p  DOWN
)
exit /b 0

:restart
echo.
echo Restarting all servers...
taskkill /FI "WINDOWTITLE eq maTumbo*" /F >nul 2>nul
timeout /t 1 /nobreak >nul
call :startservers
echo All servers restarted.
exit /b 0

:quit
echo.
echo Stopping all servers...
taskkill /FI "WINDOWTITLE eq maTumbo*" /F >nul 2>nul
echo Done. Press any key to close.
pause >nul
exit /b 0
