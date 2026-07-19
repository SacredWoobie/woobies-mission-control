@echo off
setlocal EnableExtensions

rem First-run bootstrapper and launcher for Woobie's Mission Control.
rem The bootstrapper creates an isolated .venv beside this file. It never
rem installs or removes packages from the user's system Python environment.

set "APP=%~dp0ksp_dashboard_app.py"
set "VENV_DIR=%~dp0.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"
set "VENV_PYTHONW=%VENV_DIR%\Scripts\pythonw.exe"
set "REQUIREMENTS=%~dp0requirements.txt"
set "DASHBOARD_REQUIREMENTS=%~dp0requirements-dashboard.txt"
set "PANEL_REQUIREMENTS=%~dp0requirements-panel.txt"
set "SETUP_MENU=%~dp0Select Mission Control Setup.ps1"
set "SETUP_LOG=%~dp0mission_control_setup.log"
set "SETUP_ONLY="
set "SETUP_SELECTION="
set "SETUP_REQUIREMENTS="
set "BOOTSTRAP_KIND="
set "BOOTSTRAP_PYTHON="

if not exist "%APP%" (
    echo ERROR: ksp_dashboard_app.py was not found beside this launcher.
    echo Expected: "%APP%"
    pause
    exit /b 1
)

if /I "%~1"=="--check" goto check_only
if /I "%~1"=="--setup-only" (
    set "SETUP_ONLY=1"
    set "SETUP_SELECTION=all"
    set "SETUP_REQUIREMENTS=%REQUIREMENTS%"
    goto setup
)
if not "%~1"=="" (
    echo ERROR: Unknown option "%~1".
    echo Supported options: --check, --setup-only
    pause
    exit /b 2
)

call :launcher_ready
if not errorlevel 1 goto launch

echo.
echo Woobie's Mission Control needs a one-time setup.
echo.
echo This will:
echo   - create an isolated .venv folder beside this launcher
echo   - download only the packages for the components you choose
echo   - leave your system Python and its packages unchanged
echo.
if not exist "%SETUP_MENU%" (
    echo ERROR: Select Mission Control Setup.ps1 was not found beside this launcher.
    echo Expected: "%SETUP_MENU%"
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SETUP_MENU%"
set "MENU_RESULT=%ERRORLEVEL%"
if "%MENU_RESULT%"=="10" (
    set "SETUP_SELECTION=all"
    set "SETUP_REQUIREMENTS=%REQUIREMENTS%"
)
if "%MENU_RESULT%"=="20" (
    set "SETUP_SELECTION=dashboard"
    set "SETUP_REQUIREMENTS=%DASHBOARD_REQUIREMENTS%"
)
if "%MENU_RESULT%"=="30" (
    set "SETUP_SELECTION=panel"
    set "SETUP_REQUIREMENTS=%PANEL_REQUIREMENTS%"
)
if "%MENU_RESULT%"=="40" exit /b 0
if not defined SETUP_REQUIREMENTS (
    echo.
    echo ERROR: The setup selection menu did not return a valid choice.
    pause
    exit /b 1
)

:setup
if not defined SETUP_REQUIREMENTS (
    set "SETUP_SELECTION=all"
    set "SETUP_REQUIREMENTS=%REQUIREMENTS%"
)
if not exist "%SETUP_REQUIREMENTS%" (
    echo.
    echo ERROR: The selected requirements file was not found beside this launcher.
    echo Expected: "%SETUP_REQUIREMENTS%"
    pause
    exit /b 1
)

call :find_python
if errorlevel 1 goto python_missing

>"%SETUP_LOG%" echo Woobie's Mission Control setup log
>>"%SETUP_LOG%" echo Started: %DATE% %TIME%
>>"%SETUP_LOG%" echo Launcher folder: "%~dp0"
>>"%SETUP_LOG%" echo Selected components: %SETUP_SELECTION%
>>"%SETUP_LOG%" echo Requirements: "%SETUP_REQUIREMENTS%"

echo.
echo [1/3] Creating or repairing the local Python environment...
if "%BOOTSTRAP_KIND%"=="py" (
    py -3.14 -m venv "%VENV_DIR%" >>"%SETUP_LOG%" 2>&1
) else (
    "%BOOTSTRAP_PYTHON%" -m venv "%VENV_DIR%" >>"%SETUP_LOG%" 2>&1
)
if errorlevel 1 goto setup_failed

echo [2/3] Installing Mission Control dependencies...
echo       This can take a minute on the first run.
"%VENV_PYTHON%" -m pip install --disable-pip-version-check -r "%SETUP_REQUIREMENTS%" >>"%SETUP_LOG%" 2>&1
if errorlevel 1 goto setup_failed

echo [3/3] Verifying the installation...
call :launcher_ready
if errorlevel 1 goto setup_failed
if /I "%SETUP_SELECTION%"=="all" (
    call :dashboard_ready
    if errorlevel 1 goto setup_failed
    call :panel_ready
    if errorlevel 1 goto setup_failed
)
if /I "%SETUP_SELECTION%"=="dashboard" (
    call :dashboard_ready
    if errorlevel 1 goto setup_failed
)
if /I "%SETUP_SELECTION%"=="panel" (
    call :panel_ready
    if errorlevel 1 goto setup_failed
)

>>"%SETUP_LOG%" echo Completed: %DATE% %TIME%
echo.
echo Setup complete. Your system Python installation was not changed.

if defined SETUP_ONLY exit /b 0

:launch
if exist "%VENV_PYTHONW%" (
    start "" "%VENV_PYTHONW%" "%APP%"
    exit /b 0
)

if exist "%VENV_PYTHON%" (
    start "KSP Components" "%VENV_PYTHON%" "%APP%"
    exit /b 0
)

echo ERROR: The local Python environment disappeared before launch.
pause
exit /b 1

:check_only
echo Checking Woobie's Mission Control without changing any files...
echo.
call :launcher_ready
if not errorlevel 1 (
    echo READY: The local Mission Control environment is available.
    "%VENV_PYTHON%" --version
    call :dashboard_ready
    if errorlevel 1 (echo Dashboard: NOT SET UP) else (echo Dashboard: READY)
    call :panel_ready
    if errorlevel 1 (echo ESP32 Controlpad: NOT SET UP) else (echo ESP32 Controlpad: READY)
    exit /b 0
)

if exist "%VENV_PYTHON%" (
    echo INCOMPLETE: A local environment exists, but required packages are missing.
) else (
    echo NOT SET UP: No local environment exists beside this launcher.
)

call :find_python
if errorlevel 1 (
    echo Python 3.14 was not detected. No changes were made.
    exit /b 1
)

echo Python 3.14 is available for first-run setup. No changes were made.
exit /b 2

:launcher_ready
if not exist "%VENV_PYTHON%" exit /b 1
"%VENV_PYTHON%" -c "import sys, tkinter; raise SystemExit(0 if sys.version_info[:2] == (3, 14) else 1)" >nul 2>&1
exit /b %errorlevel%

:dashboard_ready
if not exist "%VENV_PYTHON%" exit /b 1
"%VENV_PYTHON%" -c "import importlib.metadata as m, krpc, websockets; expected={'krpc':'0.5.4','websockets':'16.0'}; raise SystemExit(0 if all(m.version(name) == version for name, version in expected.items()) else 1)" >nul 2>&1
exit /b %errorlevel%

:panel_ready
if not exist "%VENV_PYTHON%" exit /b 1
"%VENV_PYTHON%" -c "import importlib.metadata as m, krpc, serial; expected={'krpc':'0.5.4','pyserial':'3.5'}; raise SystemExit(0 if all(m.version(name) == version for name, version in expected.items()) else 1)" >nul 2>&1
exit /b %errorlevel%

:find_python
py -3.14 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 14) else 1)" >nul 2>&1
if not errorlevel 1 (
    set "BOOTSTRAP_KIND=py"
    exit /b 0
)

python.exe -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 14) else 1)" >nul 2>&1
if not errorlevel 1 (
    set "BOOTSTRAP_KIND=python"
    set "BOOTSTRAP_PYTHON=python.exe"
    exit /b 0
)

if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 14) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "BOOTSTRAP_KIND=path"
        set "BOOTSTRAP_PYTHON=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
        exit /b 0
    )
)

if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
    "%LOCALAPPDATA%\Python\bin\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 14) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "BOOTSTRAP_KIND=path"
        set "BOOTSTRAP_PYTHON=%LOCALAPPDATA%\Python\bin\python.exe"
        exit /b 0
    )
)

if exist "%ProgramFiles%\Python314\python.exe" (
    "%ProgramFiles%\Python314\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 14) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "BOOTSTRAP_KIND=path"
        set "BOOTSTRAP_PYTHON=%ProgramFiles%\Python314\python.exe"
        exit /b 0
    )
)

exit /b 1

:python_missing
echo.
echo ERROR: Python 3.14 was not found.
echo.
echo Install Python 3.14 from:
echo https://www.python.org/downloads/windows/
echo.
echo During installation, enable "Add python.exe to PATH", then run this
echo launcher again. Mission Control will keep its packages isolated in .venv.
pause
exit /b 1

:setup_failed
echo.
echo ERROR: Mission Control setup did not complete.
echo No system Python packages were installed or removed.
echo Review the setup log for details:
echo "%SETUP_LOG%"
echo.
echo Running this launcher again will safely retry and repair the local .venv.
pause
exit /b 1
