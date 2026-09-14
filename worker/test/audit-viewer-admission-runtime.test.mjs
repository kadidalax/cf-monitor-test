import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeFixture } from '../test-support/runtime-fixture.mjs';

for (const { scope, capacity } of [{ scope: 'per-IP', capacity: 8 }, { scope: 'global', capacity: 128 }])
test(`W07: native cold viewer requests respect the ${scope} cap across external policy I/O`, { timeout: 90000 }, async t => {
  let unblock, entered;
  const gate = new Promise(resolve => { unblock = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const f = await createRuntimeFixture({ rpcHook: async ({ phase, name }) => {
    if (phase === 'before' && name === 'cfm_settings_by_keys') { entered(); await gate; }
  } });
  t.after(() => { unblock(); return f.close(); });
  const namespace = await f.mf.getDurableObjectNamespace('LIVE_DATA');
  const stub = namespace.get(namespace.idFromName('global'));
  const requests = Array.from({ length: capacity + 1 }, (_, id) => stub.fetch(
    `https://do/?role=viewer&id=viewer-${id}&viewer_ip=203.0.113.${scope === 'global' ? id + 1 : 1}`, { headers: { Upgrade: 'websocket' } }));
  let timeout;
  try {
    await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Policy I/O not reached')), 10000); })]);
    unblock();
    const responses = await Promise.all(requests);
    assert.equal(responses.filter(response => response.status === 101).length, capacity);
    assert.equal(responses.filter(response => response.status === 429).length, 1);
    for (const response of responses) if (response.webSocket) { response.webSocket.accept(); response.webSocket.close(); }
  } finally { clearTimeout(timeout); unblock(); }
});
