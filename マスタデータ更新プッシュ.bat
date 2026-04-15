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
    echo [変更なし] master_data.csv に変更が見つかりません。
    echo           CSVファイルを更新してから実行してください。
    echo.
    echo 何かキーを押すと閉じます...
    pause > nul
    exit /b 1
)

echo [1/3] 変更ファイルを確認中...
git status public/data/master_data.csv
echo.

REM 今日の日付を取得（一時ファイル経由）
powershell -NoProfile -Command "Get-Date -Format 'yyyy/MM/dd' | Out-File '%~dp0_date_tmp.txt' -Encoding ASCII -NoNewline"
set /p TODAY=<"%~dp0_date_tmp.txt"
del "%~dp0_date_tmp.txt" > nul 2>&1

echo コミットメッセージ: data: master_data.csv 更新 %TODAY%
echo.

echo [2/3] コミット中...
git add public/data/master_data.csv
git commit -m "data: master_data.csv 更新 %TODAY%"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] コミットに失敗しました。
    echo 何かキーを押すと閉じます...
    pause > nul
    exit /b 1
)

echo.
echo [3/3] GitHubにプッシュ中...
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] プッシュに失敗しました。
    echo 何かキーを押すと閉じます...
    pause > nul
    exit /b 1
)

echo.
echo =========================================
echo  完了！Vercelが自動でビルド・デプロイします。
echo  数分後に画面の日付が更新されます。
echo =========================================
echo.
echo 何かキーを押すと閉じます...
pause > nul
