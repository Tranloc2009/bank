import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Upload, AlertCircle, QrCode, RefreshCw } from 'lucide-react';
import { parsePlaybankQrPayload } from '../lib/banking';

interface QrScannerViewProps {
  onDecodedAccount: (accountNumber: string) => void;
}

export function QrScannerView({ onDecodedAccount }: QrScannerViewProps) {
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'active' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualPayload, setManualPayload] = useState('');
  const [decodingUpload, setDecodingUpload] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleDecodedString = (raw: string) => {
    const parsed = parsePlaybankQrPayload(raw);
    if (!parsed.valid) {
      setErrorMessage(parsed.error);
      return false;
    }
    stopCamera();
    setErrorMessage(null);
    onDecodedAccount(parsed.accountNumber);
    return true;
  };

  const startCamera = async () => {
    stopCamera();
    setErrorMessage(null);
    setCameraState('starting');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('error');
      setErrorMessage(
        'Trình duyệt hoặc thiết bị hiện tại không hỗ trợ camera. Bạn có thể tải ảnh mã QR từ thư viện.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      setCameraState('active');

      // Scan frames periodically (~6 fps) so UI remains silky smooth
      timerRef.current = window.setInterval(() => {
        const v = videoRef.current;
        const c = canvasRef.current;
        if (!v || !c || v.readyState < 2 || v.videoWidth === 0) return;

        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(v, 0, 0, c.width, c.height);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code && code.data) {
          handleDecodedString(code.data);
        }
      }, 170);
    } catch {
      setCameraState('error');
      setErrorMessage(
        'Không thể truy cập camera (chưa cấp quyền hoặc thiết bị không có camera). Hãy dùng mục Tải ảnh QR từ thư viện.'
      );
    }
  };

  useEffect(() => {
    if (mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
      setCameraState('idle');
    }
    return () => {
      stopCamera();
    };
  }, [mode]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setDecodingUpload(true);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Không thể đọc tệp hình ảnh.'));
        reader.readAsDataURL(file);
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Định dạng ảnh không hợp lệ.'));
        image.src = dataUrl;
      });

      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('Không thể xử lý ảnh trên trình duyệt này.');
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (!code || !code.data) {
        setErrorMessage('Không tìm thấy mã QR hợp lệ trong ảnh đã chọn. Hãy chọn ảnh rõ nét hơn.');
      } else {
        handleDecodedString(code.data);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi phân tích ảnh QR.');
    } finally {
      setDecodingUpload(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleDecodedString(manualPayload);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-[#0B172A] dark:text-white">
          Quét mã QR chuyển PLAYCOIN
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Chỉ hỗ trợ mã QR nội bộ của PLAYBANK. Hệ thống tự động từ chối mã QR ngân hàng thật.
        </p>
      </div>

      {/* Mode Switcher */}
      <div
        role="tablist"
        aria-label="Chọn phương thức quét mã QR"
        className="grid grid-cols-2 p-1 rounded-2xl bg-slate-200/70 dark:bg-[#0F1A2E] border border-slate-200/80 dark:border-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'camera'}
          onClick={() => {
            setMode('camera');
            setErrorMessage(null);
          }}
          className={`h-11 px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
            mode === 'camera'
              ? 'bg-white dark:bg-[#1B2B4A] text-[#0B172A] dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-[#0B172A] dark:hover:text-white'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Quét bằng Camera</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'upload'}
          onClick={() => {
            setMode('upload');
            setErrorMessage(null);
          }}
          className={`h-11 px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
            mode === 'upload'
              ? 'bg-white dark:bg-[#1B2B4A] text-[#0B172A] dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-[#0B172A] dark:hover:text-white'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Tải ảnh QR</span>
        </button>
      </div>

      <div className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-5">
        {mode === 'camera' ? (
          <div className="space-y-4">
            <div className="relative aspect-square max-w-sm mx-auto rounded-2xl overflow-hidden bg-[#070E1A] border border-slate-800 flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraState === 'active' ? 'opacity-100' : 'opacity-0'}`}
              />
              <canvas ref={canvasRef} className="hidden" />

              {cameraState === 'active' && (
                <div aria-hidden="true" className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-56 h-56 relative">
                    <span className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400 rounded-tl-xl" />
                    <span className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400 rounded-tr-xl" />
                    <span className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400 rounded-bl-xl" />
                    <span className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400 rounded-br-xl" />
                  </div>
                </div>
              )}

              {cameraState !== 'active' && (
                <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center text-slate-300">
                  <Camera className="w-10 h-10 text-blue-400 mb-3" />
                  <p className="text-sm font-medium">
                    {cameraState === 'starting'
                      ? 'Đang mở camera...'
                      : 'Camera chưa khả dụng trên thiết bị này'}
                  </p>
                  {cameraState === 'error' && (
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={startCamera}
                        className="h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Thử lại camera</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('upload')}
                        className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Tải ảnh QR từ thư viện</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              Đưa mã QR PLAYBANK của người nhận vào chính giữa khung hình.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <label
              htmlFor="qr-image-upload"
              className="block rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-slate-50/70 dark:bg-[#091222] p-8 text-center cursor-pointer transition-colors"
            >
              <Upload className="w-9 h-9 text-blue-600 dark:text-blue-400 mx-auto" />
              <div className="mt-3 text-sm font-semibold text-[#0B172A] dark:text-white">
                {decodingUpload ? 'Đang giải mã hình ảnh...' : 'Chọn ảnh chứa mã QR PLAYBANK từ thư viện'}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Hỗ trợ ảnh PNG, JPG, WEBP đã lưu từ mục Nhận tiền
              </p>
              <input
                ref={fileInputRef}
                id="qr-image-upload"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/70 text-sm text-red-700 dark:text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Direct internal PLAYBANK QR string paste fallback */}
        <form
          onSubmit={handleManualSubmit}
          className="pt-5 border-t border-slate-100 dark:border-slate-800 space-y-2.5"
        >
          <label
            htmlFor="manual-qr-payload"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            <QrCode className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Hoặc dán chuỗi mã QR PLAYBANK trực tiếp</span>
          </label>
          <div className="flex gap-2">
            <input
              id="manual-qr-payload"
              type="text"
              value={manualPayload}
              onChange={(e) => setManualPayload(e.target.value)}
              placeholder="PLAYBANK:V1|ACC:8801000002"
              className="flex-1 h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700 font-mono text-xs text-[#0B172A] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
            <button
              type="submit"
              className="h-11 px-4 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] text-white text-xs font-semibold transition-all cursor-pointer whitespace-nowrap"
            >
              Xác thực mã
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
