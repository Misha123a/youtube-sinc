@echo off
setlocal
cd /d "%~dp0"
title Sync Music

echo.
echo ========================================
echo          Sync Music Launcher
echo ========================================
echo.

set "PYTHON_CMD="
where py >nul 2>nul && set "PYTHON_CMD=py"
if not defined PYTHON_CMD (
    where python >nul 2>nul && set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
    echo [ERROR] Python ne nayden.
    echo Ustanovi Python 3.11 ili novee s https://www.python.org/downloads/
    echo Pri ustanovke obyazatelno vklyuchi "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

echo [1/4] Python:
%PYTHON_CMD% --version
if errorlevel 1 goto :error

if not exist "requirements.txt" (
    echo [ERROR] requirements.txt ne nayden ryadom s run.bat.
    echo Raspakuy ves arhiv v odnu papku i zapusti run.bat ottuda.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [2/4] Sozdayu virtualnoe okruzhenie...
    %PYTHON_CMD% -m venv .venv
    if errorlevel 1 goto :error
) else (
    echo [2/4] Virtualnoe okruzhenie uzhe est.
)

echo [3/4] Ustanavlivayu zavisimosti...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo [4/4] Zapuskayu Sync Music...
echo Otkroy v brauzere: http://localhost:8000
echo Dlya ostanovki nazhmi Ctrl+C.
echo.
start "" http://localhost:8000
".venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo [ERROR] Zapusk zavershilsya s oshibkoy.
echo Skopiruy tekst oshibki iz etogo okna i otprav mne.
echo.
pause
exit /b 1
