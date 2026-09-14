import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';
import { generateToken } from '../src/auth/jwt.ts';
import { rpc } from '../../scripts/test-support/postgres.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function administrator(f) {
  await f.database.query('insert into users(uuid,username,passwd,session_version) values($1,$1,$2,1)',
    ['delete-review-owner', 'synthetic-unused-hash']);
  await rpc(f.database, 'cfm_set_settings', { input_settings: { record_enabled: 'false' } });
  const session = await generateToken('delete-review-owner', 'delete-review-owner', 1, runtimeSecrets);
  const csrf = 'r'.repeat(32);
  const headers = { Cookie: `cf_monitor_session=${session}; cf_monitor_csrf=${csrf}`,
    'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' };
  return (path, body) => f.fetch(`/api/admin${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('W01: a delayed deletion of a missing node cannot revoke a subsequently created identity', { timeout: 90000 }, async t => {
  const deleted = deferred(), release = deferred();
  let armed = true;
  const f = await createRuntimeFixture({ persistDurableObjects: true, rpcHook: async ({ name, phase, result }) => {
    if (armed && name === 'cfm_delete_clients' && phase === 'after' && result.removed === 0) {
      armed = false;
      deleted.resolve();
      await release.promise;
    }
  } });
  t.after(() => f.close());
  const admin = await administrator(f);
  const node = 'recreated-node';
  const token = 'synthetic-recreated-agent-credential-0000000000000000';
  const report = () => f.fetch('/api/clients/report', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' },
    body: JSON.stringify({ cpu: 12, timestamp: Date.now() }) });
  const oldDeletion = admin(`/clients/${node}/remove`, {});
  try {
    await deleted.promise;
    assert.equal((await admin('/clients/add', { uuid: node, name: 'Synthetic recreated node', token })).status, 200);
    assert.equal((await report()).status, 200);
  } finally { release.resolve(); }
  assert.equal((await oldDeletion).status, 404);
  assert.equal((await f.database.query('select count(*)::int as count from clients where uuid=$1', [node])).rows[0].count, 1);
  assert.equal((await f.database.query('select count(*)::int as count from cfm_internal.client_sync_queue')).rows[0].count, 0);
  assert.equal((await report()).status, 200, 'a delayed missing-delete must preserve the newer confirmed identity');
  await f.restart();
  assert.equal((await report()).status, 200);
});

test('W01: deleting a missing SQL node still clears legacy durable remnants', { timeout: 90000 }, async t => {
  const f = await createRuntimeFixture({ persistDurableObjects: true });
  t.after(() => f.close());
  const admin = await administrator(f);
  assert.equal((await admin('/clients/add', { uuid: 'legacy-remnant', name: 'Synthetic legacy node',
    token: 'synthetic-legacy-agent-credential-0000000000000000000' })).status, 200);
  // Model a pre-outbox deployment which deleted only the SQL identity.
  await f.database.exec('alter table clients disable trigger cfm_client_control_sync');
  await f.database.exec("delete from clients where uuid='legacy-remnant'");
  await f.database.exec('alter table clients enable trigger cfm_client_control_sync');
  const namespace = await f.mf.getDurableObjectNamespace('LIVE_DATA');
  const stub = namespace.get(namespace.idFromName('global'));
  const snapshot = async () => (await (await stub.fetch('https://do/admin-clients-snapshot')).json()).clients;
  assert.equal((await snapshot()).some(row => row.uuid === 'legacy-remnant'), true);
  assert.equal((await admin('/clients/legacy-remnant/remove', {})).status, 404);
  assert.equal((await snapshot()).some(row => row.uuid === 'legacy-remnant'), false,
    'missing-node cleanup still removes genuine historical remnants');
  assert.equal((await f.database.query('select count(*)::int as count from cfm_internal.client_sync_queue')).rows[0].count, 0);
});
