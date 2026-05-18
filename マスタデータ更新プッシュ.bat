@echo off
setlocal
REM Master data push for kasouhin_500_Web (ASCII-only for cmd.exe)
cd /d "%~dp0"

echo =========================================
echo  Kasouhin 500 - Master Data Push
echo =========================================
echo.

git diff --quiet -- public/data/master_data.csv
if errorlevel 1 goto has_changes
echo [NO CHANGES] public/data/master_data.csv is not modified.
echo Please update the CSV first.
goto end_error

:has_changes
echo [1/4] Changed file:
git status --short public/data/master_data.csv
echo.

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i

echo [2/4] Committing...
git add public/data/master_data.csv
> "%TEMP%\kasouhin500_commitmsg.txt" echo data master_data.csv updated %TODAY%
git commit -F "%TEMP%\kasouhin500_commitmsg.txt"
del "%TEMP%\kasouhin500_commitmsg.txt" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Commit failed.
    goto end_error
)

echo.
echo [3/4] Pull rebase from origin main...
git pull --rebase origin main
if errorlevel 1 (
    echo [ERROR] Pull failed. Uncommitted changes may block rebase.
    echo Try: git stash -u
    echo Then run this script again.
    goto end_error
)

echo.
echo [4/4] Push to origin main...
git push origin main
if errorlevel 1 (
    echo [ERROR] Push failed.
    goto end_error
)

echo.
echo =========================================
echo  Done. Vercel will deploy in a few minutes.
echo =========================================
echo.
pause
exit /b 0

:end_error
echo.
pause
exit /b 1
