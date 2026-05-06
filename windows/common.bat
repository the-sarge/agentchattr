@echo off
where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Error: uv was not found on PATH.
    echo   Install uv, then try again: https://docs.astral.sh/uv/getting-started/installation/
    echo.
    pause
    exit /b 1
)
exit /b 0
