# 架装品500受注レポート Web版 — Claude Code 開発ガイド

このファイルは Claude Code が自動的に読み込むプロジェクト設定ファイルです。
このディレクトリ配下の Webアプリを実装・改修するときの方針をすべて記載しています。

---

## プロジェクト概要

架装品受注データの可視化・分析 Web アプリ。
Google Apps Script API または CSV ファイル経由でデータを取得し、
ブラウザ上でピボット集計・ドリルダウン分析・伝票別利益分析を行う。

**現在のビュー：**
- 分析ダッシュボード — 部店別・担当者別・顧客別のドリルダウン分析
- 一括網羅レポート — ピボットテーブル形式の月別集計
- 品番検索レポート — 品番検索による納車月別受注数追跡
- **粗利収支分析** — 伝票（案件）単位での売上・粗利の詳細確認 ⭐ 新機能

---

## 技術スタック

```
React 19 + Vite 6 + TailwindCSS 3 + lucide-react
データソース: Google Apps Script API または public/data/master_data.csv
デプロイ: Vercel
ローカルキャッシュ: IndexedDB
```

---

## 粗利収支分析ビュー（InvoiceReportView）の実装ルール

### 目的

伝票ナンバー（`documentNumber`）を単位として、1件の案件ごとに売上・粗利を確認し、
利益が取れているかどうかを可視化する。

### データ構造

**入力:** `rows` 配列（CSV 由来のレコード）
- 1 つの伝票に複数の品目行（productCode が異なる行）が含まれる

**出力:** `invoices` 配列（伝票単位に集計）
```jsx
{
  documentNumber: "11271511",        // 伝票番号
  date: "2026/4/9",                 // 受注日
  leaseCompany: "NCS",              // リース会社
  branch: "営業第二部",             // 部店
  ordererName: "松家",              // 注文者名
  customerName: "吉林製菓(株)",     // 顧客名
  sales: 152300,                    // 売上（複数行を合算）
  profit: 28600,                    // 粗利（複数行を合算）
}
```

### 実装のポイント

#### 1. 伝票ナンバーでのグループ化

```jsx
const invoices = useMemo(() => {
  const map = {};
  rows.forEach(r => {
    const docNum = r.documentNumber || r.Documentnumber || '';
    if (!docNum) return;
    if (!map[docNum]) {
      map[docNum] = {
        documentNumber: docNum,
        date: r.date || '',
        leaseCompany: r.leaseCompany || '',
        branch: r.branch || '',
        ordererName: r.ordererName || '',
        customerName: r.customerName || '',
        sales: 0,
        profit: 0,
      };
    }
    map[docNum].sales += Number(r.sales) || 0;
    map[docNum].profit += Number(r.profit) || 0;
  });
  return Object.values(map);
}, [rows]);
```

**理由:** 複数の品目行を売上・粗利で合算することで、1件の案件としての採算を把握できる。

#### 2. 連動フィルター機能

```jsx
// ① リース会社でフィルタ後のデータ
const invoicesForLease = useMemo(() => {
  if (filterLease === 'ALL') return invoices;
  return invoices.filter(inv => inv.leaseCompany === filterLease);
}, [invoices, filterLease]);

// ② リース会社フィルタ後のデータから支店を抽出
const branchOptions = useMemo(() => 
  [...new Set(invoicesForLease.map(i => i.branch).filter(Boolean))].sort(),
  [invoicesForLease]
);

// ③ 支店でもフィルタ後のデータから担当者を抽出
const invoicesForBranch = useMemo(() => {
  if (filterBranch === 'ALL') return invoicesForLease;
  return invoicesForLease.filter(inv => inv.branch === filterBranch);
}, [invoicesForLease, filterBranch]);

const ordererOptions = useMemo(() => 
  [...new Set(invoicesForBranch.map(i => i.ordererName).filter(Boolean))].sort(),
  [invoicesForBranch]
);
```

**理由:**
- ユーザーが上層で「NCS」を選択 → 下層には NCS 配下の支店のみ表示
- UX を向上させるとともに、選択肢を絞ることで操作性を改善

**注意:**
- 部店を変更するときに担当者を自動リセット（選択肢が変わるため）
  ```jsx
  onChange={e => { setFilterBranch(e.target.value); setFilterOrderer('ALL'); }}
  ```

#### 3. 粗利率フィルター

```jsx
const filteredInvoices = useMemo(() => {
  const maxMgn = maxMarginInput !== '' ? parseFloat(maxMarginInput) : null;
  return invoices.filter(inv => {
    // ... 他のフィルター処理 ...
    if (maxMgn !== null) {
      const mgn = inv.sales > 0 ? (inv.profit / inv.sales) * 100 : null;
      if (mgn === null || mgn > maxMgn) return false;
    }
    return true;
  });
}, [invoices, filterLease, filterBranch, filterOrderer, filterCustomer, maxMarginInput]);
```

**用途:**
- `10` 入力 → 粗利率 10%以下の案件を表示（低粗利案件の発見）
- `0` 入力 → 赤字案件のみ表示
- `-1` 入力 → 大幅赤字案件のみ表示

#### 4. CSV 出力

```jsx
const handleExportCsv = () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['受注日', '伝票ナンバー', 'リース会社', '部店', 
                   '注文者', '顧客名', '売上金額', '粗利金額', '粗利率(%)'];
  const lines = [headers.map(q).join(',')];
  sortedInvoices.forEach(inv => {
    const dateStr = typeof inv.date === 'string' ? inv.date.split(' ')[0] : inv.date;
    const mgn = inv.sales > 0 ? ((inv.profit / inv.sales) * 100).toFixed(1) : '';
    lines.push([
      q(dateStr), q(inv.documentNumber), q(inv.leaseCompany), q(inv.branch),
      q(inv.ordererName), q(inv.customerName),
      Math.round(inv.sales), Math.round(inv.profit), mgn,
    ].join(','));
  });
  const csv = lines.join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  // ... ダウンロード処理 ...
};
```

**理由:** 現在のフィルター・ソート状態をそのまま CSV で出力することで、確認した分析結果をそのまま外部に展開できる。

#### 5. テキスト選択機能

```jsx
const handleCellDoubleClick = (e) => {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(e.currentTarget);
  selection.removeAllRanges();
  selection.addRange(range);
};

// テーブルセル
<td className="... select-text cursor-text ..." onDoubleClick={handleCellDoubleClick}>
  {inv.documentNumber}
</td>
```

**理由:** 伝票番号・顧客名をダブルクリックで選択 → Ctrl+C でコピーできる。
他のシステムへの入力時の利便性を向上。

#### 6. UI・レイアウト

**サマリーカード（4列）:**
- 伝票件数（赤背景） + 合計売上 + 合計粗利 + 平均粗利率
- モバイル時は `grid-cols-2` で 2×2 配置
- デスクトップ時は `grid-cols-4` で 1 行表示

**テーブル：**
- ヘッダーはスタイク色（濃紺）で固定
- ソート可能（全カラム）
- 赤字案件は背景ピンク
- 粗利率 10%未満はオレンジバッジ

**注意点：**
- このビュー表示時は「金額単位」「粗利表示」「顧客検索」の設定項目を非表示
  ```jsx
  {viewMode !== 'invoice_report' && (
    // 金額単位・粗利表示・顧客検索のセクション
  )}
  ```

---

## よくある作業

### 新しいフィルター項目を追加する

1. `useState` で state を追加
   ```jsx
   const [filterXxx, setFilterXxx] = useState('ALL');
   ```

2. フィルター選択肢を `useMemo` で生成
3. `filteredInvoices` の filter 関数に条件追加
4. フィルターバーに UI を追加

### CSV カラムを追加する

1. `handleExportCsv` の `headers` 配列に追加
2. `lines.push([ ... ])` の対応する値を追加
3. テーブルのヘッダーと tbody にも列を追加

### ソート機能を追加する

`sortKey` の useMemo 内で `sortedInvoices` をソート。
各カラムヘッダーに `<SortBtn col="columnName" />` を追加。

---

## 注意事項

### CSV に伝票番号がない場合

- CSV ヘッダーが `Documentnumber`（大文字 N）の場合、`csvLoader.js` で `documentNumber`（キャメルケース）にマッピング済み
- 万が一別名の場合は、`invoices` 作成部分で対応を追加する

### パフォーマンス

- 現在データは 60万行規模だが、伝票単位に集計後は数千件程度
- `useMemo` を活用してムダな再計算を防止
- 大規模なフィルター追加時は `console.time()` で性能を確認

---

## コマンドリファレンス

```bash
npm run dev      # 開発サーバー起動（localhost:5173）
npm run build    # プロダクションビルド
npm run preview  # ビルド結果の動作確認
npm run lint     # ESLint チェック
```

