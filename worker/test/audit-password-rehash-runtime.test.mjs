import assert from 'node:assert/strict';
import test from 'node:test';
import { pbkdf2Sync } from 'node:crypto';
import { createRuntimeFixture, eventually } from '../test-support/runtime-fixture.mjs';

test('SEC01: background password upgrade cannot overwrite a concurrently changed password', { timeout: 90000 }, async t => {
  let entered, release, finished = false;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await createRuntimeFixture({ rpcHook: async ({ name, phase }) => {
    if (['cfm_update_user_password', 'cfm_rehash_user_password'].includes(name)) {
      if (phase === 'before') { entered(); await gate; } else finished = true;
    }
  } });
  t.after(() => { release(); return f.close(); });
  const password = 'synthetic-legacy-passphrase';
  const salt = Buffer.alloc(16, 6);
  const hash = `pbkdf2_sha256$10000$${salt.toString('base64')}$${pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('base64')}`;
  await f.database.query('insert into users(uuid,username,passwd,session_version) values($1,$1,$2,1)', ['rehash-owner', hash]);
  const login = await f.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' },
    body: JSON.stringify({ username: 'rehash-owner', password }) });
  assert.equal(login.status, 200);
  let timeout;
  try {
    await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Rehash boundary not reached')), 10000); })]);
    await f.database.query('update users set passwd=$1,session_version=2 where uuid=$2', ['synthetic-concurrently-replaced-hash', 'rehash-owner']);
    release(); await eventually(() => finished);
    const current = (await f.database.query('select passwd from users where uuid=$1', ['rehash-owner'])).rows[0];
    assert.equal(current.passwd === 'synthetic-concurrently-replaced-hash', true, 'an old login must not replace the newer password');
  } finally { clearTimeout(timeout); release(); }
});
