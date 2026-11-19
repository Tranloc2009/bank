import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  INITIAL_PLAYCOIN_GRANT,
  PRESET_AVATARS,
  normalizeAccountNumber,
  validateTransferAmount,
  type AccountLookupResult,
  type AchievementRecord,
  type DashboardSummary,
  type LeaderboardEntry,
  type TransactionRecord,
  type TransferMethod,
  type UserProfile,
} from '../src/lib/banking.ts';
import type {
  IBankEngine,
  TransactionQueryFilters,
  TransferExecutionResult,
} from './bankTypes.ts';
import {
  BankError,
  generateCandidateAccountNumber,
  generateSessionToken,
  generateTxCode,
  hashPassword,
  hashToken,
  resolvePgSslConfig,
  verifyPassword,
} from './security.ts';

interface PgUserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  account_number: string;
  avatar_url: string;
  balance: string | number;
  initial_bonus_granted: boolean;
  is_anonymous: boolean;
  sound_enabled: boolean;
  created_at: string;
}

interface PgTxRow {
  id: string;
  tx_code: string;
  idempotency_key: string;
  sender_id: string;
  sender_account: string;
  sender_name: string;
  recipient_id: string;
  recipient_account: string;
  recipient_name: string;
  amount: string | number;
  note: string;
  method: TransferMethod;
  status: 'COMPLETED';
  created_at: string;
}

interface PgAchievementRow {
  id: string;
  user_id: string;
  code: string;
  title: string;
  description: string;
  unlocked_at: string;
}

function mapUserRow(row: PgUserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    accountNumber: row.account_number,
    avatarUrl: row.avatar_url,
    balance: Number(row.balance),
    isAnonymous: Boolean(row.is_anonymous),
    soundEnabled: Boolean(row.sound_enabled),
    createdAt: row.created_at,
  };
}

function mapTxRow(row: PgTxRow): TransactionRecord {
  return {
    id: row.id,
    txCode: row.tx_code,
    idempotencyKey: row.idempotency_key,
    senderId: row.sender_id,
    senderAccount: row.sender_account,
    senderName: row.sender_name,
    recipientId: row.recipient_id,
    recipientAccount: row.recipient_account,
    recipientName: row.recipient_name,
    amount: Number(row.amount),
    note: row.note,
    method: row.method,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapAchievementRow(row: PgAchievementRow): AchievementRecord {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    unlockedAt: row.unlocked_at,
  };
}

/**
 * PostgreSQL-backed atomic BankEngine compatible with 100% free, no-credit-card
 * Postgres providers (Neon Free, Supabase Free, Render, Aiven, or local Postgres).
 */
export class PgBankEngine implements IBankEngine {
  readonly storageType = 'postgresql' as const;
  private pool: Pool;
  private seedDemoUsers: boolean;

  constructor(databaseUrl: string, options?: { seedDemoUsers?: boolean }) {
    this.seedDemoUsers = options?.seedDemoUsers !== false;
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: resolvePgSslConfig(databaseUrl),
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        account_number TEXT NOT NULL UNIQUE,
        avatar_url TEXT NOT NULL,
        balance BIGINT NOT NULL CHECK(balance >= 0),
        initial_bonus_granted BOOLEAN NOT NULL DEFAULT TRUE,
        is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
        sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        tx_code TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        sender_id TEXT NOT NULL REFERENCES users(id),
        sender_account TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        recipient_id TEXT NOT NULL REFERENCES users(id),
        recipient_account TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        amount BIGINT NOT NULL CHECK(amount > 0),
        note TEXT NOT NULL,
        method TEXT NOT NULL CHECK(method IN ('account', 'qr')),
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        UNIQUE(user_id, code)
      );

      CREATE INDEX IF NOT EXISTS idx_tx_sender ON transactions(sender_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_recipient ON transactions(recipient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance DESC);
    `);

    if (this.seedDemoUsers) {
      await this.seedDemoUsersIfEmpty();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async seedDemoUsersIfEmpty(): Promise<void> {
    const { rows } = await this.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
    if (Number(rows[0]?.count ?? 0) > 0) return;

    const now = new Date().toISOString();
    const pwHash = hashPassword('Playbank123');
    const demoUsers = [
      {
        email: 'minhquan@playbank.demo',
        displayName: 'Nguyễn Minh Quân',
        accountNumber: '8801000001',
        avatarUrl: PRESET_AVATARS[0].url,
      },
      {
        email: 'khanhlinh@playbank.demo',
        displayName: 'Trần Khánh Linh',
        accountNumber: '8801000002',
        avatarUrl: PRESET_AVATARS[1].url,
      },
      {
        email: 'giabao@playbank.demo',
        displayName: 'Lê Gia Bảo',
        accountNumber: '8801000003',
        avatarUrl: PRESET_AVATARS[2].url,
      },
    ];

    for (const u of demoUsers) {
      await this.pool.query(
        `INSERT INTO users (
          id, email, password_hash, display_name, account_number,
          avatar_url, balance, initial_bonus_granted, is_anonymous, sound_enabled, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE, TRUE, $8)
        ON CONFLICT (email) DO NOTHING`,
        [
          crypto.randomUUID(),
          u.email,
          pwHash,
          u.displayName,
          u.accountNumber,
          u.avatarUrl,
          INITIAL_PLAYCOIN_GRANT,
          now,
        ]
      );
    }
  }

  private async generateUniqueAccountNumber(client: PoolClient): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = generateCandidateAccountNumber();
      const { rowCount } = await client.query('SELECT 1 FROM users WHERE account_number = $1', [
        candidate,
      ]);
      if (!rowCount) return candidate;
    }
    throw new BankError('Không thể khởi tạo số tài khoản mới. Vui lòng thử lại.', 500, 'ACCOUNT_GEN_FAILED');
  }

  private async createSession(client: PoolClient | Pool, userId: string): Promise<string> {
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    await client.query(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenHash, userId, now.toISOString(), expires.toISOString()]
    );
    return rawToken;
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ token: string; user: UserProfile }> {
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';
    const displayName = (input.displayName ?? '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BankError('Địa chỉ email không hợp lệ.', 400, 'INVALID_EMAIL');
    }
    if (password.length < 6) {
      throw new BankError('Mật khẩu phải có ít nhất 6 ký tự.', 400, 'WEAK_PASSWORD');
    }
    if (displayName.length < 2 || displayName.length > 50) {
      throw new BankError('Tên hiển thị phải từ 2 đến 50 ký tự.', 400, 'INVALID_DISPLAY_NAME');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount) {
        throw new BankError('Email này đã được đăng ký tài khoản PLAYBANK.', 409, 'EMAIL_EXISTS');
      }

      const id = crypto.randomUUID();
      const accountNumber = await this.generateUniqueAccountNumber(client);
      const passwordHash = hashPassword(password);
      const avatarUrl = PRESET_AVATARS[crypto.randomInt(0, PRESET_AVATARS.length)].url;
      const now = new Date().toISOString();

      const inserted = await client.query<PgUserRow>(
        `INSERT INTO users (
          id, email, password_hash, display_name, account_number,
          avatar_url, balance, initial_bonus_granted, is_anonymous, sound_enabled, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE, TRUE, $8)
        RETURNING *`,
        [id, email, passwordHash, displayName, accountNumber, avatarUrl, INITIAL_PLAYCOIN_GRANT, now]
      );

      const token = await this.createSession(client, id);
      await client.query('COMMIT');
      return { token, user: mapUserRow(inserted.rows[0]) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async login(input: { email: string; password: string }): Promise<{ token: string; user: UserProfile }> {
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';

    if (!email || !password) {
      throw new BankError('Vui lòng nhập đầy đủ email và mật khẩu.', 400, 'MISSING_CREDENTIALS');
    }

    const { rows } = await this.pool.query<PgUserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const userRow = rows[0];
    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      throw new BankError('Email hoặc mật khẩu không chính xác.', 401, 'INVALID_CREDENTIALS');
    }

    const token = await this.createSession(this.pool, userRow.id);
    return { token, user: mapUserRow(userRow) };
  }

  async logout(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(rawToken)]);
  }

  async authenticate(rawToken: string | undefined): Promise<UserProfile> {
    if (!rawToken) {
      throw new BankError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401, 'UNAUTHORIZED');
    }
    const tokenHash = hashToken(rawToken);
    const { rows } = await this.pool.query<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = $1',
      [tokenHash]
    );
    const session = rows[0];
    if (!session) {
      throw new BankError('Phiên đăng nhập không tồn tại.', 401, 'UNAUTHORIZED');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      throw new BankError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'SESSION_EXPIRED');
    }

    const userRes = await this.pool.query<PgUserRow>('SELECT * FROM users WHERE id = $1', [session.user_id]);
    if (!userRes.rows[0]) {
      throw new BankError('Tài khoản không tồn tại.', 401, 'UNAUTHORIZED');
    }
    return mapUserRow(userRes.rows[0]);
  }

  async getDashboardSummary(userId: string): Promise<DashboardSummary> {
    const userRes = await this.pool.query<PgUserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0]) {
      throw new BankError('Không tìm thấy tài khoản.', 404, 'USER_NOT_FOUND');
    }

    const [sentRes, receivedRes, recentRes, achRes] = await Promise.all([
      this.pool.query<{ total: string; cnt: string }>(
        'SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS cnt FROM transactions WHERE sender_id = $1',
        [userId]
      ),
      this.pool.query<{ total: string; cnt: string }>(
        'SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS cnt FROM transactions WHERE recipient_id = $1',
        [userId]
      ),
      this.pool.query<PgTxRow>(
        `SELECT * FROM transactions
         WHERE sender_id = $1 OR recipient_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId]
      ),
      this.pool.query<PgAchievementRow>(
        'SELECT * FROM achievements WHERE user_id = $1 ORDER BY unlocked_at DESC',
        [userId]
      ),
    ]);

    return {
      user: mapUserRow(userRes.rows[0]),
      stats: {
        totalSent: Number(sentRes.rows[0]?.total ?? 0),
        totalReceived: Number(receivedRes.rows[0]?.total ?? 0),
        txCount: Number(sentRes.rows[0]?.cnt ?? 0) + Number(receivedRes.rows[0]?.cnt ?? 0),
      },
      recentTransactions: recentRes.rows.map(mapTxRow),
      achievements: achRes.rows.map(mapAchievementRow),
    };
  }

  async updateProfile(
    userId: string,
    updates: {
      displayName?: string;
      avatarUrl?: string;
      isAnonymous?: boolean;
      soundEnabled?: boolean;
    }
  ): Promise<UserProfile> {
    const existingRes = await this.pool.query<PgUserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new BankError('Không tìm thấy tài khoản.', 404, 'USER_NOT_FOUND');
    }

    let nextDisplayName = existing.display_name;
    if (updates.displayName !== undefined) {
      const trimmed = updates.displayName.trim();
      if (trimmed.length < 2 || trimmed.length > 50) {
        throw new BankError('Tên hiển thị phải từ 2 đến 50 ký tự.', 400, 'INVALID_DISPLAY_NAME');
      }
      nextDisplayName = trimmed;
    }

    let nextAvatarUrl = existing.avatar_url;
    if (updates.avatarUrl !== undefined) {
      const candidate = updates.avatarUrl.trim();
      const isAllowedPreset = PRESET_AVATARS.some((a) => a.url === candidate);
      const isSafeDataImage =
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length <= 280_000;
      if (!isAllowedPreset && !isSafeDataImage) {
        throw new BankError('Ảnh đại diện không hợp lệ hoặc vượt quá dung lượng cho phép.', 400, 'INVALID_AVATAR');
      }
      nextAvatarUrl = candidate;
    }

    const nextAnonymous = updates.isAnonymous !== undefined ? Boolean(updates.isAnonymous) : existing.is_anonymous;
    const nextSound = updates.soundEnabled !== undefined ? Boolean(updates.soundEnabled) : existing.sound_enabled;

    const updated = await this.pool.query<PgUserRow>(
      `UPDATE users
       SET display_name = $1, avatar_url = $2, is_anonymous = $3, sound_enabled = $4
       WHERE id = $5
       RETURNING *`,
      [nextDisplayName, nextAvatarUrl, nextAnonymous, nextSound, userId]
    );
    return mapUserRow(updated.rows[0]);
  }

  async lookupAccount(requesterId: string, rawAccountNumber: string): Promise<AccountLookupResult> {
    const accountNumber = normalizeAccountNumber(rawAccountNumber);
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BankError('Số tài khoản PLAYBANK phải gồm đúng 10 chữ số.', 400, 'INVALID_ACCOUNT_NUMBER');
    }

    const { rows } = await this.pool.query<{
      id: string;
      account_number: string;
      display_name: string;
      avatar_url: string;
    }>('SELECT id, account_number, display_name, avatar_url FROM users WHERE account_number = $1', [
      accountNumber,
    ]);

    const row = rows[0];
    if (!row) {
      throw new BankError('Không tìm thấy tài khoản PLAYBANK với số tài khoản này.', 404, 'ACCOUNT_NOT_FOUND');
    }

    return {
      accountNumber: row.account_number,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      isSelf: row.id === requesterId,
    };
  }

  private async awardAchievement(
    client: PoolClient,
    userId: string,
    code: string,
    title: string,
    description: string,
    now: string
  ): Promise<AchievementRecord | null> {
    const id = crypto.randomUUID();
    const res = await client.query<PgAchievementRow>(
      `INSERT INTO achievements (id, user_id, code, title, description, unlocked_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, code) DO NOTHING
       RETURNING *`,
      [id, userId, code, title, description, now]
    );
    return res.rows[0] ? mapAchievementRow(res.rows[0]) : null;
  }

  async executeTransfer(input: {
    senderId: string;
    recipientAccount: string;
    amount: number;
    note: string;
    method: TransferMethod;
    idempotencyKey: string;
  }): Promise<TransferExecutionResult> {
    const recipientAccount = normalizeAccountNumber(input.recipientAccount ?? '');
    const idempotencyKey = (input.idempotencyKey ?? '').trim();
    const method: TransferMethod = input.method === 'qr' ? 'qr' : 'account';
    const note = (input.note ?? '').trim().slice(0, 140) || 'Chuyển tiền PLAYCOIN';

    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw new BankError('Thiếu mã chống trùng lặp giao dịch hợp lệ.', 400, 'INVALID_IDEMPOTENCY_KEY');
    }
    if (!/^\d{10}$/.test(recipientAccount)) {
      throw new BankError('Số tài khoản người nhận phải gồm đúng 10 chữ số.', 400, 'INVALID_ACCOUNT_NUMBER');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Idempotency check inside transaction
      const existingTxRes = await client.query<PgTxRow>(
        'SELECT * FROM transactions WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (existingTxRes.rows[0]) {
        const existingTx = existingTxRes.rows[0];
        if (existingTx.sender_id !== input.senderId) {
          throw new BankError('Mã giao dịch không hợp lệ.', 409, 'IDEMPOTENCY_CONFLICT');
        }
        const [senderNow, recipientNow] = await Promise.all([
          client.query<{ balance: string }>('SELECT balance::text FROM users WHERE id = $1', [input.senderId]),
          client.query<{ balance: string }>('SELECT balance::text FROM users WHERE id = $1', [existingTx.recipient_id]),
        ]);
        await client.query('COMMIT');
        return {
          transaction: mapTxRow(existingTx),
          senderBalance: Number(senderNow.rows[0]?.balance ?? 0),
          recipientId: existingTx.recipient_id,
          recipientBalance: Number(recipientNow.rows[0]?.balance ?? 0),
          newSenderAchievements: [],
          deduplicated: true,
        };
      }

      // 2. Resolve recipient ID first, then lock both accounts in deterministic ID order to avoid deadlocks
      const recipientLookup = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE account_number = $1',
        [recipientAccount]
      );
      const recipientId = recipientLookup.rows[0]?.id;
      if (!recipientId) {
        throw new BankError('Không tìm thấy tài khoản người nhận.', 404, 'RECIPIENT_NOT_FOUND');
      }
      if (recipientId === input.senderId) {
        throw new BankError('Không thể tự chuyển PLAYCOIN cho chính mình.', 400, 'SELF_TRANSFER_FORBIDDEN');
      }

      const orderedIds = [input.senderId, recipientId].sort();
      const lockedUsers = await client.query<PgUserRow>(
        'SELECT * FROM users WHERE id = ANY($1::text[]) ORDER BY id ASC FOR UPDATE',
        [orderedIds]
      );

      const sender = lockedUsers.rows.find((u) => u.id === input.senderId);
      const recipient = lockedUsers.rows.find((u) => u.id === recipientId);
      if (!sender) {
        throw new BankError('Tài khoản người gửi không tồn tại.', 404, 'SENDER_NOT_FOUND');
      }
      if (!recipient) {
        throw new BankError('Không tìm thấy tài khoản người nhận.', 404, 'RECIPIENT_NOT_FOUND');
      }

      const senderBalance = Number(sender.balance);
      const recipientBalance = Number(recipient.balance);

      const amountErr = validateTransferAmount(input.amount, senderBalance);
      if (amountErr) {
        throw new BankError(amountErr, 400, 'INVALID_AMOUNT');
      }

      // 3. Atomic debit & credit
      const debit = await client.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
        [input.amount, sender.id]
      );
      if (debit.rowCount !== 1) {
        throw new BankError('Số dư PLAYCOIN không đủ để thực hiện giao dịch.', 400, 'INSUFFICIENT_FUNDS');
      }
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [
        input.amount,
        recipient.id,
      ]);

      // 4. Insert immutable transaction row
      const txId = crypto.randomUUID();
      const txCode = generateTxCode();
      const now = new Date().toISOString();

      const insertedTx = await client.query<PgTxRow>(
        `INSERT INTO transactions (
          id, tx_code, idempotency_key, sender_id, sender_account, sender_name,
          recipient_id, recipient_account, recipient_name, amount, note, method, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'COMPLETED', $13)
        RETURNING *`,
        [
          txId,
          txCode,
          idempotencyKey,
          sender.id,
          sender.account_number,
          sender.display_name,
          recipient.id,
          recipient.account_number,
          recipient.display_name,
          input.amount,
          note,
          method,
          now,
        ]
      );

      // 5. Achievements
      const newSenderAchievements: AchievementRecord[] = [];
      const firstTransfer = await this.awardAchievement(
        client,
        sender.id,
        'FIRST_TRANSFER',
        'Giao dịch đầu tiên',
        'Hoàn thành lệnh chuyển PLAYCOIN đầu tiên trên PLAYBANK.',
        now
      );
      if (firstTransfer) newSenderAchievements.push(firstTransfer);

      if (input.amount >= 500_000) {
        const highRoller = await this.awardAchievement(
          client,
          sender.id,
          'HIGH_ROLLER',
          'Tay chơi hào phóng',
          'Thực hiện một giao dịch từ 500.000 PLAYCOIN trở lên.',
          now
        );
        if (highRoller) newSenderAchievements.push(highRoller);
      }

      if (method === 'qr') {
        const qrPro = await this.awardAchievement(
          client,
          sender.id,
          'QR_PAY_PRO',
          'Chuyên gia Quét QR',
          'Chuyển tiền thành công bằng mã QR nội bộ PLAYBANK.',
          now
        );
        if (qrPro) newSenderAchievements.push(qrPro);
      }

      await this.awardAchievement(
        client,
        recipient.id,
        'FIRST_RECEIVE',
        'Lần đầu nhận tiền',
        'Nhận được khoản PLAYCOIN đầu tiên từ người chơi khác.',
        now
      );

      const nextSenderBalance = senderBalance - input.amount;
      const nextRecipientBalance = recipientBalance + input.amount;

      if (nextRecipientBalance >= 1_500_000) {
        await this.awardAchievement(
          client,
          recipient.id,
          'WEALTH_BUILDER',
          'Tài phiệt PLAYBANK',
          'Đạt mốc số dư từ 1.500.000 PLAYCOIN trở lên.',
          now
        );
      }

      await client.query('COMMIT');
      return {
        transaction: mapTxRow(insertedTx.rows[0]),
        senderBalance: nextSenderBalance,
        recipientId: recipient.id,
        recipientBalance: nextRecipientBalance,
        newSenderAchievements,
        deduplicated: false,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getTransactions(
    userId: string,
    filters?: TransactionQueryFilters
  ): Promise<TransactionRecord[]> {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    const addParam = (val: string | number): string => {
      params.push(val);
      return `$${params.length}`;
    };

    const direction = filters?.direction ?? 'all';
    if (direction === 'sent') {
      clauses.push(`sender_id = ${addParam(userId)}`);
    } else if (direction === 'received') {
      clauses.push(`recipient_id = ${addParam(userId)}`);
    } else {
      const p = addParam(userId);
      clauses.push(`(sender_id = ${p} OR recipient_id = ${p})`);
    }

    const q = (filters?.q ?? '').trim();
    if (q) {
      const p = addParam(`%${q}%`);
      clauses.push(
        `(tx_code ILIKE ${p} OR sender_name ILIKE ${p} OR recipient_name ILIKE ${p} OR sender_account ILIKE ${p} OR recipient_account ILIKE ${p} OR note ILIKE ${p})`
      );
    }

    if (filters?.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate)) {
      clauses.push(`created_at >= ${addParam(`${filters.fromDate}T00:00:00.000Z`)}`);
    }

    if (filters?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.toDate)) {
      clauses.push(`created_at <= ${addParam(`${filters.toDate}T23:59:59.999Z`)}`);
    }

    const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 200);
    const limitParam = addParam(limit);

    const { rows } = await this.pool.query<PgTxRow>(
      `SELECT * FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ${limitParam}`,
      params
    );
    return rows.map(mapTxRow);
  }

  async getLeaderboard(currentUserId: string, limit = 20): Promise<LeaderboardEntry[]> {
    const { rows } = await this.pool.query<{
      id: string;
      display_name: string;
      account_number: string;
      avatar_url: string;
      balance: string;
      is_anonymous: boolean;
    }>(
      `SELECT id, display_name, account_number, avatar_url, balance::text, is_anonymous
       FROM users
       ORDER BY balance DESC, created_at ASC
       LIMIT $1`,
      [limit]
    );

    return rows.map((row, index) => {
      const isCurrentUser = row.id === currentUserId;
      const isAnonymous = Boolean(row.is_anonymous);
      const tail = row.account_number.slice(-4);
      return {
        rank: index + 1,
        displayName: isAnonymous ? `Người chơi ẩn danh #${tail}` : row.display_name,
        accountMask: isAnonymous ? `•••• •••• ${tail}` : `${row.account_number.slice(0, 4)} •••• ${tail}`,
        avatarUrl: row.avatar_url,
        balance: Number(row.balance),
        isAnonymous,
        isCurrentUser,
      };
    });
  }
}
