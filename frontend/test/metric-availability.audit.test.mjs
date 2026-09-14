import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModule } from './helpers/production-module.mjs';

const history = productionModule('src/utils/publicHistory.ts');
const chart = productionModule('src/utils/monitorChartData.ts');
const live = productionModule('src/utils/liveDataResponse.ts');
const monitor = productionModule('src/utils/monitorView.ts');
const dashboard = productionModule('src/utils/dashboardStatus.ts');
const state = productionModule('src/contexts/LiveDataContext.tsx');
const metrics = productionModule('src/utils/nodeMetrics.ts');
const fields = ['cpu', 'ram', 'ram_total', 'swap', 'swap_total', 'net_in', 'net_out', 'net_total_up', 'net_total_down'];
const zeros = Object.fromEntries(fields.map(field => [field, 0]));
const unavailable = Object.fromEntries(fields.map(field => [field, null]));
const time = '2026-09-14T00:00:00.000Z';

for (const field of fields) {
  test(`AG02 explicit null ${field} preserves its history row and other measurements`, () => {
    const row = history.normalizePublicMonitorRecord({ time, id: '9007199254740993', ...zeros, [field]: null, process_count: 17 });
    assert.ok(row, 'unavailable metrics must not discard a valid history row');
    assert.equal(row[field], null);
    assert.equal(row.process_count, 17);
    assert.equal(row.id, '9007199254740993');
  });
}

test('AG02 actual zeros and old reports without the new nullable fields remain compatible', () => {
  for (const input of [{ time, ...zeros }, { time }]) {
    const row = history.normalizePublicMonitorRecord(input);
    assert.ok(row);
    for (const field of fields) assert.equal(row[field], 0, field);
  }
  assert.equal(history.normalizePublicMonitorRecord({ time, cpu: 'broken' }), null);
});

test('AG02 offline snapshots retain null metrics and allowlisted collection reasons', () => {
  const snapshot = live.normalizeLastKnownRecord({ uuid: 'node-a', name: 'Synthetic', lastReportTime: 123,
    ...unavailable, cpu_capacity: 0.5,
    metric_errors: { cpu: 'warming_up', ram: 'container_scope_unavailable', swap: 'collection_failed', network: 'collection_failed', extra: 'collection_failed' },
  }, 'node-a');
  assert.ok(snapshot);
  for (const field of fields) assert.equal(snapshot[field], null, field);
  assert.equal(snapshot.cpu_capacity, 0.5);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.metric_errors)), {
    cpu: 'warming_up', ram: 'container_scope_unavailable', swap: 'collection_failed', network: 'collection_failed',
  });
});

test('AG02 invalid CPU capacity and arbitrary collection text never become public snapshot metadata', () => {
  for (const cpu_capacity of [0, -1, Infinity, NaN, '0.5', null]) {
    const snapshot = live.normalizeLastKnownRecord({ uuid: 'node-a', name: 'Synthetic', lastReportTime: 123,
      cpu_capacity, metric_errors: { cpu: 'arbitrary diagnostic text', extra: 'warming_up' },
    }, 'node-a');
    assert.equal(snapshot.cpu_capacity, undefined);
    assert.equal(snapshot.metric_errors, undefined);
  }
});

test('AG02 online snapshot metadata uses the same allowlist as offline readings', () => {
  const record = { uuid: 'node-a', name: 'Synthetic', lastReportTime: 123, ...unavailable,
    cpu_capacity: 0.5, metric_errors: { cpu: 'warming_up', network: 'arbitrary diagnostic text', extra: 'collection_failed' } };
  const snapshot = live.normalizeLiveDataResponse({ online: ['node-a'], clients: [record], data: { 'node-a': record }, count: 1, timestamp: 123 });
  for (const reading of [snapshot.data['node-a'], snapshot.clients[0]]) {
    assert.equal(reading.cpu_capacity, 0.5);
    assert.deepEqual(JSON.parse(JSON.stringify(reading.metric_errors)), { cpu: 'warming_up' });
  }
});

test('AG02 explicitly reported CPU capacity remains known when usage scope is unavailable', () => {
  const record = { uuid: 'node-a', name: 'Synthetic', lastReportTime: 123, ...unavailable,
    cpu_capacity: 0.5, metric_errors: { cpu: 'container_scope_unavailable' } };
  assert.equal(live.normalizeLastKnownRecord(record, 'node-a').cpu_capacity, 0.5);
  assert.equal(metrics.cpuCapacity(record, 64), 0.5);
  assert.equal(metrics.cpuCapacity({ ...record, cpu_capacity: undefined }, 64), undefined);
});

test('AG02 a report without CPU capacity clears the previous report budget', () => {
  const initial = { online: ['node-a'], clients: [], data: { 'node-a': { ...zeros, cpu_capacity: 0.5 } }, count: 1, timestamp: 123 };
  const next = state.applyLiveUpdate(initial, { type: 'update', client: 'node-a', timestamp: 124, data: { ...zeros } });
  assert.equal(next.data['node-a'].cpu_capacity, undefined);
  assert.equal(next.clients[0].cpu_capacity, undefined);
});

test('AG02 live recovery clears obsolete reasons without dropping errors for untouched partial metrics', () => {
  const initial = { online: ['node-a'], clients: [], data: { 'node-a': {
    ...unavailable, metric_errors: { cpu: 'container_scope_unavailable', ram: 'collection_failed' },
  } }, count: 1, timestamp: 123 };
  const cpuRecovered = state.applyLiveUpdate(initial, { type: 'update', client: 'node-a', timestamp: 124, data: { cpu: 0, cpu_capacity: 0.5 } });
  assert.deepEqual(JSON.parse(JSON.stringify(cpuRecovered.data['node-a'].metric_errors)), { ram: 'collection_failed' });
  assert.equal(cpuRecovered.data['node-a'].cpu_capacity, 0.5);
  const scopeLost = state.applyLiveUpdate(cpuRecovered, { type: 'update', client: 'node-a', timestamp: 125,
    data: { cpu: null, metric_errors: { cpu: 'container_scope_unavailable' } } });
  assert.equal(scopeLost.data['node-a'].cpu_capacity, undefined, 'unknown scope cannot carry forward an old CPU budget');
  const recovered = state.applyLiveUpdate(scopeLost, { type: 'update', client: 'node-a', timestamp: 126, data: { ...zeros, ram_total: 1024, cpu_capacity: 0.5 } });
  assert.equal(recovered.data['node-a'].metric_errors, undefined);
  assert.equal(recovered.clients[0].metric_errors, undefined);
  const offline = state.applyLiveRemove(recovered, { type: 'remove', client: 'node-a', timestamp: 127, reason: 'offline' });
  assert.equal(offline.last_known['node-a'].metric_errors, undefined);
  assert.equal(offline.last_known['node-a'].cpu_capacity, 0.5);
});

test('AG02 CPU RAM and network history keep gaps between actual zero samples', () => {
  const records = [
    { time, ...zeros, ram_total: 1024 },
    { time: '2026-09-14T00:01:00.000Z', ...unavailable },
    { time: '2026-09-14T00:02:00.000Z', ...zeros, ram_total: 1024 },
  ];
  const points = chart.buildMonitorChartData(records);
  for (const field of ['cpu', 'ram', 'net_in', 'net_out']) {
    assert.deepEqual(Array.from(points, point => point[field]), [0, null, 0], field);
  }
});

test('AG02 an unknown memory numerator or zero denominator cannot become zero utilization', () => {
  for (const memory of [{ ram: null, ram_total: 1024 }, { ram: 0, ram_total: null }, { ram: 0, ram_total: 0 }]) {
    assert.equal(chart.buildMonitorChartData([{ time, ...memory }])[0].ram, null);
  }
  for (const point of chart.getMonitorChartRenderData([], 3600000, Date.parse(time))) {
    for (const field of ['cpu', 'ram', 'net_in', 'net_out']) assert.equal(point[field], null, field);
  }
});

const clients = [
  { uuid: 'unknown', name: 'A unknown', region: 'CN', cpu_cores: 64, mem_total: 64000, disk_total: 64000 },
  { uuid: 'known', name: 'B measured', region: 'CN', cpu_cores: 1, mem_total: 1024, disk_total: 1024 },
];

test('AG02 an unavailable online network measurement makes only that aggregate unknown', () => {
  const summary = monitor.getNodeStatsSummary(clients, { online: ['unknown', 'known'], data: {
    unknown: { net_out: null, net_in: 0, net_total_up: null, net_total_down: 0 },
    known: { net_out: 7, net_in: 13, net_total_up: 8, net_total_down: 21 },
  } });
  assert.equal(summary.totalSpeedUp, null);
  assert.equal(summary.totalUp, null);
  assert.equal(summary.totalSpeedDown, 13);
  assert.equal(summary.totalDown, 21);
  const cards = dashboard.buildDashboardStatusCards(summary);
  assert.equal(cards.find(card => card.key === 'networkSpeed').inlineValues[0], '↑ —');
  assert.equal(cards.find(card => card.key === 'trafficOverview').inlineValues[0], '↑ —');
});

test('AG02 zero network traffic stays measured zero while a missing online report stays unknown', () => {
  const zeroSummary = monitor.getNodeStatsSummary(clients.slice(0, 1), { online: ['unknown'], data: { unknown: zeros } });
  for (const field of ['totalUp', 'totalDown', 'totalSpeedUp', 'totalSpeedDown']) assert.equal(zeroSummary[field], 0);
  const missing = monitor.getNodeStatsSummary(clients.slice(0, 1), { online: ['unknown'], data: {} });
  for (const field of ['totalUp', 'totalDown', 'totalSpeedUp', 'totalSpeedDown']) assert.equal(missing[field], null);
});

for (const sortKey of ['cpu', 'memory', 'network', 'traffic']) {
  test(`AG02 ${sortKey} sorting puts unavailable values after measured zero in either direction`, () => {
    const state = { online: ['unknown', 'known'], data: { unknown: unavailable, known: { ...zeros, ram_total: 1024 } } };
    for (const sortDir of ['asc', 'desc']) {
      const sorted = monitor.sortAdminNodes(clients, state, { sortKey, sortDir });
      assert.deepEqual(Array.from(sorted, client => client.uuid), ['known', 'unknown']);
    }
  });
}
