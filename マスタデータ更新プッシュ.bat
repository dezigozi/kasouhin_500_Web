@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo =========================================
echo  架装品500 マスタデータ 更新プッシュ
echo =========================================
echo.

REM master_data.csv に変更があるか確認
git diff --quiet -- public/data/master_data.csv
if %errorlevel% == 0 (
    echo [!] master_data.csv に変更が見つかりません。
    echo     CSVファイルを更新してから実行してください。
    echo.
    pause
    exit /b 1
)

echo [1/3] 変更ファイルを確認中...
git status public/data/master_data.csv
echo.

REM 今日の日付でコミットメッセージを作成
for /f "tokens=1-3 delims=/ " %%a in ('powershell -Command "Get-Date -Format 'yyyy/MM/dd'"') do set TODAY=%%a
set TODAY=%TODAY%
powershell -Command "$d = Get-Date -Format 'yyyy/MM/dd'; Write-Host \"コミットメッセージ: data: master_data.csv 更新 $d\""
echo.

echo [2/3] コミット中...
git add public/data/master_data.csv
git commit -m "data: master_data.csv 更新 %TODAY%"
if %errorlevel% neq 0 (
    echo [ERROR] コミットに失敗しました。
    pause
    exit /b 1
)

echo.
echo [3/3] GitHubにプッシュ中...
git push origin main
if %errorlevel% neq 0 (
    echo [ERROR] プッシュに失敗しました。
    pause
    exit /b 1
)

echo.
echo =========================================
echo  完了！Vercelが自動でビルド・デプロイします。
echo  数分後に画面の日付が更新されます。
echo =========================================
echo.
pause
