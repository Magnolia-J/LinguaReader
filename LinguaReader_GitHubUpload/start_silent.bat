@echo off
setlocal
cd /d "%~dp0"

REM 如果端口 3007 已经在监听，就什么都不做，直接退出。
netstat -ano 2>nul | findstr /r ":3007[ ]" >nul
if %errorlevel%==0 exit /b

REM 选择 node 可执行文件：优先用系统 PATH 里的，找不到再退回 WorkBuddy 自带运行时。
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Users\姜玉兰\.workbuddy\binaries\node\versions\22.22.2\node.exe"

REM 以最小化窗口启动本地服务（不打开浏览器，适合开机自启）。
start "" /min "%NODE%" server.js
exit /b
