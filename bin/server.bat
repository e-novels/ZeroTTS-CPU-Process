@echo off
setlocal
set "DIR=%~dp0"
set "EXT_ROOT=%DIR%.."
set "SERVER_JS=%EXT_ROOT%\dist\server.js"

@rem Optimize OpenMP and multi-core CPU threading for ONNX Runtime (100% CPU power)
set OMP_WAIT_POLICY=PASSIVE
set KMP_BLOCKTIME=0
set "NODE_PATH=%EXT_ROOT%\node_modules;%NODE_PATH%"

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node "%SERVER_JS%" %*
    exit /b %ERRORLEVEL%
)

if exist "%LOCALAPPDATA%\Programs\E-novels\E-novels.exe" (
    set ELECTRON_RUN_AS_NODE=1
    "%LOCALAPPDATA%\Programs\E-novels\E-novels.exe" "%SERVER_JS%" %*
    exit /b %ERRORLEVEL%
)

if exist "%PROGRAMFILES%\E-novels\E-novels.exe" (
    set ELECTRON_RUN_AS_NODE=1
    "%PROGRAMFILES%\E-novels\E-novels.exe" "%SERVER_JS%" %*
    exit /b %ERRORLEVEL%
)

echo ZeroTTS Process Error: Node.js runtime not found on this system. 1>&2
exit /b 1
