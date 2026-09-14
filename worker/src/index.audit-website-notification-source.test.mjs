import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../test-support/worker-module.mjs';

const base = Date.parse('2026-09-13T12:00:00Z');
const iso = offset => new Date(base + offset * 60_000).toISOString();

async function fixture(t, transport = () => true, { slowProbe = false } = {}) {
  const sql = await createTestDatabase();
  t.after(() => sql.close());
  await sql.query('insert into clients(uuid,name) values ($1,$2)', ['synthetic-agent', 'Synthetic agent']);
  await rpc(sql, 'cfm_set_settings', { input_settings: {
    notification_method: 'webhook', webhook_format: 'generic',
    webhook_url: 'https://notify.example.test/message', webhook_retry_count: '1',
  } });
  const messages = [];
  let probes = 0;
  let clock = 0;
  const env = { SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEY: 'sb_secret_synthetic' };
  const loader = createWorkerLoader({ db: null, expose: { 'worker/src/index.ts': ['runWebsiteMonitorChecks'] }, globals: {
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.origin === env.SUPABASE_URL) {
        assert.match(url.pathname, /^\/rest\/v1\/rpc\/cfm_[a-z_]+$/);
        const name = url.pathname.split('/').at(-1);
        const args = JSON.parse(init.body);
        await sql.exec('begin; set local role service_role');
        try {
          const result = name === 'cfm_settings_by_keys'
            ? (await sql.query('select cfm_settings_by_keys($1::text[]) as result', [args.input_keys])).rows[0].result
            : await rpc(sql, name, args);
          await sql.exec('commit');
          return Response.json(result);
        } catch (error) { await sql.exec('rollback'); throw error; }
      }
      if (url.hostname === 'notify.example.test') {
        const message = JSON.parse(init.body).message;
        messages.push(message);
        return new Response(null, { status: await transport(message) ? 204 : 503 });
      }
      assert.equal(url.hostname, 'probe.example.test', 'all external work stays synthetic');
      probes++;
      if (slowProbe) {
        clock = 100_000;
        throw new Error('synthetic probe deadline');
      }
      return new Response(null, { status: 200 });
    },
  } });
  const pipeline = loader.load('worker/src/index.ts');
  const budgets = loader.load('worker/src/utils/scheduled-budget.ts');
  return {
    sql, messages, probes: () => probes,
    async run(minute) {
      const work = async () => {
        const context = pipeline.createScheduledRunContext(env);
        try { await pipeline.runWebsiteMonitorChecks(context, new Date(iso(minute))); }
        finally {
          if (context.budget) await context.budget.complete(() => context.flushScheduledCursors());
          else await context.flushScheduledCursors();
        }
      };
      if (!slowProbe) return work();
      clock = 0;
      const budget = new budgets.ScheduledBudget({ now: () => clock });
      try { await budgets.withScheduledBudget(budget, work); }
      catch (error) { if (!(error instanceof budgets.ScheduledBudgetExceeded)) throw error; }
    },
  };
}

async function monitor(sql, { name = 'Synthetic site', fallback = false, notified = true, mode = 'country_auto' } = {}) {
  const row = await rpc(sql, 'cfm_create_website_monitor', { input_monitor: {
    name, url: 'https://probe.example.test/health', agent_probe_mode: mode,
    agent_probe_status_enabled: fallback, interval_sec: 60, grace_period_sec: 30,
  } });
  if (notified) await sql.query("update website_monitors set status='down',down_since=$2,last_notified_at=$3 where id=$1", [row.id, iso(-10), iso(-8)]);
  return row;
}

async function agentCheck(sql, row, minute, ok) {
  return rpc(sql, 'cfm_record_website_check', { input_check: {
    monitor_id: row.id, config_revision: row.config_revision, checked_at: iso(minute),
    ok, effective_status: ok ? 'up' : 'down', effective_reason: ok ? 'expected_status' : 'network_error',
    status_code: ok ? 200 : null, raw_status_code: ok ? 200 : null, latency_ms: 12,
    error: ok ? null : 'synthetic failure', source_type: 'agent', source_client: 'synthetic-agent',
  } });
}

for (const fallback of [true, false]) {
  test(`N08 Agent recovery is notified while current Agent successes exclude Worker probes (CF fallback=${fallback})`, async t => {
    const f = await fixture(t);
    const row = await monitor(f.sql, { fallback });
    const recovered = await agentCheck(f.sql, row, -0.5, true);
    assert.equal(recovered.status, 'up');
    assert.ok(recovered.last_notified_at);
    assert.deepEqual(await rpc(f.sql, 'cfm_due_website_monitors', { input_now: iso(0), input_limit: 50 }), []);
    await f.run(0);
    assert.equal(f.messages.length, 1, 'a pending recovery must not depend on due probes');
    assert.match(f.messages[0], /网站恢复/);
    assert.equal((await rpc(f.sql, 'cfm_website_monitor', { input_id: row.id })).last_notified_at, null);
    await agentCheck(f.sql, row, 1.5, true);
    await f.run(2);
    assert.equal(f.messages.length, 1, 'continuing Agent successes must not resend a completed recovery');
    assert.equal(f.probes(), 0);
  });
}

test('N08 with CF fallback disabled, Agent down and recovery delivery failures retry their current event', async t => {
  const outcomes = [false, true, false, true];
  const f = await fixture(t, () => outcomes.shift());
  const row = await monitor(f.sql, { notified: false });
  assert.equal((await agentCheck(f.sql, row, -2, false)).status, 'down');
  await f.run(0);
  assert.equal(f.messages.length, 1, 'Agent-only failure must enter delivery');
  assert.equal((await rpc(f.sql, 'cfm_website_monitor', { input_id: row.id })).last_notified_at, null);
  await f.run(2);
  assert.ok((await rpc(f.sql, 'cfm_website_monitor', { input_id: row.id })).last_notified_at);
  await agentCheck(f.sql, row, 3, true);
  await f.run(4);
  assert.ok((await rpc(f.sql, 'cfm_website_monitor', { input_id: row.id })).last_notified_at, 'failed recovery keeps its pending marker');
  await agentCheck(f.sql, row, 5, true);
  await f.run(6);
  await f.run(8);
  assert.equal((await rpc(f.sql, 'cfm_website_monitor', { input_id: row.id })).last_notified_at, null);
  assert.deepEqual(f.messages.map(value => value.includes('网站恢复') ? 'up' : 'down'), ['down', 'down', 'up', 'up']);
  assert.equal(f.probes(), 0);
});

test('N08 pending notification batches rotate beyond the first 50 even when prior deliveries fail', async t => {
  const f = await fixture(t, () => false);
  for (let id = 1; id <= 53; id++) {
    const row = await monitor(f.sql, { name: `Synthetic site ${id}` });
    await agentCheck(f.sql, row, -1, true);
  }
  await f.run(0);
  const firstCount = f.messages.length;
  await f.run(2);
  assert.ok(firstCount > 0 && firstCount <= 50, 'each invocation must use a bounded notification batch');
  assert.ok(f.messages.length - firstCount <= 50);
  const sites = new Set(f.messages.map(value => /节点: ([^\n]+)/.exec(value)?.[1]));
  assert.equal(sites.size, 53, 'persisted cursor must prevent a failing first page from starving later sites');
});

test('N08 slow Worker probes cannot prevent Agent recovery notification on every scheduled round', async t => {
  const f = await fixture(t, () => true, { slowProbe: true });
  const recovered = await monitor(f.sql);
  await agentCheck(f.sql, recovered, -1, true);
  await monitor(f.sql, { name: 'Slow Worker probe', notified: false, mode: 'off' });
  await f.run(0);
  await f.run(2);
  assert.equal(f.messages.filter(value => value.includes('网站恢复')).length, 1,
    'notification and probe phases must get independent opportunities within the shared budget');
  assert.equal((await rpc(f.sql, 'cfm_website_monitor', { input_id: recovered.id })).last_notified_at, null);
});
