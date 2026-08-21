@echo off
rem ============================================================
rem  setup.cmd - bootstrap the portable launcher kit on a NEW machine
rem  Installs inside .runtime (no system changes):
rem    1. portable Node + pnpm          .runtime\node
rem    2. portable Python + venv+pyyaml .runtime\python / .runtime\venv
rem    3. launcher frontend             dist\
rem    4. config.json defaults if missing
rem  dsh itself is NOT bundled - deploy it from the launcher UI
rem  (Deploy page) into a directory of your choice.
rem  NOTE: keep this file pure ASCII + CRLF.
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title dsh-launcher setup

set "NODE_EXE=%~dp0.runtime\node\node.exe"
set "NPM_CMD=%~dp0.runtime\node\npm.cmd"
set "PNPM_CMD=%~dp0.runtime\node\pnpm.cmd"
set "PY_EXE=%~dp0.runtime\python\tools\python.exe"
set "VENV_PY=%~dp0.runtime\venv\Scripts\python.exe"

rem ---------- 1. portable node + pnpm ----------
if exist "%NODE_EXE%" goto node_done
echo [setup] Downloading portable Node v24.18.0 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';$u='https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip';$z=Join-Path $env:TEMP 'dsh-node.zip';Invoke-WebRequest -Uri $u -OutFile $z -UseBasicParsing;$e=Join-Path $env:TEMP ('dsh-node-'+[guid]::NewGuid().ToString('N'));Expand-Archive $z $e -Force;$dst='%~dp0.runtime\node';New-Item -ItemType Directory -Force -Path $dst;$src=Join-Path $e 'node-v24.18.0-win-x64';Copy-Item (Join-Path $src '*') $dst -Recurse -Force;Remove-Item $e,$z -Recurse -Force -ErrorAction SilentlyContinue"
if errorlevel 1 goto node_fail
:node_done
echo [setup] Portable Node: %NODE_EXE%
if exist "%PNPM_CMD%" goto pnpm_done
echo [setup] Installing pnpm@11.7.0 into portable Node ...
call "%NPM_CMD%" install -g pnpm@11.7.0
if errorlevel 1 goto pnpm_fail
:pnpm_done
echo [setup] pnpm: %PNPM_CMD%

rem ---------- 2. portable python + venv + pyyaml ----------
if exist "%VENV_PY%" goto py_done
echo [setup] Downloading portable Python 3.12.10 (nuget) ...
if not exist "%~dp0.runtime\python" mkdir "%~dp0.runtime\python"
curl -L --max-time 600 -o "%~dp0.runtime\python\python.nupkg" "https://www.nuget.org/api/v2/package/python/3.12.10"
if errorlevel 1 goto py_fail
tar -xf "%~dp0.runtime\python\python.nupkg" -C "%~dp0.runtime\python"
if errorlevel 1 goto py_fail
del "%~dp0.runtime\python\python.nupkg" 2>nul
"%PY_EXE%" -m venv "%~dp0.runtime\venv"
if errorlevel 1 goto py_fail
"%VENV_PY%" -m pip install --disable-pip-version-check -q pyyaml
if errorlevel 1 goto py_mirror
goto py_done
:py_mirror
echo [setup] pip failed - retrying with China mirror ...
"%VENV_PY%" -m pip install --disable-pip-version-check -q -i https://pypi.tuna.tsinghua.edu.cn/simple pyyaml
if errorlevel 1 goto py_fail
:py_done
echo [setup] Python venv: %VENV_PY%

rem ---------- 3. launcher frontend ----------
if exist "node_modules" goto fe_deps_done
echo [setup] Installing launcher frontend dependencies ...
call "%PNPM_CMD%" install
if errorlevel 1 goto fe_fail
:fe_deps_done
if exist "dist\index.html" goto fe_done
echo [setup] Building launcher frontend ...
call "%PNPM_CMD%" run build
if errorlevel 1 goto fe_fail
:fe_done

rem ---------- 4. config defaults if missing ----------
if exist "config.json" goto cfg_done
echo {"dshRoot": "../deepseek_harness", "webPort": 3080, "launcherPort": 5177, "profile": null, "openBrowser": false}> config.json
:cfg_done

echo.
echo [setup] Kit ready. Double-click launcher.cmd to start.
echo         dsh itself: open the launcher UI -^> Deploy page -^> one-click deploy.
pause
exit /b 0

:node_fail
echo [setup] FAILED: portable Node download/install
pause
exit /b 1
:pnpm_fail
echo [setup] FAILED: pnpm install into portable Node
pause
exit /b 1
:py_fail
echo [setup] FAILED: portable Python setup
pause
exit /b 1
:fe_fail
echo [setup] FAILED: launcher frontend install/build
pause
exit /b 1
