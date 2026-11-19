export const INITIAL_PLAYCOIN_GRANT = 1_000_000;
export const PLAYBANK_QR_PREFIX = 'PLAYBANK:V1|ACC:';
export const SIMULATOR_BANNER = 'NGÂN HÀNG GIẢ LẬP • CHỈ SỬ DỤNG TIỀN ẢO';
export const RECEIPT_WATERMARK = 'PLAYBANK SIMULATOR — KHÔNG CÓ GIÁ TRỊ THANH TOÁN';

export const PRESET_AVATARS = [
  {
    id: 'navy-prism',
    label: 'Lăng kính Navy',
    url: '/src/assets/images/avatar_navy_prism_1795094612349.jpg',
  },
  {
    id: 'azure-orbit',
    label: 'Quỹ đạo Xanh dương',
    url: '/src/assets/images/avatar_azure_orbit_1795094611570.jpg',
  },
  {
    id: 'cobalt-shield',
    label: 'Khiên Cobalt',
    url: '/src/assets/images/avatar_cobalt_shield_1795094613289.jpg',
  },
] as const;

export const CARD_SURFACE_IMAGE = '/src/assets/images/playbank_card_surface_1795094612345.jpg';

export type TransferMethod = 'account' | 'qr';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  accountNumber: string;
  avatarUrl: string;
  balance: number;
  isAnonymous: boolean;
  soundEnabled: boolean;
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  txCode: string;
  idempotencyKey: string;
  senderId: string;
  senderAccount: string;
  senderName: string;
  recipientId: string;
  recipientAccount: string;
  recipientName: string;
  amount: number;
  note: string;
  method: TransferMethod;
  status: 'COMPLETED';
  createdAt: string;
}

export interface AchievementRecord {
  id: string;
  code: string;
  title: string;
  description: string;
  unlockedAt: string;
}

export interface DashboardSummary {
  user: UserProfile;
  stats: {
    totalSent: number;
    totalReceived: number;
    txCount: number;
  };
  recentTransactions: TransactionRecord[];
  achievements: AchievementRecord[];
}

export interface AccountLookupResult {
  accountNumber: string;
  displayName: string;
  avatarUrl: string;
  isSelf: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  accountMask: string;
  avatarUrl: string;
  balance: number;
  isAnonymous: boolean;
  isCurrentUser: boolean;
}

/**
 * Format PLAYCOIN integer with Vietnamese dot thousand separators.
 */
export function formatPlaycoin(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  return safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Format 10-digit PLAYBANK account number as "XXXX XXXX XX".
 */
export function formatAccountNumber(accountNumber: string): string {
  const clean = normalizeAccountNumber(accountNumber);
  if (clean.length !== 10) return clean;
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 10)}`;
}

/**
 * Strip non-digit characters from an account number input.
 */
export function normalizeAccountNumber(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

/**
 * Parse numeric PLAYCOIN amount from formatted text input.
 */
export function parseAmountInput(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * Build internal PLAYBANK QR payload.
 * Strictly contains ONLY the internal protocol version and 10-digit virtual account number.
 * Never embeds real bank EMVCo/VietQR data or private user PII (email, balance, password).
 */
export function buildPlaybankQrPayload(accountNumber: string): string {
  const clean = normalizeAccountNumber(accountNumber);
  if (!/^\d{10}$/.test(clean)) {
    throw new Error('Số tài khoản PLAYBANK không hợp lệ');
  }
  return `${PLAYBANK_QR_PREFIX}${clean}`;
}

export type QrParseResult =
  | { valid: true; accountNumber: string }
  | { valid: false; error: string };

/**
 * Strictly validate and parse an internal PLAYBANK QR payload.
 * Rejects real bank VietQR/EMVCo QR codes (starting with 000201) and arbitrary text.
 */
export function parsePlaybankQrPayload(raw: string): QrParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: 'Không tìm thấy nội dung mã QR.' };
  }
  if (trimmed.startsWith('000201')) {
    return {
      valid: false,
      error: 'Đây là mã QR thanh toán ngân hàng thật. PLAYBANK chỉ chấp nhận mã QR nội bộ của trò chơi.',
    };
  }
  if (!trimmed.startsWith(PLAYBANK_QR_PREFIX)) {
    return {
      valid: false,
      error: 'Mã QR không đúng định dạng nội bộ PLAYBANK.',
    };
  }
  const accPart = trimmed.slice(PLAYBANK_QR_PREFIX.length).split('|')[0].trim();
  if (!/^\d{10}$/.test(accPart)) {
    return {
      valid: false,
      error: 'Số tài khoản trong mã QR PLAYBANK không hợp lệ.',
    };
  }
  return { valid: true, accountNumber: accPart };
}

/**
 * Client & server shared validation for transfer amounts.
 */
export function validateTransferAmount(amount: number, currentBalance: number): string | null {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return 'Số PLAYCOIN phải là số nguyên hợp lệ.';
  }
  if (amount <= 0) {
    return 'Số PLAYCOIN chuyển phải lớn hơn 0.';
  }
  if (amount > currentBalance) {
    return 'Số dư PLAYCOIN không đủ để thực hiện giao dịch này.';
  }
  return null;
}

/**
 * Format ISO timestamp into clear Vietnamese date & time string.
 */
export function formatDateTimeVN(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatShortTimeVN(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Generate a unique client-side idempotency key per transfer confirmation session.
 */
export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pb-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
