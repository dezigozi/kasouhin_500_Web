@echo off
cd /d "%~dp0"

echo =========================================
echo  Kasouhin 500 - Master Data Push
echo =========================================
echo.

REM Check if master_data.csv has changes
git diff --quiet -- public/data/master_data.csv
if %errorlevel% == 0 (
    echo [NO CHANGES] master_data.csv has not been modified.
    echo              Please update the CSV file first.
    echo.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

echo [1/3] Checking changed files...
git status public/data/master_data.csv
echo.

REM Get today's date via temp file
powershell -NoProfile -Command "Get-Date -Format 'yyyy/MM/dd' | Out-File '%~dp0_date_tmp.txt' -Encoding ASCII -NoNewline"
set /p TODAY=<"%~dp0_date_tmp.txt"
del "%~dp0_date_tmp.txt" > nul 2>&1

echo Commit message: data: master_data.csv updated %TODAY%
echo.

echo [2/3] Committing...
git add public/data/master_data.csv
git commit -m "data: master_data.csv updated %TODAY%"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Commit failed.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

echo.
echo [3/3] Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Push failed.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

echo.
echo =========================================
echo  Done! Vercel will build and deploy now.
echo  The date on the page will update in a few minutes.
echo =========================================
echo.
echo Press any key to exit...
pause > nul
