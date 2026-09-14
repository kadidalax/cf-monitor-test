import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { hashAgentToken } from '../src/utils/client.ts';
import { createRuntimeFixture, eventually } from '../test-support/runtime-fixture.mjs';

const fields = ['cpu', 'ram', 'ram_total', 'swap', 'swap_total', 'net_in', 'net_out', 'net_total_up', 'net_total_down'];

function reportAndAck(socket, report) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      if (error) reject(error); else resolve();
    };
    const listener = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'ack') finish();
      else if (message.type === 'error') finish(new Error('Metric report was rejected'));
    };
    const timer = setTimeout(() => finish(new Error('Metric report acknowledgement timed out')), 8000);
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({ type: 'report', data: report }));
  });
}

test('AG02 native HTTP and WebSocket preserve unavailable metrics through SQL, public history and cold state', { timeout: 90000 }, async t => {
  const f = await createRuntimeFixture({ persistDurableObjects: true });
  t.after(() => f.close());
  const cases = [
    { id: 'unknown-http', transport: 'http', value: null, capacity: 0.5 },
    { id: 'unknown-socket', transport: 'socket', value: null },
    { id: 'zero-http', transport: 'http', value: 0, capacity: 0.5 },
    { id: 'zero-socket', transport: 'socket', value: 0, capacity: 0.5 },
  ];
  const errors = { cpu: 'warming_up', ram: 'container_scope_unavailable', swap: 'collection_failed', network: 'collection_failed' };
  for (const item of cases) {
    const credential = randomBytes(32).toString('hex');
    await f.database.query('insert into clients(uuid,name,token_hash) values ($1,$1,$2)',
      [item.id, await hashAgentToken(credential)]);
    const headers = { Authorization: `Bearer ${credential}`, 'CF-Connecting-IP': '1.1.1.1' };
    const report = { ...Object.fromEntries(fields.map(field => [field, item.value])), timestamp: Date.now(),
      ...(item.value === null ? { metric_errors: { ...errors, raw_detail: 'private-collector-context' } } : {}),
      ...(item.capacity === undefined ? {} : { cpu_capacity: item.capacity }) };
    if (item.transport === 'http') {
      const response = await f.fetch('/api/clients/report', { method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
      assert.equal(response.status, 200);
    } else {
      const response = await f.fetch('/api/clients/report', { headers: { ...headers, Upgrade: 'websocket' } });
      assert.equal(response.status, 101);
      const socket = response.webSocket;
      socket.accept();
      try { await reportAndAck(socket, report); } finally { socket.close(); }
    }
  }
  await eventually(async () => (await f.database.query('select count(*)::int as count from records')).rows[0].count === cases.length);
  for (const item of cases) {
    const stored = (await f.database.query('select * from records where client=$1', [item.id])).rows[0];
    const response = await f.fetch(`/api/recent/${item.id}`);
    assert.equal(response.status, 200);
    const recent = await response.json();
    assert.equal(recent.length, 1);
    for (const row of [stored, recent[0]]) {
      for (const field of fields) assert.equal(row[field], item.value, `${item.id}.${field}`);
    }
  }
  for (const phase of ['warm', 'cold']) {
    if (phase === 'cold') await f.restart();
    const response = await f.fetch('/api/live/clients');
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.ok(!JSON.stringify(snapshot).includes('private-collector-context'));
    for (const item of cases) {
      const report = snapshot.data[item.id] ?? snapshot.last_known[item.id];
      assert.ok(report, `${phase} snapshot includes ${item.id}`);
      for (const field of fields) assert.equal(report[field], item.value, `${phase} ${item.id}.${field}`);
      if (item.value === null) {
        assert.deepEqual(report.metric_errors, errors);
      }
      if (item.capacity === undefined) assert.equal(Object.hasOwn(report, 'cpu_capacity'), false);
      else assert.equal(report.cpu_capacity, item.capacity);
    }
  }
});
