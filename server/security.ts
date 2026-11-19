import crypto from 'node:crypto';

export class BankError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateTxCode(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PB${y}${m}${d}-${rand}`;
}

export function generateCandidateAccountNumber(): string {
  const randomSix = crypto.randomInt(100000, 999999);
  return `8801${randomSix}`;
}

/**
 * Determine whether SSL should be enabled for a PostgreSQL DATABASE_URL.
 * Free cloud Postgres providers (Neon, Supabase, Aiven, Render) require SSL,
 * whereas local development databases usually do not.
 */
export function resolvePgSslConfig(databaseUrl: string): false | { rejectUnauthorized: boolean } {
  const lower = databaseUrl.toLowerCase();
  if (lower.includes('sslmode=disable')) {
    return false;
  }
  if (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('@postgres:') ||
    lower.includes('@db:')
  ) {
    return lower.includes('sslmode=require') ? { rejectUnauthorized: false } : false;
  }
  return { rejectUnauthorized: false };
}
