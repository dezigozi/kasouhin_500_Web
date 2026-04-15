/**
 * CSV ローダー
 * public/data/master_data.csv から 60万行のデータを読み込み
 */

/**
 * 日本語ヘッダー → 英語キー マッピング
 * 表記ゆれ（全角スペース・半角スペース・括弧違い等）も網羅
 */
const HEADER_MAP = {
  // leaseCompany
  'リース会社':           'leaseCompany',
  'リース会社名':         'leaseCompany',
  'lease会社':            'leaseCompany',
  'leasecompany':         'leaseCompany',
  // branch
  '部店':                 'branch',
  '部店名':               'branch',
  '営業部店':             'branch',
  'branch':               'branch',
  // ordererName
  '注文者':               'ordererName',
  '注文者名':             'ordererName',
  '担当者':               'ordererName',
  '担当者名':             'ordererName',
  'orderername':          'ordererName',
  // customerName
  '顧客':                 'customerName',
  '顧客名':               'customerName',
  'お客様名':             'customerName',
  'customername':         'customerName',
  // productCode
  '品番':                 'productCode',
  '品番コード':           'productCode',
  '製品コード':           'productCode',
  'productcode':          'productCode',
  // productName
  '品名':                 'productName',
  '製品名':               'productName',
  '商品名':               'productName',
  'productname':          'productName',
  // quantity
  '数量':                 'quantity',
  'qty':                  'quantity',
  'quantity':             'quantity',
  // sales
  '売上':                 'sales',
  '売上金額':             'sales',
  '売上額':               'sales',
  '受注金額':             'sales',
  'sales':                'sales',
  // profit
  '粗利':                 'profit',
  '粗利金額':             'profit',
  '粗利額':               'profit',
  'profit':               'profit',
  // date
  '受注日':               'date',
  '納車日':               'date',
  '日付':                 'date',
  '年月日':               'date',
  'date':                 'date',
  // deliverydate（納車年月日）
  '納車年月':             'deliverydate',
  '納車年月日':           'deliverydate',
  'deliverydate':         'deliverydate',
  'deliveryday':          'deliverydate',
  // documentNumber（伝票番号）
  '伝票番号':             'documentNumber',
  'documentnumber':       'documentNumber',
  'document_number':      'documentNumber',
  // car（車種）
  'car':                  'car',
  '車種':                 'car',
  '車名':                 'car',
  // status（ステータス）
  'status':               'status',
  'ステータス':           'status',
  'status番号':           'status',
  // 旧形式互換
  'fiscalyear':           'fiscalYear',
  '会計年度':             'fiscalYear',
  '年度':                 'fiscalYear',
  'month':                'month',
  '月':                   'month',
};

/** ヘッダー文字列を正規化してキーに変換 */
function normalizeHeader(raw) {
  const key = raw
    .trim()
    .replace(/\s+/g, '')        // 空白除去
    .replace(/\u3000/g, '')     // 全角スペース除去
    .toLowerCase();
  return HEADER_MAP[key] || raw.trim();
}

export async function loadCsvData() {
  try {
    const response = await fetch('/data/master_data.csv');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csv = await response.text();
    return parseCsv(csv);
  } catch (err) {
    console.error('CSV 読み込みエラー:', err);
    throw err;
  }
}

/**
 * CSV テキストをパース
 */
function parseCsv(csv) {
  const lines = csv.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  // ヘッダー行を取得（日本語→英語キーに正規化）
  const headers = parseCSVLine(lines[0]).map(normalizeHeader);
  const rows = [];

  // データ行をパース
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};

    headers.forEach((header, idx) => {
      const value = values[idx]?.trim() || '';
      // 数値に変換を試みる
      const numVal = Number(value);
      row[header] = isNaN(numVal) || value === '' ? value : numVal;
    });

    // date カラムから fiscalYear と month を自動計算
    if (row.date && !row.fiscalYear && !row.month) {
      const dateInfo = parseDate(row.date);
      if (dateInfo) {
        row.fiscalYear = dateInfo.fiscalYear;
        row.month = dateInfo.month;
      }
    }

    // deliverydate カラムから deliveryYM（"26年4月" 形式）と deliverySortKey を生成
    if (row.deliverydate) {
      const dInfo = parseDate(row.deliverydate);
      if (dInfo) {
        const calYear = dInfo.month >= 4 ? dInfo.fiscalYear : dInfo.fiscalYear + 1;
        const shortYear = calYear % 100;
        row.deliveryYM = `${shortYear}年${dInfo.month}月`;
        row.deliverySortKey = calYear * 100 + dInfo.month;
      }
    }

    // 月別表示用: 西暦年（年度+月から算出。4月〜＝当年度、1〜3月＝翌年）
    if (
      (row.calendarYear === '' || row.calendarYear == null) &&
      row.fiscalYear != null && row.month != null
    ) {
      const fy = Number(row.fiscalYear);
      const m = Number(row.month);
      if (!Number.isNaN(fy) && !Number.isNaN(m)) {
        row.calendarYear = m >= 4 ? fy : fy + 1;
      }
    }

    rows.push(row);
  }

  // 年度とリース会社を抽出
  const yearsSet = new Set();
  const leaseSet = new Set();

  rows.forEach(r => {
    if (r.fiscalYear) yearsSet.add(Number(r.fiscalYear));
    if (r.leaseCompany) leaseSet.add(r.leaseCompany);
  });

  return {
    rows,
    years: Array.from(yearsSet).sort((a, b) => a - b),
    leaseCompanies: Array.from(leaseSet).sort(),
  };
}

/**
 * 日付をパースして fiscalYear と month を計算
 * テキスト形式 (YYYY/M/D, YYYY-M-D) とシリアル番号に対応
 */
function parseDate(dateValue) {
  // テキスト形式: "2026/3/31" または "2026-03-31" または "2026/3/31 15:50"（時刻付き）
  if (typeof dateValue === 'string') {
    // 時刻部分（スペース以降）を除去してから分割
    const datePart = dateValue.split(' ')[0];
    const parts = datePart.split(/[-/]/).map(Number);
    if (parts.length === 3) {
      const [year, month, day] = parts;
      if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const fiscalYear = month >= 4 ? year : year - 1;
        return { fiscalYear, month };
      }
    }
  }

  // シリアル番号: 44930 → 日付に変換
  if (typeof dateValue === 'number' && dateValue > 0) {
    // Excelシリアル日付をJavaScript Dateに変換
    // Excelは1900年1月1日を1とする（ただし1900年2月29日のバグを含む）
    const excelEpoch = new Date(1900, 0, -1);
    const date = new Date(excelEpoch.getTime() + dateValue * 86400000);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    if (month >= 1 && month <= 12) {
      const fiscalYear = month >= 4 ? year : year - 1;
      return { fiscalYear, month };
    }
  }

  return null;
}

/**
 * CSV行をパース（ダブルクォート対応）
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // エスケープされた引用符
        current += '"';
        i++;
      } else {
        // 引用符の開始/終了
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // フィールド区切り
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
