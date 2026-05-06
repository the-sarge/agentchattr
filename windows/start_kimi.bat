@echo off
REM agentchattr — starts server (if not running) + Kimi wrapper
cd /d "%~dp0.."

call "%~dp0common.bat" || exit /b 1

REM Pre-flight: check that kimi CLI is installed
where kimi >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Error: "kimi" was not found on PATH.
    echo   Install it first, then try again.
    echo.
    pause
    exit /b 1
)

REM Start server if not already running, then wait for it
netstat -ano | findstr :8300 | findstr LISTENING >nul 2>&1
if %errorlevel% neq 0 (
    start "agentchattr server" cmd /c "uv run --project . python run.py"
)
:wait_server
netstat -ano | findstr :8300 | findstr LISTENING >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 1 /nobreak >nul
    goto :wait_server
)

uv run --project . python wrapper.py kimi
if %errorlevel% neq 0 (
    echo.
    echo   Agent exited unexpectedly. Check the output above.
    pause
)
