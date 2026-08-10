@echo off
setlocal
cd /d "%~dp0"

REM 如果端口 3007 已经在监听，就什么都不做，直接退出。
netstat -ano 2>nul | findstr /r ":3007[ ]" >nul
if %errorlevel%==0 exit /b

REM 使用系统 PATH 中的 node（完全独立运行，不依赖任何第三方工具）。
set "NODE=node"
where node >nul 2>nul
if %errorlevel%==0 goto HAVE_NODE

echo [LinguaReader] 未检测到 Node.js，请先安装：https://nodejs.org （勾选 Add to PATH）
exit /b 1

:HAVE_NODE
REM 以最小化窗口启动本地服务（不打开浏览器，适合开机自启）。
start "" /min "%NODE%" server.js
exit /b
