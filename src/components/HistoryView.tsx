import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  ReceiptText,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { playbankApi, ApiError } from '../lib/api';
import {
  formatAccountNumber,
  formatDateTimeVN,
  formatPlaycoin,
  type TransactionRecord,
} from '../lib/banking';

interface HistoryViewProps {
  currentUserId: string;
  onSelectReceipt: (tx: TransactionRecord) => void;
  onStartTransfer: () => void;
}

export function HistoryView({ currentUserId, onSelectReceipt, onStartTransfer }: HistoryViewProps) {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'sent' | 'received'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await playbankApi.getTransactions({
        q: search.trim() || undefined,
        direction,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      setTransactions(res.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tải lịch sử giao dịch.');
    } finally {
      setLoading(false);
    }
  }, [search, direction, fromDate, toDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchHistory();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchHistory]);

  const hasFilters = Boolean(search.trim() || direction !== 'all' || fromDate || toDate);

  const clearFilters = () => {
    setSearch('');
    setDirection('all');
    setFromDate('');
    setToDate('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#0B172A] dark:text-white">
            Lịch sử giao dịch
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Nhấn vào bất kỳ giao dịch nào để xem chi tiết và lưu ảnh biên nhận.
          </p>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Xóa bộ lọc</span>
          </button>
        )}
      </div>

      {/* Filters Toolbar */}
      <div className="rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Search input */}
          <div className="lg:col-span-5 relative">
            <label htmlFor="history-search" className="sr-only">
              Tìm kiếm giao dịch
            </label>
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="history-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã GD, tên người gửi/nhận, nội dung..."
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-sm text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
          </div>

          {/* Direction segmented tabs */}
          <div className="lg:col-span-3 flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#091222]">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'sent', label: 'Đã gửi' },
                { id: 'received', label: 'Đã nhận' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDirection(tab.id)}
                className={`flex-1 h-9 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  direction === tab.id
                    ? 'bg-white dark:bg-[#1B2B4A] text-[#0B172A] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0B172A] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="lg:col-span-4 grid grid-cols-2 gap-2">
            <div className="relative">
              <label htmlFor="history-from-date" className="sr-only">
                Từ ngày
              </label>
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="history-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="Lọc từ ngày"
                className="w-full h-11 pl-8 pr-2.5 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-xs font-mono text-[#0B172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
              />
            </div>
            <div className="relative">
              <label htmlFor="history-to-date" className="sr-only">
                Đến ngày
              </label>
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="history-to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Lọc đến ngày"
                className="w-full h-11 pl-8 pr-2.5 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-xs font-mono text-[#0B172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Results Container */}
      <div className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-6 space-y-3" aria-busy="true">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800/70 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <AlertCircle className="w-9 h-9 text-red-500 mx-auto" />
            <div className="text-sm font-semibold text-[#0B172A] dark:text-white">{error}</div>
            <button
              type="button"
              onClick={fetchHistory}
              className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <ReceiptText className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
            <div className="text-base font-bold text-[#0B172A] dark:text-white">
              {hasFilters ? 'Không tìm thấy giao dịch phù hợp' : 'Chưa có giao dịch nào'}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {hasFilters
                ? 'Hãy thử thay đổi từ khóa tìm kiếm hoặc khoảng ngày lọc.'
                : 'Mọi lệnh chuyển và nhận PLAYCOIN của bạn sẽ được lưu trữ vĩnh viễn tại đây.'}
            </p>
            {!hasFilters && (
              <button
                type="button"
                onClick={onStartTransfer}
                className="mt-2 h-11 px-5 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] text-white text-sm font-semibold cursor-pointer"
              >
                Thực hiện giao dịch đầu tiên
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {transactions.map((tx) => {
              const isSent = tx.senderId === currentUserId;
              const counterpartyName = isSent ? tx.recipientName : tx.senderName;
              const counterpartyAcc = isSent ? tx.recipientAccount : tx.senderAccount;

              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => onSelectReceipt(tx)}
                  className="w-full text-left px-5 py-4 hover:bg-slate-50/90 dark:hover:bg-[#14223B]/70 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isSent
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isSent ? (
                        <ArrowUpRight className="w-5 h-5" />
                      ) : (
                        <ArrowDownLeft className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#0B172A] dark:text-white truncate">
                        {isSent ? `Chuyển đến ${counterpartyName}` : `Nhận từ ${counterpartyName}`}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {tx.note}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                        <span>{tx.txCode}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatAccountNumber(counterpartyAcc)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDateTimeVN(tx.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm sm:text-base font-mono font-bold tabular-nums ${
                        isSent
                          ? 'text-[#0B172A] dark:text-slate-100'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isSent ? '-' : '+'}
                      {formatPlaycoin(tx.amount)}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {tx.method === 'qr' ? 'Qua QR' : 'Số TK'} · Biên nhận
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
