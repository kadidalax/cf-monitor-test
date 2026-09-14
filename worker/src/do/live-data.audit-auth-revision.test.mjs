import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableState, createSocket, createWorkerLoader } from '../../test-support/worker-module.mjs';

const initial = { uuid: 'audit-auth-version', name: 'Synthetic fixture', hidden: false, token: '',
  token_hash: 'synthetic-old-digest', token_rotated_at: '2026-09-13T00:00:00Z', updated_at: '2026-09-13T00:00:00Z' };
const rotated = { ...initial, token_hash: 'synthetic-current-digest', token_rotated_at: '2026-09-13T01:00:00Z', updated_at: '2026-09-13T01:00:00Z' };

function fixture(values, sockets = []) {
  const state = createDurableState(values, sockets);
  const loader = createWorkerLoader({ db: { getSettingsByKeys: async () => ({ record_enabled: 'false' }), listPingTasks: async () => [], listAgentWebsiteProbeTasks: async () => [] } });
  const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
  const object = new LiveDataDO(state.state, {});
  const post = (path, body) => object.fetch(new Request(`https://do${path}`, { method: 'POST', body: JSON.stringify(body) }));
  return { state, object, post };
}

for (const cold of [false, true]) {
  test(`W02: ${cold ? 'cold' : 'warm'} durable auth rejects an old lookup completing after rotation`, async () => {
    let f = fixture();
    assert.equal((await f.post('/agent-auth', { client: initial })).status, 200);
    assert.equal((await f.post('/agent-auth', { client: rotated })).status, 200);
    if (cold) f = fixture(f.state.values);
    await f.post('/agent-auth', { client: initial });
    const old = await f.post('/agent-auth/lookup', { token_hash: initial.token_hash });
    const current = await f.post('/agent-auth/lookup', { token_hash: rotated.token_hash });
    assert.equal(old.status, 404, 'superseded credentials must never become current by delayed cache fill');
    assert.equal(current.status, 200, 'the latest confirmed credential must remain usable');
    await f.state.drain();
  });
}

test('W02: replacing the current auth snapshot removes the old hash record', async () => {
  const f = fixture();
  await f.post('/agent-auth', { client: initial });
  await f.post('/agent-auth', { client: rotated });
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: initial.token_hash })).status, 404);
  assert.equal([...f.state.values.keys()].filter(key => key.startsWith('agent-auth:')).length, 1);
});

test('W02: authoritative control revisions serialize rotations and ignore older deliveries after restart', async () => {
  let f = fixture();
  assert.equal((await f.post('/client-sync', { uuid: initial.uuid, revision: '9007199254741002', client: rotated })).status, 200);
  f = fixture(f.state.values);
  assert.equal((await f.post('/client-sync', { uuid: initial.uuid, revision: '9007199254741001', client: initial })).status, 200);
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: initial.token_hash })).status, 404);
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: rotated.token_hash })).status, 200);
});

test('W02: a deleted client cannot be reauthorized by an old asynchronous snapshot fill', async () => {
  let f = fixture();
  await f.post('/agent-auth', { client: initial });
  await f.post('/client-remove', { uuid: initial.uuid });
  f = fixture(f.state.values);
  await f.post('/agent-auth', { client: initial });
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: initial.token_hash })).status, 404);
});

test('W02: an old socket attachment cannot submit another report after cold reconstruction', async () => {
  let f = fixture();
  await f.post('/client-sync', { uuid: initial.uuid, revision: '1', client: initial });
  await f.post('/client-sync', { uuid: initial.uuid, revision: '2', client: rotated });
  const stale = createSocket({ role: 'agent', clientId: initial.uuid, clientName: initial.name,
    hidden: false, authHash: initial.token_hash });
  f = fixture(f.state.values, [stale.ws]);
  await f.object.webSocketMessage(stale.ws, JSON.stringify({ type: 'report', data: { cpu: 99 } }));
  assert.equal(stale.messages.some(message => message.type === 'ack'), false, 'an old credential must never receive a report receipt');
  assert.equal(stale.ws.readyState, 3, 'close the unauthorized socket');
  await f.state.drain();
});

test('W02: restoration accepts a newer authority revision even when the backup credential is older', async () => {
  const f = fixture();
  await f.post('/client-sync', { uuid: initial.uuid, revision: '1', client: rotated });
  const snapshot = await (await f.object.fetch(new Request('https://do/admin-clients-snapshot'))).json();
  assert.equal((await f.post('/clients-restore', { clients: [initial], expected_version: snapshot.updatedAt })).status, 200);
  assert.equal((await f.post('/client-sync', { uuid: initial.uuid, revision: '2', client: initial })).status, 200);
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: initial.token_hash })).status, 200);
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: rotated.token_hash })).status, 404);
  await f.post('/client-sync', { uuid: initial.uuid, revision: '1', client: rotated });
  assert.equal((await f.post('/agent-auth/lookup', { token_hash: rotated.token_hash })).status, 404);
  await f.state.drain();
});
