import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const placeholderHash = `sha256:${'f'.repeat(64)}`;

function application(sql) {
  const loader = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, env.SUPABASE_URL);
    return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
  } } });
  return loader.load('worker/src/db/queries.ts');
}

async function ledger(sql) {
  // A missing durable store means the committed mutation has no retry record.
  const present = (await sql.query("select to_regclass('cfm_internal.client_sync_queue') is not null as present"))
    .rows[0].present;
  if (!present) return [];
  return (await sql.query('select uuid,revision::text as revision from cfm_internal.client_sync_queue order by revision')).rows;
}

async function seed(sql, uuid = 'node-a') {
  await rpc(sql, 'cfm_create_client', { input_client: { uuid, name: uuid, token_hash: placeholderHash } });
}

async function pending(sql, options = {}) {
  const app = application(sql);
  assert.equal(typeof app.listPendingClientSyncs, 'function', 'committed changes need a retryable query interface');
  return app.listPendingClientSyncs(database, options);
}

async function ack(sql, change) {
  const app = application(sql);
  return app.acknowledgeClientSync(database, change.uuid, change.revision);
}

test('W01 committed client controls create durable retries while rollback and telemetry do not', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await seed(sql);
    assert.equal((await ledger(sql)).length, 1, 'a committed client insert must leave one durable synchronization event');
    const [created] = await pending(sql);
    assert.equal(created.uuid, 'node-a');
    assert.equal(created.client.hidden, false);
    assert.match(created.revision, /^[1-9][0-9]*$/);
    assert.equal(await ack(sql, created), true);
    await sql.exec("update clients set token_last_used_at=now(),token_last_used_ip='192.0.2.1',cpu_name='Synthetic CPU',updated_at=now() where uuid='node-a'");
    assert.equal((await pending(sql)).length, 0, 'routine Agent metadata must not enqueue control changes');
    await sql.exec("begin; update clients set hidden=1 where uuid='node-a'; rollback;");
    assert.equal((await pending(sql)).length, 0, 'rolled-back controls must not leave a retry');
    await sql.exec("update clients set hidden=1 where uuid='node-a'");
    const [hidden] = await pending(sql);
    assert.equal(hidden.client.hidden, true);
    assert.equal(BigInt(hidden.revision) > BigInt(created.revision), true);
  } finally { await sql.close(); }
});

test('W01 old synchronization ACK cannot remove newer changes, deletions or restored identities', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await seed(sql);
    const [created] = await pending(sql);
    await sql.exec("update clients set name='New control' where uuid='node-a'");
    assert.equal(await ack(sql, created), false, 'old ACK cannot clear the newer event');
    const [changed] = await pending(sql);
    assert.equal(changed.client.name, 'New control');
    await ack(sql, changed);
    await rpc(sql, 'cfm_restore_backup_data', { input_backup: { clients: [{
      uuid: 'node-a', name: 'New control', token_hash: placeholderHash,
    }] } });
    const [restored] = await pending(sql);
    assert.equal(BigInt(restored.revision) > BigInt(changed.revision), true,
      'same-identity restore starts a new synchronization lifecycle');
    await rpc(sql, 'cfm_delete_clients', { input_uuids: ['node-a'] });
    const [deleted] = await pending(sql);
    assert.equal(deleted.uuid, 'node-a');
    assert.equal(deleted.client, null, 'deleted clients need a durable tombstone');
    assert.equal(await ack(sql, restored), false);
    assert.equal(await ack(sql, deleted), true);
    assert.equal((await pending(sql)).length, 0);
  } finally { await sql.close(); }
});

test('W01 missing-client cleanup records a durable version and preserves a later creation', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    assert.equal((await rpc(sql, 'cfm_delete_clients', { input_uuids: ['missing-node'] })).removed, 0);
    const changes = await pending(sql);
    assert.equal(changes.length, 1, 'legacy remnants also require a retryable cleanup intent');
    assert.equal(changes[0].client, null);
    await seed(sql, 'missing-node');
    const [created] = await pending(sql);
    assert.equal(BigInt(created.revision) > BigInt(changes[0].revision), true);
    assert.equal(created.client.uuid, 'missing-node');
    assert.equal(await ack(sql, changes[0]), false, 'an earlier cleanup cannot acknowledge a newly created node');
  } finally { await sql.close(); }
});

test('W02 sync projection never returns a plaintext credential and supports legacy token-only clients', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    const ephemeral = randomBytes(32).toString('hex');
    await sql.query('insert into clients(uuid,token,name) values ($1,$2,$1)', ['legacy-node', ephemeral]);
    const [change] = await pending(sql);
    assert.equal(change.client.token, '');
    assert.equal(change.client.token_hash === `sha256:${createHash('sha256').update(ephemeral).digest('hex')}`, true,
      'legacy identity must reach the DO only as a hash');
    assert.equal(JSON.stringify(change).includes(ephemeral), false);
  } finally { await sql.close(); }
});

test('W01 existing clients are queued on first upgrade only and pending work survives replay with least privileges', async () => {
  const sql = await createTestDatabase({ migrate: false });
  try {
    const core = await readFile(new URL('../../../../supabase/migrations/1_core_schema.sql', import.meta.url), 'utf8');
    await sql.exec(`begin;\n${core}\ncommit;`);
    await sql.query('insert into clients(uuid,name,token_hash) values ($1,$1,$2)', ['existing-node', placeholderHash]);
    await sql.exec('alter default privileges in schema public revoke all on tables from service_role; alter default privileges in schema public revoke all on sequences from service_role;');
    await applyApplicationMigrations(sql);
    const first = await pending(sql);
    assert.equal(first.length, 1, 'upgrade must reconcile pre-existing nodes');
    await applyApplicationMigrations(sql);
    assert.deepEqual(await ledger(sql), first.map(({ uuid, revision }) => ({ uuid, revision })),
      'replaying migrations must not change a pending version');
    await sql.exec('set role service_role');
    await ack(sql, first[0]);
    await sql.exec('reset role');
    await applyApplicationMigrations(sql);
    assert.equal((await pending(sql)).length, 0, 'acknowledged nodes must not be queued on every replay');
    const permissions = (await sql.query(`select relrowsecurity as rls,relforcerowsecurity as forced,
      has_table_privilege('anon',oid,'select') as anon,
      has_table_privilege('authenticated',oid,'select') as authenticated,
      has_table_privilege('service_role',oid,'select') as service
      from pg_class where oid='cfm_internal.client_sync_queue'::regclass`)).rows[0];
    assert.deepEqual(permissions, { rls: true, forced: true, anon: false, authenticated: false, service: true });
    const functions = (await sql.query(`select proname,has_function_privilege('anon',oid,'execute') as anon,
      has_function_privilege('authenticated',oid,'execute') as authenticated,
      has_function_privilege('service_role',oid,'execute') as service
      from pg_proc where proname in ('cfm_pending_client_syncs','cfm_acknowledge_client_sync') order by proname`)).rows;
    assert.equal(functions.length, 2);
    assert.equal(functions.every(row => !row.anon && !row.authenticated && row.service), true);
  } finally { await sql.close(); }
});

test('W01 pending query respects exact node selection, empty selection and bounded batches', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.exec("insert into clients(uuid,name) select 'batch-'||n,'Synthetic node' from generate_series(1,205) n");
    assert.equal((await pending(sql, { limit: 999 })).length, 200);
    assert.equal((await pending(sql, { uuids: [] })).length, 0);
    const selected = await pending(sql, { uuids: ['batch-2', 'batch-1'], limit: 2 });
    assert.deepEqual(selected.map(change => change.uuid).sort(), ['batch-1', 'batch-2']);
  } finally { await sql.close(); }
});
