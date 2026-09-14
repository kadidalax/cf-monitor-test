import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';
import { createTestDatabase, rpc } from '../../../scripts/test-support/postgres.mjs';

const COMPONENT = 'cron_client_sync';
const KEY = `health:${COMPONENT}`;
const NOW = Date.parse('2026-09-14T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = offset => new Date(NOW + offset).toISOString();

async function fixture(t) {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const calls = { reads: 0, writes: 0 };
  const errors = [];
  let readFails = false;
  const settings = async keys => (await database.query(
    'select public.cfm_settings_by_keys($1::text[]) as value', [keys],
  )).rows[0].value;
  const read = async keys => {
    calls.reads += 1;
    if (readFails) throw new Error('synthetic health read failure');
    return settings(keys);
  };
  const db = {
    getSetting: async (_database, key) => (await read([key]))[key] ?? null,
    getSettingsByKeys: async (_database, keys) => read(keys),
    setSetting: async (_database, key, value) => {
      calls.writes += 1;
      await rpc(database, 'cfm_set_settings', { input_settings: { [key]: value } });
    },
  };
  return {
    database, calls, errors,
    failReads(value) { readFails = value; },
    persisted: async () => JSON.parse((await settings([KEY]))[KEY] ?? 'null'),
    instance: () => createWorkerLoader({
      db,
      globals: { console: { ...console, error: () => errors.push(true) } },
    }).load('worker/src/utils/observability.ts'),
    record: (instance, status, offset) => instance.recordHealthEvent(
      database, COMPONENT, status, `synthetic ${status}`, { nowMs: NOW + offset, successThrottleMs: HOUR },
    ),
  };
}

for (const failureSource of ['same instance', 'another instance']) {
  test(`health recovery: success observes an error from ${failureSource} before its success throttle expires`, async t => {
    const f = await fixture(t);
    const original = f.instance();
    const failureWriter = failureSource === 'same instance' ? original : f.instance();
    await f.record(original, 'ok', 0);
    await f.record(failureWriter, 'error', 1000);
    const failed = await original.readHealthEvents(f.database, [COMPONENT]);
    assert.equal(failed[COMPONENT].last_success_at, at(0));
    assert.equal(failed[COMPONENT].last_failure_at, at(1000));
    assert.equal(original.healthComponentsOk(original.markStaleEvents(failed, NOW + 2000)), false);

    const beforeRecovery = { ...f.calls };
    await f.record(original, 'ok', 2000);
    const restored = await f.persisted();
    assert.equal(restored.status, 'ok', 'a confirmed success must replace the persisted error immediately');
    assert.equal(restored.updated_at, at(2000));
    assert.equal(restored.last_success_at, at(2000));
    assert.equal(restored.last_failure_at, at(1000), 'recovery must retain the previous failure time');
    assert.equal(f.calls.reads - beforeRecovery.reads, 1);
    assert.equal(f.calls.writes - beforeRecovery.writes, 1);
    const events = await original.readHealthEvents(f.database, [COMPONENT]);
    assert.equal(original.healthComponentsOk(original.markStaleEvents(events, NOW + 2000)), true);
  });
}

test('health recovery: repeated success still limits persisted writes across instances', async t => {
  const f = await fixture(t);
  const original = f.instance();
  await f.record(original, 'ok', 0);
  const first = await f.persisted();
  await f.record(original, 'ok', 1000);
  await f.record(f.instance(), 'ok', 2000);
  assert.equal(f.calls.writes, 1, 'unchanged successful state must keep its write throttle');
  assert.deepEqual(await f.persisted(), first);

  await f.record(original, 'ok', HOUR);
  assert.equal(f.calls.writes, 2, 'the next success is persisted when the throttle expires');
  assert.equal((await f.persisted()).last_success_at, at(HOUR));
});

test('health recovery: a missing database does not attempt a health read or write', async t => {
  const f = await fixture(t);
  const instance = f.instance();
  await instance.recordHealthEvent(undefined, COMPONENT, 'ok', undefined, { nowMs: NOW, successThrottleMs: HOUR });
  await instance.bestEffortRecordHealthEvent(undefined, COMPONENT, 'error');
  assert.deepEqual(f.calls, { reads: 0, writes: 0 });
  assert.equal(f.errors.length, 0);
  assert.equal(await f.persisted(), null);
});

test('health recovery: read failures preserve the last error and best effort does not claim success', async t => {
  const f = await fixture(t);
  const instance = f.instance();
  await f.record(instance, 'error', 0);
  const failed = await f.persisted();
  f.failReads(true);
  await assert.rejects(f.record(instance, 'ok', 1000), /synthetic health read failure/);
  await assert.doesNotReject(instance.bestEffortRecordHealthEvent(
    f.database, COMPONENT, 'ok', 'synthetic recovery', { nowMs: NOW + 2000, successThrottleMs: HOUR },
  ));
  assert.equal(f.errors.length, 1);
  assert.equal(f.calls.writes, 1, 'a failed read must not overwrite the previous health state');
  assert.deepEqual(await f.persisted(), failed);

  f.failReads(false);
  await f.record(instance, 'ok', 3000);
  assert.equal((await f.persisted()).status, 'ok');
  assert.equal((await f.persisted()).last_failure_at, at(0));
});
