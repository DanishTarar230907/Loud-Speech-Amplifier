@echo off
echo ========================================================
echo   Real-Time Noise Suppression Prototype Setup Runner
echo ========================================================
echo.

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.10+ from the Microsoft Store:
    echo ms-windows-store://pdp/?productid=9PJPW5LDXLZ5
    echo Or download from: https://www.python.org/downloads/
    echo.
    pause
    exit /b
)

echo [OK] Python is installed.
echo Setting up virtual environment...
if not exist "venv" (
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing requirements...
pip install -r requirements.txt

echo.
echo ========================================================
echo   WARNING: AUDIO FEEDBACK LOOP RISK
echo ========================================================
echo Please ensure you are wearing HEADPHONES (earbuds or air-birds). 
echo If you use your laptop speakers, the output will feed 
echo directly back into your microphone, causing a very loud 
echo screeching sound.
echo.
pause

echo.
echo Starting Noise Suppression...
python noise_suppression.py

pause
