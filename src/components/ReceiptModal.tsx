import { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Download, Copy, Check, X } from 'lucide-react';
import {
  RECEIPT_WATERMARK,
  SIMULATOR_BANNER,
  formatAccountNumber,
  formatDateTimeVN,
  formatPlaycoin,
  type TransactionRecord,
} from '../lib/banking';
import { downloadReceiptImage } from '../lib/receiptCanvas';

interface ReceiptModalProps {
  transaction: TransactionRecord;
  currentUserId: string;
  onClose: () => void;
}

export function ReceiptModal({ transaction, currentUserId, onClose }: ReceiptModalProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const isSender = transaction.senderId === currentUserId;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(transaction.txCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 pb-glass overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto"
      >
        {/* Top navy-blue receipt header */}
        <div className="relative bg-gradient-to-br from-[#0B172A] to-[#1D4ED8] px-6 pt-5 pb-7 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-extrabold tracking-tight">PLAYBANK</div>
              <div className="text-[10px] font-medium text-blue-200/90 mt-0.5">
                {SIMULATOR_BANNER}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng biên nhận"
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-5 text-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.08, duration: 0.25 }}
              className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center mx-auto"
            >
              <CheckCircle2 className="w-7 h-7 text-emerald-300" />
            </motion.div>
            <h2 id="receipt-dialog-title" className="mt-3 text-sm font-semibold text-blue-100">
              {isSender ? 'Biên nhận chuyển tiền thành công' : 'Biên nhận nhận tiền thành công'}
            </h2>
            <div className="mt-1 text-3xl font-mono font-bold tabular-nums text-white">
              {isSender ? '-' : '+'}
              {formatPlaycoin(transaction.amount)}{' '}
              <span className="text-sm font-sans font-semibold text-blue-200">PLAYCOIN</span>
            </div>
          </div>
        </div>

        {/* Receipt Body with mandatory watermark */}
        <div className="relative p-6 space-y-3.5 text-sm">
          {/* Mandatory receipt watermark overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
          >
            <span className="-rotate-12 text-center font-extrabold text-xs tracking-widest text-slate-900/[0.06] dark:text-white/[0.06] px-4">
              {RECEIPT_WATERMARK}
            </span>
          </div>

          <div className="relative z-10 divide-y divide-slate-100 dark:divide-slate-800/80">
            <div className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Mã giao dịch</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-[#0B172A] dark:text-white tabular-nums">
                  {transaction.txCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  aria-label="Sao chép mã giao dịch"
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Thời gian</span>
              <span className="font-mono text-[#0B172A] dark:text-slate-100 tabular-nums">
                {formatDateTimeVN(transaction.createdAt)}
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Trạng thái</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                Hoàn tất
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400">Phương thức</span>
              <span className="font-medium text-[#0B172A] dark:text-slate-100">
                {transaction.method === 'qr' ? 'Quét mã QR nội bộ' : 'Chuyển qua số tài khoản'}
              </span>
            </div>

            <div className="py-2.5 flex items-start justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Người gửi</span>
              <div className="text-right">
                <div className="font-semibold text-[#0B172A] dark:text-white">{transaction.senderName}</div>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatAccountNumber(transaction.senderAccount)}
                </div>
              </div>
            </div>

            <div className="py-2.5 flex items-start justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Người nhận</span>
              <div className="text-right">
                <div className="font-semibold text-[#0B172A] dark:text-white">{transaction.recipientName}</div>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatAccountNumber(transaction.recipientAccount)}
                </div>
              </div>
            </div>

            <div className="py-2.5 flex items-start justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Nội dung</span>
              <span className="text-right font-medium text-[#0B172A] dark:text-slate-100 break-words max-w-[260px]">
                {transaction.note}
              </span>
            </div>
          </div>

          {/* Explicit readable watermark bar */}
          <div className="relative z-10 rounded-xl bg-slate-100 dark:bg-[#091222] border border-slate-200/80 dark:border-slate-800 px-3.5 py-2.5 text-center">
            <div className="text-[11px] font-bold tracking-wide text-[#0F2747] dark:text-blue-300">
              {RECEIPT_WATERMARK}
            </div>
          </div>

          {/* Actions */}
          <div className="relative z-10 pt-2 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => downloadReceiptImage(transaction)}
              className="flex-1 h-11 px-4 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>Lưu ảnh biên nhận</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sm:w-32 h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap"
            >
              Đóng
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
