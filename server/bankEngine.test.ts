import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BankEngine, BankError } from './bankEngine';
import { INITIAL_PLAYCOIN_GRANT } from '../src/lib/banking';

function createTestEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playbank-test-'));
  const dbPath = path.join(dir, 'test.db');
  const engine = new BankEngine(dbPath, { seedDemoUsers: false });
  return {
    engine,
    cleanup: () => {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('End-to-end 9 required PLAYBANK banking QA scenarios', () => {
  const { engine, cleanup } = createTestEngine();
  try {
    // 1. User A registers and receives exactly 1,000,000 PLAYCOIN (password hashed, not plaintext)
    const regA = engine.register({
      email: 'alice@example.com',
      password: 'SecretPassword123',
      displayName: 'Nguyễn Minh An',
    });
    assert.equal(regA.user.balance, INITIAL_PLAYCOIN_GRANT);
    assert.match(regA.user.accountNumber, /^\d{10}$/);

    const rawHash = engine._inspectRawPasswordHashForTest('alice@example.com');
    assert.ok(rawHash && rawHash.startsWith('scrypt$'));
    assert.equal(rawHash.includes('SecretPassword123'), false);

    // 2. User B registers and receives 1,000,000 PLAYCOIN with distinct account number
    const regB = engine.register({
      email: 'bob@example.com',
      password: 'BobPassword456',
      displayName: 'Trần Quốc Bảo',
    });
    assert.equal(regB.user.balance, INITIAL_PLAYCOIN_GRANT);
    assert.notEqual(regA.user.accountNumber, regB.user.accountNumber);

    // Lookup reveals only public display info (no email or balance)
    const lookup = engine.lookupAccount(regA.user.id, regB.user.accountNumber);
    assert.equal(lookup.displayName, 'Trần Quốc Bảo');
    assert.equal(lookup.isSelf, false);
    assert.equal('email' in lookup, false);
    assert.equal('balance' in lookup, false);

    // 3, 4, 5. User A transfers 200,000 to User B
    const idempotencyKey = 'idem-transfer-a-to-b-001';
    const transfer = engine.executeTransfer({
      senderId: regA.user.id,
      recipientAccount: regB.user.accountNumber,
      amount: 200_000,
      note: 'Thanh toán tiền cà phê ảo',
      method: 'account',
      idempotencyKey,
    });
    assert.equal(transfer.deduplicated, false);
    assert.equal(transfer.senderBalance, 800_000);
    assert.equal(transfer.recipientBalance, 1_200_000);
    assert.equal(transfer.transaction.amount, 200_000);
    assert.equal(transfer.transaction.status, 'COMPLETED');
    assert.ok(transfer.newSenderAchievements.some((a) => a.code === 'FIRST_TRANSFER'));

    // 6. Both accounts have accurate balances and transaction histories
    const dashA = engine.getDashboardSummary(regA.user.id);
    const dashB = engine.getDashboardSummary(regB.user.id);
    assert.equal(dashA.user.balance, 800_000);
    assert.equal(dashA.stats.totalSent, 200_000);
    assert.equal(dashA.stats.totalReceived, 0);
    assert.equal(dashA.recentTransactions.length, 1);
    assert.equal(dashA.recentTransactions[0].txCode, transfer.transaction.txCode);

    assert.equal(dashB.user.balance, 1_200_000);
    assert.equal(dashB.stats.totalSent, 0);
    assert.equal(dashB.stats.totalReceived, 200_000);
    assert.equal(dashB.recentTransactions.length, 1);
    assert.equal(dashB.recentTransactions[0].txCode, transfer.transaction.txCode);

    // 7. Logging out and logging in fresh (e.g. from another device) preserves server balance
    engine.logout(regA.token);
    assert.throws(() => engine.authenticate(regA.token), BankError);
    const loginA = engine.login({ email: 'alice@example.com', password: 'SecretPassword123' });
    assert.equal(loginA.user.balance, 800_000);
    const loginB = engine.login({ email: 'bob@example.com', password: 'BobPassword456' });
    assert.equal(loginB.user.balance, 1_200_000);

    // 8. Reject negative, zero, overdraft, and self transfers
    assert.throws(
      () =>
        engine.executeTransfer({
          senderId: regA.user.id,
          recipientAccount: regB.user.accountNumber,
          amount: -10_000,
          note: 'hack',
          method: 'account',
          idempotencyKey: 'idem-neg-001',
        }),
      BankError
    );
    assert.throws(
      () =>
        engine.executeTransfer({
          senderId: regA.user.id,
          recipientAccount: regB.user.accountNumber,
          amount: 0,
          note: 'zero',
          method: 'account',
          idempotencyKey: 'idem-zero-001',
        }),
      BankError
    );
    assert.throws(
      () =>
        engine.executeTransfer({
          senderId: regA.user.id,
          recipientAccount: regB.user.accountNumber,
          amount: 900_000, // exceeds 800,000 balance
          note: 'overdraft',
          method: 'account',
          idempotencyKey: 'idem-over-001',
        }),
      BankError
    );
    assert.throws(
      () =>
        engine.executeTransfer({
          senderId: regA.user.id,
          recipientAccount: regA.user.accountNumber,
          amount: 10_000,
          note: 'self',
          method: 'account',
          idempotencyKey: 'idem-self-001',
        }),
      BankError
    );

    // 9. Duplicate submission with same idempotencyKey does NOT debit/credit twice
    const duplicate = engine.executeTransfer({
      senderId: regA.user.id,
      recipientAccount: regB.user.accountNumber,
      amount: 200_000,
      note: 'Thanh toán tiền cà phê ảo',
      method: 'account',
      idempotencyKey,
    });
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.senderBalance, 800_000);
    assert.equal(duplicate.recipientBalance, 1_200_000);
    assert.equal(engine.getTransactions(regA.user.id).length, 1);

    // Leaderboard respects anonymous flag
    engine.updateProfile(regB.user.id, { isAnonymous: true });
    const leaderboard = engine.getLeaderboard(regA.user.id);
    assert.equal(leaderboard[0].balance, 1_200_000);
    assert.match(leaderboard[0].displayName, /Người chơi ẩn danh/);
    assert.equal(leaderboard[1].displayName, 'Nguyễn Minh An');
  } finally {
    cleanup();
  }
});
