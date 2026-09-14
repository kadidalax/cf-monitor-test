import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const agents = [
  { uuid: 'legacy-agent', token: 'synthetic-agent-legacy-only', legacy: true, hash: false },
  { uuid: 'hashed-agent', token: 'synthetic-agent-hash-only', legacy: false, hash: true },
  { uuid: 'mixed-agent', token: 'synthetic-agent-mixed', legacy: true, hash: true },
];
const hashed = token => `sha256:${createHash('sha256').update(token).digest('hex')}`;

function application(sql) {
  const loader = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, env.SUPABASE_URL, 'only the synthetic local database is allowed');
    assert.equal(init.method, 'POST');
    try {
      return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
    } catch (error) {
      return Response.json({ code: error.code, message: error.message }, { status: 400 });
    }
  } } });
  return {
    ...loader.load('worker/src/utils/backup-snapshot.ts'),
    ...loader.load('worker/src/utils/backup.ts'),
    queries: loader.load('worker/src/db/queries.ts'),
  };
}

async function seed(sql) {
  for (const agent of agents) {
    await sql.query(`insert into clients(uuid,name,token,token_hash) values ($1,$1,$2,$3)`,
      [agent.uuid, agent.legacy ? agent.token : null, agent.hash ? hashed(agent.token) : null]);
  }
}

async function assertAgentsAuthenticate(app, message) {
  for (const agent of agents) {
    assert.equal((await app.queries.getClientByToken(database, agent.token))?.uuid === agent.uuid, true,
      `${message}: ${agent.uuid} must accept its original credential`);
  }
}

async function encryptedRoundTrip(app) {
  const backup = await app.buildBackupSnapshot(database);
  const encrypted = await app.encryptBackup(backup, 'synthetic-backup-passphrase');
  assert.equal(encrypted.ok, true, 'application-produced configuration must encrypt');
  const decrypted = await app.decryptBackup(encrypted.encryptedBackup, 'synthetic-backup-passphrase');
  assert.equal(decrypted.ok, true, 'encrypted configuration must decrypt');
  return decrypted.backup;
}

for (const fresh of [false, true]) {
  test(`D01 encrypted backup preserves Agent authentication after ${fresh ? 'fresh database' : 'in-place'} restore`, async () => {
    const sql = await createTestDatabase();
    let target;
    try {
      await sql.exec('set role service_role');
      await seed(sql);
      const sourceApp = application(sql);
      await assertAgentsAuthenticate(sourceApp, 'before backup');
      const backup = await encryptedRoundTrip(sourceApp);
      if (fresh) {
        target = await createTestDatabase();
        await target.exec('set role service_role');
      }
      const targetApp = fresh ? application(target) : sourceApp;
      await targetApp.queries.restoreBackupData(database, backup);
      await assertAgentsAuthenticate(targetApp, 'after restore');
      const counts = (await (target || sql).query(`select count(*)::int as clients,
        count(*) filter (where coalesce(token,'') <> '' or coalesce(token_hash,'') <> '')::int as authenticated
        from clients`)).rows[0];
      assert.deepEqual(counts, { clients: 3, authenticated: 3 });
    } finally {
      if (target) await target.close();
      await sql.close();
    }
  });
}

test('D01 old masked backup preserves existing credentials while restoring configuration', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await seed(sql);
    const app = application(sql);
    const backup = await app.buildBackupSnapshot(database);
    for (const client of backup.clients) {
      client.token = '';
      client.token_hash = '';
      client.name = 'Restored configuration';
    }
    await app.queries.restoreBackupData(database, backup);
    await assertAgentsAuthenticate(app, 'restored old masked file');
    assert.equal((await sql.query("select count(*)::int as count from clients where name='Restored configuration'"))
      .rows[0].count, 3, 'compatibility still restores the requested metadata');
  } finally { await sql.close(); }
});

test('D01 credential-free new clients are rejected atomically with an actionable reason', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await seed(sql);
    const app = application(sql);
    const before = (await sql.query("select value from settings where key='site_title'" )).rows[0].value;
    const backup = { version: '2.0.0', settings: { site_title: 'Must roll back' },
      clients: [{ uuid: 'missing-credential-agent', name: 'Cannot connect', token: '', token_hash: '' }] };
    await assert.rejects(() => app.queries.restoreBackupData(database, backup),
      /备份.*凭据.*重新|backup.*credential.*(?:export|reset)/i,
      'restoring a masked file into a new database must explain how to recover');
    assert.equal((await sql.query("select value from settings where key='site_title'" )).rows[0].value, before);
    await assertAgentsAuthenticate(app, 'rejected restore leaves existing clients untouched');
  } finally { await sql.close(); }
});

test('D01 backup snapshot is privileged while admin and public lists keep credentials masked after replay', async () => {
  const sql = await createTestDatabase();
  try {
    await seed(sql);
    await applyApplicationMigrations(sql);
    await sql.exec('set role service_role');
    const app = application(sql);
    const backup = await app.buildBackupSnapshot(database);
    assert.equal(backup.clients.every(client => Boolean(client.token || client.token_hash)), true,
      'the backup projection must actually carry restorable authentication material');
    for (const name of ['cfm_admin_clients', 'cfm_public_clients']) {
      const rows = await rpc(sql, name);
      assert.equal(rows.every(row => !row.token && !row.token_hash), true,
        'list projections must not disclose authentication material');
    }
    const access = (await sql.query(`select p.provolatile as volatility,p.prosecdef as definer,
      has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('service_role',p.oid,'execute') as service
      from pg_proc p where p.oid='public.cfm_backup_configuration_snapshot()'::regprocedure`)).rows[0];
    assert.deepEqual(access, { volatility: 's', definer: false, anon: false, authenticated: false, service: true });
  } finally { await sql.close(); }
});
