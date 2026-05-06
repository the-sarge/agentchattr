@echo off
REM agentchattr — starts server (if not running) + MiniMax API agent wrapper
REM Usage: start_minimax.bat
REM Requires MINIMAX_API_KEY environment variable.
cd /d "%~dp0.."

call "%~dp0common.bat" || exit /b 1

REM Check API key
if "%MINIMAX_API_KEY%"=="" (
    echo.
    echo   Error: MINIMAX_API_KEY environment variable is not set.
    echo   Get an API key at https://platform.minimax.io
    echo   Then: set MINIMAX_API_KEY=your-key-here
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

uv run --project . python wrapper_api.py minimax
if %errorlevel% neq 0 (
    echo.
    echo   Agent exited unexpectedly. Check the output above.
    pause
)
