import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Download, X, ShieldAlert } from 'lucide-react';
import {
  SIMULATOR_BANNER,
  buildPlaybankQrPayload,
  formatAccountNumber,
  type UserProfile,
} from '../lib/banking';

interface ReceiveQrModalProps {
  user: UserProfile;
  onClose: () => void;
}

export function ReceiveQrModal({ user, onClose }: ReceiveQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const payload = buildPlaybankQrPayload(user.accountNumber);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(
      canvas,
      payload,
      {
        width: 240,
        margin: 2,
        color: {
          dark: '#0B172A',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
      },
      (err) => {
        if (err) {
          setQrError('Không thể tạo mã QR lúc này.');
        }
      }
    );
  }, [payload]);

  const handleCopyAccount = async () => {
    try {
      await navigator.clipboard.writeText(user.accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleDownloadQrCard = () => {
    const qrCanvas = canvasRef.current;
    if (!qrCanvas) return;

    const out = document.createElement('canvas');
    out.width = 640;
    out.height = 820;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, out.width, out.height);

    // Header gradient
    const grad = ctx.createLinearGradient(0, 0, out.width, 160);
    grad.addColorStop(0, '#0B172A');
    grad.addColorStop(1, '#1D4ED8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, out.width, 160);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 32px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('PLAYBANK', out.width / 2, 72);

    ctx.fillStyle = 'rgba(219, 234, 254, 0.92)';
    ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(SIMULATOR_BANNER, out.width / 2, 108);

    ctx.fillStyle = '#BFDBFE';
    ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('MÃ QR NHẬN TIỀN ẢO NỘI BỘ', out.width / 2, 138);

    // Draw high-res QR
    const qrSize = 380;
    ctx.drawImage(qrCanvas, (out.width - qrSize) / 2, 200, qrSize, qrSize);

    // Holder name & account number (zero private PII)
    ctx.fillStyle = '#0B172A';
    ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(user.displayName, out.width / 2, 640);

    ctx.fillStyle = '#1D4ED8';
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillText(formatAccountNumber(user.accountNumber), out.width / 2, 684);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Quét bằng ứng dụng PLAYBANK để chuyển PLAYCOIN', out.width / 2, 742);
    ctx.fillText('Chỉ dùng trong trò chơi mô phỏng — không có giá trị thanh toán thật', out.width / 2, 770);

    const link = document.createElement('a');
    link.href = out.toDataURL('image/png');
    link.download = `PLAYBANK-QR-${user.accountNumber}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receive-qr-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 pb-glass"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 id="receive-qr-title" className="text-base font-bold text-[#0B172A] dark:text-white">
              Nhận PLAYCOIN qua mã QR
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Định dạng QR nội bộ PLAYBANK
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng mã QR nhận tiền"
            className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col items-center text-center">
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
            {qrError ? (
              <div className="w-[240px] h-[240px] flex items-center justify-center text-sm text-red-600">
                {qrError}
              </div>
            ) : (
              <canvas ref={canvasRef} data-testid="receive-qr-canvas" className="block" />
            )}
          </div>

          <div className="mt-5">
            <div className="text-base font-bold text-[#0B172A] dark:text-white">{user.displayName}</div>
            <div className="mt-1 text-lg font-mono font-bold tracking-wider text-blue-700 dark:text-blue-400 tabular-nums">
              {formatAccountNumber(user.accountNumber)}
            </div>
            <div className="mt-1 text-xs font-mono text-slate-400 dark:text-slate-500">
              {payload}
            </div>
          </div>

          <div className="mt-4 w-full rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200/80 dark:border-slate-800 p-3 flex items-start gap-2.5 text-left text-xs text-slate-600 dark:text-slate-300">
            <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <span>
              Mã QR chỉ chứa số tài khoản ảo PLAYBANK, không chứa email, mật khẩu hay thông tin riêng tư của bạn.
            </span>
          </div>

          <div className="mt-5 w-full grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleCopyAccount}
              className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold text-[#0B172A] dark:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Đã sao chép' : 'Sao chép STK'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadQrCard}
              className="h-11 px-4 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>Tải ảnh QR</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
