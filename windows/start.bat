@echo off
REM agentchattr — starts the server only
cd /d "%~dp0.."

call "%~dp0common.bat" || exit /b 1

uv run --project . python run.py
echo.
echo === Server exited with code %ERRORLEVEL% ===
pause
