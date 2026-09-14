import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { encryptBackup } from '../src/utils/backup.ts';
import { hashAgentToken } from '../src/utils/client.ts';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';
import { rpc } from '../../scripts/test-support/postgres.mjs';

async function setup(t) {
  const f = await createRuntimeFixture({ persistDurableObjects: true });
  t.after(() => f.close());
  await f.database.query('insert into users(uuid,username,passwd,session_version) values($1,$1,$2,1)',
    ['sync-owner', 'synthetic-unused-hash']);
  await rpc(f.database, 'cfm_set_settings', { input_settings: { record_enabled: 'false' } });
  const session = await generateToken('sync-owner', 'sync-owner', 1, runtimeSecrets);
  const csrf = 'c'.repeat(32);
  const headers = { Cookie: `cf_monitor_session=${session}; cf_monitor_csrf=${csrf}`,
    'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' };
  f.admin = (path, body) => f.fetch(`/api/admin${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  f.report = token => f.fetch('/api/clients/report', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' },
    body: JSON.stringify({ cpu: 12, timestamp: Date.now() }) });
  return f;
}

test('W01/W02: restoring the same node changes authority before the successful response', { timeout: 90000 }, async t => {
  const f = await setup(t);
  const oldToken = 'synthetic-old-sync-agent-credential-0000000000000000';
  const newToken = 'synthetic-restored-agent-credential-000000000000000';
  const oldHash = await hashAgentToken(oldToken), newHash = await hashAgentToken(newToken);
  await f.database.query('insert into clients(uuid,name,token_hash) values($1,$2,$3)', ['same-node', 'Synthetic node', oldHash]);
  assert.equal((await f.admin('/clients/same-node/edit', { name: 'Before restore' })).status, 200);
  assert.equal((await f.report(oldToken)).status, 200);
  const encrypted = await encryptBackup({ schema: 'cf-monitor.backup', version: '2.0.0', scope: 'configuration',
    timestamp: new Date().toISOString(), clients: [{ uuid: 'same-node', name: 'Restored', token_hash: newHash }] },
    'synthetic-restore-passphrase');
  assert.equal(encrypted.ok, true);
  const restored = await f.admin('/upload/backup', { backup: encrypted.encryptedBackup,
    backup_password: 'synthetic-restore-passphrase', confirm_restore: true, acknowledge_overwrite: true });
  assert.equal(restored.status, 200);
  assert.equal((await f.report(newToken)).status, 200, 'confirmed restoration must accept the restored credential immediately');
  assert.equal((await f.report(oldToken)).status, 401);
  await f.restart();
  assert.equal((await f.report(newToken)).status, 200);
  assert.equal((await f.report(oldToken)).status, 401);
});

test('W01: a hundred-node batch confirms all rows using bounded external RPCs', { timeout: 90000 }, async t => {
  const f = await setup(t);
  await f.database.exec("insert into clients(uuid,name,token_hash) select 'batch-'||n, 'Synthetic node', encode(sha256(convert_to('synthetic-'||n,'UTF8')),'hex') from generate_series(1,100) n");
  const start = f.rpcCalls.length;
  const response = await f.admin('/clients/batch-hide', { uuids: Array.from({ length: 100 }, (_, n) => `batch-${n + 1}`) });
  assert.equal(response.status, 200);
  const calls = f.rpcCalls.slice(start);
  assert.ok(calls.length < 25, `a bounded batch must leave space for other request work, observed ${calls.length} RPCs`);
  assert.equal((await f.database.query('select count(*)::int as count from cfm_internal.client_sync_queue')).rows[0].count, 0);
  const namespace = await f.mf.getDurableObjectNamespace('LIVE_DATA');
  const snapshot = await (await namespace.get(namespace.idFromName('global')).fetch('https://do/admin-clients-snapshot')).json();
  assert.equal(snapshot.clients.filter(row => row.hidden).length, 100);
});

test('W02: consecutive native rotations and restart reject every superseded credential', { timeout: 90000 }, async t => {
  const f = await setup(t);
  let current = 'synthetic-initial-rotation-agent-000000000000000000';
  await f.database.query('insert into clients(uuid,name,token_hash) values($1,$2,$3)',
    ['rotating-node', 'Synthetic rotating node', await hashAgentToken(current)]);
  assert.equal((await f.report(current)).status, 200);
  const old = [];
  for (let n = 0; n < 3; n++) {
    const response = await f.admin('/clients/rotating-node/token/rotate', {});
    assert.equal(response.status, 200);
    old.push(current); current = (await response.json()).token;
    assert.equal((await f.report(current)).status, 200);
    for (const previous of old) assert.equal((await f.report(previous)).status, 401);
  }
  await f.restart();
  assert.equal((await f.report(current)).status, 200);
  for (const previous of old) assert.equal((await f.report(previous)).status, 401);
});
