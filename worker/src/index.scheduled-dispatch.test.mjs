import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { unstable_readConfig } from 'wrangler';
import { createWorkerLoader } from '../test-support/worker-module.mjs';

test('deployment and development configs declare the same Durable Objects and migrations', async () => {
  const configs = ['../../wrangler.toml', '../wrangler.toml', '../wrangler.example.toml']
    .map(path => unstable_readConfig({ config: fileURLToPath(new URL(path, import.meta.url)) }));
  for (const config of configs.slice(1)) {
    assert.deepEqual(configs[0].durable_objects, config.durable_objects);
    assert.deepEqual(configs[0].migrations, config.migrations);
  }
});

function fixture(run) {
  let localRuns = 0;
  const calls = [];
  const logs = [];
  const loader = createWorkerLoader({
    overrides: {
      'worker/src/utils/scheduled-budget.ts': {
        ScheduledBudget: class {
          constructor() {
            localRuns += 1;
            throw new Error('Maintenance must execute outside the entry Worker CPU budget');
          }
        },
      },
    },
    globals: { console: { ...console, error: (...args) => logs.push(args) } },
  });
  const worker = loader.load('worker/src/index.ts').default;
  const health = loader.load('worker/src/utils/scheduled-observability.ts');
  const env = {
    SCHEDULED_TASKS: {
      getByName(name) {
        calls.push(name);
        return { runScheduled: run };
      },
    },
  };
  return { worker, env, calls, logs, health, localRuns: () => localRuns };
}

test('Scheduled dispatch awaits the Durable Object without running maintenance in the entry Worker', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(() => gate);
  let finished = false;
  const pending = f.worker.scheduled({}, f.env, {}).then(() => { finished = true; });
  try {
    await setImmediate();
    assert.deepEqual(f.calls, ['maintenance']);
    assert.equal(f.localRuns(), 0);
    assert.equal(finished, false, 'the invocation must remain alive until maintenance finishes');
  } finally {
    release();
    await pending;
  }
  assert.equal(f.logs.length, 0);
});

test('Scheduled RPC failure retains failure reporting and never falls back to local maintenance', async () => {
  const f = fixture(async () => { throw new Error('synthetic maintenance service unavailable'); });
  await f.worker.scheduled({}, f.env, {});
  assert.deepEqual(f.calls, ['maintenance']);
  assert.equal(f.localRuns(), 0);
  assert.equal(f.logs.length, 1);
  const health = f.health.readScheduledDatabaseStartupHealth(new Date().toISOString());
  assert.equal(health.status, 'error');
  assert.match(health.detail, /synthetic maintenance service unavailable/);
});

test('a successful Scheduled RPC clears an earlier invocation failure', async () => {
  const f = fixture(async () => {});
  f.health.recordScheduledDatabaseStartupFailure(new Error('synthetic earlier failure'));
  await f.worker.scheduled({}, f.env, {});
  assert.deepEqual(f.calls, ['maintenance']);
  assert.equal(f.localRuns(), 0);
  assert.equal(f.health.readScheduledDatabaseStartupHealth(new Date().toISOString()).status, 'disabled');
});
