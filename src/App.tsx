import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Home,
  Send,
  QrCode,
  History,
  Trophy,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  Moon,
  Sun,
  LogOut,
  Bell,
  Download,
  Award,
  X,
} from 'lucide-react';
import { playbankApi, getStoredToken, setStoredToken } from './lib/api';
import {
  SIMULATOR_BANNER,
  formatPlaycoin,
  formatShortTimeVN,
  type AchievementRecord,
  type DashboardSummary,
  type TransactionRecord,
  type TransferMethod,
  type UserProfile,
} from './lib/banking';
import { playBankingSound } from './lib/sound';
import { AuthView } from './components/AuthView';
import { VirtualCard } from './components/VirtualCard';
import { TransferView } from './components/TransferView';
import { QrScannerView } from './components/QrScannerView';
import { HistoryView } from './components/HistoryView';
import { LeaderboardView } from './components/LeaderboardView';
import { ProfileView } from './components/ProfileView';
import { ReceiveQrModal } from './components/ReceiveQrModal';
import { ReceiptModal } from './components/ReceiptModal';

type NavTab = 'dashboard' | 'transfer' | 'scan' | 'history' | 'leaderboard' | 'profile';

interface IncomingAlert {
  id: string;
  tx: TransactionRecord;
}

const DARK_MODE_KEY = 'playbank_dark_mode_v1';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DARK_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [bootstrapping, setBootstrapping] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [hideBalance, setHideBalance] = useState(false);

  const [showReceiveQr, setShowReceiveQr] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<TransactionRecord | null>(null);
  const [prefillRecipient, setPrefillRecipient] = useState<{
    account: string;
    method: TransferMethod;
  } | null>(null);

  const [incomingAlerts, setIncomingAlerts] = useState<IncomingAlert[]>([]);
  const soundEnabledRef = useRef(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(DARK_MODE_KEY, darkMode ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  useEffect(() => {
    soundEnabledRef.current = summary?.user.soundEnabled ?? true;
  }, [summary?.user.soundEnabled]);

  const seenIncomingIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedIncomingRef = useRef(false);

  const refreshDashboard = useCallback(async (detectIncoming = false) => {
    try {
      const data = await playbankApi.getMe();
      const incomingTxs = data.recentTransactions.filter(
        (tx) => tx.recipientId === data.user.id
      );

      if (detectIncoming && hasHydratedIncomingRef.current) {
        const newlyReceived = incomingTxs.filter(
          (tx) => !seenIncomingIdsRef.current.has(tx.id)
        );
        if (newlyReceived.length > 0) {
          if (soundEnabledRef.current) {
            playBankingSound('incoming');
          }
          setIncomingAlerts((prev) => {
            const existing = new Set(prev.map((a) => a.id));
            const additions = newlyReceived
              .filter((tx) => !existing.has(tx.id))
              .map((tx) => ({ id: tx.id, tx }));
            return [...additions, ...prev].slice(0, 3);
          });
        }
      }

      for (const tx of incomingTxs) {
        seenIncomingIdsRef.current.add(tx.id);
      }
      hasHydratedIncomingRef.current = true;

      setSummary(data);
    } catch {
      setStoredToken(null);
      setSummary(null);
    }
  }, []);

  // Initial session check
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBootstrapping(false);
      return;
    }
    refreshDashboard(false).finally(() => setBootstrapping(false));
  }, [refreshDashboard]);

  // Real-time incoming payment notifications (SSE + free-host safe polling fallback)
  useEffect(() => {
    if (!summary?.user.id) return;

    const unsubscribe = playbankApi.subscribeEvents(({ transaction }) => {
      if (!seenIncomingIdsRef.current.has(transaction.id)) {
        seenIncomingIdsRef.current.add(transaction.id);
        if (soundEnabledRef.current) {
          playBankingSound('incoming');
        }
        setIncomingAlerts((prev) => {
          if (prev.some((a) => a.id === transaction.id)) return prev;
          return [{ id: transaction.id, tx: transaction }, ...prev].slice(0, 3);
        });
      }
      refreshDashboard(false);
    });

    const onFocus = () => {
      refreshDashboard(true);
    };
    window.addEventListener('focus', onFocus);

    // Lightweight 12s visible-tab fallback in case a free hosting proxy closes idle SSE streams
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshDashboard(true);
      }
    }, 12_000);

    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      window.clearInterval(pollTimer);
    };
  }, [summary?.user.id, refreshDashboard]);

  const handleAuthenticated = async (_user: UserProfile) => {
    setActiveTab('dashboard');
    await refreshDashboard();
  };

  const handleLogout = async () => {
    await playbankApi.logout();
    seenIncomingIdsRef.current.clear();
    hasHydratedIncomingRef.current = false;
    setSummary(null);
    setIncomingAlerts([]);
    setSelectedReceipt(null);
    setShowReceiveQr(false);
    setPrefillRecipient(null);
    setActiveTab('dashboard');
  };

  const handleTransferSuccess = (
    _tx: TransactionRecord,
    _newBalance: number,
    _newAchievements: AchievementRecord[]
  ) => {
    setPrefillRecipient(null);
    refreshDashboard();
  };

  const handleQrDecoded = (accountNumber: string) => {
    setPrefillRecipient({ account: accountNumber, method: 'qr' });
    setActiveTab('transfer');
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FB] dark:bg-[#070E1A] text-[#0B172A] dark:text-white gap-3">
        <div className="text-2xl font-extrabold tracking-tight">PLAYBANK</div>
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Đang tải tài khoản ngân hàng giả lập...
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <AuthView
        onAuthenticated={handleAuthenticated}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />
    );
  }

  const { user, stats, recentTransactions, achievements } = summary;

  const navItems: Array<{ id: NavTab; label: string; icon: typeof Home }> = [
    { id: 'dashboard', label: 'Tổng quan', icon: Home },
    { id: 'transfer', label: 'Chuyển tiền', icon: Send },
    { id: 'scan', label: 'Quét QR', icon: QrCode },
    { id: 'history', label: 'Lịch sử', icon: History },
    { id: 'leaderboard', label: 'Xếp hạng', icon: Trophy },
    { id: 'profile', label: 'Tài khoản', icon: User },
  ];

  const mobileTabs = navItems.slice(0, 5);

  const pageTitleMap: Record<NavTab, string> = {
    dashboard: 'Tổng quan tài khoản',
    transfer: 'Chuyển tiền PLAYCOIN',
    scan: 'Quét mã QR nội bộ',
    history: 'Lịch sử giao dịch',
    leaderboard: 'Bảng xếp hạng & Thành tích',
    profile: 'Hồ sơ & Cài đặt',
  };

  return (
    <div className="min-h-screen flex bg-[#F5F7FB] dark:bg-[#070E1A] text-[#0B172A] dark:text-slate-100">
      {/* Desktop Sidebar Navigation */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-[#0B1526] border-r border-slate-200/90 dark:border-slate-800/90 z-30">
        <div className="px-6 h-16 flex items-center border-b border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="text-xl font-extrabold tracking-tight text-[#0B172A] dark:text-white cursor-pointer"
          >
            PLAYBANK
          </button>
        </div>

        <nav aria-label="Điều hướng chính" className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id !== 'transfer') setPrefillRecipient(null);
                  setActiveTab(item.id);
                }}
                aria-current={active ? 'page' : undefined}
                className={`w-full h-11 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#0F2747] dark:bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-[#0B172A] dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
          <div className="px-3 py-2 text-[11px] font-semibold leading-snug text-blue-700 dark:text-blue-400">
            {SIMULATOR_BANNER}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
              className="flex-1 h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{darkMode ? 'Sáng' : 'Tối'}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Đăng xuất khỏi PLAYBANK"
              className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 text-slate-500 dark:text-slate-400 inline-flex items-center justify-center cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Top Header Bar (compact <=56px on mobile to honor 15% sticky cap) */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/85 dark:bg-[#0B1526]/85 pb-glass border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="lg:hidden text-base font-extrabold tracking-tight text-[#0B172A] dark:text-white whitespace-nowrap shrink-0">
                PLAYBANK
              </span>
              <h1 className="hidden lg:block text-base font-bold text-[#0B172A] dark:text-white truncate">
                {pageTitleMap[activeTab]}
              </h1>
              <span className="hidden xl:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
                /
              </span>
              <span className="hidden xl:inline text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                {SIMULATOR_BANNER}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                aria-label={darkMode ? 'Bật chế độ sáng' : 'Bật chế độ tối'}
                className="lg:hidden w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('transfer')}
                className="hidden sm:inline-flex h-10 px-4 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] text-white text-xs font-semibold items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Chuyển tiền</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                aria-label="Mở hồ sơ tài khoản"
                className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
              >
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                />
                <span className="hidden md:block text-xs font-semibold text-[#0B172A] dark:text-white max-w-[130px] truncate">
                  {user.displayName}
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile inline simulator notice (scrolls naturally, NOT sticky) */}
        <div className="xl:hidden px-4 sm:px-6 pt-3 max-w-6xl mx-auto w-full">
          <div className="text-[11px] font-semibold tracking-wide text-blue-700 dark:text-blue-400">
            {SIMULATOR_BANNER}
          </div>
        </div>

        {/* Real-time Incoming Transfer Notification Banners */}
        {incomingAlerts.length > 0 && (
          <div
            aria-live="polite"
            className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4 space-y-2"
          >
            {incomingAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-2xl bg-emerald-600 text-white px-4 py-3.5 shadow-lg shadow-emerald-900/15 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">
                      Nhận +{formatPlaycoin(alert.tx.amount)} PLAYCOIN từ {alert.tx.senderName}
                    </div>
                    <div className="text-xs text-emerald-100 truncate">
                      Nội dung: {alert.tx.note}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedReceipt(alert.tx)}
                    className="h-9 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Xem biên nhận
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setIncomingAlerts((prev) => prev.filter((item) => item.id !== alert.id))
                    }
                    aria-label="Đóng thông báo nhận tiền"
                    className="w-9 h-9 rounded-lg hover:bg-white/15 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active View Content */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 pb-24 lg:pb-10">
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Primary Column: Virtual Card + Quick Actions + Cashflow Stats */}
              <div className="lg:col-span-7 space-y-6">
                <VirtualCard
                  user={user}
                  hideBalance={hideBalance}
                  onToggleHideBalance={() => setHideBalance((v) => !v)}
                />

                {/* 4 Primary Banking Quick Actions */}
                <section aria-label="Thao tác nhanh" className="grid grid-cols-4 gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPrefillRecipient(null);
                      setActiveTab('transfer');
                    }}
                    className="min-h-[82px] rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 hover:border-blue-500/70 p-3 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 flex items-center justify-center">
                      <Send className="w-5 h-5" />
                    </span>
                    <span className="text-xs font-semibold text-[#0B172A] dark:text-white whitespace-nowrap">
                      Chuyển tiền
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowReceiveQr(true)}
                    className="min-h-[82px] rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 hover:border-blue-500/70 p-3 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <Download className="w-5 h-5" />
                    </span>
                    <span className="text-xs font-semibold text-[#0B172A] dark:text-white whitespace-nowrap">
                      Nhận tiền
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('scan')}
                    className="min-h-[82px] rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 hover:border-blue-500/70 p-3 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <span className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <QrCode className="w-5 h-5" />
                    </span>
                    <span className="text-xs font-semibold text-[#0B172A] dark:text-white whitespace-nowrap">
                      Quét QR
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="min-h-[82px] rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 hover:border-blue-500/70 p-3 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                      <History className="w-5 h-5" />
                    </span>
                    <span className="text-xs font-semibold text-[#0B172A] dark:text-white whitespace-nowrap">
                      Lịch sử
                    </span>
                  </button>
                </section>

                {/* Total Sent & Received Statistics */}
                <section
                  aria-label="Thống kê dòng tiền"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                >
                  <div className="rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 p-5">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>Tổng tiền đã nhận</span>
                      <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div
                      data-testid="stat-received"
                      className="mt-2 text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums"
                    >
                      {hideBalance ? '••••••' : `+${formatPlaycoin(stats.totalReceived)}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">PLAYCOIN</div>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 p-5">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>Tổng tiền đã gửi</span>
                      <ArrowUpRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    </div>
                    <div
                      data-testid="stat-sent"
                      className="mt-2 text-2xl font-mono font-bold text-[#0B172A] dark:text-white tabular-nums"
                    >
                      {hideBalance ? '••••••' : `-${formatPlaycoin(stats.totalSent)}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">PLAYCOIN</div>
                  </div>
                </section>

                {/* Achievement Summary Strip */}
                <section className="rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Award className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#0B172A] dark:text-white">
                        Thành tích & Xếp hạng PLAYBANK
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {achievements.length > 0
                          ? `Đã mở khóa ${achievements.length} thành tích · ${stats.txCount} giao dịch đã thực hiện`
                          : 'Thực hiện giao dịch đầu tiên để mở khóa huy hiệu người chơi.'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('leaderboard')}
                    className="h-9 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs font-semibold text-[#0B172A] dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Xem BXH
                  </button>
                </section>
              </div>

              {/* Right Column: 5 Most Recent Transactions */}
              <section
                aria-label="5 giao dịch gần nhất"
                className="lg:col-span-5 rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-sm"
              >
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[#0B172A] dark:text-white">
                      Giao dịch gần nhất
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Hiển thị tối đa 5 giao dịch mới nhất
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Xem tất cả
                  </button>
                </div>

                {recentTransactions.length === 0 ? (
                  <div className="p-8 text-center space-y-2.5">
                    <div className="text-sm font-semibold text-[#0B172A] dark:text-white">
                      Chưa có giao dịch nào
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Hãy chuyển thử PLAYCOIN cho bạn bè hoặc chia sẻ mã QR nhận tiền của bạn.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('transfer')}
                      className="mt-2 h-10 px-4 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                    >
                      Chuyển tiền ngay
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {recentTransactions.map((tx) => {
                      const isSent = tx.senderId === user.id;
                      const otherName = isSent ? tx.recipientName : tx.senderName;
                      return (
                        <button
                          key={tx.id}
                          type="button"
                          onClick={() => setSelectedReceipt(tx)}
                          className="w-full text-left px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-[#14223B]/70 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                isSent
                                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                  : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {isSent ? (
                                <ArrowUpRight className="w-4 h-4" />
                              ) : (
                                <ArrowDownLeft className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[#0B172A] dark:text-white truncate">
                                {otherName}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {tx.note}
                              </div>
                              <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums mt-0.5">
                                {formatShortTimeVN(tx.createdAt)} · {tx.txCode}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div
                              className={`text-sm font-mono font-bold tabular-nums ${
                                isSent
                                  ? 'text-[#0B172A] dark:text-slate-100'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {isSent ? '-' : '+'}
                              {formatPlaycoin(tx.amount)}
                            </div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              PLAYCOIN
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'transfer' && (
            <TransferView
              user={user}
              initialRecipientAccount={prefillRecipient?.account}
              initialMethod={prefillRecipient?.method}
              onOpenScanner={() => setActiveTab('scan')}
              onTransferSuccess={handleTransferSuccess}
              onGoHome={() => setActiveTab('dashboard')}
            />
          )}

          {activeTab === 'scan' && <QrScannerView onDecodedAccount={handleQrDecoded} />}

          {activeTab === 'history' && (
            <HistoryView
              currentUserId={user.id}
              onSelectReceipt={(tx) => setSelectedReceipt(tx)}
              onStartTransfer={() => setActiveTab('transfer')}
            />
          )}

          {activeTab === 'leaderboard' && (
            <LeaderboardView
              user={user}
              achievements={achievements}
              onProfileUpdated={(updatedUser) =>
                setSummary((prev) => (prev ? { ...prev, user: updatedUser } : prev))
              }
            />
          )}

          {activeTab === 'profile' && (
            <ProfileView
              user={user}
              darkMode={darkMode}
              onToggleDarkMode={() => setDarkMode((d) => !d)}
              onProfileUpdated={(updatedUser) =>
                setSummary((prev) => (prev ? { ...prev, user: updatedUser } : prev))
              }
              onLogout={handleLogout}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Navigation (60px height; combined with 56px top bar = 116px <= 15% of 844px) */}
      <nav
        aria-label="Điều hướng di động"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#0B1526]/95 pb-glass border-t border-slate-200/90 dark:border-slate-800 pb-safe"
      >
        <div className="grid grid-cols-5 h-[60px]">
          {mobileTabs.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id !== 'transfer') setPrefillRecipient(null);
                  setActiveTab(item.id);
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                  active
                    ? 'text-blue-700 dark:text-blue-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      {showReceiveQr && <ReceiveQrModal user={user} onClose={() => setShowReceiveQr(false)} />}

      {selectedReceipt && (
        <ReceiptModal
          transaction={selectedReceipt}
          currentUserId={user.id}
          onClose={() => setSelectedReceipt(null)}
        />
      )}
    </div>
  );
}
