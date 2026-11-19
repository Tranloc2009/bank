import React, { useState } from 'react';
import { Eye, EyeOff, ArrowRight, ShieldCheck, QrCode, Users, Coins } from 'lucide-react';
import { playbankApi, ApiError } from '../lib/api';
import {
  CARD_SURFACE_IMAGE,
  SIMULATOR_BANNER,
  type UserProfile,
} from '../lib/banking';

interface AuthViewProps {
  onAuthenticated: (user: UserProfile) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function AuthView({ onAuthenticated, darkMode, onToggleDarkMode }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Vui lòng nhập đầy đủ email và mật khẩu.');
      return;
    }
    if (mode === 'register' && displayName.trim().length < 2) {
      setError('Tên hiển thị phải có ít nhất 2 ký tự.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await playbankApi.register({
          email: trimmedEmail,
          password,
          displayName: displayName.trim(),
        });
        onAuthenticated(res.user);
      } else {
        const res = await playbankApi.login({
          email: trimmedEmail,
          password,
        });
        onAuthenticated(res.user);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Không thể kết nối máy chủ PLAYBANK. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fillDemoAccount = (demoEmail: string) => {
    setMode('login');
    setEmail(demoEmail);
    setPassword('Playbank123');
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FB] dark:bg-[#070E1A] text-[#0B172A] dark:text-slate-100">
      {/* Slim mandatory simulator notice */}
      <div className="w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0B1526]/90 pb-glass">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-11 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-extrabold tracking-tight text-sm text-[#0B172A] dark:text-white whitespace-nowrap shrink-0">
              PLAYBANK
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              /
            </span>
            <span className="text-[11px] sm:text-xs font-semibold tracking-wide text-blue-700 dark:text-blue-400 truncate">
              {SIMULATOR_BANNER}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0B172A] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {darkMode ? 'Chế độ sáng' : 'Chế độ tối'}
          </button>
        </div>
      </div>

      {/* Main 2-column responsive layout */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 lg:py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Left Hero Showcase */}
          <section className="lg:col-span-7 flex flex-col justify-between rounded-3xl bg-[#0B172A] text-white p-6 sm:p-10 relative overflow-hidden border border-slate-800">
            <img
              src={CARD_SURFACE_IMAGE}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-[#071020]/90 via-[#0B1B36]/80 to-[#1D4ED8]/45 pointer-events-none" />

            <div className="relative z-10 space-y-6">
              <div className="text-xs font-semibold tracking-wider text-blue-300">
                {SIMULATOR_BANNER}
              </div>

              <div className="space-y-3">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight text-white">
                  Trải nghiệm ngân hàng số giả lập đa người chơi
                </h1>
                <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
                  Đăng ký tài khoản trong vài giây, nhận ngay{' '}
                  <span className="font-mono font-semibold text-white tabular-nums">
                    1.000.000 PLAYCOIN
                  </span>{' '}
                  và thực hiện chuyển khoản thời gian thực với bạn bè qua số tài khoản hoặc mã QR nội bộ.
                </p>
              </div>

              {/* Preview Card */}
              <div className="relative rounded-2xl overflow-hidden border border-white/15 bg-white/10 pb-glass p-5 sm:p-6 max-w-md">
                <div className="flex items-center justify-between">
                  <span className="text-base font-extrabold tracking-tight text-white">PLAYBANK</span>
                  <span className="text-[11px] font-mono tracking-wider text-blue-200">
                    VIRTUAL PLATINUM
                  </span>
                </div>
                <div className="mt-6">
                  <div className="text-[11px] text-blue-200/80">Quà chào mừng tài khoản mới</div>
                  <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight tabular-nums text-white mt-1">
                    1.000.000 <span className="text-sm font-sans font-semibold text-blue-200">PLAYCOIN</span>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-xs text-slate-200/90">
                  <span className="font-mono tracking-widest">8801 •••• ••</span>
                  <span>Cấp duy nhất 1 lần phía máy chủ</span>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-8 pt-6 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-200">
              <div className="flex items-start gap-2.5">
                <QrCode className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-white">Mã QR nội bộ</div>
                  <div className="text-slate-300/80 mt-0.5">Quét camera hoặc tải ảnh từ thư viện</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Users className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-white">Đồng bộ nhiều thiết bị</div>
                  <div className="text-slate-300/80 mt-0.5">Chuyển tiền & nhận thông báo tức thì</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-white">Xác thực máy chủ</div>
                  <div className="text-slate-300/80 mt-0.5">Giao dịch atomic, chống gửi trùng</div>
                </div>
              </div>
            </div>
          </section>

          {/* Right Auth Form Card */}
          <section className="lg:col-span-5 flex flex-col justify-between rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-sm">
            <div>
              {/* Segmented Auth Mode Switch */}
              <div
                role="tablist"
                aria-label="Chọn đăng nhập hoặc đăng ký"
                className="grid grid-cols-2 p-1 rounded-2xl bg-slate-100 dark:bg-[#091222]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className={`py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                    mode === 'login'
                      ? 'bg-white dark:bg-[#172540] text-[#0B172A] dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-[#0B172A] dark:hover:text-white'
                  }`}
                >
                  Đăng nhập
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className={`py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                    mode === 'register'
                      ? 'bg-white dark:bg-[#172540] text-[#0B172A] dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-[#0B172A] dark:hover:text-white'
                  }`}
                >
                  Đăng ký mới
                </button>
              </div>

              <div className="mt-6">
                <h2 className="text-xl font-bold text-[#0B172A] dark:text-white">
                  {mode === 'login' ? 'Chào mừng trở lại PLAYBANK' : 'Mở tài khoản PLAYBANK'}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {mode === 'login'
                    ? 'Đăng nhập để quản lý số dư PLAYCOIN và lịch sử giao dịch.'
                    : 'Nhận ngay số tài khoản riêng và 1.000.000 PLAYCOIN khởi đầu.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                {mode === 'register' && (
                  <div>
                    <label
                      htmlFor="auth-display-name"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                    >
                      Tên hiển thị
                    </label>
                    <input
                      id="auth-display-name"
                      type="text"
                      required
                      maxLength={50}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ví dụ: Nguyễn Minh An"
                      className="w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-sm text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 transition-colors"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                  >
                    Email
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ban@example.com"
                    className="w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-sm text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                  >
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      className="w-full h-12 pl-4 pr-12 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-sm text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/70 text-sm text-red-700 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
                >
                  <span>
                    {loading
                      ? 'Đang xử lý...'
                      : mode === 'login'
                      ? 'Đăng nhập vào PLAYBANK'
                      : 'Tạo tài khoản & Nhận 1.000.000 PLAYCOIN'}
                  </span>
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>
            </div>

            {/* Quick demo account autofill (still executes real server login) */}
            <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Coins className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Tài khoản mẫu có sẵn để thử chuyển tiền ngay</span>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => fillDemoAccount('minhquan@playbank.demo')}
                  className="text-left px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-[#0B172A] dark:text-white truncate">
                    Nguyễn Minh Quân
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    STK: 8801 0000 01
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => fillDemoAccount('khanhlinh@playbank.demo')}
                  className="text-left px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-[#0B172A] dark:text-white truncate">
                    Trần Khánh Linh
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    STK: 8801 0000 02
                  </div>
                </button>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2.5">
                Mật khẩu tài khoản mẫu: <span className="font-mono text-slate-600 dark:text-slate-300">Playbank123</span>. Bạn cũng có thể đăng ký tài khoản riêng hoàn toàn mới.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
