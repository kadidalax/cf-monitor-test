import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import { hashPassword, needsPasswordRehash, validateAdminPasswordStrength, verifyPassword } from './password.ts';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const oldPassword = 'synthetic-legacy-password';
const salt = Buffer.alloc(16, 7);
const oldHash = `pbkdf2_sha256$10000$${salt.toString('base64')}$${pbkdf2Sync(oldPassword, salt, 10000, 32, 'sha256').toString('base64')}`;

test('SEC01: new password hashes meet the current 600000-iteration PBKDF2 recommendation', async () => {
  const first = await hashPassword('synthetic-unique-passphrase');
  const second = await hashPassword('synthetic-unique-passphrase');
  assert.ok(Number(first.split('$')[1]) >= 600000);
  assert.notEqual(first, second, 'every password receives an independent random salt');
  assert.equal(await verifyPassword('synthetic-unique-passphrase', first), true);
  assert.equal(await verifyPassword('synthetic-wrong-passphrase', first), false);
});

test('SEC01: legacy hashes remain usable and are selected for upgrade', async () => {
  assert.equal(await verifyPassword(oldPassword, oldHash), true);
  assert.equal(needsPasswordRehash(oldHash), true);
});

test('SEC01: new administrator passwords need fifteen Unicode characters', () => {
  assert.match(validateAdminPasswordStrength('a'.repeat(14)) || '', /15/);
  assert.equal(validateAdminPasswordStrength('合成的较长测试口令支持中文字符验证'), null);
  assert.equal(validateAdminPasswordStrength('synthetic phrase with spaces'), null);
  assert.equal(validateAdminPasswordStrength('x'.repeat(100) + ' synthetic phrase'), null);
});

test('SEC01: common whole passwords and account-derived defaults are rejected', () => {
  for (const password of ['passwordpassword', '1234567890123456', 'qwertyuiopasdfghjkl', 'administrator123']) {
    assert.ok(validateAdminPasswordStrength(password), 'known weak whole password must be rejected');
  }
  assert.ok(validateAdminPasswordStrength('synthetic-owner123', 'synthetic-owner'));
  assert.equal(validateAdminPasswordStrength('a password about synthetic copper clouds'), null, 'normal phrases are not rejected by substring rules');
});

test('SEC01: malformed iteration fields cannot be partially parsed', async () => {
  assert.equal(await verifyPassword(oldPassword, oldHash.replace('$10000$', '$10000invalid$')), false);
});

test('SEC01: unknown-user verification has the same configured cost as a new account', () => {
  const { DUMMY_ADMIN_PASSWORD_HASH } = createWorkerLoader({ expose: {
    'worker/src/routes/public.ts': ['DUMMY_ADMIN_PASSWORD_HASH'],
  } }).load('worker/src/routes/public.ts');
  assert.ok(Number(DUMMY_ADMIN_PASSWORD_HASH.split('$')[1]) >= 600000);
});
