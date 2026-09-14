import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { generateMfaToken } from '../src/auth/mfa-token.ts';
import { encryptTotpSecret } from '../src/auth/mfa.ts';
import { generateTotpCode } from '../src/auth/totp.ts';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

for (const purpose of ['login', 'step-up']) test(`independent W05/W08: ${purpose} factor confirmation cannot cross a password/session rotation`, { timeout: 60000 }, async t => {
  const entered = deferred(), release = deferred();
  let armed = true;
  const f = await createRuntimeFixture({ rpcHook: async ({ name, phase }) => {
    if (armed && name === 'cfm_consume_mfa_factor' && phase === 'before') {
      armed = false; entered.resolve(); await release.promise;
    }
  } });
  t.after(async () => { release.resolve(); await f.close(); });
  const identity = { userId: 'mfa-revocation-review', username: 'mfa-revocation-review', sessionVersion: 1 };
  const secret = 'JBSWY3DPEHPK3PXP';
  await f.database.query(`insert into users(uuid,username,passwd,session_version,totp_secret_enc,totp_enabled_at,totp_last_used_step)
    values($1,$1,$2,1,$3,now(),-1)`, [identity.userId, 'synthetic-before-password-hash', await encryptTotpSecret(secret, identity.userId, runtimeSecrets)]);
  const code = await generateTotpCode(secret);
  const send = async version => {
    const current = { ...identity, sessionVersion: version };
    const session = await generateToken(current.userId, current.username, version, runtimeSecrets);
    const csrf = 'm'.repeat(32);
    const body = { method: 'totp', code,
      ...(purpose === 'login' ? { challenge: await generateMfaToken({ ...current, purpose: 'mfa-login' }, runtimeSecrets) } : {}) };
    return f.fetch(purpose === 'login' ? '/api/login/mfa' : '/api/admin/account/mfa/step-up', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1',
        Cookie: `cf_monitor_session=${session}; cf_monitor_csrf=${csrf}`, 'X-CSRF-Token': csrf }, body: JSON.stringify(body),
    });
  };
  const stale = send(1);
  try {
    await entered.promise;
    // Match the atomic database effects of an independently committed password change.
    await f.database.query('update users set passwd=$1,session_version=session_version+1 where uuid=$2',
      ['synthetic-after-password-hash', identity.userId]);
  } finally { release.resolve(); }
  const rejected = await stale;
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.has('set-cookie'), false);
  const state = (await f.database.query('select session_version,totp_last_used_step from users where uuid=$1', [identity.userId])).rows[0];
  assert.equal(state.session_version, 2);
  assert.equal(Number(state.totp_last_used_step), -1, 'revoked operation must not spend the factor');
  assert.equal((await f.database.query('select count(*)::int as count from cfm_internal.mfa_factor_receipts')).rows[0].count, 0);
  assert.equal((await send(2)).status, 200, 'the same unconsumed factor remains usable by a current operation');
});
