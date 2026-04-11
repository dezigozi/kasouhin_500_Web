function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // シート名を明示的に指定（getActiveSheet()は毎回違うシートを返す可能性があるため）
    var SHEET_NAME = '売上済み'; // ← データが入っているシートのタブ名を設定
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      // 指定シートが見つからない場合は最初のシートを使用
      sheet = ss.getSheets()[0];
    }
    
    var offset = parseInt(e.parameter.offset || '0', 10);
    var limit = parseInt(e.parameter.limit || '10000', 10);
    
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var totalDataRows = Math.max(0, lastRow - 1);
    
    if (lastRow <= 1 || offset >= totalDataRows) {
      return ContentService.createTextOutput(JSON.stringify({ 
        success: true, 
        data: { rows: [], years: [], leaseCompanies: [], totalRows: totalDataRows, offset: offset } 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // ユーザー指定のハードコーディング列インデックス
    var colLease = 11; // L列 (略称)
    var colBranch = 12; // M列 (部店)
    var colOrderer = 3; // D列 (得意先担当者名)
    var colCustomer = 4; // E列 (顧客名_漢字)
    var colRep = 2;     // C列 (得意先CD)
    var colSales = 9;   // J列 (単価/売上)
    var colProfit = 13; // N列 (粗利)
    var colDate = 10;   // K列 (登録日)
    var colProductCode = 6; // G列 (品番)
    var colProductName = 7; // H列 (商品名)
    var colQuantity = 8;    // I列 (受注数量)

    var startRow = offset + 2; // ヘッダー分(+1)と、1-indexed分(+1)
    var numRowsToFetch = Math.min(limit, lastRow - startRow + 1);
    
    var data = sheet.getRange(startRow, 1, numRowsToFetch, lastCol).getValues();
    
    var rows = [];
    var yearsSet = {};
    var leaseSet = {};
    
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var lease = String(row[colLease] || '');
      var branch = String(row[colBranch] || '');
      var orderer = String(row[colOrderer] || '');
      var customer = String(row[colCustomer] || '');
      var rep = String(row[colRep] || '');
      
      // カンマや円記号などの数値以外の文字を除去してパース
      var salesStr = String(row[colSales] || '0').replace(/[^\d.-]/g, '');
      var sales = Number(salesStr) || 0;
      
      var profitStr = String(row[colProfit] || '0').replace(/[^\d.-]/g, '');
      var profit = Number(profitStr) || 0;
      
      var dateRaw = row[colDate];
      var productCode = String(row[colProductCode] || '');
      var productName = String(row[colProductName] || '');
      var quantity = Number(row[colQuantity]) || 0;
      
      // 空データスキップ
      if (!lease && !branch && !orderer && !customer && sales === 0) continue;
      // 特定文字スキップ
      if (['空白', 'その他'].indexOf(lease) !== -1 || lease.trim() === '') continue;
      
      var fiscalYear = null;
      var month = null;
      var calendarYear = null;
      
      if (dateRaw instanceof Date) {
        month = dateRaw.getMonth() + 1;
        calendarYear = dateRaw.getFullYear();
        fiscalYear = month >= 4 ? calendarYear : calendarYear - 1;
      }
      
      rows.push({
        leaseCompany: lease,
        branch: branch,
        ordererName: orderer,
        customerName: customer,
        rep: rep,
        sales: sales,
        profit: profit,
        fiscalYear: fiscalYear,
        month: month,
        calendarYear: calendarYear,
        productCode: productCode,
        productName: productName,
        quantity: quantity,
      });
      
      if (fiscalYear) yearsSet[fiscalYear] = true;
      if (lease) leaseSet[lease] = true;
    }
    
    var years = Object.keys(yearsSet).map(Number).sort(function(a,b){return a-b;});
    var leaseCompanies = Object.keys(leaseSet).sort();
    
    var responseData = {
      success: true,
      data: {
        rows: rows,
        years: years,
        leaseCompanies: leaseCompanies,
        totalRows: totalDataRows,
        offset: offset,
      }
    };
    
    var output = ContentService.createTextOutput(JSON.stringify(responseData));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
    
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

