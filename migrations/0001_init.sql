-- PLAYBANK SIMULATOR — Cloudflare D1 Initial Schema
-- Chạy bằng: npx wrangler d1 migrations apply playbank-db --remote

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
