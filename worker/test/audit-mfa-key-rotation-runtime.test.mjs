import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMfaToken } from '../src/auth/mfa-token.ts';
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes } from '../src/auth/mfa.ts';
import { generateTotpCode } from '../src/auth/totp.ts';
import { cookieJar, createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';

test('SEC02: native login migrates MFA material and survives separate signing/data key rotations', { timeout: 120000 }, async t => {
  let fault = null;
  const f = await createRuntimeFixture({ rpcHook: ({ name, phase }) => {
    if (name === 'cfm_reencrypt_totp_secret' && fault === phase) {
      fault = null;
      return Response.json({ message: 'Synthetic interrupted ciphertext migration' }, { status: 503 });
    }
  } });
  t.after(() => f.close());
  const identity = { userId: 'synthetic-key-transition-owner', username: 'synthetic-key-transition-owner', sessionVersion: 1 };
  const secret = 'JBSWY3DPEHPK3PXP';
  const legacyCiphertext = await encryptTotpSecret(secret, identity.userId, runtimeSecrets);
  const legacyRecovery = await generateRecoveryCodes(runtimeSecrets);
  let env = { ...runtimeSecrets, MFA_SECRET: 'synthetic-mfa-data-key-one-0000000000000000000' };
  const post = (path, body, headers = {}) => f.fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1', ...headers }, body: JSON.stringify(body),
  });
  const account = async () => (await f.database.query('select session_version,totp_secret_enc,totp_last_used_step,recovery_code_hashes from users')).rows[0];
  const loginBody = async (method, code, signingEnv = env) => ({ method, code,
    challenge: await generateMfaToken({ ...identity, purpose: 'mfa-login' }, signingEnv) });
  const seed = async () => {
    await f.database.exec('delete from users; delete from login_rate_limits');
    await f.database.query('insert into users(uuid,username,passwd,session_version,totp_secret_enc,totp_enabled_at,recovery_code_hashes,totp_last_used_step) values($1,$1,$2,1,$3,now(),$4::jsonb,-1)',
      [identity.userId, 'synthetic-unused-password-hash', legacyCiphertext, JSON.stringify(legacyRecovery.hashes)]);
  };
  await f.restart(env);

  for (const phase of ['before', 'after']) await t.test(`legacy TOTP migration ${phase}-commit failure remains retryable without consuming the factor`, async () => {
    await seed();
    const body = await loginBody('totp', await generateTotpCode(secret, Date.now() - 30_000));
    fault = phase;
    const failed = await post('/api/login/mfa', body);
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).code, 'MFA_TEMPORARY_UNAVAILABLE');
    assert.equal(Number((await account()).totp_last_used_step), -1);
    assert.equal((await f.database.query('select count(*)::int as count from login_rate_limits')).rows[0].count, 0);
    assert.equal((await post('/api/login/mfa', body)).status, 200);
    const row = await account();
    assert.match(row.totp_secret_enc, /^v2\.[a-f0-9]{16}\./);
    assert.equal(await decryptTotpSecret(row.totp_secret_enc, identity.userId, env) === secret, true);
    assert.equal(row.session_version, 1);
    assert.equal(row.recovery_code_hashes.length, 8, 'migration must retain old recovery hashes');
  });

  let cookies;
  await t.test('rotating JWT signing keeps migrated TOTP and explicitly retained legacy recovery codes usable', async () => {
    const oldChallenge = await loginBody('totp', await generateTotpCode(secret));
    env = { ...env, JWT_SECRET: 'synthetic-new-jwt-signing-key-111111111111111111', MFA_LEGACY_SECRET: runtimeSecrets.JWT_SECRET };
    await f.restart(env);
    assert.equal((await post('/api/login/mfa', oldChallenge)).status, 401, 'old signing authority is revoked');
    assert.equal((await post('/api/login/mfa', await loginBody('totp', await generateTotpCode(secret)))).status, 200);
    const recoveryLogin = await post('/api/login/mfa', await loginBody('recovery_code', legacyRecovery.codes[0]));
    assert.equal(recoveryLogin.status, 200);
    cookies = cookieJar(recoveryLogin);
    assert.equal((await account()).recovery_code_hashes.length, 7);
  });

  const regenerate = async (sessionCookies, code) => {
    const csrf = /(?:^|; )cf_monitor_csrf=([^;]+)/.exec(sessionCookies)?.[1];
    assert.ok(csrf);
    const headers = { Cookie: sessionCookies, 'X-CSRF-Token': csrf };
    const stepUp = await post('/api/admin/account/mfa/step-up', { method: 'recovery_code', code }, headers);
    assert.equal(stepUp.status, 200);
    const response = await post('/api/admin/account/mfa/recovery-codes', {}, {
      ...headers, Cookie: `${sessionCookies}; ${cookieJar(stepUp)}`,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.recovery_codes.length, 8);
    const row = await account();
    identity.sessionVersion = row.session_version;
    assert.ok(row.recovery_code_hashes.every(hash => /^v2\.[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/.test(hash)));
    return body.recovery_codes;
  };
  let versionedCodes;
  await t.test('the actual recovery-code regeneration route writes versioned independent hashes', async () => {
    versionedCodes = await regenerate(cookies, legacyRecovery.codes[1]);
    assert.equal(identity.sessionVersion, 2);
  });

  await t.test('rotating the data key accepts previous hashes and automatically re-encrypts TOTP with the current key', async () => {
    env = { ...env, MFA_PREVIOUS_SECRET: env.MFA_SECRET, MFA_SECRET: 'synthetic-mfa-data-key-two-2222222222222222222' };
    await f.restart(env);
    const recoveryLogin = await post('/api/login/mfa', await loginBody('recovery_code', versionedCodes[0]));
    assert.equal(recoveryLogin.status, 200);
    cookies = cookieJar(recoveryLogin);
    const old = (await account()).totp_secret_enc;
    assert.equal((await post('/api/login/mfa', await loginBody('totp', await generateTotpCode(secret, Date.now() + 30_000)))).status, 200);
    const updated = (await account()).totp_secret_enc;
    assert.notEqual(updated.split('.')[1], old.split('.')[1]);
    assert.equal(await decryptTotpSecret(updated, identity.userId, { ...env, MFA_PREVIOUS_SECRET: undefined }) === secret, true);
  });

  await t.test('after all recovery codes are regenerated, obsolete data keys can be removed', async () => {
    const finalCodes = await regenerate(cookies, versionedCodes[1]);
    env = { ...env, MFA_PREVIOUS_SECRET: undefined, MFA_LEGACY_SECRET: undefined };
    await f.restart(env);
    assert.equal((await post('/api/login/mfa', await loginBody('recovery_code', finalCodes[0]))).status, 200);
    assert.equal(await decryptTotpSecret((await account()).totp_secret_enc, identity.userId, env) === secret, true);
  });
});
