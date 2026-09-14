import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const source = await readFile(new URL('./public.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
const passwordRoute = source.slice(source.indexOf("publicRoutes.post('/login'"), source.indexOf("publicRoutes.post('/login/mfa'"));
const mfaRoute = source.slice(source.indexOf("publicRoutes.post('/login/mfa'"), source.indexOf('// 退出登录'));

assert.match(passwordRoute, /user\.totp_enabled_at\s*&&\s*user\.totp_secret_enc/);
assert.match(passwordRoute, /code:\s*'MFA_REQUIRED'/);
assert.match(passwordRoute, /generateMfaToken\(/);
const challengeBranch = passwordRoute.match(/if \(user\.totp_enabled_at[^]*?return c\.json\(\{[^]*?MFA_REQUIRED[^]*?\}\);[^]*?\}/)?.[0] || '';
assert.ok(challengeBranch, 'password login must have an MFA challenge branch');
assert.doesNotMatch(challengeBranch, /setAdminSessionCookie\(/);

assert.match(mfaRoute, /verifyMfaToken\([^;]+['"]mfa-login['"]/s);
assert.match(mfaRoute, /db\.getUserByUuid\(/);
assert.match(mfaRoute, /payload\.sessionVersion/);
assert.match(mfaRoute, /confirmUserMfaFactor\(/);
assert.match(source, /async function completeAdminLogin[^]*?clearLoginFailures\(/);
assert.match(mfaRoute, /completeAdminLogin\(/);
assert.match(source, /async function completeAdminLogin[^]*?setAdminSessionCookie\(/);
assert.match(indexSource, /pathname === '\/api\/login\/mfa'/);

for (const method of ['totp', 'recovery_code']) test(`the shared ${method} verifier runs real cryptography and propagates storage failures`, async () => {
  let fail = false;
  const consumed = [];
  const unavailable = new Error('Synthetic unavailable storage');
  const loader = createWorkerLoader({ overrides: {
    'worker/src/db/auth-confirmation.ts': {
      consumeMfaFactor: async (_db, input) => { consumed.push(input); if (fail) throw unavailable; return { verified: true, verified_at: new Date().toISOString() }; },
      reencryptTotpSecret: async () => true,
    },
  } });
  const env = { JWT_SECRET: 'synthetic-shared-factor-verification-key-00000' };
  const mfa = loader.load('worker/src/auth/mfa.ts');
  const totp = loader.load('worker/src/auth/totp.ts');
  const { confirmUserMfaFactor } = loader.load('worker/src/auth/mfa-factor.ts');
  const now = Date.parse('2026-09-14T00:00:00Z');
  const secret = 'JBSWY3DPEHPK3PXP';
  const user = { uuid: 'synthetic-factor-owner', session_version: 1, totp_enabled_at: new Date(now).toISOString(),
    totp_secret_enc: await mfa.encryptTotpSecret(secret, 'synthetic-factor-owner', env) };
  const code = method === 'totp' ? await totp.generateTotpCode(secret, now) : (await mfa.generateRecoveryCodes(env)).codes[0];
  const input = { method, code, purpose: 'mfa-login', operationToken: 'synthetic-verified-challenge' };
  assert.equal((await confirmUserMfaFactor({}, user, input, env, now)).verified, true);
  assert.equal(consumed[0].method, method);
  if (method === 'totp') assert.equal(consumed[0].step, Math.floor(now / 30_000));
  else assert.ok(consumed[0].codeHashes.includes(await mfa.hashRecoveryCode(code, env)));
  assert.equal(Object.hasOwn(consumed[0], 'code'), false);
  assert.equal(Object.hasOwn(consumed[0], 'operationToken'), false);
  assert.match(consumed[0].operationId, /^[a-f0-9]{64}$/);
  assert.match(consumed[0].factorKey, /^[a-f0-9]{64}$/);
  fail = true;
  await assert.rejects(() => confirmUserMfaFactor({}, user, input, env, now), error => error === unavailable);
});

test('an expired OTP reaches only persisted-confirmation lookup and retains its operation identity', async () => {
  const calls = [];
  const loader = createWorkerLoader({ overrides: { 'worker/src/db/auth-confirmation.ts': {
    consumeMfaFactor: async (_db, input) => { calls.push(input); return { verified: true, verified_at: '2026-09-14T00:00:00Z' }; },
  } } });
  const env = { JWT_SECRET: 'synthetic-shared-expiry-factor-key-000000000' };
  const mfa = loader.load('worker/src/auth/mfa.ts');
  const totp = loader.load('worker/src/auth/totp.ts');
  const { confirmUserMfaFactor } = loader.load('worker/src/auth/mfa-factor.ts');
  const now = Date.parse('2026-09-14T00:00:00Z'), secret = 'JBSWY3DPEHPK3PXP';
  const user = { uuid: 'synthetic-factor-expiry', session_version: 1, totp_enabled_at: new Date(now).toISOString(),
    totp_secret_enc: await mfa.encryptTotpSecret(secret, 'synthetic-factor-expiry', env) };
  const input = { method: 'totp', code: await totp.generateTotpCode(secret, now), purpose: 'mfa-login', operationToken: 'synthetic-original-challenge' };
  await confirmUserMfaFactor({}, user, input, env, now);
  await confirmUserMfaFactor({}, user, input, env, now + 120_000);
  assert.equal(calls[1].step, undefined);
  assert.equal(calls[1].operationId, calls[0].operationId);
  assert.equal(calls[1].factorKey, calls[0].factorKey);
  await confirmUserMfaFactor({}, user, { ...input, operationToken: 'synthetic-new-challenge' }, env, now + 120_000);
  assert.notEqual(calls[2].operationId, calls[0].operationId);
  assert.notEqual(calls[2].factorKey, calls[0].factorKey);
});
