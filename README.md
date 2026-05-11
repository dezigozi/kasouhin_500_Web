# 架装品 500 受注レポート（Web）

Google スプレッドシート由来の受注 CSV を読み込み、部店・担当・顧客・品番などでドリルダウン集計する社内向けダッシュボードです。デプロイ先の例: [kasouhin-500-web.vercel.app](https://kasouhin-500-web.vercel.app)

## 技術スタック

- React 19 + Vite 6 + Tailwind CSS 3 + lucide-react
- データ: `public/data/master_data.csv`（既定）または GAS Web アプリ（`VITE_GAS_URL`）
- ローカルキャッシュ: IndexedDB（`src/utils/db.js`）

## 環境変数（`.env`）

| 変数名 | 説明 |
|--------|------|
| `VITE_PASSWORD` | 任意。ログインパスワード（未設定なら認証スキップ） |
| `VITE_GAS_URL` | 任意。GAS の Web アプリ URL（未設定なら CSV のみ） |

## セットアップ

```bash
npm install
npm run dev
```

ビルド確認:

```bash
npm run build
```

Dropbox 配下でキャッシュ競合が出る場合は `vite.config.js` の `cacheDir` 設定を利用してください（親ディレクトリの開発ガイド参照）。

## データの置き方

- UTF-8（BOM なし）の `master_data.csv` を `public/data/` に配置
- カラムの日本語ヘッダーは `src/utils/csvLoader.js` の `HEADER_MAP` で英語キーに正規化されます

## 集計と品番（K-O / N-）の扱い

マスタ CSV の売上合計と画面の合計を揃えるため、次のように分けています。

- **品番を行として表示しない画面**（部店別・担当・顧客の集計、ピボットの土台など）  
  **全品番を含めます**（`K-O` / `N-` で始まる品番も金額に含む）。マスタの売上列の合計と整合します。

- **品番を行として表示する画面**（品番別ドリルダウン、品番検索の一覧、分析ダッシュボード CSV の品番列など）  
  **`K-O` / `N-` で始まる品番は行として出しません**（調整・作業行などを一覧から隠すため）。  
  このため、**分析ダッシュボード CSV の売上合計だけ**はマスタ全行の合計より小さくなる場合があります。

判定ロジックは `src/utils/aggregator.js` の `hideProductCodeInDetail` を参照してください。

## リポジトリ

GitHub: [dezigozi/kasouhin_500_Web](https://github.com/dezigozi/kasouhin_500_Web)
