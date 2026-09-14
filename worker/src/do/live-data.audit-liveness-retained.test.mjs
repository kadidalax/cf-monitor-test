import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableState, createSocket, createWorkerLoader } from '../../test-support/worker-module.mjs';

for (const cold of [false, true]) {
  test(`W03: ${cold ? 'cold' : 'warm'} offline liveness uses the last received report after WebSocket close`, async () => {
    let now = 1_800_000_000_000;
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    const storage = createDurableState();
    const loader = createWorkerLoader({ globals: { Date: Clock }, db: {
      getSettingsByKeys: async () => ({ record_enabled: 'false' }), listPingTasks: async () => [],
      listAgentWebsiteProbeTasks: async () => [], listPublicClientRows: async () => [{ uuid: 'retained-node' }],
      updateClient: async () => {}, getSetting: async () => null, setSetting: async () => {}, insertAuditLog: async () => {},
    } });
    const { LiveDataDO } = loader.load('worker/src/do/live-data.ts');
    let object = new LiveDataDO(storage.state, {});
    const socket = createSocket({ role: 'agent', clientId: 'retained-node', clientName: 'Synthetic node', hidden: false });
    object.registerSession(socket.ws, socket.ws.deserializeAttachment());
    await object.webSocketMessage(socket.ws, JSON.stringify({ type: 'report', data: { cpu: 10, timestamp: now - 600000 } }));
    await storage.drain();
    const received = now;
    socket.ws.close();
    await object.webSocketClose(socket.ws, 1000, 'Synthetic close', true);
    await storage.drain();
    if (cold) object = new LiveDataDO(storage.state, {});
    const evaluate = () => object.fetch(new Request('https://do/offline-evaluate', { method: 'POST', body: JSON.stringify({
      clients: [{ uuid: 'retained-node', graceMs: 300000, fallbackLastSeen: received - 3600000 }],
    }) })).then(response => response.json());
    now += 60000;
    const before = (await evaluate()).clients['retained-node'];
    assert.equal(before.lastSeen, received, 'the service receipt timestamp must survive disconnect');
    assert.equal(before.offline, false);
    now = received + 300001;
    const after = (await evaluate()).clients['retained-node'];
    assert.equal(after.offline, true);
    assert.equal(after.streak, 1);
    await object.fetch(new Request('https://do/client-remove', { method: 'POST', body: JSON.stringify({ uuid: 'retained-node' }) }));
    assert.equal(object.lastKnownClients.has('retained-node'), false);
    await storage.drain();
  });
}
