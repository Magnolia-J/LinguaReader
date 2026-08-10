@echo off
setlocal
cd /d "%~dp0"

REM If port 3007 is already listening, just open the browser.
netstat -ano 2>nul | findstr /r ":3007[ ]" >nul
if %errorlevel%==0 goto OPEN

REM 使用系统 PATH 中的 node（完全独立运行，不依赖任何第三方工具）。
set "NODE=node"
where node >nul 2>nul
if %errorlevel%==0 goto HAS_NODE

echo [LinguaReader] 未检测到 Node.js，请先安装：https://nodejs.org （勾选 Add to PATH）
echo [LinguaReader] 安装完成后重新运行本脚本即可。
pause
exit /b 1

:HAS_NODE
REM Start the local server in a minimized window.
start "" /min "%NODE%" server.js
REM Give the server a moment to bind the port.
timeout /t 3 /nobreak >nul

:OPEN
start "" http://localhost:3007/
exit /b
