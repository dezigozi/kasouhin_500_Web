/**
 * データ集計ユーティリティ
 * Excelから読み込んだ行データをドリルダウン・ピボット用に集計する
 */

/**
 * 受注件数カウントヘルパー
 * documentNumber があればユニーク伝票数、なければ行数をカウント
 */
function initCountEntry(entry, years) {
  entry.count = {};
  entry._docs = {};
  years.forEach(y => { entry.count[y] = 0; entry._docs[y] = new Set(); });
}
function accCount(entry, row) {
  const y = row.fiscalYear;
  if (!entry._docs[y]) { entry._docs[y] = new Set(); entry.count[y] = 0; }
  if (row.documentNumber != null && row.documentNumber !== '') {
    entry._docs[y].add(String(row.documentNumber));
    entry.count[y] = entry._docs[y].size;
  } else {
    entry.count[y]++;
  }
}
function finalizeCount(map) {
  Object.values(map).forEach(item => { delete item._docs; });
}

/**
 * フィルタリング: リース会社 + 月範囲
 */
export function filterRows(rows, { leaseCompany, startMonth, endMonth }) {
  return rows.filter(row => {
    // リース会社フィルタ
    if (leaseCompany && leaseCompany !== 'ALL') {
      if (row.leaseCompany !== leaseCompany) return false;
    }
    // 月範囲フィルタ（4月〜3月のような年度跨ぎに対応）
    if (startMonth && endMonth && row.month) {
      const sm = parseInt(startMonth);
      const em = parseInt(endMonth);
      const m = row.month;
      if (sm <= em) {
        // 同一年内 (e.g., 1月〜6月)
        if (m < sm || m > em) return false;
      } else {
        // 年度跨ぎ (e.g., 4月〜3月)
        if (m < sm && m > em) return false;
      }
    }
    return true;
  });
}

/**
 * 第1階層: 部店別集計
 */
export function aggregateByBranch(rows, years) {
  const map = {};
  rows.forEach(row => {
    const key = row.branch || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 第2階層: 注文者別集計（指定した部店内のみ）
 */
export function aggregateByOrderer(rows, years, branchName) {
  const filtered = rows.filter(r => r.branch === branchName);
  const map = {};
  filtered.forEach(row => {
    const key = row.ordererName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 第3階層: 顧客別集計（指定した部店＋注文者内のみ）
 */
export function aggregateByCustomer(rows, years, branchName, ordererName) {
  const filtered = rows.filter(r => r.branch === branchName && r.ordererName === ordererName);
  const map = {};
  filtered.forEach(row => {
    const key = row.customerName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 部店→顧客 の第2階層: 指定部店内の顧客別集計（同一顧客を複数担当が持つ場合も集約）
 */
export function aggregateByCustomerInBranch(rows, years, branchName) {
  const filtered = rows.filter(r => r.branch === branchName);
  const map = {};
  filtered.forEach(row => {
    const key = row.customerName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 部店→顧客→担当者 の第3階層: 指定部店・顧客に対する担当者別集計
 */
export function aggregateByOrdererForCustomer(rows, years, branchName, customerName) {
  const filtered = rows.filter(r => r.branch === branchName && r.customerName === customerName);
  const map = {};
  filtered.forEach(row => {
    const key = row.ordererName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 第4階層: 品番別集計（年度別）
 * hierarchyOrder='orderer_first': branchName→secondName(注文者)→thirdName(顧客)
 * hierarchyOrder='customer_first': branchName→secondName(顧客)→thirdName(担当者)
 */
export function aggregateByProductByYear(rows, years, branchName, secondName, thirdName, hierarchyOrder) {
  const filtered = rows.filter(r => {
    if (r.branch !== branchName) return false;
    if (hierarchyOrder === 'orderer_first') {
      return r.ordererName === secondName && r.customerName === thirdName;
    }
    return r.customerName === secondName && r.ordererName === thirdName;
  });
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; map[key].quantity[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      map[key].quantity[row.fiscalYear] += row.quantity || 0;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 顧客別品番集計（全担当者合算）
 * customer_first モードで担当者ページをスキップするときに使用
 */
export function aggregateByProductForCustomer(rows, years, branchName, customerName) {
  const filtered = rows.filter(r =>
    r.branch === branchName && r.customerName === customerName
  );
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; map[key].quantity[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      map[key].quantity[row.fiscalYear] += row.quantity || 0;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * 部店全体の品番集計（全顧客・全担当者合算）
 * 部店一覧から品番ボタンを押したときに使用
 */
export function aggregateByProductInBranch(rows, years, branchName) {
  const filtered = rows.filter(r => r.branch === branchName);
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; map[key].quantity[y] = 0; });
      initCountEntry(map[key], years);
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
      map[key].quantity[row.fiscalYear] += row.quantity || 0;
      accCount(map[key], row);
    }
  });
  finalizeCount(map);
  return Object.values(map).sort((a, b) => {
    const latestYear = years[years.length - 1];
    return (b.sales[latestYear] || 0) - (a.sales[latestYear] || 0);
  });
}

/**
 * ピボットデータ生成: リース会社 > 部店 > 注文者 > 顧客 の一覧
 */
export function generatePivotData(rows, years) {
  const map = {};
  rows.forEach(row => {
    const key = `${row.leaseCompany}||${row.branch}||${row.ordererName}||${row.customerName}`;
    if (!map[key]) {
      map[key] = {
        lease: row.leaseCompany || '',
        branch: row.branch || '',
        orderer: row.ordererName || '',
        customer: row.customerName || '',
        sales: {},
        profit: {},
      };
      years.forEach(y => { map[key].sales[y] = 0; map[key].profit[y] = 0; });
    }
    if (row.fiscalYear && years.includes(row.fiscalYear)) {
      map[key].sales[row.fiscalYear] += row.sales;
      map[key].profit[row.fiscalYear] += row.profit;
    }
  });
  return Object.values(map).sort((a, b) => {
    if (a.lease !== b.lease) return a.lease.localeCompare(b.lease);
    if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
    if (a.orderer !== b.orderer) return a.orderer.localeCompare(b.orderer);
    return a.customer.localeCompare(b.customer);
  });
}

/** 行の「YYYY年M月」キー（直近月列の集計用） */
export function monthKeyFromRow(row) {
  if (row.calendarYear == null || row.month == null) return null;
  const y = Number(row.calendarYear);
  const m = Number(row.month);
  if (Number.isNaN(y) || Number.isNaN(m)) return null;
  return `${y}年${m}月`;
}

/**
 * 第1階層: 部店別集計（月別）
 */
export function aggregateByBranchByMonth(rows, months) {
  const map = {};
  rows.forEach(row => {
    const key = row.branch || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByOrdererByMonth(rows, months, branchName) {
  const filtered = rows.filter(r => r.branch === branchName);
  const map = {};
  filtered.forEach(row => {
    const key = row.ordererName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByCustomerByMonth(rows, months, branchName, ordererName) {
  const filtered = rows.filter(r => r.branch === branchName && r.ordererName === ordererName);
  const map = {};
  filtered.forEach(row => {
    const key = row.customerName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByCustomerInBranchByMonth(rows, months, branchName) {
  const filtered = rows.filter(r => r.branch === branchName);
  const map = {};
  filtered.forEach(row => {
    const key = row.customerName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {}, repsSet: new Set() };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
    if (row.ordererName) map[key].repsSet.add(row.ordererName);
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const reps = [...item.repsSet].filter(Boolean);
    const rest = { ...item };
    delete rest.slipSets;
    delete rest.repsSet;
    return { ...rest, count, reps };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByOrdererForCustomerByMonth(rows, months, branchName, customerName) {
  const filtered = rows.filter(r => r.branch === branchName && r.customerName === customerName);
  const map = {};
  filtered.forEach(row => {
    const key = row.ordererName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductByMonth(rows, months, branchName, secondName, thirdName, hierarchyOrder) {
  const filtered = rows.filter(r => {
    if (r.branch !== branchName) return false;
    if (hierarchyOrder === 'orderer_first') {
      return r.ordererName === secondName && r.customerName === thirdName;
    }
    return r.customerName === secondName && r.ordererName === thirdName;
  });
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, slipSets: {}, quantity: {} };
      months.forEach(mo => {
        map[key].sales[mo] = 0; map[key].profit[mo] = 0;
        map[key].slipSets[mo] = new Set(); map[key].quantity[mo] = 0;
      });
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductForOrdererByMonth(rows, months, branchName, ordererName) {
  const filtered = rows.filter(r => r.branch === branchName && r.ordererName === ordererName);
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, slipSets: {}, quantity: {} };
      months.forEach(mo => {
        map[key].sales[mo] = 0; map[key].profit[mo] = 0;
        map[key].slipSets[mo] = new Set(); map[key].quantity[mo] = 0;
      });
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductForCustomerByMonth(rows, months, branchName, customerName) {
  const filtered = rows.filter(r => r.branch === branchName && r.customerName === customerName);
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].quantity[mo] = 0; });
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
    }
  });
  return Object.values(map).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductInBranchByMonth(rows, months, branchName) {
  const filtered = rows.filter(r => r.branch === branchName);
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].quantity[mo] = 0; });
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
    }
  });
  return Object.values(map).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByCustomerAllByMonth(rows, months) {
  const map = {};
  rows.forEach(row => {
    const key = row.customerName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {}, repsSet: new Set() };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
    if (row.ordererName) map[key].repsSet.add(row.ordererName);
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const reps = [...item.repsSet].filter(Boolean);
    const rest = { ...item };
    delete rest.slipSets;
    delete rest.repsSet;
    return { ...rest, count, reps };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByOrdererAllByMonth(rows, months) {
  const map = {};
  rows.forEach(row => {
    const key = row.ordererName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByOrdererForCustomerAllByMonth(rows, months, customerName) {
  const filtered = rows.filter(r => r.customerName === customerName);
  const map = {};
  filtered.forEach(row => {
    const key = row.ordererName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByCustomerForOrdererAllByMonth(rows, months, ordererName) {
  const filtered = rows.filter(r => r.ordererName === ordererName);
  const map = {};
  filtered.forEach(row => {
    const key = row.customerName || '(未分類)';
    if (!map[key]) {
      map[key] = { name: key, sales: {}, profit: {}, slipSets: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].slipSets[mo] = new Set(); });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductByMonthNoBranch(rows, months, secondName, thirdName, hierarchyOrder) {
  const filtered = rows.filter(r => {
    if (hierarchyOrder === 'orderer_first') {
      return r.ordererName === secondName && r.customerName === thirdName;
    }
    return r.customerName === secondName && r.ordererName === thirdName;
  });
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, slipSets: {}, quantity: {} };
      months.forEach(mo => {
        map[key].sales[mo] = 0; map[key].profit[mo] = 0;
        map[key].slipSets[mo] = new Set(); map[key].quantity[mo] = 0;
      });
    }
    if (row.productName && !map[key].productName) map[key].productName = row.productName;
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
      if (row.documentNumber) map[key].slipSets[monthKey].add(String(row.documentNumber));
    }
  });
  return Object.values(map).map(item => {
    const count = {};
    months.forEach(mo => { count[mo] = item.slipSets[mo] ? item.slipSets[mo].size : 0; });
    const rest = { ...item };
    delete rest.slipSets;
    return { ...rest, count };
  }).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductForCustomerAllByMonth(rows, months, customerName) {
  const filtered = rows.filter(r => r.customerName === customerName);
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].quantity[mo] = 0; });
    }
    if (row.productName && !map[key].productName) map[key].productName = row.productName;
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
    }
  });
  return Object.values(map).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductForOrdererAllByMonth(rows, months, ordererName) {
  const filtered = rows.filter(r => r.ordererName === ordererName);
  const map = {};
  filtered.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].quantity[mo] = 0; });
    }
    if (row.productName && !map[key].productName) map[key].productName = row.productName;
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
    }
  });
  return Object.values(map).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

export function aggregateByProductAllByMonth(rows, months) {
  const map = {};
  rows.forEach(row => {
    const key = row.productCode || '(品番なし)';
    if (!map[key]) {
      map[key] = { name: key, productName: '', sales: {}, profit: {}, quantity: {} };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; map[key].quantity[mo] = 0; });
    }
    if (row.productName && !map[key].productName) {
      map[key].productName = row.productName;
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
      map[key].quantity[monthKey] += row.quantity || 0;
    }
  });
  return Object.values(map).sort((a, b) => {
    const latestMonth = months[months.length - 1];
    return (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0);
  });
}

/**
 * ピボットデータ生成（月別）
 */
export function generatePivotDataByMonth(rows, months) {
  const map = {};
  rows.forEach(row => {
    const key = `${row.leaseCompany}||${row.branch}||${row.ordererName}||${row.customerName}`;
    if (!map[key]) {
      map[key] = {
        lease: row.leaseCompany || '',
        branch: row.branch || '',
        orderer: row.ordererName || '',
        customer: row.customerName || '',
        sales: {},
        profit: {},
      };
      months.forEach(mo => { map[key].sales[mo] = 0; map[key].profit[mo] = 0; });
    }
    const monthKey = monthKeyFromRow(row);
    if (monthKey && months.includes(monthKey)) {
      map[key].sales[monthKey] += row.sales || 0;
      map[key].profit[monthKey] += row.profit || 0;
    }
  });
  return Object.values(map).sort((a, b) => {
    if (a.lease !== b.lease) return a.lease.localeCompare(b.lease);
    if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
    if (a.orderer !== b.orderer) return a.orderer.localeCompare(b.orderer);
    return a.customer.localeCompare(b.customer);
  });
}

/**
 * 前年比計算
 */
export function calcYoY(curr, prev) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev) * 100).toFixed(1);
}

/**
 * 粗利率計算
 */
export function calcMargin(profit, sales) {
  if (!sales || sales === 0) return '0.0';
  return ((profit / sales) * 100).toFixed(1);
}

/**
 * 金額フォーマット
 */
export function formatCurrency(val) {
  if (val === 0 || val === null || val === undefined) return '¥0';
  const absVal = Math.abs(val);
  if (absVal >= 100000000) {
    return `¥${(val / 100000000).toFixed(1)}億`;
  }
  if (absVal >= 10000) {
    return `¥${(val / 10000).toFixed(0)}万`;
  }
  return `¥${val.toLocaleString()}`;
}

/**
 * 金額フォーマット（詳細版）
 */
export function formatCurrencyFull(val) {
  if (val === 0 || val === null || val === undefined) return '¥0';
  return `¥${Math.round(val).toLocaleString()}`;
}

/**
 * 半角全角正規化（検索用）
 * 「たばこ」「タバコ」「ﾀﾊﾞｺ」を統一して比較可能にする
 */
function normalizeJapanese(str) {
  return str
    // 半角カナ→全角カナ
    .replace(/[\uff61-\uff9f]/g, ch => {
      const HKANA = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝﾞﾟ';
      const FKANA = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンﾞﾟ';
      const idx = HKANA.indexOf(ch);
      return idx >= 0 ? FKANA[idx] : ch;
    })
    // ひらがな→カタカナ
    .replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    // 小文字統一
    .toLowerCase();
}

/**
 * 顧客名検索（半角全角対応、部分一致）
 */
export function searchCustomers(rows, query) {
  if (!query || query.trim() === '') return [];
  const normalized = normalizeJapanese(query.trim());
  const seen = new Set();
  const results = [];
  rows.forEach(row => {
    if (!row.customerName) return;
    const normCustomer = normalizeJapanese(row.customerName);
    if (normCustomer.includes(normalized)) {
      const key = `${row.customerName}||${row.branch}||${row.leaseCompany}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          customerName: row.customerName,
          branchName: row.branch || '',
          leaseCompany: row.leaseCompany || '',
        });
      }
    }
  });
  return results;
}

/**
 * CSVデータ生成
 */
export function generateCsvContent(pivotData, years) {
  const headers = ['リース会社', '部店', '注文者', '顧客名'];
  years.forEach(y => {
    headers.push(`${y}年度_売上`, `${y}年度_粗利`, `${y}年度_粗利率`);
  });

  const lines = [headers.join(',')];
  pivotData.forEach(row => {
    const cells = [
      `"${row.lease}"`,
      `"${row.branch}"`,
      `"${row.orderer}"`,
      `"${row.customer}"`,
    ];
    years.forEach(y => {
      const s = row.sales[y] || 0;
      const p = row.profit[y] || 0;
      const m = s > 0 ? ((p / s) * 100).toFixed(1) : '0.0';
      cells.push(s, p, `${m}%`);
    });
    lines.push(cells.join(','));
  });

  return lines.join('\n');
}

/**
 * ピボット CSV（月列）
 * @param {string[]} months 「YYYY年M月」の配列（「計」は含めない）
 */
export function generateCsvContentByMonth(pivotData, months) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['リース会社', '注文者', '顧客名', '受注月', '売上', '粗利', '粗利率'];
  const lines = [headers.map(q).join(',')];

  pivotData.forEach(row => {
    months.forEach(m => {
      const s = row.sales[m] || 0;
      const p = row.profit[m] || 0;
      if (s === 0 && p === 0) return; // 実績ゼロの月は出力しない
      const mr = s > 0 ? ((p / s) * 100).toFixed(1) + '%' : '0.0%';
      lines.push([
        q(row.lease),
        q(row.orderer),
        q(row.customer),
        q(m),
        s,
        p,
        q(mr),
      ].join(','));
    });
  });

  return lines.join('\r\n');
}
