import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const highId = 2_147_483_648;
const maxId = Number.MAX_SAFE_INTEGER;
const fields = {
  website_monitors: { name: 'Synthetic website', url: 'https://example.com/', agent_probe_mode: 'off' },
  ping_tasks: { name: 'Synthetic Ping', type: 'icmp', target: 'example.com', all_clients: true },
  load_notifications: { name: 'Synthetic load', clients: [], metric: 'cpu', threshold: 80, ratio: 0.8, interval_min: 15 },
};

function application(sql) {
  const loader = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, env.SUPABASE_URL);
    return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
  } } });
  return { ...loader.load('worker/src/db/queries.ts'), ...loader.load('worker/src/utils/backup.ts') };
}

function backup(id) {
  return { version: '2.0.0', ...Object.fromEntries(Object.entries(fields).map(([module, row]) => [module, [{ id, ...row }]])) };
}

for (const id of [highId, maxId]) {
  test(`D04 restored safe ID ${id} remains usable by website, Ping and load CRUD`, async () => {
    const sql = await createTestDatabase();
    try {
      await sql.exec('set role service_role');
      const app = application(sql);
      const checked = app.validateBackup(backup(id));
      assert.equal(checked.ok, true);
      await app.restoreBackupData(database, checked.backup);
      let website;
      await assert.doesNotReject(async () => { website = await app.getWebsiteMonitor(database, id); },
        'an accepted/restored ID must fit the daily website RPC');
      assert.equal(website.id, id);
      assert.equal((await app.getPingTask(database, id)).id, id);
      assert.equal((await app.getLoadNotification(database, id)).id, id);
      assert.equal(await app.updateWebsiteMonitor(database, id, { name: 'Changed website' }), true);
      assert.equal((await app.updatePingTaskAndReturn(database, id, { name: 'Changed Ping' })).id, id);
      assert.equal(await app.updateLoadNotification(database, id, { name: 'Changed load' }), true);
      await app.reorderWebsiteMonitors(database, [id]);
      await app.reorderPingTasks(database, [id]);
      await app.setWebsiteMonitorVisibility(database, id, true);
      await app.setWebsiteMonitorEnabled(database, id, false);
      assert.equal((await app.getWebsiteMonitor(database, id)).enabled, false);
      await app.deleteWebsiteMonitor(database, id);
      await app.deletePingTask(database, id);
      await app.deleteLoadNotification(database, id);
      for (const module of Object.keys(fields)) {
        assert.equal((await sql.query(`select count(*)::int as count from ${module}`)).rows[0].count, 0);
      }
    } finally { await sql.close(); }
  });
}

test('D04 restored large website/task IDs work in probe persistence and history RPCs', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.exec("insert into clients(uuid,name) values ('probe-node','Synthetic node')");
    const app = application(sql);
    await app.restoreBackupData(database, app.validateBackup(backup(highId)).backup);
    const revision = (await sql.query('select config_revision from website_monitors where id=$1', [highId])).rows[0].config_revision;
    await assert.doesNotReject(() => rpc(sql, 'cfm_record_website_check', { input_check: {
      monitor_id: highId, config_revision: revision, checked_at: '2026-09-13T00:00:00Z',
      ok: true, status_code: 200, latency_ms: 20, source_type: 'worker',
    } }), 'website result JSON must not narrow its monitor ID to integer');
    assert.equal((await rpc(sql, 'cfm_website_checks', { input_monitor_id: highId })).length, 1);
    await sql.query("insert into ping_snapshots(client,time,values_json) values ('probe-node',now(),$1)",
      [JSON.stringify({ [highId]: 20 })]);
    assert.equal((await app.getPingRecords(database, 'probe-node', highId, 10)).length, 1);
    assert.equal((await app.getPingRecordsPaged(database, 'probe-node', highId, 1, 10)).data.length, 1);
    assert.equal((await app.getPingRecordsCursor(database, 'probe-node', highId, undefined, 10)).data.length, 1);
    assert.equal((await app.getPingRecordsForTasks(database, 'probe-node', [highId], 10))[String(highId)].length, 1);
  } finally { await sql.close(); }
});

test('D04 raw restore mixes explicit large IDs with generated IDs and supports creation afterward', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await assert.doesNotReject(() => rpc(sql, 'cfm_restore_backup_data', { input_backup: {
      ping_tasks: [{ id: highId, ...fields.ping_tasks }, { ...fields.ping_tasks, name: 'Automatic' }],
    } }), 'an omitted sort order must not cast a large task identity to integer');
    const rows = (await sql.query('select id from ping_tasks order by id')).rows;
    assert.deepEqual(rows.map(row => row.id), [highId, highId + 1]);
    const created = await rpc(sql, 'cfm_create_ping_task', { input_task: fields.ping_tasks });
    assert.equal(created.id, highId + 2);
  } finally { await sql.close(); }
});

test('D04 ID upper bound is enforced by both backup validation and stored identities', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    const app = application(sql);
    assert.equal(app.validateBackup(backup(maxId + 1)).ok, false);
    for (const [module, row] of Object.entries(fields)) {
      await rpc(sql, 'cfm_restore_backup_data', { input_backup: { [module]: [{ ...row, id: maxId, sort_order: 1 }] } });
      const [name, argument] = module === 'website_monitors' ? ['cfm_create_website_monitor', 'input_monitor']
        : module === 'ping_tasks' ? ['cfm_create_ping_task', 'input_task'] : ['cfm_create_load_notification', 'input_item'];
      await assert.rejects(() => rpc(sql, name, { [argument]: { ...row, name: 'Beyond safe range' } }),
        /safe.*id|id.*safe|range|maximum/i,
        'automatic IDs beyond the documented safe integer range must fail before a bad record is stored');
      assert.equal((await sql.query(`select count(*)::int as count from ${module} where id > $1`, [maxId])).rows[0].count, 0);
    }
  } finally { await sql.close(); }
});

test('D04 migration removes integer ID overloads while preserving unrelated functions and effective grants', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec(`create or replace function public.cfm_website_monitor(input_id integer) returns jsonb
      language sql as $$select jsonb_build_object('id',input_id)$$;
      grant execute on function public.cfm_website_monitor(integer) to anon;
      create function public.unrelated_id_lookup(input_id integer) returns integer language sql as $$select input_id$$;
      grant execute on function public.unrelated_id_lookup(integer) to anon;`);
    await applyApplicationMigrations(sql);
    const stale = (await sql.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral unnest(p.proargnames,p.proargtypes::oid[]) argument(name,type)
      where n.nspname='public' and p.proname like 'cfm_%'
        and argument.name in ('input_id','input_task_id','input_monitor_id') and argument.type='integer'::regtype`)).rows;
    assert.deepEqual(stale, [], 'PostgREST must not see an obsolete integer overload for ID arguments');
    const grants = (await sql.query(`select
      has_function_privilege('anon','public.cfm_website_monitor(bigint)','execute') as anon,
      has_function_privilege('authenticated','public.cfm_website_monitor(bigint)','execute') as authenticated,
      has_function_privilege('service_role','public.cfm_website_monitor(bigint)','execute') as service,
      has_function_privilege('anon','public.unrelated_id_lookup(integer)','execute') as unrelated`)).rows[0];
    assert.deepEqual(grants, { anon: false, authenticated: false, service: true, unrelated: true });
    await applyApplicationMigrations(sql);
  } finally { await sql.close(); }
});
