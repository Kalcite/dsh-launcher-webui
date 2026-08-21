@echo off
rem ============================================================
rem  dsh-launcher.cmd - DeepSeek Harness launcher entry
rem
rem  Double-click: start the backend and open the browser.
rem  Usage: launcher.cmd [--port N] [--web-port N] [--profile name]
rem    --port      launcher UI port (default 5177)
rem    --web-port  dsh server port (default: config.json)
rem    --profile   dsh profile to boot (default: web)
rem  Stop: launcher-stop.cmd [--port N] (or Ctrl+C here)
rem
rem  NOTE: keep this file pure ASCII + CRLF - cmd.exe parses
rem  batch files with the system ANSI codepage.
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title dsh-launcher

rem --- parse args: --port (launcher port) ---
set "LPORT=5177"
:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--port" (
    if not "%~2"=="" set "LPORT=%~2"
    shift
    shift
    goto :parse
)
shift
goto :parse
:parsed

rem --- already running on the launcher port? just open the UI ---
netstat -ano | findstr ":%LPORT%" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [dsh-launcher] Launcher already running on port %LPORT% - opening UI...
    start "" "http://127.0.0.1:%LPORT%"
    exit /b 0
)

if not exist "dist\index.html" (
    echo [dsh-launcher] Frontend not built - run: setup.cmd
    pause
    exit /b 1
)

rem --- prefer the kit's own portable node, fallback to dsh's ---
set "LOCAL_NODE=%~dp0.runtime\node\node.exe"
if not exist "%LOCAL_NODE%" set "LOCAL_NODE=%~dp0..\deepseek_harness\.runtime\node\node.exe"

if exist "%LOCAL_NODE%" (
    echo [dsh-launcher] Using portable node: %LOCAL_NODE%
    "%LOCAL_NODE%" server\index.mjs --open %*
) else (
    where node >nul 2>nul
    if errorlevel 1 (
        echo [dsh-launcher] node not found - run setup.cmd to install the portable Node
        pause
        exit /b 1
    )
    echo [dsh-launcher] Starting... Ctrl+C to stop.
    node server\index.mjs --open %*
)

echo.
echo [dsh-launcher] Backend exited. Press any key to close...
pause >nul
