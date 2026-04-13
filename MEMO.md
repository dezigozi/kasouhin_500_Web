# 架装品 500受注レポート — 開発メモ

最終更新: 2026-04-13

---

## 概要

- **構成**: CSV ファイル（`public/data/master_data.csv`）+ Vite/React + Vercel デプロイ
- **GAS 連携なし**（`VITE_GAS_URL` を空にしておけば CSV モードで動作）
- **タイトル**: 架装品 500受注レポート
- **UI テーマ**: 赤基調（`red`）

---

## 表の仕様

- 列: **直近6ヶ月（カレンダー月）＋「計」** 列
- フィルター: リース会社選択・金額単位（円／千円）・粗利表示 ON/OFF
- 階層ドリルダウン: 部店 → 注文者 → 顧客（または 部店 → 顧客 → 注文者）

---

## CSV フォーマット

### 列順（英語ヘッダー）
```
leaseCompany, branch, ordererName, customerName, productCode, productName, quantity, sales, profit, date
```

### 日本語ヘッダーも自動認識（`csvLoader.js` でマッピング済み）

| 日本語ヘッダー例 | 内部キー |
|---|---|
| リース会社 / リース会社名 | leaseCompany |
| 部店 / 部店名 / 営業部店 | branch |
| 注文者 / 注文者名 / 担当者 | ordererName |
| 顧客 / 顧客名 / お客様名 | customerName |
| 品番 / 製品コード | productCode |
| 品名 / 製品名 / 商品名 | productName |
| 数量 / qty | quantity |
| 売上 / 売上金額 / 受注金額 | sales |
| 粗利 / 粗利金額 | profit |
| 受注日 / 納車日 / 日付 | date |

### `date` 列の形式（どちらも対応）
- 文字列: `2026/3/20`、`2026-03-20`
- Excel シリアル値: `46048` 等

> `fiscalYear`（年度）・`month`（月）列は不要。`date` から自動算出。

---

## ローカル起動方法

```bash
cd 500/web
npm run dev
# → http://localhost:5173/（ポート競合時は 5174, 5175… と自動選択）
```

---

## デプロイ（Vercel）

- `vercel.json` 配置済み（SPA ルーティング対応）
- `500/web` ディレクトリを Vercel のルートに指定してデプロイ
- 環境変数:
  - `VITE_PASSWORD`: ログインパスワード（空なら認証なし）
  - `VITE_GAS_URL`: GAS 連携 URL（空なら CSV モード）

---

## 注意事項

- **ファイルロック**: `master_data.csv` は Dropbox 共有フォルダ内のため、誰かが Excel で開いていると書き換えできない（高野さんなど）
- `npm run build` は Windows ローカルで失敗することがある（既知問題）→ Vercel の CI でビルドするのが現実的
- ESLint は `npm run lint` で確認（exit 0 を維持すること）
