/**
 * 画面の表（ダッシュボード・一括網羅ピボット）を、PDF と同じ中身で Excel にする。書式は xlsxStyle.js の共通ルール。
 * 1行=1項目（売上・粗利・粗利率など）、期間ごとに「実績・比率」。合計はいちばん下（式）。
 * 金額は円のまま入れて、千円表示は表示形式（#,##0,）で出す（いじっても1円もずれない）。
 */
import {
  font, colName, sumFormula, ratioFormula, periodColumns, drawBorders, writePeriodHeader,
  writeTitle, writeUnit, redBelow100, landscapePage, saveXlsx, amountFormat, SUB_FILL, QTY_FMT, RATIO_FMT,
} from './xlsxStyle.js';

/**
 * @typedef {{ key: string, label: string, kind: 'qty'|'amt'|'rate' }} Metric  rate は sales/profit から式で出す
 * @typedef {{ labels: string[], values: (metricKey: string, periodKey: any) => number, inTotal?: boolean }} Group
 * @typedef {{
 *   name: string, title: string, labelHeads: string[], labelWidths: number[],
 *   periods: { key, top: string, sub?: string, ratio?: boolean, sum?: boolean }[], ratioLabel?: string,
 *   metrics: Metric[], groups: Group[], total?: { labels: string[] } | null,
 * }} SheetSpec
 */

function writeMatrixSheet(ws, s, amountUnit) {
  const amtFmt = amountFormat(amountUnit);
  const multi = s.metrics.length > 1;
  // 項目が1つだけなら項目の列は作らない
  const labelHeads = multi ? [...s.labelHeads, '項目'] : s.labelHeads;
  const L = labelHeads.length;
  const { pc, lastCol } = periodColumns(s.periods, L + 1);
  const hasAmt = s.metrics.some(m => m.kind !== 'qty');

  [...s.labelWidths, ...(multi ? [10] : [])].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  pc.forEach(p => {
    ws.getColumn(p.val).width = hasAmt ? 14 : 10;
    if (p.ratio) ws.getColumn(p.ratio).width = 9;
  });

  writeTitle(ws, s.title, lastCol);
  writeUnit(ws, hasAmt ? (amountUnit === 'thousand' ? '（千円）' : '（円）') : '（台）', lastCol);
  writePeriodHeader(ws, labelHeads, pc, lastCol, s.ratioLabel || '前年比');

  const fmtOf = m => (m.kind === 'qty' ? QTY_FMT : m.kind === 'amt' ? amtFmt : RATIO_FMT);
  const start = 5;
  let r = start;
  const groupTops = new Set();
  const subRows = new Set();
  const memberRows = Object.fromEntries(s.metrics.map(m => [m.key, []]));

  /** 1行ぶん。valueOf(period) は数値か式（rate と 計 の列はここで式にする） */
  const putRow = (m, rowOf, valueOf) => {
    ws.getRow(r).height = 22.5;
    if (multi) ws.getCell(r, L).value = m.label;
    pc.forEach((p, i) => {
      const v = ws.getCell(r, p.val);
      const c = colName(p.val);
      if (m.kind === 'rate') {
        v.value = { formula: `IF(N(${c}${rowOf.sales})=0,"",${c}${rowOf.profit}/${c}${rowOf.sales})` };
      } else if (p.sum) {
        v.value = { formula: `SUM(${pc.filter(x => !x.sum).map(x => `${colName(x.val)}${r}`).join(',')})` };
      } else {
        v.value = valueOf(p);
      }
      v.numFmt = fmtOf(m);
      if (p.ratio && m.kind !== 'rate') {
        const prev = pc[i - 1];
        const cell = ws.getCell(r, p.ratio);
        cell.value = ratioFormula(`${c}${r}`, `${colName(prev.val)}${r}`);
        cell.numFmt = RATIO_FMT;
      }
    });
    return r++;
  };

  const writeGroup = (labels, valueOf, isTotal) => {
    const first = r;
    if (multi || isTotal || first === start) groupTops.add(first);
    const rowOf = {};
    s.metrics.forEach(m => { rowOf[m.key] = putRow(m, rowOf, p => valueOf(m, p)); });
    labels.forEach((v, k) => {
      ws.getCell(first, k + 1).value = v || null;
      if (r - 1 > first) ws.mergeCells(first, k + 1, r - 1, k + 1);
    });
    for (let rr = first; rr < r; rr++) {
      for (let k = 1; k <= lastCol; k++) {
        const cell = ws.getCell(rr, k);
        const isLabel = k <= s.labelHeads.length;
        cell.font = font(pc.some(p => p.ratio === k) ? 9 : 10, isLabel ? k === 1 : (isTotal && k === L && multi));
        cell.alignment = isLabel
          ? (multi ? { horizontal: 'center', wrapText: true } : { horizontal: 'left', shrinkToFit: true })
          : {};
      }
      if (isTotal) subRows.add(rr);
    }
    return rowOf;
  };

  s.groups.forEach(g => {
    const rowOf = writeGroup(g.labels, (m, p) => g.values(m.key, p.key) || 0, false);
    if (g.inTotal !== false) s.metrics.forEach(m => memberRows[m.key].push(rowOf[m.key]));
  });
  if (s.total && s.groups.length) {
    writeGroup(s.total.labels, (m, p) => sumFormula(p.val, memberRows[m.key]), true);
  }
  const endRow = r - 1;

  if (endRow >= start) {
    drawBorders(ws, start, endRow, 1, lastCol, {
      blockStarts: new Set([...labelHeads.map((_, i) => i + 1), ...pc.map(p => p.val)]),
      groupTops,
    });
    // 合計は塗る（項目が複数なら名前の列は塗らない）
    subRows.forEach(rr => { for (let k = multi ? L : 1; k <= lastCol; k++) ws.getCell(rr, k).fill = SUB_FILL; });
    redBelow100(ws, pc.filter(p => p.ratio).map(p => p.ratio), start, endRow);
  }
  landscapePage(ws);
}

/**
 * @param {{ fileName: string, amountUnit: 'yen'|'thousand', sheets: SheetSpec[] }} p
 */
export async function writeReportXlsx({ fileName, amountUnit, sheets }) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  sheets.forEach(s => writeMatrixSheet(wb.addWorksheet(s.name), s, amountUnit));
  await saveXlsx(wb, fileName);
}
