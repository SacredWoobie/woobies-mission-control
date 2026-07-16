@echo off
setlocal

rem Launch the modular KSP component window. The Python launcher discovers
rem telemetry_server.py and panel_bridge.py at runtime, and shows only the
rem components whose scripts are present beside it.

set "APP=%~dp0ksp_dashboard_app.py"

if not exist "%APP%" (
    echo ERROR: ksp_dashboard_app.py was not found beside this launcher.
    echo Expected: "%APP%"
    pause
    exit /b 1
)

rem Prefer a project-local virtual environment when one has been created using
rem the README instructions. This keeps dashboard packages isolated from other
rem Python programs on the computer.
if exist "%~dp0.venv\Scripts\pythonw.exe" (
    start "" "%~dp0.venv\Scripts\pythonw.exe" "%APP%"
    exit /b 0
)

if exist "%~dp0.venv\Scripts\python.exe" (
    start "KSP Components" "%~dp0.venv\Scripts\python.exe" "%APP%"
    exit /b 0
)

rem Prefer the windowless Python executables so the GUI has no extra console.
where pythonw.exe >nul 2>&1
if not errorlevel 1 (
    start "" pythonw.exe "%APP%"
    exit /b 0
)

where pyw.exe >nul 2>&1
if not errorlevel 1 (
    start "" pyw.exe -3 "%APP%"
    exit /b 0
)

rem Fall back to a visible console, which also makes Python errors readable.
where python.exe >nul 2>&1
if not errorlevel 1 (
    start "KSP Components" python.exe "%APP%"
    exit /b 0
)

where py.exe >nul 2>&1
if not errorlevel 1 (
    start "KSP Components" py.exe -3 "%APP%"
    exit /b 0
)

echo ERROR: Python 3 was not found on PATH.
echo Install Python 3 from https://www.python.org/ and enable "Add Python to PATH".
pause
exit /b 1
