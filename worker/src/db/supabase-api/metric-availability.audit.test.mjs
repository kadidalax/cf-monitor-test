import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';

const fields = ['cpu', 'ram', 'ram_total', 'swap', 'swap_total', 'net_in', 'net_out', 'net_total_up', 'net_total_down'];
const unavailable = Object.fromEntries(fields.map(field => [field, null]));
const start = '2026-09-14T00:00:00Z', end = '2026-09-14T00:05:00Z';
const windowStats = (sql, metric, clients = ['mixed-node']) => rpc(sql, 'cfm_load_metric_window_stats', {
  input_clients: clients, input_start: start, input_end: end, input_metric: metric, input_threshold: 40,
});

test('AG02 SQL: explicit null remains present in recent and cursor history while legacy defaults stay zero', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.exec("insert into clients(uuid,name) values ('unknown-node','Synthetic'),('zero-node','Synthetic'),('legacy-node','Synthetic')");
    for (const [client, values, expected] of [
      ['unknown-node', unavailable, null],
      ['zero-node', Object.fromEntries(fields.map(field => [field, 0])), 0],
      ['legacy-node', {}, 0],
    ]) {
      await rpc(sql, 'cfm_insert_monitor_record', { input_record: { client, time: start, ...values } });
      const recent = await rpc(sql, 'cfm_recent_records', { input_client: client });
      const cursor = await rpc(sql, 'cfm_records_range_cursor', { input_client: client, input_start: start, input_end: end });
      for (const row of [recent[0], cursor.data[0]]) {
        for (const field of fields) assert.equal(row[field], expected, `${client}.${field}`);
      }
    }
  } finally { await sql.close(); }
});

test('AG02 SQL: unknown CPU, RAM and disk samples cannot dilute load-alert ratios or averages', async t => {
  const sql = await createTestDatabase();
  try {
    await sql.exec("insert into clients(uuid,name) values ('mixed-node','Synthetic'),('unknown-node','Synthetic')");
    for (const row of [
      { client: 'mixed-node', time: start, cpu: 80, ram: 50, ram_total: 100, disk: 80, disk_total: 100 },
      { client: 'mixed-node', time: '2026-09-14T00:01:00Z', cpu: 0, ram: 0, ram_total: 100, disk: 0, disk_total: 100 },
      { client: 'mixed-node', time: '2026-09-14T00:02:00Z', ...unavailable, disk: 0, disk_total: 0 },
      { client: 'unknown-node', time: start, ...unavailable, disk: 0, disk_total: 0 },
    ]) await rpc(sql, 'cfm_insert_monitor_record', { input_record: row });
    for (const [metric, average] of [['cpu', 40], ['ram', 25], ['disk', 40]]) {
      await t.test(metric, async () => {
        assert.deepEqual(await windowStats(sql, metric), [{ client: 'mixed-node', samples: 2, exceeded: 1, avg_value: average }]);
        assert.deepEqual(await windowStats(sql, metric, ['unknown-node']), [], 'an all-unknown window has no valid samples');
      });
    }
  } finally { await sql.close(); }
});

test('AG02 SQL: nullable metric upgrade survives replay without broadening RPC or table access', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec("insert into clients(uuid,name) values ('replay-node','Synthetic')");
    await rpc(sql, 'cfm_insert_monitor_record', { input_record: { client: 'replay-node', time: start, ...unavailable } });
    await applyApplicationMigrations(sql);
    await applyApplicationMigrations(sql);
    const [row] = await rpc(sql, 'cfm_recent_records', { input_client: 'replay-node' });
    for (const field of fields) assert.equal(row[field], null);
    const columns = (await sql.query("select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='records' and column_name = any($1::text[])", [fields])).rows;
    assert.equal(columns.length, fields.length);
    assert.equal(columns.every(column => column.is_nullable === 'YES'), true);
    const permissions = (await sql.query(`select proname,
      has_function_privilege('anon',oid,'execute') as anon,
      has_function_privilege('authenticated',oid,'execute') as authenticated,
      has_function_privilege('service_role',oid,'execute') as service
      from pg_proc where proname in ('cfm_insert_monitor_record','cfm_load_metric_window_stats') order by proname`)).rows;
    assert.equal(permissions.length, 2);
    assert.equal(permissions.every(p => !p.anon && !p.authenticated && p.service), true);
    const table = (await sql.query("select relrowsecurity as rls, has_table_privilege('anon',oid,'select') as anon, has_table_privilege('authenticated',oid,'select') as authenticated from pg_class where oid='public.records'::regclass")).rows[0];
    assert.deepEqual(table, { rls: true, anon: false, authenticated: false });
  } finally { await sql.close(); }
});
