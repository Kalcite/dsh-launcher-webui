@echo off
rem ============================================================
rem  dsh-launcher.cmd - entry point (all logic lives in
rem  tools\launcher_boot.py; this file only calls it).
rem
rem  Usage: launcher.cmd [--port N] [--web-port N] [--profile name]
rem  Stop: launcher-stop.cmd [--port N]
rem  NOTE: keep this file pure ASCII + CRLF.
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title dsh-launcher
rem Guarantee System32 on PATH (cmd/netstat/taskkill/powershell resolve even if user PATH is broken)
set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"

set "VENV_PY=%~dp0.runtime\venv\Scripts\python.exe"
if exist "%VENV_PY%" goto :run_venv
goto :run_sys

:run_venv
"%VENV_PY%" "%~dp0tools\launcher_boot.py" %*
set "RC=%errorlevel%"
goto :done

:run_sys
python "%~dp0tools\launcher_boot.py" %*
set "RC=%errorlevel%"
if not errorlevel 1 goto :done

:py_missing
echo [dsh-launcher] Python not found - run setup.cmd first
pause
exit /b 1

:done
echo.
echo [dsh-launcher] Backend exited. Press any key to close...
pause >nul
exit /b %RC%
