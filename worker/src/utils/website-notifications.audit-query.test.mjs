import assert from 'node:assert/strict';
import test from 'node:test';
import { applyApplicationMigrations, createTestDatabase, rpc } from '../../../scripts/test-support/postgres.mjs';

test('N08 notification RPC filters current eligible state, clamps batches and wraps a bigint cursor', async t => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  await database.exec(`insert into website_monitors(id,name,url,status,last_notified_at,agent_probe_mode,agent_probe_status_enabled,grace_period_sec)
    select 3000000000+n,'Synthetic site '||n,'https://site.example.test','up','2026-09-13T11:00:00Z','country_auto',false,30
    from generate_series(1,54) n;
    update website_monitors set enabled=false where id=3000000001;
    update website_monitors set last_notified_at=null where id=3000000002;
    update website_monitors set status='down',down_since='2026-09-13T11:59:50Z',last_notified_at=null where id=3000000003;
    update website_monitors set status='down',down_since='2026-09-13T11:59:00Z',last_notified_at=null where id=3000000004;
    update website_monitors set status='down',down_since=null,last_notified_at=null where id=3000000005;`);
  const args = { input_now: '2026-09-13T12:00:00Z', input_limit: 999, input_after_id: 3000000049 };
  const pending = await rpc(database, 'cfm_pending_website_notifications', args);
  assert.equal(pending.length, 50);
  assert.deepEqual(pending.slice(0, 6).map(row => row.id), [3000000050,3000000051,3000000052,3000000053,3000000054,3000000004]);
  assert.ok(pending.every(row => ![3000000001,3000000002,3000000003,3000000005].includes(row.id)));
  assert.equal((await rpc(database, 'cfm_pending_website_notifications', { ...args, input_limit: 0 })).length, 1);
});

test('N08 notification RPC remains invoker-only and inaccessible to browser roles after migration replay', async t => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  await applyApplicationMigrations(database);
  const signature = 'public.cfm_pending_website_notifications(text,integer,bigint)';
  assert.equal((await database.query('select prosecdef from pg_proc where oid=$1::regprocedure', [signature])).rows[0].prosecdef, false);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const granted = (await database.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, signature])).rows[0].allowed;
    assert.equal(granted, role === 'service_role');
  }
  await database.exec('begin; set local role service_role');
  assert.deepEqual(await rpc(database, 'cfm_pending_website_notifications', { input_now: '2026-09-13T12:00:00Z' }), []);
  await database.exec('rollback');
});
