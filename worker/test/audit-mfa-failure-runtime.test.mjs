import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { generateMfaToken, generateMfaSetupToken } from '../src/auth/mfa-token.ts';
import { encryptTotpSecret, generateRecoveryCodes } from '../src/auth/mfa.ts';
import { generateTotpCode } from '../src/auth/totp.ts';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';

test('W05: native MFA confirmation distinguishes infrastructure failures and preserves committed results', { timeout: 180000 }, async t => {
  let fault = null;
  const f = await createRuntimeFixture({ rpcHook: async ({ name, phase }) => {
    if (fault?.phase === phase && fault.names.includes(name)) {
      if (fault.once) fault = null;
      return Response.json({ message: 'Synthetic transient storage outage' }, { status: 503 });
    }
  } });
  t.after(() => f.close());
  const identity = { userId: 'mfa-confirm-owner', username: 'mfa-confirm-owner', sessionVersion: 1 };
  const secret = 'JBSWY3DPEHPK3PXP';
  const encrypted = await encryptTotpSecret(secret, identity.userId, runtimeSecrets);
  const recovery = await generateRecoveryCodes(runtimeSecrets);
  const session = await generateToken(identity.userId, identity.username, 1, runtimeSecrets);
  const stepUp = await generateMfaToken({ ...identity, purpose: 'mfa-step-up' }, runtimeSecrets);
  const csrf = 'd'.repeat(32);
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1',
    Cookie: `cf_monitor_session=${session}; cf_monitor_csrf=${csrf}; cf_monitor_mfa_stepup=${stepUp}`, 'X-CSRF-Token': csrf };
  const post = (path, body) => f.fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const consumeNames = ['cfm_consume_totp_step', 'cfm_consume_recovery_code', 'cfm_consume_mfa_factor'];
  t.beforeEach(async () => {
    fault = null;
    await f.database.exec('delete from login_rate_limits; delete from users;');
    await f.database.query('insert into users(uuid,username,passwd,session_version,totp_secret_enc,totp_enabled_at,recovery_code_hashes,totp_last_used_step) values($1,$2,$3,1,$4,now(),$5::jsonb,-1)',
      [identity.userId, identity.username, 'synthetic-unused-password-hash', encrypted, JSON.stringify(recovery.hashes)]);
  });

  for (const purpose of ['login', 'step-up']) for (const method of ['totp', 'recovery_code']) for (const phase of ['before', 'after']) {
    await t.test(`${purpose} ${method}: ${phase}-commit outage remains retryable`, async () => {
      const body = { method, code: method === 'totp' ? await generateTotpCode(secret) : recovery.codes[0],
        ...(purpose === 'login' ? { challenge: await generateMfaToken({ ...identity, purpose: 'mfa-login' }, runtimeSecrets) } : {}) };
      const path = purpose === 'login' ? '/api/login/mfa' : '/api/admin/account/mfa/step-up';
      fault = { names: consumeNames, phase, once: true };
      const first = await post(path, body);
      assert.equal(first.status, 503, 'infrastructure failure is not bad credentials or broken configuration');
      assert.equal((await first.json()).code, 'MFA_TEMPORARY_UNAVAILABLE');
      assert.equal((await f.database.query('select count(*)::int as count from login_rate_limits')).rows[0].count, 0);
      const retried = await post(path, body);
      assert.equal(retried.status, 200, 'retry the same operation after a lost confirmation without consuming another factor');
      assert.ok(retried.headers.get('set-cookie'));
    });
  }

  await t.test('step-up succeeds if rate-limit cleanup fails after valid factor consumption', async () => {
    await f.database.query('insert into login_rate_limits(bucket,failures,first_failed_at,last_failed_at,locked_until) values($1,1,now(),now(),null)',
      [`mfa:ip:1.1.1.1`]);
    fault = { names: ['cfm_clear_login_rate_limits', 'cfm_clear_observed_login_failures'], phase: 'before', once: false };
    const response = await post('/api/admin/account/mfa/step-up', { method: 'totp', code: await generateTotpCode(secret) });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('set-cookie'));
  });

  for (const action of ['enable', 'recovery-codes', 'disable']) {
    await t.test(`${action}: audit failure cannot hide a committed business result`, async () => {
      let body = {};
      if (action === 'enable') {
        await f.database.query("update users set totp_enabled_at=null,totp_secret_enc=null,recovery_code_hashes='[]'::jsonb,totp_last_used_step=-1 where uuid=$1", [identity.userId]);
        body = { setup_token: await generateMfaSetupToken({ ...identity, encryptedSecret: encrypted }, runtimeSecrets), code: await generateTotpCode(secret) };
      }
      fault = { names: ['cfm_insert_audit_log'], phase: 'before', once: false };
      const response = await post(`/api/admin/account/mfa/${action}`, body);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.success, true);
      if (action !== 'disable') assert.equal(result.recovery_codes.length, 8);
      const user = (await f.database.query('select totp_enabled_at from users where uuid=$1', [identity.userId])).rows[0];
      assert.equal(Boolean(user.totp_enabled_at), action !== 'disable');
    });
  }

  for (const purpose of ['login', 'step-up']) for (const method of ['totp', 'recovery_code']) {
    await t.test(`${purpose} ${method}: a lost response reuses the same persisted factor confirmation`, async () => {
      const body = { method, code: method === 'totp' ? await generateTotpCode(secret) : recovery.codes[0],
        ...(purpose === 'login' ? { challenge: await generateMfaToken({ ...identity, purpose: 'mfa-login' }, runtimeSecrets) } : {}) };
      const path = purpose === 'login' ? '/api/login/mfa' : '/api/admin/account/mfa/step-up';
      fault = { names: consumeNames, phase: 'after', once: true };
      assert.ok((await post(path, body)).status >= 500);
      const row = (await f.database.query('select totp_last_used_step,jsonb_array_length(recovery_code_hashes)::int as remaining from users where uuid=$1', [identity.userId])).rows[0];
      assert.ok(method === 'totp' ? Number(row.totp_last_used_step) >= 0 : row.remaining === 7, 'the actual first transaction has committed factor consumption');
      assert.equal((await post(path, body)).status, 200);
    });
  }

  for (const method of ['totp', 'recovery_code']) {
    await t.test(`${method}: confirmation cannot authorize a different login challenge`, async () => {
      const body = { method, code: method === 'totp' ? await generateTotpCode(secret) : recovery.codes[0],
        challenge: await generateMfaToken({ ...identity, purpose: 'mfa-login' }, runtimeSecrets) };
      assert.equal((await post('/api/login/mfa', body)).status, 200);
      assert.equal((await post('/api/login/mfa', body)).status, 200, 'same operation can recover confirmation');
      const changed = { ...body, challenge: await generateMfaToken({ ...identity, purpose: 'mfa-login' }, runtimeSecrets) };
      assert.equal((await post('/api/login/mfa', changed)).status, 401, 'one-time factor cannot start another login');
    });
  }

  await t.test('step-up retries retain the original verification time and expiry', async () => {
    const body = { method: 'totp', code: await generateTotpCode(secret) };
    assert.equal((await post('/api/admin/account/mfa/step-up', body)).status, 200);
    const verifiedAt = new Date(Date.now() - 240_000).toISOString();
    await f.database.query("update cfm_internal.mfa_factor_receipts set verified_at=$1::timestamptz,expires_at=$1::timestamptz+interval '5 minutes'", [verifiedAt]);
    const retried = await post('/api/admin/account/mfa/step-up', body);
    assert.equal(retried.status, 200);
    const remaining = (await retried.json()).expires_in;
    assert.ok(remaining > 50 && remaining <= 60, 'retry only has the original remaining minute');
    const token = /cf_monitor_mfa_stepup=([^;]+)/.exec(retried.headers.get('set-cookie'))?.[1];
    assert.ok(token);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(payload.iat, Math.floor(Date.parse(verifiedAt) / 1000));
    assert.equal(payload.exp, payload.iat + 300);
    await f.database.exec("update cfm_internal.mfa_factor_receipts set expires_at=now()-interval '1 second'");
    assert.equal((await post('/api/admin/account/mfa/step-up', body)).status, 401, 'expired confirmation cannot consume the same OTP again');
  });

  await t.test('missing MFA data key is a configuration error without invalid-factor penalties', async () => {
    await f.database.query('update users set totp_secret_enc=$1', [`v2.${'f'.repeat(16)}.synthetic.iv`]);
    const response = await post('/api/admin/account/mfa/step-up', { method: 'totp', code: await generateTotpCode(secret) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'MFA_CONFIGURATION_ERROR');
    assert.equal((await f.database.query('select count(*)::int as count from login_rate_limits')).rows[0].count, 0);
  });
});
