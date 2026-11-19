import { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import {
  CARD_SURFACE_IMAGE,
  formatAccountNumber,
  formatPlaycoin,
  type UserProfile,
} from '../lib/banking';

interface VirtualCardProps {
  user: UserProfile;
  hideBalance: boolean;
  onToggleHideBalance: () => void;
}

export function VirtualCard({ user, hideBalance, onToggleHideBalance }: VirtualCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyAccount = async () => {
    try {
      await navigator.clipboard.writeText(user.accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="relative rounded-3xl overflow-hidden bg-[#0B172A] text-white border border-slate-800/80 shadow-lg shadow-blue-950/15">
      {/* Generated metallic sapphire silk texture */}
      <img
        src={CARD_SURFACE_IMAGE}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className="absolute inset-0 w-full h-full object-cover opacity-55 pointer-events-none"
      />
      {/* Measured contrast scrim for guaranteed WCAG AA contrast */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#061124]/90 via-[#0B2046]/70 to-[#1D4ED8]/55 pointer-events-none" />

      <div className="relative z-10 p-6 sm:p-7 flex flex-col justify-between min-h-[228px] sm:min-h-[246px]">
        {/* Top row: Brand + Card Tier */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
              PLAYBANK
            </div>
            <div className="text-[11px] font-medium text-blue-200/85 mt-0.5">
              Tài khoản thanh toán giả lập
            </div>
          </div>

          {/* Geometric fictional EMV chip */}
          <div
            aria-hidden="true"
            className="w-11 h-8 rounded-lg border border-white/25 bg-gradient-to-br from-amber-100/35 via-white/15 to-blue-200/20 flex items-center justify-center"
          >
            <div className="w-7 h-5 border border-white/30 rounded-sm grid grid-cols-2 gap-px p-0.5">
              <div className="border-r border-b border-white/25" />
              <div className="border-b border-white/25" />
              <div className="border-r border-white/25" />
              <div />
            </div>
          </div>
        </div>

        {/* Center row: Balance + Eye toggle */}
        <div className="my-5">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-100/80">
            <span>Số dư khả dụng</span>
            <button
              type="button"
              onClick={onToggleHideBalance}
              aria-label={hideBalance ? 'Hiện số dư' : 'Ẩn số dư'}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/15 transition-colors cursor-pointer text-blue-100"
            >
              {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
            <span
              data-testid="balance-amount"
              className="text-3xl sm:text-4xl font-mono font-bold tracking-tight tabular-nums text-white"
            >
              {hideBalance ? '••••••••' : formatPlaycoin(user.balance)}
            </span>
            <span className="text-sm font-semibold tracking-wide text-blue-200">
              PLAYCOIN
            </span>
          </div>
        </div>

        {/* Bottom row: Holder Name + Account Number with Copy */}
        <div className="pt-4 border-t border-white/15 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-blue-200/75">Chủ tài khoản</div>
            <div className="text-sm sm:text-base font-semibold tracking-wide text-white truncate">
              {user.displayName}
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto shrink-0">
            <div className="text-left sm:text-right">
              <div className="text-[11px] text-blue-200/75">Số tài khoản</div>
              <div
                data-testid="account-number"
                className="text-sm sm:text-base font-mono font-semibold tracking-wider tabular-nums text-white"
              >
                {formatAccountNumber(user.accountNumber)}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyAccount}
              aria-label="Sao chép số tài khoản"
              className="min-h-[40px] min-w-[40px] px-3 rounded-xl bg-white/12 hover:bg-white/20 border border-white/15 flex items-center justify-center gap-1.5 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
