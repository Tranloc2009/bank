import type {
  AccountLookupResult,
  AchievementRecord,
  DashboardSummary,
  LeaderboardEntry,
  TransactionRecord,
  TransferMethod,
  UserProfile,
} from './banking';

const TOKEN_KEY = 'playbank_session_token_v1';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : 'Không thể kết nối tới máy chủ PLAYBANK.',
      response.status,
      typeof data.code === 'string' ? data.code : 'REQUEST_FAILED'
    );
  }

  return data as T;
}

export const playbankApi = {
  async register(input: { email: string; password: string; displayName: string }) {
    const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setStoredToken(res.token);
    return res;
  },

  async login(input: { email: string; password: string }) {
    const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setStoredToken(res.token);
    return res;
  },

  async logout() {
    try {
      await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
    }
  },

  async getMe() {
    return apiRequest<DashboardSummary>('/api/me');
  },

  async updateProfile(updates: {
    displayName?: string;
    avatarUrl?: string;
    isAnonymous?: boolean;
    soundEnabled?: boolean;
  }) {
    return apiRequest<{ user: UserProfile }>('/api/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async lookupAccount(accountNumber: string) {
    const params = new URLSearchParams({ accountNumber });
    return apiRequest<AccountLookupResult>(`/api/accounts/lookup?${params.toString()}`);
  },

  async transfer(input: {
    recipientAccount: string;
    amount: number;
    note: string;
    method: TransferMethod;
    idempotencyKey: string;
  }) {
    return apiRequest<{
      transaction: TransactionRecord;
      balance: number;
      newAchievements: AchievementRecord[];
      deduplicated: boolean;
    }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getTransactions(filters?: {
    q?: string;
    direction?: 'all' | 'sent' | 'received';
    fromDate?: string;
    toDate?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.q) params.set('q', filters.q);
    if (filters?.direction && filters.direction !== 'all') params.set('direction', filters.direction);
    if (filters?.fromDate) params.set('fromDate', filters.fromDate);
    if (filters?.toDate) params.set('toDate', filters.toDate);
    const qs = params.toString();
    return apiRequest<{ transactions: TransactionRecord[] }>(
      `/api/transactions${qs ? `?${qs}` : ''}`
    );
  },

  async getLeaderboard() {
    return apiRequest<{ entries: LeaderboardEntry[] }>('/api/leaderboard');
  },

  subscribeEvents(
    onIncomingTransfer: (payload: { transaction: TransactionRecord; newBalance: number }) => void
  ): () => void {
    const token = getStoredToken();
    if (!token || typeof EventSource === 'undefined') {
      return () => {};
    }

    const url = `/api/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('incoming_transfer', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data);
        onIncomingTransfer(parsed);
      } catch {
        // Ignore malformed payloads
      }
    });

    return () => {
      es.close();
    };
  },
};
