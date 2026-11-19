import crypto from 'node:crypto';
import Database from 'better-sqlite3';
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

export class BankError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface UserRow {
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

interface TransactionRow {
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

interface AchievementRow {
  id: string;
  user_id: string;
  code: string;
  title: string;
  description: string;
  unlocked_at: string;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function mapUserRow(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    accountNumber: row.account_number,
    avatarUrl: row.avatar_url,
    balance: row.balance,
    isAnonymous: row.is_anonymous === 1,
    soundEnabled: row.sound_enabled === 1,
    createdAt: row.created_at,
  };
}

function mapTxRow(row: TransactionRow): TransactionRecord {
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
    amount: row.amount,
    note: row.note,
    method: row.method,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapAchievementRow(row: AchievementRow): AchievementRecord {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    unlockedAt: row.unlocked_at,
  };
}

export class BankEngine {
  private db: Database.Database;

  constructor(dbPath: string, options?: { seedDemoUsers?: boolean }) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    if (options?.seedDemoUsers !== false) {
      this.seedDemoUsersIfEmpty();
    }
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
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
        amount INTEGER NOT NULL CHECK(amount > 0),
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
  }

  private generateUniqueAccountNumber(): string {
    const checkStmt = this.db.prepare('SELECT 1 FROM users WHERE account_number = ?');
    for (let attempt = 0; attempt < 30; attempt++) {
      const randomSix = crypto.randomInt(100000, 999999);
      const candidate = `8801${randomSix}`;
      if (!checkStmt.get(candidate)) {
        return candidate;
      }
    }
    throw new BankError('Không thể khởi tạo số tài khoản mới. Vui lòng thử lại.', 500, 'ACCOUNT_GEN_FAILED');
  }

  private generateTxCode(): string {
    const now = new Date();
    const y = String(now.getFullYear()).slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `PB${y}${m}${d}-${rand}`;
  }

  private createSession(userId: string): string {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, now.toISOString(), expires.toISOString());
    return rawToken;
  }

  private seedDemoUsersIfEmpty(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (countRow.count > 0) return;

    const now = new Date().toISOString();
    const demoUsers = [
      {
        email: 'minhquan@playbank.demo',
        displayName: 'Nguyễn Minh Quân',
        accountNumber: '8801000001',
        avatarUrl: PRESET_AVATARS[0].url,
        balance: INITIAL_PLAYCOIN_GRANT,
      },
      {
        email: 'khanhlinh@playbank.demo',
        displayName: 'Trần Khánh Linh',
        accountNumber: '8801000002',
        avatarUrl: PRESET_AVATARS[1].url,
        balance: INITIAL_PLAYCOIN_GRANT,
      },
      {
        email: 'giabao@playbank.demo',
        displayName: 'Lê Gia Bảo',
        accountNumber: '8801000003',
        avatarUrl: PRESET_AVATARS[2].url,
        balance: INITIAL_PLAYCOIN_GRANT,
      },
    ];

    const insertUser = this.db.prepare(`
      INSERT INTO users (
        id, email, password_hash, display_name, account_number,
        avatar_url, balance, initial_bonus_granted, is_anonymous, sound_enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?)
    `);

    const seedTx = this.db.transaction(() => {
      const pwHash = hashPassword('Playbank123');
      for (const u of demoUsers) {
        insertUser.run(
          crypto.randomUUID(),
          u.email,
          pwHash,
          u.displayName,
          u.accountNumber,
          u.avatarUrl,
          u.balance,
          now
        );
      }
    });
    seedTx();
  }

  register(input: { email: string; password: string; displayName: string }): {
    token: string;
    user: UserProfile;
  } {
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

    const existing = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      throw new BankError('Email này đã được đăng ký tài khoản PLAYBANK.', 409, 'EMAIL_EXISTS');
    }

    const id = crypto.randomUUID();
    const accountNumber = this.generateUniqueAccountNumber();
    const passwordHash = hashPassword(password);
    const avatarUrl = PRESET_AVATARS[crypto.randomInt(0, PRESET_AVATARS.length)].url;
    const now = new Date().toISOString();

    const registerTx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (
            id, email, password_hash, display_name, account_number,
            avatar_url, balance, initial_bonus_granted, is_anonymous, sound_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?)`
        )
        .run(id, email, passwordHash, displayName, accountNumber, avatarUrl, INITIAL_PLAYCOIN_GRANT, now);

      const token = this.createSession(id);
      const userRow = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
      return { token, user: mapUserRow(userRow) };
    });

    return registerTx();
  }

  login(input: { email: string; password: string }): { token: string; user: UserProfile } {
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';

    if (!email || !password) {
      throw new BankError('Vui lòng nhập đầy đủ email và mật khẩu.', 400, 'MISSING_CREDENTIALS');
    }

    const userRow = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      throw new BankError('Email hoặc mật khẩu không chính xác.', 401, 'INVALID_CREDENTIALS');
    }

    const token = this.createSession(userRow.id);
    return { token, user: mapUserRow(userRow) };
  }

  logout(rawToken: string): void {
    if (!rawToken) return;
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(rawToken));
  }

  authenticate(rawToken: string | undefined): UserProfile {
    if (!rawToken) {
      throw new BankError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', 401, 'UNAUTHORIZED');
    }
    const tokenHash = hashToken(rawToken);
    const session = this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { user_id: string; expires_at: string } | undefined;

    if (!session) {
      throw new BankError('Phiên đăng nhập không tồn tại.', 401, 'UNAUTHORIZED');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      throw new BankError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'SESSION_EXPIRED');
    }

    const userRow = this.db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as UserRow | undefined;
    if (!userRow) {
      throw new BankError('Tài khoản không tồn tại.', 401, 'UNAUTHORIZED');
    }
    return mapUserRow(userRow);
  }

  getDashboardSummary(userId: string): DashboardSummary {
    const userRow = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!userRow) {
      throw new BankError('Không tìm thấy tài khoản.', 404, 'USER_NOT_FOUND');
    }

    const sentRow = this.db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt FROM transactions WHERE sender_id = ?')
      .get(userId) as { total: number; cnt: number };

    const receivedRow = this.db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt FROM transactions WHERE recipient_id = ?')
      .get(userId) as { total: number; cnt: number };

    const recentRows = this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE sender_id = ? OR recipient_id = ?
         ORDER BY created_at DESC
         LIMIT 5`
      )
      .all(userId, userId) as TransactionRow[];

    const achievementRows = this.db
      .prepare('SELECT * FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC')
      .all(userId) as AchievementRow[];

    return {
      user: mapUserRow(userRow),
      stats: {
        totalSent: sentRow.total,
        totalReceived: receivedRow.total,
        txCount: sentRow.cnt + receivedRow.cnt,
      },
      recentTransactions: recentRows.map(mapTxRow),
      achievements: achievementRows.map(mapAchievementRow),
    };
  }

  updateProfile(
    userId: string,
    updates: {
      displayName?: string;
      avatarUrl?: string;
      isAnonymous?: boolean;
      soundEnabled?: boolean;
      // Intentionally ignore any forged balance/accountNumber fields if sent
    }
  ): UserProfile {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
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
      const isSafeDataImage = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length <= 280_000;
      if (!isAllowedPreset && !isSafeDataImage) {
        throw new BankError('Ảnh đại diện không hợp lệ hoặc vượt quá dung lượng cho phép.', 400, 'INVALID_AVATAR');
      }
      nextAvatarUrl = candidate;
    }

    const nextAnonymous = updates.isAnonymous !== undefined ? (updates.isAnonymous ? 1 : 0) : existing.is_anonymous;
    const nextSound = updates.soundEnabled !== undefined ? (updates.soundEnabled ? 1 : 0) : existing.sound_enabled;

    this.db
      .prepare(
        `UPDATE users
         SET display_name = ?, avatar_url = ?, is_anonymous = ?, sound_enabled = ?
         WHERE id = ?`
      )
      .run(nextDisplayName, nextAvatarUrl, nextAnonymous, nextSound, userId);

    const updated = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    return mapUserRow(updated);
  }

  lookupAccount(requesterId: string, rawAccountNumber: string): AccountLookupResult {
    const accountNumber = normalizeAccountNumber(rawAccountNumber);
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BankError('Số tài khoản PLAYBANK phải gồm đúng 10 chữ số.', 400, 'INVALID_ACCOUNT_NUMBER');
    }

    const row = this.db
      .prepare('SELECT id, account_number, display_name, avatar_url FROM users WHERE account_number = ?')
      .get(accountNumber) as
      | { id: string; account_number: string; display_name: string; avatar_url: string }
      | undefined;

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

  private awardAchievement(
    userId: string,
    code: string,
    title: string,
    description: string,
    now: string
  ): AchievementRecord | null {
    const exists = this.db
      .prepare('SELECT id FROM achievements WHERE user_id = ? AND code = ?')
      .get(userId, code);
    if (exists) return null;

    const id = crypto.randomUUID();
    this.db
      .prepare(
        'INSERT INTO achievements (id, user_id, code, title, description, unlocked_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, userId, code, title, description, now);

    return { id, code, title, description, unlockedAt: now };
  }

  executeTransfer(input: {
    senderId: string;
    recipientAccount: string;
    amount: number;
    note: string;
    method: TransferMethod;
    idempotencyKey: string;
  }): {
    transaction: TransactionRecord;
    senderBalance: number;
    recipientId: string;
    recipientBalance: number;
    newSenderAchievements: AchievementRecord[];
    deduplicated: boolean;
  } {
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

    const transferTx = this.db.transaction(() => {
      // 1. Idempotency guard: if this exact transfer already completed for this sender, return it safely
      const existingTx = this.db
        .prepare('SELECT * FROM transactions WHERE idempotency_key = ?')
        .get(idempotencyKey) as TransactionRow | undefined;

      if (existingTx) {
        if (existingTx.sender_id !== input.senderId) {
          throw new BankError('Mã giao dịch không hợp lệ.', 409, 'IDEMPOTENCY_CONFLICT');
        }
        const senderNow = this.db.prepare('SELECT balance FROM users WHERE id = ?').get(input.senderId) as {
          balance: number;
        };
        const recipientNow = this.db
          .prepare('SELECT balance FROM users WHERE id = ?')
          .get(existingTx.recipient_id) as { balance: number };
        return {
          transaction: mapTxRow(existingTx),
          senderBalance: senderNow.balance,
          recipientId: existingTx.recipient_id,
          recipientBalance: recipientNow.balance,
          newSenderAchievements: [] as AchievementRecord[],
          deduplicated: true,
        };
      }

      // 2. Load sender & recipient inside atomic write lock
      const sender = this.db.prepare('SELECT * FROM users WHERE id = ?').get(input.senderId) as UserRow | undefined;
      if (!sender) {
        throw new BankError('Tài khoản người gửi không tồn tại.', 404, 'SENDER_NOT_FOUND');
      }

      const recipient = this.db
        .prepare('SELECT * FROM users WHERE account_number = ?')
        .get(recipientAccount) as UserRow | undefined;
      if (!recipient) {
        throw new BankError('Không tìm thấy tài khoản người nhận.', 404, 'RECIPIENT_NOT_FOUND');
      }

      if (sender.id === recipient.id) {
        throw new BankError('Không thể tự chuyển PLAYCOIN cho chính mình.', 400, 'SELF_TRANSFER_FORBIDDEN');
      }

      // 3. Server-side amount & balance verification
      const amountErr = validateTransferAmount(input.amount, sender.balance);
      if (amountErr) {
        throw new BankError(amountErr, 400, 'INVALID_AMOUNT');
      }

      // 4. Atomic debit & credit
      const debitResult = this.db
        .prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?')
        .run(input.amount, sender.id, input.amount);

      if (debitResult.changes !== 1) {
        throw new BankError('Số dư PLAYCOIN không đủ để thực hiện giao dịch.', 400, 'INSUFFICIENT_FUNDS');
      }

      this.db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(input.amount, recipient.id);

      // 5. Record immutable ledger entry
      const txId = crypto.randomUUID();
      const txCode = this.generateTxCode();
      const now = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO transactions (
            id, tx_code, idempotency_key, sender_id, sender_account, sender_name,
            recipient_id, recipient_account, recipient_name, amount, note, method, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`
        )
        .run(
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
        );

      // 6. Award game achievements
      const newSenderAchievements: AchievementRecord[] = [];
      const firstTransfer = this.awardAchievement(
        sender.id,
        'FIRST_TRANSFER',
        'Giao dịch đầu tiên',
        'Hoàn thành lệnh chuyển PLAYCOIN đầu tiên trên PLAYBANK.',
        now
      );
      if (firstTransfer) newSenderAchievements.push(firstTransfer);

      if (input.amount >= 500_000) {
        const bigSpender = this.awardAchievement(
          sender.id,
          'HIGH_ROLLER',
          'Tay chơi hào phóng',
          'Thực hiện một giao dịch từ 500.000 PLAYCOIN trở lên.',
          now
        );
        if (bigSpender) newSenderAchievements.push(bigSpender);
      }

      if (method === 'qr') {
        const qrMaster = this.awardAchievement(
          sender.id,
          'QR_PAY_PRO',
          'Chuyên gia Quét QR',
          'Chuyển tiền thành công bằng mã QR nội bộ PLAYBANK.',
          now
        );
        if (qrMaster) newSenderAchievements.push(qrMaster);
      }

      this.awardAchievement(
        recipient.id,
        'FIRST_RECEIVE',
        'Lần đầu nhận tiền',
        'Nhận được khoản PLAYCOIN đầu tiên từ người chơi khác.',
        now
      );

      const newSenderBalance = sender.balance - input.amount;
      const newRecipientBalance = recipient.balance + input.amount;

      if (newRecipientBalance >= 1_500_000) {
        this.awardAchievement(
          recipient.id,
          'WEALTH_BUILDER',
          'Tài phiệt PLAYBANK',
          'Đạt mốc số dư từ 1.500.000 PLAYCOIN trở lên.',
          now
        );
      }

      const inserted = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as TransactionRow;

      return {
        transaction: mapTxRow(inserted),
        senderBalance: newSenderBalance,
        recipientId: recipient.id,
        recipientBalance: newRecipientBalance,
        newSenderAchievements,
        deduplicated: false,
      };
    });

    return transferTx.immediate();
  }

  getTransactions(
    userId: string,
    filters?: {
      q?: string;
      direction?: 'all' | 'sent' | 'received';
      fromDate?: string;
      toDate?: string;
      limit?: number;
    }
  ): TransactionRecord[] {
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

    const rows = this.db
      .prepare(`SELECT * FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as TransactionRow[];

    return rows.map(mapTxRow);
  }

  getLeaderboard(currentUserId: string, limit = 20): LeaderboardEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, account_number, avatar_url, balance, is_anonymous
         FROM users
         ORDER BY balance DESC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      display_name: string;
      account_number: string;
      avatar_url: string;
      balance: number;
      is_anonymous: number;
    }>;

    return rows.map((row, index) => {
      const isCurrentUser = row.id === currentUserId;
      const isAnonymous = row.is_anonymous === 1;
      const tail = row.account_number.slice(-4);
      return {
        rank: index + 1,
        displayName: isAnonymous ? `Người chơi ẩn danh #${tail}` : row.display_name,
        accountMask: isAnonymous ? `•••• •••• ${tail}` : `${row.account_number.slice(0, 4)} •••• ${tail}`,
        avatarUrl: row.avatar_url,
        balance: row.balance,
        isAnonymous,
        isCurrentUser,
      };
    });
  }

  // Exposed strictly for unit-test security inspection (never wired to HTTP routes)
  _inspectRawPasswordHashForTest(email: string): string | null {
    const row = this.db
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .get(email.toLowerCase()) as { password_hash: string } | undefined;
    return row?.password_hash ?? null;
  }
}
