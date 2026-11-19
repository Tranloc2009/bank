import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCandidateAccountNumber,
  generateTxCode,
  hashPassword,
  hashToken,
  resolvePgSslConfig,
  verifyPassword,
} from './security';

test('scrypt password hashing verifies matching password and rejects wrong password', () => {
  const hash = hashPassword('MySecurePass123');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(hash.includes('MySecurePass123'), false);
  assert.equal(verifyPassword('MySecurePass123', hash), true);
  assert.equal(verifyPassword('WrongPass123', hash), false);
});

test('session token hashing is deterministic SHA-256 hex', () => {
  const h1 = hashToken('raw-token-abc');
  const h2 = hashToken('raw-token-abc');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, 'raw-token-abc');
});

test('resolvePgSslConfig enables SSL for free cloud Postgres and disables for localhost', () => {
  assert.deepEqual(
    resolvePgSslConfig('postgresql://user:pass@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require'),
    { rejectUnauthorized: false }
  );
  assert.deepEqual(
    resolvePgSslConfig('postgresql://postgres:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'),
    { rejectUnauthorized: false }
  );
  assert.equal(resolvePgSslConfig('postgresql://postgres:pass@localhost:5432/playbank'), false);
  assert.equal(
    resolvePgSslConfig('postgresql://user:pass@remote.host:5432/db?sslmode=disable'),
    false
  );
});

test('account number and transaction code generators follow PLAYBANK format', () => {
  assert.match(generateCandidateAccountNumber(), /^8801\d{6}$/);
  assert.match(generateTxCode(), /^PB\d{6}-[A-F0-9]{6}$/);
});
