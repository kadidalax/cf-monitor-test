import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../test-support/worker-module.mjs';

const base = Date.parse('2026-09-13T12:00:00Z');
const iso = minute => new Date(base + minute * 60_000).toISOString();
const rule = interval => ({ name: 'Synthetic load rule', metric: 'cpu', threshold: 80, ratio: 0.8,
  clients: ['synthetic-load-node'], interval_min: interval });

async function fixture(t, settings = {}) {
  const sql = await createTestDatabase();
  t.after(() => sql.close());
  await sql.query('insert into clients(uuid,name) values ($1,$2)', ['synthetic-load-node', 'Synthetic load node']);
  await rpc(sql, 'cfm_set_settings', { input_settings: {
    notification_method: 'webhook', webhook_format: 'generic', webhook_url: 'https://notify.example.test/message',
    webhook_retry_count: '1', ...settings,
  } });
  const messages = [];
  const env = { SUPABASE_URL: 'https://database.example.test', SUPABASE_SECRET_KEY: 'sb_secret_synthetic' };
  const loader = createWorkerLoader({ db: null, expose: { 'worker/src/index.ts': ['runLoadCheck'] }, globals: {
    fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
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
      assert.equal(url.hostname, 'notify.example.test', 'all delivery remains synthetic');
      messages.push(JSON.parse(init.body).message);
      return new Response(null, { status: 204 });
    },
  } });
  const pipeline = loader.load('worker/src/index.ts');
  const admin = loader.load('worker/src/routes/admin.ts').adminRoutes;
  return {
    sql, loader, messages,
    request: (path, body) => admin.fetch(new Request(`https://panel.example.test${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env, { waitUntil() {} }),
    async create(interval) {
      await rpc(sql, 'cfm_create_load_notification', { input_item: rule(interval) });
      return (await sql.query('select * from load_notifications order by id desc limit 1')).rows[0];
    },
    async samples(minutes) {
      for (const minute of minutes) await sql.query('insert into records(client,time,cpu) values ($1,$2,99)', ['synthetic-load-node', iso(minute)]);
    },
    async run(minute = 0) { await pipeline.runLoadCheck(pipeline.createScheduledRunContext(env), new Date(iso(minute))); },
  };
}

test('N09 validator rejects a one-minute window under the default two-minute history cadence', () => {
  const validator = createWorkerLoader().load('worker/src/utils/notification.ts').validateLoadNotificationInput;
  const result = validator(rule(1), new Set(['synthetic-load-node']));
  assert.equal(result.ok, false, 'a saveable default rule must have room for at least two samples');
  assert.match(result.errors.join(' '), /4.*分钟/);
  assert.equal(validator(rule(4), new Set(['synthetic-load-node'])).ok, true);
});

test('N09 each actual save route rejects windows below the current persisted sampling policy', async t => {
  const f = await fixture(t, { record_persist_interval_sec: '300' });
  const created = await f.create(15);
  for (const path of ['/notification/load/add', '/notification/load/edit', `/notification/load/${created.id}`]) {
    await t.test(path, async () => {
      const response = await f.request(path, { ...rule(5), id: created.id });
      assert.equal(response.status, 400, '300-second persistence at 120-second reports needs a 12-minute window');
      assert.match(JSON.stringify(await response.json()), /12.*分钟/);
    });
  }
  assert.equal((await rpc(f.sql, 'cfm_load_notifications')).length, 1, 'rejected input must not create a rule');
});

test('N09 policy and list expose the effective window after settings change, including differing active and idle cadence', async t => {
  const f = await fixture(t, { record_persist_interval_sec: '300', live_poll_active_interval_sec: '300', live_poll_idle_interval_sec: '120' });
  await f.create(4);
  const response = await f.request('/notification/load/policy');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { minimum_interval_min: 12, sample_interval_sec: 360, history_enabled: true });
  const list = await (await f.request('/notification/load')).json();
  assert.equal(list[0].interval_min, 4, 'stored user configuration remains available');
  assert.equal(list[0].effective_interval_min, 12, 'the user must see the same window as the scheduler');
});

test('N09 the shortest accepted default window triggers from real two-minute persisted samples', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/notification/load/add', rule(4))).status, 200);
  await f.samples([-2.5, -0.5]);
  await f.run();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /CPU 平均 99.0%/);
});

test('N09 legacy one-minute rules use enough real samples to remain reachable', async t => {
  const f = await fixture(t);
  await f.create(1);
  await f.samples([-2.5, -0.5]);
  await f.run();
  assert.equal(f.messages.length, 1, 'a previously accepted short rule cannot remain silently inactive');
});

test('N09 changing persistence cadence expands an existing rule window and repeat interval', async t => {
  const f = await fixture(t);
  await f.create(4);
  await rpc(f.sql, 'cfm_set_settings', { input_settings: { record_persist_interval_sec: '300' } });
  await f.samples([-6.5, -0.5]);
  await f.run();
  assert.equal(f.messages.length, 1, 'new cadence still supplies two actual samples within the effective window');
  await f.run(5);
  assert.equal(f.messages.length, 1, 'repeat notifications follow the displayed effective interval');
  await f.samples([5.5, 11.5]);
  await f.run(12);
  assert.equal(f.messages.length, 2);
});

test('N09 insufficient data still cannot trigger an alert after window expansion', async t => {
  const f = await fixture(t);
  await f.create(1);
  await f.samples([-0.5]);
  await f.run();
  assert.equal(f.messages.length, 0);
});

test('N09 disabled history pauses load evaluation instead of repeatedly using old samples', async t => {
  const f = await fixture(t, { record_enabled: 'false' });
  await f.create(15);
  await f.samples([-2.5, -0.5]);
  await f.run();
  assert.equal(f.messages.length, 0);
});
