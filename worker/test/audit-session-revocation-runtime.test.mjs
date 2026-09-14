import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { hashPassword } from '../src/auth/password.ts';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';

test('W08: native write authorization rejects another session immediately after SQL revocation', { timeout: 90000 }, async t => {
  const f = await createRuntimeFixture();
  t.after(() => f.close());
  await f.database.query('insert into users(uuid, username, passwd, session_version) values($1,$2,$3,1)',
    ['revocation-owner', 'revocation-owner', 'synthetic-unused-password-hash']);
  const token = await generateToken('revocation-owner', 'revocation-owner', 1, runtimeSecrets);
  const csrf = 'a'.repeat(32);
  const headers = { Cookie: `cf_monitor_session=${token}; cf_monitor_csrf=${csrf}`,
    'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' };
  assert.equal((await f.fetch('/api/admin/account/mfa', { headers })).status, 200);
  await f.database.query('update users set session_version=2 where uuid=$1', ['revocation-owner']);
  const response = await f.fetch('/api/admin/settings', { method: 'POST', headers,
    body: JSON.stringify({ site_title: 'Unauthorized replacement' }) });
  assert.equal(response.status, 401, 'warm edge/read cache must not authorize a revoked session write');
  const rows = (await f.database.query("select value from settings where key='site_title'")).rows;
  assert.notEqual(rows[0]?.value, 'Unauthorized replacement');
});

test('W08: changing a password removes the current edge read-cache entry for the old session', { timeout: 90000 }, async t => {
  const f = await createRuntimeFixture();
  t.after(() => f.close());
  const password = 'synthetic-original-password';
  await f.database.query('insert into users(uuid, username, passwd, session_version) values($1,$2,$3,1)',
    ['password-owner', 'password-owner', await hashPassword(password)]);
  const token = await generateToken('password-owner', 'password-owner', 1, runtimeSecrets);
  const csrf = 'b'.repeat(32);
  const headers = { Cookie: `cf_monitor_session=${token}; cf_monitor_csrf=${csrf}`,
    'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' };
  assert.equal((await f.fetch('/api/admin/account/mfa', { headers })).status, 200);
  const changed = await f.fetch('/api/admin/account/chpasswd', { method: 'POST', headers,
    body: JSON.stringify({ old_password: password, new_password: 'synthetic-new-password-value' }) });
  assert.equal(changed.status, 200);
  assert.equal((await f.fetch('/api/admin/account/mfa', { headers })).status, 401);
});
