@echo off
REM agentchattr — starts server (if not running) + Qwen wrapper
cd /d "%~dp0.."

call "%~dp0common.bat" || exit /b 1

REM Pre-flight: check that qwen CLI is installed
where qwen >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Error: "qwen" was not found on PATH.
    echo   Install it first: npm install -g @qwen-code/qwen-code
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

uv run --project . python wrapper.py qwen -i "When asked for a reply or to answer, YOU MUST USE the mcp of agentchattr. When talking about a chat, we are speaking about interaction with tools provided by mcp of agentchattr. The human NEVER SEES your usual CLI interface. Just consider this, other instructions will follow."
if %errorlevel% neq 0 (
    echo.
    echo   Agent exited unexpectedly. Check the output above.
    pause
)
