import React, { useEffect, useState } from 'react';
import {
  Search,
  QrCode,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Download,
  Award,
  AlertCircle,
} from 'lucide-react';
import { playbankApi, ApiError } from '../lib/api';
import {
  RECEIPT_WATERMARK,
  createIdempotencyKey,
  formatAccountNumber,
  formatDateTimeVN,
  formatPlaycoin,
  normalizeAccountNumber,
  parseAmountInput,
  validateTransferAmount,
  type AccountLookupResult,
  type AchievementRecord,
  type TransactionRecord,
  type TransferMethod,
  type UserProfile,
} from '../lib/banking';
import { downloadReceiptImage } from '../lib/receiptCanvas';
import { playBankingSound } from '../lib/sound';

interface TransferViewProps {
  user: UserProfile;
  initialRecipientAccount?: string;
  initialMethod?: TransferMethod;
  onOpenScanner: () => void;
  onTransferSuccess: (tx: TransactionRecord, newBalance: number, newAchievements: AchievementRecord[]) => void;
  onGoHome: () => void;
}

const QUICK_AMOUNTS = [50_000, 100_000, 200_000, 500_000];

export function TransferView({
  user,
  initialRecipientAccount,
  initialMethod = 'account',
  onOpenScanner,
  onTransferSuccess,
  onGoHome,
}: TransferViewProps) {
  const [step, setStep] = useState<'form' | 'confirm' | 'receipt'>('form');
  const [accountInput, setAccountInput] = useState(initialRecipientAccount ?? '');
  const [method, setMethod] = useState<TransferMethod>(initialMethod);
  const [recipient, setRecipient] = useState<AccountLookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [amountRaw, setAmountRaw] = useState('');
  const [note, setNote] = useState(`${user.displayName} chuyển PLAYCOIN`);
  const [formError, setFormError] = useState<string | null>(null);

  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [completedTx, setCompletedTx] = useState<TransactionRecord | null>(null);
  const [unlockedAchievements, setUnlockedAchievements] = useState<AchievementRecord[]>([]);

  const numericAmount = parseAmountInput(amountRaw);

  const lookupRecipient = async (rawAcc: string) => {
    const clean = normalizeAccountNumber(rawAcc);
    setLookupError(null);
    setRecipient(null);

    if (clean.length !== 10) {
      setLookupError('Số tài khoản PLAYBANK gồm đúng 10 chữ số.');
      return;
    }

    setLookupLoading(true);
    try {
      const res = await playbankApi.lookupAccount(clean);
      if (res.isSelf) {
        setLookupError('Bạn không thể tự chuyển PLAYCOIN tới tài khoản của chính mình.');
        setRecipient(null);
      } else {
        setRecipient(res);
      }
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Không tìm thấy tài khoản.');
    } finally {
      setLookupLoading(false);
    }
  };

  // Auto-lookup when pre-filled from QR scan
  useEffect(() => {
    if (initialRecipientAccount) {
      const clean = normalizeAccountNumber(initialRecipientAccount);
      setAccountInput(clean);
      setMethod(initialMethod);
      setStep('form');
      if (clean.length === 10) {
        lookupRecipient(clean);
      }
    }
  }, [initialRecipientAccount, initialMethod]);

  const handleAccountChange = (val: string) => {
    const clean = normalizeAccountNumber(val);
    setAccountInput(clean);
    setMethod('account');
    setFormError(null);
    if (clean.length < 10) {
      setRecipient(null);
      setLookupError(null);
    } else if (clean.length === 10) {
      lookupRecipient(clean);
    }
  };

  const handleAmountChange = (val: string) => {
    const parsed = parseAmountInput(val);
    setAmountRaw(parsed > 0 ? formatPlaycoin(parsed) : '');
    setFormError(null);
  };

  const handleProceedConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!recipient) {
      setFormError('Vui lòng nhập và kiểm tra số tài khoản người nhận hợp lệ.');
      return;
    }
    if (recipient.isSelf) {
      setFormError('Không thể tự chuyển tiền cho chính mình.');
      return;
    }
    const amountError = validateTransferAmount(numericAmount, user.balance);
    if (amountError) {
      setFormError(amountError);
      return;
    }

    // Generate one idempotency key for this confirmation step so accidental double submits are deduplicated
    setIdempotencyKey(createIdempotencyKey());
    setSubmitError(null);
    setStep('confirm');
  };

  const handleConfirmTransfer = async () => {
    if (!recipient || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await playbankApi.transfer({
        recipientAccount: recipient.accountNumber,
        amount: numericAmount,
        note: note.trim() || `${user.displayName} chuyển PLAYCOIN`,
        method,
        idempotencyKey,
      });

      setCompletedTx(res.transaction);
      setUnlockedAchievements(res.newAchievements);
      setStep('receipt');
      if (user.soundEnabled) {
        playBankingSound('success');
      }
      onTransferSuccess(res.transaction, res.balance, res.newAchievements);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Giao dịch thất bại. Vui lòng thử lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep('form');
    setAccountInput('');
    setRecipient(null);
    setLookupError(null);
    setAmountRaw('');
    setNote(`${user.displayName} chuyển PLAYCOIN`);
    setFormError(null);
    setSubmitError(null);
    setCompletedTx(null);
    setUnlockedAchievements([]);
    setMethod('account');
  };

  if (step === 'receipt' && completedTx) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="bg-gradient-to-br from-[#0B172A] to-[#1D4ED8] px-6 py-8 text-center text-white">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-300" />
            </div>
            <h2 className="mt-4 text-lg font-bold">Chuyển tiền ảo thành công</h2>
            <div className="mt-1.5 text-3xl sm:text-4xl font-mono font-bold tabular-nums">
              -{formatPlaycoin(completedTx.amount)}{' '}
              <span className="text-base font-sans font-semibold text-blue-200">PLAYCOIN</span>
            </div>
            <p className="mt-2 text-xs text-blue-200/90 font-mono">
              Mã giao dịch: {completedTx.txCode}
            </p>
          </div>

          <div className="relative p-6 space-y-4">
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <span className="-rotate-12 text-center font-extrabold text-xs tracking-widest text-slate-900/[0.05] dark:text-white/[0.05] px-4">
                {RECEIPT_WATERMARK}
              </span>
            </div>

            {unlockedAchievements.length > 0 && (
              <div className="relative z-10 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/70 p-4 flex items-start gap-3">
                <Award className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-blue-900 dark:text-blue-200">
                    Mở khóa thành tích mới
                  </div>
                  {unlockedAchievements.map((ach) => (
                    <div key={ach.id} className="text-sm font-semibold text-[#0B172A] dark:text-white mt-0.5">
                      {ach.title} — <span className="font-normal text-slate-600 dark:text-slate-300">{ach.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="relative z-10 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Người nhận</span>
                <div className="text-right">
                  <div className="font-semibold text-[#0B172A] dark:text-white">{completedTx.recipientName}</div>
                  <div className="text-xs font-mono text-slate-500 tabular-nums">
                    {formatAccountNumber(completedTx.recipientAccount)}
                  </div>
                </div>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Người gửi</span>
                <div className="text-right">
                  <div className="font-semibold text-[#0B172A] dark:text-white">{completedTx.senderName}</div>
                  <div className="text-xs font-mono text-slate-500 tabular-nums">
                    {formatAccountNumber(completedTx.senderAccount)}
                  </div>
                </div>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Thời gian</span>
                <span className="font-mono text-[#0B172A] dark:text-slate-100 tabular-nums">
                  {formatDateTimeVN(completedTx.createdAt)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Trạng thái</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Hoàn tất
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Phương thức</span>
                <span className="font-medium text-[#0B172A] dark:text-slate-100">
                  {completedTx.method === 'qr' ? 'Quét mã QR nội bộ' : 'Chuyển qua số tài khoản'}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Nội dung</span>
                <span className="text-right font-medium text-[#0B172A] dark:text-slate-100 max-w-[260px] break-words">
                  {completedTx.note}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Số dư còn lại</span>
                <span className="font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                  {formatPlaycoin(user.balance)} PLAYCOIN
                </span>
              </div>
            </div>

            <div className="relative z-10 rounded-xl bg-slate-100 dark:bg-[#091222] border border-slate-200 dark:border-slate-800 px-3 py-2.5 text-center text-[11px] font-bold tracking-wide text-[#0F2747] dark:text-blue-300">
              {RECEIPT_WATERMARK}
            </div>

            <div className="relative z-10 space-y-2.5 pt-2">
              <button
                type="button"
                onClick={() => downloadReceiptImage(completedTx)}
                className="w-full h-12 px-5 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Lưu ảnh biên nhận (PNG)</span>
              </button>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleReset}
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold text-[#0B172A] dark:text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  Giao dịch mới
                </button>
                <button
                  type="button"
                  onClick={onGoHome}
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Về trang chủ
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && recipient) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm">
          <button
            type="button"
            onClick={() => setStep('form')}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-[#0B172A] dark:text-slate-400 dark:hover:text-white mb-5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại chỉnh sửa</span>
          </button>

          <h2 className="text-xl font-bold text-[#0B172A] dark:text-white">
            Xác nhận giao dịch chuyển tiền
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Kiểm tra kỹ thông tin người nhận trước khi thực hiện. Giao dịch không thể hoàn tác.
          </p>

          <div className="mt-6 rounded-2xl bg-slate-50 dark:bg-[#091222] border border-slate-200/80 dark:border-slate-800 p-5 text-center">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Số tiền chuyển</div>
            <div className="mt-1 text-3xl font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
              {formatPlaycoin(numericAmount)}{' '}
              <span className="text-sm font-sans font-semibold">PLAYCOIN</span>
            </div>
          </div>

          <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <div className="py-3 flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Tài khoản nguồn</span>
              <div className="text-right">
                <div className="font-semibold text-[#0B172A] dark:text-white">{user.displayName}</div>
                <div className="text-xs font-mono text-slate-500 tabular-nums">
                  {formatAccountNumber(user.accountNumber)}
                </div>
              </div>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Người nhận</span>
              <div className="text-right">
                <div className="font-semibold text-[#0B172A] dark:text-white">{recipient.displayName}</div>
                <div className="text-xs font-mono text-slate-500 tabular-nums">
                  {formatAccountNumber(recipient.accountNumber)}
                </div>
              </div>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Phương thức</span>
              <span className="font-medium text-[#0B172A] dark:text-slate-100">
                {method === 'qr' ? 'Quét mã QR nội bộ' : 'Chuyển qua số tài khoản'}
              </span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Phí giao dịch</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                0 PLAYCOIN
              </span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Nội dung chuyển</span>
              <span className="text-right font-medium text-[#0B172A] dark:text-slate-100 max-w-[260px] break-words">
                {note.trim() || `${user.displayName} chuyển PLAYCOIN`}
              </span>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Số dư sau giao dịch (dự kiến)</span>
              <span className="font-mono font-semibold text-[#0B172A] dark:text-white tabular-nums">
                {formatPlaycoin(user.balance - numericAmount)} PLAYCOIN
              </span>
            </div>
          </div>

          {submitError && (
            <div
              role="alert"
              className="mt-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/70 text-sm text-red-700 dark:text-red-300 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleConfirmTransfer}
              disabled={submitting}
              className="flex-1 h-12 px-6 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>{submitting ? 'Đang xử lý giao dịch...' : 'Xác nhận chuyển tiền'}</span>
              {!submitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#0B172A] dark:text-white">
            Chuyển tiền PLAYCOIN
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Số dư khả dụng:{' '}
            <span className="font-mono font-semibold text-[#0B172A] dark:text-white tabular-nums">
              {formatPlaycoin(user.balance)} PLAYCOIN
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenScanner}
          className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F1A2E] hover:border-blue-500 text-sm font-semibold text-[#0B172A] dark:text-white inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <QrCode className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>Quét mã QR nhận tiền</span>
        </button>
      </div>

      {/* Main transfer form card */}
      <form
        onSubmit={handleProceedConfirm}
        noValidate
        className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6"
      >
        {/* Recipient Account Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="transfer-recipient-account"
              className="text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              Số tài khoản người nhận
            </label>
            {method === 'qr' && recipient && (
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                Đã điền tự động từ mã QR
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              id="transfer-recipient-account"
              type="text"
              inputMode="numeric"
              value={accountInput}
              onChange={(e) => handleAccountChange(e.target.value)}
              placeholder="Nhập 10 chữ số (ví dụ: 8801000002)"
              className="flex-1 h-12 px-4 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 font-mono text-sm text-[#0B172A] dark:text-white placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
            <button
              type="button"
              onClick={() => lookupRecipient(accountInput)}
              disabled={lookupLoading}
              className="h-12 px-4 rounded-xl bg-slate-100 dark:bg-[#172540] hover:bg-slate-200 dark:hover:bg-[#1E3154] text-sm font-semibold text-[#0B172A] dark:text-white inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Search className="w-4 h-4" />
              <span>{lookupLoading ? 'Đang tìm...' : 'Kiểm tra'}</span>
            </button>
          </div>

          {lookupError && (
            <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
              {lookupError}
            </p>
          )}

          {recipient && (
            <div
              data-testid="verified-recipient"
              className="mt-3 p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/70 flex items-center gap-3"
            >
              <img
                src={recipient.avatarUrl}
                alt={recipient.displayName}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-full object-cover border border-emerald-200 dark:border-emerald-800 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  Tài khoản PLAYBANK hợp lệ
                </div>
                <div className="text-sm font-bold text-[#0B172A] dark:text-white truncate">
                  {recipient.displayName}
                </div>
              </div>
              <span className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                {formatAccountNumber(recipient.accountNumber)}
              </span>
            </div>
          )}
        </div>

        {/* Amount Input */}
        <div>
          <label
            htmlFor="transfer-amount"
            className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
          >
            Số tiền chuyển (PLAYCOIN)
          </label>
          <div className="relative">
            <input
              id="transfer-amount"
              type="text"
              inputMode="numeric"
              value={amountRaw}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
              className="w-full h-14 pl-4 pr-28 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 font-mono text-xl font-bold tabular-nums text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              PLAYCOIN
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  setAmountRaw(formatPlaycoin(amt));
                  setFormError(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#172540] hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              >
                +{formatPlaycoin(amt)}
              </button>
            ))}
          </div>
        </div>

        {/* Transfer Note */}
        <div>
          <label
            htmlFor="transfer-note"
            className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
          >
            Nội dung giao dịch
          </label>
          <input
            id="transfer-note"
            type="text"
            maxLength={140}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nhập lời nhắn cho người nhận..."
            className="w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-sm text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
          />
        </div>

        {formError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/70 text-sm text-red-700 dark:text-red-300 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <button
          type="submit"
          className="w-full h-12 px-6 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
        >
          <span>Tiếp tục xác nhận</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
