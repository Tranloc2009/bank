import { useCallback, useEffect, useState } from 'react';
import { Trophy, Award, EyeOff, Eye, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { playbankApi, ApiError } from '../lib/api';
import {
  formatDateTimeVN,
  formatPlaycoin,
  type AchievementRecord,
  type LeaderboardEntry,
  type UserProfile,
} from '../lib/banking';

interface LeaderboardViewProps {
  user: UserProfile;
  achievements: AchievementRecord[];
  onProfileUpdated: (user: UserProfile) => void;
}

const ALL_ACHIEVEMENT_DEFS = [
  {
    code: 'FIRST_TRANSFER',
    title: 'Giao dịch đầu tiên',
    description: 'Hoàn thành lệnh chuyển PLAYCOIN đầu tiên trên PLAYBANK.',
  },
  {
    code: 'FIRST_RECEIVE',
    title: 'Lần đầu nhận tiền',
    description: 'Nhận được khoản PLAYCOIN đầu tiên từ người chơi khác.',
  },
  {
    code: 'QR_PAY_PRO',
    title: 'Chuyên gia Quét QR',
    description: 'Chuyển tiền thành công bằng mã QR nội bộ PLAYBANK.',
  },
  {
    code: 'HIGH_ROLLER',
    title: 'Tay chơi hào phóng',
    description: 'Thực hiện một giao dịch từ 500.000 PLAYCOIN trở lên.',
  },
  {
    code: 'WEALTH_BUILDER',
    title: 'Tài phiệt PLAYBANK',
    description: 'Đạt mốc số dư từ 1.500.000 PLAYCOIN trở lên.',
  },
];

export function LeaderboardView({ user, achievements, onProfileUpdated }: LeaderboardViewProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingAnon, setTogglingAnon] = useState(false);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await playbankApi.getLeaderboard();
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tải bảng xếp hạng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const handleToggleAnonymous = async () => {
    setTogglingAnon(true);
    try {
      const res = await playbankApi.updateProfile({ isAnonymous: !user.isAnonymous });
      onProfileUpdated(res.user);
      await loadLeaderboard();
    } catch {
      // Keep previous state on failure
    } finally {
      setTogglingAnon(false);
    }
  };

  const unlockedMap = new Map(achievements.map((a) => [a.code, a]));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Richest Players Leaderboard */}
      <section className="lg:col-span-7 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0B172A] dark:text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>Bảng xếp hạng giàu nhất</span>
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Xếp hạng người chơi có tổng số dư PLAYCOIN cao nhất hệ thống.
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggleAnonymous}
            disabled={togglingAnon}
            className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F1A2E] hover:border-blue-500 text-xs font-semibold text-[#0B172A] dark:text-white inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            {user.isAnonymous ? (
              <>
                <EyeOff className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Đang ẩn danh (Tắt)</span>
              </>
            ) : (
              <>
                <Eye className="w-4 h-4 text-slate-500" />
                <span>Ẩn danh trên BXH</span>
              </>
            )}
          </button>
        </div>

        <div className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="p-10 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
              <div className="text-sm font-medium text-[#0B172A] dark:text-white">{error}</div>
              <button
                type="button"
                onClick={loadLeaderboard}
                className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold cursor-pointer"
              >
                Tải lại
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {entries.map((entry) => (
                <div
                  key={`${entry.rank}-${entry.accountMask}`}
                  className={`px-5 py-3.5 flex items-center justify-between gap-4 ${
                    entry.isCurrentUser ? 'bg-blue-50/70 dark:bg-blue-950/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono text-sm font-bold shrink-0 ${
                        entry.rank === 1
                          ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : entry.rank === 2
                          ? 'bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          : entry.rank === 3
                          ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      #{entry.rank}
                    </div>
                    <img
                      src={entry.avatarUrl}
                      alt={entry.displayName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#0B172A] dark:text-white truncate">
                        {entry.displayName}{' '}
                        {entry.isCurrentUser && (
                          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                            (Bạn)
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                        {entry.accountMask}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm sm:text-base font-mono font-bold text-[#0B172A] dark:text-white tabular-nums">
                      {formatPlaycoin(entry.balance)}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">PLAYCOIN</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Achievements Panel */}
      <section className="lg:col-span-5 space-y-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#0B172A] dark:text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>Thành tích của bạn</span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Đã mở khóa <span className="font-mono font-semibold">{achievements.length}</span> /{' '}
            <span className="font-mono font-semibold">{ALL_ACHIEVEMENT_DEFS.length}</span> cột mốc.
          </p>
        </div>

        <div className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 shadow-sm">
          {ALL_ACHIEVEMENT_DEFS.map((def) => {
            const unlocked = unlockedMap.get(def.code);
            return (
              <div key={def.code} className="p-4 sm:p-5 flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    unlocked
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                      : 'bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-600'
                  }`}
                >
                  {unlocked ? <CheckCircle2 className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3
                      className={`text-sm font-bold ${
                        unlocked
                          ? 'text-[#0B172A] dark:text-white'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {def.title}
                    </h3>
                    <span
                      className={`text-[11px] font-semibold shrink-0 ${
                        unlocked
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {unlocked ? 'Đã đạt' : 'Chưa mở'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {def.description}
                  </p>
                  {unlocked && (
                    <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-1.5 tabular-nums">
                      Mở khóa lúc {formatDateTimeVN(unlocked.unlockedAt)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
