import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../../test-support/worker-module.mjs';

const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' };
const database = { provider: 'supabase-api', env };

function application(sql) {
  return createWorkerLoader({ db: null, globals: { fetch: async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, env.SUPABASE_URL);
    return Response.json(await rpc(sql, parsed.pathname.split('/').at(-1), JSON.parse(init.body)));
  } } }).load('worker/src/db/queries.ts');
}

async function seed(sql, ids) {
  await sql.exec('set role service_role');
  for (const [index, id] of ids.entries()) {
    await sql.query("insert into ping_tasks(id,name,type,target,sort_order) values ($1,$2,'icmp','example.com',$3)",
      [id, `Synthetic task ${id}`, index + 1]);
  }
}

const cases = [
  { name: 'full reverse order', before: [1, 2, 3, 4, 5], input: [5, 4, 3, 2, 1], after: [5, 4, 3, 2, 1] },
  { name: 'interleaved order including a bigint ID', before: [1, 2, 2147483648, 4, 5], input: [2147483648, 1, 5, 2, 4], after: [2147483648, 1, 5, 2, 4] },
  { name: 'partial order appends unmentioned tasks in their existing order', before: [5, 1, 4, 2, 3], input: [2, 5], after: [2, 5, 1, 4, 3] },
  { name: 'duplicate IDs keep their first requested position', before: [1, 2, 3, 4, 5], input: [5, 3, 5, 1, 3], after: [5, 3, 1, 2, 4] },
  { name: 'an unchanged request performs no writes', before: [5, 3, 1, 2, 4], input: [5, 3, 1, 2, 4], after: [5, 3, 1, 2, 4] },
];

for (const scenario of cases) {
  test(`D05 ${scenario.name} survives a fresh database read`, async () => {
    const sql = await createTestDatabase();
    try {
      await seed(sql, scenario.before);
      const app = application(sql);
      const changed = await app.reorderPingTasks(database, scenario.input);
      const persisted = await app.listPingTasks(database, true);
      assert.deepEqual(persisted.map(row => row.id), scenario.after,
        'persisted sort_order must preserve the requested JSON array order');
      assert.deepEqual(persisted.map(row => row.sort_order), [1, 2, 3, 4, 5]);
      assert.equal(changed, scenario.after.filter((id, index) => scenario.before[index] !== id).length);
    } finally { await sql.close(); }
  });
}

test('D05 invalid references reject atomically and an empty request preserves existing order', async () => {
  const sql = await createTestDatabase();
  try {
    await seed(sql, [5, 1, 4, 2, 3]);
    const app = application(sql);
    await assert.rejects(app.reorderPingTasks(database, [3, 99, 5]), /does not exist/);
    assert.deepEqual((await app.listPingTasks(database, true)).map(row => row.id), [5, 1, 4, 2, 3]);
    assert.equal(await app.reorderPingTasks(database, []), 0);
    assert.deepEqual((await app.listPingTasks(database, true)).map(row => row.id), [5, 1, 4, 2, 3]);
  } finally { await sql.close(); }
});
