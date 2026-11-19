import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
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
import {
  generateAccountNumberWeb,
  generateSessionTokenWeb,
  generateTxCodeWeb,
  hashPasswordWeb,
  randomIndexWeb,
  sha256Hex,
  verifyPasswordWeb,
} from './crypto.ts';

export class WorkerBankError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface D1UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  account_number: string;
  avatar_url: string;
  balance: number;
  initial_bonus_granted: number;
  is_anonymous: number;
  sound_enabled: number;
  created_at: string;
}

interface D1TxRow {
  id: string;
  tx_code: string;
  idempotency_key: string;
  sender_id: string;
  sender_account: string;
  sender_name: string;
  recipient_id: string;
  recipient_account: string;
  recipient_name: string;
  amount: number;
  note: string;
  method: TransferMethod;
  status: 'COMPLETED';
  created_at: string;
}

interface D1AchievementRow {
  id: string;
  user_id: string;
  code: string;
  title: string;
  description: string;
  unlocked_at: string;
}

function mapUserRow(row: D1UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    accountNumber: row.account_number,
    avatarUrl: row.avatar_url,
    balance: Number(row.balance),
    isAnonymous: Number(row.is_anonymous) === 1,
    soundEnabled: Number(row.sound_enabled) === 1,
    createdAt: row.created_at,
  };
}

function mapTxRow(row: D1TxRow): TransactionRecord {
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

function mapAchievementRow(row: D1AchievementRow): AchievementRecord {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    unlockedAt: row.unlocked_at,
  };
}

/**
 * Cloudflare D1 Banking Engine for Cloudflare Workers Free.
 * Uses D1's atomic db.batch() transactions + SQLite CHECK(balance >= 0) & UNIQUE(idempotency_key)
 * constraints to guarantee safe, race-free atomic transfers with zero paid add-ons.
 */
export class D1BankEngine {
  private db: D1Database;
  private seeded = false;
  private seedDemoUsers: boolean;

  constructor(db: D1Database, options?: { seedDemoUsers?: boolean }) {
    this.db = db;
    this.seedDemoUsers = options?.seedDemoUsers !== false;
  }

  async ensureInitialized(): Promise<void> {
    if (this.seeded) return;

    // Ensure tables exist even if someone deployed before running d1 migrations
    await this.db.batch([
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          account_number TEXT NOT NULL UNIQUE,
          avatar_url TEXT NOT NULL,
          balance INTEGER NOT NULL CHECK(balance >= 0),
          initial_bonus_granted INTEGER NOT NULL DEFAULT 1,
          is_anonymous INTEGER NOT NULL DEFAULT 0,
          sound_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        )
      `),
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `),
      this.db.prepare(`
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
          amount INTEGER NOT NULL CHECK(amount > 0),
          note TEXT NOT NULL,
          method TEXT NOT NULL CHECK(method IN ('account', 'qr')),
          status TEXT NOT NULL DEFAULT 'COMPLETED',
          created_at TEXT NOT NULL
        )
      `),
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS achievements (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          unlocked_at TEXT NOT NULL,
          UNIQUE(user_id, code)
        )
      `),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tx_sender ON transactions(sender_id, created_at DESC)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tx_recipient ON transactions(recipient_id, created_at DESC)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance DESC)'),
    ]);

    if (this.seedDemoUsers) {
      const countRow = await this.db
        .prepare('SELECT COUNT(*) AS count FROM users')
        .first<{ count: number }>();

      if (Number(countRow?.count ?? 0) === 0) {
        const now = new Date().toISOString();
        const pwHash = await hashPasswordWeb('Playbank123');
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

        await this.db.batch(
          demoUsers.map((u) =>
            this.db
              .prepare(
                `INSERT OR IGNORE INTO users (
                  id, email, password_hash, display_name, account_number,
                  avatar_url, balance, initial_bonus_granted, is_anonymous, sound_enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?)`
              )
              .bind(
                crypto.randomUUID(),
                u.email,
                pwHash,
                u.displayName,
                u.accountNumber,
                u.avatarUrl,
                INITIAL_PLAYCOIN_GRANT,
                now
              )
          )
        );
      }
    }

    this.seeded = true;
  }

  private async generateUniqueAccountNumber(): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = generateAccountNumberWeb();
      const exists = await this.db
        .prepare('SELECT 1 AS ok FROM users WHERE account_number = ?')
        .bind(candidate)
        .first<{ ok: number }>();
      if (!exists) return candidate;
    }
    throw new WorkerBankError('Không thể khởi tạo số tài khoản mới. Vui lòng thử lại.', 500, 'ACCOUNT_GEN_FAILED');
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ token: string; user: UserProfile }> {
    await this.ensureInitialized();

    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';
    const displayName = (input.displayName ?? '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new WorkerBankError('Địa chỉ email không hợp lệ.', 400, 'INVALID_EMAIL');
    }
    if (password.length < 6) {
      throw new WorkerBankError('Mật khẩu phải có ít nhất 6 ký tự.', 400, 'WEAK_PASSWORD');
    }
    if (displayName.length < 2 || displayName.length > 50) {
      throw new WorkerBankError('Tên hiển thị phải từ 2 đến 50 ký tự.', 400, 'INVALID_DISPLAY_NAME');
    }

    const existing = await this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
    if (existing) {
      throw new WorkerBankError('Email này đã được đăng ký tài khoản PLAYBANK.', 409, 'EMAIL_EXISTS');
    }

    const id = crypto.randomUUID();
    const accountNumber = await this.generateUniqueAccountNumber();
    const passwordHash = await hashPasswordWeb(password);
    const avatarUrl = PRESET_AVATARS[randomIndexWeb(PRESET_AVATARS.length)].url;
    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const rawToken = generateSessionTokenWeb();
    const tokenHash = await sha256Hex(rawToken);

    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO users (
              id, email, password_hash, display_name, account_number,
              avatar_url, balance, initial_bonus_granted, is_anonymous, sound_enabled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?)`
          )
          .bind(
            id,
            email,
            passwordHash,
            displayName,
            accountNumber,
            avatarUrl,
            INITIAL_PLAYCOIN_GRANT,
            now.toISOString()
          ),
        this.db
          .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(tokenHash, id, now.toISOString(), expires.toISOString()),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE') && msg.includes('email')) {
        throw new WorkerBankError('Email này đã được đăng ký tài khoản PLAYBANK.', 409, 'EMAIL_EXISTS');
      }
      throw err;
    }

    const userRow = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<D1UserRow>();
    if (!userRow) {
      throw new WorkerBankError('Không thể tạo tài khoản. Vui lòng thử lại.', 500, 'REGISTER_FAILED');
    }
    return { token: rawToken, user: mapUserRow(userRow) };
  }

  async login(input: { email: string; password: string }): Promise<{ token: string; user: UserProfile }> {
    await this.ensureInitialized();

    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';

    if (!email || !password) {
      throw new WorkerBankError('Vui lòng nhập đầy đủ email và mật khẩu.', 400, 'MISSING_CREDENTIALS');
    }

    const userRow = await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<D1UserRow>();
    if (!userRow || !(await verifyPasswordWeb(password, userRow.password_hash))) {
      throw new WorkerBankError('Email hoặc mật khẩu không chính xác.', 401, 'INVALID_CREDENTIALS');
    }

    const rawToken = generateSessionTokenWeb();
    const tokenHash = await sha256Hex(rawToken);
    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    await this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, userRow.id, now.toISOString(), expires.toISOString())
      .run();

    return { token: rawToken, user: mapUserRow(userRow) };
  }

  async logout(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await this.ensureInitialized();
    const tokenHash = await sha256Hex(rawToken);
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async authenticate(rawToken: string | undefined): Promise<UserProfile> {
    if (!rawToken) {
      throw new WorkerBankError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401, 'UNAUTHORIZED');
    }
    await this.ensureInitialized();

    const tokenHash = await sha256Hex(rawToken);
    const session = await this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .first<{ user_id: string; expires_at: string }>();

    if (!session) {
      throw new WorkerBankError('Phiên đăng nhập không tồn tại.', 401, 'UNAUTHORIZED');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
      throw new WorkerBankError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'SESSION_EXPIRED');
    }

    const userRow = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(session.user_id)
      .first<D1UserRow>();
    if (!userRow) {
      throw new WorkerBankError('Tài khoản không tồn tại.', 401, 'UNAUTHORIZED');
    }
    return mapUserRow(userRow);
  }

  async getDashboardSummary(userId: string): Promise<DashboardSummary> {
    await this.ensureInitialized();

    const [userRow, sentRow, receivedRow, recentRes, achRes] = await Promise.all([
      this.db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<D1UserRow>(),
      this.db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM transactions WHERE sender_id = ?')
        .bind(userId)
        .first<{ total: number; cnt: number }>(),
      this.db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM transactions WHERE recipient_id = ?')
        .bind(userId)
        .first<{ total: number; cnt: number }>(),
      this.db
        .prepare(
          `SELECT * FROM transactions
           WHERE sender_id = ? OR recipient_id = ?
           ORDER BY created_at DESC
           LIMIT 5`
        )
        .bind(userId, userId)
        .all<D1TxRow>(),
      this.db
        .prepare('SELECT * FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC')
        .bind(userId)
        .all<D1AchievementRow>(),
    ]);

    if (!userRow) {
      throw new WorkerBankError('Không tìm thấy tài khoản.', 404, 'USER_NOT_FOUND');
    }

    return {
      user: mapUserRow(userRow),
      stats: {
        totalSent: Number(sentRow?.total ?? 0),
        totalReceived: Number(receivedRow?.total ?? 0),
        txCount: Number(sentRow?.cnt ?? 0) + Number(receivedRow?.cnt ?? 0),
      },
      recentTransactions: (recentRes.results ?? []).map(mapTxRow),
      achievements: (achRes.results ?? []).map(mapAchievementRow),
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
    await this.ensureInitialized();

    const existing = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(userId)
      .first<D1UserRow>();
    if (!existing) {
      throw new WorkerBankError('Không tìm thấy tài khoản.', 404, 'USER_NOT_FOUND');
    }

    let nextDisplayName = existing.display_name;
    if (updates.displayName !== undefined) {
      const trimmed = updates.displayName.trim();
      if (trimmed.length < 2 || trimmed.length > 50) {
        throw new WorkerBankError('Tên hiển thị phải từ 2 đến 50 ký tự.', 400, 'INVALID_DISPLAY_NAME');
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
        throw new WorkerBankError('Ảnh đại diện không hợp lệ hoặc vượt quá dung lượng cho phép.', 400, 'INVALID_AVATAR');
      }
      nextAvatarUrl = candidate;
    }

    const nextAnonymous = updates.isAnonymous !== undefined ? (updates.isAnonymous ? 1 : 0) : existing.is_anonymous;
    const nextSound = updates.soundEnabled !== undefined ? (updates.soundEnabled ? 1 : 0) : existing.sound_enabled;

    await this.db
      .prepare(
        `UPDATE users
         SET display_name = ?, avatar_url = ?, is_anonymous = ?, sound_enabled = ?
         WHERE id = ?`
      )
      .bind(nextDisplayName, nextAvatarUrl, nextAnonymous, nextSound, userId)
      .run();

    const updated = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<D1UserRow>();
    return mapUserRow(updated!);
  }

  async lookupAccount(requesterId: string, rawAccountNumber: string): Promise<AccountLookupResult> {
    await this.ensureInitialized();

    const accountNumber = normalizeAccountNumber(rawAccountNumber);
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new WorkerBankError('Số tài khoản PLAYBANK phải gồm đúng 10 chữ số.', 400, 'INVALID_ACCOUNT_NUMBER');
    }

    const row = await this.db
      .prepare('SELECT id, account_number, display_name, avatar_url FROM users WHERE account_number = ?')
      .bind(accountNumber)
      .first<{ id: string; account_number: string; display_name: string; avatar_url: string }>();

    if (!row) {
      throw new WorkerBankError('Không tìm thấy tài khoản PLAYBANK với số tài khoản này.', 404, 'ACCOUNT_NOT_FOUND');
    }

    return {
      accountNumber: row.account_number,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      isSelf: row.id === requesterId,
    };
  }

  private async returnDeduplicatedTransfer(senderId: string, idempotencyKey: string) {
    const existingTx = await this.db
      .prepare('SELECT * FROM transactions WHERE idempotency_key = ?')
      .bind(idempotencyKey)
      .first<D1TxRow>();

    if (!existingTx) return null;
    if (existingTx.sender_id !== senderId) {
      throw new WorkerBankError('Mã giao dịch không hợp lệ.', 409, 'IDEMPOTENCY_CONFLICT');
    }

    const [senderNow, recipientNow] = await Promise.all([
      this.db.prepare('SELECT balance FROM users WHERE id = ?').bind(senderId).first<{ balance: number }>(),
      this.db
        .prepare('SELECT balance FROM users WHERE id = ?')
        .bind(existingTx.recipient_id)
        .first<{ balance: number }>(),
    ]);

    return {
      transaction: mapTxRow(existingTx),
      senderBalance: Number(senderNow?.balance ?? 0),
      recipientId: existingTx.recipient_id,
      recipientBalance: Number(recipientNow?.balance ?? 0),
      newSenderAchievements: [] as AchievementRecord[],
      deduplicated: true,
    };
  }

  async executeTransfer(input: {
    senderId: string;
    recipientAccount: string;
    amount: number;
    note: string;
    method: TransferMethod;
    idempotencyKey: string;
  }) {
    await this.ensureInitialized();

    const recipientAccount = normalizeAccountNumber(input.recipientAccount ?? '');
    const idempotencyKey = (input.idempotencyKey ?? '').trim();
    const method: TransferMethod = input.method === 'qr' ? 'qr' : 'account';
    const note = (input.note ?? '').trim().slice(0, 140) || 'Chuyển tiền PLAYCOIN';

    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw new WorkerBankError('Thiếu mã chống trùng lặp giao dịch hợp lệ.', 400, 'INVALID_IDEMPOTENCY_KEY');
    }
    if (!/^\d{10}$/.test(recipientAccount)) {
      throw new WorkerBankError('Số tài khoản người nhận phải gồm đúng 10 chữ số.', 400, 'INVALID_ACCOUNT_NUMBER');
    }

    // 1. Fast-path idempotency check
    const alreadyDone = await this.returnDeduplicatedTransfer(input.senderId, idempotencyKey);
    if (alreadyDone) return alreadyDone;

    // 2. Load sender, recipient, and sender's existing achievement codes
    const [sender, recipient, senderAchRes] = await Promise.all([
      this.db.prepare('SELECT * FROM users WHERE id = ?').bind(input.senderId).first<D1UserRow>(),
      this.db
        .prepare('SELECT * FROM users WHERE account_number = ?')
        .bind(recipientAccount)
        .first<D1UserRow>(),
      this.db
        .prepare('SELECT code FROM achievements WHERE user_id = ?')
        .bind(input.senderId)
        .all<{ code: string }>(),
    ]);

    if (!sender) {
      throw new WorkerBankError('Tài khoản người gửi không tồn tại.', 404, 'SENDER_NOT_FOUND');
    }
    if (!recipient) {
      throw new WorkerBankError('Không tìm thấy tài khoản người nhận.', 404, 'RECIPIENT_NOT_FOUND');
    }
    if (sender.id === recipient.id) {
      throw new WorkerBankError('Không thể tự chuyển PLAYCOIN cho chính mình.', 400, 'SELF_TRANSFER_FORBIDDEN');
    }

    const amountErr = validateTransferAmount(input.amount, Number(sender.balance));
    if (amountErr) {
      throw new WorkerBankError(amountErr, 400, 'INVALID_AMOUNT');
    }

    const txId = crypto.randomUUID();
    const txCode = generateTxCodeWeb();
    const now = new Date().toISOString();

    const existingSenderCodes = new Set((senderAchRes.results ?? []).map((r) => r.code));
    const candidateSenderAchievements: AchievementRecord[] = [];
    const statements: D1PreparedStatement[] = [
      // Statement 1: Debit sender. Relies on SQLite CHECK(balance >= 0) so ANY concurrent overdraft
      // aborts and rolls back the ENTIRE D1 db.batch() transaction atomically!
      this.db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').bind(input.amount, sender.id),
      // Statement 2: Credit recipient atomically in the same D1 batch transaction
      this.db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').bind(input.amount, recipient.id),
      // Statement 3: Insert ledger row. UNIQUE(idempotency_key) aborts & rolls back entire batch on concurrent duplicate!
      this.db
        .prepare(
          `INSERT INTO transactions (
            id, tx_code, idempotency_key, sender_id, sender_account, sender_name,
            recipient_id, recipient_account, recipient_name, amount, note, method, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`
        )
        .bind(
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
          now
        ),
    ];

    const queueSenderAchievement = (code: string, title: string, description: string) => {
      if (existingSenderCodes.has(code)) return;
      const achId = crypto.randomUUID();
      candidateSenderAchievements.push({ id: achId, code, title, description, unlockedAt: now });
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO achievements (id, user_id, code, title, description, unlocked_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(achId, sender.id, code, title, description, now)
      );
    };

    queueSenderAchievement(
      'FIRST_TRANSFER',
      'Giao dịch đầu tiên',
      'Hoàn thành lệnh chuyển PLAYCOIN đầu tiên trên PLAYBANK.'
    );
    if (input.amount >= 500_000) {
      queueSenderAchievement(
        'HIGH_ROLLER',
        'Tay chơi hào phóng',
        'Thực hiện một giao dịch từ 500.000 PLAYCOIN trở lên.'
      );
    }
    if (method === 'qr') {
      queueSenderAchievement(
        'QR_PAY_PRO',
        'Chuyên gia Quét QR',
        'Chuyển tiền thành công bằng mã QR nội bộ PLAYBANK.'
      );
    }

    // Recipient achievements (idempotent via INSERT OR IGNORE)
    statements.push(
      this.db
        .prepare(
          `INSERT OR IGNORE INTO achievements (id, user_id, code, title, description, unlocked_at)
           VALUES (?, ?, 'FIRST_RECEIVE', 'Lần đầu nhận tiền', 'Nhận được khoản PLAYCOIN đầu tiên từ người chơi khác.', ?)`
        )
        .bind(crypto.randomUUID(), recipient.id, now)
    );

    if (Number(recipient.balance) + input.amount >= 1_500_000) {
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO achievements (id, user_id, code, title, description, unlocked_at)
             VALUES (?, ?, 'WEALTH_BUILDER', 'Tài phiệt PLAYBANK', 'Đạt mốc số dư từ 1.500.000 PLAYCOIN trở lên.', ?)`
          )
          .bind(crypto.randomUUID(), recipient.id, now)
      );
    }

    // 3. Execute ALL statements atomically inside Cloudflare D1 batch transaction
    try {
      await this.db.batch(statements);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('CHECK constraint failed') || msg.includes('balance >= 0')) {
        throw new WorkerBankError('Số dư PLAYCOIN không đủ để thực hiện giao dịch.', 400, 'INSUFFICIENT_FUNDS');
      }
      if (msg.includes('UNIQUE constraint failed') && msg.includes('idempotency_key')) {
        const dup = await this.returnDeduplicatedTransfer(input.senderId, idempotencyKey);
        if (dup) return dup;
      }
      throw err;
    }

    const [insertedTx, senderAfter, recipientAfter] = await Promise.all([
      this.db.prepare('SELECT * FROM transactions WHERE id = ?').bind(txId).first<D1TxRow>(),
      this.db.prepare('SELECT balance FROM users WHERE id = ?').bind(sender.id).first<{ balance: number }>(),
      this.db.prepare('SELECT balance FROM users WHERE id = ?').bind(recipient.id).first<{ balance: number }>(),
    ]);

    return {
      transaction: mapTxRow(insertedTx!),
      senderBalance: Number(senderAfter?.balance ?? 0),
      recipientId: recipient.id,
      recipientBalance: Number(recipientAfter?.balance ?? 0),
      newSenderAchievements: candidateSenderAchievements,
      deduplicated: false,
    };
  }

  async getTransactions(
    userId: string,
    filters?: {
      q?: string;
      direction?: 'all' | 'sent' | 'received';
      fromDate?: string;
      toDate?: string;
      limit?: number;
    }
  ): Promise<TransactionRecord[]> {
    await this.ensureInitialized();

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    const direction = filters?.direction ?? 'all';
    if (direction === 'sent') {
      clauses.push('sender_id = ?');
      params.push(userId);
    } else if (direction === 'received') {
      clauses.push('recipient_id = ?');
      params.push(userId);
    } else {
      clauses.push('(sender_id = ? OR recipient_id = ?)');
      params.push(userId, userId);
    }

    const q = (filters?.q ?? '').trim();
    if (q) {
      clauses.push(
        '(tx_code LIKE ? OR sender_name LIKE ? OR recipient_name LIKE ? OR sender_account LIKE ? OR recipient_account LIKE ? OR note LIKE ?)'
      );
      const pattern = `%${q}%`;
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    if (filters?.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate)) {
      clauses.push('created_at >= ?');
      params.push(`${filters.fromDate}T00:00:00.000Z`);
    }

    if (filters?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.toDate)) {
      clauses.push('created_at <= ?');
      params.push(`${filters.toDate}T23:59:59.999Z`);
    }

    const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 200);
    params.push(limit);

    const res = await this.db
      .prepare(`SELECT * FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .bind(...params)
      .all<D1TxRow>();

    return (res.results ?? []).map(mapTxRow);
  }

  async getLeaderboard(currentUserId: string, limit = 20): Promise<LeaderboardEntry[]> {
    await this.ensureInitialized();

    const res = await this.db
      .prepare(
        `SELECT id, display_name, account_number, avatar_url, balance, is_anonymous
         FROM users
         ORDER BY balance DESC, created_at ASC
         LIMIT ?`
      )
      .bind(limit)
      .all<{
        id: string;
        display_name: string;
        account_number: string;
        avatar_url: string;
        balance: number;
        is_anonymous: number;
      }>();

    return (res.results ?? []).map((row, index) => {
      const isCurrentUser = row.id === currentUserId;
      const isAnonymous = Number(row.is_anonymous) === 1;
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
