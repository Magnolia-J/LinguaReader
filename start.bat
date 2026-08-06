@echo off
setlocal
cd /d "%~dp0"

REM If port 3007 is already listening, just open the browser.
netstat -ano 2>nul | findstr /r ":3007[ ]" >nul
if %errorlevel%==0 goto OPEN

REM Pick a node executable (prefer PATH, fall back to the managed runtime).
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Users\姜玉兰\.workbuddy\binaries\node\versions\22.22.2\node.exe"

REM Start the local server in a minimized window.
start "" /min "%NODE%" server.js
REM Give the server a moment to bind the port.
timeout /t 3 /nobreak >nul

:OPEN
start "" http://localhost:3007/
exit /b
