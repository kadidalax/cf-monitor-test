import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableState, createWorkerLoader } from '../../test-support/worker-module.mjs';

async function fixture() {
  const token = crypto.randomUUID();
  const replacement = crypto.randomUUID();
  const state = createDurableState();
  let current, queryHook;
  const loader = createWorkerLoader({ db: {
    getClientByToken: async (_db, value) => {
      const captured = value === token && current?.token_hash === initial.token_hash ? { ...initial } : null;
      await queryHook?.(); return captured;
    },
    getClientIdentityByToken: async (_db, value) => value === token && current?.token_hash === initial.token_hash ? { ...initial } : null,
    markClientTokenUsed: async () => true, insertAuditLog: async () => {},
    getSettingsByKeys: async () => ({ record_enabled: 'false' }), listPingTasks: async () => [], listAgentWebsiteProbeTasks: async () => [],
  } });
  const { hashAgentToken } = loader.load('worker/src/utils/client.ts');
  const initial = { uuid: 'auth-authority-node', name: 'Synthetic node', token: '', token_hash: await hashAgentToken(token),
    token_rotated_at: '2026-09-13T00:00:00Z', created_at: '2026-09-01T00:00:00Z', hidden: false };
  const rotated = { ...initial, token_hash: await hashAgentToken(replacement), token_rotated_at: '2026-09-13T01:00:00Z' };
  current = initial;
  const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
  const object = new LiveDataDO(state.state, {});
  const env = { LIVE_DATA: { idFromName: value => value, get: () => ({ fetch: request => object.fetch(request) }) } };
  return { token, initial, state, object, env, loader,
    hook: callback => { queryHook = callback; },
    rotate: async () => { current = rotated; return object.fetch(new Request('https://do/client-sync', {
      method: 'POST', body: JSON.stringify({ uuid: initial.uuid, revision: '2', client: rotated }),
    })); },
  };
}

for (const method of ['getAgentClientByToken', 'getAgentClientIdentityByToken']) {
  test(`W02: ${method} revalidates a populated isolate cache after durable credential rotation`, async () => {
    const f = await fixture();
    const authenticate = f.loader.load('worker/src/routes/client.ts')[method];
    assert.ok(await authenticate({}, f.token, f.env, '', task => f.state.state.waitUntil(task)));
    await f.state.drain();
    assert.equal((await f.rotate()).status, 200);
    assert.equal(await authenticate({}, f.token, f.env), null);
  });
}

test('W02: a database lookup begun before rotation cannot authenticate after its delayed result returns', async () => {
  const f = await fixture();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  f.hook(async () => { entered(); await barrier; });
  const authenticate = f.loader.load('worker/src/routes/client.ts').getAgentClientByToken;
  const result = authenticate({}, f.token, f.env, '', task => f.state.state.waitUntil(task));
  await started;
  assert.equal((await f.rotate()).status, 200);
  release();
  assert.equal(await result, null);
  await f.state.drain();
});

test('W02: a delayed HTTP report cannot publish under an already replaced authenticated hash', async () => {
  const f = await fixture();
  await f.rotate();
  const response = await f.object.fetch(new Request('https://do/client-report', { method: 'POST', body: JSON.stringify({
    uuid: f.initial.uuid, name: f.initial.name, hidden: false, auth_hash: f.initial.token_hash, report: { cpu: 9 },
  }) }));
  assert.equal(response.status, 401);
  assert.equal(f.object.buildSnapshot(false).online.length, 0);
  await f.state.drain();
});
