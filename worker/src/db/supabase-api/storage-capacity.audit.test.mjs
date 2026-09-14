import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const MiB = 1024 * 1024;
const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const theme = short => ({ short, name: `Synthetic ${short}`, style_path: 'style.css', manifest_json: '{}', config_json: '{}', custom_css: '' });
const asset = bytes => ({ path: 'style.css', content_type: 'text/css', content_base64: 'A'.repeat(bytes), size_bytes: 1 });

function application(sql) {
  return createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, env.SUPABASE_URL);
    try { return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)) ?? null); }
    catch (error) { return Response.json({ code: error.code, message: error.message }, { status: 400 }); }
  } } }).load('worker/src/db/queries.ts');
}

async function setSetting(sql, key, value) {
  await sql.query('insert into settings(key,value) values ($1,$2) on conflict(key) do update set value=excluded.value', [key, String(value)]);
}

async function readDiagnostics(sql, force = false) {
  const app = application(sql);
  if (typeof app.getDatabaseStorageDiagnostics === 'function') return app.getDatabaseStorageDiagnostics(database, force);
  // Exercise the released measurement before the broader diagnostic exists.
  // The RED assertion is the real website/theme omission, not a missing RPC.
  const released = await app.getHistoryStorageBytes(database);
  return { database_allocated_bytes: released.total, theme_payload_bytes: 0,
    tables: Object.fromEntries(Object.entries(released).filter(([key]) => key !== 'total').map(([key, allocated_bytes]) => [key, { allocated_bytes }])) };
}

test('D06 real website and theme growth appears in whole-database allocation diagnostics', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    const before = await readDiagnostics(sql, true);
    await sql.exec(`
      insert into website_monitors(id,name,url) values (1,'Synthetic website','https://example.com');
      insert into website_checks(monitor_id,checked_at,ok,effective_status)
        select 1,now() - n * interval '1 second',true,'up' from generate_series(1,10000) n;
    `);
    const app = application(sql);
    await app.upsertTheme(database, theme('sample'), [asset(256 * 1024)]);
    const after = await readDiagnostics(sql, true);
    assert.ok(after.tables.website_checks?.allocated_bytes > 0, 'website allocation must no longer be invisible');
    assert.ok(after.tables.theme_assets?.allocated_bytes > 0, 'theme assets must be included');
    assert.ok(after.tables.themes?.allocated_bytes > 0);
    assert.ok(after.tables.audit_logs?.allocated_bytes >= 0);
    assert.ok(after.database_allocated_bytes > before.database_allocated_bytes);
    assert.ok(after.database_allocated_bytes >= after.application_allocated_bytes);
    assert.equal(after.other_allocated_bytes, after.database_allocated_bytes - after.application_allocated_bytes);
    assert.ok(after.theme_payload_bytes >= 256 * 1024, 'encoded text counts even when declared size_bytes is one');
    assert.equal(after.theme_count, 1);
    assert.equal(after.theme_asset_count, 1);
    assert.equal(after.measurement, 'database-allocation');
    assert.equal((await app.getHistoryStorageUsage(database)).live_rows, 0,
      'whole-database diagnostics preserve the established recoverable history budget');
  } finally { await sql.close(); }
});

test('D06 expensive allocation diagnostics are cached for ten minutes with explicit refresh', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    const before = await readDiagnostics(sql, true);
    assert.equal(before.cache_seconds, 600, 'allocation diagnostics must have a low-frequency cache');
    await sql.exec(`
      insert into website_monitors(id,name,url) values (1,'Synthetic website','https://example.com');
      insert into website_checks(monitor_id,checked_at,ok,effective_status)
        select 1,now() - n * interval '1 second',true,'up' from generate_series(1,10000) n;
    `);
    const cached = await readDiagnostics(sql);
    assert.equal(cached.measured_at, before.measured_at);
    assert.equal(cached.tables.website_checks.allocated_bytes, before.tables.website_checks.allocated_bytes);
    const fresh = await readDiagnostics(sql, true);
    assert.ok(fresh.tables.website_checks.allocated_bytes > before.tables.website_checks.allocated_bytes);
    await sql.exec("update cfm_internal.storage_diagnostics_cache set checked_at=now()-interval '11 minutes'");
    const expired = await readDiagnostics(sql);
    assert.notEqual(expired.measured_at, fresh.measured_at, 'expired snapshots are measured again');
  } finally { await sql.close(); }
});

test('D06 cached measured usage warns at 85 and 95 percent for free and larger configured budgets', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    const initial = await readDiagnostics(sql, true);
    assert.equal(initial.status, 'ok', 'a new small database should expose its budget status');
    for (const [budget, used, expected] of [
      [500 * MiB, 424 * MiB, 'ok'], [500 * MiB, 425 * MiB, 'warning'], [500 * MiB, 475 * MiB, 'critical'],
      [8 * 1024 * MiB, 475 * MiB, 'ok'], [8 * 1024 * MiB, 7 * 1024 * MiB, 'warning'], [8 * 1024 * MiB, 8 * 1024 * MiB, 'critical'],
    ]) {
      await setSetting(sql, 'database_storage_budget_bytes', budget);
      // The diagnostic boundary is seeded with a synthetic measured allocation;
      // the real SQL threshold logic runs without allocating gigabytes in CI.
      await sql.query("update cfm_internal.storage_diagnostics_cache set snapshot=jsonb_set(snapshot,'{database_allocated_bytes}',to_jsonb($1::bigint))", [used]);
      const result = await readDiagnostics(sql);
      assert.equal(result.budget_bytes, budget);
      assert.equal(result.status, expected);
      assert.equal(result.measured_at, initial.measured_at, 'a budget change reclassifies the cached measurement immediately');
    }
  } finally { await sql.close(); }
});

test('D06 accumulated theme content is bounded atomically and cannot trust asset size hints', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await setSetting(sql, 'theme_storage_quota_bytes', MiB);
    const app = application(sql);
    await app.upsertTheme(database, theme('first'), [asset(600 * 1024)]);
    await assert.rejects(app.upsertTheme(database, theme('second'), [asset(600 * 1024)]), /CFM_THEME_STORAGE_QUOTA_EXCEEDED/,
      'a second individually valid theme must not exceed the combined budget');
    assert.deepEqual((await sql.query('select short from themes order by short')).rows.map(row => row.short), ['first']);
    assert.equal((await sql.query('select count(*)::int as n from theme_assets')).rows[0].n, 1);
    await app.deleteTheme(database, 'first');
    await assert.doesNotReject(app.upsertTheme(database, theme('second'), [asset(600 * 1024)]));
    assert.equal((await readDiagnostics(sql)).theme_count, 1);
  } finally { await sql.close(); }
});

test('D06 an over-budget replacement rolls back and legacy overages can be reduced or deleted', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await setSetting(sql, 'theme_storage_quota_bytes', 2 * MiB);
    const app = application(sql);
    await app.upsertTheme(database, theme('first'), [asset(600 * 1024)]);
    await app.upsertTheme(database, theme('second'), [asset(600 * 1024)]);
    await setSetting(sql, 'theme_storage_quota_bytes', MiB);
    await assert.doesNotReject(app.upsertTheme(database, theme('first'), [asset(500 * 1024)]), 'shrinking an existing overage stays possible');
    await assert.rejects(app.upsertTheme(database, { ...theme('first'), name: 'Must roll back' }, [asset(700 * 1024)]), /CFM_THEME_STORAGE_QUOTA_EXCEEDED/);
    assert.equal((await app.getTheme(database, 'first')).name, 'Synthetic first');
    assert.equal((await sql.query("select octet_length(content_base64) as size from theme_assets where theme_short='first'")).rows[0].size, 500 * 1024);
    await app.deleteTheme(database, 'second');
    await assert.doesNotReject(app.upsertTheme(database, theme('third'), [asset(400 * 1024)]));
    const diagnostics = await readDiagnostics(sql, true);
    assert.ok(diagnostics.theme_payload_bytes < MiB);
    assert.equal(diagnostics.theme_count, 2);
  } finally { await sql.close(); }
});

test('D06 theme settings share the quota and failed growth preserves prior configuration', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await setSetting(sql, 'theme_storage_quota_bytes', MiB);
    const app = application(sql);
    await app.upsertTheme(database, theme('first'), [asset(1010 * 1024)]);
    await assert.rejects(app.updateThemeSettings(database, 'first', '{}', 'x'.repeat(40 * 1024)), /CFM_THEME_STORAGE_QUOTA_EXCEEDED/);
    assert.equal((await app.getTheme(database, 'first')).custom_css, '');
    assert.equal(await app.updateThemeSettings(database, 'first', '{}', 'body{color:red}'), true);
  } finally { await sql.close(); }
});

test('D06 diagnostics and their persistent cache retain least privilege across migration replay', async () => {
  const sql = await createTestDatabase();
  try {
    const initial = await readDiagnostics(sql, true);
    assert.equal(initial.measurement, 'database-allocation');
    await applyApplicationMigrations(sql);
    const roles = (await sql.query(`select
      has_function_privilege('anon','public.cfm_database_storage_diagnostics(boolean)','execute') as anon,
      has_function_privilege('authenticated','public.cfm_database_storage_diagnostics(boolean)','execute') as authenticated,
      has_function_privilege('service_role','public.cfm_database_storage_diagnostics(boolean)','execute') as service,
      (select not prosecdef from pg_proc where oid='public.cfm_database_storage_diagnostics(boolean)'::regprocedure) as invoker,
      (select relrowsecurity and relforcerowsecurity from pg_class where oid='cfm_internal.storage_diagnostics_cache'::regclass) as rls
    `)).rows[0];
    assert.deepEqual(roles, { anon: false, authenticated: false, service: true, invoker: true, rls: true });
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`set role ${role}`);
      await assert.rejects(rpc(sql, 'cfm_database_storage_diagnostics'), /permission denied/);
      await assert.rejects(sql.query('select * from cfm_internal.storage_diagnostics_cache'), /permission denied/);
      await sql.exec('reset role');
    }
    await sql.exec('set role service_role');
    assert.equal((await readDiagnostics(sql)).measured_at, initial.measured_at, 'migration replay preserves valid cached observations');
  } finally { await sql.close(); }
});
