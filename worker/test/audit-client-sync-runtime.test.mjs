import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { encryptBackup } from '../src/utils/backup.ts';
import { generateAgentToken, hashAgentToken } from '../src/utils/client.ts';
import { createRuntimeFixture, eventually, runtimeSecrets } from '../test-support/runtime-fixture.mjs';
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

test('W02: native sockets keep identity across report attachments and enforce revocation', { timeout: 90000 }, async t => {
  const f = await setup(t);
  const namespace = await f.mf.getDurableObjectNamespace('LIVE_DATA');
  const stub = namespace.get(namespace.idFromName('global'));
  const live = async () => (await stub.fetch('https://do/live')).json();
  const upgrade = current => f.fetch('/api/clients/report', {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${current}` },
  });
  async function open(child, current) {
    const response = await upgrade(current);
    assert.equal(response.status, 101, 'a current identity must establish the native socket');
    const connection = { ws: response.webSocket, acknowledged: 0, errors: 0, closeCode: null };
    connection.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.type === 'ack') connection.acknowledged += 1;
      if (message.type === 'error') connection.errors += 1;
    });
    connection.ws.addEventListener('close', event => { connection.closeCode = event.code; });
    connection.ws.accept();
    child.after(() => { try { connection.ws.close(); } catch {} });
    return connection;
  }
  async function report(connection, uuid, cpu) {
    const expected = connection.acknowledged + 1;
    connection.ws.send(JSON.stringify({ type: 'report', data: { cpu, timestamp: Date.now() } }));
    await eventually(() => connection.acknowledged >= expected || connection.errors > 0 || connection.closeCode !== null);
    assert.equal(connection.closeCode, null, 'saving a valid report must not retire the same connection');
    assert.equal(connection.errors, 0, 'the current connection must keep accepting valid reports');
    assert.equal(connection.acknowledged, expected);
    const snapshot = await live();
    assert.ok(snapshot.online.includes(uuid));
    assert.equal(snapshot.data[uuid].cpu, cpu);
  }

  for (const scenario of ['consecutive reports', 'metadata then report', 'rotation and deletion']) {
    await t.test(scenario, async child => {
      const uuid = `socket-${scenario.replaceAll(' ', '-')}`;
      const current = generateAgentToken();
      await f.database.query('insert into clients(uuid,name,token_hash) values($1,$2,$3)',
        [uuid, 'Synthetic socket', await hashAgentToken(current)]);
      assert.equal((await f.admin(`/clients/${uuid}/edit`, { name: 'Confirmed socket' })).status, 200);
      const connection = await open(child, current);
      await report(connection, uuid, 11);
      if (scenario === 'consecutive reports') {
        await report(connection, uuid, 12);
        await report(connection, uuid, 13);
      } else if (scenario === 'metadata then report') {
        assert.equal((await f.admin(`/clients/${uuid}/edit`, { name: 'Updated socket metadata' })).status, 200);
        await report(connection, uuid, 14);
        await report(connection, uuid, 15);
      } else {
        const rotated = await f.admin(`/clients/${uuid}/token/rotate`, {});
        assert.equal(rotated.status, 200);
        const replacement = (await rotated.json()).token;
        await eventually(() => connection.closeCode !== null);
        assert.equal(connection.closeCode, 1008, 'rotation must still retire the old native socket');
        assert.equal((await upgrade(current)).status, 401);
        const next = await open(child, replacement);
        await report(next, uuid, 16);
        assert.equal((await f.admin(`/clients/${uuid}/remove`, {})).status, 200);
        await eventually(() => next.closeCode !== null);
        assert.equal(next.closeCode, 1008, 'deletion must still retire the native socket');
        assert.equal((await upgrade(replacement)).status, 401);
        assert.ok(!(await live()).online.includes(uuid));
      }
    });
  }
});
