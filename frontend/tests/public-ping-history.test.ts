import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  normalizePingRecord,
  normalizePingRecords,
  normalizePingTask,
  pingTaskAppliesToClient,
} from '../src/utils/pingChart.ts';

test('ping task normalization ignores malformed task payloads', () => {
  assert.equal(pingTaskAppliesToClient(null, 'node-1'), false);
  assert.equal(pingTaskAppliesToClient({}, 'node-1'), false);
  assert.equal(pingTaskAppliesToClient({ id: 'bad' }, 'node-1'), false);
  assert.equal(pingTaskAppliesToClient({ id: '7', clients: ['node-2'] }, 'node-1'), false);
  assert.equal(pingTaskAppliesToClient({ id: '7', clients: ['node-1'] }, 'node-1'), true);
  assert.equal(normalizePingTask(null, 0), null);
  assert.equal(normalizePingTask({ id: 'bad' }, 0), null);

  assert.deepEqual(normalizePingTask({
    id: '7',
    name: 'HTTPS',
    target: 'https://example.com',
    type: 'http',
    interval_sec: 30,
  }, 0), {
    id: 7,
    key: 'task_7',
    label: 'HTTPS',
    target: 'https://example.com',
    type: 'HTTP',
    intervalSec: 30,
    color: '#FF9100',
  });
});

test('ping record normalization keeps valid rows and drops malformed rows', () => {
  assert.deepEqual(normalizePingRecord({
    time: '2026-06-17T00:00:00.000Z',
    value: 42,
    task_id: '7',
  }), {
    time: '2026-06-17T00:00:00.000Z',
    value: 42,
    task_id: '7',
  });

  assert.equal(normalizePingRecord({ time: 'bad', value: 42 }), null);
  assert.equal(normalizePingRecord({ time: '2026-06-17T00:00:00.000Z', value: '42' }), null);
  assert.equal(normalizePingRecord(null), null);
});

test('ping record lists normalize arrays and data envelopes', () => {
  assert.deepEqual(normalizePingRecords({
    data: [
      { time: '2026-06-17T00:00:00.000Z', value: 10 },
      { time: 'bad', value: 10 },
    ],
  }), [{ time: '2026-06-17T00:00:00.000Z', value: 10 }]);
});

test('ping fetch path normalizes batch and fallback record payloads', () => {
  const pingChartSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'pingChart.ts'), 'utf8');

  assert.match(pingChartSource, /records: normalizePingRecords\(asRecord\(recordsByTask\)\?\.\[String\(task\.id\)\]\)/);
  assert.match(pingChartSource, /records: normalizePingRecords\(records\)/);
  assert.doesNotMatch(pingChartSource, /Array\.isArray\(records\?\.data\) \? records\.data : \[\]/);
});
