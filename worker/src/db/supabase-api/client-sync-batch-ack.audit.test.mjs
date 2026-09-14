import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };

function application(sql) {
  let calls = 0;
  const loader = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    assert.equal(new URL(String(url)).origin, env.SUPABASE_URL);
    calls += 1;
    return Response.json(await rpc(sql, new URL(String(url)).pathname.split('/').at(-1), JSON.parse(init.body)));
  } } });
  return { app: loader.load('worker/src/db/queries.ts'), calls: () => calls };
}

test('W01 bulk acknowledgement uses one RPC and preserves a concurrent newer revision', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.exec("insert into clients(uuid,name) select 'batch-'||n,'Synthetic' from generate_series(1,205) n");
    const { app, calls } = application(sql);
    const pending = await app.listPendingClientSyncs(database, { limit: 200 });
    assert.equal(pending.length, 200);
    await sql.query('update clients set hidden=1 where uuid=$1', [pending[0].uuid]);
    assert.equal(typeof app.acknowledgeClientSyncs, 'function',
      'bulk control synchronization needs a bounded acknowledgement operation');
    const before = calls();
    assert.equal(await app.acknowledgeClientSyncs(database, pending.map(({ uuid, revision }) => ({ uuid, revision }))), 199);
    assert.equal(calls() - before, 1, 'batch size must not turn into one external acknowledgement request per client');
    const remaining = await app.listPendingClientSyncs(database, { limit: 200 });
    assert.equal(remaining.length, 6);
    assert.equal(remaining.some(change => change.uuid === pending[0].uuid && change.client.hidden), true);
    assert.equal(await app.acknowledgeClientSyncs(database, pending.map(({ uuid, revision }) => ({ uuid, revision }))), 0);
    assert.equal(await app.acknowledgeClientSyncs(database, remaining.map(({ uuid, revision }) => ({ uuid, revision }))), 6);
    assert.equal((await app.listPendingClientSyncs(database)).length, 0);
  } finally { await sql.close(); }
});

test('W01 oversized or malformed bulk acknowledgements do not partially delete pending work', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.exec("insert into clients(uuid,name) values ('node-a','Synthetic')");
    const { app } = application(sql);
    const [pending] = await app.listPendingClientSyncs(database);
    assert.equal(typeof app.acknowledgeClientSyncs, 'function', 'the batch operation must be available');
    const item = { uuid: pending.uuid, revision: pending.revision };
    await assert.rejects(app.acknowledgeClientSyncs(database, Array.from({ length: 201 }, () => item)), /200|batch/i);
    assert.equal((await app.listPendingClientSyncs(database)).length, 1);
    await assert.rejects(rpc(sql, 'cfm_acknowledge_client_syncs', { input_changes: [item, { uuid: 'node-b', revision: {} }] }), /revision|batch|invalid/i);
    assert.equal((await app.listPendingClientSyncs(database)).length, 1);
    assert.equal(await app.acknowledgeClientSyncs(database, []), 0);
    assert.equal(await app.acknowledgeClientSyncs(database, [item, item]), 1);
    const grants = (await sql.query(`select
      has_function_privilege('anon','public.cfm_acknowledge_client_syncs(jsonb)','execute') as anon,
      has_function_privilege('authenticated','public.cfm_acknowledge_client_syncs(jsonb)','execute') as authenticated,
      has_function_privilege('service_role','public.cfm_acknowledge_client_syncs(jsonb)','execute') as service`)).rows[0];
    assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
  } finally { await sql.close(); }
});
