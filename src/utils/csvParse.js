/**
 * CSV パース純粋関数
 * メインスレッドと Web Worker の両方から利用するため、外部依存なしで分離している。
 * 仕様変更時はこのファイルを修正すれば両者に反映される。
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
  '日付':                 'date',
  '年月日':               'date',
  'date':                 'date',
  // deliverydate（納車年月日） — 「納車日」は受注日ではなく納車日扱い
  '納車日':               'deliverydate',
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

function normalizeHeader(raw) {
  const key = raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/　/g, '')
    .toLowerCase();
  return HEADER_MAP[key] || raw.trim();
}

export function parseCsv(csv) {
  const lines = csv.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  // BOM除去 + 日本語→英語キー正規化
  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xFEFF) {
    headerLine = headerLine.slice(1);
  }
  const headers = parseCSVLine(headerLine).map(normalizeHeader);
  const rows = new Array(lines.length - 1);

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};

    for (let j = 0; j < headers.length; j++) {
      const value = values[j]?.trim() || '';
      const numVal = Number(value);
      row[headers[j]] = isNaN(numVal) || value === '' ? value : numVal;
    }

    if (row.date && !row.fiscalYear && !row.month) {
      const dateInfo = parseDate(row.date);
      if (dateInfo) {
        row.fiscalYear = dateInfo.fiscalYear;
        row.month = dateInfo.month;
      }
    }

    if (row.deliverydate) {
      const dInfo = parseDate(row.deliverydate);
      if (dInfo) {
        const calYear = dInfo.month >= 4 ? dInfo.fiscalYear : dInfo.fiscalYear + 1;
        const shortYear = calYear % 100;
        row.deliveryYM = `${shortYear}年${dInfo.month}月`;
        row.deliverySortKey = calYear * 100 + dInfo.month;
      }
    }

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

    rows[i - 1] = row;
  }

  const yearsSet = new Set();
  const leaseSet = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.fiscalYear) yearsSet.add(Number(r.fiscalYear));
    if (r.leaseCompany) leaseSet.add(r.leaseCompany);
  }

  return {
    rows,
    years: Array.from(yearsSet).sort((a, b) => a - b),
    leaseCompanies: Array.from(leaseSet).sort(),
  };
}

function parseDate(dateValue) {
  if (typeof dateValue === 'string') {
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

  if (typeof dateValue === 'number' && dateValue > 0) {
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

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
