import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };
const start = '2026-09-13T00:00:00Z';
const end = '2026-09-14T00:00:00Z';
const time = '2026-09-13T00:00:00.000001Z';
const older = '9007199254740992';
const newer = '9007199254740993';

for (const kind of ['load', 'gpu', 'ping']) {
  for (const mode of (kind === 'ping' ? ['paged', 'cursor', 'batch'] : ['paged', 'cursor'])) {
    test(`D02 ${kind} ${mode} preserves exact bigint row identities through JSON and continuation`, async () => {
      const sql = await createTestDatabase();
      try {
        await sql.exec("set role service_role; insert into clients(uuid) values ('node')");
        for (const id of [older, newer]) {
          if (kind === 'load') await sql.query("insert into records(id,client,time) values ($1,'node',$2)", [id, time]);
          else if (kind === 'gpu') await sql.query("insert into gpu_snapshots(id,client,time,devices_json) values ($1,'node',$2,'[{\"device_index\":0}]')", [id, time]);
          else await sql.query("insert into ping_snapshots(id,client,time,values_json) values ($1,'node',$2,'{\"7\":20}')", [id, time]);
        }
        const app = createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
          const parsed = new URL(String(url));
          assert.equal(parsed.origin, env.SUPABASE_URL);
          return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
        } } }).load('worker/src/db/queries.ts');
        const next = cursor => kind === 'load' ? app.getRecordsByTimeRangeCursor(database, 'node', start, end, cursor, 1)
          : kind === 'gpu' ? app.getGPURecordsCursor(database, 'node', start, end, cursor, 1)
          : app.getPingRecordsCursor(database, 'node', 7, cursor, 1);
        const batch = mode === 'batch' ? (await app.getPingRecordsForTasks(database, 'node', [7], 1))['7'] : null;
        const first = batch ? { data: batch, has_more: true,
          next_cursor_key: `v1|${batch[0].time}|${batch[0].id}|0` } : mode === 'cursor' ? await next(undefined)
          : kind === 'load' ? await app.getRecordsByTimeRangePaged(database, 'node', start, end, 1, 1)
          : kind === 'gpu' ? await app.getGPURecordsPaged(database, 'node', start, end, 1, 1)
          : await app.getPingRecordsPaged(database, 'node', 7, 1, 1);
        assert.equal(first.data[0].id, newer, 'the JSON identity must not round 2^53+1 down to 2^53');
        assert.equal(first.has_more, true);
        assert.equal(first.next_cursor_key.split('|')[2], newer);
        assert.match(first.next_cursor_key, /\.000001/);
        const last = await next(first.next_cursor_key);
        assert.equal(last.data[0].id, older);
        assert.equal(last.has_more, false);
        assert.equal(new Set([...first.data, ...last.data].map(row => row.id)).size, 2);
      } finally { await sql.close(); }
    });
  }
}
