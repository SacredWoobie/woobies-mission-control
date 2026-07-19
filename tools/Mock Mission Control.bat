@echo off
setlocal
cd /d "%~dp0.."

if "%~1"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Mock-Mission-Control.ps1" -Action menu
    exit /b %ERRORLEVEL%
)

if "%~2"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Mock-Mission-Control.ps1" -Action "%~1"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Mock-Mission-Control.ps1" -Action "%~1" -Scene "%~2"
)
exit /b %ERRORLEVEL%
