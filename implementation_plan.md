# 500/web 実装計画書
## 概要: GAS/Cloudflare → CSV/Vercel 仕様変更

---

## 変更方針

| 項目 | 変更前 | 変更後 |
|------|-------|-------|
| データソース | Google Spreadsheet API (GAS) | CSV ファイル |
| デプロイ | Cloudflare Pages | Vercel |
| テーブル集計 | 月別（直近3ヶ月） | 年度別（全年度比較） |
| グラフ (recharts) | あり | 削除 |
| 顧客検索機能 | なし | 追加 |
| モバイルレスポンシブ | なし | 追加 |

---

## ファイル別 変更内容

### 1. src/utils/csvLoader.js — 新規作成

売上/WEB の src/utils/csvLoader.js をそのままコピーする。

コピー元: 売上/WEB/src/utils/csvLoader.js
コピー先: 500/web/src/utils/csvLoader.js

内容:
- loadCsvData(): public/data/master_data.csv を fetch して parseCsv に渡す
- parseCsv(): ヘッダー行 + データ行をパース、数値は自動変換
- parseDate(): date カラムから fiscalYear・month を自動計算（YYYY/M/D と Excelシリアル両対応）
- parseCSVLine(): ダブルクォート対応の CSV 行パーサー

---

### 2. src/utils/aggregator.js — 全面置換

売上/WEB の src/utils/aggregator.js をそのままコピーする。

コピー元: 売上/WEB/src/utils/aggregator.js
コピー先: 500/web/src/utils/aggregator.js

削除される関数（月別集計）:
- aggregateByBranchByMonth
- aggregateByOrdererByMonth
- aggregateByCustomerByMonth
- aggregateByCustomerInBranchByMonth
- aggregateByOrdererForCustomerByMonth
- aggregateByProductByMonth
- generatePivotDataByMonth

売上/WEB の aggregator.js に含まれる全関数（これに置換）:
- filterRows
- aggregateByBranch
- aggregateByOrderer
- aggregateByCustomer
- aggregateByCustomerInBranch
- aggregateByOrdererForCustomer
- aggregateByProductByYear
- aggregateByProductForCustomer  ← 顧客検索用
- aggregateByProductInBranch     ← 品番直接表示用
- generatePivotData
- calcYoY / calcMargin / formatCurrency / formatCurrencyFull
- normalizeJapanese / searchCustomers  ← 顧客検索用
- generateCsvContent

---

### 3. src/App.jsx — 全面置換

売上/WEB の src/App.jsx をそのままコピーする。

コピー元: 売上/WEB/src/App.jsx
コピー先: 500/web/src/App.jsx

コピー後に手動修正が必要な箇所:

[修正1] キャッシュキーを変更
  変更前: const CACHE_KEY = 'kasouhin_uriage_data_v1';
  変更後: const CACHE_KEY = 'kasouhin_500_data_v1';

[修正2] パスワード認証
  売上/WEB と同じ VITE_PASSWORD 環境変数方式をそのまま使用。
  Vercel ダッシュボードで VITE_PASSWORD を設定する。
  （500/web のハードコードパスワード '19627004' は削除される）

---

### 4. src/App.css — 削除

500/web の src/App.css は不要（売上/WEB には存在しない）。
src/main.jsx 内の「import './App.css'」の行も削除する。

  削除: 500/web/src/App.css
  修正: 500/web/src/main.jsx から import './App.css' を削除

---

### 5. package.json — 依存関係を更新

recharts と @emnapi を削除する。

変更前:
  "dependencies": {
    "@emnapi/core": "^1.9.2",
    "@emnapi/runtime": "^1.9.2",
    "lucide-react": "^1.8.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "recharts": "^3.8.1"
  }

変更後:
  "dependencies": {
    "lucide-react": "^1.8.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  }

package.json 編集後に npm install を実行。

---

### 6. vite.config.js — シンプル化

Cloudflare 用の設定（cacheDir を tmpdir に変更）を削除する。

変更後:
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
  })

---

### 7. vercel.json — 新規作成

Vercel で SPA を正しくホストするための設定。

  {
    "rewrites": [
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  }

---

### 8. .env — 新規作成（ローカル開発用）

  # パスワード認証（未設定の場合は認証スキップ）
  VITE_PASSWORD=

  # GAS URL（CSV運用のため不要 → 空欄のまま）
  VITE_GAS_URL=

.gitignore に .env が含まれていることを確認する。

---

### 9. public/data/master_data.csv — 新規作成

売上/WEB の CSV フォーマットに合わせたデータファイルを配置する。

必須カラム（ヘッダー行）:

  leaseCompany,branch,ordererName,customerName,productCode,productName,quantity,sales,profit,fiscalYear,month

または date カラムがある場合は csvLoader.js が自動で fiscalYear / month を計算する:

  leaseCompany,branch,ordererName,customerName,productCode,productName,quantity,sales,profit,date

注意:
- 文字コードは UTF-8 (BOMなし) で保存
- 数値カラム（sales, profit, quantity, fiscalYear, month）は数値として保存
- 空欄の場合は空文字でOK

---

## 作業手順（順番）

1.  src/utils/csvLoader.js を売上/WEB からコピー（新規作成）
2.  src/utils/aggregator.js を売上/WEB からコピー（全面置換）
3.  src/App.jsx を売上/WEB からコピー（全面置換）
4.  src/App.jsx のキャッシュキーを kasouhin_500_data_v1 に変更
5.  src/App.css を削除
6.  src/main.jsx から import './App.css' を削除
7.  package.json から recharts・@emnapi を削除
8.  npm install を実行
9.  vite.config.js を上記のシンプル版に置換
10. vercel.json を新規作成
11. .env を新規作成（ローカル開発用）
12. public/data/master_data.csv を配置
13. npm run dev でローカル動作確認
14. npm run build でビルド確認
15. GitHub にプッシュ
16. Vercel でリポジトリをインポート → 環境変数 VITE_PASSWORD を設定してデプロイ

---

## Vercel デプロイ設定

| 設定項目 | 値 |
|---------|---|
| Framework Preset | Vite |
| Build Command | npm run build |
| Output Directory | dist |
| Root Directory | 500/web（リポジトリルートでなければ指定） |
| 環境変数 | VITE_PASSWORD=任意のパスワード |

---

## CSV の用意方法（GAS スプレッドシートから）

1. Google スプレッドシートを開く
2. ファイル > ダウンロード > カンマ区切り (.csv) を選択
3. ファイルを public/data/master_data.csv として配置
4. 文字コードが UTF-8 であることを確認（Shift-JIS の場合は変換が必要）

カラム名が日本語の場合: csvLoader.js の parseCsv() 内でマッピングを追加:

  const COLUMN_MAP = {
    'リース会社': 'leaseCompany',
    '部店': 'branch',
    '注文者': 'ordererName',
    '顧客名': 'customerName',
    '品番': 'productCode',
    '品目': 'productName',
    '数量': 'quantity',
    '売上': 'sales',
    '粗利': 'profit',
  };

  // parseCsv() の headers 取得後に追加:
  const mappedHeaders = headers.map(h => COLUMN_MAP[h] || h);
  // 以降は mappedHeaders を headers の代わりに使う

---

## 参照ファイル

- 売上/WEB App.jsx:       E:\Dropbox\...\架装品実績レポート\売上\WEB\src\App.jsx
- 売上/WEB aggregator.js: E:\Dropbox\...\架装品実績レポート\売上\WEB\src\utils\aggregator.js
- 売上/WEB csvLoader.js:  E:\Dropbox\...\架装品実績レポート\売上\WEB\src\utils\csvLoader.js
