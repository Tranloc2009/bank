import type {
  AccountLookupResult,
  AchievementRecord,
  DashboardSummary,
  LeaderboardEntry,
  TransactionRecord,
  TransferMethod,
  UserProfile,
} from '../src/lib/banking.ts';

export type MaybePromise<T> = T | Promise<T>;

export interface TransferExecutionResult {
  transaction: TransactionRecord;
  senderBalance: number;
  recipientId: string;
  recipientBalance: number;
  newSenderAchievements: AchievementRecord[];
  deduplicated: boolean;
}

export interface TransactionQueryFilters {
  q?: string;
  direction?: 'all' | 'sent' | 'received';
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface IBankEngine {
  readonly storageType: 'sqlite' | 'postgresql';
  init?(): Promise<void>;
  close(): MaybePromise<void>;
  register(input: {
    email: string;
    password: string;
    displayName: string;
  }): MaybePromise<{ token: string; user: UserProfile }>;
  login(input: {
    email: string;
    password: string;
  }): MaybePromise<{ token: string; user: UserProfile }>;
  logout(rawToken: string): MaybePromise<void>;
  authenticate(rawToken: string | undefined): MaybePromise<UserProfile>;
  getDashboardSummary(userId: string): MaybePromise<DashboardSummary>;
  updateProfile(
    userId: string,
    updates: {
      displayName?: string;
      avatarUrl?: string;
      isAnonymous?: boolean;
      soundEnabled?: boolean;
    }
  ): MaybePromise<UserProfile>;
  lookupAccount(requesterId: string, rawAccountNumber: string): MaybePromise<AccountLookupResult>;
  executeTransfer(input: {
    senderId: string;
    recipientAccount: string;
    amount: number;
    note: string;
    method: TransferMethod;
    idempotencyKey: string;
  }): MaybePromise<TransferExecutionResult>;
  getTransactions(
    userId: string,
    filters?: TransactionQueryFilters
  ): MaybePromise<TransactionRecord[]>;
  getLeaderboard(currentUserId: string, limit?: number): MaybePromise<LeaderboardEntry[]>;
}
