@echo off
REM =============================================================================
REM  マスタデータ更新プッシュ.bat（架装品 500 WEB）
REM
REM  目的:
REM    public/data/master_data.csv の変更だけをコミットし、GitHub main へ push
REM    する（Vercel 連携で本番反映）。
REM
REM  手順の考え方:
REM   1) CSV に差分があることだけ確認
REM   2) その CSV だけをコミット
REM   3) push 前に git pull --rebase でリモートの先行コミットを取り込む
REM      → 「rejected (fetch first)」を防ぐ。他ファイルの未コミット変更があると
REM        rebase が失敗することがある。その場合は git stash -u 後に再実行。
REM   4) git push origin main
REM =============================================================================
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

echo [1/4] Checking changed files...
git status public/data/master_data.csv
echo.

REM Get today's date via temp file
powershell -NoProfile -Command "Get-Date -Format 'yyyy/MM/dd' | Out-File '%~dp0_date_tmp.txt' -Encoding ASCII -NoNewline"
set /p TODAY=<"%~dp0_date_tmp.txt"
del "%~dp0_date_tmp.txt" > nul 2>&1

echo Commit message: data: master_data.csv updated %TODAY%
echo.

echo [2/4] Committing...
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
REM リモートだけが進んでいると素の push が拒否されるため、必ずこの直後に push する
echo [3/4] Pulling latest from GitHub ^(before push^)...
git pull --rebase origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Pull failed. Other uncommitted files may block rebase.
    echo         Try: git stash -u
    echo         Then run this script again ^(stash pop after success if needed^).
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

echo.
echo [4/4] Pushing to GitHub...
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
