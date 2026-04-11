import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  ChevronRight, Building2, Settings, User, Store,
  ArrowUpRight, ArrowDownRight, LayoutDashboard, Database,
  Calendar, FolderOpen, RefreshCcw, CheckCircle2, FileText, FileSpreadsheet,
  ListFilter, AlertCircle, Loader2, XCircle, ChevronLeft, ArrowUpDown, Eye, EyeOff,
  CheckSquare, Square, Package, ShieldAlert, Lock, LogOut, Check
} from 'lucide-react';
import { getCache, setCache, clearCache } from './utils/db';
import {
  filterRows, aggregateByBranch, aggregateByOrderer, aggregateByCustomer,
  aggregateByCustomerInBranch, aggregateByOrdererForCustomer,
  aggregateByBranchByMonth, aggregateByOrdererByMonth, aggregateByCustomerByMonth,
  aggregateByCustomerInBranchByMonth, aggregateByOrdererForCustomerByMonth,
  aggregateByProductByMonth,
  generatePivotData, generatePivotDataByMonth, calcYoY, calcMargin, formatCurrency, formatCurrencyFull,
  generateCsvContent,
} from './utils/aggregator';

// GAS Web App URL (ご自身の環境に合わせて設定するか、.envファイルを使用してください)
const GAS_URL = import.meta.env.VITE_GAS_URL || ''; // 'https://script.google.com/macros/s/.../exec'

// デフォルト表示用（WEB版）
const DEFAULT_PATH = 'Google Spreadsheet API 連携';

/** 表示幅: 全角相当=1、ASCII・半角カナ等=0.5（全角15文字分まで） */
function charDisplayUnit(ch) {
  const c = ch.codePointAt(0);
  if (c <= 0x007e) return 0.5;
  if (c >= 0xff61 && c <= 0xff9f) return 0.5;
  if (c >= 0xffe8 && c <= 0xffee) return 0.5;
  return 1;
}

function truncateByDisplayWidth(str, maxUnits) {
  if (!str) return '';
  let units = 0;
  let out = '';
  for (const ch of str) {
    const u = charDisplayUnit(ch);
    if (units + u > maxUnits) break;
    out += ch;
    units += u;
  }
  return out;
}
const PASSWORD = '19627004'; // 指定されたパスワード

const App = () => {
  // ===== Auth State =====
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('kasouhin_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  // ===== State =====
  const [networkPath, setNetworkPath] = useState(DEFAULT_PATH);
  const [rawData, setRawData] = useState(null); // { rows, years, leaseCompanies, fileCount, totalRows }
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ fetchMsg: '', isSyncing: false });
  const [loadError, setLoadError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle'); // idle | online | offline | loading

  const [selectedLeaseCo, setSelectedLeaseCo] = useState('ALL');
  const [monthRange, setMonthRange] = useState({ start: '4', end: '3' });
  const [viewMode, setViewMode] = useState('dashboard'); // dashboard | pivot_report
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [amountUnit, setAmountUnit] = useState('yen'); // 'yen' | 'thousand'
  const [pivotBranch, setPivotBranch] = useState('ALL');
  const [pivotSort, setPivotSort] = useState('sales'); // 'sales' | 'orderer' | 'customer'
  const [showProfit, setShowProfit] = useState(true);
  const [hierarchyOrder, setHierarchyOrder] = useState('orderer_first'); // 'orderer_first' | 'customer_first'
  const [checkedItems, setCheckedItems] = useState(new Set()); // チェックで選択された項目（合計に反映）
  const [activeView, setActiveView] = useState({ branchName: null, secondName: null, thirdName: null }); // branchName必須、secondName担当者or顧客、thirdName顧客or担当者

  const printRef = useRef(null);

  // 金額フォーマット（単位切替対応）
  const fmtAmt = useCallback((val) => {
    if (amountUnit === 'thousand') {
      const v = Math.round((val || 0) / 1000);
      return `¥${v.toLocaleString()}`;
    }
    return formatCurrencyFull(val);
  }, [amountUnit]);

  const fmtAmtShort = useCallback((val) => {
    if (amountUnit === 'thousand') {
      const v = (val || 0) / 1000;
      if (Math.abs(v) >= 100000) return `¥${(v / 10000).toFixed(0)}万`;
      return `¥${Math.round(v).toLocaleString()}`;
    }
    return formatCurrency(val);
  }, [amountUnit]);

  // ===== データ読み込み (IndexedDB + ページネーション) =====
  const CACHE_KEY = 'kasouhin_500_data_v1';

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!GAS_URL) {
      loadMockData();
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
        if (cached && cached.data) {
          currentRows = cached.data.rows || [];
          currentOffset = currentRows.length;
          
          const cacheAgeMs = Date.now() - cached.timestamp;
          const cacheAgeMin = Math.floor(cacheAgeMs / 60000);
          
          setRawData({
            rows: currentRows,
            years: cached.data.years || [],
            leaseCompanies: cached.data.leaseCompanies || [],
            fromCache: true,
            cacheAgeMsg: `${cacheAgeMin}分前のデータ`,
          });
          setConnectionStatus('online'); // 一旦オンライン表示にして裏で同期
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

          const totalRowsInSheet = result.data.totalRows;
          if (currentOffset >= totalRowsInSheet || newRows.length === 0) {
            hasMore = false;
          } else {
            setLoadingProgress({ fetchMsg: `${currentOffset} / ${totalRowsInSheet} 件を同期中...`, isSyncing: true });
          }
        } else {
          throw new Error(result.error);
        }
      }

      if (fetchedAny || forceRefresh) {
        // 新しい年とリース会社を再計算
        const yearsSet = new Set();
        const leaseSet = new Set();
        currentRows.forEach(r => {
          if (r.fiscalYear) yearsSet.add(r.fiscalYear);
          if (r.leaseCompany) leaseSet.add(r.leaseCompany);
        });

        const finalData = {
          rows: currentRows,
          years: Array.from(yearsSet).sort((a,b)=>a-b),
          leaseCompanies: Array.from(leaseSet).sort()
        };

        await setCache(CACHE_KEY, { data: finalData, timestamp: Date.now() });
        setRawData({ ...finalData, fromCache: false, cacheAgeMsg: '最新' });
      } else {
        // 更新なし
        if (rawData) {
          setRawData(prev => ({ ...prev, cacheAgeMsg: '最新' }));
        }
      }

      setConnectionStatus('online');
      setLoadError(null);
    } catch (err) {
      if (rawData) {
        setLoadError('追加データの取得に失敗しました。キャッシュデータを表示中です。');
      } else {
        setLoadError('データの取得に失敗しました。ネットワーク環境をご確認ください。');
        setConnectionStatus('offline');
      }
    } finally {
      setIsLoading(false);
      setLoadingProgress({ fetchMsg: '', isSyncing: false });
    }
  }, [rawData]);

  // モックデータ（開発・デモ用）
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
      const reps = ['土岐 暁治', '犬塚 龍', '山本 太郎', '佐藤 花子', '田中 一郎'];

      // 直近3ヶ月のデータを生成
      const today = new Date();
      const last3 = [];
      for (let i = 2; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        last3.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }
      for (let i = 0; i < 500; i++) {
        const ymEntry = last3[Math.floor(Math.random() * last3.length)];
        const sales = Math.floor(Math.random() * 500000) + 50000;
        const profitRate = 0.15 + Math.random() * 0.2;
        mockRows.push({
          leaseCompany: leases[Math.floor(Math.random() * leases.length)],
          branch: branches[Math.floor(Math.random() * branches.length)],
          ordererName: orderers[Math.floor(Math.random() * orderers.length)],
          customerName: customers[Math.floor(Math.random() * customers.length)],
          rep: reps[Math.floor(Math.random() * reps.length)],
          sales,
          profit: Math.floor(sales * profitRate),
          fiscalYear: ymEntry.month >= 4 ? ymEntry.year : ymEntry.year - 1,
          month: ymEntry.month,
          calendarYear: ymEntry.year,
          sourceFile: 'mock_data.xlsx',
        });
      }

      setRawData({
        rows: mockRows,
        years,
        leaseCompanies: leases,
        fileCount: 3,
        totalRows: mockRows.length,
      });
      setConnectionStatus('online');
      setIsLoading(false);
    }, 1200);
  }, []);

  // 初回読み込み
  useEffect(() => {
    loadData();
  }, []);

  // 直近3ヶ月を計算する関数
  const getLast3Months = useCallback(() => {
    let refDate = new Date();
    if (rawData && rawData.rows && rawData.rows.length > 0) {
      let maxTime = 0;
      rawData.rows.forEach(r => {
        if (r.calendarYear && r.month) {
          const t = new Date(r.calendarYear, r.month - 1, 1).getTime();
          if (t > maxTime) maxTime = t;
        }
      });
      if (maxTime > 0) {
        refDate = new Date(maxTime);
      }
    }

    const month = refDate.getMonth() + 1; // 1-12
    const months = [];
    for (let i = 2; i >= 0; i--) {
      let m = month - i;
      if (m <= 0) m += 12;
      months.push(m);
    }
    return months;
  }, [rawData]);

  // データ読み込み後に直近3ヶ月を自動設定
  useEffect(() => {
    if (!rawData || !rawData.rows.length) return;
    const last3Months = getLast3Months();
    setMonthRange({
      start: String(last3Months[0]),
      end: String(last3Months[last3Months.length - 1])
    });
  }, [rawData, getLast3Months]);

  // 階層順の変更時は secondName・thirdName をリセット（部署は選択しっぱなし）
  useEffect(() => {
    setActiveView(prev => ({ ...prev, secondName: null, thirdName: null }));
  }, [hierarchyOrder]);


  // ===== フィルタ済みデータ =====
  const filteredRows = useMemo(() => {
    if (!rawData) return [];
    let rows = rawData.rows;

    // 「空白」と「その他」を除外
    rows = rows.filter(r => r.leaseCompany && r.leaseCompany.trim() && r.leaseCompany !== '空白' && r.leaseCompany !== 'その他');

    return filterRows(rows, {
      leaseCompany: selectedLeaseCo,
      startMonth: monthRange.start,
      endMonth: monthRange.end,
    });
  }, [rawData, selectedLeaseCo, monthRange]);

  const years = useMemo(() => rawData?.years || [], [rawData]);

  // リース会社フィルタ：「空白」と「その他」を除外
  const leaseCompanies = useMemo(() => {
    if (!rawData?.leaseCompanies) return [];
    return rawData.leaseCompanies.filter(lc => lc && lc.trim() && lc !== '空白' && lc !== 'その他');
  }, [rawData]);

  const branches = useMemo(() => {
    if (!filteredRows.length) return [];
    const set = new Set();
    filteredRows.forEach(r => { if (r.branch) set.add(r.branch); });
    return [...set].sort();
  }, [filteredRows]);

  // 月別集計用の月リスト生成（最新データが存在する月を基準にする）
  const months = useMemo(() => {
    let refDate = new Date();
    
    // 実際に読み込まれたデータの中から、一番新しい年月を探す
    if (rawData && rawData.rows && rawData.rows.length > 0) {
      let maxTime = 0;
      rawData.rows.forEach(r => {
        if (r.calendarYear && r.month) {
          const t = new Date(r.calendarYear, r.month - 1, 1).getTime();
          if (t > maxTime) maxTime = t;
        }
      });
      if (maxTime > 0) {
        refDate = new Date(maxTime);
      }
    }

    const monthKeys = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}年${d.getMonth() + 1}月`);
    }
    monthKeys.push('計');
    return monthKeys;
  }, [rawData]);

  // ===== ドリルダウンデータ（月別集計） =====
  const currentTableData = useMemo(() => {
    if (!filteredRows.length) return [];
    const { branchName, secondName, thirdName } = activeView;
    const monthList = months.slice(0, -1); // 計を除いた月リスト

    if (!branchName) return aggregateByBranchByMonth(filteredRows, monthList);
    if (hierarchyOrder === 'orderer_first') {
      if (!secondName) return aggregateByOrdererByMonth(filteredRows, monthList, branchName);
      if (!thirdName) return aggregateByCustomerByMonth(filteredRows, monthList, branchName, secondName);
      return aggregateByProductByMonth(filteredRows, monthList, branchName, secondName, thirdName, 'orderer_first');
    }
    // customer_first
    if (!secondName) return aggregateByCustomerInBranchByMonth(filteredRows, monthList, branchName);
    if (!thirdName) return aggregateByOrdererForCustomerByMonth(filteredRows, monthList, branchName, secondName);
    return aggregateByProductByMonth(filteredRows, monthList, branchName, secondName, thirdName, 'customer_first');
  }, [filteredRows, activeView, hierarchyOrder, months]);

  // テーブルデータ変更時（ドリルダウン時など）にチェックを全選択に初期化
  useEffect(() => {
    if (!currentTableData.length) return;
    setCheckedItems(new Set(currentTableData.map(d => d.name)));
  }, [activeView.branchName, activeView.secondName, hierarchyOrder, currentTableData]);


  // ===== ピボットデータ（月別） =====
  const pivotData = useMemo(() => {
    if (!filteredRows.length || !months.length) return [];
    const rows = pivotBranch === 'ALL'
      ? filteredRows
      : filteredRows.filter(r => r.branch === pivotBranch);
    const monthList = months.slice(0, -1); // 計を除いた月リスト
    const data = generatePivotDataByMonth(rows, monthList);
    const latestMonth = monthList[monthList.length - 1];

    if (pivotSort === 'sales') {
      data.sort((a, b) => (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0));
    } else if (pivotSort === 'orderer') {
      const ordererTotals = {};
      data.forEach(r => {
        const key = r.orderer || '';
        ordererTotals[key] = (ordererTotals[key] || 0) + (r.sales[latestMonth] || 0);
      });
      data.sort((a, b) => (ordererTotals[b.orderer || ''] || 0) - (ordererTotals[a.orderer || ''] || 0)
        || (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0));
    } else if (pivotSort === 'customer') {
      data.sort((a, b) => (b.sales[latestMonth] || 0) - (a.sales[latestMonth] || 0));
      const customerTotals = {};
      data.forEach(r => {
        const key = r.customer || '';
        customerTotals[key] = (customerTotals[key] || 0) + (r.sales[latestMonth] || 0);
      });
      data.sort((a, b) => (customerTotals[b.customer || ''] || 0) - (customerTotals[a.customer || ''] || 0));
    }
    return data;
  }, [filteredRows, months, pivotBranch, pivotSort]);

  // ===== チャートデータ =====
  const chartData = useMemo(() => {
    if (!currentTableData.length || !months.length) return [];
    const latestMonthKey = months[months.length - 2]; // 計の前（最新月）
    return currentTableData.slice(0, 8).map(item => ({
      name: item.name.length > 10 ? item.name.slice(0, 10) + '…' : item.name,
      fullName: item.name,
      [`${latestMonthKey} 売上`]: item.sales[latestMonthKey] || 0,
      [`${latestMonthKey} 粗利`]: item.profit[latestMonthKey] || 0,
    }));
  }, [currentTableData, months]);

  // ===== ハンドラ =====
  const isLeafLevel = useMemo(() => {
    const { branchName, secondName, thirdName } = activeView;
    return !!branchName && !!secondName && !!thirdName; // 第4階層（品番）はドリル不可
  }, [activeView]);

  const handleDrillDown = (item) => {
    if (isLeafLevel) return;
    const { branchName, secondName } = activeView;
    if (!branchName) {
      setActiveView({ branchName: item.name, secondName: null, thirdName: null });
    } else if (!secondName) {
      setActiveView({ branchName, secondName: item.name, thirdName: null });
    } else {
      setActiveView({ branchName, secondName, thirdName: item.name });
    }
  };

  const handleBreadcrumb = (target) => {
    if (target === 'branch') {
      setActiveView({ branchName: null, secondName: null, thirdName: null });
    } else if (target === 'second') {
      setActiveView(prev => ({ ...prev, secondName: null, thirdName: null }));
    } else {
      setActiveView(prev => ({ ...prev, thirdName: null }));
    }
  };

  const handleRefresh = () => {
    if (confirm('ローカルのキャッシュデータを一旦削除し、最初から全件取得し直しますか？\n(過去のデータ修正を反映したい場合に実行してください)')) {
      loadData(true); // 強制リフレッシュ
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (passwordInput === PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem('kasouhin_auth', 'true');
      setAuthError('');
    } else {
      setAuthError('パスワードが間違っています。');
    }
  };

  const handleLogout = () => {
    if (confirm('ログアウトしますか？')) {
      setIsAuthenticated(false);
      sessionStorage.removeItem('kasouhin_auth');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 text-slate-800 font-sans">
        <div className="bg-white p-8 mb-40 rounded-3xl shadow-xl w-full max-w-md border border-slate-100">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 shadow-inner">
              <Lock size={32} />
            </div>
            <h1 className="text-2xl font-black text-slate-800 text-center tracking-tight">架装品 500<br/>実績レポート</h1>
            <p className="text-sm text-slate-500 mt-2 font-medium text-center">機密情報が含まれるためパスワードが必要です</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 ml-1">パスワード</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-base rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-400 block p-4 transition-all font-medium placeholder-slate-400 font-mono tracking-widest"
                placeholder="パスワードを入力..."
                autoFocus
              />
              {authError && <p className="text-red-500 text-sm mt-2 ml-1 font-bold flex items-center gap-1"><AlertCircle size={14}/>{authError}</p>}
            </div>
            <button
              type="submit"
              className="w-full bg-slate-900 text-white font-black py-4 px-6 rounded-2xl hover:bg-blue-600 transition-colors shadow-lg active:scale-[0.98] tracking-widest"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleSaveCsv = async () => {
    if (!pivotData.length) return;
    const csv = generateCsvContent(pivotData, years);
    // ブラウザ用フォールバック
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `リース実績レポート_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSavePdf = async () => {
    window.print();
  };

  const handleConfigSave = () => {
    setIsConfigOpen(false);
    loadData();
  };

  // ===== レンダリング =====
  const levelInfo = useMemo(() => {
    const { branchName, secondName, thirdName } = activeView;
    if (!branchName) return { icon: Building2, label: '部店名', title: '部店別 年次実績比較' };
    if (hierarchyOrder === 'orderer_first') {
      if (!secondName) return { icon: Store, label: '注文者名', title: `${branchName} 内 注文者実績` };
      if (!thirdName) return { icon: User, label: '顧客名', title: `${secondName} 内 顧客実績` };
      return { icon: Package, label: '品番', title: `${thirdName} 内 品番実績` };
    }
    // customer_first
    if (!secondName) return { icon: User, label: '顧客名', title: `${branchName} 内 顧客実績` };
    if (!thirdName) return { icon: Store, label: '注文者名', title: `${secondName} 内 担当者一覧` };
    return { icon: Package, label: '品番', title: `${thirdName} 内 品番実績` };
  }, [activeView, hierarchyOrder]);

  const LevelIcon = levelInfo.icon;

  return (
    <div className="min-h-screen h-screen bg-slate-50 font-sans text-slate-900 flex select-none">
      {/* ===== Sidebar ===== */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col p-6 sticky top-0 h-screen shadow-2xl z-20 no-print flex-shrink-0">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="bg-red-500 p-2 rounded-xl text-white shadow-lg shadow-red-500/20">
            <Database size={24} />
          </div>
          <h1 className="text-lg font-black leading-none tracking-tighter uppercase">
            Special<br/>Sales Report
          </h1>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => setViewMode('dashboard')}
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
            onClick={() => setViewMode('pivot_report')}
            className={`flex items-center gap-3 w-full p-4 rounded-2xl transition-all duration-300 ${
              viewMode === 'pivot_report'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-105'
                : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            <ListFilter size={20} />
            <span className="font-black text-sm tracking-tight">一括網羅レポート</span>
          </button>

          <div className="pt-8 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Reports Export
          </div>
          <button
            onClick={handleSavePdf}
            className="flex items-center justify-between w-full p-4 rounded-2xl text-slate-400 hover:bg-slate-800 transition-all border border-transparent hover:border-slate-700"
          >
            <div className="flex items-center gap-3 italic font-bold text-sm text-slate-200">
              <FileText size={18} /> PDF Export
            </div>
          </button>
          <button
            onClick={handleSaveCsv}
            className="flex items-center justify-between w-full p-4 rounded-2xl text-slate-400 hover:bg-slate-800 transition-all border border-transparent hover:border-slate-700"
          >
            <div className="flex items-center gap-3 italic font-bold text-sm text-slate-200">
              <FileSpreadsheet size={18} /> CSV Export
            </div>
          </button>
        </nav>

        {/* Stats */}
        {rawData && (
          <div className="mb-4 p-3 bg-slate-800 rounded-2xl text-xs space-y-1">
            <div className="flex justify-between text-slate-400">
              <span>ファイル数</span>
              <span className="font-mono font-bold text-slate-200">{rawData.fileCount ?? '—'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>レコード数</span>
              <span className="font-mono font-bold text-slate-200">{(rawData.totalRows ?? rawData.rows?.length ?? 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>読込</span>
              <span className={`font-mono font-bold ${rawData.fromCache ? 'text-emerald-400' : 'text-blue-400'}`}>
                {rawData.fromCache ? 'Cache' : 'Excel'}
              </span>
            </div>
          </div>
        )}


      </aside>

      {/* ===== Main Content ===== */}
      <main className="flex-1 p-8 overflow-y-auto custom-scrollbar" ref={printRef}>
        {/* Header */}
        <header className="mb-10 space-y-8 no-print">
          <div className="flex justify-between items-end">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <h2 className="text-4xl font-black text-slate-800 tracking-tighter">
                  架装品 500受注レポート
                </h2>
                <ConnectionBadge status={connectionStatus} />
                <button
                  onClick={handleLogout}
                  className="ml-4 text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 px-3 py-1.5 bg-slate-100 rounded-lg transition-colors"
                  title="ログアウト"
                >
                  <LogOut size={14} /> ログアウト
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-slate-400 font-bold text-sm bg-slate-100 w-fit px-3 py-1 rounded-lg">
                  <FolderOpen size={14} /> {networkPath}
                </div>
                {rawData?.cacheAgeMsg && (
                  <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs bg-emerald-50 w-fit px-3 py-1.5 rounded-lg border border-emerald-100">
                    <Check size={14} /> データ状態: {rawData.cacheAgeMsg}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className={`group flex items-center gap-2 px-8 py-4 rounded-3xl bg-slate-900 text-white font-black text-sm shadow-2xl hover:bg-red-600 transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                  isLoading ? 'animate-pulse' : ''
                }`}
              >
                <RefreshCcw
                  size={18}
                  className={isLoading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}
                />
                {isLoading ? '完全同期(全件再取得)' : '完全同期(全件再取得)'}
              </button>
              {loadingProgress.isSyncing && (
                <div className="text-xs font-bold text-blue-600 animate-pulse flex items-center gap-1">
                  <RefreshCcw size={12} className="animate-spin" />
                  {loadingProgress.fetchMsg}
                </div>
              )}
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-wrap gap-12 items-center">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                リース会社選択
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedLeaseCo('ALL')}
                  className={`px-6 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${
                    selectedLeaseCo === 'ALL'
                      ? 'bg-red-600 text-white shadow-xl shadow-red-200'
                      : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                  }`}
                >
                  すべて
                </button>
                {leaseCompanies.map(l => (
                  <button
                    key={l}
                    onClick={() => setSelectedLeaseCo(l)}
                    className={`px-6 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${
                      selectedLeaseCo === l
                        ? 'bg-red-600 text-white shadow-xl shadow-red-200'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                金額単位
              </label>
              <div className="flex bg-slate-100 p-1 rounded-2xl">
                <button
                  onClick={() => setAmountUnit('yen')}
                  className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all duration-300 ${
                    amountUnit === 'yen'
                      ? 'bg-white text-slate-800 shadow-md'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  円
                </button>
                <button
                  onClick={() => setAmountUnit('thousand')}
                  className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all duration-300 ${
                    amountUnit === 'thousand'
                      ? 'bg-white text-slate-800 shadow-md'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  千円
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                粗利表示
              </label>
              <button
                onClick={() => setShowProfit(p => !p)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${
                  showProfit
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                {showProfit ? <Eye size={14} /> : <EyeOff size={14} />}
                {showProfit ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </header>

        {/* Loading State */}
        {isLoading && !rawData && (
          <LoadingScreen />
        )}

        {/* Error State */}
        {loadError && (
          <div className="bg-rose-50 border border-rose-200 rounded-3xl p-8 mb-8 flex items-center gap-4 animate-fade-in">
            <AlertCircle className="text-rose-500 flex-shrink-0" size={24} />
            <div>
              <h3 className="font-black text-rose-800 mb-1">データ読み込みエラー</h3>
              <p className="text-sm text-rose-600">{loadError}</p>
              <p className="text-xs text-rose-400 mt-1">設定画面からパスを確認するか、ネットワーク接続を確認してください。</p>
            </div>
          </div>
        )}

        {/* Cache / Data Status */}
        {rawData && !isLoading && rawData.fromCache && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-3xl px-8 py-5 mb-8 flex items-center justify-between animate-fade-in no-print">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-emerald-500" size={20} />
              <span className="font-bold text-emerald-800 text-sm">
                キャッシュから高速読込（{(rawData.totalRows ?? rawData.rows?.length ?? 0).toLocaleString()}件）
              </span>
              <span className="text-xs text-emerald-500 font-bold">Excelファイルに変更がある場合は自動で再解析されます</span>
            </div>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-2xl text-xs font-black hover:bg-emerald-700 transition-all active:scale-95"
            >
              <RefreshCcw size={14} />
              強制更新
            </button>
          </div>
        )}

        {/* Main Content Area */}
        {rawData && !isLoading && (
          <>
            {viewMode === 'dashboard' ? (
              <DashboardView
                data={currentTableData}
                chartData={chartData}
                months={months}
                activeView={activeView}
                hierarchyOrder={hierarchyOrder}
                onHierarchyOrderChange={setHierarchyOrder}
                levelInfo={levelInfo}
                LevelIcon={LevelIcon}
                isLeafLevel={isLeafLevel}
                checkedItems={checkedItems}
                onCheckedChange={setCheckedItems}
                onDrillDown={handleDrillDown}
                onBreadcrumb={handleBreadcrumb}
                onSavePdf={handleSavePdf}
                onSaveCsv={handleSaveCsv}
                fmtAmt={fmtAmt}
                fmtAmtShort={fmtAmtShort}
                amountUnit={amountUnit}
                showProfit={showProfit}
                selectedLeaseCo={selectedLeaseCo}
              />
            ) : (
              <PivotView
                data={pivotData}
                months={months}
                branches={branches}
                pivotBranch={pivotBranch}
                onBranchChange={setPivotBranch}
                pivotSort={pivotSort}
                onSortChange={setPivotSort}
                onSavePdf={handleSavePdf}
                onSaveCsv={handleSaveCsv}
                fmtAmt={fmtAmt}
                amountUnit={amountUnit}
                showProfit={showProfit}
                selectedLeaseCo={selectedLeaseCo}
              />
            )}
          </>
        )}
      </main>

    </div>
  );
};

// ===== 接続ステータスバッジ =====
function ConnectionBadge({ status }) {
  const styles = {
    idle: 'bg-slate-100 text-slate-500 border-slate-200',
    loading: 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse',
    online: 'bg-red-50 text-red-600 border-red-100 animate-pulse-glow',
    offline: 'bg-rose-50 text-rose-600 border-rose-100',
  };
  const labels = {
    idle: 'Standby',
    loading: 'Loading...',
    online: 'Live Sync',
    offline: 'Offline',
  };
  const icons = {
    idle: CheckCircle2,
    loading: Loader2,
    online: CheckCircle2,
    offline: AlertCircle,
  };
  const Icon = icons[status];
  return (
    <div className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-black uppercase border shadow-sm ${styles[status]}`}>
      <Icon size={12} className={status === 'loading' ? 'animate-spin' : ''} /> {labels[status]}
    </div>
  );
};

// ===== ローディング画面 =====
function LoadingScreen() {
  return (
  <div className="flex flex-col items-center justify-center h-96 animate-fade-in">
    <div className="relative mb-8">
      <div className="w-20 h-20 border-4 border-slate-200 rounded-full" />
      <div className="absolute top-0 left-0 w-20 h-20 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
      <Database className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-500" size={28} />
    </div>
    <h3 className="text-xl font-black text-slate-700 mb-2">データを読み込んでいます</h3>
    <p className="text-sm text-slate-400 font-bold">ネットワークフォルダからExcelファイルを解析中...</p>
    <div className="flex gap-1 mt-6">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-2 h-2 bg-red-500 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  </div>
  );
}

// ===== ダッシュボードビュー =====
function DashboardView({
  data, chartData, months, activeView, hierarchyOrder, onHierarchyOrderChange,
  levelInfo, LevelIcon, isLeafLevel,
  checkedItems, onCheckedChange,
  onDrillDown, onBreadcrumb, onSavePdf, onSaveCsv,
  fmtAmt, fmtAmtShort, amountUnit, showProfit, selectedLeaseCo,
}) {
  const totalRow = useMemo(() => {
    if (!data.length || !months.length) return null;
    const filtered = data.filter(item => checkedItems.has(item.name));
    if (filtered.length === 0) return null;
    const sales = {};
    const profit = {};
    const count = {};
    const quantity = {};
    months.forEach(m => { sales[m] = 0; profit[m] = 0; count[m] = 0; quantity[m] = 0; });
    filtered.forEach(item => {
      months.forEach(m => {
        sales[m] += item.sales[m] || 0;
        profit[m] += item.profit[m] || 0;
        count[m] += item.count ? (item.count[m] || 0) : 0;
        quantity[m] += item.quantity ? (item.quantity[m] || 0) : 0;
      });
    });
    const { branchName, secondName, thirdName } = activeView;
    let label = '合計';
    if (!branchName) label = '全部店 合計';
    else if (!secondName) label = `${branchName} 合計`;
    else if (!thirdName) label = `${secondName} 合計`;
    else label = `${thirdName} 合計`;
    return { name: label, sales, profit, count, quantity };
  }, [data, months, activeView, checkedItems]);

  const toggleCheck = useCallback((name) => {
    onCheckedChange(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, [onCheckedChange]);

  const toggleAllChecked = useCallback(() => {
    onCheckedChange(new Set(data.map(d => d.name)));
  }, [data, onCheckedChange]);

  const toggleAllUnchecked = useCallback(() => {
    onCheckedChange(new Set());
  }, [onCheckedChange]);

  return (
  <div className="space-y-8 animate-fade-in-up">
    {/* Breadcrumb */}
    <div className="flex items-center gap-2 text-sm font-bold no-print">
      <button
        onClick={() => onBreadcrumb('branch')}
        className={`flex items-center gap-1 transition-colors ${
          !activeView.branchName ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <Building2 size={16} /> 部店一覧
      </button>
      {activeView.branchName && (
        <>
          <ChevronRight size={14} className="text-slate-300" />
          <button
            onClick={() => onBreadcrumb('second')}
            className={`flex items-center gap-1 transition-colors ${
              !activeView.secondName ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {hierarchyOrder === 'orderer_first' ? <Store size={16} /> : <User size={16} />} {activeView.branchName}
          </button>
        </>
      )}
      {activeView.secondName && (
        <>
          <ChevronRight size={14} className="text-slate-300" />
          <button
            onClick={() => onBreadcrumb('third')}
            className={`flex items-center gap-1 transition-colors ${
              !activeView.thirdName ? 'text-red-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {hierarchyOrder === 'orderer_first' ? <User size={16} /> : <Store size={16} />} {activeView.secondName}
          </button>
        </>
      )}
      {activeView.thirdName && (
        <>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-red-600 flex items-center gap-1">
            <Package size={16} /> {activeView.thirdName}
          </span>
        </>
      )}
    </div>

    {/* 階層順切替 + 全チェック/全解除 */}
    <div className="flex items-center gap-4 no-print">
      <div className="flex items-center gap-2 bg-slate-100 rounded-2xl p-1">
        <button
          onClick={() => onHierarchyOrderChange('orderer_first')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black ${hierarchyOrder === 'orderer_first' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}
        >
          <Store size={14} /> 部署→担当者→顧客
        </button>
        <button
          onClick={() => onHierarchyOrderChange('customer_first')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black ${hierarchyOrder === 'customer_first' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}
        >
          <User size={14} /> 部署→顧客→担当者
        </button>
      </div>
      <div className="flex items-center gap-2 ml-8">
        <button
          onClick={toggleAllChecked}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 border border-transparent text-xs font-black transition-colors"
        >
          <CheckSquare size={14} /> 全チェック
        </button>
        <button
          onClick={toggleAllUnchecked}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800 border border-transparent text-xs font-black transition-colors"
        >
          <Square size={14} /> 全解除
        </button>
      </div>
    </div>

    {/* Comparison Table */}
    <div className="bg-white rounded-[3rem] shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
        <h3 className="font-black text-slate-800 text-xl flex items-center gap-3">
          <LevelIcon className="text-red-500" />
          {levelInfo.title}
          {selectedLeaseCo !== 'ALL' && <span className="text-red-500 text-base">— {selectedLeaseCo}</span>}
        </h3>
        <div className="flex items-center gap-4">
          <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Calendar size={14} />
            出力日: {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </div>
        <div className="flex gap-2 no-print">
          <button
            onClick={onSavePdf}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-red-500 hover:border-red-200 transition-all shadow-sm text-sm font-bold"
          >
            <FileText size={16} /> PDF
          </button>
          <button
            onClick={onSaveCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-emerald-500 hover:border-emerald-200 transition-all shadow-sm text-sm font-bold"
          >
            <FileSpreadsheet size={16} /> CSV
          </button>
        </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-xl font-black text-white tracking-wide text-center">
              <th className="px-2 py-4 w-12 text-center">
                選択
              </th>
              <th className="px-8 py-4 min-w-[200px] text-center">
                {levelInfo.label}
                {amountUnit === 'thousand' && <span className="ml-2 text-amber-400 normal-case tracking-normal text-xs">（単位：千円）</span>}
              </th>
              {months.map(month => (
                <th key={month} className="px-6 py-4 text-center border-l border-slate-800">
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {totalRow && (
              <tr className="bg-red-50/50 border-b-2 border-red-200">
                <td className="px-2 py-5 w-12 text-center">—</td>
                <td className="px-8 py-5">
                  <div className="font-black text-blue-700 text-lg">{totalRow.name}</div>
                </td>
                {months.map((month, mIdx) => {
                  // 「計」列の場合は月ごとの合計を計算
                  let sales, profit, count, qty;
                  if (month === '計') {
                    sales = 0; profit = 0; count = 0; qty = 0;
                    months.slice(0, -1).forEach(m => {
                      sales += totalRow.sales[m] || 0;
                      profit += totalRow.profit[m] || 0;
                      count += totalRow.count ? (totalRow.count[m] || 0) : 0;
                      qty += totalRow.quantity ? (totalRow.quantity[m] || 0) : 0;
                    });
                  } else {
                    sales = totalRow.sales[month] || 0;
                    profit = totalRow.profit[month] || 0;
                    count = totalRow.count ? (totalRow.count[month] || 0) : 0;
                    qty = totalRow.quantity ? (totalRow.quantity[month] || 0) : 0;
                  }
                  const margin = calcMargin(profit, sales);
                  const prevMonth = months[mIdx - 1];
                  const yoy = prevMonth && month !== '計' ? calcYoY(sales, totalRow.sales[prevMonth]) : null;
                  return (
                    <td key={month} className="px-6 py-5 border-l border-red-200">
                      <div className="space-y-3">
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs font-black text-red-500">売上</span>
                          <div className="text-right">
                            <div className="font-mono font-black text-blue-800">{fmtAmt(sales)}</div>
                            {yoy !== null && (
                              <div className={`text-xs font-black flex items-center justify-end gap-1 ${parseFloat(yoy) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {parseFloat(yoy) >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                {yoy}%
                              </div>
                            )}
                          </div>
                        </div>
                        {showProfit && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs font-black text-red-500">粗利(率)</span>
                            <div className="text-right">
                              <div className="font-mono font-black text-emerald-600">{fmtAmt(profit)}</div>
                              <div className="flex items-center justify-end gap-1 mt-0.5">
                                {isLeafLevel ? (
                                  qty > 0 && <span className="text-xs font-black text-slate-800">{qty.toLocaleString()}台</span>
                                ) : (
                                  count > 0 && <span className="text-xs font-black text-slate-800">{count.toLocaleString()}件</span>
                                )}
                                <div className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[11px] font-black w-fit border border-emerald-100">{margin}%</div>
                              </div>
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
              <tr>
                <td colSpan={months.length + 2} className="px-8 py-16 text-center text-slate-300 italic">
                  該当するデータがありません
                </td>
              </tr>
            ) : (
              data.map((item, idx) => {
                const productNameShort = item.productName
                  ? truncateByDisplayWidth(item.productName, 15)
                  : '';
                return (
                <tr
                  key={idx}
                  className={`group hover:bg-red-50/30 transition-all ${
                    !isLeafLevel ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => !isLeafLevel && onDrillDown(item)}
                >
                  <td
                    className="px-2 py-6 w-12 align-middle text-center"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCheck(item.name)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-red-600 transition-colors print:pointer-events-none"
                      title={checkedItems.has(item.name) ? 'チェック解除' : '合計に含める'}
                    >
                      {checkedItems.has(item.name) ? (
                        <CheckSquare size={18} className="text-emerald-600" />
                      ) : (
                        <Square size={18} className="text-slate-300" />
                      )}
                    </button>
                  </td>
                  <td className="px-8 py-6">
                    <div className="font-black text-slate-800 text-lg group-hover:text-red-600 transition-colors flex items-center gap-2">
                      {item.name}
                      {!isLeafLevel && (
                        <ChevronRight
                          size={14}
                          className="opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0"
                        />
                      )}
                    </div>
                    {isLeafLevel && item.productName && (
                      <div
                        className="text-xs text-slate-500 font-semibold mt-1 leading-snug"
                        title={item.productName}
                      >
                        {productNameShort}
                        {productNameShort !== item.productName ? '…' : ''}
                      </div>
                    )}
                    {item.reps && item.reps.length > 0 && (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {item.reps.join(' / ')}
                      </div>
                    )}
                    {!isLeafLevel && (
                      <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter no-print">
                        クリックで詳細を表示
                      </div>
                    )}
                  </td>
                  {months.map((month, mIdx) => {
                    // 「計」列の場合は月ごとの合計を計算
                    let sales, profit, count, qty;
                    if (month === '計') {
                      sales = 0; profit = 0; count = 0; qty = 0;
                      months.slice(0, -1).forEach(m => {
                        sales += item.sales[m] || 0;
                        profit += item.profit[m] || 0;
                        count += item.count ? (item.count[m] || 0) : 0;
                        qty += item.quantity ? (item.quantity[m] || 0) : 0;
                      });
                    } else {
                      sales = item.sales[month] || 0;
                      profit = item.profit[month] || 0;
                      count = item.count ? (item.count[month] || 0) : 0;
                      qty = item.quantity ? (item.quantity[month] || 0) : 0;
                    }
                    const margin = calcMargin(profit, sales);
                    const prevMonth = months[mIdx - 1];
                    const yoy = prevMonth && month !== '計' ? calcYoY(sales, item.sales[prevMonth]) : null;

                    return (
                      <td key={month} className="px-6 py-6 border-l border-slate-300 group-hover:bg-white/50">
                        <div className="space-y-3">
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs font-black text-slate-600">売上</span>
                            <div className="text-right">
                              <div className="font-mono font-black text-slate-700">
                                {fmtAmt(sales)}
                              </div>
                              {yoy !== null && (
                                <div className={`text-xs font-black flex items-center justify-end gap-1 ${
                                  parseFloat(yoy) >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                }`}>
                                  {parseFloat(yoy) >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                  {yoy}%
                                </div>
                              )}
                            </div>
                          </div>
                          {showProfit && (
                            <div className="flex justify-between items-baseline">
                              <span className="text-xs font-black text-slate-600">粗利(率)</span>
                              <div className="text-right">
                                <div className="font-mono font-black text-emerald-600">
                                  {fmtAmt(profit)}
                                </div>
                                <div className="flex items-center justify-end gap-1 mt-0.5">
                                  {isLeafLevel ? (
                                    qty > 0 && <span className="text-xs font-black text-slate-800">{qty.toLocaleString()}台</span>
                                  ) : (
                                    count > 0 && <span className="text-xs font-black text-slate-800">{count.toLocaleString()}件</span>
                                  )}
                                  <div className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[11px] font-black w-fit border border-emerald-100">
                                    {margin}%
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* Chart */}
    {chartData.length > 0 && (
      <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 no-print">
        <h4 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
          <div className="w-1.5 h-6 bg-red-500 rounded-full" />
          売上トレンド可視化
        </h4>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontWeight: 700, fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontWeight: 700, fontSize: 12 }} tickFormatter={v => fmtAmtShort(v)} />
              <Tooltip
                contentStyle={{ borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '1.5rem' }}
                cursor={{ fill: '#f8fafc' }}
                formatter={(value) => fmtAmt(value)}
              />
              <Legend iconType="circle" wrapperStyle={{ paddingTop: '2rem' }} />
              {months.length > 1 && (
                <>
                  <Bar dataKey={`${months[months.length - 2]} 売上`} fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={24} />
                  <Bar dataKey={`${months[months.length - 2]} 粗利`} fill="#10b981" radius={[6, 6, 0, 0]} barSize={24} />
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    )}
  </div>
  );
};

// ===== ピボットレポートビュー =====
function PivotView({ data, months, branches, pivotBranch, onBranchChange, pivotSort, onSortChange, onSavePdf, onSaveCsv, fmtAmt, amountUnit, showProfit, selectedLeaseCo }) {
  const titleParts = [
    selectedLeaseCo !== 'ALL' ? selectedLeaseCo : null,
    pivotBranch !== 'ALL' ? pivotBranch : null,
  ].filter(Boolean);
  const titleSuffix = titleParts.length > 0 ? titleParts.join(' — ') : null;

  return (
  <div className="space-y-8 animate-fade-in-up">
    {/* 支店フィルタ */}
    <div className="bg-white p-6 rounded-[3rem] shadow-sm border border-slate-100 no-print">
      <div className="space-y-3">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
          部店で絞り込み
        </label>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onBranchChange('ALL')}
            className={`px-6 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${
              pivotBranch === 'ALL'
                ? 'bg-red-600 text-white shadow-xl shadow-red-200'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            }`}
          >
            すべて
          </button>
          {branches.map(b => (
            <button
              key={b}
              onClick={() => onBranchChange(b)}
              className={`px-6 py-2.5 rounded-2xl text-xs font-black transition-all duration-300 ${
                pivotBranch === b
                  ? 'bg-red-600 text-white shadow-xl shadow-red-200'
                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
    </div>

    <div className="bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
      <div className="p-8 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-600 text-white rounded-xl shadow-lg shadow-red-100">
            <ListFilter size={20} />
          </div>
          <div>
            <h3 className="font-black text-slate-800 text-xl tracking-tighter">
              一括網羅ピボットレポート
              {titleSuffix && <span className="text-red-500 ml-2 text-base">— {titleSuffix}</span>}
            </h3>
            <p className="text-[10px] font-bold text-red-500 mt-0.5 uppercase tracking-widest italic">
              Unified Comprehensive View for PDF &middot; {data.length} records
              {amountUnit === 'thousand' && <span className="ml-2 text-amber-500 normal-case">（単位：千円）</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Calendar size={14} />
            出力日: {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </div>
          <div className="flex gap-2 no-print">
            <button
              onClick={onSavePdf}
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-red-500 hover:border-red-200 transition-all shadow-sm text-sm font-bold"
            >
              <FileText size={16} /> PDF
            </button>
            <button
              onClick={onSaveCsv}
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-slate-600 hover:text-emerald-500 hover:border-emerald-200 transition-all shadow-sm text-sm font-bold"
            >
              <FileSpreadsheet size={16} /> CSV
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse pivot-table">
          <thead>
            <tr className="bg-slate-900 text-xl font-black text-white tracking-wide text-center">
              <th className="px-4 py-4 text-center border-r border-slate-800 min-w-[120px] sticky left-0 bg-slate-900 z-10">
                <button onClick={() => onSortChange('orderer')} className={`w-full flex items-center justify-center gap-1 transition-colors ${pivotSort === 'orderer' ? 'text-blue-300' : 'text-white hover:text-blue-300'}`}>
                  注文者 {pivotSort === 'orderer' && <ArrowUpDown size={12} />}
                </button>
              </th>
              <th className="px-4 py-4 text-center border-r border-slate-800 min-w-[200px]">
                <button onClick={() => onSortChange('customer')} className={`w-full flex items-center justify-center gap-1 transition-colors ${pivotSort === 'customer' ? 'text-blue-300' : 'text-white hover:text-blue-300'}`}>
                  顧客名 {pivotSort === 'customer' && <ArrowUpDown size={12} />}
                </button>
              </th>
              {months.map(month => (
                <th key={month} className="px-3 py-4 border-l border-slate-800 min-w-[160px]">
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300">
            {data.length === 0 ? (
              <tr>
                <td colSpan={2 + months.length} className="px-8 py-16 text-center text-slate-300 italic">
                  該当するデータがありません
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr key={idx} className="hover:bg-red-50/50 transition-colors">
                  <td className="px-4 py-3 border-r border-slate-300 sticky left-0 bg-white z-10 font-black text-slate-800 text-sm">
                    {row.orderer}
                  </td>
                  <td className="px-4 py-3 border-r border-slate-300">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                      <span className="font-black text-slate-800 text-sm">{row.customer}</span>
                    </div>
                  </td>
                  {months.map((month, mIdx) => {
                    // 「計」列の場合は月ごとの合計を計算
                    let sales, profit;
                    if (month === '計') {
                      sales = 0;
                      profit = 0;
                      months.slice(0, -1).forEach(m => {
                        sales += row.sales[m] || 0;
                        profit += row.profit[m] || 0;
                      });
                    } else {
                      sales = row.sales[month] || 0;
                      profit = row.profit[month] || 0;
                    }
                    const margin = calcMargin(profit, sales);
                    const prevMonth = months[mIdx - 1];
                    const yoy = prevMonth && month !== '計' ? calcYoY(sales, row.sales[prevMonth]) : null;

                    return (
                      <td key={month} className="px-3 py-3 border-l border-slate-300 bg-white/40">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex justify-between items-baseline">
                            <span className="text-[9px] font-black text-slate-400">売上</span>
                            <span className="font-mono font-black text-slate-700 text-[13px]">
                              {fmtAmt(sales)}
                            </span>
                          </div>
                          {showProfit && (
                            <>
                              <div className="flex justify-between items-baseline border-t border-slate-50 pt-0.5">
                                <span className="text-[9px] font-black text-slate-400">粗利</span>
                                <span className="font-mono font-black text-emerald-600 text-[13px]">
                                  {fmtAmt(profit)}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <div className="px-1 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[9px] font-black">
                                  {margin}%
                                </div>
                                {yoy !== null && (
                                  <div className={`text-[9px] font-black flex items-center gap-0.5 ${
                                    parseFloat(yoy) >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                  }`}>
                                    {parseFloat(yoy) >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                    {yoy}%
                                  </div>
                                )}
                              </div>
                            </>
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



export default App;
