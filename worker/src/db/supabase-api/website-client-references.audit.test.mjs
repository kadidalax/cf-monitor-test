import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const placeholderHash = suffix => `sha256:${suffix.repeat(64)}`;

async function fixture(run) {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.query("insert into clients(uuid,name,token_hash) values ('node-a','A',$1),('node-b','B',$2)",
      [placeholderHash('a'), placeholderHash('b')]);
    await sql.exec(`insert into website_monitors(id,name,url,agent_probe_mode,agent_probe_clients,agent_probe_status_enabled)
      values (1,'Only removed node','https://a.example.com','selected','["node-a"]',true),
        (2,'Two selected nodes','https://b.example.com','selected','["node-a","node-b"]',true),
        (3,'Unchanged selection','https://c.example.com','selected','["node-b"]',true);`);
    const loader = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, env.SUPABASE_URL);
      return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
    } } });
    const app = { ...loader.load('worker/src/db/queries.ts'), ...loader.load('worker/src/utils/backup-snapshot.ts') };
    const websites = () => rpc(sql, 'cfm_website_monitors');
    await run({ sql, app, websites, before: await websites() });
  } finally { await sql.close(); }
}

function byId(rows, id) { return rows.find(row => row.id === id); }

async function assertClean({ app, websites, before }) {
  const rows = await websites();
  assert.deepEqual(byId(rows, 1).agent_probe_clients, [], 'removed nodes must not remain in website assignments');
  assert.equal(byId(rows, 1).enabled, false, 'a website losing its last selected Agent is paused');
  assert.equal(byId(rows, 1).status, 'paused');
  assert.equal(byId(rows, 1).agent_probe_mode, 'off');
  assert.equal(byId(rows, 1).agent_probe_status_enabled, false);
  assert.deepEqual(byId(rows, 2).agent_probe_clients, ['node-b']);
  assert.equal(byId(rows, 2).enabled, true);
  assert.equal(byId(rows, 2).agent_probe_mode, 'selected');
  assert.notEqual(byId(rows, 1).config_revision, byId(before, 1).config_revision);
  assert.notEqual(byId(rows, 2).config_revision, byId(before, 2).config_revision);
  assert.equal(byId(rows, 3).config_revision, byId(before, 3).config_revision,
    'unaffected websites must retain their probe generation');
  const backup = await app.buildBackupSnapshot(database);
  assert.equal(backup.website_monitors.length, 3, 'configuration remains exportable after normal node removal');
}

test('D03 deleting a selected node atomically repairs website references before any follow-up cleanup', async () => {
  await fixture(async context => {
    await context.app.deleteClients(database, ['node-a']);
    await assertClean(context);
  });
});

test('D03 explicit client-reference pruning also updates websites without refreshing unrelated revisions', async () => {
  await fixture(async context => {
    await context.app.pruneClientReferencesForClients(database, ['node-a']);
    await assertClean(context);
    const revisions = (await context.websites()).map(row => [row.id, row.config_revision]);
    await context.app.pruneClientReferencesForClients(database, ['node-a']);
    assert.deepEqual((await context.websites()).map(row => [row.id, row.config_revision]), revisions,
      'idempotent pruning must not invalidate existing probe work');
  });
});

test('D03 orphan cleanup repairs legacy dangling selections and leaves unaffected websites unchanged', async () => {
  await fixture(async context => {
    await context.sql.exec(`update website_monitors set agent_probe_clients='["missing-node"]' where id=1;
      update website_monitors set agent_probe_clients='["missing-node","node-b"]' where id=2;`);
    context.before = await context.websites();
    await context.app.cleanupOrphanClientData(database);
    await assertClean(context);
  });
});

test('D03 restoring only clients repairs preserved website assignments in the same transaction', async () => {
  await fixture(async context => {
    await context.app.restoreBackupData(database, { version: '2.0.0', clients: [
      { uuid: 'node-b', name: 'B', token_hash: placeholderHash('b') },
    ] });
    await assertClean(context);
  });
});

test('D03 a rejected restore rolls back reference pruning and its website generations', async () => {
  await fixture(async context => {
    await assert.rejects(context.app.restoreBackupData(database, { version: '2.0.0', clients: [
      { uuid: 'node-b', name: 'B', token_hash: placeholderHash('b') },
    ], website_monitors: [{ id: 5, name: 'Invalid', url: 'https://example.com',
      agent_probe_mode: 'selected', agent_probe_clients: ['missing-node'] }] }), /unknown agent/);
    assert.deepEqual(await context.websites(), context.before);
  });
});

test('D03 upgrading an existing database repairs old dangling references and replay leaves valid generations alone', async () => {
  await fixture(async context => {
    await context.sql.exec(`update website_monitors set agent_probe_clients='["missing-node"]' where id=1;
      update website_monitors set agent_probe_clients='["missing-node","node-b"]' where id=2;
      reset role;`);
    context.before = await context.websites();
    await applyApplicationMigrations(context.sql);
    await assertClean(context);
    const revisions = (await context.websites()).map(row => [row.id, row.config_revision]);
    await applyApplicationMigrations(context.sql);
    assert.deepEqual((await context.websites()).map(row => [row.id, row.config_revision]), revisions);
  });
});
