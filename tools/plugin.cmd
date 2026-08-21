@echo off
rem ============================================================
rem  plugin.cmd - dsh-launcher plugin manager (Python)
rem  Usage: plugin.cmd list|install|remove|disable|enable [args...]
rem  NOTE: keep this file pure ASCII + CRLF.
rem ============================================================
setlocal
cd /d "%~dp0.."
set "VENV_PY=%~dp0..\.runtime\venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo [plugin] Python venv missing - run setup.cmd first
    exit /b 1
)
"%VENV_PY%" "%~dp0plugin.py" %*
exit /b %errorlevel%
