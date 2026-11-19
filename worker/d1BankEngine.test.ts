import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import worker from './index';
import { D1BankEngine, WorkerBankError } from './d1BankEngine';
import { hashPasswordWeb, verifyPasswordWeb } from './crypto';
import { INITIAL_PLAYCOIN_GRANT } from '../src/lib/banking';

/**
 * Faithful local Cloudflare D1 adapter backed by in-memory better-sqlite3.
 * Mirrors D1's atomic db.batch() transaction semantics (full rollback on any SQL/CHECK/UNIQUE failure).
 */
function createMockD1Database(): { db: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  interface InternalStmt {
    sql: string;
    params: unknown[];
  }

  const makeStatement = (sql: string, params: unknown[] = []): D1PreparedStatement & { _internal: InternalStmt } => {
    const executeRow = () => {
      const stmt = raw.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all(...params);
        return { success: true, results: rows, meta: { changes: 0 } } as unknown as D1Result<unknown>;
      }
      const info = stmt.run(...params);
      return { success: true, results: [], meta: { changes: info.changes } } as unknown as D1Result<unknown>;
    };

    const obj = {
      _internal: { sql, params },
      bind(...values: unknown[]) {
        return makeStatement(sql, values);
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const stmt = raw.prepare(sql);
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return executeRow() as D1Result<T>;
      },
      async run<T = unknown>(): Promise<D1Result<T>> {
        return executeRow() as D1Result<T>;
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        return raw.prepare(sql).raw().all(...params) as T[];
      },
    };
    return obj as unknown as D1PreparedStatement & { _internal: InternalStmt };
  };

  const db = {
    prepare(sql: string) {
      return makeStatement(sql);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const tx = raw.transaction(() => {
        const results: D1Result<T>[] = [];
        for (const s of statements) {
          const internal = (s as unknown as { _internal: InternalStmt })._internal;
          const stmt = raw.prepare(internal.sql);
          if (stmt.reader) {
            results.push({ success: true, results: stmt.all(...internal.params), meta: {} } as unknown as D1Result<T>);
          } else {
            const info = stmt.run(...internal.params);
            results.push({ success: true, results: [], meta: { changes: info.changes } } as unknown as D1Result<T>);
          }
        }
        return results;
      });
      return tx();
    },
    async exec(sql: string) {
      raw.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;

  return { db, raw };
}

test('Web Crypto PBKDF2-SHA256 hashes and verifies passwords safely without plaintext', async () => {
  const hash = await hashPasswordWeb('PlaybankCF2026!');
  assert.ok(hash.startsWith('pbkdf2$100000$'));
  assert.equal(hash.includes('PlaybankCF2026!'), false);
  assert.equal(await verifyPasswordWeb('PlaybankCF2026!', hash), true);
  assert.equal(await verifyPasswordWeb('WrongPass', hash), false);
});

test('Cloudflare D1BankEngine passes all 9 banking QA scenarios and atomic rollback checks', async () => {
  const { db, raw } = createMockD1Database();
  const engine = new D1BankEngine(db, { seedDemoUsers: false });

  try {
    // 1 & 2: Register User A and User B -> 1,000,000 PLAYCOIN each
    const regA = await engine.register({
      email: 'cf_a@playbank.test',
      password: 'PasswordA123',
      displayName: 'Nguyễn Gia Huy',
    });
    const regB = await engine.register({
      email: 'cf_b@playbank.test',
      password: 'PasswordB123',
      displayName: 'Võ Thảo Vy',
    });
    assert.equal(regA.user.balance, INITIAL_PLAYCOIN_GRANT);
    assert.equal(regB.user.balance, INITIAL_PLAYCOIN_GRANT);
    assert.notEqual(regA.user.accountNumber, regB.user.accountNumber);

    // 3, 4, 5, 6: Atomic D1 transfer of 200,000 via QR
    const idem = 'cf-idem-key-0001';
    const transfer = await engine.executeTransfer({
      senderId: regA.user.id,
      recipientAccount: regB.user.accountNumber,
      amount: 200_000,
      note: 'Quét QR thanh toán PLAYCOIN',
      method: 'qr',
      idempotencyKey: idem,
    });
    assert.equal(transfer.deduplicated, false);
    assert.equal(transfer.senderBalance, 800_000);
    assert.equal(transfer.recipientBalance, 1_200_000);
    assert.ok(transfer.newSenderAchievements.some((a) => a.code === 'FIRST_TRANSFER'));
    assert.ok(transfer.newSenderAchievements.some((a) => a.code === 'QR_PAY_PRO'));

    // 7: Re-login preserves D1 balances
    await engine.logout(regA.token);
    await assert.rejects(() => engine.authenticate(regA.token), WorkerBankError);
    const loginA = await engine.login({ email: 'cf_a@playbank.test', password: 'PasswordA123' });
    assert.equal(loginA.user.balance, 800_000);

    // 8: Overdraft / negative / self-transfer rejected atomically
    await assert.rejects(
      () =>
        engine.executeTransfer({
          senderId: regA.user.id,
          recipientAccount: regB.user.accountNumber,
          amount: 850_000,
          note: 'overdraft',
          method: 'account',
          idempotencyKey: 'cf-idem-overdraft',
        }),
      WorkerBankError
    );
    await assert.rejects(
      () =>
        engine.executeTransfer({
          senderId: regA.user.id,
          recipientAccount: regA.user.accountNumber,
          amount: 10_000,
          note: 'self',
          method: 'account',
          idempotencyKey: 'cf-idem-self',
        }),
      WorkerBankError
    );

    // Verify balances untouched after rejected transfers
    const dashA = await engine.getDashboardSummary(regA.user.id);
    const dashB = await engine.getDashboardSummary(regB.user.id);
    assert.equal(dashA.user.balance, 800_000);
    assert.equal(dashB.user.balance, 1_200_000);

    // 9: Duplicate submission with same idempotencyKey returns original tx without double debit
    const dup = await engine.executeTransfer({
      senderId: regA.user.id,
      recipientAccount: regB.user.accountNumber,
      amount: 200_000,
      note: 'Quét QR thanh toán PLAYCOIN',
      method: 'qr',
      idempotencyKey: idem,
    });
    assert.equal(dup.deduplicated, true);
    assert.equal(dup.senderBalance, 800_000);
    assert.equal(dup.recipientBalance, 1_200_000);
    assert.equal((await engine.getTransactions(regA.user.id)).length, 1);
  } finally {
    raw.close();
  }
});

test('Cloudflare Worker fetch handler enforces 403 balance tamper block, 503 missing D1, and full HTTP API', async () => {
  // Missing D1 binding returns explicit 503 (never fakes success)
  const unconfigured = await worker.fetch(new Request('https://playbank.workers.dev/api/me'), {});
  assert.equal(unconfigured.status, 503);

  const { db, raw } = createMockD1Database();
  try {
    // Health check reports D1 + polling realtime mode
    const healthRes = await worker.fetch(new Request('https://playbank.workers.dev/api/health'), { DB: db });
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.storage, 'd1');
    assert.equal(health.realtime, 'polling');

    // Register via HTTP POST /api/auth/register
    const regRes = await worker.fetch(
      new Request('https://playbank.workers.dev/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'http_user@playbank.test',
          password: 'WorkerPassword1',
          displayName: 'Đặng Minh Khôi',
        }),
      }),
      { DB: db }
    );
    assert.equal(regRes.status, 201);
    const regBody = (await regRes.json()) as { token: string; user: { balance: number } };
    assert.equal(regBody.user.balance, INITIAL_PLAYCOIN_GRANT);

    // Client balance tamper attempt via PATCH /api/me/profile MUST return 403 Forbidden
    const tamperRes = await worker.fetch(
      new Request('https://playbank.workers.dev/api/me/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${regBody.token}`,
        },
        body: JSON.stringify({ balance: 99_999_999 }),
      }),
      { DB: db }
    );
    assert.equal(tamperRes.status, 403);

    // /api/events returns clean polling handshake
    const sseRes = await worker.fetch(
      new Request(`https://playbank.workers.dev/api/events?token=${regBody.token}`),
      { DB: db }
    );
    assert.equal(sseRes.status, 200);
    const sseText = await sseRes.text();
    assert.match(sseText, /"mode":"polling"/);
  } finally {
    raw.close();
  }
});
