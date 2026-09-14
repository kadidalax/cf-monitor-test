import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScriptFunctions } from '../../scripts/test-support/typescript.mjs';
import { createDurableState, createWorkerLoader } from '../test-support/worker-module.mjs';

test('W01: scheduled execution retries a persisted client change without an administrator request', async () => {
  const queued = { uuid: 'scheduled-sync-node', revision: '5', client: null };
  let pending = [queued];
  const state = createDurableState();
  const database = {};
  const loader = createWorkerLoader({ db: {
    listPendingClientSyncs: async () => pending,
    acknowledgeClientSync: async (_db, uuid, revision) => {
      assert.equal(uuid, queued.uuid); assert.equal(revision, queued.revision); pending = []; return true;
    },
    acknowledgeClientSyncs: async (_db, changes) => {
      assert.equal(changes.length, 1); assert.equal(changes[0].uuid, queued.uuid);
      assert.equal(changes[0].revision, queued.revision); pending = []; return 1;
    },
    getSettingsByKeys: async () => ({}), listPingTasks: async () => [], listAgentWebsiteProbeTasks: async () => [],
  } });
  const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
  const object = new LiveDataDO(state.state, {});
  const env = { LIVE_DATA: { idFromName: value => value, get: () => ({ fetch: request => object.fetch(request) }) } };
  const { synchronizePendingClientChanges } = loader.load('worker/src/utils/client-sync.ts');
  const { runScheduled } = await loadTypeScriptFunctions(new URL('./index.ts', import.meta.url), ['runScheduled'], {
    ScheduledBudget: class { canStart() { return true; } async complete(callback) { await callback(); } },
    withScheduledBudget: async (_budget, callback) => callback(), createScheduledRunContext: () => ({ database, env }),
    rotateScheduledItems: value => value, runScheduledStep: async (_context, _component, _action, _label, work) => work(),
    runRecordCleanup: async () => {}, runLoadCheck: async () => {}, runOfflineCheck: async () => {},
    runExpiryCheck: async () => {}, runWebsiteMonitorChecks: async () => {}, synchronizePendingClientChanges,
  });
  await runScheduled(env);
  assert.equal(pending.length, 0, 'the real scheduled entry must drain the pending synchronization');
  const snapshot = await (await object.fetch(new Request('https://do/admin-clients-snapshot'))).json();
  assert.ok(snapshot.removed.includes(queued.uuid));
});
