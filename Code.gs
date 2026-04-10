function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet(); // または特定のシート名: ss.getSheetByName('実績データ');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ success: true, data: { rows: [], years: [], leaseCompanies: [] } }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = data[0];
    
    // ヘッダー名から列インデックスを探す（見つからなければエラーを防ぐために設定）
    var getIdx = function(names) {
      for (var i = 0; i < names.length; i++) {
        var idx = headers.indexOf(names[i]);
        if (idx !== -1) return idx;
      }
      return -1;
    };
    
    var colLease = getIdx(['略称', 'リース会社', 'リース', '架装実績']);
    var colBranch = getIdx(['部店', '部店名', '支店']);
    var colOrderer = getIdx(['得意先担当者名', '得意先担当者', '担当者名', '注文社名', '注文者名']);
    var colCustomer = getIdx(['顧客名_漢字', '顧客名', '顧客']);
    var colRep = getIdx(['得意先名', '得意先CD']); // 必要に応じて変更
    var colSales = getIdx(['単価']);
    var colProfit = getIdx(['粗利']);
    var colDate = getIdx(['登録日', '納車予定日', '納品日']);
    var colProductCode = getIdx(['品番']);
    var colProductName = getIdx(['商品名']);
    var colQuantity = getIdx(['受注数量', '数量']);
    
    var rows = [];
    var yearsSet = {};
    var leaseSet = {};
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var lease = colLease >= 0 ? String(row[colLease] || '') : '';
      var branch = colBranch >= 0 ? String(row[colBranch] || '') : '';
      var orderer = colOrderer >= 0 ? String(row[colOrderer] || '') : '';
      var customer = colCustomer >= 0 ? String(row[colCustomer] || '') : '';
      var rep = colRep >= 0 ? String(row[colRep] || '') : '';
      var sales = colSales >= 0 ? Number(row[colSales]) || 0 : 0;
      var profit = colProfit >= 0 ? Number(row[colProfit]) || 0 : 0;
      var dateRaw = colDate >= 0 ? row[colDate] : null;
      var productCode = colProductCode >= 0 ? String(row[colProductCode] || '') : '';
      var productName = colProductName >= 0 ? String(row[colProductName] || '') : '';
      var quantity = colQuantity >= 0 ? Number(row[colQuantity]) || 0 : 0;
      
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
        totalRows: rows.length,
        fileCount: 1 // スプレッドシート1つという意味で
      }
    };
    
    // CORS対応
    var output = ContentService.createTextOutput(JSON.stringify(responseData));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
    
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
