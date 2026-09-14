import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const start = '2026-09-13T00:00:00.000Z';
const end = '2026-09-14T00:00:00.000Z';

function application(sql) {
  const loader = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, env.SUPABASE_URL, 'history tests never access an external database');
    return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
  } } });
  return loader.load('worker/src/db/queries.ts');
}

async function collect(first, next) {
  const rows = [];
  let page = await first();
  const seenCursors = new Set();
  for (let index = 0; index < 20; index++) {
    rows.push(...page.data);
    if (!page.has_more) return rows;
    // Legacy responses are accepted so RED measures lost records, rather than
    // failing just because the additive composite key has not been introduced.
    const cursor = page.next_cursor_key || page.next_cursor || page.data[0]?.time;
    assert.equal(typeof cursor, 'string', 'a truncated page must carry a continuation');
    assert.equal(seenCursors.has(cursor), false, 'continuation must advance without looping');
    seenCursors.add(cursor);
    page = await next(cursor);
  }
  assert.fail('synthetic history must complete within twenty pages');
}

for (const scenario of [
  { devices: 3, snapshots: 200, sameTime: false, pagedFirst: true },
  { devices: 8, snapshots: 151, sameTime: true, pagedFirst: false },
]) {
  test(`D02 ${scenario.devices} GPU history preserves every snapshot/device across 500-row boundaries`, async () => {
    const sql = await createTestDatabase();
    try {
      await sql.exec('set role service_role');
      await sql.exec("insert into clients(uuid,name) values ('gpu-node','Synthetic GPU node')");
      await sql.query(`insert into gpu_snapshots(client,time,devices_json)
        select 'gpu-node',$1::timestamptz + (($2::boolean::int + 1) * (n / ($2::boolean::int + 1))) * interval '1 second',
          (select jsonb_agg(jsonb_build_object('device_index',d,'device_name','GPU '||d,
            'mem_total',1000,'mem_used',n,'utilization',d,'temperature',40) order by d)
           from generate_series(0,$3::integer-1) d)
        from generate_series(1,$4::integer) n`, [start, scenario.sameTime, scenario.devices, scenario.snapshots]);
      const expected = (await sql.query(`select s.id::text||':'||device.ordinality::text as identity
        from gpu_snapshots s cross join lateral jsonb_array_elements(s.devices_json) with ordinality device
        order by identity`)).rows.map(row => row.identity).sort();
      const app = application(sql);
      const rows = await collect(
        () => scenario.pagedFirst
          ? app.getGPURecordsPaged(database, 'gpu-node', start, end, 1, 500)
          : app.getGPURecordsCursor(database, 'gpu-node', start, end, end, 500),
        cursor => app.getGPURecordsCursor(database, 'gpu-node', start, end, cursor, 500),
      );
      const actual = rows.map(row => `${row.id}:${row.device_ordinal ?? row.device_index + 1}`).sort();
      assert.equal(actual.length, scenario.devices * scenario.snapshots, 'all device samples must survive page boundaries');
      assert.equal(new Set(actual).size, actual.length, 'page boundaries must not duplicate samples');
      assert.deepEqual(actual, expected, 'retrieved identities must exactly match the stored snapshot/device set');
    } finally { await sql.close(); }
  });
}

test('D02 GPU array ordinality distinguishes devices even when their declared device index is duplicated', async () => {
  const sql = await createTestDatabase();
  try {
    await sql.exec('set role service_role');
    await sql.exec("insert into clients(uuid,name) values ('gpu-node','Synthetic GPU node')");
    await sql.query(`insert into gpu_snapshots(client,time,devices_json) values ('gpu-node',$1,
      '[{"device_index":0},{"device_index":0},{"device_index":0},{"device_index":0}]')`, [start]);
    const app = application(sql);
    const rows = await collect(() => app.getGPURecordsPaged(database, 'gpu-node', start, end, 1, 2),
      cursor => app.getGPURecordsCursor(database, 'gpu-node', start, end, cursor, 2));
    assert.deepEqual(rows.map(row => row.device_ordinal).sort((a, b) => a - b), [1, 2, 3, 4]);
  } finally { await sql.close(); }
});

for (const kind of ['load', 'ping']) {
  test(`D02 ${kind} history retains distinct rows sharing the same sample timestamp`, async () => {
    const sql = await createTestDatabase();
    try {
      await sql.exec('set role service_role');
      await sql.exec("insert into clients(uuid,name) values ('node-a','Synthetic node')");
      const table = kind === 'load' ? 'records' : 'ping_snapshots';
      if (kind === 'load') {
        await sql.query("insert into records(client,time,cpu,load,temp) select 'node-a',$1,n,null,null from generate_series(1,7) n", [start]);
      } else {
        await sql.query("insert into ping_snapshots(client,time,values_json) select 'node-a',$1,jsonb_build_object('7',n) from generate_series(1,7) n", [start]);
      }
      const expected = (await sql.query(`select id::text as id from ${table} order by id`)).rows.map(row => row.id);
      const app = application(sql);
      const rows = kind === 'load'
        ? await collect(() => app.getRecordsByTimeRangePaged(database, 'node-a', start, end, 1, 3),
          cursor => app.getRecordsByTimeRangeCursor(database, 'node-a', start, end, cursor, 3))
        : await collect(() => app.getPingRecordsPaged(database, 'node-a', 7, 1, 3),
          cursor => app.getPingRecordsCursor(database, 'node-a', 7, cursor, 3));
      assert.deepEqual(rows.map(row => String(row.id)).sort((a, b) => Number(a) - Number(b)), expected,
        'time alone cannot identify a unique continuation row');
      if (kind === 'load') assert.equal(rows.every(row => row.load === null && row.temp === null), true,
        'nullable metrics must survive the new pagination projection');
    } finally { await sql.close(); }
  });
}
