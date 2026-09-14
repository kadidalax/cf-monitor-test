import assert from 'node:assert/strict';
import test from 'node:test';
import * as mfa from './mfa.ts';

const before = { JWT_SECRET: 'synthetic-jwt-signing-before-rotation-000000000000', MFA_SECRET: 'synthetic-independent-mfa-data-key-0000000000000' };
const after = { ...before, JWT_SECRET: 'synthetic-jwt-signing-after-rotation-1111111111111' };
const secret = 'JBSWY3DPEHPK3PXP';
const code = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ';

test('SEC02: independent MFA ciphertext survives a session-signing key rotation', async () => {
  const encrypted = await mfa.encryptTotpSecret(secret, 'synthetic-owner', before);
  assert.equal(await mfa.decryptTotpSecret(encrypted, 'synthetic-owner', after), secret);
  assert.match(encrypted, /^v2\.[a-f0-9]{16}\./, 'ciphertext identifies its data key');
});

test('SEC02: independent recovery hashes survive a session-signing key rotation', async () => {
  const hash = await mfa.hashRecoveryCode(code, before);
  assert.equal(await mfa.hashRecoveryCode(code, after), hash);
  assert.match(hash, /^v2\.[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
});

test('SEC02: legacy material can be read with an explicitly retained legacy key after rotation', async () => {
  const legacy = { JWT_SECRET: before.JWT_SECRET };
  const oldCipher = await mfa.encryptTotpSecret(secret, 'synthetic-owner', legacy);
  const oldHash = await mfa.hashRecoveryCode(code, legacy);
  const migrated = { ...after, MFA_LEGACY_SECRET: before.JWT_SECRET };
  assert.equal(await mfa.decryptTotpSecret(oldCipher, 'synthetic-owner', migrated), secret);
  const hashes = await mfa.hashRecoveryCodeCandidates?.(code, migrated);
  assert.ok(hashes?.includes(oldHash), 'old one-way hashes need their retained key until recovery codes are regenerated');
  assert.match(await mfa.encryptTotpSecret(secret, 'synthetic-owner', migrated), /^v2\./);
});

test('SEC02: current and previous data keys support an explicit data-key transition', async () => {
  const encrypted = await mfa.encryptTotpSecret(secret, 'synthetic-owner', before);
  const hash = await mfa.hashRecoveryCode(code, before);
  const rotated = { ...after, MFA_SECRET: 'synthetic-new-mfa-data-key-222222222222222222222', MFA_PREVIOUS_SECRET: before.MFA_SECRET };
  assert.equal(await mfa.decryptTotpSecret(encrypted, 'synthetic-owner', rotated), secret);
  assert.ok((await mfa.hashRecoveryCodeCandidates?.(code, rotated))?.includes(hash));
  assert.notEqual(await mfa.hashRecoveryCode(code, rotated), hash);
  await assert.rejects(() => mfa.decryptTotpSecret(encrypted, 'different-owner', rotated));
});

test('SEC02: an explicitly invalid independent key is a configuration error instead of falling back', async () => {
  await assert.rejects(() => mfa.encryptTotpSecret(secret, 'synthetic-owner', { ...before, MFA_SECRET: 'short' }),
    error => error?.name === 'MfaConfigurationError');
});
