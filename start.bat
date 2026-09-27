@echo off
rem Double-click to start Tin Whistle Scores. Sets itself up on the first run.
title Tin Whistle Scores
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Setting up for the first time...
    where py >nul 2>nul
    if not errorlevel 1 (
        py -3 -m venv .venv
    ) else (
        python -m venv .venv
    )
    if not exist ".venv\Scripts\python.exe" (
        echo.
        echo ERROR: Could not find Python. Install it from https://www.python.org/downloads/
        echo and tick "Add python.exe to PATH" during installation, then try again.
        pause
        exit /b 1
    )
)

".venv\Scripts\python.exe" run.py %*
echo.
pause
