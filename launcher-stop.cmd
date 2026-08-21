@echo off
rem ============================================================
rem  dsh-launcher-stop.cmd - stop the launcher backend
rem  Usage: launcher-stop.cmd [--port N]   (default port 5177)
rem  NOTE: keep this file pure ASCII + CRLF.
rem ============================================================
setlocal
set "LPORT=5177"
if /i "%~1"=="--port" if not "%~2"=="" set "LPORT=%~2"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%LPORT%" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /T /F >nul 2>nul
)
echo [dsh-launcher] Backend on port %LPORT% stopped.
