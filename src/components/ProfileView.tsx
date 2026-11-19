import React, { useState } from 'react';
import {
  Save,
  LogOut,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  EyeOff,
  Upload,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { playbankApi, ApiError } from '../lib/api';
import {
  PRESET_AVATARS,
  formatAccountNumber,
  formatDateTimeVN,
  type UserProfile,
} from '../lib/banking';

interface ProfileViewProps {
  user: UserProfile;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onProfileUpdated: (user: UserProfile) => void;
  onLogout: () => void;
}

export function ProfileView({
  user,
  darkMode,
  onToggleDarkMode,
  onProfileUpdated,
  onLogout,
}: ProfileViewProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [isAnonymous, setIsAnonymous] = useState(user.isAnonymous);
  const [soundEnabled, setSoundEnabled] = useState(user.soundEnabled);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedBanner(false);

    if (displayName.trim().length < 2) {
      setError('Tên hiển thị phải có ít nhất 2 ký tự.');
      return;
    }

    setSaving(true);
    try {
      const res = await playbankApi.updateProfile({
        displayName: displayName.trim(),
        avatarUrl,
        isAnonymous,
        soundEnabled,
      });
      onProfileUpdated(res.user);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể lưu hồ sơ lúc này.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Không thể đọc ảnh đại diện.'));
        reader.readAsDataURL(file);
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Tệp ảnh không hợp lệ.'));
        image.src = dataUrl;
      });

      // Resize & center-crop to 192x192 JPEG for lightweight, clean storage
      const size = 192;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

      const compressed = canvas.toDataURL('image/jpeg', 0.82);
      setAvatarUrl(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xử lý ảnh đại diện.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-[#0B172A] dark:text-white">
          Hồ sơ & Cài đặt tài khoản
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Quản lý tên hiển thị, ảnh đại diện, quyền riêng tư và tùy chọn ứng dụng.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-3xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6"
      >
        {/* Account identity header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <img
            src={avatarUrl}
            alt={displayName}
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-[#0B172A] dark:text-white truncate">
              {user.displayName}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className="font-mono tabular-nums">STK: {formatAccountNumber(user.accountNumber)}</span>
              <span aria-hidden="true">·</span>
              <span>{user.email}</span>
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Mở tài khoản ngày {formatDateTimeVN(user.createdAt)}
            </div>
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label
            htmlFor="profile-display-name"
            className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
          >
            Tên hiển thị
          </label>
          <input
            id="profile-display-name"
            type="text"
            maxLength={50}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-[#091222] border border-slate-200 dark:border-slate-700/80 text-sm text-[#0B172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
          />
        </div>

        {/* Avatar Picker */}
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2.5">
            Ảnh đại diện
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {PRESET_AVATARS.map((preset) => {
              const selected = avatarUrl === preset.url;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setAvatarUrl(preset.url)}
                  aria-label={`Chọn ảnh đại diện ${preset.label}`}
                  className={`p-1 rounded-2xl border-2 transition-all cursor-pointer ${
                    selected
                      ? 'border-blue-600 dark:border-blue-400 scale-105'
                      : 'border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <img
                    src={preset.url}
                    alt={preset.label}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-xl object-cover"
                  />
                </button>
              );
            })}

            <label className="h-14 px-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 text-xs font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-2 cursor-pointer transition-colors">
              <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Tải ảnh riêng</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUploadAvatar}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {/* Preferences switches */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800 pt-2">
          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <EyeOff className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-[#0B172A] dark:text-white">
                  Ẩn danh trên Bảng xếp hạng
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Hiển thị dưới dạng Người chơi ẩn danh thay vì tên thật của bạn.
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isAnonymous}
              aria-label="Bật tắt ẩn danh trên bảng xếp hạng"
              onClick={() => setIsAnonymous((v) => !v)}
              className={`w-12 h-7 rounded-full transition-colors p-1 cursor-pointer shrink-0 ${
                isAnonymous ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  isAnonymous ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
              )}
              <div>
                <div className="text-sm font-semibold text-[#0B172A] dark:text-white">
                  Âm thanh thông báo giao dịch
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Phát âm báo nhẹ khi chuyển tiền thành công hoặc nhận PLAYCOIN mới.
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Bật tắt âm thanh thông báo"
              onClick={() => setSoundEnabled((v) => !v)}
              className={`w-12 h-7 rounded-full transition-colors p-1 cursor-pointer shrink-0 ${
                soundEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  soundEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              {darkMode ? (
                <Moon className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
              ) : (
                <Sun className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
              )}
              <div>
                <div className="text-sm font-semibold text-[#0B172A] dark:text-white">
                  Giao diện tối (Dark Mode)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Chuyển đổi nhanh giữa tông sáng và tông xanh navy ban đêm.
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={darkMode}
              aria-label="Bật tắt chế độ tối"
              onClick={onToggleDarkMode}
              className={`w-12 h-7 rounded-full transition-colors p-1 cursor-pointer shrink-0 ${
                darkMode ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  darkMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
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

        {savedBanner && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/70 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Đã cập nhật thông tin tài khoản thành công.</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="h-11 px-6 rounded-xl bg-gradient-to-r from-[#0F2747] to-[#1D4ED8] hover:from-[#14325B] hover:to-[#2563EB] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="h-11 px-5 rounded-xl border border-red-200 dark:border-red-900/70 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </form>

      {/* Transparent Security & Simulation Notice */}
      <div className="rounded-2xl bg-white dark:bg-[#0F1A2E] border border-slate-200 dark:border-slate-800 p-5 flex items-start gap-3.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold text-[#0B172A] dark:text-white text-sm">
            Bảo mật & Minh bạch PLAYBANK
          </div>
          <p className="mt-1">
            Mật khẩu được băm bằng thuật toán <span className="font-mono">scrypt</span> kèm muối ngẫu nhiên phía máy chủ. Mọi lệnh chuyển PLAYCOIN được xác thực số dư và thực thi atomic trên cơ sở dữ liệu máy chủ cùng khóa chống trùng lặp giao dịch. Số dư không thể bị thay đổi từ trình duyệt và hoàn toàn không liên quan đến tiền thật.
          </p>
        </div>
      </div>
    </div>
  );
}
