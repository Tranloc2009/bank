import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_PLAYCOIN_GRANT,
  buildPlaybankQrPayload,
  formatAccountNumber,
  formatPlaycoin,
  normalizeAccountNumber,
  parseAmountInput,
  parsePlaybankQrPayload,
  validateTransferAmount,
} from './banking';

test('formatPlaycoin formats Vietnamese dot-separated integer amounts', () => {
  assert.equal(formatPlaycoin(INITIAL_PLAYCOIN_GRANT), '1.000.000');
  assert.equal(formatPlaycoin(800_000), '800.000');
  assert.equal(formatPlaycoin(1_250_500), '1.250.500');
  assert.equal(formatPlaycoin(0), '0');
});

test('account number formatting and normalization work consistently', () => {
  assert.equal(formatAccountNumber('8801000001'), '8801 0000 01');
  assert.equal(normalizeAccountNumber('8801 0000 01'), '8801000001');
  assert.equal(parseAmountInput('200.000 PLAYCOIN'), 200_000);
});

test('internal PLAYBANK QR payload encodes only account number without PII and rejects real bank QR', () => {
  const payload = buildPlaybankQrPayload('8801234567');
  assert.equal(payload, 'PLAYBANK:V1|ACC:8801234567');
  assert.equal(payload.includes('@'), false);

  const parsed = parsePlaybankQrPayload(payload);
  assert.deepEqual(parsed, { valid: true, accountNumber: '8801234567' });

  // Reject real VietQR / EMVCo banking QR code
  const vietQr = parsePlaybankQrPayload('00020101021138570010A00000072701270006970415011310387123456780208QRIBFTTA53037045802VN6304ABCD');
  assert.equal(vietQr.valid, false);
  if (!vietQr.valid) {
    assert.match(vietQr.error, /ngân hàng thật/i);
  }

  // Reject arbitrary text
  const garbage = parsePlaybankQrPayload('https://example.com/pay');
  assert.equal(garbage.valid, false);
});

test('validateTransferAmount enforces positive integer and sufficient balance', () => {
  assert.equal(validateTransferAmount(200_000, 1_000_000), null);
  assert.notEqual(validateTransferAmount(0, 1_000_000), null);
  assert.notEqual(validateTransferAmount(-50_000, 1_000_000), null);
  assert.notEqual(validateTransferAmount(1_000_001, 1_000_000), null);
  assert.notEqual(validateTransferAmount(100.5, 1_000_000), null);
});
