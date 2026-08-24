@echo off
rem ============================================================
rem  dsh-launcher-stop.cmd - stop the launcher backend.
rem  All logic lives in tools\launcher_boot.py (--stop).
rem  Usage: launcher-stop.cmd [--port N]   (default: config.json)
rem  NOTE: keep this file pure ASCII + CRLF.
rem ============================================================
setlocal
cd /d "%~dp0"
rem Guarantee System32 on PATH (netstat/taskkill resolve even if user PATH is broken)
set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"
set "VENV_PY=%~dp0.runtime\venv\Scripts\python.exe"
if exist "%VENV_PY%" goto :run_venv
goto :run_sys

:run_venv
"%VENV_PY%" "%~dp0tools\launcher_boot.py" --stop %*
exit /b %errorlevel%

:run_sys
python "%~dp0tools\launcher_boot.py" --stop %*
if not errorlevel 1 exit /b %errorlevel%
echo [dsh-launcher] Python not found - run setup.cmd first
exit /b 1
