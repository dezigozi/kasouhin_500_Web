@echo off
setlocal
REM ============================================================
REM  Master Data Push - kasouhin_500_Web
REM ------------------------------------------------------------
REM  WHAT THIS DOES:
REM    Commits ONLY public/data/master_data.csv and pushes it
REM    to origin/main. Vercel then auto-deploys from GitHub.
REM
REM  HOW TO USE:
REM    1. Overwrite public/data/master_data.csv with the new CSV.
REM    2. Double-click this .bat.
REM    3. Wait for "Done". The site updates in a few minutes.
REM
REM  NOTES:
REM    - ASCII-only on purpose (avoids cmd.exe mojibake).
REM    - Only the CSV is committed; any other changed files are
REM      left untouched.
REM ============================================================
cd /d "%~dp0"

echo =========================================
echo  Kasouhin 500 - Master Data Push
echo =========================================
echo.

REM --- Step 0: abort early if the CSV has no changes ---
git diff --quiet -- public/data/master_data.csv
if errorlevel 1 goto has_changes
echo [NO CHANGES] public/data/master_data.csv is not modified.
echo Please update the CSV first.
goto end_error

:has_changes
REM --- Step 1/4: show exactly which file will be committed ---
echo [1/4] Changed file:
git status --short public/data/master_data.csv
echo.

REM Build today's date (yyyy-MM-dd) for the commit message
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i

REM --- Step 2/4: stage ONLY the CSV, then commit it ---
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
REM --- Step 3/4: sync with remote first (rebase keeps history linear) ---
echo [3/4] Pull rebase from origin main...
git pull --rebase origin main
if errorlevel 1 (
    echo [ERROR] Pull failed. Uncommitted changes may block rebase.
    echo Try: git stash -u
    echo Then run this script again.
    goto end_error
)

echo.
REM --- Step 4/4: push to GitHub, which triggers the auto-deploy ---
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
