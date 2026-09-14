import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { hashAgentToken } from '../src/utils/client.ts';
import { encryptBackup } from '../src/utils/backup.ts';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';
import { rpc } from '../../scripts/test-support/postgres.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function administrator(f) {
  await f.database.query('insert into users(uuid,username,passwd,session_version) values($1,$1,$2,1)',
    ['independent-review-owner', 'synthetic-unused-hash']);
  await rpc(f.database, 'cfm_set_settings', { input_settings: {
    record_enabled: 'false', maintenance_last_cleanup_at: new Date().toISOString(),
  } });
  const session = await generateToken('independent-review-owner', 'independent-review-owner', 1, runtimeSecrets);
  const csrf = 'q'.repeat(32);
  const headers = { Cookie: `cf_monitor_session=${session}; cf_monitor_csrf=${csrf}`,
    'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' };
  return (path, body) => f.fetch(`/api/admin${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function report(f, token) {
  return f.fetch('/api/clients/report', { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1',
  }, body: JSON.stringify({ cpu: 19, timestamp: Date.now() }) });
}

async function backupFor(client) {
  const password = 'synthetic-independent-backup-passphrase';
  const encrypted = await encryptBackup({ schema: 'cf-monitor.backup', version: '2.0.0', scope: 'configuration',
    timestamp: new Date().toISOString(), clients: [client] }, password);
  assert.equal(encrypted.ok, true);
  return { backup: encrypted.encryptedBackup, backup_password: password,
    confirm_restore: true, acknowledge_overwrite: true };
}

async function durableSnapshot(f, path = '/admin-clients-snapshot') {
  const namespace = await f.mf.getDurableObjectNamespace('LIVE_DATA');
  return (await namespace.get(namespace.idFromName('global')).fetch(`https://do${path}`)).json();
}

async function pendingCount(f) {
  return (await f.database.query('select count(*)::int as count from cfm_internal.client_sync_queue')).rows[0].count;
}

test('independent W01/W02: Cron may consume restoration outbox before whole-snapshot reset', { timeout: 90000 }, async t => {
  const committed = deferred(), release = deferred();
  let armed = false;
  const f = await createRuntimeFixture({ persistDurableObjects: true, triggerScheduled: true,
    rpcHook: async ({ name, phase }) => {
      if (armed && name === 'cfm_restore_backup_data' && phase === 'after') {
        armed = false; committed.resolve(); await release.promise;
      }
    },
  });
  t.after(async () => { release.resolve(); await f.close(); });
  const admin = await administrator(f);
  const oldToken = 'synthetic-review-before-restore-000000000000000000000';
  const newToken = 'synthetic-review-after-restore-0000000000000000000000';
  assert.equal((await admin('/clients/add', { uuid: 'review-restored', name: 'Before', token: oldToken })).status, 200);
  assert.equal((await report(f, oldToken)).status, 200);
  const backup = await backupFor({ uuid: 'review-restored', name: 'After', hidden: true, token_hash: await hashAgentToken(newToken) });
  armed = true;
  const restoring = admin('/upload/backup', backup);
  try {
    await committed.promise;
    assert.ok(await pendingCount(f) > 0);
    assert.equal((await f.fetch('/cdn-cgi/handler/scheduled?cron=*%2F2+*+*+*+*')).status, 200);
    assert.equal(await pendingCount(f), 0, 'the real Cron must consume the restore revision before the reset');
  } finally { release.resolve(); }
  assert.equal((await restoring).status, 200);
  assert.equal((await report(f, newToken)).status, 200);
  assert.equal((await report(f, oldToken)).status, 401);
  assert.equal((await durableSnapshot(f)).clients.find(row => row.uuid === 'review-restored').hidden, true);
  await f.restart();
  assert.equal((await report(f, newToken)).status, 200);
  assert.equal((await report(f, oldToken)).status, 401);
  assert.equal((await durableSnapshot(f)).clients.find(row => row.uuid === 'review-restored').hidden, true);
});

test('independent W01: delayed restoration snapshot must preserve a later confirmed hide', { timeout: 90000 }, async t => {
  const read = deferred(), release = deferred();
  let armed = false;
  const f = await createRuntimeFixture({ persistDurableObjects: true,
    rpcHook: async ({ name, phase }) => {
      if (armed && name === 'cfm_admin_clients' && phase === 'after') {
        armed = false; read.resolve(); await release.promise;
      }
    },
  });
  t.after(async () => { release.resolve(); await f.close(); });
  const admin = await administrator(f);
  const token = 'synthetic-review-restoration-race-0000000000000000000';
  assert.equal((await admin('/clients/add', { uuid: 'review-hidden', name: 'Before', token })).status, 200);
  const backup = await backupFor({ uuid: 'review-hidden', name: 'Restored visible node', hidden: false,
    token_hash: await hashAgentToken(token) });
  armed = true;
  const restoring = admin('/upload/backup', backup);
  try {
    await read.promise;
    assert.equal((await admin('/clients/review-hidden/edit', { hidden: true })).status, 200);
    assert.equal((await durableSnapshot(f)).clients.find(row => row.uuid === 'review-hidden').hidden, true);
    assert.equal(await pendingCount(f), 0, 'the newer hide has already been durably confirmed');
  } finally { release.resolve(); }
  assert.equal((await restoring).status, 200);
  assert.equal(Boolean((await f.database.query('select hidden from clients where uuid=$1', ['review-hidden'])).rows[0].hidden), true);
  assert.equal((await report(f, token)).status, 200);
  const publicSnapshot = await durableSnapshot(f, '/live');
  assert.equal(publicSnapshot.clients.some(row => row.uuid === 'review-hidden'), false,
    'a restored snapshot read before a confirmed hide must not publish the hidden node');
  await f.restart();
  assert.equal((await durableSnapshot(f, '/live')).clients.some(row => row.uuid === 'review-hidden'), false);
});
