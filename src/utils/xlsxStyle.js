/**
 * Excel 出力の共通書式（メンテ実績レポートでたかたかが手で整えた支店別レポートが基準）
 * - 文字は黒（見出しだけ濃緑地に白）、Meiryo UI。見出しは真ん中寄せ、行は全部 高さ中央
 * - 罫線は黒。区切り（グループの境目・期間の境目・外枠）は細線、中は点線
 * - 合計はグループの下に置いて薄い緑で塗る
 * - 前年比・前月比は 今÷前（0.0%）、100%未満は赤（条件付き書式）。比べる相手がない期間は列を作らない
 * - 0 は表示形式で空欄、合計・比率は式。Excel の中の文言は話し言葉にしない
 */

export const FONT = 'Meiryo UI';
export const GREEN_900 = 'FF14532D';
const BLACK = { argb: 'FF000000' };
export const THIN = { style: 'thin', color: BLACK };
export const DOT = { style: 'hair', color: BLACK };
export const SUB_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF1DE' } };
export const QTY_FMT = '#,##0;-#,##0;""';
export const RATIO_FMT = '0.0%';
export const amountFormat = unit => (unit === 'thousand' ? '#,##0,;-#,##0,;""' : '"¥"#,##0;-"¥"#,##0;""');

export const font = (size = 10, bold = false, color) => ({ name: FONT, size, bold, color: color ? { argb: color } : undefined });

export const colName = n => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** 行番号の並びを SUM 式に（続いている所は範囲にまとめる） */
export const sumFormula = (col, rowNums) => {
  const c = colName(col);
  const sorted = [...rowNums].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${c}${sorted[i]}` : `${c}${sorted[i]}:${c}${sorted[j]}`);
    i = j + 1;
  }
  return { formula: parts.length ? `SUM(${parts.join(',')})` : '0' };
};

/** 比率（今÷前）の式。前が 0 なら空欄 */
export const ratioFormula = (cur, base) => ({ formula: `IF(N(${base})=0,"",${cur}/${base})` });

/**
 * 期間ごとの列: 値, 比率（ratio のときだけ）
 * @param {{ key, top: string, sub?: string, ratio?: boolean, sum?: boolean }[]} periods
 * @returns {{ pc: { key, top, sub, sum, val, ratio }[], lastCol: number }}
 */
export function periodColumns(periods, startCol) {
  const pc = [];
  let c = startCol;
  periods.forEach(p => {
    const y = { ...p, val: c, ratio: p.ratio ? c + 1 : 0 };
    c = (y.ratio || y.val) + 1;
    pc.push(y);
  });
  return { pc, lastCol: c - 1 };
}

/** 範囲に罫線を引く。blockStarts の列の左と groupTops の行の上は細線、ほかは点線 */
export function drawBorders(ws, r1, r2, c1, c2, { blockStarts, groupTops }) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      ws.getCell(r, c).border = {
        top: groupTops.has(r) ? THIN : DOT,
        left: blockStarts.has(c) ? THIN : DOT,
        bottom: r === r2 ? THIN : undefined,
        right: c === c2 ? THIN : undefined,
      };
    }
  }
}

/**
 * 見出し 2 段（3〜4行目）。labelHeads は縦に結合。
 * 期間は 上段=top、下段=sub（なければ「実績 / 比率の名前」、比率もなければ縦に結合）
 */
export function writePeriodHeader(ws, labelHeads, pc, lastCol, ratioLabel) {
  for (const r of [3, 4]) {
    ws.getRow(r).height = 21;
    for (let k = 1; k <= lastCol; k++) {
      const cell = ws.getCell(r, k);
      cell.font = font(r === 3 || k <= labelHeads.length ? 10 : 8, true, 'FFFFFFFF');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_900 } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: r === 4 };
    }
  }
  labelHeads.forEach((h, i) => {
    ws.getCell(3, i + 1).value = h;
    ws.mergeCells(3, i + 1, 4, i + 1);
  });
  pc.forEach(p => {
    const end = p.ratio || p.val;
    ws.getCell(3, p.val).value = p.top;
    if (p.sub) {
      ws.getCell(4, p.val).value = p.sub;
      if (end > p.val) { ws.mergeCells(3, p.val, 3, end); ws.mergeCells(4, p.val, 4, end); }
    } else if (p.ratio) {
      ws.mergeCells(3, p.val, 3, end);
      ws.getCell(4, p.val).value = '実績';
      ws.getCell(4, p.ratio).value = ratioLabel;
    } else {
      ws.mergeCells(3, p.val, 4, p.val);
    }
  });
  drawBorders(ws, 3, 4, 1, lastCol, {
    blockStarts: new Set([...labelHeads.map((_, i) => i + 1), ...pc.map(p => p.val)]),
    groupTops: new Set([3]),
  });
  for (let k = 1; k <= lastCol; k++) ws.getCell(4, k).border = { ...ws.getCell(4, k).border, bottom: undefined };
}

/** 1行目：題名（左）と今日の日付（右端2列） */
export function writeTitle(ws, title, lastCol) {
  ws.getRow(1).height = 27.75;
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = font(14, true);
  const d = new Date();
  // 右端の列が細い（比率など）と ##### になるので2列ぶん使う
  const dateCol = lastCol > 2 ? lastCol - 1 : lastCol;
  if (dateCol < lastCol) ws.mergeCells(1, dateCol, 1, lastCol);
  const dc = ws.getCell(1, dateCol);
  dc.value = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  dc.numFmt = 'yyyy/mm/dd';
  dc.font = font(10);
  dc.alignment = { horizontal: 'right' };
}

/** 2行目の右端：表の単位（（台）・（千円）など）。右寄せ・下寄せ */
export function writeUnit(ws, unit, lastCol) {
  const c = ws.getCell(2, lastCol);
  c.value = unit;
  c.font = font(10);
  c.alignment = { horizontal: 'right', vertical: 'bottom' };
}

/** 比率の列は 100% 未満を赤 */
export function redBelow100(ws, cols, r1, r2) {
  if (r2 < r1) return;
  cols.forEach(c => ws.addConditionalFormatting({
    ref: `${colName(c)}${r1}:${colName(c)}${r2}`,
    rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['1'], priority: 1, style: { font: { color: { argb: 'FFFF0000' } } } }],
  }));
}

/** A4横・幅1ページ・左右中央・見出し行を毎ページ（シートの最後に呼ぶ） */
export function landscapePage(ws, titleRows = '3:4', ySplit = 4) {
  // 行は全部 高さ中央（単位のように下寄せを指定したセルはそのまま）
  ws.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, cell => {
    cell.alignment = { ...(cell.alignment || {}), vertical: cell.alignment?.vertical || 'middle' };
  }));
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit, zoomScale: 85 }];
  ws.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.3, footer: 0.3 },
  };
  if (titleRows) ws.pageSetup.printTitlesRow = titleRows;
}

/** ブックを「<名前>_YYYYMMDD.xlsx」で保存する */
export async function saveXlsx(wb, name) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const safeName = String(name).replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${safeName}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.xlsx`;

  // 保存先を選べるブラウザ（Chrome/Edge）はデスクトップを初期位置にする
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        startIn: 'desktop',
        types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // キャンセル
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
