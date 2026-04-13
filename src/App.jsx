import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ChevronRight, Building2, Settings, User, Store,
  ArrowUpRight, ArrowDownRight, LayoutDashboard, Database,
  Calendar, RefreshCcw, CheckCircle2, FileText, FileSpreadsheet,
  ListFilter, AlertCircle, Loader2, XCircle, ArrowUpDown, Eye, EyeOff,
  CheckSquare, Square, Package, Search, Menu, X,
} from 'lucide-react';
import { getCache, setCache, clearCache } from './utils/db';
import { loadCsvData } from './utils/csvLoader';
import {
  filterRows,
  aggregateByBranchByMonth, aggregateByOrdererByMonth, aggregateByCustomerByMonth,
  aggregateByCustomerInBranchByMonth, aggregateByOrdererForCustomerByMonth,
  aggregateByProductByMonth, aggregateByProductForCustomerByMonth, aggregateByProductInBranchByMonth,
  searchCustomers,
  generatePivotDataByMonth, calcYoY, calcMargin, formatCurrencyFull,
  generateCsvContentByMonth,
} from './utils/aggregator';

// GAS Web App URL（.env の VITE_GAS_URL に設定）
const GAS_URL = import.meta.env.VITE_GAS_URL || '';

// IndexedDB キャッシュキー
const CACHE_KEY = 'kasouhin_500_data_v1';

const REPORT_TITLE = '架装品 500受注レポート';

/** 直近 n カ月 + 末尾に「計」 */
function buildMonthsWithTotal(n = 6) {
  const monthKeys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}年${d.getMonth() + 1}月`);
  }
  monthKeys.push('計');
  return monthKeys;
}

function enrichRowsCalendarYear(rows) {
  return rows.map(r => {
    if (r.calendarYear != null && r.calendarYear !== '' && r.month != null) return r;
    if (r.fiscalYear != null && r.month != null) {
      const fy = Number(r.fiscalYear);
      const m = Number(r.month);
      if (!Number.isNaN(fy) && !Number.isNaN(m)) {
        return { ...r, calendarYear: m >= 4 ? fy : fy + 1 };
      }
    }
    return r;
  });
}

/** 表示幅: 全角=1、ASCII・半角カナ=0.5 */
function charDisplayUnit(ch) {
  const c = ch.codePointAt(0);
  if (c <= 0x007e) return 0.5;
  if (c >= 0xff61 && c <= 0xff9f) return 0.5;
  return 1;
}
function truncateByDisplayWidth(str, maxUnits) {
  if (!str) return '';
  let units = 0, out = '';
  for (const ch of str) {
    const u = charDisplayUnit(ch);
    if (units + u > maxUnits) break;
    out += ch; units += u;
  }
  return out;
}

const App = () => {
  // ===== Auth State =====
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    sessionStorage.getItem('kasouhin_auth') === 'true'
  );
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  // ===== Data State =====
  const [rawData, setRawData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ fetchMsg: '', isSyncing: false });
  const [loadError, setLoadError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');

  // ===== UI State =====
  const [selectedLeaseCo, setSelectedLeaseCo] = useState('ALL');
  const [viewMode, setViewMode] = useState('dashboard');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [amountUnit, setAmountUnit] = useState('yen');
  const [pivotBranch, setPivotBranch] = useState('ALL');
  const [pivotSort, setPivotSort] = useState('sales');
  const [showProfit, setShowProfit] = useState(true);
  const [hierarchyOrder, setHierarchyOrder] = useState('orderer_first');
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [activeView, setActiveView] = useState({ branchName: null, secondName: null, thirdName: null });
  const [customerViewMode, setCustomerViewMode] = useState('orderer'); // 'orderer' | 'product'
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const printRef = useRef(null);

  // ===== 金額フォーマット =====
  const fmtAmt = useCallback((val) => {
    if (amountUnit === 'thousand') {
      const v = Math.round((val || 0) / 1000);
      return `¥${v.toLocaleString()}`;
    }
    return formatCurrencyFull(val);
  }, [amountUnit]);

  // ===== GAS / CSV データ読み込み（IndexedDB キャッシュ + ページネーション） =====
  const loadData = useCallback(async (forceRefresh = false) => {
    if (!GAS_URL) {
      // CSV データを読み込み（または失敗時はモックデータ）
      try {
        setIsLoading(true);
        setLoadError(null);
        setConnectionStatus('loading');
        setLoadingProgress({ fetchMsg: 'CSVデータを読み込み中...', isSyncing: true });

        const csvData = await loadCsvData();
        const rows = enrichRowsCalendarYear(csvData.rows || []);
        setRawData({ ...csvData, rows, fromCache: false, cacheAgeMsg: 'CSV' });
        setConnectionStatus('online');
        setLoadError(null);
      } catch (err) {
        console.error('CSV読み込みエラー:', err);
        setLoadError('CSVファイルの読み込みに失敗しました。デモデータを表示します。');
        loadMockData();
      } finally {
        setIsLoading(false);
        setLoadingProgress({ fetchMsg: '', isSyncing: false });
      }
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setConnectionStatus('loading');
    setLoadingProgress({ fetchMsg: 'キャッシュを確認中...', isSyncing: true });

    try {
      let currentRows = [];
      let currentOffset = 0;

      if (forceRefresh) {
        await clearCache();
      } else {
        const cached = await getCache(CACHE_KEY);
        if (cached?.data) {
          currentRows = cached.data.rows || [];
          currentOffset = currentRows.length;
          const ageMin = Math.floor((Date.now() - cached.timestamp) / 60000);
          setRawData({
            rows: enrichRowsCalendarYear(currentRows),
            years: cached.data.years || [],
            leaseCompanies: cached.data.leaseCompanies || [],
            fromCache: true,
            cacheAgeMsg: `${ageMin}分前のデータ`,
          });
          setConnectionStatus('online');
          setLoadingProgress({ fetchMsg: '追加データを確認中...', isSyncing: true });
        }
      }

      const limit = 5000;
      let hasMore = true;
      let fetchedAny = false;

      while (hasMore) {
        const url = `${GAS_URL}?offset=${currentOffset}&limit=${limit}`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.success) {
          const newRows = result.data.rows;
          if (newRows.length > 0) {
            currentRows = [...currentRows, ...newRows];
            currentOffset += newRows.length;
            fetchedAny = true;
          }
          const total = result.data.totalRows;
          if (currentOffset >= total || newRows.length === 0) {
            hasMore = false;
          } else {
            setLoadingProgress({ fetchMsg: `${currentOffset.toLocaleString()} / ${total.toLocaleString()} 件を同期中...`, isSyncing: true });
          }
        } else {
          throw new Error(result.error);
        }
      }

      if (fetchedAny || forceRefresh) {
        const yearsSet = new Set();
        const leaseSet = new Set();
        currentRows.forEach(r => {
          if (r.fiscalYear) yearsSet.add(r.fiscalYear);
          if (r.leaseCompany) leaseSet.add(r.leaseCompany);
        });
        const finalData = {
          rows: enrichRowsCalendarYear(currentRows),
          years: Array.from(yearsSet).sort((a, b) => a - b),
          leaseCompanies: Array.from(leaseSet).sort(),
        };
        await setCache(CACHE_KEY, { data: finalData, timestamp: Date.now() });
        setRawData({ ...finalData, fromCache: false, cacheAgeMsg: '最新' });
      } else if (rawData) {
        setRawData(prev => ({ ...prev, cacheAgeMsg: '最新（変更なし）' }));
      }

      setConnectionStatus('online');
      setLoadError(null);
    } catch {
      if (rawData) {
        setLoadError('追加データの取得に失敗しました。キャッシュデータを表示中です。');
      } else {
        setLoadError('データの取得に失敗しました。GAS URL や接続を確認してください。');
        setConnectionStatus('offline');
      }
    } finally {
      setIsLoading(false);
      setLoadingProgress({ fetchMsg: '', isSyncing: false });
    }
  }, [rawData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== モックデータ（GAS URL 未設定時 / デモ用） =====
  const loadMockData = useCallback(() => {
    setIsLoading(true);
    setConnectionStatus('loading');
    setTimeout(() => {
      const years = [2023, 2024, 2025];
      const mockRows = [];
      const branches = ['MA営業第4部', '首都圏営業第2部', '中日本営業部', '西日本営業部'];
      const leases = ['SMAS', 'TCM', 'オリックス', '三菱HC'];
      const orderers = ['相馬 リース課', '福岡 営業所', '東京本部', '大阪支店', '名古屋営業所'];
      const customers = ['(株)西原環境', '山下商事(有)', '日本カーソリューションズ', 'トヨタモビリティパーツ', '(株)丸紅エネルギー', '三菱商事(株)', 'アイシン精機(株)', '(株)豊田自動織機'];
      const productCodes = ['P001', 'P002', 'P003', 'P004', 'P005'];
      const productNames = ['ウィングボデー', 'バンボデー', '冷凍冷蔵車', 'クレーン付き', 'ダンプ'];
      const now = new Date();

      for (let i = 0; i < 500; i++) {
        const back = Math.floor(Math.random() * 6);
        const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
        const calendarYear = d.getFullYear();
        const month = d.getMonth() + 1;
        const fiscalYear = month >= 4 ? calendarYear : calendarYear - 1;
        const pIdx = Math.floor(Math.random() * productCodes.length);
        const sales = Math.floor(Math.random() * 500000) + 50000;
        const profitRate = 0.15 + Math.random() * 0.2;
        mockRows.push({
          leaseCompany: leases[Math.floor(Math.random() * leases.length)],
          branch: branches[Math.floor(Math.random() * branches.length)],
          ordererName: orderers[Math.floor(Math.random() * orderers.length)],
          customerName: customers[Math.floor(Math.random() * customers.length)],
          productCode: productCodes[pIdx],
          productName: productNames[pIdx],
          quantity: Math.floor(Math.random() * 5) + 1,
          sales,
          profit: Math.floor(sales * profitRate),
          fiscalYear,
          month,
          calendarYear,
        });
      }
      setRawData({ rows: mockRows, years, leaseCompanies: leases, fromCache: false, cacheAgeMsg: 'デモ' });
      setConnectionStatus('online');
      setIsLoading(false);
    }, 1200);
  }, []);

  // 初回読み込み
  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 階層順変更時：secondName / thirdName をリセット
  useEffect(() => {
    setActiveView(prev => ({ ...prev, secondName: null, thirdName: null }));
  }, [hierarchyOrder]);

  // ===== フィルタ =====
  const filteredRows = useMemo(() => {
    if (!rawData) return [];
    const rows = rawData.rows.filter(r =>
      r.leaseCompany && r.leaseCompany.trim() &&
      r.leaseCompany !== '空白' && r.leaseCompany !== 'その他'
    );
    return filterRows(rows, {
      leaseCompany: selectedLeaseCo,
      startMonth: '',
      endMonth: '',
    });
  }, [rawData, selectedLeaseCo]);

  /** 表の列: 直近6カ月 + 「計」（データ読込のたびに基準月を更新） */
  const months = useMemo(() => buildMonthsWithTotal(6), []);

  const leaseCompanies = useMemo(() => {
    if (!rawData?.leaseCompanies) return [];
    return rawData.leaseCompanies.filter(lc => lc && lc.trim() && lc !== '空白' && lc !== 'その他');
  }, [rawData]);

  const branches = useMemo(() => {
    const set = new Set();
    filteredRows.forEach(r => { if (r.branch) set.add(r.branch); });
    return [...set].sort();
  }, [filteredRows]);

  // ===== ドリルダウンデータ（直近6ヶ月列） =====
  const currentTableData = useMemo(() => {
    const monthList = months.slice(0, -1);
    if (!filteredRows.length || !monthList.length) return [];
    const { branchName, secondName, thirdName } = activeView;

    if (customerViewMode === 'product' && branchName && secondName && !thirdName) {
      if (branchName === secondName) {
        return aggregateByProductInBranchByMonth(filteredRows, monthList, branchName);
      }
      return aggregateByProductForCustomerByMonth(filteredRows, monthList, branchName, secondName);
    }

    if (!branchName) return aggregateByBranchByMonth(filteredRows, monthList);
    if (hierarchyOrder === 'orderer_first') {
      if (!secondName) return aggregateByOrdererByMonth(filteredRows, monthList, branchName);
      if (!thirdName)  return aggregateByCustomerByMonth(filteredRows, monthList, branchName, secondName);
      return aggregateByProductByMonth(filteredRows, monthList, branchName, secondName, thirdName, 'orderer_first');
    }
    if (!secondName) return aggregateByCustomerInBranchByMonth(filteredRows, monthList, branchName);
    if (!thirdName)  return aggregateByOrdererForCustomerByMonth(filteredRows, monthList, branchName, secondName);
    return aggregateByProductByMonth(filteredRows, monthList, branchName, secondName, thirdName, 'customer_first');
  }, [filteredRows, months, activeView, hierarchyOrder, customerViewMode]);

  // テーブルデータ変更時：チェックを全選択に初期化
  useEffect(() => {
    if (!currentTableData.length) return;
    setCheckedItems(new Set(currentTableData.map(d => d.name)));
  }, [activeView.branchName, activeView.secondName, activeView.thirdName, hierarchyOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== ピボットデータ（直近6ヶ月） =====
  const pivotData = useMemo(() => {
    const monthList = months.slice(0, -1);
    if (!filteredRows.length || !monthList.length) return [];
    const rows = pivotBranch === 'ALL' ? filteredRows : filteredRows.filter(r => r.branch === pivotBranch);
    const data = generatePivotDataByMonth(rows, monthList);
    const latestMonth = monthList[monthList.length - 1];
    // 全月合計を返すヘルパー
    const rowTotal = (r, field) => monthList.reduce((s, m) => s + (r[field][m] || 0), 0);
    if (pivotSort === 'sales') {
      data.sort((a, b) => rowTotal(b, 'sales') - rowTotal(a, 'sales'));
    } else if (pivotSort === 'profit') {
      data.sort((a, b) => rowTotal(b, 'profit') - rowTotal(a, 'profit'));
    } else if (pivotSort === 'lease') {
      data.sort((a, b) => (a.lease || '').localeCompare(b.lease || '', 'ja'));
    } else if (pivotSort === 'orderer') {
      const totals = {};
      data.forEach(r => { totals[r.orderer || ''] = (totals[r.orderer || ''] || 0) + (r.sales[latestMonth] || 0); });
      data.sort((a, b) => (totals[b.orderer || ''] || 0) - (totals[a.orderer || ''] || 0));
    } else if (pivotSort === 'customer') {
      const totals = {};
      data.forEach(r => { totals[r.customer || ''] = (totals[r.customer || ''] || 0) + (r.sales[latestMonth] || 0); });
      data.sort((a, b) => (totals[b.customer || ''] || 0) - (totals[a.customer || ''] || 0));
    }
    return data;
  }, [filteredRows, months, pivotBranch, pivotSort]);

  // ===== ハンドラ =====
  const isLeafLevel = useMemo(() => {
    const { branchName, secondName, thirdName } = activeView;
    return !!branchName && !!secondName && !!thirdName;
  }, [activeView]);

  const handleDrillDown = (item) => {
    if (isLeafLevel) return;
    if (customerViewMode === 'product') return;  // 品番モード中はドリルダウン無効
    const { branchName, secondName } = activeView;
    if (!branchName)     setActiveView({ branchName: item.name, secondName: null, thirdName: null });
    else if (!secondName) setActiveView({ ...activeView, secondName: item.name, thirdName: null });
    else                  setActiveView({ ...activeView, thirdName: item.name });
  };

  const handleShowProductsDirectly = (item) => {
    const { branchName, secondName } = activeView;
    if (!branchName) {
      // 部店一覧：その部店内全顧客の合算品番
      setActiveView({ branchName: item.name, secondName: item.name, thirdName: null });
    } else if (!secondName) {
      // 部店内の顧客/担当者一覧：その顧客の品番
      setActiveView({ ...activeView, secondName: item.name, thirdName: null });
    }
    setCustomerViewMode('product');
  };

  const handleBreadcrumb = (target) => {
    if (target === 'branch') setActiveView({ branchName: null, secondName: null, thirdName: null });
    else if (target === 'second') setActiveView(prev => ({ ...prev, secondName: null, thirdName: null }));
    else setActiveView(prev => ({ ...prev, thirdName: null }));
  };

  const handleRefresh = () => loadData(true);

  const handleSaveCsv = () => {
    let csv = '';
    let filename = '';

    if (viewMode === 'dashboard') {
      // ダッシュボード: リース会社・部店・担当者・ユーザー・品番・受注年月・売上・粗利
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const headers = ['リース会社', '部店', '担当者', 'ユーザー', '品番', '受注年月', '売上', '粗利'];

      // (leaseCompany, branch, ordererName, customerName, productCode, yearMonth) でグループ化
      const map = {};
      filteredRows.forEach(r => {
        if (!r.calendarYear || !r.month) return;
        const ym = `${r.calendarYear}年${r.month}月`;
        const key = [r.leaseCompany, r.branch, r.ordererName, r.customerName, r.productCode, ym].join('|');
        if (!map[key]) {
          map[key] = {
            lease: r.leaseCompany || '', branch: r.branch || '',
            orderer: r.ordererName || '', customer: r.customerName || '',
            productCode: r.productCode || '', ym,
            ymSort: r.calendarYear * 100 + r.month,
            sales: 0, profit: 0,
          };
        }
        map[key].sales  += Number(r.sales)  || 0;
        map[key].profit += Number(r.profit) || 0;
      });

      const rows = Object.values(map).sort((a, b) =>
        a.lease.localeCompare(b.lease, 'ja') ||
        a.branch.localeCompare(b.branch, 'ja') ||
        a.orderer.localeCompare(b.orderer, 'ja') ||
        a.customer.localeCompare(b.customer, 'ja') ||
        a.ymSort - b.ymSort
      );

      const lines = [headers.map(q).join(',')];
      rows.forEach(r => {
        lines.push([
          q(r.lease), q(r.branch), q(r.orderer), q(r.customer),
          q(r.productCode), q(r.ym), r.sales, r.profit,
        ].join(','));
      });
      csv = lines.join('\r\n');
      filename = `分析ダッシュボード_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      // 一括網羅レポート
      if (!pivotData.length) return;
      const monthList = months.slice(0, -1);
      csv = generateCsvContentByMonth(pivotData, monthList);
      filename = `一括網羅レポート_${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSavePdf = () => window.print();

  // ===== 顧客検索ハンドラー =====
  const handleSelectCustomer = useCallback((result) => {
    if (result.branchName && result.customerName) {
      setActiveView({
        branchName: result.branchName,
        secondName: result.customerName,
        thirdName: null,
      });
      setSelectedLeaseCo(result.leaseCompany || 'ALL');

      // 顧客検索モード：品番表示
      setCustomerViewMode('product');
      setCustomerSearchQuery('');
      setCustomerSearchResults([]);
      setIsSearchDropdownOpen(false);
    }
  }, []);

  const handleSearchCustomer = useCallback(() => {
    if (!customerSearchQuery.trim()) return;
    const results = searchCustomers(filteredRows, customerSearchQuery);
    if (results.length === 1) {
      handleSelectCustomer(results[0]);
    } else if (results.length > 0) {
      setCustomerSearchResults(results);
      setIsSearchDropdownOpen(true);
    }
  }, [customerSearchQuery, filteredRows, handleSelectCustomer]);


  // ===== ログイン =====
  const handleLogin = (e) => {
    e.preventDefault();
    if (passwordInput === (import.meta.env.VITE_PASSWORD || '')) {
      sessionStorage.setItem('kasouhin_auth', 'true');
      setIsAuthenticated(true);
      setAuthError('');
    } else {
      setAuthError('パスワードが違います');
    }
  };

  const handleLogout = () => {
    if (confirm('ログアウトしますか？')) {
      sessionStorage.removeItem('kasouhin_auth');
      setIsAuthenticated(false);
    }
  };

  // ===== 階層ラベル =====
  const levelInfo = useMemo(() => {
    const { branchName, secondName, thirdName } = activeView;
    if (!branchName) return { icon: Building2, label: '部店名', title: '部店別 直近6ヶ月実績' };
    if (hierarchyOrder === 'orderer_first') {
      if (!secondName) return { icon: Store,    label: '注文者名', title: `${branchName} 内 注文者実績` };
      if (!thirdName)  return { icon: User,     label: '顧客名',   title: `${secondName} 内 顧客実績` };
      return                  { icon: Package,  label: '品番',     title: `${thirdName} 内 品番別実績` };
    }
    if (!secondName) return { icon: User,    label: '顧客名',   title: `${branchName} 内 顧客実績` };
    if (!thirdName)  return { icon: Store,   label: '注文者名', title: `${secondName} 内 担当者一覧` };
    return                  { icon: Package, label: '品番',     title: `${thirdName} 内 品番別実績` };
  }, [activeView, hierarchyOrder]);

  // ===== ログイン画面 =====
  if (!isAuthenticated && import.meta.env.VITE_PASSWORD) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-[3rem] w-full max-w-sm shadow-2xl overflow-hidden">
          <div className="p-10 border-b border-slate-50 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-red-500 p-2 rounded-xl text-white"><Database size={22} /></div>
              <h1 className="text-xl font-black tracking-tighter text-slate-800">{REPORT_TITLE}</h1>
            </div>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">直近6ヶ月受注（CSV）</p>
          </div>
          <form onSubmit={handleLogin} className="p-10 space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">パスワード</label>
              <input
                type="password"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                className="w-full bg-slate-100 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-4 focus:ring-red-500/10"
                placeholder="••••••••"
                autoFocus
              />
              {authError && <p className="text-xs text-rose-500 font-bold px-2">{authError}</p>}
            </div>
            <button
              type="submit"
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-red-600 transition-all active:scale-95"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ===== メイン画面 =====
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 select-none">

      {/* ===== Top Bar（全サイズ表示） ===== */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-slate-900 text-white flex items-center justify-between px-4 py-3 no-print">
        <div className="flex items-center gap-2">
          <div className="bg-red-500 p-1.5 rounded-lg"><Database size={18} /></div>
          <span className="font-black text-sm tracking-tight">{REPORT_TITLE}</span>
        </div>
        <button onClick={() => setIsSidebarOpen(v => !v)} className="p-2 rounded-xl hover:bg-slate-800 transition-colors">
          {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* ===== Sidebar Overlay（全サイズ・外タップで閉じる） ===== */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* ===== Sidebar ===== */}
      <aside className={`fixed top-0 left-0 w-64 bg-slate-900 text-white flex flex-col p-6 h-screen shadow-2xl z-40 no-print transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between mb-10 px-2">
          <div className="flex items-center gap-3">
            <div className="bg-red-500 p-2 rounded-xl text-white shadow-lg shadow-red-500/20">
              <Database size={24} />
            </div>
            <h1 className="text-lg font-black leading-none tracking-tighter uppercase">
              Special<br/>Sales Report
            </h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => { setViewMode('dashboard'); setIsSidebarOpen(false); }}
            className={`flex items-center gap-3 w-full p-4 rounded-2xl transition-all duration-300 ${
              viewMode === 'dashboard'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-105'
                : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard size={20} />
            <span className="font-black text-sm tracking-tight">分析ダッシュボード</span>
          </button>
          <button
            onClick={() => { setViewMode('pivot_report'); setIsSidebarOpen(false); }}
            className={`flex items-center gap-3 w-full p-4 rounded-2xl transition-all duration-300 ${
              viewMode === 'pivot_report'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-105'
                : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            <ListFilter size={20} />
            <span className="font-black text-sm tracking-tight">一括網羅レポート</span>
          </button>
          <button
            onClick={() => { setViewMode('product_search'); setIsSidebarOpen(false); }}
            className={`flex items-center gap-3 w-full p-4 rounded-2xl transition-all duration-300 ${
              viewMode === 'product_search'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-105'
                : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Package size={20} />
            <span className="font-black text-sm tracking-tight">品番検索レポート</span>
          </button>

          <div className="pt-8 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Reports Export
          </div>
          <button onClick={handleSavePdf} className="flex items-center gap-3 w-full p-4 rounded-2xl text-slate-400 hover:bg-slate-800 transition-all border border-transparent hover:border-slate-700">
            <div className="flex items-center gap-3 italic font-bold text-sm text-slate-200"><FileText size={18} /> PDF Export</div>
          </button>
          {viewMode !== 'product_search' && (
            <button onClick={handleSaveCsv} className="flex items-center gap-3 w-full p-4 rounded-2xl text-slate-400 hover:bg-slate-800 transition-all border border-transparent hover:border-slate-700">
              <div className="flex items-center gap-3 italic font-bold text-sm text-slate-200"><FileSpreadsheet size={18} /> CSV Export</div>
            </button>
          )}
        </nav>

        {/* Stats */}
        {rawData && (
          <div className="mb-4 p-3 bg-slate-800 rounded-2xl text-xs space-y-1">
            <div className="flex justify-between text-slate-400">
              <span>レコード数</span>
              <span className="font-mono font-bold text-slate-200">{rawData.rows.length.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>データ</span>
              <span className={`font-mono font-bold ${rawData.fromCache ? 'text-emerald-400' : 'text-red-300'}`}>
                {rawData.cacheAgeMsg || (rawData.fromCache ? 'Cache' : '最新')}
              </span>
            </div>
            {GAS_URL && (
              <div className="flex justify-between text-slate-400">
                <span>ソース</span>
                <span className="font-mono font-bold text-slate-300 text-[10px]">Spreadsheet</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {import.meta.env.VITE_PASSWORD && (
            <button onClick={handleLogout} className="flex items-center gap-3 w-full p-3 rounded-2xl text-slate-500 hover:bg-slate-800 transition-all text-xs font-bold">
              <XCircle size={16} /> ログアウト
            </button>
          )}
          <button onClick={() => setIsConfigOpen(true)} className="flex items-center gap-3 w-full p-4 rounded-2xl text-slate-400 hover:bg-slate-800 transition-all border border-slate-800">
            <Settings size={20} />
            <span className="font-bold text-sm">データソース設定</span>
          </button>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="pt-14 min-h-screen p-4 md:p-8 overflow-y-auto custom-scrollbar" ref={printRef}>
        {/* Header */}
        <header className="mb-6 md:mb-10 space-y-4 md:space-y-8 no-print">
          <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl md:text-4xl font-black text-slate-800 tracking-tighter">
                  {REPORT_TITLE}
                </h2>
                <ConnectionBadge status={connectionStatus} />
              </div>
              {GAS_URL ? (
                <div className="flex items-center gap-2 text-slate-400 font-bold text-sm bg-slate-100 w-fit px-3 py-1 rounded-lg">
                  <Database size={14} />
                  Google Spreadsheet 連携
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-400 font-bold text-sm bg-slate-100 w-fit px-3 py-1 rounded-lg">
                  <Database size={14} />
                  CSVデータ（public/data/master_data.csv）
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {loadingProgress.isSyncing && (
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-100 px-4 py-2 rounded-2xl animate-pulse">
                  <Loader2 size={14} className="animate-spin" />
                  {loadingProgress.fetchMsg}
                </div>
              )}
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className={`group flex items-center gap-2 px-5 md:px-8 py-3 md:py-4 rounded-3xl bg-slate-900 text-white font-black text-sm shadow-2xl hover:bg-red-600 transition-all duration-300 active:scale-95 disabled:opacity-50 ${isLoading ? 'animate-pulse' : ''}`}
              >
                <RefreshCcw size={16} className={isLoading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} />
                <span className="hidden sm:inline">{isLoading ? '同期中...' : '最新データに更新'}</span>
                <span className="sm:hidden">{isLoading ? '同期中' : '更新'}</span>
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white p-4 md:p-8 rounded-3xl md:rounded-[3rem] shadow-sm border border-slate-100 flex flex-wrap gap-6 md:gap-12 items-start md:items-center">
            <div className="space-y-3 w-full">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">リース会社選択</label>
              <div className="flex gap-2 flex-wrap">
                {['ALL', ...leaseCompanies].map(l => (
                  <button key={l} onClick={() => setSelectedLeaseCo(l)}
                    className={`px-4 py-2 rounded-2xl text-xs font-black transition-all duration-300 ${
                      selectedLeaseCo === l ? 'bg-red-600 text-white shadow-xl shadow-red-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                    }`}>
                    {l === 'ALL' ? 'すべて' : l}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">金額単位</label>
              <div className="flex bg-slate-100 p-1 rounded-2xl">
                {['yen', 'thousand'].map(u => (
                  <button key={u} onClick={() => setAmountUnit(u)}
                    className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all duration-300 ${amountUnit === u ? 'bg-white text-slate-800 shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                    {u === 'yen' ? '円' : '千円'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">粗利表示</label>
              <button onClick={() => setShowProfit(p => !p)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${showProfit ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                {showProfit ? <Eye size={14} /> : <EyeOff size={14} />}
                {showProfit ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">顧客検索</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center bg-white border-2 border-transparent rounded-2xl px-4 py-2 focus-within:border-red-500 transition-colors">
                  <input
                    type="text"
                    value={customerSearchQuery}
                    onChange={e => setCustomerSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearchCustomer()}
                    placeholder="顧客名で検索..."
                    className="flex-1 bg-transparent border-none text-sm focus:ring-0 text-slate-700 placeholder-slate-400"
                  />
                </div>
                <button
                  onClick={handleSearchCustomer}
                  disabled={!customerSearchQuery.trim()}
                  className="p-3 bg-red-600 text-white rounded-2xl hover:bg-red-700 disabled:bg-slate-300 transition-colors"
                >
                  <Search size={16} />
                </button>
              </div>
              {isSearchDropdownOpen && customerSearchResults.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-lg z-50 max-h-64 overflow-y-auto">
                  {customerSearchResults.map((result, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectCustomer(result)}
                      className="w-full px-4 py-3 text-left hover:bg-red-50 border-b border-slate-100 last:border-b-0 transition-colors group"
                    >
                      <div className="font-black text-slate-800 text-sm group-hover:text-red-600">{result.customerName}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {result.branchName} {result.leaseCompany && `• ${result.leaseCompany}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Loading */}
        {isLoading && !rawData && <LoadingScreen />}

        {/* Error */}
        {loadError && (
          <div className="bg-rose-50 border border-rose-200 rounded-3xl p-8 mb-8 flex items-center gap-4 animate-fade-in">
            <AlertCircle className="text-rose-500 flex-shrink-0" size={24} />
            <div>
              <h3 className="font-black text-rose-800 mb-1">データ読み込みエラー</h3>
              <p className="text-sm text-rose-600">{loadError}</p>
            </div>
          </div>
        )}

        {/* Cache Banner */}
        {rawData && !isLoading && rawData.fromCache && !loadingProgress.isSyncing && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-3xl px-8 py-5 mb-8 flex items-center justify-between animate-fade-in no-print">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-emerald-500" size={20} />
              <span className="font-bold text-emerald-800 text-sm">
                キャッシュから高速読込（{rawData.rows.length.toLocaleString()}件 / {rawData.cacheAgeMsg}）
              </span>
            </div>
            <button onClick={handleRefresh} className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-2xl text-xs font-black hover:bg-emerald-700 transition-all active:scale-95">
              <RefreshCcw size={14} /> 強制更新
            </button>
          </div>
        )}

        {/* Main Views */}
        {rawData && !isLoading && (
          <>
            {viewMode === 'dashboard' ? (
              <DashboardView
                data={currentTableData} months={months} activeView={activeView}
                hierarchyOrder={hierarchyOrder} onHierarchyOrderChange={setHierarchyOrder}
                levelInfo={levelInfo} isLeafLevel={isLeafLevel}
                checkedItems={checkedItems} onCheckedChange={setCheckedItems}
                onDrillDown={handleDrillDown} onBreadcrumb={handleBreadcrumb}
                onShowProductsDirectly={handleShowProductsDirectly}
                onSavePdf={handleSavePdf} onSaveCsv={handleSaveCsv}
                fmtAmt={fmtAmt} amountUnit={amountUnit}
                showProfit={showProfit} selectedLeaseCo={selectedLeaseCo}
                customerViewMode={customerViewMode} onCustomerViewModeChange={setCustomerViewMode}
              />
            ) : viewMode === 'product_search' ? (
              <ProductSearchView rows={filteredRows} />
            ) : (
              <PivotView
                data={pivotData} months={months} branches={branches}
                pivotBranch={pivotBranch} onBranchChange={setPivotBranch}
                pivotSort={pivotSort} onSortChange={setPivotSort}
                onSavePdf={handleSavePdf} onSaveCsv={handleSaveCsv}
                fmtAmt={fmtAmt} amountUnit={amountUnit}
                showProfit={showProfit} selectedLeaseCo={selectedLeaseCo}
              />
            )}
          </>
        )}
      </main>

      {/* Settings Modal */}
      {isConfigOpen && (
        <SettingsModal gasUrl={GAS_URL} onClose={() => setIsConfigOpen(false)} onRefresh={() => { setIsConfigOpen(false); loadData(true); }} />
      )}
    </div>
  );
};

// ===== 接続ステータスバッジ =====
const ConnectionBadge = ({ status }) => {
  const map = {
    idle:    { cls: 'bg-slate-100 text-slate-500 border-slate-200',       label: 'Standby',    Icon: CheckCircle2 },
    loading: { cls: 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse', label: 'Loading...', Icon: Loader2 },
    online:  { cls: 'bg-red-50 text-red-600 border-red-100 animate-pulse-glow', label: 'Live Sync', Icon: CheckCircle2 },
    offline: { cls: 'bg-rose-50 text-rose-600 border-rose-100',           label: 'Offline',    Icon: AlertCircle },
  };
  const { cls, label, Icon } = map[status] || map.idle;
  return (
    <div className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-black uppercase border shadow-sm ${cls}`}>
      <Icon size={12} className={status === 'loading' ? 'animate-spin' : ''} /> {label}
    </div>
  );
};

// ===== ローディング画面 =====
const LoadingScreen = () => (
  <div className="flex flex-col items-center justify-center h-96 animate-fade-in">
    <div className="relative mb-8">
      <div className="w-20 h-20 border-4 border-slate-200 rounded-full" />
      <div className="absolute top-0 left-0 w-20 h-20 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
      <Database className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-500" size={28} />
    </div>
    <h3 className="text-xl font-black text-slate-700 mb-2">データを読み込んでいます</h3>
    <p className="text-sm text-slate-400 font-bold">CSVファイルからデータを読み込み中...</p>
    <div className="flex gap-1 mt-6">
      {[0,1,2].map(i => (
        <div key={i} className="w-2 h-2 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  </div>
);

// ===== ダッシュボードビュー =====
const DashboardView = ({
  data, months, activeView, hierarchyOrder, onHierarchyOrderChange,
  levelInfo, isLeafLevel, checkedItems, onCheckedChange,
  onDrillDown, onBreadcrumb, onShowProductsDirectly, onSavePdf, onSaveCsv,
  fmtAmt, amountUnit, showProfit, selectedLeaseCo,
  customerViewMode, onCustomerViewModeChange,
}) => {
  const SectionIcon = levelInfo.icon;
  const isProductMode = customerViewMode === 'product' && activeView.branchName && activeView.secondName && !activeView.thirdName;
  const isCustomerSearchMode = isProductMode && activeView.branchName !== activeView.secondName;
  const isBranchProductMode = isProductMode && activeView.branchName === activeView.secondName;
  const monthCols = useMemo(() => months.filter(m => m !== '計'), [months]);
  const totalRow = useMemo(() => {
    if (!data.length || !months.length) return null;
    const filtered = data.filter(item => checkedItems.has(item.name));
    if (!filtered.length) return null;
    const sales = {}, profit = {};
    months.forEach(m => { sales[m] = 0; profit[m] = 0; });
    filtered.forEach(item => {
      monthCols.forEach(m => {
        sales[m] += item.sales[m] || 0;
        profit[m] += item.profit[m] || 0;
      });
    });
    let sumS = 0, sumP = 0;
    monthCols.forEach(m => { sumS += sales[m]; sumP += profit[m]; });
    sales['計'] = sumS;
    profit['計'] = sumP;
    const { branchName, secondName } = activeView;
    const label = !branchName ? '全部店 合計' : !secondName ? `${branchName} 合計` : `${secondName} 合計`;
    return { name: label, sales, profit };
  }, [data, months, monthCols, activeView, checkedItems]);

  const toggleCheck = useCallback((name) => {
    onCheckedChange(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }, [onCheckedChange]);

  return (
  <div className="space-y-4 md:space-y-8 animate-fade-in-up">
    {/* Breadcrumb */}
    <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm font-bold no-print flex-wrap">
      {isCustomerSearchMode ? (
        <>
          <button onClick={() => { onCustomerViewModeChange('orderer'); onBreadcrumb('branch'); }} className="flex items-center gap-1 transition-colors text-slate-400 hover:text-slate-600">
            <Building2 size={16} /> 部店一覧
          </button>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-red-600 flex items-center gap-1"><User size={16} /> {activeView.branchName}</span>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-red-600 flex items-center gap-1"><Package size={16} /> {activeView.secondName}</span>
        </>
      ) : isBranchProductMode ? (
        <>
          <button onClick={() => { onCustomerViewModeChange('orderer'); onBreadcrumb('branch'); }} className="flex items-center gap-1 transition-colors text-slate-400 hover:text-slate-600">
            <Building2 size={16} /> 部店一覧
          </button>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-red-600 flex items-center gap-1"><Package size={16} /> {activeView.branchName} 品番別</span>
        </>
      ) : (
        <>
          <button onClick={() => onBreadcrumb('branch')} className={`flex items-center gap-1 transition-colors ${!activeView.branchName ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <Building2 size={16} /> 部店一覧
          </button>
          {activeView.branchName && (<>
            <ChevronRight size={14} className="text-slate-300" />
            <button onClick={() => onBreadcrumb('second')} className={`flex items-center gap-1 transition-colors ${!activeView.secondName ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'}`}>
              {hierarchyOrder === 'orderer_first' ? <Store size={16} /> : <User size={16} />} {activeView.branchName}
            </button>
          </>)}
          {activeView.secondName && (<>
            <ChevronRight size={14} className="text-slate-300" />
            <button onClick={() => onBreadcrumb('third')} className={`flex items-center gap-1 transition-colors ${!activeView.thirdName ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'}`}>
              {hierarchyOrder === 'orderer_first' ? <User size={16} /> : <Store size={16} />} {activeView.secondName}
            </button>
          </>)}
          {activeView.thirdName && (<>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="text-red-600 flex items-center gap-1"><Package size={16} /> {activeView.thirdName}</span>
          </>)}
        </>
      )}
    </div>

    {/* 階層切替 + 全チェック */}
    {!isCustomerSearchMode && !isProductMode && (
      <div className="flex flex-wrap items-center gap-2 md:gap-4 no-print">
        <div className="flex items-center gap-1 bg-slate-100 rounded-2xl p-1">
          <button onClick={() => onHierarchyOrderChange('orderer_first')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black ${hierarchyOrder === 'orderer_first' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>
            <Store size={14} /> 部署→担当者→顧客
          </button>
          <button onClick={() => onHierarchyOrderChange('customer_first')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black ${hierarchyOrder === 'customer_first' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>
            <User size={14} /> 部署→顧客→担当者
          </button>
        </div>
        <div className="flex items-center gap-2 ml-8">
          <button onClick={() => onCheckedChange(new Set(data.map(d => d.name)))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 border border-transparent text-xs font-black transition-colors">
            <CheckSquare size={14} /> 全チェック
          </button>
          <button onClick={() => onCheckedChange(new Set())}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent text-xs font-black transition-colors">
            <Square size={14} /> 全解除
          </button>
        </div>
      </div>
    )}
    {(isCustomerSearchMode || isProductMode) && (
      <div className="flex items-center gap-2 no-print">
        <button onClick={() => onCheckedChange(new Set(data.map(d => d.name)))}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 border border-transparent text-xs font-black transition-colors">
          <CheckSquare size={14} /> 全チェック
        </button>
        <button onClick={() => onCheckedChange(new Set())}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent text-xs font-black transition-colors">
          <Square size={14} /> 全解除
        </button>
      </div>
    )}

    {/* Comparison Table */}
    <div className="bg-white rounded-3xl md:rounded-[3rem] shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 md:p-8 border-b border-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-slate-50/30">
        <h3 className="font-black text-slate-800 text-base md:text-xl flex items-center gap-2 flex-wrap">
          <SectionIcon className="text-red-500 flex-shrink-0" size={22} />
          <span>{isCustomerSearchMode ? `${activeView.secondName} 品番別実績（全担当者合算）` : isBranchProductMode ? `${activeView.branchName} 品番別実績（全顧客合算）` : levelInfo.title}</span>
          {selectedLeaseCo !== 'ALL' && <span className="text-red-500 text-sm">— {selectedLeaseCo}</span>}
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Calendar size={14} />
            {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </div>
          <div className="flex gap-2 no-print">
            <button onClick={onSavePdf} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-red-500 hover:border-red-200 transition-all shadow-sm text-xs font-bold">
              <FileText size={14} /> PDF
            </button>
            <button onClick={onSaveCsv} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-emerald-500 hover:border-emerald-200 transition-all shadow-sm text-xs font-bold">
              <FileSpreadsheet size={14} /> CSV
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-sm md:text-xl font-black text-white tracking-wide text-center">
              <th className="px-1 md:px-2 py-3 md:py-4 w-10 md:w-12 text-center">選択</th>
              <th className="px-3 md:px-8 py-3 md:py-4 min-w-[140px] md:min-w-[200px] text-center">
                {isCustomerSearchMode || isProductMode ? '品番' : levelInfo.label}
                {amountUnit === 'thousand' && <span className="ml-1 text-amber-400 normal-case tracking-normal text-[10px]">（千円）</span>}
              </th>
              {months.map(month => (
                <th key={month} className="px-2 md:px-6 py-3 md:py-4 text-center border-l border-slate-800 min-w-[100px] md:min-w-[auto] whitespace-nowrap">{month}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {totalRow && (
              <tr className="bg-red-50/50 border-b-2 border-red-200">
                <td className="px-1 md:px-2 py-4 w-10 md:w-12 text-center">—</td>
                <td className="px-3 md:px-8 py-4"><div className="font-black text-red-700 text-sm md:text-lg">{totalRow.name}</div></td>
                {months.map((month, mIdx) => {
                  let s, p;
                  if (month === '計') {
                    s = 0; p = 0;
                    monthCols.forEach(m => { s += totalRow.sales[m] || 0; p += totalRow.profit[m] || 0; });
                  } else {
                    s = totalRow.sales[month] || 0;
                    p = totalRow.profit[month] || 0;
                  }
                  const prevMonth = months[mIdx - 1];
                  const yoy = prevMonth && month !== '計' ? calcYoY(s, totalRow.sales[prevMonth]) : null;
                  return (
                    <td key={month} className="px-2 md:px-6 py-4 border-l border-red-200">
                      <div className="space-y-2">
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] font-black text-red-500">売上</span>
                          <div className="text-right">
                            <div className="font-mono font-black text-red-800 text-xs md:text-base">{fmtAmt(s)}</div>
                            {yoy !== null && <div className={`text-[10px] font-black flex items-center justify-end gap-0.5 ${parseFloat(yoy)>=0?'text-emerald-500':'text-rose-500'}`}>{parseFloat(yoy)>=0?<ArrowUpRight size={10}/>:<ArrowDownRight size={10}/>}{yoy}%</div>}
                          </div>
                        </div>
                        {showProfit && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] font-black text-red-500">粗利</span>
                            <div className="text-right">
                              <div className="font-mono font-black text-emerald-600 text-xs md:text-base">{fmtAmt(p)}</div>
                              <div className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-black mt-0.5 w-fit ml-auto border border-emerald-100">{calcMargin(p,s)}%</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            )}
            {data.length === 0 ? (
              <tr><td colSpan={months.length+2} className="px-4 py-12 text-center text-slate-300 italic">該当するデータがありません</td></tr>
            ) : (
              data.map((item, idx) => (
                <tr key={idx} className={`group hover:bg-red-50/30 transition-all ${!isLeafLevel && !isCustomerSearchMode?'cursor-pointer':''}`} onClick={() => !isLeafLevel && !isCustomerSearchMode && onDrillDown(item)}>
                  <td className="px-1 md:px-2 py-4 w-10 md:w-12 align-middle text-center" onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => toggleCheck(item.name)} className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-red-600 transition-colors">
                      {checkedItems.has(item.name) ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} className="text-slate-300" />}
                    </button>
                  </td>
                  <td className="px-3 md:px-8 py-4">
                    <div className="font-black text-slate-800 text-sm md:text-lg group-hover:text-red-600 transition-colors flex items-center gap-2">
                      {item.name}
                      {!isLeafLevel && !isCustomerSearchMode && !isProductMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onShowProductsDirectly(item); }}
                          className="flex items-center gap-1 px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-black transition-colors no-print"
                        >
                          <Package size={12} /> 品番
                        </button>
                      )}
                      {!isLeafLevel && !isCustomerSearchMode && !isProductMode && <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />}
                    </div>
                    {(isLeafLevel || isCustomerSearchMode || isProductMode) && item.productName && (() => {
                      const t = truncateByDisplayWidth(item.productName, 15);
                      return <div className="text-xs text-slate-500 mt-0.5 font-medium" title={t !== item.productName ? item.productName : undefined}>{t}{t !== item.productName ? '…' : ''}</div>;
                    })()}
                    {(isLeafLevel || isCustomerSearchMode || isProductMode) && (() => {
                      const qty = monthCols.reduce((acc, m) => acc + (item.quantity?.[m] || 0), 0);
                      return qty > 0 ? <div className="text-xs text-red-600 font-bold mt-0.5">受注数: {qty.toLocaleString()}</div> : null;
                    })()}
                    {!isLeafLevel && !isCustomerSearchMode && !isProductMode && <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter no-print">クリックで詳細を表示</div>}
                  </td>
                  {months.map((month, mIdx) => {
                    let s, p;
                    if (month === '計') {
                      s = 0; p = 0;
                      monthCols.forEach(m => { s += item.sales[m] || 0; p += item.profit[m] || 0; });
                    } else {
                      s = item.sales[month] || 0;
                      p = item.profit[month] || 0;
                    }
                    const prevMonth = months[mIdx - 1];
                    const yoy = prevMonth && month !== '計' ? calcYoY(s, item.sales[prevMonth]) : null;
                    return (
                      <td key={month} className="px-2 md:px-6 py-4 border-l border-slate-300 group-hover:bg-white/50">
                        <div className="space-y-2">
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] font-black text-slate-600">売上</span>
                            <div className="text-right">
                              <div className="font-mono font-black text-slate-700 text-xs md:text-base">{fmtAmt(s)}</div>
                              {yoy !== null && <div className={`text-[10px] font-black flex items-center justify-end gap-0.5 ${parseFloat(yoy)>=0?'text-emerald-500':'text-rose-500'}`}>{parseFloat(yoy)>=0?<ArrowUpRight size={10}/>:<ArrowDownRight size={10}/>}{yoy}%</div>}
                            </div>
                          </div>
                          {showProfit && (
                            <div className="flex justify-between items-baseline">
                              <span className="text-[10px] font-black text-slate-600">粗利</span>
                              <div className="text-right">
                                <div className="font-mono font-black text-emerald-600 text-xs md:text-base">{fmtAmt(p)}</div>
                                <div className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-black mt-0.5 w-fit ml-auto border border-emerald-100">{calcMargin(p,s)}%</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
};

// ===== ピボットレポートビュー =====
const PivotView = ({ data, months, branches, pivotBranch, onBranchChange, pivotSort, onSortChange, onSavePdf, onSaveCsv, fmtAmt, amountUnit, showProfit, selectedLeaseCo }) => {
  const monthCols = months.filter(m => m !== '計');
  const titleParts = [selectedLeaseCo !== 'ALL' ? selectedLeaseCo : null, pivotBranch !== 'ALL' ? pivotBranch : null].filter(Boolean);
  const titleSuffix = titleParts.length > 0 ? titleParts.join(' — ') : null;
  return (
  <div className="space-y-8 animate-fade-in-up">
    <div className="bg-white p-6 rounded-[3rem] shadow-sm border border-slate-100 no-print">
      <div className="space-y-3">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">部店で絞り込み</label>
        <div className="flex gap-2 flex-wrap">
          {['ALL', ...branches].map(b => (
            <button key={b} onClick={() => onBranchChange(b)}
              className={`px-6 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${pivotBranch === b ? 'bg-red-600 text-white shadow-xl shadow-red-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
              {b === 'ALL' ? 'すべて' : b}
            </button>
          ))}
        </div>
      </div>
    </div>

    <div className="bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
      <div className="p-8 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-600 text-white rounded-xl shadow-lg shadow-red-100"><ListFilter size={20} /></div>
          <div>
            <h3 className="font-black text-slate-800 text-xl tracking-tighter">
              一括網羅ピボットレポート
              {titleSuffix && <span className="text-red-500 ml-2 text-base">— {titleSuffix}</span>}
            </h3>
            <p className="text-[10px] font-bold text-red-500 mt-0.5 uppercase tracking-widest italic">
              Unified Comprehensive View &middot; {data.length} records
              {amountUnit === 'thousand' && <span className="ml-2 text-amber-500 normal-case">（単位：千円）</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Calendar size={14} /> 出力日: {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </div>
          <div className="flex gap-2 no-print">
            <button onClick={onSavePdf} className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-red-500 hover:border-red-200 transition-all shadow-sm text-sm font-bold"><FileText size={16} /> PDF</button>
            <button onClick={onSaveCsv} className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-emerald-500 hover:border-emerald-200 transition-all shadow-sm text-sm font-bold"><FileSpreadsheet size={16} /> CSV</button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse pivot-table">
          <thead>
            <tr className="bg-slate-900 text-xl font-black text-white tracking-wide text-center">
              <th className="px-4 py-4 text-center border-r border-slate-800 min-w-[110px] sticky left-0 bg-slate-900 z-10">
                <button onClick={() => onSortChange('lease')} className={`w-full flex items-center justify-center gap-1 transition-colors ${pivotSort==='lease'?'text-red-300':'text-white hover:text-red-300'}`}>
                  リース会社 {pivotSort==='lease'&&<ArrowUpDown size={12}/>}
                </button>
              </th>
              <th className="px-4 py-4 text-center border-r border-slate-800 min-w-[120px]">
                <button onClick={() => onSortChange('orderer')} className={`w-full flex items-center justify-center gap-1 transition-colors ${pivotSort==='orderer'?'text-red-300':'text-white hover:text-red-300'}`}>
                  注文者 {pivotSort==='orderer'&&<ArrowUpDown size={12}/>}
                </button>
              </th>
              <th className="px-4 py-4 text-center border-r border-slate-800 min-w-[200px]">
                <button onClick={() => onSortChange('customer')} className={`w-full flex items-center justify-center gap-1 transition-colors ${pivotSort==='customer'?'text-red-300':'text-white hover:text-red-300'}`}>
                  顧客名 {pivotSort==='customer'&&<ArrowUpDown size={12}/>}
                </button>
              </th>
              {months.map(month =>
                month === '計' ? (
                  <th key={month} className="px-3 py-4 border-l border-slate-700 bg-slate-800 min-w-[130px]">
                    <div className="flex flex-col gap-1 items-center">
                      <button onClick={() => onSortChange('sales')} className={`flex items-center gap-1 text-xs font-black transition-colors ${pivotSort==='sales'?'text-red-300':'text-slate-300 hover:text-red-300'}`}>
                        計（売上）{pivotSort==='sales'&&<ArrowUpDown size={11}/>}
                      </button>
                      <button onClick={() => onSortChange('profit')} className={`flex items-center gap-1 text-[11px] font-black transition-colors ${pivotSort==='profit'?'text-emerald-300':'text-slate-400 hover:text-emerald-300'}`}>
                        計（粗利）{pivotSort==='profit'&&<ArrowUpDown size={11}/>}
                      </button>
                    </div>
                  </th>
                ) : (
                  <th key={month} className="px-3 py-4 border-l border-slate-800 min-w-[120px] whitespace-nowrap">{month}</th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300">
            {data.length === 0 ? (
              <tr><td colSpan={2+months.length} className="px-8 py-16 text-center text-slate-300 italic">該当するデータがありません</td></tr>
            ) : (
              data.map((row, idx) => (
                <tr key={idx} className="hover:bg-red-50/50 transition-colors">
                  <td className="px-4 py-3 border-r border-slate-300 sticky left-0 bg-white z-10 font-black text-slate-800 text-sm whitespace-nowrap">{row.lease}</td>
                  <td className="px-4 py-3 border-r border-slate-300 font-black text-slate-800 text-sm">{row.orderer}</td>
                  <td className="px-4 py-3 border-r border-slate-300">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                      <span className="font-black text-slate-800 text-sm">{row.customer}</span>
                    </div>
                  </td>
                  {months.map((month, mIdx) => {
                    let s, p;
                    if (month === '計') {
                      s = 0; p = 0;
                      monthCols.forEach(m => { s += row.sales[m] || 0; p += row.profit[m] || 0; });
                    } else {
                      s = row.sales[month] || 0;
                      p = row.profit[month] || 0;
                    }
                    const prevMonth = months[mIdx - 1];
                    const yoy = prevMonth && month !== '計' ? calcYoY(s, row.sales[prevMonth]) : null;
                    return (
                      <td key={month} className="px-3 py-3 border-l border-slate-300 bg-white/40">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex justify-between items-baseline">
                            <span className="text-[9px] font-black text-slate-400">売上</span>
                            <span className="font-mono font-black text-slate-700 text-[13px]">{fmtAmt(s)}</span>
                          </div>
                          {showProfit && (<>
                            <div className="flex justify-between items-baseline border-t border-slate-50 pt-0.5">
                              <span className="text-[9px] font-black text-slate-400">粗利</span>
                              <span className="font-mono font-black text-emerald-600 text-[13px]">{fmtAmt(p)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <div className="px-1 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[9px] font-black">{calcMargin(p,s)}%</div>
                              {yoy !== null && <div className={`text-[9px] font-black flex items-center gap-0.5 ${parseFloat(yoy)>=0?'text-emerald-500':'text-rose-500'}`}>{parseFloat(yoy)>=0?<ArrowUpRight size={10}/>:<ArrowDownRight size={10}/>}{yoy}%</div>}
                            </div>
                          </>)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
};

// ===== 品番検索レポートビュー =====
const ProductSearchView = ({ rows }) => {
  const [searchInput, setSearchInput] = useState('');
  const [selectedCodes, setSelectedCodes] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pre' | 'shipped'
  const [drillLease, setDrillLease] = useState(null);
  const [drillBranch, setDrillBranch] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const searchRef = useRef(null);

  // 入力に部分一致する品番候補（全データから）
  const matchingCodes = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return [];
    const map = {};
    rows.forEach(r => {
      if (r.productCode != null) {
        const code = r.productCode.toString();
        if (code.toLowerCase().includes(q)) {
          if (!map[code]) map[code] = r.productName || '';
        }
      }
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, searchInput]);

  // フォーカスがあり候補があれば表示（コピペにも確実対応）
  const isDropdownOpen = isInputFocused && matchingCodes.length > 0 && searchInput.trim() !== '';

  const toggleCode = (code) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setDrillLease(null);
    setDrillBranch(null);
  };

  const removeCode = (code) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
    setDrillLease(null);
    setDrillBranch(null);
  };

  const selectAll = () => {
    const allCodes = new Set([...selectedCodes, ...matchingCodes.map(([c]) => c)]);
    setSelectedCodes(allCodes);
    setDrillLease(null);
    setDrillBranch(null);
  };

  // ステータス判定
  const matchStatus = (r) => {
    const s = Number(r.status);
    if (statusFilter === 'pre')     return s === 4;
    if (statusFilter === 'shipped') return s === 5 || s === 6;
    return true;
  };

  // 品番＋ステータスでフィルタ済みの行
  const productRows = useMemo(() => {
    if (selectedCodes.size === 0) return [];
    return rows.filter(r =>
      r.productCode != null &&
      selectedCodes.has(r.productCode.toString()) &&
      matchStatus(r)
    );
  }, [rows, selectedCodes, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // 選択品番の品名マップ
  const productNameMap = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      if (r.productCode != null && r.productName) {
        m[r.productCode.toString()] = r.productName;
      }
    });
    return m;
  }, [rows]);

  // 納車年月の列一覧（古い順→左）
  const deliveryMonths = useMemo(() => {
    const map = {};
    productRows.forEach(r => {
      if (r.deliveryYM && r.deliverySortKey != null) {
        map[r.deliveryYM] = r.deliverySortKey;
      }
    });
    return Object.keys(map).sort((a, b) => map[a] - map[b]);
  }, [productRows]);

  const isLeaseLevel    = !drillLease;
  const isBranchLevel   = !!drillLease && !drillBranch;
  const isCustomerLevel = !!drillLease && !!drillBranch;
  const levelLabel = isCustomerLevel ? '顧客名' : isBranchLevel ? '部店名' : 'リース会社';

  // 年グループ（"25年" → ["25年10月", ...]）
  const yearGroups = useMemo(() => {
    const map = new Map();
    deliveryMonths.forEach(ym => {
      const year = ym.replace(/\d+月$/, '');
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(ym);
    });
    return [...map.entries()].map(([year, months]) => ({ year, months }));
  }, [deliveryMonths]);

  const [expandedYears, setExpandedYears] = useState(new Set());
  const toggleYear = (year) => {
    setExpandedYears(prev => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  };

  // yearGroups変化時（品番変更）はリセット
  useEffect(() => { setExpandedYears(new Set()); }, [yearGroups]);

  // 集計
  const displayRows = useMemo(() => {
    let filtered = productRows;
    if (drillLease)  filtered = filtered.filter(r => r.leaseCompany === drillLease);
    if (drillBranch) filtered = filtered.filter(r => r.branch === drillBranch);

    const groupKey = isCustomerLevel ? 'customerName' : isBranchLevel ? 'branch' : 'leaseCompany';
    const map = {};
    filtered.forEach(r => {
      const key = r[groupKey] || '(未分類)';
      if (!map[key]) map[key] = { name: key, quantity: {}, orderers: new Set() };
      if (r.deliveryYM) {
        map[key].quantity[r.deliveryYM] = (map[key].quantity[r.deliveryYM] || 0) + (Number(r.quantity) || 0);
      }
      if (isCustomerLevel && r.ordererName) map[key].orderers.add(r.ordererName);
    });

    return Object.values(map).map(item => ({
      ...item,
      ordererStr: [...item.orderers].join('・'),
      total: Object.values(item.quantity).reduce((s, v) => s + v, 0),
    })).sort((a, b) => b.total - a.total);
  }, [productRows, drillLease, drillBranch, isCustomerLevel, isBranchLevel]);

  const handleDrill = (name) => {
    if (isCustomerLevel) return;
    if (isLeaseLevel) setDrillLease(name);
    else setDrillBranch(name);
  };

  const totalQty = displayRows.reduce((s, r) => s + r.total, 0);

  // CSV エクスポート（選択品番全体・出荷区分列付き）
  const handleExportCsv = () => {
    if (selectedCodes.size === 0) return;

    // ステータスフィルター無視で全データを出力（出荷区分列で判別）
    const exportSrc = rows.filter(r =>
      r.productCode != null && selectedCodes.has(r.productCode.toString())
    );

    // 納車年月→ソートキー マップ
    const ymSortKey = {};
    exportSrc.forEach(r => {
      if (r.deliveryYM && r.deliverySortKey != null) ymSortKey[r.deliveryYM] = r.deliverySortKey;
    });

    // 出荷区分ラベル
    const shippingLabel = (s) => {
      const n = Number(s);
      if (n === 4) return '出荷前';
      if (n === 5 || n === 6) return '出荷済み';
      return 'その他';
    };

    // 集計キーでグループ化（伝票番号は明細ごとに保持）
    const details = [];
    exportSrc.forEach(r => {
      const sl = shippingLabel(r.status);
      details.push({
        productCode:    r.productCode    || '',
        leaseCompany:   r.leaseCompany   || '',
        branch:         r.branch         || '',
        customerName:   r.customerName   || '',
        ordererName:    r.ordererName    || '',
        deliveryYM:     r.deliveryYM     || '',
        deliverySortKey: r.deliverySortKey || 0,
        shippingLabel:  sl,
        quantity:       Number(r.quantity) || 0,
        documentNumber: r.documentNumber || '',
        car:            r.car || '',
      });
    });

    const data = details.sort((a, b) =>
      a.leaseCompany.localeCompare(b.leaseCompany, 'ja') ||
      a.branch.localeCompare(b.branch, 'ja') ||
      a.customerName.localeCompare(b.customerName, 'ja') ||
      a.ordererName.localeCompare(b.ordererName, 'ja') ||
      a.deliverySortKey - b.deliverySortKey
    );

    const headers = ['品番', 'リース会社', '部店', '顧客', '担当者', '納車年月', '出荷区分', '受注数', '伝票番号', '車種'];
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csvRows = [
      headers.map(q).join(','),
      ...data.map(r => [
        r.productCode, r.leaseCompany, r.branch,
        r.customerName, r.ordererName, r.deliveryYM,
        r.shippingLabel, r.quantity, r.documentNumber, r.car,
      ].map(q).join(',')),
    ];

    const blob = new Blob(['\uFEFF' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `品番受注明細_${[...selectedCodes].join('-')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* 検索＋ステータスフィルターパネル */}
      <div className="bg-white p-6 rounded-[3rem] shadow-sm border border-slate-100 space-y-5">

        {/* 品番あいまい検索 */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">品番で検索（部分一致・複数選択可）</label>
          <div className="relative" ref={searchRef}>
            <div className="flex items-center bg-slate-50 border-2 border-transparent rounded-2xl px-4 py-2 focus-within:border-red-500 transition-colors">
              <Package size={16} className="text-slate-400 mr-2 flex-shrink-0" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setTimeout(() => setIsInputFocused(false), 180)}
                placeholder="例：DRV-MR（部分一致で候補が表示されます）"
                className="flex-1 bg-transparent border-none text-sm focus:ring-0 text-slate-700 placeholder-slate-400 font-bold"
              />
              {searchInput && (
                <button onClick={() => { setSearchInput(''); setIsInputFocused(false); }} className="text-slate-400 hover:text-slate-600 ml-1">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* 候補ドロップダウン */}
            {isDropdownOpen && matchingCodes.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{matchingCodes.length} 件一致</span>
                  <button onClick={selectAll} className="text-[11px] font-black text-red-600 hover:text-red-700 flex items-center gap-1">
                    <CheckSquare size={12} /> 全て追加
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {matchingCodes.map(([code, name]) => (
                    <button
                      key={code}
                      onClick={() => toggleCode(code)}
                      className="w-full px-4 py-2.5 text-left hover:bg-red-50 border-b border-slate-50 last:border-b-0 transition-colors flex items-center gap-3 group"
                    >
                      {selectedCodes.has(code)
                        ? <CheckSquare size={15} className="text-emerald-500 flex-shrink-0" />
                        : <Square size={15} className="text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
                      }
                      <div>
                        <div className="font-black text-slate-800 text-sm group-hover:text-red-600">{code}</div>
                        {name && <div className="text-[11px] text-slate-400 font-bold">{name}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 選択中の品番タグ */}
        {selectedCodes.size > 0 && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">選択中の品番</label>
            <div className="flex flex-wrap gap-2">
              {[...selectedCodes].map(code => (
                <div key={code} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-xl">
                  <span className="text-xs font-black text-red-700">{code}</span>
                  {productNameMap[code] && <span className="text-[10px] text-red-400 font-bold">{productNameMap[code]}</span>}
                  <button onClick={() => removeCode(code)} className="text-red-400 hover:text-red-600 ml-0.5">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => { setSelectedCodes(new Set()); setDrillLease(null); setDrillBranch(null); }}
                className="px-3 py-1.5 text-[11px] font-black text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                全解除
              </button>
            </div>
          </div>
        )}

        {/* ステータスフィルター */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">ステータス</label>
          <div className="flex bg-slate-100 p-1 rounded-2xl w-fit">
            {[
              { key: 'all',     label: '全部' },
              { key: 'pre',     label: '出荷前' },
              { key: 'shipped', label: '出荷済み' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-5 py-2 rounded-xl text-xs font-black transition-all duration-200 ${statusFilter === key ? 'bg-white text-slate-800 shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 結果テーブル */}
      {selectedCodes.size > 0 && (
        <div className="bg-white rounded-[3rem] shadow-sm border border-slate-100 overflow-hidden">
          {/* ヘッダー */}
          <div className="p-6 md:p-8 border-b border-slate-50 bg-slate-50/30 flex flex-col md:flex-row md:justify-between md:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-600 text-white rounded-xl shadow-lg shadow-red-100">
                <Package size={20} />
              </div>
              <div>
                <h3 className="font-black text-slate-800 text-lg tracking-tighter">
                  {[...selectedCodes].join('・')}
                </h3>
                <p className="text-[10px] font-bold text-red-500 mt-0.5 uppercase tracking-widest italic">
                  Product Order History &middot; {productRows.length} records &middot; 合計 {totalQty.toLocaleString()} 台
                  {statusFilter !== 'all' && <span className="ml-2 text-amber-500 normal-case">（{statusFilter === 'pre' ? '出荷前のみ' : '出荷済みのみ'}）</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* パンくず */}
              <div className="flex items-center gap-1.5 text-xs font-bold flex-wrap">
                <button
                  onClick={() => { setDrillLease(null); setDrillBranch(null); }}
                  className={`flex items-center gap-1 transition-colors ${isLeaseLevel ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Building2 size={14} /> リース会社
                </button>
                {drillLease && (<>
                  <ChevronRight size={12} className="text-slate-300" />
                  <button
                    onClick={() => setDrillBranch(null)}
                    className={`flex items-center gap-1 transition-colors ${isBranchLevel ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <Building2 size={14} /> {drillLease}
                  </button>
                </>)}
                {drillBranch && (<>
                  <ChevronRight size={12} className="text-slate-300" />
                  <span className="text-red-600 flex items-center gap-1"><User size={14} /> {drillBranch}</span>
                </>)}
              </div>
              {/* CSV出力ボタン */}
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-300 transition-all shadow-sm text-xs font-bold no-print"
              >
                <FileSpreadsheet size={14} /> CSV出力
              </button>
            </div>
          </div>

          {productRows.length === 0 ? (
            <div className="px-8 py-16 text-center text-slate-300 italic text-sm">該当するデータがありません</div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  {/* 年ヘッダー行 */}
                  <tr className="bg-slate-900 text-white text-xs font-black tracking-wide">
                    <th rowSpan={2} className="px-4 md:px-6 py-4 min-w-[180px] sticky left-0 bg-slate-900 z-10 border-r border-slate-800 align-middle">
                      {levelLabel}
                      {isCustomerLevel && <span className="ml-2 text-slate-400 font-bold normal-case">（担当者）</span>}
                    </th>
                    {yearGroups.map(({ year, months }) => (
                      <th
                        key={year}
                        colSpan={expandedYears.has(year) ? months.length : 1}
                        onClick={() => toggleYear(year)}
                        className="px-3 py-3 text-center border-l border-slate-700 whitespace-nowrap cursor-pointer hover:bg-slate-700 transition-colors select-none"
                        style={{ minWidth: expandedYears.has(year) ? undefined : '72px' }}
                      >
                        <span className="flex items-center justify-center gap-1">
                          {year}
                          <span className="text-slate-400 text-[10px]">{expandedYears.has(year) ? '▼' : '▶'}</span>
                        </span>
                      </th>
                    ))}
                    <th rowSpan={2} className="px-4 py-4 text-center border-l border-slate-700 bg-slate-800 min-w-[72px] whitespace-nowrap align-middle">合計</th>
                  </tr>
                  {/* 月ヘッダー行（展開中の年のみ） */}
                  <tr className="bg-slate-800 text-white text-[11px] font-bold">
                    {yearGroups.map(({ year, months }) =>
                      expandedYears.has(year)
                        ? months.map(m => (
                            <th key={m} className="px-2 py-2 text-center border-l border-slate-700 whitespace-nowrap min-w-[64px] text-slate-300">
                              {m.replace(year, '')}
                            </th>
                          ))
                        : null
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* 合計行 */}
                  <tr className="bg-red-50/60 border-b-2 border-red-200">
                    <td className="px-4 md:px-6 py-3 sticky left-0 bg-red-50/60 z-10 border-r border-red-200">
                      <span className="font-black text-red-700 text-sm">
                        {isCustomerLevel ? `${drillBranch} 合計` : isBranchLevel ? `${drillLease} 合計` : '全体 合計'}
                      </span>
                    </td>
                    {yearGroups.map(({ year, months }) => {
                      if (expandedYears.has(year)) {
                        return months.map(m => {
                          const sum = displayRows.reduce((s, r) => s + (r.quantity[m] || 0), 0);
                          return (
                            <td key={m} className="px-3 py-3 text-center border-l border-red-200">
                              <span className="font-mono font-black text-red-800 text-sm">{sum > 0 ? sum.toLocaleString() : '—'}</span>
                            </td>
                          );
                        });
                      }
                      const yearSum = months.reduce((s, m) => s + displayRows.reduce((a, r) => a + (r.quantity[m] || 0), 0), 0);
                      return (
                        <td key={year} className="px-3 py-3 text-center border-l border-red-200">
                          <span className="font-mono font-black text-red-800 text-sm">{yearSum > 0 ? yearSum.toLocaleString() : '—'}</span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center border-l border-red-300 bg-red-100/50">
                      <span className="font-mono font-black text-red-800 text-sm">{totalQty.toLocaleString()}</span>
                    </td>
                  </tr>

                  {displayRows.map((row, idx) => (
                    <tr
                      key={idx}
                      onClick={() => handleDrill(row.name)}
                      className={`group transition-all ${!isCustomerLevel ? 'cursor-pointer hover:bg-red-50/30' : 'hover:bg-slate-50/50'}`}
                    >
                      <td className="px-4 md:px-6 py-3 sticky left-0 bg-white z-10 border-r border-slate-100 group-hover:bg-inherit">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-800 text-sm group-hover:text-red-600 transition-colors">{row.name}</span>
                          {isCustomerLevel && row.ordererStr && (
                            <span className="text-[11px] text-slate-500 font-bold bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">{row.ordererStr}</span>
                          )}
                          {!isCustomerLevel && (
                            <ChevronRight size={13} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-all -translate-x-1 group-hover:translate-x-0 flex-shrink-0" />
                          )}
                        </div>
                      </td>
                      {yearGroups.map(({ year, months }) => {
                        if (expandedYears.has(year)) {
                          return months.map(m => {
                            const qty = row.quantity[m] || 0;
                            return (
                              <td key={m} className="px-3 py-3 text-center border-l border-slate-100">
                                {qty > 0
                                  ? <span className="font-mono font-black text-slate-700 text-sm">{qty.toLocaleString()}</span>
                                  : <span className="text-slate-200 text-xs">—</span>
                                }
                              </td>
                            );
                          });
                        }
                        const yearQty = months.reduce((s, m) => s + (row.quantity[m] || 0), 0);
                        return (
                          <td key={year} className="px-3 py-3 text-center border-l border-slate-100">
                            {yearQty > 0
                              ? <span className="font-mono font-black text-slate-700 text-sm">{yearQty.toLocaleString()}</span>
                              : <span className="text-slate-200 text-xs">—</span>
                            }
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center border-l border-slate-200 bg-slate-50/50">
                        <span className="font-mono font-black text-slate-600 text-sm">{row.total > 0 ? row.total.toLocaleString() : '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ===== 設定モーダル =====
const SettingsModal = ({ gasUrl, onClose, onRefresh }) => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
    <div className="bg-white rounded-[3rem] w-full max-w-xl shadow-2xl animate-scale-in overflow-hidden">
      <div className="p-10 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
        <div>
          <h3 className="text-2xl font-black text-slate-800">データソース設定</h3>
          <p className="text-[10px] text-slate-400 font-black uppercase mt-1 tracking-widest">CSV Configuration</p>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-600 hover:shadow-md transition-all">
          <XCircle size={20} />
        </button>
      </div>
      <div className="p-10 space-y-6">
        <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Database size={14} className="text-red-500" /> データソース
          </label>
          <div className={`text-sm font-bold px-4 py-3 rounded-2xl ${gasUrl ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
            {gasUrl ? `GAS URL: ${gasUrl}` : 'CSV モード（public/data/master_data.csv）'}
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed italic px-1">
            データを更新するには <code className="bg-slate-100 px-1 py-0.5 rounded">public/data/master_data.csv</code> を差し替えてデプロイしてください。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-5 bg-red-50 rounded-3xl border border-red-100">
            <div className="w-8 h-8 bg-red-600 text-white rounded-xl flex items-center justify-center mb-3 shadow-md shadow-red-200"><CheckCircle2 size={16} /></div>
            <h4 className="text-xs font-black text-red-900 mb-1">IndexedDB キャッシュ</h4>
            <p className="text-[10px] text-red-700 leading-normal font-bold">ブラウザにデータをキャッシュし、2回目以降の表示を高速化します。</p>
          </div>
          <div className="p-5 bg-emerald-50 rounded-3xl border border-emerald-100">
            <div className="w-8 h-8 bg-emerald-600 text-white rounded-xl flex items-center justify-center mb-3 shadow-md shadow-emerald-200"><FileText size={16} /></div>
            <h4 className="text-xs font-black text-emerald-900 mb-1">CSV 運用</h4>
            <p className="text-[10px] text-emerald-700 leading-normal font-bold">スプレッドシートから CSV をダウンロードして配置するだけで更新できます。</p>
          </div>
        </div>
      </div>
      <div className="p-10 pt-0">
        <button onClick={onRefresh} className="w-full bg-slate-900 text-white py-5 rounded-[1.5rem] font-black shadow-2xl shadow-slate-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 hover:bg-red-600">
          <RefreshCcw size={18} /> キャッシュをクリアして再読込
        </button>
      </div>
    </div>
  </div>
);

export default App;
