import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const loader = createWorkerLoader();
const { normalizeMonitorReport, toMonitorRecord } = loader.load('worker/src/utils/monitor-report.ts');
const { compactLiveReport } = loader.load('worker/src/utils/live-report-state.ts');
const { toPublicReport } = loader.load('worker/src/utils/public-report.ts');
const fields = ['cpu', 'ram', 'ram_total', 'swap', 'swap_total', 'net_in', 'net_out', 'net_total_up', 'net_total_down'];

for (const field of fields) {
  test(`AG02: explicit unavailable ${field} survives normalization, persistence and public projection`, () => {
    const report = normalizeMonitorReport({ [field]: null });
    for (const actual of [report, compactLiveReport(report), toPublicReport(report), toMonitorRecord('node', '2026-09-14T00:00:00Z', report)]) {
      assert.equal(actual[field], null, `${field} must never describe an unavailable measurement as measured zero`);
    }
  });
}

test('AG02: measured zeros, legacy missing fields and nested measurements remain compatible', () => {
  for (const input of [{}, Object.fromEntries(fields.map(field => [field, 0]))]) {
    const report = normalizeMonitorReport(input);
    const record = toMonitorRecord('node', '2026-09-14T00:00:00Z', report);
    for (const field of fields) {
      assert.equal(report[field], 0);
      assert.equal(record[field], 0);
    }
  }
  const nested = normalizeMonitorReport({ cpu: { usage: 25 }, ram: { used: 100, total: 200 },
    swap: { used: 0, total: 50 }, network: { down: 12, up: 34, totalUp: 56, totalDown: 78 } });
  assert.deepEqual(fields.map(field => nested[field]), [25, 100, 200, 0, 50, 12, 34, 56, 78]);
});

test('AG02: fractional CPU capacity and fixed unavailable reasons survive durable and public snapshots', () => {
  const input = { cpu: 50, cpu_capacity: 0.5, ram: null, swap: null, net_in: null,
    metric_errors: { ram: 'container_scope_unavailable', swap: 'collection_failed', network: 'warming_up',
      internal_detail: 'synthetic private error context' } };
  const report = normalizeMonitorReport(input);
  for (const actual of [report, compactLiveReport(report), toPublicReport(report), toPublicReport(input)]) {
    assert.equal(actual.cpu_capacity, 0.5);
    assert.deepEqual(JSON.parse(JSON.stringify(actual.metric_errors)), {
      ram: 'container_scope_unavailable', swap: 'collection_failed', network: 'warming_up',
    });
  }
});

test('AG02: invalid capacity and free-form errors cannot reach public or durable data', () => {
  for (const cpu_capacity of [0, -1, Infinity, '0.5', null, {}]) {
    const input = { cpu: 10, cpu_capacity, metric_errors: { cpu: 'raw error text', network: { cause: 'private' } } };
    for (const actual of [normalizeMonitorReport(input), compactLiveReport(normalizeMonitorReport(input)), toPublicReport(input)]) {
      assert.equal(Object.hasOwn(actual, 'cpu_capacity'), false);
      assert.equal(Object.hasOwn(actual, 'metric_errors'), false);
    }
  }
});

test('AG02: known CPU quota is independent of unavailable usage', () => {
  for (const reason of ['warming_up', 'collection_failed', 'container_scope_unavailable']) {
    const input = { cpu: null, cpu_capacity: 0.5, metric_errors: { cpu: reason } };
    const normalized = normalizeMonitorReport(input);
    for (const actual of [normalized, compactLiveReport(normalized), toPublicReport(input)]) {
      assert.equal(actual.cpu, null);
      assert.equal(actual.cpu_capacity, 0.5, 'a known quota remains useful while usage cannot be measured');
      assert.deepEqual(JSON.parse(JSON.stringify(actual.metric_errors)), { cpu: reason });
    }
  }
});
