import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableState, createWorkerLoader } from '../../test-support/worker-module.mjs';

const original = { uuid: 'audit-sync-node', name: 'Synthetic node', hidden: false,
  token: '', token_hash: 'synthetic-hash', updated_at: '2026-09-13T00:00:00Z' };

async function fixture(failure) {
  let rows = [structuredClone(original)];
  const state = createDurableState();
  const pending = new Map();
  let revision = 0;
  const changed = uuid => pending.set(uuid, { uuid, revision: String(++revision),
    client: structuredClone(rows.find(row => row.uuid === uuid) || null) });
  const db = {
    getSettingsByKeys: async () => ({ record_enabled: 'false' }),
    getSetting: async () => null, setSetting: async () => {},
    listClients: async () => structuredClone(rows), listPublicClientRows: async () => structuredClone(rows),
    getClientsByIds: async (_db, ids) => structuredClone(rows.filter(row => ids.includes(row.uuid))),
    updateClientAndReturn: async (_db, uuid, patch) => {
      rows = rows.map(row => row.uuid === uuid ? { ...row, ...patch, updated_at: '2026-09-13T01:00:00Z' } : row);
      changed(uuid); return structuredClone(rows.find(row => row.uuid === uuid));
    },
    updateClientsHidden: async (_db, ids, hidden) => {
      rows = rows.map(row => ids.includes(row.uuid) ? { ...row, hidden, updated_at: '2026-09-13T01:00:00Z' } : row);
      ids.forEach(changed); return ids.length;
    },
    deleteClient: async (_db, uuid) => {
      const removed = rows.some(row => row.uuid === uuid) ? 1 : 0;
      rows = rows.filter(row => row.uuid !== uuid); changed(uuid); return { removed, deleted_records: {} };
    },
    deleteClients: async (_db, ids) => {
      const removed = rows.filter(row => ids.includes(row.uuid)).length;
      rows = rows.filter(row => !ids.includes(row.uuid)); ids.forEach(changed); return { removed, deleted_records: {} };
    },
    listPendingClientSyncs: async (_db, { uuids } = {}) => [...pending.values()].filter(row => !uuids || uuids.includes(row.uuid)),
    acknowledgeClientSync: async (_db, uuid, version) => {
      if (pending.get(uuid)?.revision !== version) return false;
      return pending.delete(uuid);
    },
    acknowledgeClientSyncs: async (_db, changes) => changes.reduce((count, change) => {
      if (pending.get(change.uuid)?.revision !== change.revision) return count;
      return count + Number(pending.delete(change.uuid));
    }, 0),
    getClient: async (_db, uuid) => structuredClone(rows.find(row => row.uuid === uuid) || null),
    pruneClientReferences: async () => ({}), pruneClientReferencesForClients: async () => ({}),
    insertAuditLog: async () => {}, listPingTasks: async () => [], listAgentWebsiteProbeTasks: async () => [],
  };
  const loader = createWorkerLoader({ db, expose: {
    'worker/src/routes/admin.ts': ['applyAdminClientsSnapshot'],
    'worker/src/routes/public.ts': ['applyPublicClientsOverlay'],
  } });
  const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
  const object = new LiveDataDO(state.state, {});
  await object.fetch(new Request('https://do/admin-clients-snapshot', { method: 'PUT', body: JSON.stringify({ clients: [original] }) }));
  let unavailable = failure;
  const env = { LIVE_DATA: { idFromName: value => value, get: () => ({ fetch: request => {
    const path = new URL(request.url).pathname;
    if (unavailable && ['/client-meta', '/client-remove', '/agent-auth', '/client-sync', '/client-sync/batch'].includes(path)) {
      if (unavailable === 'network') return Promise.reject(new Error('Synthetic DO unavailable'));
      return Promise.resolve(unavailable === 'malformed' ? Response.json({ success: false }) : Response.json({ error: 'Synthetic DO failure' }, { status: 503 }));
    }
    return object.fetch(request);
  } }) } };
  return { loader, env, object, state, pending, db,
    recover: () => { unavailable = false; },
    rows: () => rows,
    request: (path, body = {}) => loader.load('worker/src/routes/admin.ts').adminRoutes.fetch(new Request(`https://panel.example.test${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env, { waitUntil: promise => state.state.waitUntil(promise) }),
  };
}

for (const failure of ['http', 'network', 'malformed']) {
  for (const action of ['edit', 'remove', 'batch-hide', 'batch-remove']) {
    test(`W01: ${action} does not acknowledge complete success after ${failure} DO failure`, async () => {
      const f = await fixture(failure);
      const batch = action.startsWith('batch-');
      const response = await f.request(batch ? `/clients/${action}` : `/clients/${original.uuid}/${action}`,
        batch ? { uuids: [original.uuid] } : action === 'edit' ? { hidden: true } : {});
      assert.ok(action.includes('remove') ? f.rows().length === 0 : f.rows()[0].hidden, 'SQL mutation must really have committed');
      assert.equal(response.status, 503, 'an unconfirmed durable synchronization must not be acknowledged as success');
      const body = await response.json();
      assert.equal(body.committed, true, 'caller must know the database change is already committed');
      assert.equal(body.synchronized, false);
      assert.equal(f.pending.size, 1, 'unfinished synchronization remains durably retryable');
      await f.state.drain();
    });
  }
}

test('W01: forced administrator refresh keeps newer database controls', async () => {
  const f = await fixture(false);
  const current = { ...original, hidden: true, name: 'Current database name', updated_at: '2026-09-13T01:00:00Z' };
  const { applyAdminClientsSnapshot } = f.loader.load('worker/src/routes/admin.ts');
  const result = applyAdminClientsSnapshot([current], { clients: [original], removed: [], complete: true, updatedAt: 1 });
  assert.equal(result[0].hidden, true);
  assert.equal(result[0].name, current.name);
});

test('W01: an authoritative empty public list cannot resurrect a deleted node from an old overlay', async () => {
  const f = await fixture(false);
  const { applyPublicClientsOverlay } = f.loader.load('worker/src/routes/public.ts');
  assert.equal(applyPublicClientsOverlay([], { clients: [original], removed: [] }).length, 0);
});

test('W01: retry after service recovery confirms state and acknowledges only its applied queue entry', async () => {
  const f = await fixture('http');
  await f.request(`/clients/${original.uuid}/edit`, { hidden: true });
  f.recover();
  const response = await f.request(`/clients/${original.uuid}/edit`, { hidden: true });
  assert.equal(response.status, 200);
  assert.equal(f.pending.size, 0, 'the durable outbox entry must be acknowledged after confirmed application');
  const current = await (await f.object.fetch(new Request('https://do/admin-clients-snapshot'))).json();
  assert.equal(current.clients[0].hidden, true);
});

test('W01: a forced administrator refresh removes a database-deleted node from the durable cache', async () => {
  const f = await fixture(false);
  await f.db.deleteClient(null, original.uuid);
  const response = await f.loader.load('worker/src/routes/admin.ts').adminRoutes.fetch(
    new Request('https://panel.example.test/clients?refresh=1'), f.env,
    { waitUntil: promise => f.state.state.waitUntil(promise) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 0, 'an overlay present before the SQL read cannot revive a deleted node');
  await f.state.drain();
  const snapshot = await (await f.object.fetch(new Request('https://do/admin-clients-snapshot'))).json();
  assert.equal(snapshot.clients.length, 0);
});

test('W01: refresh merging retains a new node added during the SQL read without retaining older deleted rows', async () => {
  const f = await fixture(false);
  const { applyAdminClientsSnapshot } = f.loader.load('worker/src/routes/admin.ts');
  const before = { clients: [original], removed: [], complete: true, updatedAt: 10 };
  const added = { ...original, uuid: 'concurrently-added-node', updated_at: '2026-09-13T02:00:00Z' };
  const after = { ...before, clients: [original, added], updatedAt: 11 };
  const merged = applyAdminClientsSnapshot([], after, before);
  assert.deepEqual(Array.from(merged, row => row.uuid), [added.uuid]);
});
