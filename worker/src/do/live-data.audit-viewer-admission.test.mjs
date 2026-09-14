import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableState, createSocket, createWorkerLoader } from '../../test-support/worker-module.mjs';

class UpgradeResponse extends Response {
  constructor(body, init = {}) { super(body, { ...init, status: init.status === 101 ? 200 : init.status }); this.upgraded = init.status === 101; }
  get status() { return this.upgraded ? 101 : super.status; }
}
class SocketPair {
  constructor() { this[0] = createSocket({}).ws; this[1] = createSocket({}).ws; }
}

for (const perIp of [true, false]) {
  test(`W07: simultaneous cold viewer admission obeys the ${perIp ? 'per-IP' : 'global'} cap`, async () => {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const storage = createDurableState();
    const loader = createWorkerLoader({ globals: { Response: UpgradeResponse, WebSocketPair: SocketPair }, db: {
      getSettingsByKeys: async () => { entered(); await gate; return {}; },
      listPingTasks: async () => [], listAgentWebsiteProbeTasks: async () => [],
      getSetting: async () => null, setSetting: async () => {}, insertAuditLog: async () => {},
    } });
    const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
    const object = new LiveDataDO(storage.state, {});
    const cap = perIp ? 8 : 128;
    const requests = Array.from({ length: cap + 1 }, (_, index) => object.fetch(new Request(
      `https://do/?role=viewer&id=viewer-${index}&viewer_ip=${perIp ? '203.0.113.1' : `198.51.100.${index + 1}`}`,
      { headers: { Upgrade: 'websocket' } },
    )));
    await started;
    release();
    const responses = await Promise.all(requests);
    assert.equal(responses.filter(response => response.status === 101).length, cap);
    assert.equal(responses.filter(response => response.status === 429).length, 1);
    assert.equal(storage.sockets.length, cap);
    await storage.drain();
  });
}
