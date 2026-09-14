import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken } from '../src/auth/jwt.ts';
import { createRuntimeFixture, runtimeSecrets } from '../test-support/runtime-fixture.mjs';
import { rpc } from '../../scripts/test-support/postgres.mjs';

test('independent W01: a partially applied batch remains queued and recovers after a cold restart', { timeout: 90000 }, async t => {
  let interrupt = false;
  const f = await createRuntimeFixture({ persistDurableObjects: true, triggerScheduled: true,
    rpcHook: ({ name, phase, result }) => {
      if (interrupt && name === 'cfm_pending_client_syncs' && phase === 'after') {
        interrupt = false;
        assert.equal(result.length, 3);
        // Corrupt only the second boundary payload. The real DO applies item 1,
        // then rejects item 2. No SQL acknowledgement may erase any pending row.
        return Response.json(result.map((row, index) => index === 1
          ? { ...row, client: { ...row.client, uuid: 'synthetic-invalid-batch-identity' } } : row));
      }
    },
  });
  t.after(() => f.close());
  await f.database.query('insert into users(uuid,username,passwd,session_version) values($1,$1,$2,1)',
    ['batch-review-owner', 'synthetic-unused-hash']);
  await rpc(f.database, 'cfm_set_settings', { input_settings: {
    record_enabled: 'false', maintenance_last_cleanup_at: new Date().toISOString(),
  } });
  const session = await generateToken('batch-review-owner', 'batch-review-owner', 1, runtimeSecrets);
  const csrf = 'j'.repeat(32);
  const headers = { Cookie: `cf_monitor_session=${session}; cf_monitor_csrf=${csrf}`,
    'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' };
  const post = (path, body) => f.fetch(`/api/admin${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const uuids = ['batch-review-a', 'batch-review-b', 'batch-review-c'];
  for (const uuid of uuids) assert.equal((await post('/clients/add', {
    uuid, name: 'Synthetic batch node', token: `synthetic-batch-review-credential-${uuid}-000000000000000`,
  })).status, 200);
  const snapshot = async () => {
    const namespace = await f.mf.getDurableObjectNamespace('LIVE_DATA');
    return (await (await namespace.get(namespace.idFromName('global')).fetch('https://do/admin-clients-snapshot')).json()).clients;
  };
  const pending = async () => (await f.database.query('select count(*)::int as count from cfm_internal.client_sync_queue')).rows[0].count;
  interrupt = true;
  const failed = await post('/clients/batch-hide', { uuids });
  assert.equal(failed.status, 503);
  const body = await failed.json();
  assert.equal(body.committed, true);
  assert.equal(body.synchronized, false);
  assert.equal((await snapshot()).filter(row => row.hidden).length, 1, 'the failure actually follows a durable partial application');
  assert.equal(await pending(), 3, 'a partial batch is never acknowledged as complete');
  await f.restart();
  assert.equal((await f.fetch('/cdn-cgi/handler/scheduled?cron=*%2F2+*+*+*+*')).status, 200);
  assert.equal(await pending(), 0);
  assert.equal((await snapshot()).filter(row => row.hidden).length, 3);
});
