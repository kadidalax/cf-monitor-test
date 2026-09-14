import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

function fixture() {
  let databaseReads = 0, liveReads = 0;
  const loader = createWorkerLoader({ db: {
    getClientIdentityByToken: async () => { databaseReads += 1; return null; },
    markClientTokenUsed: async () => false,
  } });
  const { wsRoutes } = loader.load('worker/src/routes/websocket.ts');
  const env = { LIVE_DATA: { idFromName: value => value, get: () => ({ fetch: async request => {
    const path = new URL(request.url).pathname;
    if (path === '/agent-auth/lookup') return Response.json({ error: 'Missing' }, { status: 404 });
    if (path === '/live' || path === '/ws/live') { liveReads += 1; return Response.json({ online: [], data: {}, last_known: {}, timestamp: Date.now() }); }
    throw new Error('Unexpected local DO request');
  } }) } };
  return { request: (path, headers = {}) => wsRoutes.fetch(new Request(`https://panel.example.test${path}`, {
    headers: { 'CF-Connecting-IP': '203.0.113.10', ...headers },
  }), env, { waitUntil() {} }), reads: () => ({ databaseReads, liveReads }) };
}

test('W06: malformed WebSocket credentials are rejected before database work', async () => {
  const f = fixture();
  assert.equal((await f.request('/clients/report', { Upgrade: 'websocket', Authorization: 'Bearer x' })).status, 401);
  assert.equal(f.reads().databaseReads, 0);
});

test('W06: invalid WebSocket Origin is rejected before credential lookup', async () => {
  const f = fixture();
  const response = await f.request('/clients/report', { Upgrade: 'websocket', Authorization: `Bearer ${crypto.randomUUID()}`, Origin: 'https://other.example.test' });
  assert.equal(response.status, 403);
  assert.equal(f.reads().databaseReads, 0);
});

test('W06: public non-upgrade WebSocket snapshots share the bounded HTTP live policy', async () => {
  const f = fixture();
  const responses = [];
  for (let index = 0; index < 181; index += 1) responses.push(await f.request('/ws/live'));
  assert.equal(responses.at(-1).status, 429);
  assert.ok(f.reads().liveReads <= 180);
});
